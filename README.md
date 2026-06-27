# AgentCache

**Knowledge cache for AI coding agents** — learns how you work, remembers across sessions, works everywhere.

AgentCache observes your coding sessions and compiles reusable knowledge (rules, lessons, architectural decisions, context) into a local database. Every future session — regardless of IDE or LLM — gets the benefit of everything you've learned before.

## Why

Every AI coding session starts from zero. The agent doesn't know your team's conventions, past mistakes, or architectural decisions. You repeat yourself. Bugs recur. Context is lost.

AgentCache fixes this. It's a persistent knowledge layer that:
- **Learns** rules, lessons, and decisions from your sessions
- **Injects** relevant knowledge at the start of every new session
- **Works everywhere** — any IDE, any LLM, simultaneously
- **Stays local** — SQLite database on your machine, nothing leaves your disk

## Install

```bash
npm install -g agentcache
```

Done. Start a new session in any IDE. AgentCache is already running.

No `init`. No `setup`. No config. No second command. The install itself:
1. Creates `~/.agentcache/agentcache.db` (your knowledge store)
2. Detects installed IDEs (Claude Code, Cursor, Roo Code, Windsurf, Continue, Codex)
3. Registers itself as an MCP server in each
4. Sets up Claude Code hooks for automatic transcript recovery

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                        Your Machine                              │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │  Claude  │  │  Cursor  │  │   Roo    │  │  Codex   │  ...   │
│  │   Code   │  │          │  │   Code   │  │          │       │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘       │
│       │              │              │              │              │
│       └──────────────┴──────────────┴──────────────┘              │
│                              │                                    │
│                    MCP Protocol (stdio)                           │
│                              │                                    │
│                 ┌────────────┴────────────┐                      │
│                 │  AgentCache MCP Server   │                      │
│                 │   (agentcache serve)     │                      │
│                 └────────────┬────────────┘                      │
│                              │                                    │
│                    ┌─────────┴─────────┐                         │
│                    │ ~/.agentcache/     │                         │
│                    │  agentcache.db     │                         │
│                    │  (SQLite + WAL)    │                         │
│                    └───────────────────┘                         │
└─────────────────────────────────────────────────────────────────┘
```

### The Cycle

1. **Session starts** — agent calls `inject_context` → gets compiled rules, lessons, decisions
2. **During session** — agent calls `compile_submit` incrementally as it learns things
3. **Session ends** — knowledge is already saved. If agent didn't submit (abrupt exit), transcript recovery handles it next session.

### Knowledge Types

| Type | Scope | Example |
|------|-------|---------|
| **Rule** | Global | "Always use snake_case for database columns" |
| **Lesson** | Global | "Don't mock the database in integration tests — we got burned when mocked tests passed but prod migration failed" |
| **Decision** | Project | "Using Drizzle ORM over Prisma because we need raw SQL escape hatches" |
| **Context** | Project | "Currently migrating from REST to GraphQL, both coexist" |

Rules and lessons are **global** — they apply to all your projects. Decisions and context are **project-specific**.

## MCP Tools

AgentCache exposes 8 tools via the Model Context Protocol (prefixed as `mcp--agentcache--<tool>` in IDEs):

| Tool | Purpose |
|------|---------|
| `inject_context` | Load compiled knowledge at session start |
| `compile_submit` | Submit observations incrementally during session |
| `compile_cluster` | Resolve clustering when observations overlap existing knowledge |
| `compile_extract` | Process queued transcripts from previous sessions |
| `enforce` | Check tool calls against enforced policy rules |
| `save_observation` | Save a permanent observation (USER authority, never auto-deprecated) |
| `get_knowledge` | Query the knowledge database |
| `deprecate_knowledge` | Mark knowledge as deprecated when it's no longer valid |

## CLI Commands

```bash
agentcache status          # Show knowledge stats for current project
agentcache setup           # Re-register with IDEs (only if postinstall failed)
```

Internal commands (called by hooks automatically, never by users):
```bash
agentcache serve           # MCP server (IDEs spawn this)
agentcache compile-session # Stop hook
agentcache discover        # SessionStart hook
agentcache enforce         # PreToolUse hook
```

## Design Principles

### Zero Config

`npm install -g agentcache` is the only step. It detects your IDEs, registers itself, and starts working. No dotfiles in your project. No init commands. No config to maintain.

### Universal

AgentCache uses MCP (Model Context Protocol) as its only interface. Any IDE that supports MCP works. Any LLM — Claude, GPT, Gemini, Qwen, Llama — can use the tools. No IDE-specific code paths. No LLM-specific logic.

### Developer-Scoped

One database per developer (`~/.agentcache/agentcache.db`), not per project. Rules and lessons learned in one project benefit all your projects. Project-specific decisions stay scoped to their project.

### Resilient to Abrupt Exits

Sessions can end without warning (crash, ctrl-c, network drop). AgentCache handles this through:
- **Incremental submission** — observations are saved as they happen, not batched at the end
- **Transcript recovery** — for Claude Code and Continue, transcripts persist on disk and are compiled next session
- **Pending queue in SQLite** — concurrent access is safe, nothing lost to race conditions

### Anti-Bloat

AgentCache prevents knowledge from growing unbounded:
- **Confidence promotion** — observations need repeated confirmation before becoming high-confidence
- **Decay** — auto-compiled items not seen in 30 days get archived
- **Budget caps** — max 20 rules, 10 lessons, 10 decisions, 5 context items injected per session
- **Priority ranking** — USER authority first, then by confidence and recency

## Supported IDEs

| IDE | MCP | Auto-Approve | Transcript Recovery | Hooks |
|-----|-----|-------------|--------------------|----|
| Claude Code | Yes | Yes (automatic) | Full (JSONL) | Stop, SessionStart, PreToolUse |
| Cursor | Yes | Yes (automatic) | Incremental only | — |
| Roo Code | Yes | Yes (automatic) | Incremental only | — |
| Windsurf | Yes | Yes (automatic) | Incremental only | — |
| Continue | Yes | Yes (automatic) | Full (JSON) | — |
| Codex | Yes | Yes (automatic) | Incremental only | — |

All IDEs are fully auto-approved at install time — no manual steps required.

"Incremental only" means if the agent submits observations during the session, they're saved. If the session terminates before any submission, those observations are lost (no transcript access).

## Data Storage

All data lives in `~/.agentcache/agentcache.db` (SQLite with WAL mode for concurrent access).

```
~/.agentcache/
└── agentcache.db    # All knowledge, observations, sessions, pending queue
```

No data leaves your machine. No network calls. No telemetry. No accounts.

## How Knowledge Compiles

```
Observations (raw)
    │
    ▼
