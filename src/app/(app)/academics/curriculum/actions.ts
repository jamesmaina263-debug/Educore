"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import {
  CURRICULUM_EXTRACTION_PROMPT_VERSION,
  GEMINI_CURRICULUM_EXTRACTION_MODEL,
  buildCurriculumExtractionPrompt,
  curriculumExtractionResponseSchema,
  parseCurriculumExtractionResponse,
  truncateDocumentText,
  findMatchingStrandId,
} from "@/lib/ai/curriculum-extraction";
import { geminiGenerateContentUrl } from "@/lib/ai/report-card-comment";
import { safeStorageFilename } from "@/lib/storage-path";
import { extractPdfText } from "@/lib/pdf/extract-text";

// ---------------------------------------------------------------------------
// uploadCurriculumDocument
//
// Phase 2A of the curriculum-grounding investigation: a teacher/HOD uploads
// their school's own curriculum PDF for a subject; this action extracts its
// text, asks Gemini to propose a structured strand/sub-strand breakdown, and
// writes that breakdown as new curriculum_strands/curriculum_sub_strands
// rows with content_source='draft' -- already excluded from AI Scheme of
// Work grounding (buildCurriculumContext, scheme-of-work.ts) and from every
// other consumer of that content, exactly like a hand-typed draft row would
// be. Nothing here ever writes content_source='school_authored' or
// 'kicd_licensed' -- promotion only happens through the existing,
// unmodified updateCurriculumSubStrandContent (exams/actions.ts), which
// still requires academics.write, so a human with real authority always
// makes that call.
// ---------------------------------------------------------------------------

export type UploadCurriculumDocumentResult =
  | { error: string }
  | {
      success: true;
      batchId: string;
      strandsExtracted: number;
      subStrandsExtracted: number;
      lowConfidenceCount: number;
      /** True when the document's extracted text was longer than
       *  MAX_DOCUMENT_CHARS and had to be cut off before extraction --
       *  surfaced so the uploader knows the tail of a very long document
       *  wasn't considered, rather than silently getting a partial result. */
      documentTruncated: boolean;
    };

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // matches the storage bucket's own file_size_limit

