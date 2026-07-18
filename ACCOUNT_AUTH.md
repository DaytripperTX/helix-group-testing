# Helix account authentication

Helix accounts use Netlify Identity for credentials and sessions. Helix-owned
profiles, roles, admin invitations, and deletion state live in Netlify Database
(PostgreSQL).

Passwords, OAuth tokens, refresh tokens, and plaintext admin-invitation tokens
must never be written to PostgreSQL, logs, environment examples, or source.

## Netlify setup

These are manual project settings and are intentionally not automated by the
repository:

1. Confirm Netlify Database is enabled. Netlify will apply the additive
   `20260717000100_create-user-accounts` migration during the deploy lifecycle;
   verify it first on the feature branch's isolated Deploy Preview database.
   See Netlify's [migration guide](https://docs.netlify.com/build/data-and-storage/netlify-database/migrations/).
2. Follow Netlify's [Identity setup guide](https://docs.netlify.com/manage/security/secure-access-to-sites/identity/get-started/)
   and enable Identity under **Project configuration > Identity**.
3. Keep registration open and keep email confirmation enabled. Do not enable
   autoconfirm.
4. Add Google under **Identity > Registration > External providers** as
   described in Netlify's [registration and login guide](https://docs.netlify.com/manage/security/secure-access-to-sites/identity/registration-login/). For
   production, configure a Helix-owned Google OAuth client so the consent screen
   identifies Helix rather than Netlify Identity.
5. Add function-scoped environment values:
   - `HELIX_OWNER_EMAIL`: the verified email that may bootstrap the single owner.
   - `HELIX_ACCOUNT_ACTION_SECRET`: a random secret used only for ten-minute
     sensitive-action proof cookies.
   - `HELIX_LEGACY_ADMIN_AUTH=true`: temporary shared-password fallback during
     owner provisioning.
6. Keep `HELIX_ADMIN_SESSION_SECRET` configured. It still signs COA round-access
   cookies even after account auth replaces shared admin sessions.

Do not put real values in `.env.example` or commit them to Git.

## Owner and admin rollout

1. Deploy with `HELIX_LEGACY_ADMIN_AUTH=true`.
2. Sign up with the verified email in `HELIX_OWNER_EMAIL`. The first matching
   profile becomes the only owner; ownership is then bound to its Identity ID.
3. Confirm `/hxowner` works through the new account.
4. In **Account > Admin accounts**, create a seven-day link for each intended
   admin email. Copy each link when it is created; only its hash is retained.
5. Have each admin create or sign into the matching verified account and accept
   the link.
6. Set `HELIX_LEGACY_ADMIN_AUTH=false` and redeploy.
7. After verifying owner and admin access, remove `HELIX_ADMIN_PASSWORD` and
   `HELIX_OWNER_PASSWORD`. Do not remove `HELIX_ADMIN_SESSION_SECRET`.

## Local development and verification

Identity needs the Netlify runtime, so use the full local environment for
account flows:

```bash
npm run dev:db
```

The plain Vite server and `server.mjs` still support public-page development,
but they do not emulate Netlify Identity.

Run repository verification with:

```bash
npm test
npm run build
```

The [hourly deletion function](https://docs.netlify.com/build/functions/scheduled-functions/)
does not run on a schedule in a Deploy Preview.
Invoke `account-deletion-cleanup` manually through Netlify Dev or the Netlify
Functions UI when testing the grace-period cleanup path.

## Access boundaries

- Accounts are not required to read or submit labels.
- Signed-in label submissions remain anonymous in this version.
- Accounts are not required to view COAs.
- COA round passcodes and COA access cookies are unchanged.
- PostgreSQL is the authorization source for `user`, `admin`, and `owner` roles.
- Identity metadata, client state, and invitation URLs are never accepted as
  authorization by themselves.
