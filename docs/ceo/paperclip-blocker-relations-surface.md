# Paperclip Blocker Relations API Surface

Receipt for [RS-90](/RS/issues/RS-90) via [RS-93](/RS/issues/RS-93).

## Source Map

The only first-class blocker relation type is `blocks`. The stored edge direction is:

- `issue_relations.issue_id` = blocker issue
- `issue_relations.related_issue_id` = blocked issue
- `issue_relations.type` = `blocks`

Supported mutation surfaces:

- `POST /api/companies/:companyId/issues` accepts `blockedByIssueIds` on issue creation. Source: `server/src/routes/issues.ts:2291`, validator `packages/shared/src/validators/issue.ts:222`, service sync `server/src/services/issues.ts:3014`.
- `POST /api/issues/:id/children` accepts `blockedByIssueIds` on child issue creation. Source: `server/src/routes/issues.ts:2381`, validator `packages/shared/src/validators/issue.ts:249`, service sync through create-child path.
- `PATCH /api/issues/:id` accepts `blockedByIssueIds` on update. Source: `server/src/routes/issues.ts:2526`, validator `packages/shared/src/validators/issue.ts:268`, service sync `server/src/services/issues.ts:3263`.
- Deletion/replacement uses the same `PATCH /api/issues/:id` field. Send the full intended set; `[]` deletes all blocker edges for that blocked issue. Source: `server/src/services/issues.ts:2075`.

Unsupported mutation surfaces:

- There is no `POST /api/issues/:id/relations`.
- There is no `PATCH /api/issues/:id/blockers`.
- There is no separate relation-specific route in `server/src/routes/issues.ts`.

Supported read surfaces:

- `GET /api/issues/:id` returns derived `blockedBy` and `blocks` summary arrays. It does not return raw `blockedByIssueIds`. Source: `server/src/routes/issues.ts:1633`.
- `GET /api/issues/:id/heartbeat-context` returns `issue.blockedBy` and `issue.blocks`. It does not return raw `blockedByIssueIds`. Source: `server/src/routes/issues.ts:1520`.
- The summary arrays come from `getIssueRelationSummaryMap`, which reads both directions from `issue_relations`. Source: `server/src/services/issues.ts:1930`.

Validation and side effects:

- Self-blocking is rejected with `422` and `Issue cannot be blocked by itself`. Source: `server/src/services/issues.ts:2052`.
- Blocker IDs must resolve to issues in the same company; missing IDs and cross-company IDs are rejected with `422` and `Blocked-by issues must belong to the same company`. Source: `server/src/services/issues.ts:2065`.
- Cycle creation is rejected with `422` and `Blocking relations cannot contain cycles`. Source: `server/src/services/issues.ts:2007`.
- The service locks the blocked issue plus proposed blockers with `FOR UPDATE` before validating and replacing edges. Source: `server/src/services/issues.ts:2057`.
- `PATCH /api/issues/:id` logs `issue.blockers_updated` when the effective blocker set changes. Source: `server/src/routes/issues.ts:2957`.
- Agent-authenticated mutation is issue-scoped. Unassigned issues are mutable; assigned issues can only be mutated by their assignee unless an active-checkout management override applies. Source: `server/src/routes/issues.ts:1024`.

DB shape:

- Schema source: `packages/db/src/schema/issue_relations.ts`.
- Migration source: `packages/db/src/migrations/0049_flawless_abomination.sql`.
- Columns: `id`, `company_id`, `issue_id`, `related_issue_id`, `type`, `created_by_agent_id`, `created_by_user_id`, `created_at`, `updated_at`.
- Foreign keys: `company_id -> companies.id`, `issue_id -> issues.id ON DELETE CASCADE`, `related_issue_id -> issues.id ON DELETE CASCADE`, `created_by_agent_id -> agents.id ON DELETE SET NULL`.
- Indexes: `(company_id, issue_id)`, `(company_id, related_issue_id)`, `(company_id, type)`, unique `(company_id, issue_id, related_issue_id, type)`.

## Canonical Curl Recipes

Create or replace blockers for an issue:

