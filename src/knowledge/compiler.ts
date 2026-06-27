import { randomUUID } from "crypto";
import type { KnowledgeRepository, CompileRun, Session } from "../storage/repository.js";
import type { TranscriptEvent } from "../utils/transcript.js";
import { buildExtractionPrompt, parseExtractionResponse, EXTRACT_PROMPT_VERSION } from "./passes/1-extractor.js";
import { normalize } from "./passes/2-normalizer.js";
import { canonicalize, computeCanonicalKey } from "./passes/3-canonicalizer.js";
import { buildClusteringPrompt, parseClusteringResponse, CLUSTER_PROMPT_VERSION, type KnowledgeCluster } from "./passes/4-clusterer.js";
import { CONTRADICTION_PROMPT_VERSION } from "./passes/5-contradiction.js";
import { compileKnowledge } from "./passes/6-compile.js";
import { projectToMarkdown } from "./passes/7-projector.js";
import { getGitContext } from "../utils/git.js";
import { getGeneratedDir } from "../utils/paths.js";

export const COMPILER_VERSION = "0.1.0";

export interface ExtractionState {
  sessionId: string;
  project: string;
  projectRoot: string;
  prompt: string;
}

export type ExtractionResult = {
  status: "needs_clustering";
  clusteringPrompt: string;
  sessionId: string;
} | {
  status: "complete";
  diagnostics: string;
}

export interface ClusteringResult {
  status: "complete";
  diagnostics: string;
}

// Step 1: Build extraction prompt from transcript
export function startCompile(
  events: TranscriptEvent[],
  sessionId: string,
  project: string,
  projectRoot: string,
  repo: KnowledgeRepository
): ExtractionState {
  const git = getGitContext(projectRoot);
  const session: Session = {
    id: sessionId,
    project,
    startedAt: Date.now() - 60000,
    endedAt: Date.now(),
    gitBranch: git.branch,
    gitCommit: git.commit,
    provider: "agent",
    model: "host-agent",
    transcriptPath: "",
    observationCount: 0,
  };
  repo.saveSession(session);

  const prompt = buildExtractionPrompt(events);
  return { sessionId, project, projectRoot, prompt };
}

// Step 2: Process extraction response, run passes 2-3, determine if clustering needed
export function processExtraction(
  repo: KnowledgeRepository,
  responseText: string,
  sessionId: string,
  project: string,
  projectRoot: string
): ExtractionResult {
  const rawObservations = parseExtractionResponse(responseText, sessionId, project);
  const normalized = normalize(rawObservations);

  // Pass 3: Canonicalize
  const existingItems = repo.getKnowledgeItems(project, { status: "active" });
  const existingKeys = existingItems.map((i) => computeCanonicalKey(i.content));
  const canonicalized = canonicalize(normalized, existingKeys);

  // Handle auto-reinforced
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

  // Save observations
  repo.saveObservations(normalized);

  if (canonicalized.needsClustering.length === 0) {
    projectToMarkdown(repo.getKnowledgeItems(project), getGeneratedDir(projectRoot), COMPILER_VERSION);
    saveCompileRun(repo, sessionId, project, normalized.length, canonicalized.autoReinforced.length, 0, 0, 0, 0, 0, Date.now());
    return {
      status: "complete",
      diagnostics: formatDiagnostics(normalized.length, canonicalized.autoReinforced.length, 0, 0, 0, 0, 0, project, sessionId),
    };
  }

  // Need clustering
  const clusteringPrompt = buildClusteringPrompt(canonicalized.needsClustering, existingItems);

  return {
    status: "needs_clustering",
    clusteringPrompt,
    sessionId,
  };
}

