# Workshop Pro

A workshop management system for vehicle service centres: walk-in check-in, job cards, estimates with customer approval, inspection, delivery scheduling, feedback and billing.

Works on phone, tablet and laptop. It has no dependencies: one Node.js server serves both the REST API and the web app.

## Run

```bash
npm start            # http://localhost:4300
npm test             # API tests (Node built-in test runner)
```

Requires Node 18+. Data is stored in Supabase when `.env` has the Supabase settings (see below); otherwise in `data/db.json`, which is created from `server/seed.js` on first run. To restore the sample data, use **Settings → Reset demo data** (or `POST /api/admin/reset`). In Supabase mode this resets the database too.

## Structure

```
server/server.js     REST API, validation, business rules, static file server
server/seed.js       sample vehicles, job cards and parts/labour/package catalogue
server/api.test.js   API tests
public/index.html    app shell (sidebar · icon rail · bottom tabs)
public/css/app.css   design system and responsive layout
public/js/core.js    API client, router, modal/toast helpers, icons
public/js/views.js   dashboard, job card list, walk-in, vehicle profile, API reference, settings
public/js/job.js     job card screen (overview, work & estimate, inspection, billing, feedback, activity)
public/js/wizard.js  new job card wizard ([vehicle & customer →] check-in → concerns → work → review & sign)
public/js/stock.js   parts stock: on hand, FIFO batches, goods receipts
server/stock.js      stock inward, FIFO issue/return
server/registration.js  new vehicle + customer validation
```

## Workflow

1. **Walk-in**: find the vehicle by reg no, VIN, engine number or phone. Its profile shows alerts, the active job card, owner details, plans, history and campaigns.
2. **New job card**: a 4-step wizard. Check-in details, customer concerns, work (packages, parts, labour), then the customer decision and signature (or a phone approval).
3. **Job card**: stages run Checked in → In progress → Ready for invoicing → Ready for delivery → Delivered.
   - You can't move to invoicing or close the job while estimate lines are still pending approval.
   - A declined line needs a reason. A replaced part goes back to pending.
   - Closing raises the invoice; reopening cancels it.

## Master data

| Section | Master | Linked to |
|---|---|---|
| Masters | **Users** (role, mobile, email) | Technician picker on job cards |
| | **Parts** (MRP, GST, HSN, stock, reorder level, superseded/alternate) | Estimates and part replacement |
| | **Labour** (time, rate, SAC) | Estimates |
| | **Insurance companies** (cashless, GSTIN, contact) | Vehicle insurance |
| Dealer network | **Provinces** (GST state code) → **Cities** → **Dealers** → **Outlets** | City must be in the dealer's province; GSTIN must start with the province's GST state code |

All masters share one schema-driven API: `GET/POST /api/masters/:type`, `GET/PATCH/DELETE /api/masters/:type/:key`.

- Records still in use can't be deleted: you get a 409 error. Deactivate them instead.
- Inactive records can't be newly linked or added to estimates.
- Renaming a user or insurer updates the job cards and vehicles that refer to them.

Server code: `server/masters.js`. Screens: `public/js/masters.js`.

The full endpoint list is in the app under **API reference**.

## New vehicles and customers

When a vehicle isn't on file, walk-in offers **Register vehicle & open job card**. There's also a **New vehicle** button on the walk-in screen. Either way, the job card wizard gets an extra first step, **Vehicle & customer**:

- **Customer:** search for an existing one by name, mobile or customer ID, or enter a new one.
  - New customers get an ID automatically, in the format `C-12419`.
  - If the mobile number already belongs to a customer, the app offers to use that customer, or to create a separate one (for example a family member).
- **Vehicle:** VIN (17 characters, no I/O/Q), registration number, model and variant, colour, engine number, fuel, transmission, sale date (warranty defaults to 3 years), selling dealer, and optionally insurance.
  - A VIN or registration number that's already on file is rejected, with a link to that vehicle.

Nothing is saved until **Create job card**. Then the vehicle, the customer and the job card are saved together in one go, so an abandoned check-in leaves nothing behind. This needs the right *Register vehicles and customers* (`vehicles.create`).

## Parts stock (FIFO)

**Parts stock** in the sidebar shows stock on hand, its value at FIFO cost, the batches of each part and recent movements.

- **Stock inward (goods receipt):** supplier, supplier invoice number and date, then parts with quantity and unit cost.
  - Each line becomes a stock batch.
  - The same invoice from the same supplier can't be recorded twice.
- **Issue to job cards:** approved part lines are issued from the job card's Work tab, one line at a time or with **Issue approved parts**.
  - Stock is always taken from the **oldest batch first** (FIFO), and its cost is stored on the line.
  - If there isn't enough stock, nothing is issued.
