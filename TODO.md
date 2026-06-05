# TODO

## Local MVP

- Keep the current version as a simple static frontend.
- Keep the landing page working before adding workflow features.
- Keep the project deployable to Netlify.

## Planned site structure

- Home:
  - Landing page with basic information and a concise project summary.
  - Clear disclaimers and scope boundaries.
- Order form:
  - Future page where users enter order-interest data for vendor coordination.
  - May use a familiar product/cart-style layout with images, while keeping the workflow informational and non-commercial.
  - clicking on a peptide will expand a description of the peptide
  - Include multiple clear disclaimers that Helix Group Testing does not sell products, handle money, or fulfill orders.
  - Possible future feature: after a user submits the form, automatically email them a waiver to review and sign.
  - Add disclaimers / info section for testing upgrade donations.
- Testing:
  - Explain testing levels and what each level includes.
  - Show testing statistics for current and past rounds.
  - Include a COA subpage with filtering by compound, round, and batch.
  - Add a vial label generator that includes QR codes linking to the COAs
- Label library / generator:
  - Add a community vial label template library with filtering by peptide type and support for generic multi-peptide labels.
  - Allow community members to upload SVG label templates and vote on labels to feature.
  - Start with a few built-in editable SVG templates that users can fill out and download.
  - Support common editable fields: peptide name, mass (mg), batch #, vendor, purity, vial size, expiration date, and optional COA link.
  - Remove blank fields from the generated label output.
  - Add COA QR codes when a COA link is provided, with the QR code no smaller than 10mm x 10mm.
  - Add printer model selection so the generator can determine and limit the available color palette and label media options. For example, Niimbot M2 supports a small palette of several print colors, plus several different colored label stocks.
- FAQs:
  - Add common questions and answers about participation, vendor-direct payment, delivery, testing coordination, disclaimers, and site workflow.

## Planned order-interest form

- Add an order-interest form after the landing page is stable.
- Match the current Google Sheet columns:
  - Supplier Code / Name
  - Street name
  - MG
  - Price per 10 pack
  - Price after Bulk discount
  - Testing tier
  - Headcount
  - Total order quantity
  - Order cost
- Exclude testing cost for now.

## Google Sheet integration

- Replace or supplement the current Google Sheet/Form workflow.
- Submit form entries into the Google Sheet automatically.
- Do not require users to manually copy and paste entries into the Google Sheet.

## Explicitly out of scope for now

- No database.
- No user accounts.
- No payments.
- No backend.
- No medical claims.

## Required disclaimer

- Helix Group Testing does not sell products.
- Helix Group Testing does not handle money.
- Helix Group Testing does not fulfill orders.
- The site is only for formatting communication and organizing third-party lab testing interest.
