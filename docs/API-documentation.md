# API Documentation
## Animal Care Facility Digital Records System — Phase 1 (Aquatics)
### University of Windsor — Animal Care Department

**Document Owner:** University of Windsor — Developed by Apurva Shovit
**Status:** Draft v0.1 — ready for backend implementation
**Related Docs:** PRD.md, TRD.md, backend-schema.md, architecture.md
**Stack assumed:** FastAPI (Python 3.12+), MongoDB Atlas (Motor/Beanie), JWT auth (standalone, local `users` collection)

---

## 1. Conventions

- **Base path:** `/api/v1`
- **Format:** JSON only (`Content-Type: application/json`), UTF-8.
- **Auth:** `Authorization: Bearer <access_token>` on every route except `/auth/login`, `/auth/refresh`, `/health`.
- **IDs:** MongoDB `ObjectId` serialized as string in JSON (`"64f1c2..."`).
- **Dates/times:** ISO 8601 UTC (`2026-07-20T14:30:00Z`) over the wire. UI is responsible for D/M/Y
  display formatting to match the paper forms; the API never stores or returns localized date strings.
- **Pagination:** `?page=1&page_size=50` (default `page_size=50`, max `200`). List responses use the
  envelope in §3.
- **Filtering:** all list endpoints that represent dated records support `date_from` / `date_to`
  (inclusive, ISO date) as first-class query params — this is the backbone of the inspection-summary
  use case.
- **Idempotency:** batch-entry endpoints (`water-quality/batch`, `food-logs/batch`) accept an
  `Idempotency-Key` header; a repeated key within 24h returns the original result instead of duplicating.
- **Soft delete:** `DELETE` on soft-deletable collections (users, facilities, rooms, tanks, projects,
  controlled-vocabularies) sets `deleted=true, deleted_at, deleted_by` — never a real Mongo delete.
  Immutable collections (census events, incidents, water quality, food logs, maintenance logs,
  disposition records, audit logs, export history) expose **no delete endpoint at all**.

## 2. Auth Model & RBAC Enforcement

