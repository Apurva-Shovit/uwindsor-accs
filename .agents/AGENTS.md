# ACARE Robust UI & API Guidelines

When working on the ACARE project, you MUST adhere to the following architecture and UX constraints:

1. **Zero Database Leakage:** 
   - Never expose raw MongoDB Object IDs (e.g., `_id`, fields ending in `_id`), version keys (`v`), or internal database states directly to the user interface.
   
2. **Mandatory Entity Resolution:**
   - The Backend API is responsible for resolving all relationship IDs (e.g., `created_by`, `pi_id`, `tank_id`) into human-readable strings (e.g., User Full Names, Tank Numbers, Project Titles) *before* returning JSON to the frontend.

3. **"Professor-Friendly" UX (Non-Technical Audience):**
   - **Dates:** Always format dates into highly readable strings including weekdays and times (e.g., `Fri, Jul 24, 2026, 11:31 PM`). Never display raw ISO strings.
   - **Booleans:** Display as "Yes/No", not "true/false".
   - **JSON Objects:** Unpack nested JSON gracefully (e.g., key-value stacks with capitalized keys) rather than stringifying them to `[object Object]`.

4. **Sleek Diff & State Changes:**
   - When rendering audit logs or data diffs, do not use raw data tables. Use sleek "Modification Cards". 
   - Rely on intuitive UI styling (strikethroughs for old values, bold text for new values) instead of redundant phrasing like "Set to" or "Removed".

5. **Strict DRY (Don't Repeat Yourself):**
   - Extract common formatting functions (like date formatting or ID resolving) into shared utility modules (`utils/`) rather than duplicating them across components.