Extract → Normalize → Canonicalize → Cluster → Detect Contradictions → Compile
    │                                                                      │
    │  "Always use ESLint"                                                 │
    │  "Always use ESLint"  ──→  deduplicated, confidence promoted         │
    │  "Use Prettier not ESLint"  ──→  contradiction detected              │
    │                                                                      ▼
                                                            Knowledge Items (compiled)
                                                            - status: active/deprecated/superseded
                                                            - confidence: low/medium/high
                                                            - authority: AUTO/USER
```

The compiler is the LLM itself (the agent in your session). AgentCache provides extraction prompts and the agent processes them — no separate API keys or LLM calls needed.

## Project Identity

Projects are identified by a hash of their full filesystem path, not just the folder name. This means:
- `/work/api` and `/personal/api` are different projects
- Renaming a folder creates a new project identity
- Knowledge doesn't leak between same-named projects

## Roadmap

### More IDEs & Coding Agents

| Platform | Status |
|----------|--------|
| Claude Code | Supported |
| Cursor | Supported |
| Roo Code | Supported |
| Windsurf | Supported |
| Continue | Supported |
| Codex | Supported |
| Goose (Block) | Coming soon |
| Aider | Coming soon |
| GitHub Copilot | Coming soon |
| Zed AI | Coming soon |

Any tool that supports MCP can use AgentCache today via `agentcache serve`. Native integrations for the above are planned to ensure zero-config setup.

### Native Plugins

Marketplace listings and deeper UI integrations for all supported IDEs — surfacing knowledge inline, showing compilation status, and providing one-click management of rules and decisions.

### Team Knowledge Sharing

Share compiled knowledge across your team. Rules and lessons that work for one developer benefit everyone.

### Cloud Sync

Sync your knowledge database across machines. Same developer, different computers, same knowledge.

### Analytics Dashboard

Visibility into what AgentCache is learning — compilation stats, knowledge growth, most-referenced rules, and session coverage.

## Contributing

```bash
git clone https://github.com/raghav-a21ai/agentcache
cd agentcache
npm install
npm run build
npm test
```

## License

MIT
