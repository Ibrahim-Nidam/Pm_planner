# PM Planner — Specifications (v1.0)

Team app that replaces the manual monthly PM (preventive maintenance) planning done in Excel.
Stack: **Supabase** (Postgres, Auth, Storage, Edge Functions) + **plain HTML / Tailwind (CDN) / vanilla JS (ES modules)**, hosted on GitHub Pages.

---

## 0. Rules for the AI coder (read first)

1. Work file by file. Every file that must exist is already in the zip as a stub, listed in `docs/FILE_TRACKER.md`. Do not create files that are not listed without telling the user why.
2. Never modify a file the user has not provided in the conversation. When changing code, name the **full path** and show an unambiguous anchor (function name or the exact lines being replaced).
3. After each change, send only the files that changed (full paths) and update `docs/FILE_TRACKER.md`.
4. The SQL in `supabase/migrations/` is the source of truth for the data model. It was syntax-checked but never run: test it, and if you must change it, add `005_*.sql` rather than silently editing 001-004.
5. Never put the Supabase **service role key** or the default password in front-end code. Only the URL and the anon key go in `js/config.js`.
6. Business rules in §2 and §8 are **hard rules**. If something seems ambiguous, use §14 (assumptions) and ask the user instead of inventing behavior.
7. UI is English, all strings go through `js/i18n.js` so French can be added later. Dates display as `DD/MM/YYYY`, time as 24h.

---

## 1. Product summary

Each month the team lead used to build an Excel planning by hand: which machine gets its PM on which night, done by which technician. This app:

- generates the monthly PM schedule automatically from machines, assigned technicians and their shift roster;
- lets the **team lead** review, adjust and **approve** it; technicians see nothing until approval;
- gives each **technician** a simple dashboard: his shifts of the month, his PMs, and Start / End buttons with exact server timestamps, structured designation/reference/quantity parts, a note, and photos;
- gives the team lead the whole schedule in a grid that looks like the Excel (machines × days), plus management of machines, users and accounts.

Nothing fancy: no reports, charts, notifications or offline mode in v1.

---

## 2. Domain glossary and hard business rules

| Term | Meaning |
|---|---|
| **PM / PMP** | Planned preventive maintenance on one machine. |
| **2P** | The second PM of the month for a machine. It happens about **14 days** after the first one. |
| **Location** | Two locations: **Terminal 1** and **Transit**. Each has 6 lines (`L1`–`L6`) and each line has exactly **1 machine**, so 12 working machines in total. |
| **Machine** | A scanner system, e.g. `K278`, `K887U`. Belongs to one location and one line, has a number of PMs per month, and exactly one assigned technician. `K291` is **out of service** (kept in the list, inactive, no PM). |
| **Technician** | Manages 3 machines. Works a fixed 4-day cycle. |
| **Team lead** | Admin of the app. |

**Rules**

1. **R1.** Machines `K278`–`K290` get **2 PMs/month** (PM and 2P). **All** U units `K887U`–`K933U` get **1 PM/month**; a `0` shown in the paper schedule for one of them is a mistake in the document. `K291` is out of service: **0** and inactive. Stored in `machines.pm_per_month`, editable per machine.
2. **R2.** A PM is done **only by the technician assigned to the machine**.
3. **R3.** A PM may be started whenever the technician is ready after the schedule is approved. The actual start and end timestamps are recorded by the server.
4. **R4.** Shift cycle is **Day → Night → Rest → Rest**, repeating (4-day cycle). Each technician has an offset (`cycle_anchor_date` + `cycle_anchor_index`; index 0 = day, 1 = night, 2 = rest, 3 = rest). At any date exactly one technician is on day, one on night, two off.
5. **R5.** 2P target = first PM date + 14 days (setting `second_pm_gap_days`); acceptable range 12–16 days (setting `second_pm_gap_tolerance_days` = 2). Both PMs must fall in the same month.
6. **R6.** The planned date remains part of the schedule, but it does not restrict when an approved PM may be started.
7. **R7.** The night shift runs **20:30 → 08:30**. A PM is dated by its **night date**: the date the night shift **starts**. The night that begins at 20:30 on 12/10 is "the night of 12/10", including the hours after midnight on 13/10 up to 08:30.
8. **R8.** Only **one technician is on night at any time**, and he does **at most 1 PM per night**. So across the whole fleet there is **at most 1 PM per night**. This is a hard rule, not a preference. (Consequence: two machines on the same line number in different locations can never be serviced the same night.)

