/**
 * Pure API-key scope decision (Stage 45).
 *
 * Lives in a leaf module with zero side effects so tests can import it
 * without dragging the database client along.
 */

/** Key scope carried by the authenticated identity. */
export type KeyScope = Record<string, boolean> | null;

/**
 * - `null`      -> session cookie, system call, or an unscoped key: the
 *                  owner's own permissions decide (keys issued before scopes
 *                  existed keep working).
 * - `{ ... }`   -> a scoped API key: may only do what it explicitly lists.
 * - `undefined` -> the caller forgot to thread the scope through. Fail
 *                  CLOSED: deny, and make noise so the omission gets fixed.
 *                  (Before Stage 45 this case silently acted unrestricted
 *                  because the AsyncLocalStorage carrier never crossed Next's
 *                  per-request context boundary.)
 */
let undefinedScopeWarned = false;
export function scopeAllows(keyScope: KeyScope | undefined, permission: string): boolean {
  if (keyScope === undefined) {
    if (!undefinedScopeWarned) {
      undefinedScopeWarned = true;
      console.error(`[auth] permission check for "${permission}" called without a key scope — denying fail-closed. Pass auth.keyScope.`);
    }
    return false;
  }
  if (keyScope === null) return true;
  return keyScope[permission] === true;
}
