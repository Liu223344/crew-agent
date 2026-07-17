# Bossy

Bossy is a local-first desktop workspace for building and supervising AI teams. A chief agent turns a goal into an execution plan, delegates work to specialist agents, and reports progress through a live team tree.

## Beta Capabilities

- Electron desktop shell with a sandboxed renderer and allowlisted IPC bridge
- SQLite persistence for teams, model/MCP connections, settings, plans, runs, approvals, messages, and events
- macOS encrypted API-key storage through Electron `safeStorage`
- Visual team tree with separate role colors and live execution states
- Per-agent provider and model binding for OpenAI, Claude, Kimi, DeepSeek, and custom compatible endpoints
- OpenAI Responses, Anthropic Messages, and OpenAI-compatible streaming adapters with model discovery and transient-error fallback
- Chief-generated, schema-validated task DAGs with approval before execution
- Dependency-aware concurrent scheduling, structured handoffs, live output, pause/resume/stop, task reassignment, and directed user messages
- Workspace-scoped file tools, cancellable terminal commands, public URL extraction, risk approvals, and path/symlink escape protection
- MCP stdio and Streamable HTTP connections through the official TypeScript SDK, with per-agent tool grants
- Token and user-maintained price tracking, task/agent budget pauses, crash recovery, and append-only run events
- Team import/export without secrets
- Simplified Chinese and English interfaces with light/dark/system appearance
- Unsigned Apple Silicon DMG and ZIP packaging

PPT, image, video, and other specialist workflows are provided through MCP servers or local tools in this Beta. Bossy does not yet include a native slide editor, video timeline, cloud sync, multi-user collaboration, or a plugin marketplace.

## Development

Bossy requires a current Node.js LTS release and pnpm.

```bash
pnpm install
pnpm dev
```

Type checking, tests, and production renderer build:

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm dist:mac
```

`better-sqlite3` must be rebuilt for the Electron ABI before desktop development if the package manager does not run native build scripts automatically.

The macOS Beta is unsigned. Gatekeeper may require using **Open** from Finder's context menu. Production distribution still needs an Apple Developer ID signature and notarization.

## Architecture

- `src/main`: Electron lifecycle, SQLite storage, provider/MCP adapters, run scheduling, and privileged tools
- `src/preload`: narrow typed API exposed to the renderer
- `src/renderer`: React desktop interface and visual team tree
- `src/shared`: versioned domain contracts shared across processes

All model keys remain outside team exports and are never exposed to renderer code.
