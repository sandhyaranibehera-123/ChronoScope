# Architecture

> CHRONOSCOPE does not use complexity as a feature. Every distributed component exists because it demonstrates a specific consistency, reliability, causality, execution, or recovery property that can be measured and verified.

Start with `docs/spec/system-guarantees.md` for the frozen 25 rules, then:

- `database-ownership.md` — which engine owns what, and the exact read-side delivery contract.
- `id-semantics.md` — every identifier in the system and its scope.
- `timeline-semantics.md` — branching, `EffectiveHistory`, fork-base state.
- `invariant-enforcement.md` — invariant → concrete enforcement mechanism, one row each.
- `data-classification.md` — durability/truth/rebuildability per data store.
- `docs/reliability/failure-matrix.md` — failure scenario → expected result → recovery mechanism.
- `docs/adr/` — one decision record per major architectural choice, including why Kubernetes and Redis locks were deliberately excluded.