---

## 3. Roles and permissions

| Action | Technician | Team lead |
|---|---|---|
| See own shifts and own PMs (approved months only for PMs) | yes | — |
| Start / End own PM, write note, add photos | yes (rules §9) | no |
| Change own password | yes | yes |
| See whole schedule (all machines, all technicians) | no | yes |
| Generate, edit, approve schedule | no | yes |
| CRUD machines | no | yes |
| Create users, assign machines, set shift cycle | no | yes |
| Reset a user's password to default | no | yes |
| Activate / deactivate an account | no | yes |
| View completed PM details (times, note, photos) | own only | all |

A deactivated account cannot log in and gets no data (RLS also checks `is_active`).

---

## 4. Seed data (from the 2026 Excel/PDF)

### Machines (already in `004_seed_machines.sql`, in the order of the October 2026 PDF)

The PDF is the **October 2026** schedule (its header says "Novembre" by mistake). Keep this machine order everywhere (`sort_order`). The location of each machine is not in the PDF: see §14 Q1.

| Code | Line | PM/month | Technician |
|---|---|---|---|
| K278 | L2 | 2 | Mohamed Chfar |
| K279 | L5 | 2 | Chouaib Daanoune |
| K280 | L1 | 2 | Chouaib Daanoune |
| K288 | L4 | 2 | Oussama Esalmy |
| K289 | L3 | 2 | Mohamed Chfar |
| K290 | L6 | 2 | Oussama Esalmy |
| K291 | — | 0 | none, **out of service** (inactive) |
| K887U | L1 | 1 | Hamza Choubaki |
| K888U | L2 | 1 | Mohamed Chfar |
| K889U | L3 | 1 | Hamza Choubaki |
| K931U | L4 | 1 | Hamza Choubaki |
| K932U | L5 | 1 | Chouaib Daanoune |
| K933U | L6 | 1 | Oussama Esalmy |

### Technicians (to create through the app, not SQL)

Cycle position on **01/10/2026** (a Thursday), index 0 = day, 1 = night, 2 = rest, 3 = rest:

| Full name | On 01/10/2026 | `cycle_anchor_index` | Night dates in Oct 2026 |
|---|---|---|---|
| Mohamed Chfar | rest | 2 | 4, 8, 12, 16, 20, 24, 28 (7 nights) |
| Chouaib Daanoune | rest | 3 | 3, 7, 11, 15, 19, 23, 27, 31 (8) |
| Hamza Choubaki | day | 0 | 2, 6, 10, 14, 18, 22, 26, 30 (8) |
| Oussama Esalmy | night | 1 | 1, 5, 9, 13, 17, 21, 25, 29 (8) |

These were read from the PDF text, whose layout was partly lost. **The user must confirm them** (§14 Q3) before relying on them. Use them as the acceptance test data in §15.

---

## 5. Tech stack and constraints

- Front end: static files, no build step. Tailwind via CDN script. ES modules (`<script type="module">`). `@supabase/supabase-js@2` from jsDelivr ESM.
- Multi-page site (one HTML file per screen, one JS file per page in `js/pages/`), shared code in `js/`.
- Back end: Supabase. Writes by technicians only through the RPCs in `002_functions.sql`. Admin user operations through Edge Functions (§7).
- Mobile first: technicians use phones at night. Big tap targets (min 44px), high contrast, readable in low light. Team lead screens are desktop-first but must scroll horizontally on small screens.
- Online required in v1 (timestamps come from the server).
- Hosting: GitHub Pages. `js/config.js` holds `SUPABASE_URL` and `SUPABASE_ANON_KEY` (public by design).