```bash
curl -s -X PATCH \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID" \
  "$PAPERCLIP_API_URL/api/issues/$BLOCKED_ISSUE_ID" \
  -d "$(jq -n --arg blocker "$BLOCKER_ISSUE_ID" '{blockedByIssueIds: [$blocker]}')"
```

Read back and assert the edge before treating the issue as blocked:

```bash
curl -s \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  "$PAPERCLIP_API_URL/api/issues/$BLOCKED_ISSUE_ID" \
  | jq --arg blocker "$BLOCKER_ISSUE_ID" '
      {identifier, blockedBy, blocks}
      | . as $issue
      | if any($issue.blockedBy[]?; .id == $blocker) then $issue
        else error("blockedBy readback did not contain expected blocker")
        end
    '
```

Remove all blockers from an issue:

```bash
curl -s -X PATCH \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID" \
  "$PAPERCLIP_API_URL/api/issues/$BLOCKED_ISSUE_ID" \
  -d '{"blockedByIssueIds":[]}'
```

Create a new issue that is already blocked:

```bash
curl -s -X POST \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID" \
  "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/issues" \
  -d "$(jq -n \
    --arg title "Blocked follow-up" \
    --arg blocker "$BLOCKER_ISSUE_ID" \
    '{title:$title, status:"blocked", blockedByIssueIds:[$blocker]}')"
```

## Live API Receipts

These receipts were captured against the local Paperclip API on 2026-05-09. Disposable unassigned issues were used so no assignment wakeup could steal the active checkout. The temp issues were cancelled after capture; the relevant mechanism receipt is the API response body.

Create edge with `PATCH /api/issues/:id`:

```json
{
  "id": "3b8782c9-d733-4fcb-aab1-0d82144844a0",
  "identifier": "RS-99",
  "status": "backlog",
  "blockedBy": [
    {
      "id": "5800c7d2-cc4d-4871-85bc-b87d64ca5afe",
      "identifier": "RS-100",
      "title": "RS-93 receipt unassigned blocker 20260509T093819Z",
      "status": "backlog",
      "priority": "low",
      "assigneeAgentId": null,
      "assigneeUserId": null
    }
  ],
  "blocks": []
}
```

Readback with `GET /api/issues/:id`:

```json
{
  "id": "3b8782c9-d733-4fcb-aab1-0d82144844a0",
  "identifier": "RS-99",
  "blockedBy": [
    {
      "id": "5800c7d2-cc4d-4871-85bc-b87d64ca5afe",
      "identifier": "RS-100",
      "title": "RS-93 receipt unassigned blocker 20260509T093819Z",
      "status": "backlog",
      "priority": "low",
      "assigneeAgentId": null,
      "assigneeUserId": null
    }
  ],
  "blocks": [],
  "hasBlockedByIssueIds": false,
  "blockedByIssueIds": null
}
```

Delete edge with `PATCH /api/issues/:id` and `{"blockedByIssueIds":[]}`:

```json
{
  "id": "3b8782c9-d733-4fcb-aab1-0d82144844a0",
  "identifier": "RS-99",
  "blockedBy": [],
  "blocks": []
}
```

Self-blocking attempt:

```text
HTTP 422
{"error":"Issue cannot be blocked by itself"}
```

Nonexistent target attempt:

```text
HTTP 422
{"error":"Blocked-by issues must belong to the same company"}
```

Cycle attempt:

```text
Setup: RS-101 blocked by RS-102 succeeded.
Attempt: RS-102 blocked by RS-101.
HTTP 422
{"error":"Blocking relations cannot contain cycles"}
```

Patch on an issue assigned to another agent:

```text
HTTP 403
{"error":"Agent cannot mutate another agent's issue", ...}
```

Wrong endpoint receipts:

```text
POST /api/issues/:id/relations
HTTP 404
{"error":"API route not found"}

PATCH /api/issues/:id/blockers
HTTP 404
{"error":"API route not found"}
```

## Agent Rule

Never treat a blocker relation as established from a successful-looking mutation alone. After every create, replace, or delete, perform `GET /api/issues/:id` and assert `blockedBy` contains exactly the intended blocker IDs for that blocked issue. If the readback does not match, the graph edge is not established for wakeup purposes.
