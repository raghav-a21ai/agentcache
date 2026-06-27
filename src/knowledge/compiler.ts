import { randomUUID } from "crypto";
import type { KnowledgeRepository, CompileRun, Session } from "../storage/repository.js";
import type { TranscriptEvent } from "../utils/transcript.js";
import { extract, EXTRACT_PROMPT_VERSION } from "./passes/1-extractor.js";
import { normalize } from "./passes/2-normalizer.js";
import { canonicalize, computeCanonicalKey } from "./passes/3-canonicalizer.js";
import { cluster, CLUSTER_PROMPT_VERSION } from "./passes/4-clusterer.js";
import { detectContradictions, CONTRADICTION_PROMPT_VERSION } from "./passes/5-contradiction.js";
import { compileKnowledge } from "./passes/6-compile.js";
import { projectToMarkdown } from "./passes/7-projector.js";
import { getGitContext } from "../utils/git.js";
import { getGeneratedDir } from "../utils/paths.js";

export const COMPILER_VERSION = "0.1.0";

export interface CompilerInput {
  repo: KnowledgeRepository;
  events: TranscriptEvent[];
  sessionId: string;
  project: string;
  projectRoot: string;
  fromScratch?: boolean;
}

export interface CompilerDiagnostics {
  observationsExtracted: number;
  observationsNormalized: number;
  autoReinforced: number;
  needsClustering: number;
  knowledgeCreated: number;
  knowledgeReinforced: number;
  knowledgeSuperseded: number;
  knowledgeDeprecated: number;
  knowledgeIgnored: number;
  contradictionsDetected: number;
  durationMs: number;
  toString(): string;
}

export interface CompilerOutput {
  run: CompileRun;
  diagnostics: CompilerDiagnostics;
}

export async function runCompiler(input: CompilerInput): Promise<CompilerOutput> {
  const { repo, events, sessionId, project, projectRoot } = input;
  const startedAt = Date.now();

  const git = getGitContext(projectRoot);
  const session: Session = {
    id: sessionId,
    project,
    startedAt: startedAt - 60000,
    endedAt: startedAt,
    gitBranch: git.branch,
    gitCommit: git.commit,
    provider: "claude",
    model: "claude-sonnet-4-6",
    transcriptPath: "",
    observationCount: 0,
  };
  repo.saveSession(session);

  // Pass 1: Extract
  const rawObservations = await extract(events, sessionId, project);

  // Pass 2: Normalize
  const normalized = normalize(rawObservations);

  // Pass 3: Canonicalize
  const existingItems = repo.getKnowledgeItems(project, { status: "active" });
  const existingKeys = existingItems.map((i) => computeCanonicalKey(i.content));
  const canonicalized = canonicalize(normalized, existingKeys);

  // Handle auto-reinforced items
  for (const obs of canonicalized.autoReinforced) {
    const matchingItem = existingItems.find(
      (item) => computeCanonicalKey(item.content) === obs.canonicalKey
    );
    if (matchingItem) {
      const newCount = matchingItem.observationCount + 1;
      const confidence = newCount >= 7 ? "high" : newCount >= 3 ? "medium" : "low";
      repo.updateKnowledgeItem(matchingItem.id, {
        observationCount: newCount,
        lastSeenAt: Date.now(),
        updatedAt: Date.now(),
        confidence,
      });
    }
  }

  // Pass 4: Cluster
  const clusters = await cluster(canonicalized.needsClustering, existingItems);

  // Pass 5: Detect contradictions
  const contradictions = await detectContradictions(clusters, existingItems, project);
  for (const c of contradictions) {
    repo.saveContradiction(c);
  }

  // Pass 6: Compile
  const now = Date.now();
  const compiled = compileKnowledge(clusters, existingItems, canonicalized.needsClustering, project, now);

  // Persist results
  for (const item of compiled.created) {
    repo.saveKnowledgeItem(item);
  }
  for (const item of compiled.reinforced) {
    repo.updateKnowledgeItem(item.id, {
      observationCount: item.observationCount,
      lastSeenAt: item.lastSeenAt,
      updatedAt: item.updatedAt,
      confidence: item.confidence,
    });
  }
  for (const item of compiled.superseded) {
    repo.updateKnowledgeItem(item.id, {
      status: item.status,
      updatedAt: item.updatedAt,
      supersededById: item.supersededById,
    });
  }
  for (const item of compiled.deprecated) {
    repo.updateKnowledgeItem(item.id, {
      status: item.status,
      updatedAt: item.updatedAt,
    });
  }

  // Save observations
  repo.saveObservations(normalized);

  // Pass 7: Project to markdown
  const allItems = repo.getKnowledgeItems(project);
  projectToMarkdown(allItems, getGeneratedDir(projectRoot), COMPILER_VERSION);

  // Save compile run
  const endedAt = Date.now();
  const compileRun: CompileRun = {
    id: `cr_${randomUUID().slice(0, 8)}`,
    project,
    sessionId,
    compilerVersion: COMPILER_VERSION,
    promptVersions: {
      extract: EXTRACT_PROMPT_VERSION,
      cluster: CLUSTER_PROMPT_VERSION,
      contradiction: CONTRADICTION_PROMPT_VERSION,
    },
    startedAt,
    endedAt,
    durationMs: endedAt - startedAt,
    observationsProcessed: normalized.length,
    knowledgeCreated: compiled.created.length,
    knowledgeReinforced: compiled.reinforced.length + canonicalized.autoReinforced.length,
    knowledgeDeprecated: compiled.deprecated.length,
    knowledgeSuperseded: compiled.superseded.length,
    knowledgeIgnored: compiled.ignored,
    contradictionsDetected: contradictions.length,
    diagnostics: "",
  };

  const diagnostics: CompilerDiagnostics = {
    observationsExtracted: rawObservations.length,
    observationsNormalized: normalized.length,
    autoReinforced: canonicalized.autoReinforced.length,
    needsClustering: canonicalized.needsClustering.length,
    knowledgeCreated: compiled.created.length,
    knowledgeReinforced: compiled.reinforced.length + canonicalized.autoReinforced.length,
    knowledgeSuperseded: compiled.superseded.length,
    knowledgeDeprecated: compiled.deprecated.length,
    knowledgeIgnored: compiled.ignored,
    contradictionsDetected: contradictions.length,
    durationMs: endedAt - startedAt,
    toString() {
      return [
        `Loop Compiler  v${COMPILER_VERSION}  (prompts: ${EXTRACT_PROMPT_VERSION}, ${CLUSTER_PROMPT_VERSION}, ${CONTRADICTION_PROMPT_VERSION})`,
        `Project: ${project}  |  Session: ${sessionId}  |  Branch: ${git.branch}`,
        ``,
        `  ${this.observationsExtracted} observations extracted`,
        `  ${this.observationsExtracted - this.observationsNormalized} removed by normalization`,
        `  ${this.autoReinforced} canonicalized → auto-reinforced (no LLM needed)`,
        `  ${this.knowledgeCreated} new knowledge items`,
        `  ${this.knowledgeReinforced} reinforced`,
        `  ${this.knowledgeSuperseded} superseded`,
        `  ${this.knowledgeDeprecated} deprecated`,
        `  ${this.knowledgeIgnored} ignored`,
        contradictions.length > 0 ? `  ${contradictions.length} contradiction(s) detected ⚠` : "",
        ``,
        `  Duration: ${(this.durationMs / 1000).toFixed(1)}s`,
      ].filter(Boolean).join("\n");
    },
  };

  compileRun.diagnostics = diagnostics.toString();
  repo.saveCompileRun(compileRun);

  return { run: compileRun, diagnostics };
}