---

## 6. Data model

Defined in `supabase/migrations/001_schema.sql` to `003_rls.sql`. Summary:

- `app_settings(key, value)` — timezone (`Africa/Casablanca`), `night_start` (20:30), `night_end` (08:30), PM gap settings, `max_photos_per_pm` (5).
- `profiles(id → auth.users, username, full_name, role, is_active, must_change_password, cycle_anchor_date, cycle_anchor_index)`.
- `machines(code, location terminal_1|transit, line, sort_order, pm_per_month, technician_id, is_active, notes)`.
- `shifts(technician_id, shift_date, shift_type day|night|rest)` — stored per day so the lead can override (swap, leave).
- `schedule_months(month, status draft|approved, generated_at, approved_by, approved_at)`.
- `pm_tasks(month_id, machine_id, technician_id, sequence 1|2, scheduled_date, latest_allowed_date, status scheduled|in_progress|completed, started_at, ended_at, postponed, postpone_reason, notes)`.
- `pm_photos(pm_task_id, storage_path, uploaded_by)` + private bucket `pm-photos`.
- `audit_log(actor_id, action, entity, entity_id, details)`.

"Overdue" is **derived**, not stored: `status = 'scheduled'` and the current night date is after `latest_allowed_date`.

---

## 7. Authentication and account management

### Login
- Screen: **username + password**. Supabase Auth needs an email, so the app uses a synthetic one: `<username>@pmplanner.local`. The user never sees it. Disable "confirm email" in Supabase or create users already confirmed.
- After login, read `profiles` and redirect: `team_lead` → `lead/schedule.html`, `technician` → `tech/dashboard.html`. If `is_active = false`: sign out and show "Account disabled, contact your team lead".
- Every protected page calls `requireRole()` from `js/guard.js` at load.

### User creation (team lead)
Form: **full name**, **machines managed** (multi-select, sets `machines.technician_id`), **shift cycle** ("On [date] this person is [Day / Night / Rest-1 / Rest-2]", converted into anchor date + index).
Edge Function `admin-create-user`:
1. Verify the caller is an active `team_lead` (decode JWT, read `profiles` with the service role).
2. Build username: `firstname.lastname`, lowercase, accents and spaces removed (`Mohamed Chfar` → `mohamed.chfar`). On collision append `2`, `3`…
3. Create the auth user with the default password (secret `DEFAULT_PASSWORD`, never sent to the browser in code), `email_confirm: true`.
4. Insert the `profiles` row (`role = 'technician'`, `must_change_password = true`).
5. Return `{ username, default_password }`. The UI shows them **once** in a copyable box.

### Password change (any user)
`profile.html`: current page shows full name, username, and a **change password** form (new + confirm, min 8 characters) using `supabase.auth.updateUser({ password })`, then calls RPC `mark_password_changed()`. While `must_change_password` is true, show a visible (non-blocking) banner on the dashboard asking to change it.

### Reset password (team lead)
Button on the technicians list. Edge Function `admin-reset-password` sets the password back to `DEFAULT_PASSWORD` and `must_change_password = true`. Confirm dialog first. Logged in `audit_log`.

### Active toggle (team lead)
Edge Function `admin-set-active` sets `profiles.is_active` and bans/unbans the auth user (`ban_duration: '876000h'` / `'none'`). A lead cannot deactivate himself. Machines of a deactivated technician stay assigned but the scheduler skips them with a warning (§8).

### Team lead accounts
Created manually (see `docs/SETUP_SUPABASE.md`). The UI creates technicians only.

---

## 8. Scheduling

