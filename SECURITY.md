# Security Policy

## Supported Branches

- `prod`: production deployment branch.
- `dev`: active development and beta preparation branch.

Security fixes should land in `dev` first, then be promoted to `prod` after
verification.

## Reporting A Vulnerability

Do not open a public GitHub issue for vulnerabilities, exposed credentials,
admin bypasses, data exposure, or abuse vectors.

Report security concerns privately to the project owner or an authorized site
admin. Include:

- affected route, feature, or file;
- steps to reproduce;
- expected impact;
- screenshots or logs when they do not reveal secrets.

## Secrets

Never commit production or beta secrets. These values belong in Netlify
environment variables or local-only `.env.local` files:

- `HELIX_ADMIN_PASSWORD`
- `HELIX_OWNER_PASSWORD`
- `HELIX_ADMIN_SESSION_SECRET`
- `HELIX_ALLOW_LOCAL_DEFAULTS`

`HELIX_ALLOW_LOCAL_DEFAULTS=true` is for local development only and must not be
enabled in Netlify.
