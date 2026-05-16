import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { activityLog, agents, companies, createDb, heartbeatRuns } from "@paperclipai/db";
import { eq } from "drizzle-orm";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { logActivity } from "../services/activity-log.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres activity log FK tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("activity log runId FK safety", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-activity-log-fk-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(heartbeatRuns);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("keeps valid same-company run ids and drops stale or cross-company run ids", async () => {
    const [companyOne] = await db.insert(companies).values({
      name: "RS-92 Company One",
      issuePrefix: "R92A",
      requireBoardApprovalForNewAgents: false,
    }).returning();
    const [companyTwo] = await db.insert(companies).values({
      name: "RS-92 Company Two",
      issuePrefix: "R92B",
      requireBoardApprovalForNewAgents: false,
    }).returning();
    const [agentOne] = await db.insert(agents).values({
      companyId: companyOne.id,
      name: "RS-92 Agent One",
      role: "engineer",
      status: "running",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    }).returning();
    const [agentTwo] = await db.insert(agents).values({
      companyId: companyTwo.id,
      name: "RS-92 Agent Two",
      role: "engineer",
      status: "running",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    }).returning();
    const [runOne] = await db.insert(heartbeatRuns).values({
      companyId: companyOne.id,
      agentId: agentOne.id,
      invocationSource: "assignment",
      status: "running",
    }).returning();
    const [runTwo] = await db.insert(heartbeatRuns).values({
      companyId: companyTwo.id,
      agentId: agentTwo.id,
      invocationSource: "assignment",
      status: "running",
    }).returning();

    const baseInput = {
      companyId: companyOne.id,
      actorType: "agent" as const,
      actorId: agentOne.id,
      action: "rs92.activity_log_fk_test",
      entityType: "issue",
      entityId: "rs92-pg-entity",
      agentId: agentOne.id,
      details: { path: "non-checkout" },
    };

    await logActivity(db, { ...baseInput, runId: runOne.id });
    await logActivity(db, { ...baseInput, runId: randomUUID() });
    await logActivity(db, { ...baseInput, runId: runTwo.id });

    const rows = await db
      .select()
      .from(activityLog)
      .where(eq(activityLog.companyId, companyOne.id));

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.runId)).toEqual(expect.arrayContaining([runOne.id, null, null]));
  });
});
