import Database from "better-sqlite3";
import type {
  Session,
  Observation,
  KnowledgeItem,
  CompileRun,
  ContradictionReport,
  KnowledgeFilter,
  KnowledgeRepository,
  PendingTranscript,
} from "./repository.js";

export class SqliteKnowledgeRepository implements KnowledgeRepository {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER NOT NULL,
        git_branch TEXT,
        git_commit TEXT,
        provider TEXT NOT NULL DEFAULT 'claude',
        model TEXT NOT NULL,
        transcript_path TEXT NOT NULL,
        observation_count INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS observations (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        timestamp INTEGER NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        source_quote TEXT NOT NULL,
        confidence TEXT NOT NULL,
        project TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'project'
      );

      CREATE TABLE IF NOT EXISTS knowledge_items (
        id TEXT PRIMARY KEY,
        canonical_hash TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        confidence TEXT NOT NULL DEFAULT 'low',
        observation_count INTEGER NOT NULL DEFAULT 1,
        authority TEXT NOT NULL DEFAULT 'AUTO',
        status TEXT NOT NULL DEFAULT 'active',
        superseded_by_id TEXT,
        enforce INTEGER NOT NULL DEFAULT 0,
        project TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'project',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS compile_runs (
        id TEXT PRIMARY KEY,
        project TEXT NOT NULL,
        session_id TEXT REFERENCES sessions(id),
        compiler_version TEXT NOT NULL,
        prompt_versions TEXT NOT NULL DEFAULT '{}',
        started_at INTEGER NOT NULL,
        ended_at INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        observations_processed INTEGER NOT NULL DEFAULT 0,
        knowledge_created INTEGER NOT NULL DEFAULT 0,
        knowledge_reinforced INTEGER NOT NULL DEFAULT 0,
        knowledge_deprecated INTEGER NOT NULL DEFAULT 0,
        knowledge_superseded INTEGER NOT NULL DEFAULT 0,
        knowledge_ignored INTEGER NOT NULL DEFAULT 0,
        contradictions_detected INTEGER NOT NULL DEFAULT 0,
        diagnostics TEXT
      );

      CREATE TABLE IF NOT EXISTS contradictions (
        id TEXT PRIMARY KEY,
        project TEXT NOT NULL,
        item_a_id TEXT NOT NULL,
        item_b_id TEXT NOT NULL,
        topic TEXT NOT NULL,
        description TEXT NOT NULL,
        recommendation TEXT NOT NULL,
        resolved INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pending_transcripts (
        id TEXT PRIMARY KEY,
        transcript_path TEXT NOT NULL UNIQUE,
        project TEXT NOT NULL,
        project_root TEXT NOT NULL,
        provider TEXT NOT NULL,
        queued_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_observations_project ON observations(project);
      CREATE INDEX IF NOT EXISTS idx_observations_session ON observations(session_id);
      CREATE INDEX IF NOT EXISTS idx_knowledge_project ON knowledge_items(project);
      CREATE INDEX IF NOT EXISTS idx_knowledge_enforce ON knowledge_items(enforce);
      CREATE INDEX IF NOT EXISTS idx_knowledge_status ON knowledge_items(status);
      CREATE INDEX IF NOT EXISTS idx_ki_scope_status ON knowledge_items(scope, status);
      CREATE INDEX IF NOT EXISTS idx_ki_project_status ON knowledge_items(project, status);
      CREATE INDEX IF NOT EXISTS idx_compile_runs_project ON compile_runs(project);
      CREATE INDEX IF NOT EXISTS idx_contradictions_project ON contradictions(project, resolved);
    `);
  }

  saveSession(session: Session): void {
    this.db
      .prepare(
        `INSERT INTO sessions (id, project, started_at, ended_at, git_branch, git_commit, provider, model, transcript_path, observation_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        session.id,
        session.project,
        session.startedAt,
        session.endedAt,
        session.gitBranch,
        session.gitCommit,
        session.provider,
        session.model,
        session.transcriptPath,
        session.observationCount
      );
  }

  getSession(id: string): Session | null {
    const row = this.db
      .prepare("SELECT * FROM sessions WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapSession(row);
  }

  updateSessionTranscriptPath(sessionId: string, transcriptPath: string): void {
    this.db
      .prepare("UPDATE sessions SET transcript_path = ? WHERE id = ?")
      .run(transcriptPath, sessionId);
  }

  getCompiledTranscriptPaths(project: string): string[] {
    const rows = this.db
      .prepare("SELECT transcript_path FROM sessions WHERE project = ? AND transcript_path != ''")
      .all(project) as Array<{ transcript_path: string }>;
    return rows.map((r) => r.transcript_path);
  }

  getAllCompiledTranscriptPaths(): string[] {
    const rows = this.db
      .prepare("SELECT transcript_path FROM sessions WHERE transcript_path != ''")
      .all() as Array<{ transcript_path: string }>;
    return rows.map((r) => r.transcript_path);
  }

  saveObservation(obs: Observation): void {
    this.db
      .prepare(
        `INSERT INTO observations (id, session_id, timestamp, type, content, source_quote, confidence, project, scope)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        obs.id,
        obs.sessionId,
        obs.timestamp,
        obs.type,
        obs.content,
        obs.sourceQuote,
        obs.confidence,
        obs.project,
        obs.scope
      );
  }

  saveObservations(obs: Observation[]): void {
    const insert = this.db.prepare(
      `INSERT INTO observations (id, session_id, timestamp, type, content, source_quote, confidence, project, scope)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const transaction = this.db.transaction((observations: Observation[]) => {
      for (const o of observations) {
        insert.run(
          o.id,
          o.sessionId,
          o.timestamp,
          o.type,
          o.content,
          o.sourceQuote,
          o.confidence,
          o.project,
          o.scope
        );
      }
    });
    transaction(obs);
  }

  getObservations(project: string, since?: number): Observation[] {
    let sql = "SELECT * FROM observations WHERE project = ?";
    const params: unknown[] = [project];
    if (since !== undefined) {
      sql += " AND timestamp >= ?";
      params.push(since);
    }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((row) => this.mapObservation(row));
  }

  saveKnowledgeItem(item: KnowledgeItem): void {
    this.db
      .prepare(
        `INSERT INTO knowledge_items (id, canonical_hash, type, title, content, confidence, observation_count, authority, status, superseded_by_id, enforce, project, scope, created_at, updated_at, last_seen_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        item.id,
        item.canonicalHash,
        item.type,
        item.title,
        item.content,
        item.confidence,
        item.observationCount,
        item.authority,
        item.status,
        item.supersededById ?? null,
        item.enforce ? 1 : 0,
        item.project,
        item.scope,
        item.createdAt,
        item.updatedAt,
        item.lastSeenAt,
        JSON.stringify(item.metadata)
      );
  }

  updateKnowledgeItem(id: string, patch: Partial<KnowledgeItem>): void {
    const fieldMap: Record<string, string> = {
      canonicalHash: "canonical_hash",
      type: "type",
      title: "title",
      content: "content",
      confidence: "confidence",
      observationCount: "observation_count",
      authority: "authority",
      status: "status",
      supersededById: "superseded_by_id",
      enforce: "enforce",
      project: "project",
      scope: "scope",
      createdAt: "created_at",
      updatedAt: "updated_at",
      lastSeenAt: "last_seen_at",
      metadata: "metadata",
    };

    const setClauses: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(patch)) {
      const column = fieldMap[key];
      if (!column) continue;
      setClauses.push(`${column} = ?`);
      if (key === "enforce") {
        values.push(value ? 1 : 0);
      } else if (key === "metadata") {
        values.push(JSON.stringify(value));
      } else {
        values.push(value);
      }
    }

    if (setClauses.length === 0) return;

    values.push(id);
    this.db
      .prepare(`UPDATE knowledge_items SET ${setClauses.join(", ")} WHERE id = ?`)
      .run(...values);
  }

  getKnowledgeItems(project: string, filter?: KnowledgeFilter): KnowledgeItem[] {
    let sql = "SELECT * FROM knowledge_items WHERE project = ?";
    const params: unknown[] = [project];

    if (filter) {
      if (filter.type !== undefined) {
        sql += " AND type = ?";
        params.push(filter.type);
      }
      if (filter.status !== undefined) {
        sql += " AND status = ?";
        params.push(filter.status);
      }
      if (filter.enforce !== undefined) {
        sql += " AND enforce = ?";
        params.push(filter.enforce ? 1 : 0);
      }
      if (filter.authority !== undefined) {
        sql += " AND authority = ?";
        params.push(filter.authority);
      }
    }

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((row) => this.mapKnowledgeItem(row));
  }

  getKnowledgeItem(id: string): KnowledgeItem | null {
    const row = this.db
      .prepare("SELECT * FROM knowledge_items WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapKnowledgeItem(row);
  }

  getKnowledgeForContext(project: string, opts?: { userOnly?: boolean }): KnowledgeItem[] {
    // Run decay: archive AUTO items not seen in 30+ sessions (approx 30 days)
    const decayThreshold = Date.now() - 30 * 24 * 60 * 60 * 1000;
    this.db.prepare(
      `UPDATE knowledge_items SET status = 'archived', updated_at = ?
       WHERE status = 'active' AND authority = 'AUTO' AND last_seen_at < ?`
    ).run(Date.now(), decayThreshold);

    const authorityFilter = opts?.userOnly
      ? `AND authority = 'USER'`
      : `AND (authority = 'USER' OR observation_count >= 2)`;

    const rows = this.db
      .prepare(
        `SELECT * FROM knowledge_items WHERE status = 'active'
         AND (scope = 'global' OR project = ?)
         ${authorityFilter}
         ORDER BY
           CASE authority WHEN 'USER' THEN 0 ELSE 1 END,
           CASE confidence WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
           last_seen_at DESC
         LIMIT 50`
      )
      .all(project) as Record<string, unknown>[];
    return rows.map((row) => this.mapKnowledgeItem(row));
  }

  getEnforcedRules(project: string): KnowledgeItem[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM knowledge_items WHERE enforce = 1 AND status = 'active'
         AND (scope = 'global' OR project = ?)
         AND (authority = 'USER' OR observation_count >= 2)`
      )
      .all(project) as Record<string, unknown>[];
    return rows.map((row) => this.mapKnowledgeItem(row));
  }

  saveCompileRun(run: CompileRun): void {
    this.db
      .prepare(
        `INSERT INTO compile_runs (id, project, session_id, compiler_version, prompt_versions, started_at, ended_at, duration_ms, observations_processed, knowledge_created, knowledge_reinforced, knowledge_deprecated, knowledge_superseded, knowledge_ignored, contradictions_detected, diagnostics)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        run.id,
        run.project,
        run.sessionId,
        run.compilerVersion,
        JSON.stringify(run.promptVersions),
        run.startedAt,
        run.endedAt,
        run.durationMs,
        run.observationsProcessed,
        run.knowledgeCreated,
        run.knowledgeReinforced,
        run.knowledgeDeprecated,
        run.knowledgeSuperseded,
        run.knowledgeIgnored,
        run.contradictionsDetected,
        run.diagnostics
      );
  }

  getCompileRuns(project: string, limit?: number): CompileRun[] {
    let sql = "SELECT * FROM compile_runs WHERE project = ? ORDER BY started_at DESC";
    const params: unknown[] = [project];
    if (limit !== undefined) {
      sql += " LIMIT ?";
      params.push(limit);
    }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((row) => this.mapCompileRun(row));
  }

  saveContradiction(report: ContradictionReport): void {
    this.db
      .prepare(
        `INSERT INTO contradictions (id, project, item_a_id, item_b_id, topic, description, recommendation, resolved, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        report.id,
        report.project,
        report.itemAId,
        report.itemBId,
        report.topic,
        report.description,
        report.recommendation,
        report.resolved ? 1 : 0,
        report.createdAt
      );
  }

  getUnresolvedContradictions(project: string): ContradictionReport[] {
    const rows = this.db
      .prepare("SELECT * FROM contradictions WHERE project = ? AND resolved = 0")
      .all(project) as Record<string, unknown>[];
    return rows.map((row) => this.mapContradiction(row));
  }

  resolveContradiction(id: string): void {
    this.db.prepare("UPDATE contradictions SET resolved = 1 WHERE id = ?").run(id);
  }

  queueTranscript(entry: PendingTranscript): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO pending_transcripts (id, transcript_path, project, project_root, provider, queued_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(entry.id, entry.transcriptPath, entry.project, entry.projectRoot, entry.provider, entry.queuedAt);
  }

  popPendingTranscript(): PendingTranscript | null {
    const row = this.db
      .prepare("SELECT * FROM pending_transcripts ORDER BY queued_at ASC LIMIT 1")
      .get() as Record<string, unknown> | undefined;
    if (!row) return null;
    this.db.prepare("DELETE FROM pending_transcripts WHERE id = ?").run(row.id as string);
    return {
      id: row.id as string,
      transcriptPath: row.transcript_path as string,
      project: row.project as string,
      projectRoot: row.project_root as string,
      provider: row.provider as string,
      queuedAt: row.queued_at as number,
    };
  }

  getPendingCount(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) as count FROM pending_transcripts")
      .get() as { count: number };
    return row.count;
  }

  grandfatherExistingItems(): void {
    this.db.prepare(
      `UPDATE knowledge_items SET observation_count = 2 WHERE authority = 'AUTO' AND observation_count < 2 AND status = 'active'`
    ).run();
  }

  getQuarantinedItems(project?: string): KnowledgeItem[] {
    const sql = project
      ? `SELECT * FROM knowledge_items WHERE status = 'active' AND authority = 'AUTO' AND observation_count < 2 AND (scope = 'global' OR project = ?) ORDER BY created_at DESC`
      : `SELECT * FROM knowledge_items WHERE status = 'active' AND authority = 'AUTO' AND observation_count < 2 ORDER BY created_at DESC`;
    const rows = (project ? this.db.prepare(sql).all(project) : this.db.prepare(sql).all()) as Record<string, unknown>[];
    return rows.map((row) => this.mapKnowledgeItem(row));
  }

  promoteItem(id: string): void {
    this.db.prepare("UPDATE knowledge_items SET authority = 'USER', updated_at = ? WHERE id = ?").run(Date.now(), id);
  }

  getProjectStats(): { project: string; count: number }[] {
    return this.db
      .prepare("SELECT project, COUNT(*) as count FROM knowledge_items WHERE status = 'active' GROUP BY project ORDER BY count DESC")
      .all() as { project: string; count: number }[];
  }

  close(): void {
    this.db.close();
  }

  private mapSession(row: Record<string, unknown>): Session {
    return {
      id: row.id as string,
      project: row.project as string,
      startedAt: row.started_at as number,
      endedAt: row.ended_at as number,
      gitBranch: row.git_branch as string,
      gitCommit: row.git_commit as string,
      provider: row.provider as string,
      model: row.model as string,
      transcriptPath: row.transcript_path as string,
      observationCount: row.observation_count as number,
    };
  }

  private mapObservation(row: Record<string, unknown>): Observation {
    return {
      id: row.id as string,
      sessionId: row.session_id as string,
      timestamp: row.timestamp as number,
      type: row.type as Observation["type"],
      content: row.content as string,
      sourceQuote: row.source_quote as string,
      confidence: row.confidence as Observation["confidence"],
      project: row.project as string,
      scope: (row.scope as Observation["scope"]) || "project",
    };
  }

  private mapKnowledgeItem(row: Record<string, unknown>): KnowledgeItem {
    return {
      id: row.id as string,
      canonicalHash: row.canonical_hash as string,
      type: row.type as KnowledgeItem["type"],
      title: row.title as string,
      content: row.content as string,
      confidence: row.confidence as KnowledgeItem["confidence"],
      observationCount: row.observation_count as number,
      authority: row.authority as KnowledgeItem["authority"],
      status: row.status as KnowledgeItem["status"],
      supersededById: (row.superseded_by_id as string | null) ?? undefined,
      enforce: (row.enforce as number) === 1,
      project: row.project as string,
      scope: (row.scope as KnowledgeItem["scope"]) || "project",
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
      lastSeenAt: row.last_seen_at as number,
      metadata: JSON.parse(row.metadata as string),
    };
  }

  private mapCompileRun(row: Record<string, unknown>): CompileRun {
    return {
      id: row.id as string,
      project: row.project as string,
      sessionId: row.session_id as string,
      compilerVersion: row.compiler_version as string,
      promptVersions: JSON.parse(row.prompt_versions as string),
      startedAt: row.started_at as number,
      endedAt: row.ended_at as number,
      durationMs: row.duration_ms as number,
      observationsProcessed: row.observations_processed as number,
      knowledgeCreated: row.knowledge_created as number,
      knowledgeReinforced: row.knowledge_reinforced as number,
      knowledgeDeprecated: row.knowledge_deprecated as number,
      knowledgeSuperseded: row.knowledge_superseded as number,
      knowledgeIgnored: row.knowledge_ignored as number,
      contradictionsDetected: row.contradictions_detected as number,
      diagnostics: row.diagnostics as string,
    };
  }

  private mapContradiction(row: Record<string, unknown>): ContradictionReport {
    return {
      id: row.id as string,
      project: row.project as string,
      itemAId: row.item_a_id as string,
      itemBId: row.item_b_id as string,
      topic: row.topic as string,
      description: row.description as string,
      recommendation: row.recommendation as ContradictionReport["recommendation"],
      resolved: (row.resolved as number) === 1,
      createdAt: row.created_at as number,
    };
  }
}
