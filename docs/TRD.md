# Technical Requirements Document (TRD)
## Animal Care Facility Digital Records System — Phase 1: Aquatics Module
### University of Windsor — Animal Care Department

**Document Owner:** University of Windsor - Developed by Apurva Shovit
**Status:** Draft v0.1
**Last Updated:** July 20, 2026
**Related Docs:** PRD.md, backend-schema.md (future), architecture.md (future)

---

## 1. Overview

This TRD translates the PRD into concrete technical requirements for a secure, extensible, mobile-first web application for the University of Windsor Animal Care department. It assumes a **React** frontend, a **Python/FastAPI** backend, and **MongoDB** (via MongoDB Atlas) as the database, with security and auditability treated as first-class, non-negotiable requirements (institutional-grade, "big MNC building for a university" posture) even while the project is still in active development.

**Current project stage:** development only. There is no production deployment target decided yet, and authentication is intentionally **standalone** (a local `users` collection with hashed credentials) rather than integrated with any institutional identity provider. Both of these are expected to evolve — see §5 (Security) and §9 (DevOps/CI-CD) for what's fixed now vs. deferred.

Detailed database schema and system architecture diagrams are deferred to companion documents (`backend-schema.md`, `architecture.md`) per the phased documentation plan; this TRD defines the *requirements* those documents must satisfy.

## 2. Technology Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | **React** (TypeScript) | Component-based; supports web app + role-specific dashboards from one codebase |
| Frontend state/data | React Query (or equivalent) + Context/Redux Toolkit | For server-state caching, optimistic UI on forms |
| Backend | **Python 3.12+ / FastAPI** | Async-first, native OpenAPI schema generation, strong typing via Pydantic |
| Database | **MongoDB** (hosted on **MongoDB Atlas**) | Document store; well suited to the extensible, form-shaped, per-species/per-tank variable schema described in the PRD. Access via an async driver (Motor) directly, or an ODM (Beanie/ODMantic) for schema-shape discipline on top of Pydantic models. |
| Schema versioning | Application-level migration scripts (e.g., a lightweight custom migration runner, or `mongodb-migrations`/`Migrate-Mongo`-style tooling) | MongoDB has no enforced schema, so **versioned, reviewable migration scripts are still required in practice** — each collection's expected document shape is defined via Pydantic/ODM models, and migrations backfill/transform existing documents when shapes change, to keep Agile iteration safe. |
| Auth | **Standalone, local authentication for now**: `users` collection with securely hashed credentials (Argon2id) + JWT access/refresh tokens issued by the FastAPI backend | No SSO/MFA for the current phase (see §5). Designed so an institutional IdP (SSO) can be layered in later without a data-model rewrite — see §9 roadmap note. |
| Caching / Sessions | Redis (optional for current dev phase; add when needed for rate limiting/session revocation at scale) | Session/token blacklist, rate limiting, background job queue backing |
| Background jobs | Celery or FastAPI + APScheduler / Arq | Scheduled backups, quarantine-day countdowns, reminder generation |
| File/Export storage | MongoDB Atlas-adjacent object storage or Atlas GridFS for now; a dedicated object store (e.g., S3/Azure Blob) can be introduced later if export volume grows | PDF exports, USB export bundle staging, backups |
| PDF generation | WeasyPrint or ReportLab (server-side) | Functionally equivalent to the original paper forms is sufficient — pixel-parity is not required (see §12) |
| Hosting | **Not yet decided — development phase only.** No production hosting target is committed at this stage; the app currently runs in local/dev environments only. | To be revisited before any production rollout planning; keep the backend container-friendly (Docker) so the eventual hosting choice (institution cloud, on-prem, etc.) doesn't require rework. |
| CI/CD | GitHub Actions (or institution standard) — can start minimal (lint/type-check/test) and grow | Lint, type-check, test, dependency-vulnerability scan; build/deploy gates to be added once a hosting target is chosen |

## 3. Architecture Requirements (summary — full detail in architecture.md)

