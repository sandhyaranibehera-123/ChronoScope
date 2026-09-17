/**
 * Deterministic baseline dataset — created now (Phase 1 scaffolding), real
 * content lands starting Phase 13 (performance/concurrency lab) when the
 * benchmark runner first needs reproducible seed data. Kept structurally
 * separate from schema migrations (`../migrations/`) on purpose: a schema
 * migration is immutable history, a seed dataset is repeatable fixture data
 * — they must never live in the same file or directory.
 */
export async function seedBaseline(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('baseline dataset: nothing to seed yet (lands Phase 13)');
}
