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
   described in Netlify's [registration and login guide](https://docs.netlify.com/manage/security/secure-access-to-sites/identity/registration-login/). Use
   Netlify's default Google credentials for the initial rollout. Branded Google
   credentials can be added later without changing the application code.
5. Add function-scoped environment values:
   - `HELIX_OWNER_EMAIL`: the verified email that may bootstrap the single owner.
   - `HELIX_ACCOUNT_ACTION_SECRET`: a random secret used only for ten-minute
     sensitive-action proof cookies.
   - `HELIX_LEGACY_ADMIN_AUTH=true`: temporary shared-password fallback during
     owner provisioning.
6. Keep `HELIX_ADMIN_SESSION_SECRET` configured. It still signs COA round-access
   cookies even after account auth replaces shared admin sessions.

Do not put real values in `.env.example` or commit them to Git.

### Optional future branded Google sign-in

1. In Google Cloud Console, select or create the Helix project, then open
   **Google Auth Platform > Branding**. Set the app name, support email, Helix
   home page, privacy-policy URL, and authorized domains.
2. Under **Audience**, choose External unless every intended account belongs to
   one Google Workspace organization. While the app is in Testing, add the
   Google accounts that should be allowed to test it.
3. Under **Data Access**, keep only the basic OpenID scopes needed for sign-in:
   `openid`, email, and profile. Do not request unrelated Google API access.
4. Under **Clients**, create a **Web application** OAuth client. Add the exact
   callback URL shown by Netlify's Google-provider configuration as an
   authorized redirect URI. At the time of writing, Netlify uses
   `https://api.netlify.com/auth/done`; use the value displayed in the Netlify
   UI if it differs. A branch or Preview Server URL does not need a separate
   Google client because Google returns to Netlify's broker callback first.
5. Copy the client ID and client secret. In the existing Netlify project, go to
   **Project configuration > Identity > Registration > External providers**,
   add or configure Google, choose the custom/branded credentials option, and
   paste those values. Never put the secret in repository environment files.
6. Save, redeploy the feature branch, and test **Continue with Google** on the
   Preview Server. Confirm the consent screen names Helix, the callback returns
   to `/account`, a first-time user must choose a username, and a repeat login
   returns to the same PostgreSQL account.

Google requires the configured redirect URI to match exactly. A
`redirect_uri_mismatch` error means the value in **Google Auth Platform >
Clients** does not match the callback used by Netlify.

### Automatic admin-invitation email

The owner panel always returns a one-time copyable link. It also sends that link
automatically when Netlify's Email Integration is configured:

Until the group has a verified sender address, leave this integration disabled
and use the copyable invitation link.

1. Create and verify a sender with Mailgun, Postmark, or SendGrid.
2. In the existing Netlify project, open **Project configuration > Emails >
   Configuration**, enable the email extension, select the provider, and enter
   its API key. Keep the default `emails` directory.
3. Add `HELIX_ADMIN_INVITE_FROM` as a secret environment variable with a sender
   address authorized by that provider. Scope it to Builds and Functions and to
   the feature Preview Server context while testing.
4. Deploy the branch. The committed `emails/admin-invite/index.html` template
   becomes the `admin-invite` handler.
5. Create an invitation from **Account > Admin accounts** and verify the UI says
   it was emailed. If delivery is unavailable or fails, copy the displayed link
   before leaving the page.

## Owner and admin rollout

1. Deploy with `HELIX_LEGACY_ADMIN_AUTH=true`.
2. Sign up with the verified email in `HELIX_OWNER_EMAIL`. The first matching
   profile becomes the only owner; ownership is then bound to its Identity ID.
3. Confirm `/hxowner` works through the new account.
4. In **Account > Admin accounts**, send a seven-day link for each intended
   admin email. The owner also sees a copy fallback; only the token hash is
   retained in PostgreSQL.
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

The Vite host allowlist derives the one expected Preview Server hostname from
Netlify's read-only `BRANCH` and `SITE_NAME` values. The account API and shared
admin API also accept that exact Helix Preview Server domain when Netlify's
internal request URL uses localhost or the canonical production domain. Keep
these checks site-scoped; do not replace the host allowlist with `true` or allow
all `netlify.app` domains.

Account and admin API requests remain relative to the current browser origin.
Owner-created admin invitation links and optional invitation email dispatches
also use the validated browser origin, so Preview Server testing cannot silently
send someone to production.

Netlify Identity confirmation and password-recovery emails are generated from
the project's shared Identity **Site URL**, not from a Preview Server's current
domain. If one of those links opens the production URL during preview testing,
copy only its `#confirmation_token=...` or `#recovery_token=...` fragment onto
the end of the Preview Server's `/account` URL. Treat the token as a password:
do not paste it into logs, issues, or chat. Google OAuth should be tested from
the Preview Server itself; if Netlify returns its callback fragment to the main
site, move that complete hash fragment to the Preview Server's `/account` URL
before continuing.

Run repository verification with:

```bash
npm test
npm run build
```

The [hourly deletion function](https://docs.netlify.com/build/functions/scheduled-functions/)
does not run on a schedule in a Deploy Preview.
Invoke `account-deletion-cleanup` manually through Netlify Dev or the Netlify
Functions UI when testing the grace-period cleanup path.

## Force deletion

The owner can use **Account > Admin accounts > All accounts > Force delete** to
permanently remove any non-owner account immediately. This deletes the Netlify
Identity login first and then removes the PostgreSQL profile and related admin
invites. The owner account is intentionally excluded.

Netlify Dev can authenticate Identity users, but it does not inject the operator
token needed for Identity admin deletion. Therefore, force deletion is disabled
on localhost and must be tested on a deployed Netlify Preview Server. The API
also returns a clear non-destructive error if a local or live-dev request reaches
it without an operator token. It never deletes only the PostgreSQL half.

For emergency manual recovery, delete the user under **Project configuration >
Identity > Users**. Netlify's `userDeleted` event invokes
`netlify/functions/identity-events.mjs`, which removes the matching PostgreSQL
record. Do not start with a direct SQL `DELETE`: that would leave a working,
orphaned Identity login that can recreate profile state on its next session.

## Access boundaries

- Accounts are not required to read or submit labels.
- Signed-in label submissions remain anonymous in this version.
- Accounts are not required to view COAs.
- COA round passcodes and COA access cookies are unchanged.
- PostgreSQL is the authorization source for `user`, `admin`, and `owner` roles.
- Identity metadata, client state, and invitation URLs are never accepted as
  authorization by themselves.
