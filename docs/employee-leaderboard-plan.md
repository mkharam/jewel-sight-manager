# Employee sales leaderboard — plan

Status (2026-11-03): design agreed, nothing built. Blocked on finding where Amarsoft stores its invoices.

## Situation
- Staff sell through **Amarsoft** (عمار سوفت), one PC per shop, not through this app.
- Amarsoft probably does not record which employee made the sale.
- So each employee gets a short personal code (e.g. `07`) and types it on every Amarsoft
  invoice (salesperson / notes field, whichever exists).

## Design
1. **`employees` table**: name, code, branch, active. No app login needed.
2. **Sync agent on each shop PC**: reads new Amarsoft invoices every few minutes and sends
   invoice number, date, total, employee code and branch to a Supabase Edge Function using a per-branch key.
   Queues while offline (power cuts / weak internet) and retries. Never writes to Amarsoft's database.
3. **Leaderboard page**: everyone sees the ranking (today / week / month); only admins see
   dinar amounts and the invoice list. Money stays integer dirhams, shown as whole dinars.

Fallback if Amarsoft's database can't be read: manager uploads Amarsoft's Excel sales export.

## First step on a shop PC
1. Run `scripts/amarsoft-check.ps1` (read-only: lists programs, services, database file names).
2. Find the database engine (SQL Server / Access / Firebird …) and the invoice table + fields,
   especially a salesperson/user/notes field for the employee code. Read only, change nothing.
3. Take a photo of one Amarsoft invoice screen.
