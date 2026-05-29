# Helix Group Testing

Local MVP for a static Helix Group Testing website. This project is a Vite + React + TypeScript frontend with no backend, database, user accounts, payments, or order form yet.

## Local setup

Use Node.js 18.18 or newer.

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

## Planned order-interest workflow

The group currently tracks order interest with a Google Sheet/Form. A future version of this app should replace or supplement that workflow by submitting entries into the Google Sheet automatically, so users are not expected to manually copy and paste entries.

The future order-interest form should include these fields:

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

To deploy later:

1. Push this repo to GitHub.
2. Create a new Netlify site from the GitHub repo.
3. Confirm the build command is `npm run build`.
4. Confirm the publish directory is `dist`.
5. Deploy.
