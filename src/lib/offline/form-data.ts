/**
 * Converts a FormData submission into a plain string map that IndexedDB can
 * actually store (FormData itself isn't structured-cloneable -- attempting
 * to idbPut() one directly throws DataCloneError), and back again into a
 * real FormData a FormData-based Server Action can accept unchanged.
 *
 * Only safe to use for forms with no `<input type="file">` -- a File would
 * come out of a FormData->object round trip as `{}` (structured clone loses
 * it), silently dropping the attachment. Before wiring a new FormData-based
 * action through this, grep its form component for `type="file"` first.
 * (Checked for discipline: none of its forms have one.)
 */
export function formDataToObject(formData: FormData): Record<string, string> {
  const obj: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value !== "string") {
      throw new Error(`Field "${key}" is a File, not text -- this form can't be queued for offline sync.`);
    }
    obj[key] = value;
  }
  return obj;
}

export function objectToFormData(obj: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(obj)) {
    formData.set(key, value);
  }
  return formData;
}
