/** Helpers for interpreting database driver errors uniformly across pg / pglite. */

/**
 * True for a Postgres unique-constraint violation (SQLSTATE 23505), however the driver
 * wraps it. node-postgres exposes `.code` directly; drizzle re-throws as a wrapper Error
 * whose original carries the code on `.cause`, so we check both. The message regex is a
 * last-resort fallback for drivers that surface neither.
 */
export function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string }; message?: string };
  const code = err?.code ?? err?.cause?.code;
  return code === "23505" || /duplicate key value|unique constraint/i.test(String(err?.message ?? ""));
}
