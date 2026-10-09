/**
 * Run an idempotent schema step once per process instead of on every request.
 *
 * Several request paths used to issue `CREATE TABLE IF NOT EXISTS` or
 * `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` before doing their real work.
 * Even when the object already exists, an ALTER takes an ACCESS EXCLUSIVE lock
 * on the table, so on a hot path (the 15-second status poll, every
 * authenticated request) it queues behind and blocks ordinary reads and
 * writes. The result is memoised here: success is cached for the life of the
 * process, and a failure clears the cache so the next call retries.
 */
export function oncePerProcess(step: () => Promise<void>): () => Promise<void> {
  let done: Promise<void> | null = null;
  return () => {
    if (!done) {
      done = step().catch((e: unknown) => {
        done = null; // let the next call retry
        throw e;
      });
    }
    return done;
  };
}
