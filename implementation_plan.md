# Implementation Plan (Revised) — Data Export & Backup System

## Overview

A complete data export system for ACARE allowing **manager-level and above** to:
1. **Select a date range** (or export everything with a one-click Full Backup)
2. **Download all data** across all 12 collections
3. In **two formats**:
   - **Machine format (JSON)** — a clean, structured JSON bundle preserving referential integrity for future recovery/import
   - **Human format (Excel / `.xlsx`)** — a multi-sheet, human-readable workbook for readability and audits

The import/recovery side will be implemented in a future phase.

---

## Resolved Decisions

> [!IMPORTANT]
> **Date Range / Referential Integrity (Resolved):** Static/dimension entities (`users`, `facilities`, `rooms`, `tanks`, `species`) are **always exported in full**, regardless of the date range. Date filtering applies **only** to transactional/event collections (`census_events`, `water_quality_logs`, `incident_reports`, `audit_logs`, `quarantine_exemptions`, `projects`, `tank_assignments`). This preserves referential integrity in the JSON backup so that event records never reference entities missing from the file.

> [!IMPORTANT]
> **Soft-deleted Records (Resolved):** Soft-deleted records (`deleted: true`) are **included by default** in exports — the point of a backup is completeness. No toggle needed.

> [!IMPORTANT]
> **Password Hashes (Resolved):** JSON backup includes `password_hash` (required for recovery). Excel export **excludes** it. The export action is itself audit-logged (see below). The downloaded file should be treated as a secret — not auto-uploaded to shared drives, retained for a short period, and handled like any credential store.

> [!IMPORTANT]
> **Access Control (Resolved):** Restricted to **manager-and-above** roles (`manager`, `chair`, `admin`, `super_admin`). Staff cannot access the export endpoint or page.

> [!IMPORTANT]
> **Confirmation Step (Resolved):** A confirmation modal is required before download is triggered. Since the JSON format contains password hashes, users must acknowledge a security notice before the request is issued.

> [!IMPORTANT]
> **Partial Failure (Resolved):** If a single collection query throws during bundle construction, the **entire request fails** (no partial exports). A clear error message is returned to the frontend. Silent partial exports are more dangerous than an explicit failure.

> [!IMPORTANT]
> **Quarantine Exemptions Filter (Resolved):** Filter on `requested_at`. Exemptions *requested* inside the date range are included, regardless of when they were decided. The `decided_at` column is still exported as a field value.

> [!IMPORTANT]
> **Date Boundaries (Resolved):** `start_date` is **inclusive** (≥ start of day UTC), `end_date` is **inclusive** (< start of day after end_date UTC). Validation enforces `start_date <= end_date`. Malformed ISO strings return HTTP 422.

---

## Proposed Changes

### Backend — New Router + Service + Dependencies

---

#### [NEW] `apps/api/requirements.txt` — add `openpyxl`
- Used for `.xlsx` generation (pure Python, no Excel installation needed).
- If already present, no change needed (will verify during implementation).

---

#### [NEW] [export_service.py](file:///c:/Users/HP/Desktop/Uwin/ACARE/MVP-Acare/apps/api/app/services/export_service.py)

**Key design decisions reflected in code:**

1. **`build_export_bundle(start_dt, end_dt, actor_id, actor_role)`**
   - **Static entities** (always full): `users`, `facilities`, `rooms`, `tanks`, `species`
   - **Transactional entities** (date-filtered): `projects`, `tank_assignments`, `census_events`, `water_quality_logs`, `incident_reports`, `quarantine_exemptions`, `audit_logs`
   - Soft-deleted records **included** for all collections
   - If any collection query raises, the exception propagates — no partial bundles
   - Inserts an `AuditLog` entry *after* bundle is successfully built:
     ```python
     AuditLog(action="data_export", entity_type="system", entity_id="export",
              after={"format": format, "start_date": ..., "end_date": ..., "record_counts": {...}})
     ```

2. **`generate_json_export(bundle) -> bytes`**
   - `json.dumps(bundle, default=str, ensure_ascii=False, indent=2).encode("utf-8")`
   - Includes all fields including `password_hash`
   - Returns raw bytes — caller uses `Response(content=bytes, media_type="application/json")`

