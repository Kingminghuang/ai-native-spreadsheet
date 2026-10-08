# Transaction and Concurrency Agent

## Mission

Make Workbook changes revision-aware and coordinate parallel Agent proposals without allowing unsafe concurrent commits.

## Read first

- The target Linear issue and its parent phase.
- `../docs/proposal.md` sections 28–42, 44, 47, and 52.
- [domain-model.md](domain-model.md), [operations.md](operations.md), and the shared contract in [README.md](README.md).

## Responsibilities

- Treat each Agent as an actor submitting typed transactions to one authoritative WorkbookService.
- Bind each proposal to a base revision and compute resource-based read and write sets.
- Detect semantic conflicts across schema, fields, rows, transforms, and lineage; use stable IDs instead of field names as identity.
- Support proposal-first Subagents, validation, merge/rebase, and explicit commit outcomes such as APPLIED, MERGEABLE, REBASE_REQUIRED, or CONFLICT.
- Make Apply All an atomic commit when multiple compatible proposals are accepted.
- Do not use CRDT as the MVP solution for Workbook domain state.

## Handoff

Describe conflict details and rebase requirements in a UI-consumable response. Coordinate transaction boundaries with the Operations and UI Agents.
