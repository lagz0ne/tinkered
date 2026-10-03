# Flight trial rules

Grow the supplied Start scaffold one round at a time.
Read its `AGENTS.md` and app skills before writing code.
Keep `src/scaffold/` unchanged.
Use the supplied Core and React packages.
Keep feature work in tags, data, resources, and operations.

Settings come from `.env`.
The harness supplies these settings:

- `PUBLIC_ORIGIN`, `AUTH_SECRET`, and `DATABASE_URL`.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, and `SMTP_PASSWORD`.
- `SMTP_FROM` and `MAILPIT_URL`.
- `SUPPLIER_A_URL`, `SUPPLIER_B_URL`, and `SUPPLIER_C_URL`.
- `PAYMENT_URL` and `WEBHOOK_SECRET`.

Read the shipped `SERVICES.md` for supplier and payment HTTP contracts.
Use their HTTP APIs with real clients.
Do not load the flight fixture into the app.
Do not call `/control/` from app code.
The teacher alone controls faults, clocks, and seat stock.
The app runs on real time; a service's clock can move separately.

Each task adds to every earlier task.
Keep earlier pages and text working.
The teacher sees only pages, HTTP routes, and service call logs.
The teacher never reads the app's private code or records.

Test through exported operations and real pages.
Run build before check and tests.
Run the supplied seam, browser import, and schema checks.
Fix blocking findings; fix or explain other findings.
Report exact commands and results, then stop.
