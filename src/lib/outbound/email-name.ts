// Works out a first name to greet from the address an outreach email will be sent to.
//
// The rule is "if not sure, don't use a name". A wrong greeting reads worse than a plain "Hello,", so
// this only answers when the local part clearly looks like a natural person's name:
//   - exactly two alphabetic parts joined by . _ or -  (peter.kimani, mary_wanjiku), and
//   - at least one of the parts is a recognised given name (so we know which part to greet), or
//   - a single part that is itself a recognised given name (james@, wanjiku@).
// Anything role-like (info@, principal@, bursar@), school-like, initial-based (j.kimani@) or carrying
// digits in a single word (jmaina263@) returns null. Pure function, no I/O.

const ROLE_WORDS = new Set([
  "info", "admin", "administrator", "administration", "office", "principal", "headteacher", "headmaster",
  "headmistress", "head", "director", "manager", "bursar", "accounts", "accountant", "finance", "secretary",
  "registrar", "reception", "receptionist", "enquiries", "enquiry", "inquiries", "contact", "hello", "hi",
  "mail", "email", "support", "sales", "team", "staff", "teacher", "teachers", "school", "schools",
  "academy", "primary", "secondary", "junior", "senior", "nursery", "kindergarten", "preschool", "college",
  "home", "homes", "children", "childrens", "kids", "orphanage", "orphans", "centre", "center", "foundation",
  "ministry", "county", "noreply", "no", "reply", "donotreply", "webmaster", "postmaster", "board", "bom",
  "pta", "welfare", "projects", "programs", "programmes", "ceo", "md", "hr", "ict", "it",
]);

// Common given names (English/Biblical plus widely used Kenyan names). Deliberately a conservative list:
// it is how we know WHICH part of "kamau.james" is the given name. Lowercase.
const GIVEN_NAMES = new Set([
  "james", "john", "peter", "paul", "joseph", "samuel", "daniel", "david", "michael", "stephen", "simon", "moses",
  "joshua", "isaac", "jacob", "benjamin", "patrick", "francis", "george", "charles", "thomas", "anthony",
  "andrew", "martin", "mark", "luke", "matthew", "philip", "nicholas", "kevin", "brian", "dennis", "eric",
  "victor", "collins", "evans", "felix", "vincent", "fredrick", "frederick", "geoffrey", "gideon", "harrison",
  "hillary", "hussein", "ibrahim", "jackson", "jeremiah", "job", "kenneth", "lawrence", "leonard", "lucas",
  "maurice", "morris", "nelson", "oscar", "robert", "richard", "ronald", "sammy", "silas", "solomon",
  "timothy", "titus", "walter", "wilson", "elijah", "edwin", "emmanuel", "ezekiel", "abraham", "alex",
  "alexander", "amos", "bernard", "boniface", "cyrus", "dominic", "duncan", "elvis", "erastus", "gabriel",
  "mary", "jane", "anne", "ann", "grace", "faith", "joyce", "esther", "ruth", "sarah", "susan", "margaret",
  "elizabeth", "rose", "lucy", "catherine", "caroline", "agnes", "alice", "beatrice", "christine", "damaris",
  "dorcas", "eunice", "florence", "gladys", "hannah", "irene", "jacinta", "janet", "jennifer", "judith",
  "julia", "lydia", "magdalene", "mercy", "monica", "nancy", "naomi", "pauline", "purity", "rachel",
  "rebecca", "salome", "sharon", "stella", "teresia", "veronica", "winnie", "yvonne", "emily", "diana",
  "doreen", "edith", "everlyne", "evelyn", "felister", "hellen", "helen", "immaculate", "josephine", "linet",
  "loise", "lilian", "lillian", "maureen", "millicent", "miriam", "phyllis", "priscilla", "ritah", "rita",
  "tabitha", "violet", "zipporah", "wanjiku", "wambui", "wangari", "wairimu", "wanjiru", "njeri", "nyambura",
  "muthoni", "akinyi", "atieno", "adhiambo", "achieng", "awuor", "chebet", "jepchirchir", "kamau", "kiprop",
  "kipchoge", "mwende", "mutua", "nduta", "wangui", "waithera", "wacheera", "wawira", "fatuma", "amina",
  "aisha", "halima", "hassan", "ali", "abdi", "omar", "mohamed", "mohammed", "ahmed", "yusuf", "khadija",
  "zainab", "mwanaidi", "salim", "juma", "hamisi", "rashid",
]);

const FREE_MAIL_OR_ANY = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

const normalise = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Returns the given name to greet (e.g. "Peter"), or null when we can't be sure.
 * `schoolName` is optional and only used to refuse addresses that are really the school's name.
 */
export function nameFromEmail(email: string | null | undefined, schoolName?: string | null): string | null {
  const e = (email ?? "").trim();
  if (!FREE_MAIL_OR_ANY.test(e)) return null;

  // Drop plus-addressing (peter.kimani+school@gmail.com) and work on the local part only.
  const local = e.split("@")[0].split("+")[0].toLowerCase();
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length === 0 || parts.length > 2) return null;

  // Single word with digits (jmaina263, james2024) is a handle, not a name. For two parts a trailing
  // number on the last part is tolerated (peter.kimani2).
  const cleaned = parts.map((p, i) => (parts.length === 2 && i === 1 ? p.replace(/\d+$/, "") : p));
  if (cleaned.some((p) => !/^[a-z]{2,}$/.test(p))) return null;

  if (cleaned.some((p) => ROLE_WORDS.has(p))) return null;

  const school = normalise(schoolName ?? "");
  if (school && cleaned.some((p) => school.split(" ").includes(p) && !GIVEN_NAMES.has(p))) return null;
  if (school && normalise(cleaned.join(" ")) === school) return null;

  if (cleaned.length === 1) return GIVEN_NAMES.has(cleaned[0]) ? cap(cleaned[0]) : null;

  const [a, b] = cleaned;
  if (GIVEN_NAMES.has(a)) return cap(a); // first.last, or both look like given names: greet the first part
  if (GIVEN_NAMES.has(b)) return cap(b); // kimani.peter: the recognised given name is the second part
  return null; // neither part is a known given name: not sure
}

/** True when `candidate` (a contact name such as "Mrs Peter Kimani") contains `emailName` as one of its words. */
export function contactNameIncludes(candidate: string, emailName: string): boolean {
  return normalise(candidate).split(" ").includes(emailName.toLowerCase());
}
