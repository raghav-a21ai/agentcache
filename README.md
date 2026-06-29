# AgentCache

Your AI coding agents forget everything between sessions. AgentCache fixes that — it learns what you know, remembers it across sessions, and injects it into every future agent automatically, across every IDE.

> "Don't mock the database in integration tests — we got burned when mocked tests passed but prod migration failed"

That lesson, learned once, becomes a permanent rule. Every future session with every IDE gets it. You never say it again.

## What it does

AgentCache observes your coding sessions and compiles reusable knowledge — rules, lessons, architectural decisions, project context — into a local database. Every future session gets that knowledge injected at the start, regardless of IDE or LLM.

- **Learns** from what your agents discover during sessions
- **Injects** relevant knowledge at the start of every new session
- **Works everywhere** — any IDE, any LLM, simultaneously
- **Stays local** — SQLite on your machine, nothing leaves your disk

## Install

```bash
npm install -g agentcache
```

Done. Start a session in any IDE — AgentCache is already running.

No init. No setup. No config. The install:

1. Creates `~/.agentcache/agentcache.db`
2. Detects installed IDEs (Claude Code, Cursor, Roo Code, Windsurf, Continue, Codex)
3. Registers itself as an MCP server in each
4. Sets up Claude Code hooks for automatic transcript recovery
5. Spawns `compile-all` in background to process your existing transcript history

## Team knowledge — without a sync server

Compiled project knowledge is written to `<repo>/.agentcache/skills/project-knowledge/SKILL.md`. Commit it. Every teammate gets your team's accumulated decisions and context on clone, automatically picked up by any Agent Skills-compatible tool.

```markdown
## Decisions
- Using Drizzle ORM over Prisma for raw SQL escape hatches
- PostgreSQL for all persistent state, Redis for ephemeral cache only

## Current Context
- Migrating from REST to GraphQL, both coexist until Q3
```

No sync server. No accounts. Just git.

## How it works

```
┌────────────────────────────────────────────────────────────────────────┐
│                           Your Machine                                 │
│                                                                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │  Claude  │  │  Cursor  │  │   Roo    │  │  Codex   │  ...         │
│  │   Code   │  │          │  │   Code   │  │          │              │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘              │
│       └─────────────┴─────────────┴─────────────┘                     │
│                              │ MCP Protocol (stdio)                    │
│                 ┌────────────┴────────────┐                            │
│                 │  AgentCache MCP Server  │                            │
│                 └────────────┬────────────┘                            │
│                              │                                         │
│                    ┌─────────┴──────────┐                              │
│                    │  ~/.agentcache/    │                              │
│                    │  agentcache.db     │                              │
│                    │  (SQLite + WAL)    │                              │
│                    └────────────────────┘                              │
└────────────────────────────────────────────────────────────────────────┘
```

### The cycle

1. **Session starts** — agent calls `inject_context` → receives compiled rules, lessons, decisions
2. **During session** — agent calls `compile_submit` incrementally as it learns things
3. **Session ends** — observations are already saved. If the session terminates unexpectedly, transcript recovery handles it next time.

### Knowledge types

| Type | Scope | Example |
|------|-------|---------|
| Rule | Global | "Always use snake_case for database columns" |
| Lesson | Global | "Don't mock the database in integration tests — mocked tests passed but prod migration failed" |
| Decision | Project | "Using Drizzle ORM over Prisma because we need raw SQL escape hatches" |
| Context | Project | "Currently migrating from REST to GraphQL, both coexist" |

Rules and lessons are global — they apply to all your projects. Decisions and context are project-scoped.

## Security model

AgentCache creates a persistent feedback loop: agents write observations → observations compile into knowledge → knowledge injects into future sessions. This is the product's core value **and** its main attack surface. Both are the same thing.

### What the security model guarantees

- **Quarantine by default** — AUTO observations (agent-submitted) are never injected until confirmed across 2+ independent sessions. A single prompt-injected `compile_submit` call cannot poison your knowledge base — it lands in quarantine and requires independent reinforcement before it's ever served.
- **Enforced rules are human-only** — The enforce mechanism (which blocks agent tool calls) can only be set via CLI (`agentcache add-rule --enforce`). No MCP tool can create policy an agent is subject to.
- **Scope gate** — Agent-submitted observations are always project-scoped. Promotion to global scope requires explicit human action (USER authority). An agent cannot write a global rule.
- **Quarantine ≠ absent** — Quarantined items are captured and visible in `agentcache review`. They just don't inject. The review command is how you clear or promote them.

### What the security model does not guarantee

- `compile-all` processes raw transcripts that may contain injected content. Extraction prompt hardening raises the bar, but a sufficiently crafted transcript can still produce a quarantined (non-injecting) entry. Review your pending queue periodically.
- `locked` mode disables `compile_submit` entirely and requires human-triggered batch compilation. It reduces the attack surface significantly but `compile-all` against a poisoned transcript is still a vector.

### Security modes

Configure in `~/.agentcache/config.json`:

```json
{ "security": "auto" }
```

