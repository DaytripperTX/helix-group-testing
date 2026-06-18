# Helix Group Testing

Helix Group Testing is a Vite + React + TypeScript site for coordinating group testing information, labels, admin-managed data, and testing-round workflows.

This is a proprietary project. The repository is not open source, and the code,
assets, data files, and designs are not licensed for reproduction, redistribution,
or competing reuse. See [LICENSE.md](LICENSE.md).

## Local setup

Use Node.js 18.18 or newer.

Create local-only environment variables:

```bash
cp .env.example .env.local
```

Then set local admin values in `.env.local`. This file is ignored by Git and should
not be committed.

Install dependencies:

```bash
npm install
```

Start the local development server:

```bash
npm run dev
```

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

Do not set `HELIX_ALLOW_LOCAL_DEFAULTS=true` in Netlify.

The beta is intended to be shared with site admins only. Public pages may still
be reachable by anyone with the URL, so do not treat the Netlify URL itself as a
secret security boundary.

## Data storage

- `data/*.json` files are committed seed/default data.
- Local development writes runtime data to `.local-data`.
- Netlify production writes runtime data to the `helix-data` Netlify Blobs store.
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
