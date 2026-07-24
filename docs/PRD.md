# Product Requirements Document (PRD)
## Animal Care Facility Digital Records System — Phase 1: Aquatics Module
### University of Windsor — Animal Care Department

**Document Owner:** University of Windsor - Developed by Apurva Shovit
**Status:** Draft v0.1
**Last Updated:** July 20, 2026
**Related Docs:** TRD.md, backend-schema.md (future), architecture.md (future)

---

## 1. Purpose & Background

The University of Windsor Animal Care (ACC) department currently records daily animal-care activity — census, incidents, water quality, food, and maintenance — on paper forms (e.g., *Aquatic Incident Reports*, *Appendix 6 — Daily Water Quality Log*, *Appendix 7 — Water Quality Aquarium Test Strips*). These records must be retained for up to **7 years** to satisfy inspection and regulatory requirements (e.g., CCAC-style audits), and staff must be able to reconstruct, for any date range, a full summary of facility activity: animals present, projects run, incidents by project/facility, and final disposition (e.g., euthanized, transferred, adopted).

This process is manual, paper-heavy, error-prone, hard to search, and does not scale. The goal of this project is to **digitize and modernize** this workflow into a secure, mobile/tablet-friendly web application, starting with a **single pilot scope**: one room, 14 fish tanks, fish species only — architected so it can expand to other rooms, species, and workflows over time using Agile delivery.

## 2. Problem Statement

- Staff spend excessive time manually filling out repetitive paper forms (incident, water quality, food, maintenance, census) once or multiple times daily per tank.
- Data is siloed on paper, hard to aggregate, and slow to produce for inspections (e.g., "summarize facility activity from X to Y").
- No structured audit trail of who changed what and when.
- No easy way to batch-update readings for tanks that are physically interconnected and share water parameters (e.g., tanks 1–8 on one recirculating system).
- No structured retention/export strategy for the mandated 7-year record window.
- Access is not segmented by role — anyone touching paper can see everything; there's no enforced least-privilege model.

## 3. Goals & Objectives

| Goal | Description | Success Metric |
|---|---|---|
| G1 | Digitize all identified paper forms into mobile/tablet-friendly digital forms | 100% of Phase 1 forms digitized |
| G2 | Reduce daily data-entry time for staff | ≥50% reduction in time-to-complete daily logs (baseline to be measured) |
| G3 | Enable instant, date-ranged summary generation for inspections | Summary report generated in <30 seconds for any date range |
| G4 | Enforce role-based access control (RBAC) | 0 unauthorized cross-role data access incidents |
| G5 | Guarantee data durability & auditability for 7-year retention | 100% of records recoverable; full audit trail on every change |
| G6 | Support batch and individual operations for linked tanks | Batch update of water quality/food across N tanks in a single action |
| G7 | Provide print & export functionality matching current paper layout (for continuity with inspectors) | Exported PDF matches original form fields |
| G8 | Establish an extensible architecture for future rooms, species, and workflows | New species/room addable without schema rewrite (validated in Phase 2 planning) |

## 4. Scope