### Inputs
- Month (first day).
- Active machines with `pm_per_month > 0` and an active assigned technician.
- Each technician's **night dates** in that month, taken from `shifts` where `shift_type = 'night'`. If `shifts` has no rows for that month, generate them first from the cycle (anchor + index) for every active technician, then let the lead edit them in `lead/roster.html`.

### Output
Draft rows in `pm_tasks`, and a `schedule_months` row with `status = 'draft'`.

### Algorithm (`js/scheduler.js`, pure function, no DOM, no network)
Signature: `generateSchedule({ monthStart, machines, nightsByTech, fixedTasks, settings }) → { tasks, warnings }`.

For each technician independently (sorted by name):
1. Build the list of PM items: 2 items (sequence 1 and 2) for each 2-PM machine, 1 item for each 1-PM machine.
2. Place **2-PM machines first** (sorted by `sort_order`). For each, evaluate every pair of the technician's nights `(a, b)` that are both still free and have `b - a` in `[gap - tol, gap + tol]`, and score:
   `cost = |(b - a) - 14| * 10 + earliness tie-break (a earlier is better)`.
   Pick the lowest cost. If no pair exists in range, take the free pair closest to 14 days and add a warning.
3. Place **1-PM machines** (sorted by `sort_order`): among the technician's still-free nights, pick the one that spreads PMs most evenly (largest minimum distance to the technician's already placed PM nights), tie → the night closest to mid-month, then the earlier date.
4. **Hard constraint (R8):** a night holds **at most 1 PM**. A night that already has a PM is never a candidate. Since only one technician works each night, no cross-technician check is needed, but the function must still assert that no two tasks share a `scheduled_date`.
5. If a technician has fewer free nights than PMs, place what fits and add a warning for each unplaced PM (the lead resolves it manually). Never double-book a night.
6. `latest_allowed_date` (tolerance, R6): if the technician has another night later in the **same Monday–Sunday week** as `scheduled_date`, use the next one; otherwise equal to `scheduled_date`.

Deterministic: same inputs → same output.

Warnings (shown in the lead UI): machine without technician, inactive technician, not enough free nights (unplaced PM), 2P outside 12–16 days. Inactive machines (e.g. `K291`) are skipped silently.

### Lead workflow
1. Open `lead/schedule.html`, pick a month, add any manual PMs, then press **Generate**. Manual PMs remain fixed; generated PMs fill the remaining machine slots and dates in the draft.
2. Review the grid. Click a PM cell → drawer → change its planned date. Manual and generated tasks are labeled separately, and task creation records the lead who created the row.
3. Press **Approve** → `status = 'approved'`, `approved_by`, `approved_at`. Technicians see their PMs from this moment.
4. After approval the lead may still move tasks with status `scheduled` (logged). Generate is disabled on approved months. Tasks `in_progress` or `completed` can never be moved or deleted.

---

## 9. PM execution (technician)

### Time source
Execution timestamps use **server time**. The browser may display server context, but start permission does not depend on the planned date, night window, or device time.

### Start button
Enabled only if **all** are true: task `status = 'scheduled'`, month approved, and the technician owns the task. RPC `start_pm(task_id)` re-validates everything and sets `started_at = now()`. Only one PM in progress per technician at a time.
When disabled, show a short reason under the button (for example, when the schedule is not published yet).

### During the PM
- Textarea **"Notes / changes made"**, saved with `save_pm_notes` (debounced, ~1.5 s) while `in_progress`.
- **Photos**: up to 5 (`max_photos_per_pm`). `<input type="file" accept="image/*" capture="environment" multiple>`. Compress client-side (max 1600 px on the long side, JPEG quality 0.8), upload to bucket `pm-photos` at `<pm_task_id>/<uuid>.jpg`, then insert a `pm_photos` row. Show thumbnails (signed URLs), allow delete while in progress.