export async function uploadCurriculumDocument(subjectId: string, formData: FormData): Promise<UploadCurriculumDocumentResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { error: "AI extraction isn't configured yet — GEMINI_API_KEY is missing from the server environment." };
  }

  if (typeof subjectId !== "string" || subjectId.trim().length === 0) {
    return { error: "Please select a subject before uploading." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "No file provided." };
  }
  if (file.type !== "application/pdf") {
    return { error: "Please upload a PDF file." };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { error: "That file is larger than the 20MB limit." };
  }

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in." };

  // Either permission can upload -- see the migration's comment on
  // academics.curriculum_upload for why this is additive to, not a
  // replacement for, academics.write.
  const [{ data: canWrite }, { data: canUpload }] = await Promise.all([
    supabase.rpc("auth_has_permission", { p_permission_key: "academics.write" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "academics.curriculum_upload" }),
  ]);
  if (!canWrite && !canUpload) {
    return { error: "You don't have permission to upload curriculum documents." };
  }

  const { data: schoolUser } = await supabase.from("school_users").select("id, school_id").eq("auth_user_id", user.id).maybeSingle();
  if (!schoolUser) return { error: "You must be signed in." };

  const { data: subjectRow } = await supabase
    .from("subjects")
    .select("id, name")
    .eq("id", subjectId)
    .eq("school_id", schoolUser.school_id)
    .maybeSingle();
  if (!subjectRow) return { error: "Please select a valid subject." };

  const batchId = crypto.randomUUID();
  const storagePath = `${schoolUser.school_id}/${subjectId}/${batchId}-${safeStorageFilename(file.name)}`;

  const { error: uploadError } = await supabase.storage.from("curriculum-documents").upload(storagePath, file);
  if (uploadError) return { error: uploadError.message };

  const { error: insertBatchError } = await supabase.from("curriculum_extraction_batches").insert({
    id: batchId,
    school_id: schoolUser.school_id,
    subject_id: subjectId,
    storage_path: storagePath,
    file_name: file.name,
    uploaded_by: schoolUser.id,
    status: "processing",
    prompt_version: CURRICULUM_EXTRACTION_PROMPT_VERSION,
  });
  if (insertBatchError) {
    await supabase.storage.from("curriculum-documents").remove([storagePath]);
    return { error: "Something went wrong while starting extraction. No file was kept. Please try again." };
  }

  const markBatchFailed = async (failureCategory: string) => {
    await supabase
      .from("curriculum_extraction_batches")
      .update({ status: "failed", failure_category: failureCategory, completed_at: new Date().toISOString() })
      .eq("id", batchId);
  };

  // ---- Extract text from the PDF. ----
  let documentText: string;
  try {
    documentText = await extractPdfText(await file.arrayBuffer());
  } catch (e) {
    console.error(`uploadCurriculumDocument: PDF parsing failed for batch ${batchId}:`, e);
    await markBatchFailed("pdf_parse_error");
    return { error: "We couldn't read that PDF. Please check it isn't corrupted or password-protected and try again." };
  }

  if (!documentText || documentText.length < 20) {
    // Most likely a scanned/image-only PDF with no text layer -- OCR isn't
    // built in this pass (flagged as a known limitation in the PR).
    await markBatchFailed("no_text_layer");
    return {
      error:
        "No readable text was found in that PDF. If it's a scanned document (photos of pages rather than typed text), this feature can't read it yet — please record the curriculum content manually instead.",
    };
  }

  const { text: truncatedText, truncated } = truncateDocumentText(documentText);

  // ---- Ask Gemini to extract structured content. ----
  let res: Response;
  try {
    res = await fetch(geminiGenerateContentUrl(apiKey, GEMINI_CURRICULUM_EXTRACTION_MODEL), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildCurriculumExtractionPrompt(subjectRow.name, truncatedText) }] }],
        generationConfig: {
          maxOutputTokens: 8000,
          temperature: 0.2,
          responseMimeType: "application/json",
          responseSchema: curriculumExtractionResponseSchema,
        },
      }),
      signal: AbortSignal.timeout(45000),
    });
  } catch (e) {
    const isTimeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    await markBatchFailed(isTimeout ? "timeout" : "network");
    return {
      error: isTimeout
        ? "Extraction timed out. The AI took too long to respond. Please try again."
        : "Connection interrupted. We couldn't complete the extraction request. Please check your connection and try again.",
    };
  }

  if (!res.ok) {
    const body = await res.text();
    console.error(`uploadCurriculumDocument: Gemini returned ${res.status} for batch ${batchId}: ${body.slice(0, 500)}`);
    if (res.status === 401 || res.status === 403) {
      await markBatchFailed("auth_config");
      return { error: "AI extraction is currently unavailable. Please contact your school administrator if the problem continues." };
    }
    if (res.status === 429) {
      await markBatchFailed("rate_limit");
      return { error: "AI extraction is temporarily busy. Please wait a moment and try again." };
    }
    await markBatchFailed(res.status >= 500 ? "ai_unavailable" : "server_error");
    return { error: "Something went wrong while extracting curriculum content. Please try again." };
  }

  const data = await res.json();
  const parsedResponse = parseCurriculumExtractionResponse(data);
  if ("error" in parsedResponse) {
    console.error(`uploadCurriculumDocument: response failed validation for batch ${batchId}: ${parsedResponse.error}`);
    const noStructureFound = parsedResponse.error === "No usable curriculum structure was found in this document.";
    await markBatchFailed(noStructureFound ? "no_structure_found" : parsedResponse.error.includes("no content") ? "empty_response" : "malformed_response");
    // The "no usable structure" message is already specific and actionable
    // enough to show as-is; anything else (malformed JSON/shape) collapses
    // to a generic message, same as generateSchemeWithAI's own parse-failure
    // handling -- the raw parser error there is for logs, not the teacher.
    return { error: noStructureFound ? parsedResponse.error : "We couldn't extract curriculum content correctly. Please try again." };
  }

  // ---- Write extracted content as draft rows. ----
  const { data: existingStrandsRaw } = await supabase
    .from("curriculum_strands")
    .select("id, name")
    .eq("subject_id", subjectId)
    .eq("school_id", schoolUser.school_id);
  const existingStrands = (existingStrandsRaw ?? []) as { id: string; name: string }[];

  let subStrandsExtracted = 0;
  let lowConfidenceCount = 0;
  const touchedStrandIds = new Set<string>();

  for (const [index, strand] of parsedResponse.result.strands.entries()) {
    let strandId = findMatchingStrandId(existingStrands, strand.name);
    if (!strandId) {
      const { data: newStrand, error: strandError } = await supabase
        .from("curriculum_strands")
        .insert({
          school_id: schoolUser.school_id,
          subject_id: subjectId,
          name: strand.name,
          level_order: existingStrands.length + index,
          extraction_batch_id: batchId,
        })
        .select("id")
        .single();
      if (strandError || !newStrand) {
        console.error(`uploadCurriculumDocument: failed to insert strand "${strand.name}" for batch ${batchId}:`, strandError?.message);
        continue; // Skip this strand's sub-strands rather than failing the whole batch.
      }
      strandId = newStrand.id as string;
      existingStrands.push({ id: strandId, name: strand.name });
    }
    touchedStrandIds.add(strandId);

    for (const [subIndex, subStrand] of strand.sub_strands.entries()) {
      const { error: subError } = await supabase.from("curriculum_sub_strands").insert({
        strand_id: strandId,
        name: subStrand.name,
        level_order: subIndex,
        learning_outcomes: subStrand.learning_outcomes || null,
        key_inquiry_questions: subStrand.key_inquiry_questions || null,
        rubric_text: subStrand.rubric_text || null,
        content_source: "draft",
        extraction_batch_id: batchId,
        content_updated_by: schoolUser.id,
        content_updated_at: new Date().toISOString(),
      });
      if (subError) {
        console.error(`uploadCurriculumDocument: failed to insert sub-strand "${subStrand.name}" for batch ${batchId}:`, subError.message);
        continue;
      }
      subStrandsExtracted += 1;
      if (subStrand.confidence === "low") lowConfidenceCount += 1;
    }
  }

  if (subStrandsExtracted === 0) {
    await markBatchFailed("write_failed");
    return { error: "The AI found curriculum content, but none of it could be saved. Please try again." };
  }

  await supabase
    .from("curriculum_extraction_batches")
    .update({
      status: "extracted",
      strands_extracted: touchedStrandIds.size,
      sub_strands_extracted: subStrandsExtracted,
      completed_at: new Date().toISOString(),
    })
    .eq("id", batchId);

  revalidatePath("/academics/curriculum");
  revalidatePath("/exams/marks");

  return {
    success: true,
    batchId,
    strandsExtracted: touchedStrandIds.size,
    subStrandsExtracted,
    lowConfidenceCount,
    documentTruncated: truncated,
  };
}

