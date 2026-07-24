# UI/UX Design System
## Animal Care Facility Digital Records System — University of Windsor

**Document Owner:** University of Windsor — Developed by Apurva Shovit
**Status:** Draft v0.1
**Related Docs:** PRD.md, TRD.md, API-documentation.md
**Source for brand values:** official UWindsor Brand Guide (uwindsor.ca/logo/colour,
publications.uwindsor.ca/brand-guide) — confirmed against the actual paper forms provided (Appendix 6,
Appendix 7, Aquatic Incident Reports), which all carry the UWindsor shield/logo in the header.

---

## 1. Colour Palette

### Primary (official UWindsor brand colours — do not alter)
| Name | Hex | RGB | Usage |
|---|---|---|---|
| UWindsor Blue | `#005596` | 0, 85, 150 | Primary brand colour — top nav, section headers, primary buttons, links, active nav item |
| UWindsor Yellow | `#FFCE00` | 255, 206, 0 | Accent only — badges/chips, "new"/highlight markers. **Never** as body text or as text-on-white (fails contrast) |
| UWindsor Grey | `#58585B` | 88, 88, 91 | Secondary text, captions, borders, inactive icons |

### Extended functional palette (derived, contrast-checked)
| Purpose | Hex | Notes |
|---|---|---|
| Blue — dark (hover/pressed) | `#003A66` | Button/link hover-pressed state |
| Blue — tint (panels) | `#E6F0F7` | Selected-row highlight, info panels, active tank-group chip background |
| Success (in-range reading, completed task) | `#1E8A4C` | Distinct from UWindsor Yellow to avoid brand/status ambiguity |
| Warning (approaching quarantine end, due-soon reading) | `#D97706` | Amber |
| Danger (incident logged, out-of-range reading, overdue) | `#C0392B` | Incident banners, validation errors, "vet contacted" flag |
| Neutral surface | `#F5F6F7` | App background |
| Neutral border | `#D8D9DB` | Card/table borders |
| Text primary | `#1F1F22` | Body text (near-black for accessibility, not pure grey) |
| Text secondary | `#58585B` | UWindsor Grey — metadata/captions |

> **Accessibility rule:** UWindsor Yellow on white fails WCAG AA for text. Use only as a background chip
> with dark (`#1F1F22`) text on top, or as a thin accent/icon colour.

## 2. Typography

