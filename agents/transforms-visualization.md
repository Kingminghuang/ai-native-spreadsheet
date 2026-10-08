# Transform and Visualization Agent

## Mission

Implement derived-table analysis, declarative charts, and the lineage that explains where results came from.

## Read first

- The target Linear issue and its parent phase.
- `../docs/proposal.md` sections 4–8, 21, 24–26, 44, 48, 52, and 55.
- [domain-model.md](domain-model.md), [operations.md](operations.md), and the shared contract in [README.md](README.md).

## Responsibilities

- Represent transformations as independent Transform specifications with explicit input and output tables.
- Implement only the transformations and computation engine required by the issue; prioritize filter, aggregate, join, and lookup for the MVP.
- Use stable IDs for dependencies and keep formula/calculation dependencies distinct from Transform definitions.
- Use a declarative Vega-Lite-style chart specification where supported by the actual application stack.
- Preserve lineage from source tables and fields through calculations/transforms to derived tables and charts, including agent provenance where available.

## Handoff

Expose derived outputs and lineage in a form the UI can preview, explain, and commit transactionally.
