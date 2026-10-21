// Does this organisation's NAME say it is a children's home / orphanage?
//
// EduCore does not charge children's homes, and the outreach email says so (see assembleEmailBody). Because
// that is a promise, this is deliberately conservative: it only matches names that clearly say "children's
// home", "orphanage" and similar, and refuses anything that also reads like a school, nursery or day-care
// ("Little Angels Orphans Academy", "Children's Home Primary School", "Kids Day Care Centre") so those fall
// back to the normal paid offer. A person still reviews every draft before it is sent, and can add the
// free-of-charge wording by hand for a borderline case. Pure function, no I/O.

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Anything that makes this look like a fee-charging school or a day-care rather than a residential home.
const SCHOOL_LIKE =
  /\b(academy|school|schools|primary|secondary|high|prep|preparatory|kindergarten|nursery|pre ?school|playgroup|day ?care|daycare|college|university|montessori|international|polytechnic|institute)\b/;

const ORPHAN = /\borphan(s|age|ages)?\b/;

// "children's home(s)", "childrens village", "kids home", "babies home", "street children rescue", ...
const CHILDREN_HOME =
  /\b(children|childrens|child|kids|babies|baby|street (?:children|boys|girls)|boys|girls)\s+(?:home|homes|village|rescue|shelter|refuge|haven)\b/;

const RESCUE_CENTRE = /\b(children|childrens|street children|kids|orphans?)\s+rescue (?:centre|center)\b/;

export function isChildrenHome(schoolName: string | null | undefined): boolean {
  const n = norm(schoolName ?? "");
  if (!n) return false;
  if (SCHOOL_LIKE.test(n)) return false;
  return ORPHAN.test(n) || CHILDREN_HOME.test(n) || RESCUE_CENTRE.test(n);
}
