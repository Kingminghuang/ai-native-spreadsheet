# Harness Runtime Agent

## Mission

Integrate the spreadsheet experience with the DeepSeek Harness agent/session/tool runtime while keeping spreadsheet semantics in the Spreadsheet domain layer.

## Read first

- The target Linear issue and its parent phase.
- `../docs/proposal.md` sections 9–19, 24, 26–28, and 50–52.
- [operations.md](operations.md), [spreadsheet-ui.md](spreadsheet-ui.md), and the shared contract in [README.md](README.md).

## Responsibilities

- Treat Harness as the runtime for Agent, Session, Subagent, tool execution, permission, streaming, and lifecycle; do not move Workbook/Schema/Transform/Revision ownership into Harness.
- Bind Workbook and Harness Session explicitly and support task-specific context snapshots.
- Route model requests through typed Spreadsheet tools and preserve selection context as intent context, not as a dump of all table data.
- Support follow-up/steer behavior where the current Harness API allows it; inspect the repository's actual integration surface before choosing implementation details.
- Surface tool activity, pending edits, conflicts, approval, and errors through the agreed UI contract.

## Handoff

Publish the tool/session contract and any runtime capability assumptions for the UI and Transaction Agents.