3. **`generate_excel_export(bundle, lookup_maps) -> BytesIO`**
   - Returns `BytesIO` — caller uses `StreamingResponse`
   - **Batch lookup maps built once before any row loop** (avoids N+1):
     - `user_map: {id → "First Last"}` from `bundle["users"]`
     - `tank_map: {id → tank_number}` from `bundle["tanks"]`
     - `room_map: {room_id → room_number}` from `bundle["rooms"]`
     - `facility_map: {facility_id → name}` from `bundle["facilities"]`
     - `project_map: {id → title}` from `bundle["projects"]`
   - **Formatting rules applied in-memory to Excel only** (not JSON):
     - `datetime` → `"Fri, Jul 31, 2026, 10:03 AM"` (consistent with ACARE date format rule)
     - `bool` → `"Yes"` / `"No"`
     - `None` → `""` (empty cell)
     - Actor/creator IDs → resolved names via `user_map`
     - Tank/Project IDs → resolved names via respective maps
   - **Password hash excluded** from Users sheet
   - **Workbook structure** (one sheet per collection + summary):

| Sheet | Notes |
|-------|-------|
| `📋 Summary` | Export metadata + record count per collection |
| `Users` | No `password_hash` column |
| `Facilities` | |
| `Rooms` | Facility Name resolved |
| `Tanks` | Room + Facility resolved |
| `Species` | |
| `Projects` | |
| `Tank Assignments` | Project + Tank resolved |
| `Census Events` | Tank + Project + Actor resolved |
| `Water Quality` | Tank + Actor resolved, parameters unpacked |
| `Incident Reports` | Tank + Project + Actor resolved |
| `Quarantine Exemptions` | Source/Target Tank + Actor resolved |
| `Audit Logs` | Actor resolved |

   - Frozen header rows, alternating row shading, auto-fit column widths
   - UWindsor Navy (`#005596`) header background, Lancer Gold (`#FFCE00`) accent on Summary sheet

---

#### [NEW] [export.py (router)](file:///c:/Users/HP/Desktop/Uwin/ACARE/MVP-Acare/apps/api/app/routers/export.py)

```
GET  /export/preview?start_date=&end_date=
GET  /export/backup?start_date=&end_date=&format=json|excel
```

- **Auth**: `require_manager_plus` for both endpoints
- **`/export/preview`**: Returns record counts per collection for the requested date range (for UI info panel). Uses `count()` queries — does **not** fetch documents. Relies on existing indexes (`created_at`, `date`, `requested_at`).
- **`/export/backup`**:
  - Validates `start_date <= end_date`; raises HTTP 422 if malformed or inverted
  - Calls `ExportService.build_export_bundle(...)` — if it raises, returns HTTP 500 with message
  - For JSON: `Response(content=bytes, media_type="application/json", headers={"Content-Disposition": "attachment; filename=acare_backup_YYYY-MM-DD.json"})`
  - For Excel: `StreamingResponse(BytesIO, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={...})`
  - Filename always includes today's UTC date

---

#### [MODIFY] [main.py](file:///c:/Users/HP/Desktop/Uwin/ACARE/MVP-Acare/apps/api/app/main.py)
- `from .routers import export`
- `app.include_router(export.router)`

---

### Frontend — New Admin Export Page

---

#### [NEW] [ExportPage.tsx](file:///c:/Users/HP/Desktop/Uwin/ACARE/MVP-Acare/apps/web/src/routes/admin/ExportPage.tsx)

Route: `/admin/export`, visible only to manager-and-above.

**UI Sections:**

1. **Page Header** — Title, subtitle explaining the two formats and the date-range scoping rule ("Static reference data always exported in full; date range applies to event records.")

2. **Date Range Selector**
   - `From` and `To` date inputs (both optional)
   - **"Full Backup"** shortcut button clears both fields and sets format to JSON
   - Client-side validation: `start > end` shows inline error; no API call made

3. **Format Selection** — Two styled radio cards:
   - 🗃️ **JSON Backup** — "Complete machine-readable bundle for recovery. Includes all fields including credential data. Handle as a secret."
   - 📊 **Excel Workbook** — "Human-readable multi-sheet report. Excludes sensitive fields. Safe for sharing within authorised teams."

