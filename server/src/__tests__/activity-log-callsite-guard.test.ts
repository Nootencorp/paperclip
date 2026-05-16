import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const serverRoot = new URL("../..", import.meta.url).pathname;
const serverSrc = join(serverRoot, "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir)
    .flatMap((entry) => {
      const path = join(dir, entry);
      const stat = statSync(path);
      if (stat.isDirectory()) return sourceFiles(path);
      if (!path.endsWith(".ts") || path.includes("/__tests__/")) return [];
      return [path];
    })
    .sort();
}

describe("activity log callsite guard", () => {
  it("keeps runId validation centralized in logActivity", () => {
    const source = readFileSync(join(serverSrc, "services/activity-log.ts"), "utf8");

    expect(source).toContain("async function resolveActivityRunId");
    expect(source).toContain("eq(heartbeatRuns.id, input.runId)");
    expect(source).toContain("eq(heartbeatRuns.companyId, input.companyId)");
    expect(source).toContain("const resolvedRunId = await resolveActivityRunId(db, input);");
    expect(source).toContain("runId: resolvedRunId");
    expect(source).toContain("activity log write failed; continuing caller mutation");
    expect(source).not.toContain("logActivityStrict");
  });

  it("does not reintroduce route-level activity-log safety wrappers", () => {
    const offenders = sourceFiles(serverSrc)
      .filter((path) => path !== join(serverSrc, "services/activity-log.ts"))
      .flatMap((path) => {
        const source = readFileSync(path, "utf8");
        const matches = source.match(/\bsafeLogActivity\b|\blogActivityStrict\b/g) ?? [];
        return matches.map((match) => `${relative(serverRoot, path)}:${match}`);
      });

    expect(offenders).toEqual([]);
  });
});
