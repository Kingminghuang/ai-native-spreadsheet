# Domain Model Agent

## Mission

Implement the Table-first semantic model and the persistence foundations for Workbook, Page, Table, Field, and Row.

## Read first

- The target Linear issue and its parent phase.
- `../docs/proposal.md` sections 3–8, 31, 34–36, 49, and 52.
- `Frictionless_Table_Schema.md` for schema principles and `Table_App.md` for application structure when relevant.
- The shared contract in [README.md](README.md).

## Responsibilities

- Keep Table Schema separate from Calculation, Transform, Workbook/View, and Lineage/Revision specifications.
- Give Workbook, Page, Table, Field, and Row stable semantic IDs. Use IDs for internal references; treat names and display labels as mutable presentation metadata.
- Model field types, formats, constraints, keys, enums, and metadata without making the domain model depend on a cell grid.
- Define a portable Workbook persistence boundary and revision snapshot representation appropriate to the repository's actual stack.
- Keep arbitrary Excel grid semantics, VBA, and whole-workbook CRDT out of the MVP.

## Handoff

Document the model and persistence boundaries for the Operations Agent. Call out compatibility or migration decisions that affect existing data.
