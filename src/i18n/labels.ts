import type { StringKey } from './strings';

/**
 * Localised labels for values that arrive as STABLE CODES from the server.
 *
 * The rule this file exists to enforce: the database and the API traffic in
 * identifiers (`work_in_progress`, `Water Department`, `area_officer`), and
 * only the presentation layer turns them into words a person reads. Storing
 * "कार्य प्रगति पर" in a status column would make the language a property of
 * the RECORD rather than of the READER — two officers looking at the same
 * complaint would need two rows.
 *
 * Every helper here is deliberately total: an unrecognised code degrades to a
 * humanised version of the code itself rather than throwing or rendering
 * blank. A status this app has never heard of should still read as something,
 * because the alternative is an empty badge on a real person's complaint.
 */

type T = (key: StringKey, fallback?: string) => string;

/** `work_in_progress` → `Work In Progress`. The last-resort fallback. */
function humanise(code: string): string {
  return String(code || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Complaint workflow status.
 *
 * Callers previously rendered `complaint.statusLabel` — a string the SERVER
 * built from its own English table. That could never localise: the server
 * formats the label before it knows who is asking, and the citizen's language
 * lives in the browser. Passing the raw `status` code through here instead
 * moves the decision to the only place that has both pieces of information.
 */
export const statusLabel = (t: T, status: string): string =>
  t(`wf.${status}` as StringKey, humanise(status));

/**
 * Department name.
 *
 * Stored names are English prose ("Water Department"), not slugs, so this
 * slugifies before lookup rather than demanding a migration of live rows:
 * "Water Department" → `dept.water`. Anything unrecognised falls through to
 * the stored name, which is exactly what used to be displayed — so adding a
 * department cannot break the screen, it merely leaves that one name
 * untranslated until a key is added.
 */
export function departmentLabel(t: T, name?: string | null): string {
  if (!name) return '';
  const slug = String(name)
    .toLowerCase()
    .replace(/\b(department|board|services?)\b/g, '')
    .replace(/[^a-z]+/g, '')
    .trim();
  return t(`dept.${slug}` as StringKey, name);
}

/** Staff role, keyed on the RBAC role id from server/rbac.ts. */
export const roleLabel = (t: T, role?: string | null): string =>
  role ? t(`role.${role}` as StringKey, humanise(role)) : '';

/** Complaint priority. Stored capitalised ('High'), so key on it directly. */
export const priorityLabel = (t: T, priority?: string | null): string =>
  priority ? t(`priority.${priority}` as StringKey, priority) : '';

/*
 * NOTE: speech-recognition locale tags deliberately do NOT live here.
 * src/hooks/useVoice.ts already owns that mapping (SPEECH_TAGS/tagFor) and
 * wires it to both recognition and synthesis. A second copy in this file
 * would be a second source of truth for the same question, and the one that
 * drifts is always the one nobody is looking at.
 */
