# Admin Panel Instructions

## Overview

The admin panel has five main tabs for managing the testing coordination platform: **Vendors**, **Rounds**, **Peptides**, **Notes**, and **Labels**. Each tab handles different aspects of group testing data entry.

---

## Vendors Tab

### Purpose
Manage supplier information and their price lists.

### Adding a Vendor
1. Click **Add Vendor**
2. Fill in vendor details:
   - **Name**: Full vendor name
   - **Nickname**: Short reference name
   - **WhatsApp**: Contact number (with country code if applicable)
   - **Description**: Brief notes about the vendor
   - **Negotiated Discount**: Discount percentage or terms

### Setting Up Price Sheets
After adding a vendor, you can attach a price sheet in two ways:

**Option 1: Google Sheet (Recommended)**
- Click **Price List** on the vendor
- Select "Google Sheet" and paste the shareable URL
- The system will parse the sheet automatically

**Option 2: File Upload**
- Click **Price List** on the vendor
- Select "Upload File"
- Upload a CSV or Excel file with the following columns:
  - Vendor Code (supplier's product code)
  - Product Name
  - Mass (in mg)
  - Price
  - Vials Per Pack

The system automatically links products to peptides in the dictionary based on vendor codes and product names. Items that don't match get flagged as "needs review."

---

## Rounds Tab

### Purpose
Create and manage testing rounds. A round ties together vendor, peptide selection, pricing, and participant details.

### Adding a Round
1. Click **Add Round**
2. Fill in round details:
   - **Name**: Round identifier (e.g., "Q3 2026 BPC Round")
   - **Status**: Current phase (planning, open, closed, etc.)
   - **Vendor**: Select from your vendor list
   - **Target Window**: Expected dates for the round
   - **Participants**: Expected member count
   - **Round Discount %**: Group discount percentage
   - **Mark as Current**: Check to highlight this round on public pages

### Adding Peptides to a Round
1. Click **Edit** on the round
2. In the **Peptides** section, add compounds by:
   - Selecting from the peptide dictionary (linked to vendor codes automatically)
   - Entering vendor code, supplier product name, and mass
   - Setting testing tier requirements (Platiunum, Gold+, Gold, Bronze)
   - Adding any additional testing notes or cap colors

The system automatically matches vendor codes to peptides in the dictionary when you specify the vendor code. You can manually link peptides by name if needed.


### COA Passcode (Optional)
Enter a passcode to gate access to this round's COA results. Members must enter this code to view certificates of analysis. Leave blank for public access.

---

## Peptides Tab (Peptide Dictionary)

### Purpose
Build and maintain the master peptide database. This dictionary is the source of truth for all round selections.

### Adding a Peptide
1. Click **Add Peptide**
2. Enter peptide details:
   - **Name**: Standard peptide name
   - **Type**: Peptide or Blend
   - **Categories**: Select relevant categories (e.g., "Weight Loss," "Performance")
   - **Description**: Notes about the peptide
   - **Wiki Links**: URLs to PeptidePedia or other reference sources (optional)

### Blends
For peptide blends:
- Set type to "Blend"
- Add component peptides with their ratios (e.g., "50% Peptide A, 50% Peptide B")

### Batch Import
For large dictionary updates:
1. Click **Batch Import**
2. Paste CSV data with columns: Name, Category, Type, Description
3. Review the preview and submit

### Finding Missing Wiki Links
- Click **Find Missing Wiki Links** to auto-populate PeptidePedia references for peptides without links (owner only)

---

## COAs (Certificates of Analysis)

### Uploading Batch Numbers
1. Navigate to the COAs page as an admin
2. Select a round from the dropdown
3. Click **Batch Entry** to add batch/lot numbers for peptides in that round
4. Enter for each peptide:
   - **Batch/Lot #**: The supplier's batch identifier
   - **Vendor**: Supplier name
   - **Testing Tier**: Which tier this batch fulfills

The system creates one COA record per batch, linked to the round and peptide.

### Attaching COA PDFs
**Important**: PDF file names must match the batch number format for proper linking.

1. Find the COA record in the list
2. Click **Attach PDF**
3. Upload the PDF file
4. **File naming requirement**: Name the file after the batch number (e.g., if batch is `BPC10-0626`, name file `BPC10-0626.pdf`)
5. System automatically extracts:
   - Purity data
   - Lot/batch number (verified against uploaded batch #)
   - Analysis date
   - Lab name
   - Overall test status (pass/fail)

### PDF Parsing
The system parses common COA formats (ILS Laboratories and generic templates) to extract:
- Identity confirmation
- Purity percentage
- Mass/content
- Test results (sterility, endotoxins, heavy metals)
- Verification URLs

If the PDF batch number doesn't match your entry, the system flags it for review.

---

## Notes Tab

### Purpose
Store admin-only notes and announcements (not visible to members).

### Use Cases
- Round status updates
- Vendor communication notes
- Quality issues or concerns
- Follow-up reminders

---

## Labels Tab

### Purpose
Configure label templates and printer settings for vial labels.

### Setup
- Define label size and printer type (4x6, roll-fed, etc.)
- Specify data fields to include (peptide name, batch #, mg, expiration date, etc.)
- Add optional QR codes linking to COAs

---

## Workflow: Complete Round Example

1. **Add Vendor**
   - Enter supplier info and WhatsApp
   - Upload their price sheet
   
2. **Create Round**
   - Link to vendor
   - Set target dates and participant estimate
   - Set group discount %

3. **Add Peptides to Round**
   - Select from peptide dictionary
   - Link to vendor codes
   - Set testing tiers and pricing

4. **Enter Batch Numbers**
   - After vendor ships, add batch #s in COAs tab
   - Link to round and peptides

5. **Upload COA PDFs**
   - Name file after batch # (e.g., `BPC10-0626.pdf`)
   - Attach to corresponding COA record
   - System extracts purity, results, lab info

6. **Generate Labels** (Optional)
   - Create vial labels with extracted COA data and QR codes to COA records

---

## Tips

- **Vendor Codes**: Always use consistent vendor codes when uploading price sheets—these are the link between supplier products and your peptide dictionary.
- **Batch Matching**: PDF file names must exactly match batch numbers for the system to validate the upload.
- **Wiki Links**: Add wiki links to peptides so members can research compounds in the dictionary.
- **Round Status**: Set a round as "Current" only when it's actively open for orders.
- **Testing Tiers**: Define tier pricing early; members see these when placing orders.
