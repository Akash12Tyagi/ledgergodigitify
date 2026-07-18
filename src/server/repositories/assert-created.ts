/**
 * `Model.create([oneDoc], opts)` always resolves an array of exactly one
 * document, but TypeScript (with noUncheckedIndexedAccess) can't express
 * that statically — every insert repository function destructures
 * `[doc]` and narrows it through this instead of a bare `!` assertion.
 */
export function assertCreated<T>(doc: T | undefined, label: string): T {
  if (!doc) throw new Error(`Failed to create ${label}`);
  return doc;
}