// ---------------------------------------------------------------------------
// deleteCurriculumSubStrand
//
// The one genuinely new mutation this pipeline needed beyond what already
// existed: a reviewer rejecting an extracted sub-strand entirely (as opposed
// to editing it, which reuses updateCurriculumSubStrandContent unchanged).
// Same authority (academics.write, via the existing curriculum_sub_strands_write
// RLS policy) and the same .select()-to-detect-RLS-no-op pattern as
// updateCurriculumSubStrandContent (exams/actions.ts) -- not scoped to
// draft/extracted rows only, since a reviewer with academics.write could
// already delete any curriculum row by other means (e.g. direct SQL); this
// just gives them a UI affordance for it.
// ---------------------------------------------------------------------------

export async function deleteCurriculumSubStrand(subStrandId: string): Promise<{ success: true } | { error: string }> {
  if (typeof subStrandId !== "string" || subStrandId.trim().length === 0) {
    return { error: "Missing sub-strand." };
  }

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { data: deleted, error } = await supabase.from("curriculum_sub_strands").delete().eq("id", subStrandId).select("id");
  if (error) return { error: error.message };
  if (!deleted || deleted.length === 0) {
    return { error: "You don't have permission to delete this sub-strand, or it no longer exists." };
  }

  revalidatePath("/academics/curriculum");
  revalidatePath("/exams/marks");
  return { success: true };
}
