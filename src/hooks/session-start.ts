import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import {
  findProjectRoot,
  getInjectedContextPath,
  getGeneratedDir,
  getPendingQueuePath,
  isLoopInitialized,
} from "../utils/paths.js";

export async function handleSessionStart(): Promise<void> {
  const projectRoot = findProjectRoot();
  if (!isLoopInitialized(projectRoot)) return;

  const outPath = getInjectedContextPath(projectRoot);
  mkdirSync(dirname(outPath), { recursive: true });

  const hasPending = existsSync(getPendingQueuePath(projectRoot));
  const generatedDir = getGeneratedDir(projectRoot);

  let content = "";

  if (hasPending) {
    content += "<!-- Loop: sessions pending compilation. Call loop_compile_extract to process. -->\n\n";
  }

  // Include existing compiled knowledge
  content += "## Compiled Knowledge\n\n";
  for (const file of ["RULES.md", "LESSONS.md", "DECISIONS.md", "CONTEXT.md"]) {
    const filePath = `${generatedDir}/${file}`;
    if (existsSync(filePath)) {
      const fileContent = readFileSync(filePath, "utf-8");
      const lines = fileContent.split("\n");
      const bodyStart = lines.findIndex((l) => l.startsWith("# "));
      if (bodyStart >= 0) {
        content += lines.slice(bodyStart).join("\n") + "\n\n";
      }
    }
  }

  writeFileSync(outPath, content.trim() + "\n", "utf-8");
}
