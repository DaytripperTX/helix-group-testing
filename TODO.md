# TODO

## Current project baseline

- Keep the current version as a simple static frontend.
- ✅ Keep the landing page working before adding workflow features.
- ✅ Keep the project deployable to Netlify.

## Planned site structure

- Home:
  - ✅ Landing page with basic information and a concise project summary.
  - ✅ Clear disclaimers and scope boundaries.
- Order form:
  - ✅ Private workflow where coordinators can organize round interest and testing needs.
  - ✅ May use a familiar product/cart-style layout with images, while keeping the workflow informational and non-commercial.
  - clicking on a peptide will expand a description of the peptide
  - ✅ Include multiple clear disclaimers that Helix Group Testing does not sell products or fulfill orders, while testing-only funds may be coordinated for lab costs.
  - Possible future feature: after a user submits the form, automatically email them a waiver to review and sign.
  - ✅ Add disclaimers / info section for testing costs and testing upgrade donations.
- Testing:
  - ✅ Explain testing levels and what each level includes.
  - Show testing statistics for current and past rounds.
  - Include a COA subpage with filtering by compound, round, and batch.
  - Add a vial label generator that includes QR codes linking to the COAs
- Label library / generator:
  - ✅ Add a community vial label template library with filtering by peptide type and support for generic multi-peptide labels.
  - ✅ Allow community members to upload SVG label templates and vote on labels to feature.
  - ✅ Start with a few built-in editable SVG templates that users can fill out and download.
  - ✅ Support common editable fields: peptide name, mass (mg), batch #, vendor, purity, vial size, expiration date, and optional COA link.
  - ✅ Remove blank fields from the generated label output.
  - Add COA QR codes when a COA link is provided, with the QR code no smaller than 10mm x 10mm.
  - ✅ Add printer model selection so the generator can determine and limit the available color palette and label media options. For example, Niimbot M2 supports a small palette of several print colors, plus several different colored label stocks.
  - Add support for exporting labels as PNG and PDF, multipage PDF for multi-color prints (M2)
- FAQs:
  - ✅ Add common questions and answers about participation, vendor-direct payment, delivery, testing coordination, disclaimers, and site workflow.

## Private round-interest workflow

- ✅ Keep order-interest details out of the public home-page workflow.
- ✅ Preserve the private round-interest fields:
  - ✅ Supplier Code / Name
  - ✅ Street name
  - ✅ MG
  - ✅ Price per 10 pack
  - ✅ Price after Bulk discount
  - ✅ Testing tier
  - ✅ Headcount
  - ✅ Total order quantity
  - ✅ Order cost
- ✅ Exclude testing cost for now.

## Data coordination

- Keep round and testing coordination inside the app-managed workflow.
- Do not describe a public Google Sheet/Form workflow on the home page.
- Avoid making the order-interest flow public unless that product decision changes.

## Explicitly out of scope for now

- No payments.
- No medical claims.

## Before public release

- Add an environment-controlled way to disable individual pages entirely before
  moving from admin-only beta to public release.
- Recommended future shape: a build/runtime setting such as
  `VITE_HELIX_DISABLED_PAGES=order-form,labels` or equivalent route-gating
  config.
- Disabled pages should be removed from navigation, and direct URL access should
  show a simple unavailable page or redirect home.
- This is not required for admin-only beta, but it is required before public
  launch because some pages are not ready for public release.

## Required disclaimer

- ✅ Helix Group Testing does not sell products.
- ✅ Helix Group Testing may coordinate testing-only funds for shared third-party lab costs.
- ✅ Helix Group Testing does not fulfill orders.
- ✅ The site organizes testing information, round status, and related communication.
