# Codex Agent Instructions

These Markdown files are reusable role instructions for Codex when implementing issues in the `ai-native-spreadsheet` Linear project. They define specialist responsibilities and handoffs; they do not represent separate running agents or assign work by themselves.

## Shared working contract

For every issue:

1. Read the Linear issue and its acceptance criteria, then read the linked sections of [proposal.md](../docs/proposal.md) and the matching instruction below.
2. Inspect the current repository before making changes. The repository currently contains product specifications; do not assume an implementation stack that is not present.
3. Keep changes within the issue scope. Preserve the Table-first semantic model and coordinate with neighboring roles when a change crosses a boundary.
4. Report the implementation, files changed, acceptance evidence, checks performed, and any open questions or follow-up work. Do not mark a Linear issue complete unless asked to manage its status.

## Role instructions

| Role | Instruction | Main phase |
| - | - | - |
| Domain Model Agent | [domain-model.md](domain-model.md) | P1 |
| Operations Agent | [operations.md](operations.md) | P2 |
| Spreadsheet UI Agent | [spreadsheet-ui.md](spreadsheet-ui.md) | P3 |
| Harness Runtime Agent | [harness-runtime.md](harness-runtime.md) | P3 |
| Transform and Visualization Agent | [transforms-visualization.md](transforms-visualization.md) | P4 |
| Transaction and Concurrency Agent | [transaction-concurrency.md](transaction-concurrency.md) | P5 |
| Integration and Review Agent | [integration-review.md](integration-review.md) | Cross-phase |
| Collaboration Agent | [collaboration.md](collaboration.md) | P6, deferred |