- Roles: `staff`, `manager`, `chair/admin` (per PRD §5; Chair has all Admin abilities, so effectively
  `chair/admin ⊇ manager ⊇ staff` for read scope, with the explicit exceptions noted in the PRD, e.g.
  Chair's room/tank add-append right).
- Every route declares a required permission; enforced via a FastAPI dependency
  (`Depends(require_permission("incident:create"))`), **never inferred from the frontend**.
- Staff-scoped reads are additionally filtered server-side by the user's `assigned_tank_ids`/`room_ids` —
  a Staff user cannot widen their own result set by query manipulation.
- All 401/403 responses are themselves audit-logged (`action: "access_denied"`) to support the TRD's
  "alert on repeated cross-role access denials" requirement.

### 2.1 Permission Matrix (summary — full matrix maintained in code as the single source of truth)

| Resource | Staff | Manager | Chair | Admin |
|---|---|---|---|---|
| Own assigned tanks/logs — read/write | ✅ | ✅ | ✅ | ✅ |
| All facility tanks/logs — read | ❌ | ✅ | ✅ | ✅ |
| All facility tanks/logs — write | ❌ | ✅ | ➕ (append/add only, see PRD Q6) | ✅ |
| Projects (AUPP) — create/edit | ✅ | ✅ | ✅ | ✅ |
| Tanks — add/remove | ❌ | ❌ | ✅ | ✅ |
| Users — manage/roles | ❌ | ❌ | ✅ | ✅ |
| Controlled vocabularies — delete entry | ❌ | ❌ | ✅ | ✅ |
| Reports/summary — generate/export | ❌ | ✅ | ✅ | ✅ |
| Audit log — read | ❌ | ❌ (own actions only, if surfaced) | ✅ | ✅ |
| Settings — edit | ❌ | ❌ | ✅ | ✅ |

## 3. Standard Response Envelope

**Success (single resource):**
```json
{ "data": { ... } }
```

**Success (list):**
```json
{
  "data": [ ... ],
  "meta": { "page": 1, "page_size": 50, "total": 132 }
}
```

**Error (RFC 7807-style):**
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "aupp_number must match pattern ^\\d{2}-\\d{2}$",
    "field": "aupp_number",
    "request_id": "8f3c1e2a-..."
  }
}
```
Common `code` values: `VALIDATION_ERROR`, `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`, `CONFLICT`,
`RATE_LIMITED`, `INTERNAL_ERROR`.

---

## 4. Auth

### `POST /auth/login`
Public. Body: `{ "email": str, "password": str }` →
`{ "access_token", "refresh_token", "token_type": "bearer", "expires_in", "user": {id, email, first_name, last_name, role, facility_ids, room_ids, assigned_tank_ids} }`
- On repeated failure: exponential backoff + lockout per TRD §5; every attempt (success/fail) audit-logged.

### `POST /auth/refresh`
Body: `{ "refresh_token": str }` → new access/refresh token pair (rotation — old refresh token invalidated).

### `POST /auth/logout`
Auth required. Revokes the current refresh token (and optionally all sessions via `?all_sessions=true`,
Admin/Chair can force-revoke another user's sessions on role change/offboarding).

### `GET /auth/me`
Returns the current user's profile + effective permissions (frontend uses this to render role-gated UI,
but this is a convenience only — server still checks permissions per request).

---

## 5. Users & Roles *(Admin/Chair only, except `/auth/me`)*

| Method & Path | Permission | Notes |
|---|---|---|
| `GET /users` | `user:read` | filter by `role`, `facility_id`, `status` |
| `POST /users` | `user:create` | creates `status=pending`; admin sets initial role + facility/room/tank assignment |
| `GET /users/{id}` | `user:read` | |
| `PATCH /users/{id}` | `user:update` | role changes, room/tank (re)assignment — **every change audited with before/after** |
| `PATCH /users/{id}/status` | `user:update` | `active`/`suspended` — used for offboarding; force-revokes sessions |
| `DELETE /users/{id}` | `user:delete` | soft delete only |
| `GET /roles` | `user:read` | returns role→permission list (mostly static reference data) |

**User create/update body (subset):**
```json
{
  "email": "staff1@uwindsor.ca",
  "first_name": "Jane", "last_name": "Doe",
  "role_id": "...",
  "facility_ids": ["..."], "room_ids": ["..."], "assigned_tank_ids": ["..."]
}
```

---

## 6. Facilities / Rooms / Tanks

| Method & Path | Permission | Notes |
|---|---|---|
| `GET /facilities` | any authenticated | scoped to user's `facility_ids` unless Chair/Admin |
| `POST /facilities` | `facility:create` (Admin/Chair) | Phase 1 will have exactly one, but endpoint built for extensibility |
| `GET /rooms?facility_id=` | any authenticated | |
| `POST /rooms` | `room:create` (Admin/Chair) | |
| `GET /tanks?room_id=&status=` | any authenticated | Staff response filtered to `assigned_tank_ids` |
| `POST /tanks` | `tank:create` (Admin/Chair) | `{ "room_id", "tank_number", "notes"? }` |
| `PATCH /tanks/{id}` | `tank:update` (Admin/Chair) | e.g. `status: active→inactive` |
| `DELETE /tanks/{id}` | `tank:delete` (Admin/Chair) | soft delete; blocked (409 CONFLICT) if an active `tank_assignment` references it |

> `tank_capacity`, `default_species`, `tank_groups` are **not** persisted fields per backend-schema.md —
> tank groups for batch entry are supplied client-side as a list of `tank_id`s per request (see §10).

---

## 7. Projects (AUPP) & Tank Assignments

### 7.1 Projects
| Method & Path | Permission | Notes |
|---|---|---|
| `GET /projects` | scoped read | filter `status`, `aupp_number`, `principal_investigator` |
| `POST /projects` | `project:create` | validates `aupp_number` against `^\d{2}-\d{2}$` → 422 on mismatch |
| `GET /projects/{id}` | scoped read | |
| `PATCH /projects/{id}` | `project:update` | edit title, expiry, RM#, PI, status |
| `POST /projects/{id}/close` | `project:close` (Manager+) | Epic 8 — closes project, requires a `disposition` record be created in the same call or a prior linked one to exist (see §12) |

**Create body:**
```json
{
  "aupp_number": "12-34",
  "title": "Zebrafish behavior study",
  "principal_investigator": "Dr. A. Smith",
  "expiry_date": "2027-06-01",
  "rm_number": "RM-102"
}
```

### 7.2 Tank Assignments (the "who's in which tank" record — DOB/species/sex/count/source live here)
| Method & Path | Permission | Notes |
|---|---|---|
| `GET /tank-assignments?tank_id=&project_id=&status=` | scoped read | current + historical |
| `POST /tank-assignments` | `assignment:create` | initial intake — creates the assignment; if `source_type=external`, auto-creates linked `quarantine_records` (14-day) per Epic 2 |
| `PATCH /tank-assignments/{id}` | `assignment:update` | edit metadata (sex, dob, current_count via census only — see note) |
| `POST /tank-assignments/{id}/reassign` | `assignment:update` | moves fish to a new tank: closes old assignment (`status=closed`, `assigned_to` timestamp) and opens a new one, **preserving full history** — this is the "cleaning/growth separation" flow |

**Create body:**
```json
{
  "project_id": "...",
  "tank_id": "...",
  "species": "Zebrafish",
  "sex": "both",
  "dob": null,
  "established_date": "2026-07-01",
  "source": "In-house breeding facility",
  "source_type": "hatched",
  "initial_count": 120
}
```
> Note: `current_count` is **never** directly PATCHable — it only changes via `POST /census-events`
> (see §8), which transactionally updates it. This preserves the auditability guarantee from
> backend-schema.md §4.7.

**Reassign body:**
```json
{ "new_tank_id": "...", "reason": "Tank cleaning", "effective_at": "2026-08-01T09:00:00Z" }
```

---

## 8. Quarantine

| Method & Path | Permission | Notes |
|---|---|---|
| `GET /quarantine-records?status=&tank_assignment_id=` | scoped read | dashboard "quarantine countdown" widget queries this |
| `GET /quarantine-records/{id}` | scoped read | |
| `POST /quarantine-records/{id}/observations` | `quarantine:update` | appends an observation entry: `{ "date", "note", "recorded_by" }` (append to `observations` list — historical, not overwritten) |
| `POST /quarantine-records/{id}/complete` | `quarantine:update` | sets `completed=true, status="completed"`; blocked if `end_date` in future unless `force=true` with a `reason` (audited) |

Quarantine records are created **automatically** by `POST /tank-assignments` when `source_type=external` —
there is no standalone "create quarantine" endpoint by design (Epic 2).

---

## 9. Census

| Method & Path | Permission | Notes |
|---|---|---|
| `POST /census-events` | `census:create` | append-only; transactionally updates the parent `tank_assignment.current_count` |
| `GET /census-events?tank_assignment_id=&tank_id=&date_from=&date_to=&reason=` | scoped read | full ledger, paginated |
| `GET /census/summary?level=tank\|project\|facility&date_from=&date_to=&facility_id=&room_id=` | `census:read:facility` (Manager+) for facility/project level; Staff limited to `level=tank` on own tanks | powers Epic 3 rollups |

**Create body:**
```json
{
  "tank_assignment_id": "...",
  "tank_id": "...",
  "date": "2026-07-20",
  "change": -2,
  "reason": "death"
}
```
`reason` enum: `death | arrival | transfer_in | transfer_out | hatched | manual_adjustment`.
For `transfer_in`/`transfer_out` pairs (a tank-to-tank move outside a formal reassignment), the client
submits two linked census events sharing a `transfer_group_id` (generated client-side UUID) so reports
can reconcile the pair; validated server-side that the paired event exists within a short window or the
write is rejected with `VALIDATION_ERROR`.

---

## 10. Incident Reports

| Method & Path | Permission | Notes |
|---|---|---|
| `POST /incidents` | `incident:create` | see body below; `created_by` from JWT, never client-supplied (replaces paper "Initials" per backend-schema.md §4.10) |
| `GET /incidents?tank_id=&project_id=&date_from=&date_to=&vet_contacted=` | scoped read | |
| `GET /incidents/{id}` | scoped read | |
| `PATCH /incidents/{id}` | `incident:update` (Manager+; Staff may correct own entry within a short edit window, e.g. same day — configurable, always versioned not overwritten) |

**Create body (maps 1:1 to the *Aquatic Incident Reports* form):**
```json
{
  "project_id": "...", "tank_assignment_id": "...", "tank_id": "...",
  "date": "2026-07-20", "time": "14:05",
  "problem": "Fish observed with fin rot",
  "comments": "Isolated to tank corner",
  "treatment": "Salt bath administered",
  "aquatic_condition_checked": true,
  "vet_contacted": true,
  "researcher_notified": true
}
```
- `vet_contacted: true` → in-app flag surfaced on the Manager dashboard (PRD §12 Q1: manual only for now,
  no auto-email in Phase 1).
- Room#/Species/PI/AUPP# shown on the form are **derived** server-side by joining
  `tank → room` and `project`, not stored redundantly on the incident document, to avoid drift if a
  project's PI changes later.

---

## 11. Water Quality

Two record types per TRD §4.5/§4.6, one collection (`water_quality_logs`) with `type: "daily" | "test_strip"`.

### 11.1 Single-tank entry
| Method & Path | Permission | Notes |
|---|---|---|
| `POST /water-quality` | `waterquality:create` | single tank, single record |
| `GET /water-quality?tank_id=&type=&date_from=&date_to=` | scoped read | |
| `PATCH /water-quality/{id}` | `waterquality:update` | correction — versioned, not silently overwritten (previous value retained in audit log) |

**Daily (Appendix 6) body:**
```json
{
  "tank_id": "...", "project_id": "...", "type": "daily",
  "date": "2026-07-20",
  "parameters": { "ph": 7.2, "do": 6.5, "temp_c": 24.1 },
  "comments": "Normal"
}
```

**Test strip (Appendix 7) body:**
```json
{
  "tank_id": "...", "project_id": "...", "type": "test_strip",
  "date": "2026-07-20",
  "parameters": {
    "nitrate_ppm": 10, "nitrite_ppm": 0, "total_hardness_mgL": 150,
    "total_chlorine_ppm": 0, "total_alkalinity_ppm": 140,
    "ph": 7.4, "ammonia_ppm": 0.1
  },
  "comments": ""
}
```
- Server validates each parameter against the configured safe range (Nitrate 0–40, Nitrite 0, Hardness
  20–450, Chlorine 0, Alkalinity 120–180, pH 6.5–8 cold/7.5–9 warm, Ammonia 0–0.5) sourced from
  `settings.safe_ranges` (data-driven, per TRD §4.5) — out-of-range values are accepted (never blocked;
  the reading itself is the fact) but flagged: response includes `"flags": ["ammonia_out_of_range"]`.
  Escalation/alerting on flags remains the open PRD Epic 5 item pending clarification.

### 11.2 Batch entry (linked tank groups — Epic 5/6)
| Method & Path | Permission | Notes |
|---|---|---|
| `POST /water-quality/batch` | `waterquality:create` | fans out to N individual documents in one Mongo multi-doc transaction |

**Batch body:**
```json
{
  "tank_ids": ["tank_1", "tank_2", "...", "tank_8"],
  "type": "daily",
  "date": "2026-07-20",
  "parameters": { "ph": 7.2, "do": 6.5, "temp_c": 24.1 },
  "comments": "Shared recirculating system reading",
  "batch_submission_id": "client-generated-uuid"
}
```
- Response returns the array of created `water_quality_logs` documents (one per tank), each independently
  `GET`/`PATCH`-able afterward (a later individual correction on tank 3 does not touch tanks 1,2,4-8).
- `batch_submission_id` is stored on each resulting document (not a separate collection — see
  backend-schema.md §6, "batch grouping is API logic") purely so the audit trail and reports can group
  "these 8 records came from one action" per TRD §11 risk mitigation, without it being a first-class
  queryable entity elsewhere.
- Idempotent via `Idempotency-Key` header — retrying the same key returns the original 8 documents rather
  than creating 8 more.

### 11.3 Schedule/frequency metadata
| Method & Path | Permission | Notes |
|---|---|---|
| `GET /water-quality/schedule` | any authenticated | returns the configured frequency table (daily: Temp/O2/pH; biweekly: Ammonia/Nitrite/Nitrates/Total Hardness; weekly: Nitrogen/Salinity; annually: Chlorine) so the frontend can show "due" indicators — sourced from `settings`, editable only by Admin/Chair via `PATCH /settings/{key}` |

---

## 12. Food Logs

| Method & Path | Permission | Notes |
|---|---|---|
| `POST /food-logs` | `foodlog:create` | single tank |
| `POST /food-logs/batch` | `foodlog:create` | same fan-out pattern as water quality; `Idempotency-Key` supported |
| `GET /food-logs?tank_id=&date_from=&date_to=&food_type=` | scoped read | |

**Body:**
```json
{ "tank_id": "...", "food_type": "Flake food", "amount": "2g", "date": "2026-07-20", "comments": "" }
```
`food_type` follows the extensible-vocabulary pattern (§14) — free text auto-published to
`controlled_vocabularies` on first use (PRD Q5: auto-approve, admin/chair-only delete).

---

## 13. Maintenance Logs

| Method & Path | Permission | Notes |
|---|---|---|
| `POST /maintenance-logs` | `maintenance:create` | `{ "tank_id", "date", "description" }` |
| `GET /maintenance-logs?tank_id=&date_from=&date_to=` | scoped read | |

---

## 14. Controlled Vocabularies (extensible dropdowns — Epic 12)

| Method & Path | Permission | Notes |
|---|---|---|
| `GET /vocabularies?type=species\|food_type` | any authenticated | returns `active=true` entries for dropdown population |
| `POST /vocabularies` | any authenticated (auto-approve per PRD Q2/Q5) | called implicitly when a user submits an "Other" value on a form (or explicitly for a standalone "manage list" screen); `{ "type": "species", "value": "Bluegill" }` — dedupes case-insensitively |
| `PATCH /vocabularies/{id}` | `vocabulary:update` (Admin/Chair) | deactivate (`active=false`) — soft, never a hard delete, so historical records referencing the old value still render correctly |

---

## 15. Disposition Records (Epic 8 — Project Close-out)

| Method & Path | Permission | Notes |
|---|---|---|
| `POST /disposition-records` | `disposition:create` (Manager+) | `{ "project_id", "tank_assignment_id", "type": "euthanized\|transferred\|adopted\|other", "date", "reason" }` |
| `GET /disposition-records?project_id=&tank_id=&date_from=&date_to=&type=` | scoped read | feeds the inspection summary's "final disposition" section |

`POST /projects/{id}/close` (see §7.1) requires at least one disposition record already exists for every
active `tank_assignment` under that project, or accepts an inline `dispositions[]` array to create them
atomically in the same request.

---

## 16. Reporting & Summaries (Epic 9 — the core inspection use case)

### `GET /reports/summary`
**Permission:** `report:read` (Manager+; Staff not permitted).
**Query params:** `date_from` (required), `date_to` (required), `facility_id`, `room_id`, `project_id`,
`species` (any combination; omitted = whole facility).

**Response shape:**
```json
{
  "data": {
    "range": { "from": "2026-01-01", "to": "2026-07-01" },
    "population": { "start_count": 812, "brought_in": 140, "hatched": 60, "removed": 95, "end_count": 917 },
    "projects_active": [ { "project_id": "...", "aupp_number": "12-34", "title": "...", "tank_ids": ["..."] } ],
    "incidents": {
      "by_project": [ { "project_id": "...", "count": 4 } ],
      "by_facility_total": 11
    },
    "dispositions": {
      "euthanized": 30, "transferred": 5, "adopted": 2, "other": 1
    },
    "water_quality_exceptions": [ { "tank_id": "...", "date": "...", "parameter": "ammonia_ppm", "value": 0.7 } ],
    "quarantine": { "completed": 6, "in_progress": 1 }
  }
}
```
- P95 target <30s per TRD §8 — implemented as aggregation-pipeline queries against append-only
  collections, with materialized daily rollups (per TRD §4.3) backing the population figures so this
  never requires a full table scan.

### `POST /reports/export`
**Permission:** `report:export` (Manager+).
Body: `{ "date_from", "date_to", "filters": {...}, "format": "pdf" | "csv" }` →
`{ "export_id", "download_url", "checksum" }` (also writes an `export_history` row, see §17).
- PDF templates rendered server-side to be **functionally equivalent** to the original paper forms
  (Appendix 6, Appendix 7, Incident Report layouts) per TRD §12 — pixel parity not required.

### `GET /reports/export/{export_id}`
Returns status + signed download URL (short-lived) for a previously requested export.

---

## 17. Export History & USB Export

| Method & Path | Permission | Notes |
|---|---|---|
| `GET /export-history?date_from=&date_to=&user_id=` | `audit:read` (Chair/Admin) or self | every export attempt, regardless of destination |
| `POST /exports/usb-bundle` | `report:export` (Manager/Admin) | `{ "date_from", "date_to", "format": "csv"|"json"|"pdf_bundle" }` → produces a downloadable archive (CSV/JSON/PDF set + `manifest.json` with checksum) for portable-media transfer per TRD §11 (avoid proprietary lock-in) |

---

## 18. Audit Log

| Method & Path | Permission | Notes |
|---|---|---|
| `GET /audit-logs?actor_id=&entity_type=&entity_id=&action=&date_from=&date_to=` | `audit:read` (Chair/Admin only, per PRD §5) | paginated, immutable, includes `before`/`after` diffs |
| `GET /audit-logs/{id}` | `audit:read` | single event detail |

Every write across every module above **must** call the shared audit-log service (decorator/middleware
at the repository layer, not duplicated per-router) so this list is complete rather than best-effort.
Batch-entry endpoints write **one audit entry per resulting per-tank document**, linked via
`batch_submission_id` in the `after` payload, per TRD §11 risk mitigation.

---

## 19. Settings *(Admin/Chair only)*

| Method & Path | Permission | Notes |
|---|---|---|
| `GET /settings` | `settings:read` | `quarantine_days` (default 14), `safe_ranges` (§11.1), `backup_schedule`, `water_quality_frequency` (§11.3) |
| `PATCH /settings/{key}` | `settings:update` | audited; changes take effect for **future** validations only, never retroactively reinterpret historical readings |

---

## 20. Health & Meta

- `GET /health` — public, liveness/readiness for infra (no data).
- `GET /openapi.json` — FastAPI auto-generated schema (dev/staging only; gate/disable public exposure in
  any eventual production deployment per TRD §5).

---

## 21. Error Codes Quick Reference

| HTTP | `code` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Malformed body, regex mismatch (e.g., AUPP#), invalid enum |
| 401 | `UNAUTHORIZED` | Missing/expired/invalid token |
| 403 | `FORBIDDEN` | Valid token, insufficient permission or out-of-scope tank/room |
| 404 | `NOT_FOUND` | Resource missing or soft-deleted |
| 409 | `CONFLICT` | e.g., deleting a tank with an active assignment; duplicate `aupp_number` |
| 422 | `UNPROCESSABLE` | Business-rule violation (e.g., closing a project without required dispositions) |
| 429 | `RATE_LIMITED` | Login/brute-force throttling |
| 500 | `INTERNAL_ERROR` | Unhandled — logged with `request_id`, never leaks stack trace to client |

---

## 22. Implementation Notes for Sprint 1 (backend bootstrap order)

Recommended build order, matching dependency chain (also feeds the Implementation-Plan phases doc):
1. `users` / `roles` / auth (JWT) — everything else depends on `require_permission`.
2. `facilities` / `rooms` / `tanks` — static scaffolding for the pilot room + 14 tanks.
3. `controlled_vocabularies` — needed before projects/incidents can reference species/food type.
4. `projects` + `tank_assignments` (+ auto-quarantine hook).
5. `census_events` (transactional count updates).
6. `incident_reports`, `water_quality_logs` (+ batch), `food_logs` (+ batch), `maintenance_logs`.
7. `disposition_records` + project close-out.
8. `audit_logs` middleware — retrofit onto every module above before Sprint 1 demo (do not defer; every
   later module must be born with audit coverage, not patched in).
9. `reports/summary`, `reports/export`, `export_history`, `settings`.
