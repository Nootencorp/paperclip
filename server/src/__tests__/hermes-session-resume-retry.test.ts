import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  calls: [] as string[][],
}));

vi.mock("@paperclipai/adapter-utils/server-utils", () => ({
  buildPaperclipEnv: () => ({}),
  ensureAbsoluteDirectory: async () => undefined,
  renderTemplate: (template: string, vars: Record<string, string>) =>
    template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => vars[key] ?? ""),
  runChildProcess: vi.fn(async (_runId: string, _command: string, args: string[], opts: any) => {
    mockState.calls.push([...args]);
    const resumeIdx = args.indexOf("--resume");
    if (resumeIdx >= 0) {
      const sid = args[resumeIdx + 1] || "";
      const stdout = `Session not found: ${sid}\nUse a session ID from a previous CLI run (hermes sessions list).\n`;
      await opts?.onLog?.("stdout", stdout);
      return {
        exitCode: 1,
        signal: null,
        timedOut: false,
        stdout,
        stderr: "",
        pid: 12345,
        startedAt: new Date().toISOString(),
      };
    }

    const stdout = "fresh run ok\n\nsession_id: 20260516_190700_good\n";
    await opts?.onLog?.("stdout", stdout);
    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout,
      stderr: "",
      pid: 12346,
      startedAt: new Date().toISOString(),
    };
  }),
}));

import { execute } from "hermes-paperclip-adapter/server";

function makeContext(overrides: Record<string, unknown> = {}) {
  const logs: Array<{ stream: string; chunk: string }> = [];
  return {
    ctx: {
      runId: "run-hermes-resume-retry",
      agent: {
        id: "agent-ceo",
        name: "CEO",
        companyId: "company-rs",
        adapterConfig: {},
      },
      config: {},
      runtime: {
        sessionParams: { sessionId: "from" },
      },
      onLog: async (stream: string, chunk: string) => {
        logs.push({ stream, chunk });
      },
      ...overrides,
    } as any,
    logs,
  };
}

describe("Hermes adapter session resume fallback", () => {
  beforeEach(() => {
    mockState.calls.length = 0;
  });

  it("does not persist the word from from Hermes unknown-session help text and retries fresh", async () => {
    const { ctx, logs } = makeContext({
      agent: {
        id: "agent-ceo",
        name: "CEO",
        companyId: "company-rs",
        adapterConfig: {
          hermesCommand: "/tmp/fake-hermes",
          cwd: "/tmp",
          model: "gpt-5.5",
          provider: "openai-codex",
          quiet: true,
          persistSession: true,
          timeoutSec: 10,
          graceSec: 1,
        },
      },
    });

    const result = await execute(ctx);

    expect(result.exitCode).toBe(0);
    expect(result.sessionParams).toEqual({ sessionId: "20260516_190700_good" });
    expect(JSON.stringify(result)).not.toContain('"from"');
    expect(mockState.calls).toHaveLength(2);
    expect(mockState.calls[0]).toContain("--resume");
    expect(mockState.calls[0]).toContain("from");
    expect(mockState.calls[1]).not.toContain("--resume");
    expect(logs.map((l) => l.chunk).join("\n")).toMatch(/retrying.*fresh/i);
  });
});
