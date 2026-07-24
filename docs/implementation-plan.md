# Implementation Plan — Phased Breakdown
## Animal Care Facility Digital Records System — Phase 1 (Aquatics)

**Document Owner:** University of Windsor — Developed by Apurva Shovit
**Methodology:** Agile/Scrum, 2-week sprints, backlog seeded from PRD.md §7 Epics
**Related Docs:** PRD.md, TRD.md, backend-schema.md, API-documentation.md, UIUX-design.md

---

## Phase 0 — Foundations & Setup (Sprint 0, ~1 week)

**Goal:** everything downstream can start cleanly; no feature work yet.

- Repo scaffolding (backend `apps/api`, frontend `apps/web`), Git branching model, PR template, CI
  skeleton (lint + type-check only for now).
- MongoDB Atlas dev cluster provisioned; Pydantic/Beanie base models for `created_at/updated_at/
  created_by/updated_by/deleted` per backend-schema.md §3.
- FastAPI app skeleton: health check, config/env loading, structured logging.
- React app skeleton: routing shell, theme tokens from UIUX-design.md §7 wired into MUI/Tailwind.
- `memory.md` initialized (empty template ready for first sprint-end update).
- Definition of Ready / Definition of Done agreed (DoD includes: tests passing, `memory.md` updated,
  security checklist item reviewed if touching auth/RBAC).

**Exit criteria:** empty app builds/deploys locally end-to-end (frontend hits backend `/health`).

---

## Phase 1 — Identity, RBAC & Facility Scaffolding (Sprint 1)

Backend build order per API-documentation.md §22, items 1–2.

- **Backend:** `users`, `roles`, JWT auth (login/refresh/logout/me), `require_permission` dependency,
  `facilities`/`rooms`/`tanks` CRUD (Admin/Chair-gated add/remove tank).
- **Frontend:** login screen, role-aware route guarding, Admin screen to seed the one pilot facility/room
  and its 14 tanks.
- **Security checkpoint:** Argon2id password hashing, rate-limited login, audit log wired in from day one
  for auth events (do not defer — TRD explicitly wants audit coverage from the start).

**Exit criteria (demo):** an Admin can log in, create Staff/Manager/Chair users, assign a Staff user to a
subset of the 14 tanks, and that Staff user sees only their assigned tanks on login.

---

## Phase 2 — Vocabularies, Projects & Tank Assignments (Sprint 2)

- **Backend:** `controlled_vocabularies` (species/food type, auto-publish + admin-only delete per PRD Q2/
  Q5), `projects` (AUPP CRUD + regex validation), `tank_assignments` (intake, reassign-with-history),
  auto-quarantine hook on `source_type=external`.
- **Frontend:** Tank/Project intake form (Epic 1 fields), species/food dropdown-with-"Other" component
  (reusable across all forms), Tank reassignment flow with history view.

**Exit criteria (demo):** a Manager can stand up a new AUPP project, assign it to a tank, add a new species
via "Other," and later reassign that project to a different tank while seeing prior-tank history preserved.

---

## Phase 3 — Census, Quarantine & Acquisition Workflow (Sprint 3)

**Backend build order per API-documentation.md §22, item 5.**

- **Backend:** `census_events` (append-only immutable ledger, transactional count updates against parent
  `tank_assignment.current_count`), hatched-on-site direct-census path, transfer pair validation
  (`transfer_group_id`).
- **Frontend:** Census entry flow (single tank, +/- with reason selector); facility/tank census rollup
  views (Manager+); auto-quarantine countdown widget on dashboard (already in place from Phase 2).
- **Security checkpoint:** `census_events` wired into the shared audit decorator immediately; all mutations
  scoped by `census:create` / `census:read:own` / `census:read:facility` per API-documentation.md §9.
  Quarantine records observations/complete endpoints are already audited; audit coverage is verified
  in code review, not deferred.

**Exit criteria (demo):** a Manager performs a census delta (death/transfer/hatch/manual adjustment) on a
single tank, observes the `tank_assignment.current_count` update transactionally in the dashboard, and
later opens the census rollup view to see the full traceable ledger for that tank and for the facility.

### Backend implementation steps

1. **Model — `apps/api/app/models/census_event.py`**
   - `CensusEvent(Document)` inheriting `ImmutableBaseFields` (append-only — `MutableBaseFields` is NOT
     used because census events must never be edited after creation per API-documentation.md §9).
   - Fields: `tank_assignment_id: str`, `tank_id: str`, `date: str` (ISO 8601 UTC), `change: int`,
     `reason: str` (enum: death | arrival | transfer_in | transfer_out | hatched | manual_adjustment),
     `user_id: str`, `transfer_group_id: str | None = None`.
   - Collection name `census_events`; add unique index on `(tank_assignment_id, date)` in `Settings`.

