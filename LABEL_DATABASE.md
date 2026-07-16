# Labels PostgreSQL rollout

The labels backend supports Netlify Database PostgreSQL in parallel with the
existing JSON/Netlify Blobs implementation. The Labels frontend and all current
API response shapes are unchanged. Label preview bytes remain under
`label-previews/*`; PostgreSQL stores only preview metadata.

## Database layout

Helix uses one shared PostgreSQL database, not one database per JSON collection.
Each migrated domain receives its own related tables through additive repository
migrations. Future peptide, vendor, round, COA, and other tables will live beside
the label tables in this same database. Large files and images remain in Blob
storage while PostgreSQL stores their relational metadata.

## Modes

Set the site-wide `HELIX_DATA_MODE` to one of:

- `legacy` (default): JSON/Blobs only. This is the immediate rollback mode.
- `shadow`: JSON/Blobs is authoritative and mutations are mirrored to SQL.
  SQL failures do not fail requests and create sanitized records under
  `label-sql-shadow-failures/*`.
- `postgres`: SQL is authoritative and fails closed. JSON/Blob metadata receives
  a best-effort rollback mirror.

This delivery must remain in `legacy` until the database migration is applied
and the isolated database is validated. It does not authorize a production
switch to `postgres`.

The switch is intentionally site-wide so the same rollout state applies as
additional collections are migrated into the shared Helix database.

## Local database development

Use Node.js 20.12.2 or newer, install dependencies, then run:

```bash
npm run dev:db
```

The script applies repository migrations from `netlify/database/migrations/` to
Netlify's local database and then starts Netlify Dev. Ordinary frontend
development continues to use `npm run dev` and does not start PostgreSQL. Do not
set `NETLIFY_DB_URL` when using this local command, because an explicit URL tells
the Netlify CLI to use that database instead.

## Owner operations

These backend-only endpoints require an authenticated owner session:

- `GET /api/admin/database/labels/status`
- `POST /api/admin/database/labels/verify`
- `POST /api/admin/database/labels/backfill`
- `POST /api/admin/database/labels/repair`

Repair additionally requires this JSON body:

```json
{"confirmation":"repair-postgres-from-legacy"}
```

Verification performs a canonical comparison and records its result in SQL.
Backfill is idempotent, never deletes either store, and will not overwrite a SQL
row with an older legacy snapshot. Repair makes SQL match the read-only merged
legacy snapshot, including deleting SQL-only metadata. Neither operation deletes
legacy label metadata or preview assets. Labels without valid external preview
metadata are reported as blocked.

## Rollout gate

1. Provision Netlify Database and publish the additive migration while mode is
   still `legacy`.
2. Validate the isolated deploy-preview database without writing to shared
   production Blobs.
3. Set production to `shadow`, redeploy, run owner backfill, and verify exact
   parity.
4. Record at least one exact verification every 24 hours for seven continuous
   days and after targeted label workflow tests.
5. Any repair, non-exact verification, or shadow failure restarts the observation
   window. Unresolved shadow failures block the gate.
6. Keep `postgres` disabled until a separately approved cutover.

Netlify Blobs are site-wide and shared by deploy previews. Do not run preview
tests that mutate label Blobs. Exercise SQL-authoritative writes through the
local database environment.
