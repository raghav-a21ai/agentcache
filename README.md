# Loop

**Engineering Knowledge Compiler** — learns how you work, remembers across sessions, works everywhere.

Loop observes your coding sessions and compiles reusable knowledge (rules, lessons, architectural decisions, context) into a local database. Every future session — regardless of IDE or LLM — gets the benefit of everything you've learned before.

## Why

Every AI coding session starts from zero. The agent doesn't know your team's conventions, past mistakes, or architectural decisions. You repeat yourself. Bugs recur. Context is lost.

Loop fixes this. It's a personal engineering memory that:
- **Learns** rules, lessons, and decisions from your sessions
- **Injects** relevant knowledge at the start of every new session
- **Works everywhere** — any IDE, any LLM, simultaneously
- **Stays local** — SQLite database on your machine, nothing leaves your disk

## Install

```bash
npm install -g loop-eng
```

That's it. No `init`, no per-project setup, no config files.

On install, Loop automatically:
1. Creates `~/.loop/loop.db` (your knowledge store)
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
│                    ┌─────────┴─────────┐                         │
│                    │   Loop MCP Server  │                         │
│                    │   (loop-eng serve) │                         │
│                    └─────────┬─────────┘                         │
│                              │                                    │
│                    ┌─────────┴─────────┐                         │
│                    │  ~/.loop/loop.db   │                         │
│                    │  (SQLite + WAL)    │                         │
│                    └───────────────────┘                         │
└─────────────────────────────────────────────────────────────────┘
```

### The Loop

1. **Session starts** — agent calls `loop_inject_context` → gets compiled rules, lessons, decisions
2. **During session** — agent calls `loop_compile_submit` incrementally as it learns things
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

Loop exposes 8 tools via the Model Context Protocol:

| Tool | Purpose |
|------|---------|
| `loop_inject_context` | Load compiled knowledge at session start |
| `loop_compile_submit` | Submit observations incrementally during session |
| `loop_compile_cluster` | Resolve clustering when observations overlap existing knowledge |
| `loop_compile_extract` | Process queued transcripts from previous sessions |
| `loop_enforce` | Check tool calls against enforced policy rules |
| `loop_save_observation` | Save a permanent observation (USER authority, never auto-deprecated) |
| `loop_get_knowledge` | Query the knowledge database |
| `loop_deprecate_knowledge` | Mark knowledge as deprecated when it's no longer valid |

## CLI Commands

```bash
loop-eng setup           # Re-detect IDEs and register (runs automatically on install)
loop-eng serve           # Start MCP server (IDEs spawn this automatically)
loop-eng status          # Show knowledge stats for current project
loop-eng compile-session # Queue transcript for compilation (Stop hook)
loop-eng discover        # Discover uncompiled transcripts (SessionStart hook)
loop-eng enforce         # Policy enforcement (PreToolUse hook)
```

## Design Principles

### Zero Config

`npm install -g` is the only step. Loop detects your IDEs, registers itself, and starts working. No dotfiles in your project. No init commands. No config to maintain.

### Universal

Loop uses MCP (Model Context Protocol) as its only interface. Any IDE that supports MCP works with Loop. Any LLM — Claude, GPT, Gemini, Qwen, Llama — can use Loop's tools. No IDE-specific code paths. No LLM-specific logic.

### Developer-Scoped

One database per developer (`~/.loop/loop.db`), not per project. Rules and lessons learned in one project benefit all your projects. Project-specific decisions stay scoped to their project.

### Resilient to Abrupt Exits

Sessions can end without warning (crash, ctrl-c, network drop). Loop handles this through:
- **Incremental submission** — observations are saved as they happen, not batched at the end
- **Transcript recovery** — for Claude Code and Continue, transcripts persist on disk and are compiled next session
- **Pending queue in SQLite** — concurrent access is safe, nothing lost to race conditions

### Anti-Overengineering

Loop prevents knowledge bloat:
- **Confidence promotion** — observations need repeated confirmation before becoming high-confidence
- **Decay** — auto-compiled items not seen in 30 days get archived
- **Budget caps** — max 20 rules, 10 lessons, 10 decisions, 5 context items injected per session
- **Priority ranking** — USER authority first, then by confidence and recency

## Supported IDEs

| IDE | MCP | Transcript Recovery | Hooks |
|-----|-----|--------------------|----|
| Claude Code | Yes | Full (JSONL) | Stop, SessionStart, PreToolUse |
| Cursor | Yes | Incremental only | — |
| Roo Code | Yes | Incremental only | — |
| Windsurf | Yes | Incremental only | — |
| Continue | Yes | Full (JSON) | — |
| Codex | Yes | Incremental only | — |

"Incremental only" means if the agent submits observations during the session, they're saved. If the session terminates before any submission, those observations are lost (no transcript access).

## Data Storage

All data lives in `~/.loop/loop.db` (SQLite with WAL mode for concurrent access).

```
~/.loop/
└── loop.db          # All knowledge, observations, sessions, pending queue
```

No data leaves your machine. No network calls. No telemetry. No accounts.

## How Knowledge Compiles

```
Observations (raw)
    │
    ▼
Extract → Normalize → Canonicalize → Cluster → Detect Contradictions → Compile → Project
    │                                                                              │
    │  "Always use ESLint"                                                         │
    │  "Always use ESLint"  ──→  deduplicated, confidence promoted                 │
    │  "Use Prettier not ESLint"  ──→  contradiction detected                      │
    │                                                                              ▼
                                                                    Knowledge Items (compiled)
                                                                    - status: active/deprecated/superseded
                                                                    - confidence: low/medium/high
                                                                    - authority: AUTO/USER
```

The compiler is the LLM itself (the agent in your session). Loop provides extraction prompts and the agent processes them — no separate API keys or LLM calls needed.

## Project Identity

Projects are identified by a hash of their full filesystem path, not just the folder name. This means:
- `/work/api` and `/personal/api` are different projects
- Renaming a folder creates a new project identity
- Knowledge doesn't leak between same-named projects

## Contributing

```bash
git clone https://github.com/raghav-a21ai/loop-eng
cd loop-eng
npm install
npm run build
npm test
```

## License

MIT