### End button
Enabled only when `in_progress`. RPC `end_pm(task_id, notes, parts)` sets `ended_at = now()`, `status = 'completed'`, and stores the structured parts array. Shows the duration afterwards. A completed PM is read-only for the technician and exposes downloads/printing for the PM report and checklist.

### Overdue
Not started and the night date has passed `latest_allowed_date` → shown red "Overdue" to the technician and the lead. Start is not allowed (no RPC path); the lead moves it to a future night if needed (§8 step 4).

---

## 10. Screens

Shared: top bar with app name, user name, **Profile**, **Logout**. Month selector uses `‹ Oct 2026 ›`.

### 10.1 `index.html` — Login
Username, password, Login button, error line. Redirect by role if already logged in.

### 10.2 `profile.html` — Profile (both roles)
Full name and username read-only, change-password form, back link. No other editing.

### 10.3 `tech/dashboard.html` — Technician dashboard
1. **Tonight card** (top): if a PM is due for `night_date`, show machine code, PM/2P label, Start / End buttons and a link to the PM page. If none: "No PM tonight".
2. **Month calendar**: 7-column grid for the selected month. Each day cell shows the shift (Day / Night / Rest in three distinct colors) and a PM badge (machine code + PM or 2P) on his nights, colored by status (scheduled / in progress / completed / overdue).
3. **My PMs this month** list: machine, label, date, status, postponed flag; row → `tech/pm.html?id=<task_id>`.
4. If the month is not approved yet: "Your PM schedule is not published yet" (shifts are still shown).
5. Banner if `must_change_password`.

### 10.4 `tech/pm.html?id=` — PM page
Machine info, scheduled date, status, Start button (with postpone-reason dialog when applicable), notes, photos, End button, times and duration once started/ended.