- **Returns:** parts go back into the same batches they came from. A reason is required.
- **Rules:**
  - Parts that have been issued can't be declined, removed, replaced or reduced below the issued quantity until they're returned.
  - A job card can't be closed while approved parts are still un-issued.
  - Stock on hand can no longer be typed into the parts master. It changes only through inwards, issues and returns.
- **Existing stock:** when inventory tracking was switched on, existing stock became opening batches. Parts already fitted on jobs in progress were marked as issued.
- **Stock count:** a sheet of every part with its system quantity.
  - Type what's on the shelf. Parts left blank aren't counted.
  - Only the differences are posted. A shortage leaves stock oldest batch first. A surplus is added as a new batch at the latest cost.
  - If stock moved while you were counting (an issue, return or inward), that part is refused and has to be counted again.
- **Write-off:** for damaged, expired, lost, stolen or internally used parts.
  - A reason is required; "Other" also needs remarks.
  - Stock is taken out FIFO, and the written-off value is shown before you post.
- **Adjustments tab:** every count and write-off, with the quantities, the batches touched and the value change. Each one also appears in the part's movement history.
- **Rights:** `stock.view`, `stock.inward`, `stock.issue`, `stock.adjust` (Parts Manager and Workshop Manager by default).

## Service setup masters

**Repair types** (the job card's "Job type"), **Fuel types** and **Transmission types** are now masters instead of fixed lists.
- Only active entries can be chosen.
- An entry used by job cards or vehicles can't be deleted.
- Renaming one updates the job cards and vehicles that use it.

Editing them needs `setup.manage`.

## Roles & rights

**Access control** in the sidebar has two masters:

- **Rights** are every protected action, grouped by module: Dashboard, Job cards, Billing, Vehicles, Masters and Administration.
  - The 22 built-in rights are checked by the server on every request. Examples: `jobs.create`, `jobs.approve`, `jobs.close`, `parts.manage`, `roles.manage`.
  - You can add custom rights, for example for reports.
  - Built-in rights can't be deleted.
  - Deactivating a right removes it from every role.
- **Roles** are named sets of rights, edited as a checklist grouped by module.
  - Each user has one role, picked in the Users master.
  - Renaming a role moves its users along with it.
  - A role that users hold can't be deleted.
  - A role can't be deactivated while active users hold it.

| Role | Can do |
|---|---|
| Administrator | Everything, including rights added later. Built in: can't be renamed, deactivated or deleted. |
| Service Advisor | Job cards end to end (open, estimate, approval, stages, hold, feedback), proforma invoices, vehicles, viewing masters |
| Technician | View job cards, edit job details and inspection, move stages, view vehicles |
| Workshop Manager | Everything an advisor can do, plus closing and reopening job cards and managing users, parts, labour, insurers and the dealer network |
| Parts Manager | Estimates, parts and labour masters |
| Cashier | Proforma invoices, closing job cards with an invoice |

**Safeguards:**
- There is always at least one active Administrator. The last one can't be demoted, deactivated or deleted.
- Without `roles.manage`, nobody can change roles or rights.

**How it's enforced:**
- Every API request is checked against the user's role. Requests without a user run as the first active Administrator.
- A missing right gives HTTP 403, and the message names the right.
- The app hides menus and buttons the user can't use. Master screens become view-only.
- Activity and audit entries record the real user's name.

The rights list and default roles are defined in `server/access.js`. Each endpoint's required right is set in `rightsFor()`.

## Branches, photos, import and backups

- **Branches.** Every job card and booking belongs to an outlet (Dealer network → Outlets).
  - Pick the branch in the top bar. Users without a branch restriction can also choose "All branches".
  - In Users, tick the branches a person may work at; leave them all unticked for no restriction.
  - Parts stock is shared by all branches.
- **Photos & files.** Each job card has a Photos & files tab.
  - On a tablet the camera opens directly. PDFs (insurance documents, assessor reports) can be added too.
  - Files are up to 8 MB each, kept in the private Supabase Storage bucket `attachments` (or `data/files/` without Supabase), and served only to signed-in users.
- **Setup screens.** Service packages and campaigns are masters under Service setup. Bays, delay and decline reasons, vans and feedback questions are under Settings → Dropdown lists.
- **Import.** Settings → Import data brings in CSV files: customers & vehicles, parts with opening stock, and labour.
  - Download the template, fill it in, and upload it.
  - Every row is checked first. Nothing is saved until all rows are valid.
- **Backups.**
  - Settings → Backup & restore downloads the whole database as one JSON file, and can restore one (you must type RESTORE to confirm).
  - From the command line, `npm run backup` writes `backups/workshop-pro-<date>.json` and keeps the newest 30. Schedule it daily.
  - Photos are not inside the backup; they stay in Supabase Storage.
  - On the Supabase Pro plan, point-in-time recovery is also available.
- **Audit log.** Settings → Audit log shows who changed masters, stock, billing and settings. Job card changes are in each job's Activity tab.
- **Stock reservations.** "Reserve stock" on a part line now holds the quantity. Other job cards cannot issue or reserve it, and Parts stock shows reserved and free quantities.

## Hosting (Australia)

1. **Database.**
   - For a new Supabase project, run `supabase/full-setup.sql` once in the SQL editor.
   - For an existing project, run the newest files in `supabase/migrations/` instead.
2. **Deploy.**
   - Deploy the Docker image: `Dockerfile` (Node 22, Australia/Sydney time zone).
   - On Render, `render.yaml` sets up the service; fill in the secret values in the Render dashboard.
   - Any Docker host works, for example a Sydney region VPS, Fly.io or Railway.
3. **Environment variables.**
   - Database: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`.
   - Sign-in: `SESSION_SECRET` (a long random string), `COOKIE_SECURE=1`, `ADMIN_PASSWORD` (first sign-in only).
   - Customer links: `PUBLIC_URL` (your https address).
   - Messaging (optional): `CLICKSEND_USERNAME`, `CLICKSEND_API_KEY`, `SMS_FROM`, `RESEND_API_KEY`, `EMAIL_FROM`.
4. **HTTPS.** Put the app behind HTTPS (Render and Fly do this automatically). The session cookie is `Secure` when `COOKIE_SECURE=1`.
5. **One instance.** Run a single instance: the server keeps the working data in memory and writes every change to Supabase.

## Supabase database

The server stores its data in Supabase (Postgres) when `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` are set, either in the environment or in a `.env` file in the project root (see `.env.example`). Without them it falls back to `data/db.json`. To force a mode, set `STORAGE=file` or `STORAGE=supabase`. `GET /api/health` reports which one is active.

The project is **workshop-pro** (`https://kwhpvsgvcqmmdmenojkp.supabase.co`). To connect, paste the project's **Secret key** into `.env`. Find it under Supabase → Project Settings → API Keys.

**How it works:**
- At start, the server reads every table with `ws_dump()`. If the database is empty, it loads the sample data.
- After each change, it sends only the rows that changed to `ws_sync()`, which applies them in one transaction.
- If the database rejects a write or can't be reached, the request fails with HTTP 503 and the server reloads what is actually stored, so memory and database never drift apart.
- Write requests run one at a time.

Fields the schema has no column for are kept in each table's `extra` jsonb column, so nothing is lost.

Run one server per database: each server keeps its own copy of the data in memory.

| File | Purpose |
|---|---|
| `supabase/migrations/005_australia_billing_purchasing.sql` | Australian rules (units, GST 10%/GST-free, no GSTIN checks) and tables for invoices, payments, suppliers, purchase orders, supplier payments, returns, messages, customer links, bookings and time entries. `schema.sql` does not include this yet – for a brand-new database run `schema.sql`, then migrations 002–005 in order. |
| `supabase/migrations/004_stock_adjustments.sql` | Adds the stock_adjustments table (stock counts and write-offs). |
| `supabase/migrations/003_stock_and_setup_masters.sql` | Adds stock inwards, batches and issues, issue columns on job lines, and the repair, fuel and transmission type tables (keeps data). |
| `supabase/migrations/002_roles_rights.sql` | Adds the roles, rights and role_rights tables to an existing database without losing data. |
| `supabase/schema.sql` | Tables, constraints, triggers, views, RLS and the `ws_dump` / `ws_sync` functions. Re-running it drops and recreates everything. |
| `server/store/mapping.js` | Converts between the app's data and table rows. |
| `server/store/supabase.js` | Loads and saves through the Supabase REST API (no extra packages). |
| `supabase/build-seed.js` | Optional. Builds `seed.sql` (plain INSERTs) from the sample data, or from `data/db.json` with `--current`. |

The database enforces the same rules as the API:
- one open job card per vehicle
- a declined line needs a reason
- a dealer's city must be in its province
- a dealer's GSTIN must start with the province's GST state code
- linked records can't be deleted (foreign keys)
- no negative prices or stock

Two views, `job_card_totals` and `low_stock_parts`, provide estimate/billing totals and the low-stock list.

**Access:** RLS is on for every table, with no policies, so the public anon key can read or write nothing. The `ws_*` functions can only be run with the service role. Keep the secret key in `.env` (ignored by git) and never in `public/`.

## Production notes

- Email is a stub. It only logs the request until a mail service is connected.
- The VIN scanner needs a device barcode service. Right now it shows sample VINs.
- There is no login yet. Anyone can pick any user in the user switcher (sidebar footer), and the API trusts the `X-User-Id` header. Add real authentication (for example Supabase Auth) before going live. The rights checks are already in place for it to use.
- Data is held in memory by a single server process and saved to Supabase on every change. Run one server per database. Scaling out to several servers needs per-request database queries instead.
