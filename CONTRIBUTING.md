# Contributing

Helix Group Testing is a proprietary project. Public contributions are not
accepted unless the project owner has explicitly invited the contributor.

## Authorized Contributors

- Work from short-lived feature branches.
- Open pull requests into `dev`.
- Keep changes focused and easy to review.
- Include screenshots or route notes for user-facing UI changes.
- Do not commit secrets, local data, exported private reports, or `.env.local`.

## Release Flow

- `dev` is the default working branch.
- `prod` is the Netlify production branch.
- Changes move to `prod` only after they are reviewed, tested, and considered
  ready for deployment.

Before requesting promotion to `prod`, run:

```powershell
npm.cmd test
npm.cmd run build
npm.cmd audit --registry=https://registry.npmjs.org/
```

Security-sensitive changes should describe the risk being addressed, the
expected behavior after the change, and any remaining known limitations.
