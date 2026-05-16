import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const bearerValue = "pc_test_bearer";
const agentId = "11111111-1111-4111-8111-111111111111";
const otherAgentId = "22222222-2222-4222-8222-222222222222";
const companyId = "33333333-3333-4333-8333-333333333333";
const otherCompanyId = "44444444-4444-4444-8444-444444444444";
const keyId = "55555555-5555-4555-8555-555555555555";
const runId = "66666666-6666-4666-8666-666666666666";

const mockFindBoardApiKeyByToken = vi.hoisted(() => vi.fn(async () => null));
const mockResolveBoardAccess = vi.hoisted(() => vi.fn());
const mockTouchBoardApiKey = vi.hoisted(() => vi.fn());
const mockVerifyLocalAgentJwt = vi.hoisted(() => vi.fn(() => null));

vi.mock("../agent-auth-jwt.js", () => ({
  verifyLocalAgentJwt: mockVerifyLocalAgentJwt,
}));

vi.mock("../services/board-auth.js", () => ({
  boardAuthService: () => ({
    findBoardApiKeyByToken: mockFindBoardApiKeyByToken,
    resolveBoardAccess: mockResolveBoardAccess,
    touchBoardApiKey: mockTouchBoardApiKey,
  }),
}));

function makeDb(selectResults: unknown[][]) {
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(selectResults.shift() ?? [])),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve()),
      })),
    })),
  };
  return db;
}

async function runActorRequest(input: {
  db: ReturnType<typeof makeDb>;
  runIdHeader?: string;
  deploymentMode?: "authenticated" | "local_trusted";
}) {
  const { actorMiddleware } = await import("../middleware/auth.js");
  const app = express();
  app.use(actorMiddleware(input.db as any, { deploymentMode: input.deploymentMode ?? "authenticated" }));
  app.get("/actor", (req, res) => res.json(req.actor));

  const req = request(app).get("/actor");
  if (input.deploymentMode !== "local_trusted") {
    req.set("authorization", `Bearer ${bearerValue}`);
  }
  if (input.runIdHeader !== undefined) {
    req.set("x-paperclip-run-id", input.runIdHeader);
  }
  return req.expect(200);
}

function agentKeyRow() {
  return {
    id: keyId,
    agentId,
    companyId,
    keyHash: "unused-by-test",
    revokedAt: null,
  };
}

function agentRow() {
  return {
    id: agentId,
    companyId,
    status: "idle",
  };
}

function heartbeatRunRow(overrides: Partial<{ id: string; agentId: string; companyId: string; status: string }> = {}) {
  return {
    id: runId,
    agentId,
    companyId,
    status: "running",
    ...overrides,
  };
}

function jwtClaims(overrides: Partial<{ run_id: string; sub: string; company_id: string }> = {}) {
  return {
    sub: agentId,
    company_id: companyId,
    adapter_type: "hermes_local",
    run_id: runId,
    iat: 1,
    exp: 9_999_999_999,
    ...overrides,
  };
}

describe("actorMiddleware request run id validation", () => {
  beforeEach(() => {
    vi.resetModules();
    mockFindBoardApiKeyByToken.mockReset();
    mockFindBoardApiKeyByToken.mockResolvedValue(null);
    mockResolveBoardAccess.mockReset();
    mockTouchBoardApiKey.mockReset();
    mockVerifyLocalAgentJwt.mockReset();
    mockVerifyLocalAgentJwt.mockReturnValue(null);
  });

  it("keeps a valid run id for the authenticated agent", async () => {
    const db = makeDb([[agentKeyRow()], [agentRow()], [heartbeatRunRow()]]);

    const res = await runActorRequest({ db, runIdHeader: runId });

    expect(res.body).toMatchObject({
      type: "agent",
      agentId,
      companyId,
      runId,
      source: "agent_key",
    });
  });

  it("uses the signed JWT run id instead of an untrusted request header", async () => {
    mockVerifyLocalAgentJwt.mockReturnValue(jwtClaims());
    const db = makeDb([[], [agentRow()], [heartbeatRunRow()]]);

    const res = await runActorRequest({ db, runIdHeader: "not-a-run-id" });

    expect(res.body).toMatchObject({
      type: "agent",
      agentId,
      companyId,
      runId,
      source: "agent_jwt",
    });
  });

  it("drops a stale signed JWT run id before routes can persist it", async () => {
    mockVerifyLocalAgentJwt.mockReturnValue(jwtClaims());
    const db = makeDb([[], [agentRow()], []]);

    const res = await runActorRequest({ db, runIdHeader: "not-a-run-id" });

    expect(res.body).toMatchObject({
      type: "agent",
      agentId,
      companyId,
      source: "agent_jwt",
    });
    expect(res.body.runId).toBeUndefined();
  });

  it("drops a stale run id instead of trusting a nonexistent heartbeat run", async () => {
    const db = makeDb([[agentKeyRow()], [agentRow()], []]);

    const res = await runActorRequest({ db, runIdHeader: runId });

    expect(res.body).toMatchObject({
      type: "agent",
      agentId,
      companyId,
      source: "agent_key",
    });
    expect(res.body.runId).toBeUndefined();
  });

  it("drops a terminal same-scope heartbeat run id as stale", async () => {
    const db = makeDb([[agentKeyRow()], [agentRow()], [heartbeatRunRow({ status: "succeeded" })]]);

    const res = await runActorRequest({ db, runIdHeader: runId });

    expect(res.body).toMatchObject({
      type: "agent",
      agentId,
      companyId,
      source: "agent_key",
    });
    expect(res.body.runId).toBeUndefined();
  });

  it("drops a run id that belongs to a different agent", async () => {
    const db = makeDb([[agentKeyRow()], [agentRow()], [heartbeatRunRow({ agentId: otherAgentId })]]);

    const res = await runActorRequest({ db, runIdHeader: runId });

    expect(res.body.runId).toBeUndefined();
  });

  it("drops a run id that belongs to a different company", async () => {
    const db = makeDb([[agentKeyRow()], [agentRow()], [heartbeatRunRow({ companyId: otherCompanyId })]]);

    const res = await runActorRequest({ db, runIdHeader: runId });

    expect(res.body.runId).toBeUndefined();
  });

  it("drops stale local-trusted board run ids before routes can persist them", async () => {
    const db = makeDb([[]]);

    const res = await runActorRequest({ db, deploymentMode: "local_trusted", runIdHeader: runId });

    expect(res.body).toMatchObject({
      type: "board",
      userId: "local-board",
      source: "local_implicit",
    });
    expect(res.body.runId).toBeUndefined();
  });
});
