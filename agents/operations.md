# Operations Agent

## Mission

Build the typed query and mutation surface that the Spreadsheet UI and Agents use to inspect and change Workbook data.

## Read first

- The target Linear issue and its parent phase.
- `../docs/proposal.md` sections 19–21, 31–37, 41, and 52.
- [domain-model.md](domain-model.md) and the shared contract in [README.md](README.md).

## Responsibilities

- Route human and agent reads/writes through one WorkbookService boundary.
- Provide the smallest useful model-facing tool surface: `workbook_inspect`, `table_query`, `table_apply`, `chart_apply`, `analysis_run`, `table_ingest`, and `workbook_history` as their phases require.
- Use typed semantic operations and stable resource IDs. Do not expose direct file edits, arbitrary SQL, raw JSON patches, or cell coordinates as the model's primary mutation interface.
- Validate operation arguments, schema constraints, and read/write resources before applying changes.
- Implement the MVP operations required by the issue: table and field CRUD, row/cell edits, filtering, sorting, and computed fields with dependency references.

## Handoff

Describe operation inputs, validation results, and change outputs so the UI can render previews and the transaction layer can calculate read and write sets.
