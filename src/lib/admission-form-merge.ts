import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";

// Fills a school-uploaded .docx admission-form template with one applicant's details. Each
// school writes their own template with {{placeholder}} tags wherever they want that info to
// appear — this doesn't assume any particular layout/branding, only the tag names below.
//
// Deliberately no {{admission_number}} — that's only assigned once the student is later
// formally enrolled (see the defer_admission_number_to_enrollment migration), not known yet at
// acceptance, when this runs.
export interface AdmissionFormMergeData {
  student_name: string;
  guardian_name: string;
  class_name: string;
  term_name: string;
  academic_year: string;
  school_name: string;
  application_number: string;
  date: string;
  fee_items: string;
  fee_total: string;
}

export class AdmissionFormMergeError extends Error {}

// Real Word documents routinely split a single visible run of text — including text inside a
// {{tag}} someone typed — across multiple <w:r>/<w:t> XML elements (autocorrect, spell-check,
// or just incremental editing all do this even when nothing looks different on screen).
// docxtemplater can only see a tag that's fully inside one <w:t>, so a school's real uploaded
// template would very likely fail to merge without this — confirmed by testing against an
// actual python-docx-generated file, which reproduces the exact same split. This merges
// consecutive runs within a paragraph into one before handing the XML to docxtemplater. Trade-
// off: mixed formatting (e.g. part-bold) *within* a single run of text is flattened to the
// first run's formatting — acceptable for a fee/admission letter, not for a heavily
// mixed-formatting document.
function joinSplitRuns(xml: string): string {
  const pattern = /<\/w:t>\s*<\/w:r>\s*<w:r(?:\s[^>]*)?>\s*(?:<w:rPr>[\s\S]*?<\/w:rPr>)?\s*<w:t(?:\s[^>]*)?>/g;
  let previous: string;
  let current = xml;
  do {
    previous = current;
    current = current.replace(pattern, "");
  } while (current !== previous);
  return current;
}

export function mergeAdmissionFormTemplate(templateBytes: ArrayBuffer, data: AdmissionFormMergeData): Buffer {
  let zip: PizZip;
  try {
    zip = new PizZip(templateBytes);
  } catch {
    throw new AdmissionFormMergeError("The uploaded template isn't a valid .docx file.");
  }

  const documentXmlPath = "word/document.xml";
  const documentXml = zip.file(documentXmlPath)?.asText();
  if (!documentXml) {
    throw new AdmissionFormMergeError("The uploaded file doesn't look like a valid Word document (missing word/document.xml).");
  }
  zip.file(documentXmlPath, joinSplitRuns(documentXml));

  let doc: Docxtemplater;
  try {
    doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, delimiters: { start: "{{", end: "}}" } });
  } catch {
    throw new AdmissionFormMergeError("The uploaded template could not be read as a Word document.");
  }

  try {
    doc.render(data);
  } catch (err) {
    // docxtemplater throws a rich error object (properties.errors) when a placeholder tag is
    // malformed (e.g. unclosed {{ }}) — surface something a non-technical school admin can act
    // on rather than a raw stack trace.
    const detail =
      err && typeof err === "object" && "properties" in err
        ? JSON.stringify((err as { properties?: unknown }).properties)
        : String(err);
    throw new AdmissionFormMergeError(`Could not fill in the template — check its placeholder tags are well-formed. (${detail})`);
  }

  return doc.getZip().generate({ type: "nodebuffer" }) as Buffer;
}
