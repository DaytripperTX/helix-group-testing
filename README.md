# Helix Group Testing

Helix Group Testing is a Vite + React + TypeScript site for coordinating group testing information, labels, admin-managed data, and testing-round workflows.

This is a proprietary project. The repository is not open source, and the code,
assets, data files, and designs are not licensed for reproduction, redistribution,
or competing reuse. See [LICENSE.md](LICENSE.md).

## Local setup

Use Node.js 20.12.2 or newer.

Create local-only environment variables:

```bash
cp .env.example .env.local
```

Then set local admin values in `.env.local`. This file is ignored by Git and should
not be committed.

Optional page toggles can also be set there:

```bash
DISABLED_PAGES=order-form,coas
```

Allowed values are `order-form`, `testing`, `coas`, `labels`, and `faqs`.
Values may be comma or whitespace separated, and may use ids or paths such as
`/order-form`. This is build-time config, so changes require rebuilding the app.

Quantitative endotoxin results use a default pass threshold of `5 EU/mL`.
Override it at runtime when needed:

```bash
HELIX_ENDOTOXIN_PASS_THRESHOLD_EU_ML=5
```

The result must be strictly below the configured positive number to pass. An
invalid configured value leaves quantitative endotoxin results Pending and adds
a parser warning instead of silently using the default.

Install dependencies:

```bash
npm install
```

Start the local development server:

```bash
npm run dev
```

For opt-in local labels database development, use Netlify Dev and its local
PostgreSQL environment:

```bash
npm run dev:db
```

See [LABEL_DATABASE.md](LABEL_DATABASE.md) for storage modes, owner operations,
verification, repair, and rollout safeguards.

User accounts use Netlify Identity plus PostgreSQL profiles and roles. See
[ACCOUNT_AUTH.md](ACCOUNT_AUTH.md) for local development, Netlify/Google setup,
owner bootstrap, admin invitations, and the staged shared-password cutover.

Build the production bundle:

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

## Testing coordination workflow

The site is primarily used to coordinate testing rounds, selected peptides, shared third-party lab scope, and related member communication. Public order-form behavior is not part of the current public workflow.

Any future private order-interest workflow should include these fields:

- Supplier Code / Name
- Street name
- MG
- Price per 10 pack
- Price after Bulk discount
- Testing tier
- Headcount
- Total order quantity
- Order cost

Testing cost is intentionally excluded for now.

## Netlify deployment

This repo includes `netlify.toml` with:

- Build command: `npm run build`
- Publish directory: `dist`

Production deploys should use the `prod` branch. The default working branch is
`dev`; changes are promoted to `prod` only after they are reviewed, tested, and
ready for deployment.

Set these environment variables in the Netlify site UI before sharing a deploy:

- `HELIX_ADMIN_PASSWORD`
- `HELIX_OWNER_PASSWORD`
- `HELIX_ADMIN_SESSION_SECRET`
- `HELIX_OWNER_EMAIL`
- `HELIX_ACCOUNT_ACTION_SECRET`
- `HELIX_LEGACY_ADMIN_AUTH=true` only during the staged account rollout, then `false`
- `HELIX_DATA_MODE=legacy` during the additive database deployment
- `HELIX_ENDOTOXIN_PASS_THRESHOLD_EU_ML` if the default `5 EU/mL` threshold should be overridden
- `DISABLED_PAGES` if any public pages should be hidden

Do not set `HELIX_ALLOW_LOCAL_DEFAULTS=true` in Netlify.

`DISABLED_PAGES` is read during the Netlify build. Updating it in Netlify does
not affect an already-built deploy; rebuild/redeploy manually when changing it.

The beta is intended to be shared with site admins only. Public pages may still
be reachable by anyone with the URL, so do not treat the Netlify URL itself as a
secret security boundary.

## Data storage

- `data/*.json` files are committed seed/default data.
- Local development writes runtime data to `.local-data`.
- Netlify production writes runtime data to the `helix-data` Netlify Blobs store.
- New data collections must be implemented directly in the shared PostgreSQL
  database; do not create new JSON/Blob metadata collections as temporary stores.
- Existing JSON/Blob collections are migrated incrementally, with their own
  parallel verification period before PostgreSQL becomes authoritative.
- After a production Blob document has been initialized, editing the matching
  `data/*.json` file changes only the seed/default version, not the existing
  production Blob copy.

To deploy later:

1. Push this repo to GitHub.
2. Create a new Netlify site from the GitHub repo.
3. Set the Netlify production branch to `prod`.
4. Confirm the build command is `npm run build`.
5. Confirm the publish directory is `dist`.
6. Add the required environment variables.
7. Deploy.

## Branch model

- `dev`: default branch for active work and admin beta preparation.
- `prod`: production branch used by Netlify.
- Feature branches should target `dev`.
- Production updates should be made by promoting verified `dev` changes into
  `prod`.

Before promoting to `prod`, run:

```powershell
npm.cmd test
npm.cmd run build
npm.cmd audit --registry=https://registry.npmjs.org/
```
