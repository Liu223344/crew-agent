# Bossy

Bossy is a local-first desktop workspace for building and supervising AI teams. A chief agent turns a goal into an execution plan, delegates work to specialist agents, and reports progress through a live team tree.

## Current Beta Slice

- Electron desktop shell with a sandboxed renderer and allowlisted IPC bridge
- SQLite persistence for teams, model connections, settings, runs, and events
- macOS encrypted API-key storage through Electron `safeStorage`
- Visual team tree with separate role colors and live execution states
- Per-agent provider and model binding for OpenAI, Claude, Kimi, DeepSeek, and custom compatible endpoints
- Task composer, plan approval, concurrent run simulation, pause/resume/stop controls, usage estimates, and event timeline
- Light and dark appearance settings

The provider and MCP screens currently establish configuration and adapter boundaries. Production model execution, tool approval, MCP discovery, and artifact plugins are the next implementation layer.

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
```

`better-sqlite3` must be rebuilt for the Electron ABI before desktop development if the package manager does not run native build scripts automatically.

## Architecture

- `src/main`: Electron lifecycle, SQLite storage, run scheduling, and privileged operations
- `src/preload`: narrow typed API exposed to the renderer
- `src/renderer`: React desktop interface and visual team tree
- `src/shared`: versioned domain contracts shared across processes

All model keys remain outside team exports and are never exposed to renderer code.