2. **Schema — `apps/api/app/schemas/census.py`**
   - `CensusEventCreate` body: `tank_assignment_id`, `tank_id`, `date`, `change`, `reason`.
     `change` must be non-zero; `reason` validated against enum.
   - `CensusEventResponse`: mirrors all model fields plus isoformatted `created_at`.
   - `CensusSummaryQuery` for rollup queries: `level` (tank | project | facility), `date_from`, `date_to`,
     `facility_id?`, `room_id?`, `tank_id?`.
   - `CensusSummaryResponse`: grouped totals with event ledger reference.

3. **Router — `apps/api/app/routers/census.py`**
   - `POST /api/v1/census-events` (`census:create`)
     - Validates active `tank_assignment` exists for the given `tank_assignment_id`.
     - For `transfer_in`/`transfer_out`: checks that a paired event with matching `transfer_group_id`
       exists within ±24h; rejects with `VALIDATION_ERROR` if missing.
     - Uses a single-document atomic `$inc` on the parent `tank_assignment.current_count` (Motor
       `find_one_and_update` with `return_document=True`) so the count update is atomic with respect
       to the event insert.
     - `created_by` stamped from current user.
     - Audit: `census:create` with `before` (old count) and `after` (new count, reason).
   - `GET /api/v1/census-events` (scoped read)
     - Filters: `tank_assignment_id`, `tank_id`, `date_from`, `date_to`, `reason`, `change`.
     - Paginated; Staff scoped to their own `tank_assignments` via `$in` on `assigned_tank_ids`.
     - No delete or patch endpoint — immutable ledger.

   - `GET /api/v1/census/summary` (`census:read:facility` for facility/project level; staff limited to
     `level=tank` on own tanks)
     - Aggregation pipeline or in-memory rollup over `census_events` joined to `tank_assignments`,
       `tanks`, `rooms`, `facilities`.
     - Returns per-level totals + event ledger.

4. **Register router + model**
   - `app/db.py` — add `CensusEvent` to `init_beanie(document_models=[...])`.
   - `app/main.py` — `app.include_router(census.router)`.

5. **Tests — `apps/api/tests/test_census.py`** (target: 8–10 tests)
   - Create + atomic count update on `tank_assignment.current_count`.
   - Positive/negative change validation.
   - Staff scoping (staff sees only own tanks; manager sees all).
   - Transfer pair creation and rejection when paired event is missing.
   - Summary query filtering by date/tank/facility.
   - RBAC denial (staff → 403 on summary; authenticated → read-only list).

6. **Hatched-on-site direct-census path**
   - Backend: `POST /census-events` already accepts `reason="hatched"`; when `source_type="hatched"`,
     the initial intake creates the `tank_assignment` with `current_count = initial_count`. The first
     census event for a hatched cohort uses `change=0, reason="hatched"` or a configurable offset.
   - Frontend: `IntakeModal` already sends `source_type="hatched"` correctly and bypasses quarantine.

### Frontend implementation steps

1. **API client updates — `apps/web/src/lib/api.ts`**
   - Add `CensusEventResponse`, `CensusSummaryQuery`, `CensusSummaryResponse` interfaces.
   - Add `createCensusEvent(body, change, reason)`, `listCensusEvents(params)`, `getCensusSummary(params)`.

2. **Census entry component — `apps/web/src/components/census/CensusEntryModal.tsx`**
   - Modal with fields: Tank select (filtered to active assignments), Date (default today), +/- selector
     with numeric input (default +1/-1), Reason dropdown (death | arrival | transfer_in | transfer_out |
     hatched | manual_adjustment).
   - On submit, calls `createCensusEvent`.
   - For `transfer_in`/`transfer_out`: generate a client-side UUID `transfer_group_id` and surface a paired
     entry form so staff submit both directions atomically; if the paired submit fails, roll back both
     via a cancel action.

3. **Campus rollup view — `apps/web/src/routes/CensusPage.tsx`**
   - Accessible from Dashboard for Manager+ roles via a tab or card.
   - Top filter bar: date range, level toggle (tank / project / facility).
   - Renders `getCensusSummary` results as summary cards with expandable event ledger.
   - For Staff: `level` is forced to `tank` and tanks are limited to the user's `assigned_tank_ids`.

4. **Dashboard integration**
   - Add "Census" action buttons on each `TankCard` (opening `CensusEntryModal` pre-filled with that tank).
   - Show current `current_count` on `TankCard` (new API field available via `listTanks`).

### Permissions matrix (new)

| Endpoint | Permission | Notes |
|---|---|---|
| `POST /census-events` | `census:create` | Staff on own tanks; Manager/Admin on all |
| `GET /census-events` | `census:read:own` / `census:read:facility` | Staff sees own; Manager sees facility |
| `GET /census/summary` | `census:read:facility` | Staff limited to `level=tank` + own tanks |

### Cross-cutting checks (per Definition of Done)

- `ruff check .` clean, `npm run lint` clean, `npm run type-check` clean.
- Backend tests: `pytest -q` — target ≥8 new tests covering Phase 3 routes.
- All mutations audited (`census:create`).
- No delete/patch endpoints on `census_events` — enforce immutability by omission.
- `memory.md` updated at end of Sprint 3 with retrospective.

---

