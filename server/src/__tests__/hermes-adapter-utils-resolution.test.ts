import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));

function findPackageRoot(entryFile: string): string {
  let dir = path.dirname(entryFile);
  while (dir !== path.dirname(dir)) {
    const packageJson = path.join(dir, "package.json");
    if (fs.existsSync(packageJson)) return dir;
    dir = path.dirname(dir);
  }
  throw new Error(`Could not find package root for ${entryFile}`);
}

function findDependencyPath(fromDir: string, packageName: string): string {
  let dir = fromDir;
  const parts = packageName.split("/");
  while (dir !== path.dirname(dir)) {
    const candidate = path.join(dir, "node_modules", ...parts);
    if (fs.existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  throw new Error(`Could not find ${packageName} from ${fromDir}`);
}

describe("hermes adapter-utils resolution", () => {
  it("uses the host workspace adapter-utils package so process spawn observers are shared", async () => {
    const hermesServerEntry = require.resolve("hermes-paperclip-adapter/server");
    const hermesPackageRoot = findPackageRoot(hermesServerEntry);
    const adapterUtilsPath = findDependencyPath(hermesPackageRoot, "@paperclipai/adapter-utils");
    const expectedWorkspacePath = path.join(repoRoot, "packages", "adapter-utils");

    expect(fs.existsSync(adapterUtilsPath)).toBe(true);
    expect(fs.realpathSync(adapterUtilsPath)).toBe(fs.realpathSync(expectedWorkspacePath));
  });
});