- **Three-tier separation**: React SPA (web app + dashboards) ↔ FastAPI REST API ↔ MongoDB.
- **Modular monolith to start**, structured internally by domain (tanks, census, incidents, water-quality, food, maintenance, users/auth, audit, reporting) so it can be split into services later if needed — avoid premature microservices complexity for Phase 1 scale.
- **API-first design**: all frontend surfaces (web app, staff dashboard, manager dashboard, head dashboard) consume the same versioned REST API — no logic duplicated client-side vs. server-side for validation/authorization.
- **Domain-driven schema**: entities modeled around real objects as **MongoDB collections** (Tank, Project/AUPP, CensusEvent, Incident, WaterQualityReading, FoodLogEntry, MaintenanceLogEntry, User, Role, AuditLogEntry, ControlledVocabulary) to support extension to new rooms/species without redesign. Each collection has an application-enforced document shape (Pydantic/ODM model) even though MongoDB itself is schemaless — this is what keeps the "add new fields/forms later" Agile goal safe rather than chaotic.
- **Multi-room/multi-facility ready**: even though Phase 1 ships one room/14 tanks, every core document carries a `facility_id` / `room_id` reference field from day one (not retrofitted later), so filtering/scoping by facility or room is a first-class query, not a future migration.
- **Referential integrity in a document model**: MongoDB doesn't enforce foreign keys, so cross-collection references (e.g., a `WaterQualityReading` referencing a `tank_id`) are validated at the application layer, and multi-document writes that must succeed or fail together (e.g., a batch water-quality submission fanning out to N tank documents) use **MongoDB multi-document ACID transactions**, which Atlas supports on replica sets.

## 4. Functional-to-Technical Mapping

### 4.1 Tank & Project Management
- CRUD API for Tanks (admin-only create/delete; capacity for soft-delete/deactivate rather than hard delete to preserve historical integrity).
- CRUD API for Project/AUPP records, versioned so a tank reassignment creates a new **assignment history** row rather than overwriting the prior tank link.
- Server-side validation of AUPP# format `^\d{2}-\d{2}$`.

### 4.2 Acquisition & Quarantine
- Arrival endpoint creates a Fish Batch + auto-generates a linked Quarantine record with a computed 14-day end date.
- Scheduled job flags quarantine records nearing/at expiry for dashboard visibility (Staff/Manager).
- Hatched-on-site path bypasses quarantine, directly incrementing census with a `source_type = hatched` tag.

### 4.3 Census
- Append-only **Census Event** log (not a mutable running total) so historical census-on-date-X can always be reconstructed by aggregation — critical for the "summarize facility from X to Y" inspection use case.
- Materialized/cached rollups (tank/day, facility/day) refreshed on write for fast summary queries.

### 4.4 Incident Reporting
- Incident endpoint persists all PRD §8 fields; boolean fields (`vet_contacted`, `researcher_notified`, `aquatic_condition_checklist`) stored as true booleans, not free text.
- Optional workflow hook: incident with `vet_contacted = true` can raise a flagged item on the Manager dashboard (Phase 1: in-app flag; automated email notification is a candidate fast-follow per PRD open question).

### 4.5 Water Quality Logging
- Two distinct record types (Daily Log — pH/DO/Temp; Test Strip — Nitrate/Nitrite/Hardness/Chlorine/Alkalinity/pH/Ammonia), each with its own required-frequency metadata (daily/biweekly/weekly/annually) driven by a configurable schedule table, not hardcoded logic — supports future parameter changes without code deploys.
- **Batch entry**: a `TankGroup` entity (e.g., "Tanks 1–8") allows one submission to fan out into individual per-tank `WaterQualityReading` rows, each independently queryable/reportable, satisfying the PRD requirement that summaries reflect per-tank data even when entry was batched.
- Range validation engine compares submitted values against configured safe ranges (e.g., Nitrite expected 0 ppm) and flags out-of-range readings for review; ranges stored as data, not hardcoded, so they can be tuned per species/tank type later.

### 4.6 Food & Maintenance Logs
- Standard CRUD endpoints; food log entries reference the shared extensible `food_type` vocabulary (see §4.8) and support the same batch-entry mechanism as water quality.

### 4.7 Project Close-out / Disposition
- Disposition endpoint records outcome per fish batch/tank/project (`euthanized`, `transferred_external`, `adopted`, `other` + free text) with date, reason, and authorizing user; closes the project record (soft-close, not delete) and freezes further census writes for that AUPP unless reopened by Manager/Admin with an audited reason.