### 4.1 Phase 1 (In Scope)
- **Single facility → single room → 14 tanks** (tank count configurable/extensible by Admin: add/remove tanks).
- **Fish only** (species selectable via extensible dropdown).
- Digitization of the following identified paper forms:
  1. Tank/Project intake record (AUPP# and associated metadata)
  2. Arrival form (external acquisition) + 14-day Quarantine form
  3. Daily Census (tank-wise and facility-wise, by date)
  4. Aquatic Incident Report
  5. Appendix 6 — Daily Water Quality Log (pH, DO, Temp; per tank per day)
  6. Appendix 7 — Water Quality Aquarium Test Strips (Nitrate, Nitrite, Total Hardness, Total Chlorine, Total Alkalinity, pH, Ammonia; scheduled by frequency: daily/biweekly/weekly/annually)
  7. Daily Food Log (date, time, food type, amount — extensible dropdown)
  8. Maintenance Log
  9. Tank transfer / reassignment record (AUPP# and fish moving between tanks)
  10. Project close-out / disposition record (euthanized, transferred out, adopted, etc.)
- Batch and individual data entry for linked/grouped tanks (e.g., tanks on a shared recirculating system) with per-tank reflection in summaries.
- Role-based dashboards: **Staff**, **Manager**, **Chair/Head**.
- Summary/report generation by date range, by project, and by facility, with print/PDF export in a layout familiar to inspectors.
- Full audit logging of all record creation/edits/deletions.
- Data export to portable media (USB) for a specified date range.
- Cloud backup of all data.
- Extensible "dropdown + other" pattern: any field using a controlled vocabulary (species, food type) allows free-text entry that is then persisted into the dropdown for future use.
- UWindsor-branded, professional, accessible, mobile/tablet-first UI.

### 4.2 Explicitly Out of Scope for Phase 1 (Future Phases)
- Other rooms, other facilities, other species (mammals, birds, reptiles, etc.) — architecture must anticipate this, but build-out is future work.
- Direct integration with external vet/university email or calendar systems (Phase 1 may support a manual "notify vet" flag/log only; automated email delivery is a candidate Phase 2 feature).
- Native mobile apps (Phase 1 is a responsive web app usable on mobile/tablet browsers, not app-store native apps).
- Advanced analytics/BI (e.g., predictive mortality modeling).
- Multi-institution / multi-tenant support.

## 5. User Personas & Roles (RBAC)

| Role | Description | Access Level |
|---|---|---|
| **Staff** | Direct hands-on animal care; enters daily logs | Read/write only for tanks/rooms explicitly assigned to them. Cannot see other rooms/tanks or admin/audit data. |
| **Manager** | Oversees entire facility; liaises with vet; produces documentation/summaries | Read/write for entire facility (all rooms/tanks); can generate and export summaries; cannot alter system-level configuration (e.g., user role assignment) unless also granted Admin. |
| **Chair/Head** | Department head; Manager reports to them | Read access to entire facility, all historical data, and **full audit logs** (who changed what, when, from where). Can view cross-facility summaries. Not necessarily a daily data-entry role for routine logs, but **has add/append write access to rooms and tanks** (e.g., to stand up a new project) — see §12 Q6. (Project-level workflows themselves remain out of scope for Phase 1.) Ability to escalate privilege/demote users/suspend and reactivate/approve new users. All abilities of Admin as well. |
| **Admin** *(system role, may overlap with Manager/Chair)* | Manages tanks (add/remove), users, role assignments, dropdown vocabularies, system configuration | Full system configuration access; still subject to audit logging. |

### 5.1 RBAC Principles
- Principle of least privilege by default.
- Staff assignment to rooms/tanks must be explicit and auditable (who assigned whom, when).
- All role elevation/changes are themselves audited events.
- Session-level and record-level access checks enforced server-side (never trust client-side role checks alone).

## 6. Agile Delivery Approach

This project will be delivered using **Agile/Scrum**, with:
- 2-week sprints (adjustable to team preference).
- A living backlog seeded from this PRD, organized into Epics (see §7).
- Definition of Ready / Definition of Done to be established in TRD.
- Each sprint should end with a demoable increment; PRD/TRD are living documents updated as scope is refined.
- `memory.md` (see companion deliverable) will track cumulative implementation decisions sprint over sprint so context isn't lost between LLM-assisted sessions.

## 7. Epics & User Stories (Phase 1)

### Epic 1 — Tank & Project Management
- As an **Admin**, I can add or remove a tank from the room so the tank inventory reflects reality.
- As a **Chair/Head**, I can also add or remove a room/tank (same capability as Admin), so I can stand up space for a new project without waiting on Admin (project-level workflows remain out of scope for Phase 1 — see §12 Q6).
- As a **Staff/Manager**, I can create a new tank/project record with: DOB (optional), Species (dropdown + other), Sex (male/female/both), Tank number, Number of animals, Established date, Source, Principal Investigator, AUPP# (format `XX-XX`), AUPP expiry date, Project title, RM#.
- As a **Staff/Manager**, I can edit the tank assignment for an existing AUPP# (e.g., when fish are moved for cleaning or growth separation) while preserving full history of prior tank assignments.

### Epic 2 — Acquisition & Quarantine
- As a **Staff**, I can record a new fish **arrival** from another facility, capturing arrival details and automatically initiating a 14-day quarantine period.
- As a **Staff**, I can log **quarantine** observations/status during the 14-day window.
- As a **Staff**, I can record fish **hatched on-site** (no arrival/quarantine form required), incrementing census directly.

### Epic 3 — Census
- As a **Staff**, I can record the fish count for a tank on a given date (increase/decrease with reason: died, transferred out, transferred in, brought in, hatched).
- As a **Manager/Chair**, I can view census rollups by tank, by project, and facility-wide, for any date or date range.

### Epic 4 — Incident Reporting
- As a **Staff**, I can log an incident (sick/dead fish, etc.) capturing: Room#, Species, PI, AUPP#, Date, Time, Tank#, Date Established, Problem, Comments, Treatment/Solution, Aquatic Condition Checklist (Y/N), Vet Contacted (Y/N), Researcher Notified (Y/N), Initials.
- As a **Manager**, I can be notified/flagged when an incident requires vet contact.

### Epic 5 — Water Quality Logging
- As a **Staff**, I can record the **Daily Water Quality Log** (Appendix 6: pH, DO, Temp per tank per day, comments, initials).
- As a **Staff**, I can record the **Water Quality Test Strip** reading (Appendix 7: Nitrate, Nitrite, Total Hardness, Total Chlorine, Total Alkalinity, pH, Ammonia, comments, initials), respecting the required testing **frequency schedule** (daily for Temp/O2/pH; biweekly for Ammonia/Nitrite/Nitrates/Total Hardness; weekly for Nitrogen/Salinity; annually for Chlorine, per recirculated-tank rules).
- As a **Staff**, I can **batch-enter** a water quality reading across a defined group of linked tanks (e.g., 1–8, 9–14) in one action, and the system stores/reflects the value individually per tank for summary purposes.
- As a **Staff**, I can also enter a water quality reading for a **single tank individually**, without going through a group — this is the common case for a tank that isn't part of a shared system, or for a one-off correction on a single tank within a group.
- As a **Staff/Manager**, I am alerted if a submitted reading falls outside the expected safe range (e.g., Nitrite must read 0 ppm) so it can be flagged/escalated. --optional needs clarification from the user.

### Epic 6 — Food Logging
- As a **Staff**, I can record a food log entry: date, time, food type, amount (dropdown + other, persisted globally), amount.
- As a **Staff**, I can batch and individual apply a food log entry across linked tanks.
- As a **Staff**, I can set a particular food type and it's amount linked to a tank, so that other staff can feed the fish in my absence.

### Epic 7 — Maintenance Logging
- As a **Staff**, I can record maintenance activity performed on a tank (date, time, description, initials).

### Epic 8 — Project Close-out / Disposition
- As a **Manager**, I can close out a project/AUPP# and record final disposition per fish/tank (e.g., euthanized, transferred to another facility, adopted), with date and reason.

### Epic 9 — Reporting & Summaries
- As a **Manager/Chair**, I can generate a summary for a date range showing: animals present/brought in, projects active, incidents (by project and by facility), and final disposition outcomes.
- As a **Manager**, I can print or export any report/log in a layout consistent with the original paper form, for inspector-facing use.
- As a **Chair**, I can view full **audit logs** of all record changes facility-wide.

### Epic 10 — Data Management, Backup & Export
- As an **Admin**, the system automatically backs up all data to a secure cloud location on a defined schedule.
- As a **Manager/Admin**, I can export all records for a specified date range to a portable USB drive in a structured, importable/human-readable format.
- As a **Chair/Admin**, I can view a full audit trail for any record, export, or configuration change.

### Epic 11 — RBAC & Identity
- As an **Admin**, I can create user accounts and assign roles (Staff/Manager/Chair) and room/tank assignments.
- As any **user**, I can only see and act on data permitted by my role and assignment.

### Epic 12 — Extensible Vocabularies
- As a **Staff**, when I select "Other" on a dropdown (species, food type, etc.) and type a new value, that value is added to the shared dropdown list for all future entries (subject to Admin review/cleanup as needed - only admin will be able to delete wrong options).

## 8. Functional Requirements Summary (Traceability to Forms)

| Paper Form | Digital Equivalent | Key Fields |
|---|---|---|
| Tank/Project Intake (verbal spec) | Tank/Project record | DOB, Species, Sex, Tank#, # of animals, Established date, Source, PI, AUPP# (`XX-XX`), Expiry date, Project title, RM# |
| Arrival Form | Acquisition — Arrival | Source facility, date, species, quantity, condition on arrival |
| Quarantine Form | Acquisition — Quarantine | 14-day tracking, observations, status |
| Aquatic Incident Reports | Incident Report | Room#, Species, PI, AUPP#, Date, Time, Tank#, Date Established, Problem, Comments, Treatment/Solution, Aquatic Condition Checklist Y/N, Vet Contacted Y/N, Researcher Notified Y/N, Initials |
| Appendix 6 — Daily Water Quality Log | Water Quality (Daily) | Room, Species, AUPP#, PI, Date, Tank#(s), pH, DO, Temp, Comments, Initials |
| Appendix 7 — Water Quality Test Strips | Water Quality (Test Strip) | Room, AUPP#, Species, PI, Date, Tank ID, Nitrate, Nitrite, Total Hardness, Total Chlorine, Total Alkalinity, pH, Ammonia, Comments, Initials |
| (Verbal) Food Log | Food Log | Date, Time, Food type (dropdown+other), Amount |
| (Verbal) Maintenance Log | Maintenance Log | Date, Time, Description, Initials |

## 9. Non-Functional Requirements

| Category | Requirement |
|---|---|
| **Security** | Enterprise-grade security posture appropriate to an institutional deployment; see TRD §Security for detail (OWASP ASVS-aligned, encryption in transit & at rest, MFA for elevated roles, least-privilege RBAC, full audit logging). |
| **Data Retention** | Records retained and recoverable for a minimum of **7 years**; deletion (if ever permitted) must be a governed, audited process, not a raw delete. |
| **Availability** | Target 99.5% uptime for Phase 1 (single-facility pilot); documented maintenance windows. |
| **Performance** | Form submission acknowledged in <1s under normal load; summary report for a 1-year range generated in <30s. |
| **Usability** | Optimized for mobile/tablet data entry in a wet/gloved-hands environment: large touch targets, minimal typing, smart defaults, offline-tolerant where feasible (see TRD). |
| **Accessibility** | WCAG 2.1 AA target for web/dashboard UI. |
| **Auditability** | Every create/update/delete/export/login/permission-change event is logged with actor, timestamp, before/after values where applicable. |
| **Backup/DR** | Automated cloud backups on a defined schedule + on-demand USB export for a date range; documented recovery process. |
| **Extensibility** | Data model and UI must support adding new rooms, tanks, species, and forms without a full rewrite (Agile-friendly schema — see backend schema doc). |
| **Branding** | UI/UX aligned with University of Windsor visual identity (colors, typography, logo usage per university brand guidelines). |

## 10. Assumptions & Constraints

- Phase 1 is scoped to one room with 14 tanks, but the tank count must be admin-configurable (add/remove) from day one.
- All fish in a given tank belong to a single species at a time (per current form design).
- No authoritative species list exists yet at launch; the species dropdown is seeded with defaults reflecting species commonly found in the river at Windsor, and staff can auto-add new species via the "Other" pattern (see §12 Q2). Deletion of vocabulary entries is Admin-only.
- AUPP# format is fixed: `XX-XX` where each `X` is a digit 0–9.
- Users will primarily access the system via mobile/tablet browsers in the facility, and via desktop browsers for reporting/admin tasks.
- University of Windsor brand assets (logo, color palette, fonts) will be made available or sourced from public brand guidelines.
- Regulatory/inspection record format expectations (paper-equivalent PDF export) must be preserved for continuity with existing audit practice.

## 11. Success Metrics (Phase 1 Pilot)

- 100% of daily logging activity for the pilot room conducted digitally within [X weeks] of launch.
- Inspector-ready summary report generated on demand in under 30 seconds.
- Zero unaudited data changes (100% of changes attributable to a user + timestamp).
- Positive staff usability feedback (qualitative survey post-pilot).
- Successful 7-year-equivalent backup/restore drill completed pre-launch.

## 12. Open Questions — Resolved (see backlog for follow-through)

| # | Question | Decision |
|---|---|---|
| Q1 | Should "vet contacted" trigger an automated notification in Phase 1, or remain a manual flag/log? | **Manual flag/log only** for current scope. Automated notification remains a candidate fast-follow. |
| Q2 | What is the authoritative list of allowed species at launch, and who owns curation of dropdown additions (auto-add vs. admin-approval queue)? | **No authoritative list yet.** Dropdown ships with defaults reflecting species found in the river at Windsor. New species are **auto-added by Staff** (no approval queue); **deletion is Admin-only**. |
| Q3 | Is offline data entry a hard Phase 1 requirement, or a fast-follow? | **Not a hard Phase 1 requirement.** Client-side draft persistence (survives a dropped connection) is sufficient for now; full offline-write-sync is a fast-follow candidate. |
| Q4 | What identity provider should be used — University of Windsor SSO vs. standalone auth? | **Standalone for now** (local `users` table, hashed credentials). SSO integration is deferred, not designed against yet. |
| Q5 | What is the exact required retention/export file format expected by inspectors? | **No fixed format specified yet.** Priority for now is that records are clearly visible/accessible in the dashboard; a general-purpose PDF export is sufficient. An exact inspector-specified format may be defined later. |
| Q6 | Does "Chair/Head" need write access anywhere, or is it intentionally read+audit only? | **Chair/Head has add/append access to rooms and tanks** (e.g., to set up space for a new project), in addition to full read/audit access. Project-level workflows remain out of scope for Phase 1. |

**Still open (not yet answered):** Epic 5's out-of-range reading alert/escalation (§7 Epic 5, marked "optional — needs clarification") is still pending your input.

## 13. Appendix — Source Documents

- *Aquatic Incident Reports* (University of Windsor, ACC)
- *Appendix 6 — Daily Water Quality Log*, ACC SOP AH24 (June 2026)
- *Appendix 7 — Water Quality Aquarium Test Strips, Fresh Water-Static & Recirculated Tanks*, ACC SOP AH24 (Revised May 2024)