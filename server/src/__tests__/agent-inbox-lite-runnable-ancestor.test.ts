import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  agentWakeupRequests,
  companies,
  createDb,
  heartbeatRuns,
  issueRelations,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { agentRoutes } from "../routes/agents.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres inbox-lite runnable ancestor tests on this host: ${
      embeddedPostgresSupport.reason ?? "unsupported environment"
    }`,
  );
}

describeEmbeddedPostgres("agent inbox-lite runnable ancestors", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-agent-inbox-lite-runnable-ancestor-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issueRelations);
    await db.delete(issues);
    await db.delete(heartbeatRuns);
    await db.delete(agentWakeupRequests);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  function createApp(companyId: string, agentId: string) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.actor = {
        type: "agent",
        agentId,
        companyId,
        runId: randomUUID(),
        source: "agent_jwt",
      };
      next();
    });
    app.use("/api", agentRoutes(db));
    app.use(errorHandler);
    return app;
  }

  async function createCompany(prefix = "PRA") {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const otherAgentId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: `Company ${prefix}`,
      issuePrefix: prefix,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values([
      {
        id: agentId,
        companyId,
        name: `${prefix} Agent`,
        role: "engineer",
        status: "idle",
      },
      {
        id: otherAgentId,
        companyId,
        name: `${prefix} Other Agent`,
        role: "engineer",
        status: "idle",
      },
    ]);
    return { companyId, agentId, otherAgentId };
  }

  async function insertIssue(input: {
    companyId: string;
    identifier: string;
    title: string;
    status: string;
    assigneeAgentId?: string | null;
  }) {
    const id = randomUUID();
    await db.insert(issues).values({
      id,
      companyId: input.companyId,
      identifier: input.identifier,
      title: input.title,
      status: input.status,
      priority: "medium",
      assigneeAgentId: input.assigneeAgentId ?? null,
      originKind: "manual",
      originFingerprint: randomUUID(),
    });
    return id;
  }

  async function block(input: { companyId: string; blockerIssueId: string; blockedIssueId: string }) {
    await db.insert(issueRelations).values({
      companyId: input.companyId,
      issueId: input.blockerIssueId,
      relatedIssueId: input.blockedIssueId,
      type: "blocks",
    });
  }

  async function inboxIds(companyId: string, agentId: string) {
    const res = await request(createApp(companyId, agentId)).get("/api/agents/me/inbox-lite");
    expect(res.status).toBe(200);
    return (res.body as Array<{ id: string }>).map((row) => row.id);
  }

  it("surfaces a runnable same-agent blocker instead of the blocked helper", async () => {
    const { companyId, agentId } = await createCompany("PRA");
    const parentId = await insertIssue({ companyId, identifier: "PRA-1", title: "Runnable parent", status: "todo", assigneeAgentId: agentId });
    const helperId = await insertIssue({ companyId, identifier: "PRA-2", title: "Blocked helper", status: "blocked", assigneeAgentId: agentId });
    await block({ companyId, blockerIssueId: parentId, blockedIssueId: helperId });

    await expect(inboxIds(companyId, agentId)).resolves.toEqual([parentId]);
  });

  it("does not surface another agent's blocker", async () => {
    const { companyId, agentId, otherAgentId } = await createCompany("PRB");
    const parentId = await insertIssue({ companyId, identifier: "PRB-1", title: "Other agent parent", status: "todo", assigneeAgentId: otherAgentId });
    const helperId = await insertIssue({ companyId, identifier: "PRB-2", title: "Blocked helper", status: "blocked", assigneeAgentId: agentId });
    await block({ companyId, blockerIssueId: parentId, blockedIssueId: helperId });

    await expect(inboxIds(companyId, agentId)).resolves.toEqual([]);
  });

  it("does not surface a blocker that is itself blocked without a runnable same-agent leaf", async () => {
    const { companyId, agentId, otherAgentId } = await createCompany("PRC");
    const parentId = await insertIssue({ companyId, identifier: "PRC-1", title: "Blocked parent", status: "blocked", assigneeAgentId: agentId });
    const externalBlockerId = await insertIssue({ companyId, identifier: "PRC-2", title: "External blocker", status: "todo", assigneeAgentId: otherAgentId });
    const helperId = await insertIssue({ companyId, identifier: "PRC-3", title: "Blocked helper", status: "blocked", assigneeAgentId: agentId });
    await block({ companyId, blockerIssueId: externalBlockerId, blockedIssueId: parentId });
    await block({ companyId, blockerIssueId: parentId, blockedIssueId: helperId });

    await expect(inboxIds(companyId, agentId)).resolves.toEqual([]);
  });

  it("bounds and skips cycles in the blocker chain", async () => {
    const { companyId, agentId } = await createCompany("PRD");
    const firstId = await insertIssue({ companyId, identifier: "PRD-1", title: "Cycle first", status: "blocked", assigneeAgentId: agentId });
    const secondId = await insertIssue({ companyId, identifier: "PRD-2", title: "Cycle second", status: "blocked", assigneeAgentId: agentId });
    await block({ companyId, blockerIssueId: secondId, blockedIssueId: firstId });
    await block({ companyId, blockerIssueId: firstId, blockedIssueId: secondId });

    await expect(inboxIds(companyId, agentId)).resolves.toEqual([]);
  });

  it("dedupes multiple blocked helpers that resolve to the same runnable blocker", async () => {
    const { companyId, agentId } = await createCompany("PRE");
    const parentId = await insertIssue({ companyId, identifier: "PRE-1", title: "Runnable parent", status: "todo", assigneeAgentId: agentId });
    const firstHelperId = await insertIssue({ companyId, identifier: "PRE-2", title: "First helper", status: "blocked", assigneeAgentId: agentId });
    const secondHelperId = await insertIssue({ companyId, identifier: "PRE-3", title: "Second helper", status: "blocked", assigneeAgentId: agentId });
    await block({ companyId, blockerIssueId: parentId, blockedIssueId: firstHelperId });
    await block({ companyId, blockerIssueId: parentId, blockedIssueId: secondHelperId });

    await expect(inboxIds(companyId, agentId)).resolves.toEqual([parentId]);
  });

  it("keeps independent runnable work while also surfacing a blocked helper's runnable blocker", async () => {
    const { companyId, agentId } = await createCompany("PRF");
    const independentId = await insertIssue({ companyId, identifier: "PRF-1", title: "Independent", status: "todo", assigneeAgentId: agentId });
    const parentId = await insertIssue({ companyId, identifier: "PRF-2", title: "Runnable parent", status: "todo", assigneeAgentId: agentId });
    const helperId = await insertIssue({ companyId, identifier: "PRF-3", title: "Blocked helper", status: "blocked", assigneeAgentId: agentId });
    await block({ companyId, blockerIssueId: parentId, blockedIssueId: helperId });

    await expect(inboxIds(companyId, agentId)).resolves.toEqual(expect.arrayContaining([independentId, parentId]));
    await expect(inboxIds(companyId, agentId)).resolves.toHaveLength(2);
  });
});