## Phase 4 — Daily Operational Logging (Sprint 4) — the highest-frequency, highest-value forms

- **Backend:** `incident_reports`, `water_quality_logs` (daily + test-strip, single-entry), `food_logs`
  (single-entry), `maintenance_logs`.
- **Frontend:** Incident Report form (toggle-switch Y/N fields, vet-contacted banner), Appendix 6 daily
  entry screen, Appendix 7 test-strip entry screen with inline safe-range helper text, Food log form,
  Maintenance log form.
- **Security checkpoint:** every new module wired into the shared audit decorator immediately (per
  API-documentation.md §22 item 8's "do not defer" instruction) — verified in code review, not left as a
  Sprint 8 catch-up task.

**Exit criteria (demo):** Staff can complete a full daily round (incident/water-quality/food/maintenance)
for one tank end-to-end on a tablet-sized viewport in under the target time from PRD §11.

---

## Phase 5 — Batch Entry for Linked Tank Groups (Sprint 5)

- **Backend:** `POST /water-quality/batch`, `POST /food-logs/batch` (multi-document Mongo transactions,
  `Idempotency-Key` support, shared `batch_submission_id` tagging for audit grouping).
- **Frontend:** tank-group chip selector ("Tanks 1–8"/"Tanks 9–14"/custom), shared-value entry, per-tank
  confirmation-before-submit list, individual post-batch correction flow.

**Exit criteria (demo):** a single batch submission across 8 tanks creates 8 independently-correctable
records, reflected individually in reports, in one action and one idempotent request.

---

## Phase 6 — Disposition, Project Close-out & Water-Quality Schedule (Sprint 6)

- **Backend:** `disposition_records`, `POST /projects/{id}/close` (with atomic disposition creation),
  `GET /water-quality/schedule` + `settings` endpoints for the frequency table and safe ranges.
- **Frontend:** Project close-out flow (Manager), "due today" chips on water-quality entry screens driven
  by the schedule endpoint, Admin/Chair settings screen for safe ranges & schedule editing.

**Exit criteria (demo):** a Manager closes out a completed AUPP project, recording final disposition
(euthanized/transferred/adopted/other) per remaining tank assignment, and the project no longer appears
in active-project lists.

---

## Phase 7 — Reporting, Export & Audit Log (Sprint 7) — the core inspection use case

- **Backend:** `GET /reports/summary` (aggregation pipelines + materialized rollups), `POST /reports/
  export` (PDF/CSV), `export_history`, `POST /exports/usb-bundle`, `GET /audit-logs` (Chair/Admin).
- **Frontend:** Reports dashboard (date-range + filters → population/incidents/dispositions/water-quality
  exceptions summary), one-click PDF/CSV export matching original paper-form layout, USB export screen,
  Audit Log viewer (Chair/Admin) with before/after diff display.

**Exit criteria (demo):** a Chair or Manager generates a full date-range inspection summary in under 30
seconds, exports it as PDF, and separately reviews the complete audit trail for any record in that range.

---

## Phase 8 — Hardening, Backup/DR, Accessibility & Pilot Readiness (Sprint 8)

- **Backend:** scheduled cloud backup job, backup/restore drill executed and documented, dependency/
  vulnerability scan gates enforced in CI, rate-limiting/session-revocation review, security review pass
  (internal or external) per TRD §5.
- **Frontend:** full WCAG 2.1 AA pass (contrast, keyboard nav, screen-reader labels), empty/error states
  polish, performance pass against TRD §8 targets (P95 <500ms reads/writes; batch submit responsiveness).
- **Docs:** `memory.md` fully caught up; PRD/TRD open questions (§12 PRD, §12 TRD) revisited — confirm any
  still-open items (Epic 5 alert/escalation) before pilot sign-off or explicitly defer to Phase 2 backlog.

**Exit criteria:** go/no-go checklist complete for a limited pilot rollout with real facility staff.

---

## Phase 9 (Post-Pilot / Phase 2 Candidate Backlog — not committed yet)

- Automated vet email notification on `vet_contacted=true` (PRD Q1 fast-follow).
- Full offline write-sync (PRD Q3 fast-follow) beyond client-side draft persistence.
- Institutional SSO integration (PRD Q4 / TRD §12 item 1).
- Out-of-range reading alert/escalation workflow (open PRD Epic 5 item).
- Additional rooms/facilities/species onboarding, validating the multi-room/multi-facility scoping design.
- Native mobile app evaluation, analytics/BI, predictive-mortality exploration.

---

## Cross-Cutting Practices (every sprint, every phase)

- Sprint review/demo of a working increment; retro captured in `memory.md`.
- CI gates: lint, type-check, unit + integration tests, dependency/vulnerability scan — required to merge.
- Every PR touching a new collection/endpoint includes: Pydantic/Beanie model, audit-log wiring, RBAC
  permission check, and at least one test per role in the permission matrix (API-documentation.md §2.1).
- `memory.md` updated at the end of every sprint with: what was built, key decisions made, and anything
  deferred — so no context is lost between LLM-assisted sessions.
