/**
 * Typed MySQL error inspection.
 *
 * Every `UNIQUE KEY` this project defines (from Phase 3 onward) is given an
 * explicit name specifically so a duplicate-key violation's error message —
 * which MySQL formats as `Duplicate entry '...' for key 'table.key_name'` —
 * can be parsed to tell "a genuine OCC conflict" apart from "an unrelated
 * duplicate-event-id" from the SAME generic errno (1062/ER_DUP_ENTRY).
 * That distinction is exactly why this module exists this early, even
 * though Phase 1 has no domain tables yet to raise it against.
 */

export const MYSQL_ER_DUP_ENTRY = 1062;

export interface MysqlErrorLike {
  code?: string;
  errno?: number;
  message?: string;
  sqlMessage?: string;
}

export function isDuplicateEntryError(error: unknown): error is MysqlErrorLike {
  const err = error as MysqlErrorLike | undefined;
  return err?.errno === MYSQL_ER_DUP_ENTRY || err?.code === 'ER_DUP_ENTRY';
}

/**
 * Extracts the `key_name` from a MySQL duplicate-entry message of the form
 * `Duplicate entry '...' for key 'table.key_name'` (MySQL 8.0+ names the key
 * with its table qualifier). Returns null if the message doesn't match —
 * callers must not assume a match.
 */
export function extractDuplicateKeyName(error: unknown): string | null {
  if (!isDuplicateEntryError(error)) return null;
  const message = (error as MysqlErrorLike).sqlMessage ?? (error as MysqlErrorLike).message ?? '';
  const match = message.match(/for key '([^']+)'/);
  return match?.[1] ?? null;
}
