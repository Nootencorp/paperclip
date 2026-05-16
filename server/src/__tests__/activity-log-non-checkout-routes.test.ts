import { describe, expect, it, vi } from "vitest";

const mockInstanceSettingsService = vi.hoisted(() =>
  vi.fn(() => ({
    getGeneral: vi.fn().mockResolvedValue({ censorUsernameInLogs: false }),
  })),
);

vi.mock("../services/instance-settings.js", () => ({
  instanceSettingsService: mockInstanceSettingsService,
}));

describe("activity log non-checkout route safety", () => {
  it("does not throw to caller mutations when runId validation fails", async () => {
    const { logActivity } = await import("../services/activity-log.ts");
    const inserted: unknown[] = [];
    const db = {
      select() {
        throw new Error("heartbeat_runs unavailable");
      },
      insert() {
        return {
          values(value: unknown) {
            inserted.push(value);
            return Promise.resolve();
          },
        };
      },
    } as any;

    await expect(logActivity(db, {
      companyId: "company-1",
      actorType: "agent",
      actorId: "agent-1",
      action: "issue.updated",
      entityType: "issue",
      entityId: "issue-1",
      agentId: "agent-1",
      runId: "caller-supplied-stale-run",
      details: { source: "non-checkout-route" },
    })).resolves.toBeUndefined();

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ runId: null });
  });

  it("does not throw to caller mutations when activity insert fails", async () => {
    const { logActivity } = await import("../services/activity-log.ts");
    const db = {
      select() {
        return {
          from() { return this; },
          where() { return this; },
          limit() { return Promise.resolve([{ id: "run-1" }]); },
        };
      },
      insert() {
        return {
          values() {
            throw new Error("activity_log unavailable");
          },
        };
      },
    } as any;

    await expect(logActivity(db, {
      companyId: "company-1",
      actorType: "agent",
      actorId: "agent-1",
      action: "issue.updated",
      entityType: "issue",
      entityId: "issue-1",
      agentId: "agent-1",
      runId: "run-1",
      details: { source: "non-checkout-route" },
    })).resolves.toBeUndefined();
  });
});
