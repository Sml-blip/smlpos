/**
 * Merge IPC payload with SQL bind defaults so better-sqlite3 never throws
 * "Missing named parameter" when optional fields are omitted from the renderer.
 */
export function bindRow<T extends Record<string, unknown>>(
  defaults: T,
  row: Record<string, unknown>
): T {
  return { ...defaults, ...row }
}