### 10.5 `lead/schedule.html` — Full schedule (Excel-like)
- Header: month selector, status chip (Draft / Approved), buttons **Generate**, **Approve**, **Print**, warnings panel.
- **Grid A — PM schedule**: rows = machines (ordered by `sort_order`), fixed left columns: machine, location, line, technician, PMs/month. Keep the PDF order, do not re-sort. Columns = days 1…31 with weekday letters. Cell = `PM` or `2P` colored by status; empty otherwise. Sticky header and first columns, horizontal scroll.
- **Grid B — roster** below it: rows = technicians, columns = days, cells `D` / `N` / `R` (read-only here, edited in roster page).
- Clicking a PM cell opens a **drawer**: machine, technician, scheduled date, tolerance date, status, started/ended time, duration, notes, photo gallery (full size on click), postpone reason, and **Change date** (dropdown of that technician's nights).
- Print stylesheet: landscape, both grids.

### 10.6 `lead/roster.html` — Roster
Month selector, grid technicians × days. Button **Generate from cycle** (fills missing days). Click a cell to cycle through Day / Night / Rest (override). Warning shown when changing a night that holds a scheduled PM: the PM is flagged "needs re-planning" in the schedule.

### 10.7 `lead/machines.html` — Machines
Table: code, location (Terminal 1 / Transit), line, PMs per month (0/1/2), technician (select), active toggle, notes. Add / edit in a modal. No hard delete; deactivate instead. Changing the technician of a machine with open PMs in an approved month shows a list of affected PMs, which the lead must move manually.

### 10.8 `lead/technicians.html` — Technicians
Table: full name, username, machines managed, shift cycle (e.g. "Night on 01/10/2026"), status. Row buttons: **Edit**, **Reset password**, **Active / Inactive toggle**. **Add technician** modal (§7). Credentials box after creation.

---

## 11. Security

- RLS on every table (`003_rls.sql`). Technicians have **no** direct write on `pm_tasks`; they use the three RPCs, which are `security definer` and check `auth.uid()`.
- Edge Functions use the service role key from Supabase secrets, always verify the caller is an active team lead, and never log passwords.
- Private bucket; photos displayed through short-lived signed URLs.
- Front end hides what a role should not see, but real protection is RLS. Test both.
- Shared default password is a known weakness: mitigated by `must_change_password` banner and the reset button. Do not store it in the repo.

---

## 12. Edge cases

- Technician with no night in the month → warning, his machines get no tasks.
- Month with 4-week boundaries: R6 week is Monday–Sunday, even when it spans two months.
- Tolerance night in the next month → still allowed (it is the same week), month rule R5 applies only to scheduled dates.
- Lead edits a roster night that holds a PM → flag, never silent.
- Machine assigned to a deactivated technician → warning on generation, no task.
- Technician opens the app on his phone with a wrong clock → irrelevant, server time rules.
- Daylight-saving / Ramadan clock changes → always use the IANA timezone from settings.
- Two leads editing at once → last write wins in v1.
- Generating a month that already has a draft → replaces tasks with status `scheduled` only.

---

## 13. Build order (milestones)

1. **M1 Setup**: Supabase project, run migrations, `js/config.js`, `supabase-client.js`, login, guard, profile/password change.
2. **M2 Edge Functions**: create user, reset password, set active. Create the lead account and the 4 technicians.
3. **M3 Lead data**: machines page, technicians page, roster page (generate from cycle).
4. **M4 Scheduler**: `scheduler.js` + `tests/scheduler.test.mjs` passing against §15 data, then schedule page grid, drawer, generate, approve.
5. **M5 Technician side**: dashboard, calendar, PM page, Start/End RPCs, notes.
6. **M6 Photos**: compression, upload, gallery for both roles.
7. **M7 Polish**: print stylesheet, empty/error states, mobile checks.

---

## 14. Assumptions and open questions (ask the user, don't guess)

| # | Item | Current assumption |
|---|---|---|
| Q1 | Which machines are in **Terminal 1** and which in **Transit**? (6 lines each, 1 machine per line) | Unknown: `location` is left empty in the seed until the user says. |
| Q2 | Timezone | `Africa/Casablanca` (setting). |
| Q3 | Cycle offsets in §4, read from a damaged PDF extraction | As listed in §4, to be confirmed. |
| Q4 | Postponement week | Monday–Sunday. |
| Q5 | Who may use the tolerance | The technician himself, with a mandatory reason; no lead approval step. |
| Q6 | UI language | English now, French later via `js/i18n.js`. |
| Q7 | Weekend/holiday rules | None: a night is a night. |

Settled by the user: night shift 20:30–08:30; all U units (`K887U`–`K933U`) have 1 PM/month; `K291` is out of service; the PDF is October 2026; at most 1 PM per night (R8).

---

## 15. Acceptance tests (October 2026)

Using the §4 data and rules R1–R7:

1. Mohamed has 5 PMs (K278 ×2, K289 ×2, K888U ×1) over 7 nights, on 5 different nights.
2. Chouaib has 5 PMs (K279 ×2, K280 ×2, K932U) over 8 nights. Oussama has 5 (K288 ×2, K290 ×2, K933U). Hamza has 3 (K887U, K889U, K931U), all on his nights. Total 18 PMs. K291 gets none.
3. For every 2-PM machine, `2P - PM` is between 12 and 16 days, both inside October.
4. No task is ever dated on a technician's day or rest date, and no two tasks in the whole month share a `scheduled_date` (R8).
5. Generating twice gives the same schedule.
6. A technician logged in before approval sees shifts but no PMs; after approval sees only his own.
7. Start is disabled at 14:00 and at 20:15 on the scheduled night, enabled at 20:30, enabled at 02:00 the next morning (still the same night date), disabled at 08:45 and at 20:30 on any other date.
8. Start on the tolerance night without a reason is rejected by the RPC, not only by the UI.
9. A technician cannot call `update` on `pm_tasks` directly (RLS), cannot read another technician's task or photos.
10. Deactivated user: login refused; data calls return nothing.
11. Reset password: the user can log in with the default password again and sees the banner.