| Mode | Behavior | For |
|------|----------|-----|
| `auto` (default) | Quarantine — AUTO items inject after 2+ session confirmations | Solo devs, indie shops |
| `review` | All new items land in quarantine. Nothing injects until `agentcache review` approves it | BFSI, healthcare, regulated environments |
| `locked` | `compile_submit` disabled. Compile-all only, human-triggered batch review | Maximum control |

## CLI commands

```bash
agentcache status          # Knowledge stats for current project
agentcache doctor          # Diagnose installation problems
agentcache review          # List quarantined items, approve or reject
agentcache promote <id>    # Promote a single item past quarantine
agentcache add-rule "never commit secrets" --enforce  # Create enforced policy (human only)
agentcache add-rule "use tabs" --global              # Global rule across all projects
agentcache compile-all     # Batch-compile all unprocessed transcripts
agentcache setup           # Re-register with IDEs (only if postinstall failed)
```

## compile-all — batch compilation

Processes all pending transcripts without depending on active MCP sessions.

**LLM backend (first available wins):**

1. CLI tools with stored auth: `claude`, `codex`, `gemini`, `copilot`, `aider`, `goose`
2. Ollama at `localhost:11434`
3. `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`

**Triggers automatically:**

- After `npm install -g agentcache` (clears initial backlog)
- When pending transcripts exceed 20 (background janitor)
- Lockfile prevents concurrent runs

## MCP tools

| Tool | Purpose |
|------|---------|
| `inject_context` | Load compiled knowledge at session start |
| `compile_submit` | Submit observations incrementally during session |
| `compile_cluster` | Resolve clustering when observations overlap existing knowledge |
| `compile_extract` | Process queued transcripts from previous sessions |
| `enforce` | Check tool calls against enforced policy rules |
| `save_observation` | Save a permanent observation (USER authority, never auto-deprecated) |
| `get_knowledge` | Query the knowledge database |
| `deprecate_knowledge` | Mark knowledge as deprecated |

## How knowledge compiles

```
Observations (raw)
    │
    ▼
Extract → Normalize → Canonicalize → Cluster → Detect Contradictions → Compile
                                                                          │
                              ┌───────────────────────────────────────────┘
                              │
                         PENDING store
                              │
                    ┌─────────┴──────────┐
                    │                    │
              AUTO items           USER items
         (quarantine gate)      (inject immediately)
         2+ sessions before
            injection
```

**Two compilation paths:**

- **In-session** — agent processes extraction via MCP tools in your IDE
- **Batch** — `compile-all` runs independently, processes full backlog

**Two output formats:**

- **MCP injection** — structured context via `inject_context`
- **SKILL.md** — Agent Skills spec files auto-discovered by 38+ tools without MCP

## Design principles

**Zero config** — `npm install -g agentcache` is the only step. No dotfiles, no init, no config to maintain.

**Universal** — MCP is the only interface. Any IDE, any LLM. No IDE-specific code paths.

**Developer-scoped** — One database per developer, not per project. Global knowledge (rules, lessons) benefits all your projects. Project knowledge stays scoped.

**Resilient to abrupt exits** — Incremental submission + transcript recovery + pipe-independent compilation means knowledge survives crashes, ctrl-c, and MCP disconnects.

**Anti-bloat** — Confidence promotion, 30-day decay on unused items, budget caps (20 rules / 10 lessons / 10 decisions / 5 context per session), priority ranking.

## Supported IDEs

| IDE | MCP | Auto-Approve | Transcript Recovery | Hooks |
|-----|-----|-------------|-------------------|-------|
| Claude Code | Yes | Yes | Full (JSONL) | Stop, SessionStart, PreToolUse |
| Cursor | Yes | Yes | Incremental only | — |
| Roo Code | Yes | Yes | Full (JSON via compile-all) | — |
| Windsurf | Yes | Yes | Incremental only | — |
| Continue | Yes | Yes | Full (JSON) | — |
| Codex | Yes | Yes | Full (JSONL via compile-all) | — |
| Goose | — | — | Full (SQLite via compile-all) | — |
| Aider | Coming soon | | | |
| GitHub Copilot | Coming soon | | | |
| Zed AI | Coming soon | | | |

## Data storage

```
~/.agentcache/
├── agentcache.db                          # Knowledge, observations, sessions, pending queue
├── config.json                            # Security mode and settings
├── compile-all.lock                       # Prevents concurrent compilation
└── skills/developer-knowledge/SKILL.md    # Global skill (auto-generated)
```

No data leaves your machine. No network calls. No telemetry. No accounts.

### Project identity

Projects are identified by a hash of their full filesystem path. `/work/api` and `/personal/api` are different projects. Knowledge never leaks between same-named projects in different locations.

## Roadmap

- **Native plugins** — Marketplace listings and deeper UI integrations for all supported IDEs
- **Team knowledge sharing** — Share compiled knowledge across your team
- **Cloud sync** — Same developer, different machines, same knowledge
- **Analytics dashboard** — Compilation stats, knowledge growth, most-referenced rules

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
