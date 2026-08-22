/**
 * Request-scoped authentication context.
 *
 * API keys can carry a `permissions` object narrowing what the key may do —
 * the column exists, the create endpoint accepts it and the UI type declares
 * it — but nothing enforced it. `hasPermission` only ever received a userId,
 * so a key created as read-only silently acted with its owner's full rights.
 *
 * Threading the key's scope through all 161 `hasPermission(auth.userId, ...)`
 * call sites would touch nearly every route. Instead the scope is stashed in
 * an AsyncLocalStorage store when the request is authenticated, and read back
 * inside `hasPermission`.
 *
 * Safety note: `setAuthContext` is called on *every* authentication attempt,
 * including cookie/JWT sessions where it stores null. That matters — it means
 * a stale store can never survive into a later request and wrongly narrow (or
 * widen) an unrelated caller's permissions.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface AuthContext {
  /**
   * Permission scope of the API key used for this request, or null when the
   * caller authenticated with a session cookie (no additional narrowing).
   */
  keyPermissions: Record<string, boolean> | null;
  /** Id of the API key used, for logging. Null for cookie sessions. */
  keyId: number | null;
}

const storage = new AsyncLocalStorage<AuthContext>();

/**
 * Bind the authentication context to the current request.
 *
 * Uses `enterWith` rather than `run` because the caller (`getCurrentUser`) is
 * awaited from inside the route handler and must affect everything that
 * follows it, not just a nested callback.
 */
export function setAuthContext(ctx: AuthContext): void {
  storage.enterWith(ctx);
}

/** The current request's auth context, if one has been established. */
export function getAuthContext(): AuthContext | undefined {
  return storage.getStore();
}

/**
 * Narrow a permission decision by the active API key's scope.
 *
 * A key with no scope (null) is unrestricted and inherits whatever its owner
 * may do, which preserves the behaviour of every key issued before scopes
 * were enforced. A key *with* a scope may only do what it explicitly lists.
 */
export function allowedByKeyScope(permission: string): boolean {
  const ctx = storage.getStore();
  if (!ctx || ctx.keyPermissions === null) return true;
  return ctx.keyPermissions[permission] === true;
}

/** Run `fn` with an explicit context. Used by tests. */
export function withAuthContext<T>(ctx: AuthContext, fn: () => T): T {
  return storage.run(ctx, fn);
}
