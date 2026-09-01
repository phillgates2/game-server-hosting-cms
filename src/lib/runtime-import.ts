/**
 * Non-analyzable dynamic import.
 *
 * Turbopack's server build chokes when bundling gateway-style packages such
 * as discord.js (it can exhaust memory on small hosts). A variable
 * specifier keeps them out of the bundle entirely: the import is left in the
 * output and resolved by Node at runtime, exactly like a native module.
 *
 * Only use this for packages that are genuinely runtime-only and never part
 * of a route's chunk (the gateway bot and the wasm sqlite reader).
 */
export function runtimeImport<T = unknown>(specifier: string): Promise<T> {
  return import(specifier) as Promise<T>;
}