- Brand fonts per UWindsor guide: **DIN Pro** (headings) with **Calibri** fallback. Web substitutes
  (DIN Pro isn't freely licensed for web use):
  - Headings: `"DIN Pro", "Barlow Semi Condensed", "Segoe UI", sans-serif`
  - Body: `"Calibri", "Inter", "Segoe UI", sans-serif`
- Case: Sentence/Title case preferred over ALL CAPS, per brand guide (note the paper forms themselves use
  Title Case for form names, e.g. "AQUATIC INCIDENT REPORTS" is the one exception — kept only as a literal
  document title, not a UI convention to copy elsewhere).
- Headings render in UWindsor Blue or UWindsor Grey; gold/white headings only over dark backgrounds.
- Scale (mobile-first, rem-based): H1 28/34, H2 22/28, H3 18/24, Body 16/24, Caption 13/18, data-table
  cell 14/20 (never below 14px for interactive/tappable text — facility use involves gloves/wet hands).

## 3. Logo Usage

- Use the official UWindsor shield/wordmark exactly as it appears on the source paper forms (shield mark,
  "University of Windsor" wordmark beneath) — source the vector asset from Public Affairs & Communications
  (uwindsor.ca/logo) rather than rasterizing from the scanned forms.
  Do not recolor, stretch, or add effects to the shield. Left-align the horizontal logo in the top nav per
  current brand guide convention.

## 4. Form-Specific Layout Guidance (direct digitization of the 3 provided paper forms)

### 4.1 Aquatic Incident Report
Paper layout: header row (Room#, Species, PI, AUPP#) + one row per incident (Date, Time, Tank#, Date Est.,
Problem, Comments, Treatment/Solution, Checklist Y/N, Vet Contacted Y/N, Researcher Notified Y/N, Initials).
- Digital: a **single-incident form** (not a grid) — this is a "fill one, submit one" event, so present it
  as a card/stepper, not a spreadsheet-style table, on mobile.
- Y/N fields → toggle switches (not radio buttons) for one-thumb tablet operation.
- `Vet Contacted = Yes` triggers a visible amber/red banner preview before submit ("This will flag the
  Manager dashboard") so staff understand the downstream effect.
- List/history view (Manager+) renders past incidents as a filterable table mirroring the paper columns,
  for familiarity during inspections.

### 4.2 Appendix 6 — Daily Water Quality Log
Paper layout: header (Room, Species, AUPP#, PI, Week of, Tank#(s)) + a **week grid**: rows = Mon–Sun ×
{pH, DO, Temp}, columns = tanks 1–14, plus one Initials + Comments column per row.
- Digital: default to **single-day entry** (today, pre-selected), not the full week grid, since that
  matches real daily workflow — but keep a **"Week view"** toggle (Manager/read view) that reconstructs
  the exact paper grid layout (Mon–Sun rows × tank columns) for print/export continuity.
  entry.
- **Batch mode:** tank-group chips ("Tanks 1–8", "Tanks 9–14", or "Custom selection") at the top of the
  entry screen. Selecting a group pre-fills all member tanks; shared pH/DO/Temp/comments entered once;
  a per-tank confirmation list is shown before submit (so a shared reading is never applied blind).
- Individual per-tank correction remains available from the Week view without needing to re-enter the
  whole group.

### 4.3 Appendix 7 — Water Quality Aquarium Test Strips
Paper layout: header (Room, AUPP#, Species, PI) + one row per (Date, Tank ID) with Nitrate, Nitrite, Total
Hardness, Total Chlorine, Total Alkalinity, pH, Ammonia, Comments, Initials — plus a **frequency schedule**
footer (Daily: Temp/O2/pH; Biweekly: Ammonia/Nitrite/Nitrates/Total Hardness; Weekly: Nitrogen/Salinity;
Annually: Chlorine) and a circled-weekday tracker.
- Digital: same tank-group batch pattern as Appendix 6, but the entry form additionally shows a **"due
  today" chip** per tank derived from the configured frequency schedule (e.g., "Ammonia due — biweekly"),
  so staff aren't guessing which parameters need reading on a given day.
- Each numeric field shows its expected safe range inline as placeholder/helper text (e.g., "0–40 ppm")
  taken directly from the paper form, and turns amber/red if the entered value is outside range (paired
  with a text label, never colour alone).

## 5. Layout & Components (general)

- **Grid:** 8px spacing system; minimum 44×44px touch targets.
- **Navigation:**
  - Staff (mobile-first): bottom tab bar — *My Tanks*, *Log Entry*, *Incidents*, *Profile*.
  - Manager/Chair (dashboard, responsive desktop-first): left sidebar — *Overview*, *Tanks & Projects*,
    *Reports*, *Audit Log* (Chair/Admin), *Admin* (Chair/Admin: users, tanks, vocabularies, settings).
- **Tank cards:** tank #, species, AUPP#, current count, status chip (Healthy / Attention / Quarantine),
  colour-coded via the functional palette, always paired with an icon + text label (colour-blind safe).
- **Dropdowns:** every controlled-vocabulary field (species, food type) shows existing options plus an
  explicit **"+ Add other"** action, never a bare free-text box — reinforces that new values persist
  globally (Epic 12).
- **Tables (dashboard/reports):** sticky header, zebra striping (neutral surface tint), export buttons
  (PDF/CSV/Print) top-right, filter chips (date range, project, species, tank) top-left, `date_from`/
  `date_to` pickers always visible given how central date-range filtering is to the inspection use case.
- **Autosave/draft protection:** longer forms (Incident, Arrival/Intake) persist a local draft so a
  dropped Wi-Fi connection in the facility doesn't lose in-progress entry (per PRD §12 Q3 — client-side
  draft persistence, not full offline sync, for Phase 1).
- **Confirmation on impactful actions:** batch submits, tank reassignment, project close-out/disposition,
  quarantine early-completion — all require an explicit review/confirm step.
- **Role-aware empty states:** a Staff user with no assigned tanks sees "No tanks assigned — contact your
  manager," not a blank/broken-looking screen.

## 6. Accessibility

- WCAG 2.1 AA target: contrast ratios verified for all text/background combinations above; keyboard
  navigability for all dashboard flows; semantic HTML landmarks; visible focus states in UWindsor Blue.
- Status/severity is always colour **+** icon **+** text label — never colour alone.

## 7. Design Tokens (implementation seed — Tailwind/MUI theme)

```js
export const theme = {
  colors: {
    brandBlue: '#005596',
    brandBlueDark: '#003A66',
    brandBlueTint: '#E6F0F7',
    brandYellow: '#FFCE00',
    brandGrey: '#58585B',
    success: '#1E8A4C',
    warning: '#D97706',
    danger: '#C0392B',
    surface: '#F5F6F7',
    border: '#D8D9DB',
    textPrimary: '#1F1F22',
    textSecondary: '#58585B',
  },
  fonts: {
    heading: `"Barlow Semi Condensed", "Segoe UI", sans-serif`,
    body: `"Inter", "Calibri", "Segoe UI", sans-serif`,
  },
  radius: { sm: '4px', md: '8px', lg: '12px' },
  spacing: 8, // base unit, px
};
```

## 8. Assets Needed From UWindsor Before Final Build

- Official logo SVG/EPS (horizontal + shield-only) from Public Affairs & Communications
  (uwindsor.ca/logo or PAC@uwindsor.ca) — do not trace/rasterize from the scanned paper forms.
- Confirm whether this internal operational tool needs PAC design review before go-live (brand guide
  flags custom-graphics review as standard practice).