// Step 3: Process clustering response, run passes 5-6-7
export function processClustering(
  repo: KnowledgeRepository,
  responseText: string,
  sessionId: string,
  project: string,
  projectRoot: string
): ClusteringResult {
  const startedAt = Date.now();

  const existingItems = repo.getKnowledgeItems(project, { status: "active" });
  const observations = repo.getObservations(project);

  // Reconstruct canonicalized observations from stored ones for this session
  const sessionObs = observations.filter((o) => o.sessionId === sessionId);
  const canonicalized = canonicalize(sessionObs);
  const needsClustering = canonicalized.needsClustering;

  const clusters = parseClusteringResponse(responseText, needsClustering);

  // Pass 5: Handle contradictions locally for supersedes
  const contradictions: any[] = [];
  const supersedeActions = clusters.filter((c) => c.action === "SUPERSEDE");
  for (const s of supersedeActions) {
    if (s.targetKnowledgeItemId) {
      const target = existingItems.find((i) => i.id === s.targetKnowledgeItemId);
      if (target) {
        contradictions.push({
          id: `con_${randomUUID().slice(0, 8)}`,
          project,
          itemAId: target.id,
          itemBId: s.observationId,
          topic: target.title.slice(0, 50),
          description: `"${target.content}" superseded by new observation`,
          recommendation: "keep_newer" as const,
          resolved: false,
          createdAt: Date.now(),
        });
      }
    }
  }
  for (const c of contradictions) {
    repo.saveContradiction(c);
  }

  // Pass 6: Compile
  const now = Date.now();
  const compiled = compileKnowledge(clusters, existingItems, needsClustering, project, now);

  for (const item of compiled.created) repo.saveKnowledgeItem(item);
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
    repo.updateKnowledgeItem(item.id, { status: item.status, updatedAt: item.updatedAt });
  }

  // Pass 7: Project
  projectToMarkdown(repo.getKnowledgeItems(project), getGeneratedDir(projectRoot), COMPILER_VERSION);

  // Save compile run
  const totalObs = sessionObs.length;
  saveCompileRun(repo, sessionId, project, totalObs, 0, compiled.created.length, compiled.reinforced.length, compiled.superseded.length, compiled.deprecated.length, compiled.ignored, startedAt);

  return {
    status: "complete",
    diagnostics: formatDiagnostics(totalObs, 0, compiled.created.length, compiled.reinforced.length, compiled.superseded.length, compiled.deprecated.length, compiled.ignored, project, sessionId),
  };
}

function saveCompileRun(
  repo: KnowledgeRepository,
  sessionId: string,
  project: string,
  observationsProcessed: number,
  autoReinforced: number,
  created: number,
  reinforced: number,
  superseded: number,
  deprecated: number,
  ignored: number,
  startedAt: number
): void {
  const endedAt = Date.now();
  const run: CompileRun = {
    id: `cr_${randomUUID().slice(0, 8)}`,
    project,
    sessionId,
    compilerVersion: COMPILER_VERSION,
    promptVersions: { extract: EXTRACT_PROMPT_VERSION, cluster: CLUSTER_PROMPT_VERSION, contradiction: CONTRADICTION_PROMPT_VERSION },
    startedAt,
    endedAt,
    durationMs: endedAt - startedAt,
    observationsProcessed,
    knowledgeCreated: created,
    knowledgeReinforced: reinforced + autoReinforced,
    knowledgeDeprecated: deprecated,
    knowledgeSuperseded: superseded,
    knowledgeIgnored: ignored,
    contradictionsDetected: 0,
    diagnostics: "",
  };
  repo.saveCompileRun(run);
}

function formatDiagnostics(
  extracted: number,
  autoReinforced: number,
  created: number,
  reinforced: number,
  superseded: number,
  deprecated: number,
  ignored: number,
  project: string,
  sessionId: string
): string {
  return [
    `Loop Compiler v${COMPILER_VERSION}`,
    `Project: ${project} | Session: ${sessionId}`,
    `  ${extracted} observations processed`,
    autoReinforced > 0 ? `  ${autoReinforced} auto-reinforced (no LLM needed)` : "",
    `  ${created} new knowledge items`,
    `  ${reinforced} reinforced`,
    superseded > 0 ? `  ${superseded} superseded` : "",
    deprecated > 0 ? `  ${deprecated} deprecated` : "",
    ignored > 0 ? `  ${ignored} ignored` : "",
  ].filter(Boolean).join("\n");
}
