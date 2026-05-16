import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const adapterUtilsSrc = path.join(repoRoot, "packages/adapter-utils/src");

export default defineConfig({
  plugins: [
    {
      name: "paperclip-adapter-utils-ts-resolution",
      enforce: "pre",
      resolveId(source, importer) {
        if (!importer || !source.startsWith("./") || !source.endsWith(".js")) {
          return null;
        }
        const rawImporterPath = importer.split("?")[0];
        const importerPath = rawImporterPath.startsWith("file://")
          ? fileURLToPath(rawImporterPath)
          : rawImporterPath;
        if (!importerPath.startsWith(adapterUtilsSrc + path.sep)) {
          return null;
        }
        const tsPath = path.resolve(path.dirname(importerPath), source.replace(/\.js$/, ".ts"));
        return fs.existsSync(tsPath) ? tsPath : null;
      },
    },
  ],
  test: {
    environment: "node",
    isolate: true,
    maxConcurrency: 1,
    maxWorkers: 1,
    minWorkers: 1,
    pool: "forks",
    poolOptions: {
      forks: {
        isolate: true,
        maxForks: 1,
        minForks: 1,
      },
    },
    sequence: {
      concurrent: false,
      hooks: "list",
    },
    setupFiles: ["./src/__tests__/setup-supertest.ts"],
    deps: {
      inline: ["@paperclipai/adapter-utils", "hermes-paperclip-adapter"],
    },
  },
  server: {
    deps: {
      inline: ["@paperclipai/adapter-utils"],
    },
  },
});