### 4.8 Extensible Vocabularies ("dropdown + other")
- Generic `ControlledVocabulary` table (`type` = species / food_type / etc., `value`, `created_by`, `created_at`, `active`) backing all such dropdowns.
- Submitting a new "Other" value inserts a new row (flagged `pending_review` if Admin curation is desired — resolve via PRD open question #2) and the value is immediately available in that user's session and, on confirmation, globally.

### 4.9 Reporting & Summaries
- Reporting endpoints accept `date_from`, `date_to`, and optional filters (`project_id`, `facility_id`, `room_id`, `tank_id`) and return structured JSON consumed by both the web dashboard and the PDF export generator, ensuring on-screen and printed data are always identical.
- PDF templates for each original form (Incident, Appendix 6, Appendix 7) built to visually mirror the source documents for inspector familiarity.

### 4.10 Backup & Export
- **Cloud backup**: automated, encrypted, scheduled (e.g., nightly full + continuous WAL/point-in-time recovery if supported by the managed DB), retained per the 7-year policy, with periodic restore drills documented.
- **USB export**: authenticated, audited endpoint that packages all records for a date range into a structured export bundle (e.g., CSV/JSON + generated PDFs) for download to removable media; export action itself is an audited event capturing who exported what range and when.

### 4.11 Audit Logging
- Every mutating request (create/update/delete), every export, every login/logout, and every permission change writes an immutable `AuditLogEntry` (actor_id, role_at_time, action, entity_type, entity_id, before_value, after_value, timestamp, source_ip/device where feasible).
- Audit log is **append-only** at the database level (no update/delete grants on that table for application roles); Chair/Head role has read access to the full audit trail.

## 5. Security Requirements

Security is treated as a hard requirement, not a nice-to-have, consistent with an institutional/regulated-data deployment.

- **Authentication**: OIDC/OAuth2 against University of Windsor SSO where available; fallback local auth with salted+hashed passwords (Argon2id) if SSO unavailable for a given rollout stage. MFA enforced for Manager, Chair, and Admin roles.
- **Authorization**: Server-side RBAC enforced on every endpoint (deny-by-default); role + room/tank assignment checked per PRD §5. No client-side-only authorization.
- **Transport security**: TLS 1.2+ everywhere; HSTS enabled.
- **Data at rest**: Database and object storage encryption at rest (provider-managed keys minimum; customer-managed keys preferred for institutional data).
- **Input validation**: All inputs validated server-side via Pydantic schemas; strict allow-lists for enumerated fields (species, food type, sex, etc.).
- **OWASP alignment**: Development follows OWASP ASVS / Top 10 mitigations — parameterized queries only (ORM-enforced, no raw SQL string interpolation), CSRF protection for state-changing requests, strict CORS policy, secure cookie flags (`HttpOnly`, `Secure`, `SameSite`), Content-Security-Policy headers, output encoding to prevent XSS.
- **Secrets management**: No secrets in source control; managed via a secrets manager/vault and environment injection per environment (dev/staging/prod).
- **Dependency management**: Automated vulnerability scanning (e.g., `pip-audit`/Dependabot for Python, `npm audit`/Dependabot for React) gating CI; regular patch cadence.
- **Rate limiting & abuse prevention**: API rate limiting per user/IP; account lockout/backoff on repeated failed auth attempts.
- **Least privilege infrastructure**: Database service accounts scoped per environment; audit-log table has no delete/update grants for the application role.
- **Session management**: Short-lived JWT access tokens + rotating refresh tokens; ability to revoke sessions (e.g., on role change or offboarding).
- **Logging & monitoring**: Centralized application/security logging (excluding sensitive payloads), alerting on anomalous access patterns (e.g., mass export, repeated cross-role access denials).
- **Data retention & deletion governance**: No hard deletes of clinical/audit-relevant records within the 7-year window; any deletion capability is a governed, audited, role-gated workflow.
- **Penetration testing / security review**: Recommend a security review or pen test pass before production go-live, given institutional deployment context.

## 6. Frontend Requirements

- **Mobile/tablet-first responsive design**, usable one-handed or with gloves where feasible (large touch targets, minimal free-text entry, smart defaults e.g. today's date, last-used tank group).
- Role-aware routing/dashboards: distinct **Staff**, **Manager**, and **Chair/Head** dashboard views built from shared components, gated by the authenticated user's role/permissions returned by the API (never inferred purely client-side).
- Form UX: dropdowns with searchable "Other → add new" pattern; inline validation matching backend rules (e.g., AUPP# format) for fast feedback.
- Batch-entry UI: tank-group selector enabling one water-quality/food submission to apply to a linked group, with a clear per-tank preview before submit.
- Print/export UI: one-click "Export as PDF" per report/log view, matching the original paper layout.
- Offline tolerance (Phase 1 target — confirm via PRD open question #3): at minimum, resilient client-side form-draft persistence so an entry in progress survives a dropped connection; full offline-write-sync is a candidate fast-follow if required.
- Accessibility: semantic HTML, keyboard navigability, WCAG 2.1 AA color contrast — reinforced by the UWindsor palette chosen in the design-palette deliverable.

## 7. Backend/API Requirements

- RESTful API, versioned (`/api/v1/...`), documented automatically via FastAPI's OpenAPI/Swagger generation.
- Consistent error/response envelope and status-code conventions across all endpoints.
- Pagination, filtering, and sorting standardized across list endpoints (esp. census, incidents, water-quality, audit log).
- All list/report endpoints support `date_from`/`date_to` filtering as a first-class concern (core to the inspection use case).
- Idempotency considered for batch-entry endpoints to avoid duplicate submissions on retry (e.g., idempotency key on client).

## 8. Non-Functional / Quality Requirements

| Category | Requirement |
|---|---|
| Performance | P95 API response <500ms for standard reads/writes; summary generation <30s for a 1-year range |
| Scalability | Architecture must scale from 1 room/14 tanks to multiple rooms/facilities without schema redesign (facility/room scoping built in from day one) |
| Availability | 99.5% target; documented maintenance windows; automated health checks |
| Testing | Unit tests (backend logic, especially census/audit correctness), integration tests (API contract), and E2E tests (critical user flows: log entry, batch entry, report export) required in CI before merge |
| Code quality | Type-checked (TypeScript strict mode; Python type hints + mypy/pyright), linted (ESLint/Prettier; ruff/black), enforced in CI |
| Documentation | OpenAPI spec auto-generated and published; component-level docs for frontend; `memory.md` updated each sprint with implementation decisions |
| Environments | Isolated dev/staging/prod with environment-specific config and secrets; staging used for UAT before each release |

## 9. DevOps / CI-CD & Agile Engineering Practices

- Git-based workflow (see companion folder-structure deliverable) with protected `main` branch, PR review required, CI must pass (lint, type-check, tests, dependency scan) before merge.
- Semantic versioning for API and releases.
- Automated migrations (Alembic) applied via CI/CD pipeline with rollback plan.
- Feature-flag capability recommended for staged rollout of new form/field changes without disrupting daily use.
- Sprint cadence: backlog groomed from PRD Epics (§7); each sprint produces a demoable increment; Definition of Done includes: tests passing, security checks passing, docs/`memory.md` updated.

## 10. Compliance & Institutional Considerations

- Retention: minimum 7-year retention for all care/incident/audit records, enforced technically (no premature purge) and procedurally (documented retention policy).
- Accessibility: WCAG 2.1 AA as the target standard for all user-facing surfaces.
- Branding: UI must follow University of Windsor visual identity guidelines (logo usage rules, color palette, typography) — detailed in the companion UI/UX design-palette deliverable.
- Data residency/provider: cloud provider and region selection should follow University of Windsor IT policy (to be confirmed with institutional IT/security office before finalizing hosting choice).

## 11. Risks & Technical Considerations

| Risk | Mitigation |
|---|---|
| Schema rigidity blocking future species/rooms | Facility/room/species modeled generically from Phase 1; controlled vocabularies data-driven, not enum-hardcoded in code |
| Batch entry creating ambiguous audit trail | Batch submissions still generate one audit entry *per resulting per-tank record*, linked by a shared `batch_submission_id` |
| Paper-to-digital transition resistance from staff | Mobile-first UX, minimal-friction forms, smart defaults, and pilot feedback loop built into Agile process |
| Regulatory/audit format mismatch | PDF export templates validated against original paper forms before go-live sign-off |
| Vendor/cloud lock-in for backups | Use standard export formats (CSV/JSON/PDF) for USB export bundles; avoid proprietary backup-only formats |

## 12. Open Technical Questions (to resolve during backlog refinement)

1. Confirm institutional identity provider (SSO) availability and protocol (SAML vs OIDC) for auth integration.-**Ans:** Deffered for later
2. Confirm preferred cloud provider / data residency requirements from University of Windsor IT. -**Ans:** Deffered for later
3. Confirm whether offline-capable data entry is a hard Phase 1 requirement.-**Ans:** not a hard requirement for phase 1
4. Confirm PDF export must be pixel-parity with existing paper forms, or functionally equivalent is acceptable.-**Ans:**Functionally equivalent is acceptable
5. Confirm curation model for new "Other" dropdown values (auto-publish vs. admin-approval queue). -**Ans:** Auto-approved, but delte only for admin/head/chair.
