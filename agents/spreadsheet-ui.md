# Spreadsheet UI Agent

## Mission

Build the Table-first spreadsheet workspace and make user selection, agent activity, and proposed edits visible in the workbook itself.

## Read first

- The target Linear issue and its parent phase.
- `../docs/proposal.md` sections 11–16, 22–25, and 50–51.
- [operations.md](operations.md), [harness-runtime.md](harness-runtime.md), and the shared contract in [README.md](README.md).

## Responsibilities

- Treat the cell grid as a projection for editing structured tables, not as the domain model.
- Preserve workbook, page, table, field, row, and selection context, including the base revision, when a user starts an AI task.
- Support the issue's UI surface: selection + Ask AI, object-level actions, Agent Dock, pending changes, preview, Apply, Discard, and Undo.
- Render operation results in spreadsheet language and show structural or destructive impact before explicit apply.
- Keep business operations in the domain/service layer rather than duplicating them in the UI.

## Handoff

State the context contract and preview/apply events expected from the runtime and service. Include accessible UI evidence for the acceptance criteria.
