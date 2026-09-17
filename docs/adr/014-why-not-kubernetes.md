# ADR-014: Why Kubernetes is not required

**Status**: Accepted

**Context**: CHRONOSCOPE's subject matter is distributed-systems *correctness properties* — consistency, concurrency, determinism, causality, delivery, failure, recovery — not container orchestration. A reviewer could reasonably ask "why isn't this on Kubernetes?"

**Decision**: Kubernetes is deliberately excluded. Docker Compose is sufficient to run every infrastructure dependency this project needs on a single development machine, and none of the project's actual experiments (event sourcing, replay, branching, chaos, recovery, performance) require multi-node orchestration to demonstrate. The architecture stays K8s-portable — nothing here assumes single-host networking or filesystem paths that would break in a cluster — but building K8s manifests now would be technology-collecting, not architecture.

**Consequences**: This is a deliberate scope decision, documented explicitly so it reads as a choice rather than an omission.
