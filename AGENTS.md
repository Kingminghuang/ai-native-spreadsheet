# Repository Instructions

## Design Principles

1. **Codex readability comes first.** Make code, names, files, and system boundaries easy for Codex and other agents to understand, navigate, and debug. When design choices conflict, prefer the option that makes the codebase clearer and bugs easier to locate. Refactor files, directories, or architecture when doing so improves that clarity.
2. **Design functionality as cohesive modules.** Give each module a clear responsibility and explicit interfaces so agents can understand and change parts of the system independently. Accept reasonable upfront structure to make the repository easier for all agents to understand, while keeping abstractions proportional to the functionality.

When implementing or reviewing an issue from the `ai-native-spreadsheet` Linear project:

1. Read [workflow.md](docs/workflow.md) and the issue's acceptance criteria.
2. Select and explicitly read the matching role instruction from [agents/README.md](agents/README.md). Role files are reusable prompts; they are not separate running agents and are not auto-loaded just because they exist in `agents/`.
3. Read the `docs/proposal.md` sections named by the issue and inspect the repository's current implementation before choosing technical details.
4. Keep the change within the selected issue's scope and coordinate with the roles listed in `docs/workflow.md` when crossing component boundaries.

The product source of truth is `docs/proposal.md`; `docs/workflow.md` defines the delivery sequence and handoffs; the Linear child issue defines the work and its acceptance criteria.
