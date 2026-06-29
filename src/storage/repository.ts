export interface Session {
  id: string;
  project: string;
  startedAt: number;
  endedAt: number;
  gitBranch: string;
  gitCommit: string;
  provider: string;
  model: string;
  transcriptPath: string;
  observationCount: number;
}

export interface Observation {
  id: string;
  sessionId: string;
  timestamp: number;
  type: "rule" | "lesson" | "decision" | "context";
  content: string;
  sourceQuote: string;
  confidence: "high" | "medium";
  project: string;
  scope: "global" | "project";
}

export interface KnowledgeItem {
  id: string;
  canonicalHash: string;
  type: "rule" | "lesson" | "decision" | "context";
  title: string;
  content: string;
  confidence: "low" | "medium" | "high";
  observationCount: number;
  authority: "AUTO" | "USER" | "SYSTEM";
  status: "active" | "deprecated" | "superseded" | "archived";
  supersededById?: string;
  enforce: boolean;
  project: string;
  scope: "global" | "project";
  createdAt: number;
  updatedAt: number;
  lastSeenAt: number;
  metadata: Record<string, unknown>;
}

export interface KnowledgeCluster {
  observationId: string;
  action: "CREATE" | "REINFORCE" | "SUPERSEDE" | "DEPRECATE" | "IGNORE";
  targetKnowledgeItemId?: string;
  reasoning: string;
}

export interface CompileRun {
  id: string;
  project: string;
  sessionId: string;
  compilerVersion: string;
  promptVersions: Record<string, string>;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  observationsProcessed: number;
  knowledgeCreated: number;
  knowledgeReinforced: number;
  knowledgeDeprecated: number;
  knowledgeSuperseded: number;
  knowledgeIgnored: number;
  contradictionsDetected: number;
  diagnostics: string;
}

export interface ContradictionReport {
  id: string;
  project: string;
  itemAId: string;
  itemBId: string;
  topic: string;
  description: string;
  recommendation: "keep_newer" | "keep_older" | "flag_for_user";
  resolved: boolean;
  createdAt: number;
}

export interface KnowledgeFilter {
  type?: KnowledgeItem["type"];
  status?: KnowledgeItem["status"];
  enforce?: boolean;
  authority?: KnowledgeItem["authority"];
}

export interface PendingTranscript {
  id: string;
  transcriptPath: string;
  project: string;
  projectRoot: string;
  provider: string;
  queuedAt: number;
}

export interface KnowledgeRepository {
  saveSession(session: Session): void;
  getSession(id: string): Session | null;
  updateSessionTranscriptPath(sessionId: string, transcriptPath: string): void;
  getCompiledTranscriptPaths(project: string): string[];
  getAllCompiledTranscriptPaths(): string[];

  saveObservation(obs: Observation): void;
  saveObservations(obs: Observation[]): void;
  getObservations(project: string, since?: number): Observation[];

  saveKnowledgeItem(item: KnowledgeItem): void;
  updateKnowledgeItem(id: string, patch: Partial<KnowledgeItem>): void;
  getKnowledgeItems(project: string, filter?: KnowledgeFilter): KnowledgeItem[];
  getKnowledgeItem(id: string): KnowledgeItem | null;
  getKnowledgeForContext(project: string, opts?: { userOnly?: boolean }): KnowledgeItem[];
  getEnforcedRules(project: string): KnowledgeItem[];

  saveCompileRun(run: CompileRun): void;
  getCompileRuns(project: string, limit?: number): CompileRun[];

  saveContradiction(report: ContradictionReport): void;
  getUnresolvedContradictions(project: string): ContradictionReport[];
  resolveContradiction(id: string): void;

  queueTranscript(entry: PendingTranscript): void;
  popPendingTranscript(): PendingTranscript | null;
  getPendingCount(): number;

  close(): void;
}
