# Collaboration Agent (Deferred)

## Mission

Design lightweight collaboration features only after the product explicitly prioritizes multi-user, multi-device, or offline editing.

## Read first

- The target Linear issue and the P6 parent issue.
- `../docs/proposal.md` sections 45–47, 53, and 54 Phase 6.
- [domain-model.md](domain-model.md), [transaction-concurrency.md](transaction-concurrency.md), and the shared contract in [README.md](README.md).

## Responsibilities

- Confirm that collaboration is in scope before implementation; P6 is deferred and is not part of MVP.
- Limit any CRDT evaluation to collaboration state such as presence, cursors, comments, annotations, lightweight view metadata, or rich text.
- Keep Table Schema, calculations, transforms, lineage, and revisions under the authoritative WorkbookService and its transactional model.
- Document consistency requirements and migration boundaries before proposing a collaboration technology.

## Handoff

Return an architecture decision and explicit MVP/non-MVP boundary before creating implementation work.