4. **Record Count Preview Panel** — Calls `/export/preview` on date change (debounced 500ms). Shows per-collection counts in a compact grid. Shows "All records" when no date range set.

5. **Export Button** — Labeled "Download Export"
   - On click: opens **confirmation modal** before any API call
   - **Confirmation modal** (especially prominent for JSON format):
     - Title: "Confirm Data Export"
     - For JSON: shows a ⚠️ security notice — _"This export contains password hashes for all user accounts. Treat this file as a secret. Do not upload to shared drives or send via email."_
     - For Excel: standard confirmation, no security warning
     - "Cancel" and "Download" buttons
   - On confirm: triggers download via `fetch()` → `Blob` → `<a download>` pattern (not window.open, so cookies are passed correctly)

6. **Export in progress** — UWindsor buffering animation (matching existing loader style) while download is being generated

---

#### [MODIFY] [AdminLayout.tsx](file:///c:/Users/HP/Desktop\Uwin\ACARE\MVP-Acare\apps\web\src\routes\admin\AdminLayout.tsx)
- `import { ExportPage } from './ExportPage'`
- Add `<Route path="export" element={<ExportPage />} />`

#### [MODIFY] [Sidebar.tsx](file:///c:/Users/HP/Desktop/Uwin/ACARE/MVP-Acare/apps/web/src/components/layout/Sidebar.tsx)
- Add nav item: **Data Export** with `Download` icon
- Visible to `isManagerPlus` (same condition used throughout sidebar)

#### [MODIFY] `apps/web/src/lib/api.ts`
```ts
export const getExportPreview = (params?: { start_date?: string; end_date?: string }) =>
  api.get('/export/preview', { params });

export const downloadExport = (params: { start_date?: string; end_date?: string; format: 'json' | 'excel' }) =>
  api.get('/export/backup', { params, responseType: 'blob' });
```

---

## Date Filtering Logic (Finalised)

| Collection | Always Included | Date Field |
|-----------|----------------|------------|
| `users` | ✅ Full | — |
| `facilities` | ✅ Full | — |
| `rooms` | ✅ Full | — |
| `tanks` | ✅ Full | — |
| `species` | ✅ Full | — |
| `projects` | ❌ Filtered | `created_at` |
| `tank_assignments` | ❌ Filtered | `created_at` |
| `census_events` | ❌ Filtered | `date` |
| `water_quality_logs` | ❌ Filtered | `date` |
| `incident_reports` | ❌ Filtered | `date` |
| `quarantine_exemptions` | ❌ Filtered | `requested_at` |
| `audit_logs` | ❌ Filtered | `created_at` |

> [!NOTE]
> When no date range is provided, all collections are exported in full — this is the "Full Backup" mode.

---

## Technical Notes

- **`FileResponse` not used** — In-memory bytes/BytesIO returned via `Response` and `StreamingResponse` respectively. No temp files written to disk.
- **N+1 prevention** — All lookup maps (user names, tank numbers, etc.) are built from `bundle["users"]` / `bundle["tanks"]` etc. once at the top of `generate_excel_export`, before any row loop.
- **Index reliance for preview** — `/export/preview` uses `.count()` queries which rely on MongoDB indexes. The `created_at`, `date`, and `requested_at` fields are already indexed on the relevant collections. No new indexes needed.
- **Audit trail** — Export action is logged as `action="data_export"` with the actor, format, date range, and per-collection record counts in the `after` field.

---

## Verification Plan

### Automated
```powershell
python -m py_compile apps/api/app/services/export_service.py
python -m py_compile apps/api/app/routers/export.py
npm --prefix apps/web run build
```

### Manual
- Download JSON export (full) and verify valid JSON, all 12 collections present, `password_hash` included in users.
- Download Excel export and verify all 13 sheets open correctly with readable formatting.
- Apply a date range and verify static entities are still complete while event records are filtered.
- Verify the confirmation modal appears and shows the security warning for JSON format.
- Verify staff users cannot access `/admin/export` or call `/export/backup`.
- Trigger an export and verify an `AuditLog` entry with `action="data_export"` is created.
