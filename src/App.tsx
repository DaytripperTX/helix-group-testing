const plannedFields = [
  'Supplier Code / Name',
  'Street name',
  'MG',
  'Price per 10 pack',
  'Price after Bulk discount',
  'Testing tier',
  'Headcount',
  'Total order quantity',
  'Order cost',
];

const coordinationPoints = [
  'Members coordinate interest for group purchasing rounds and pooled third-party lab testing.',
  'Vendor payment and delivery happen directly between each member and the vendor, outside this site.',
  'The site is intended to organize communication, not to sell, collect funds, or fulfill products.',
];

const testingFocus = [
  'Purity & Quantitation (HPLC)',
  'Identity Confirmation',
  'Endotoxin (USP <85>)',
  'Heavy Metals (ICP-MS)',
  'Rapid Sterility Screen',
  'Fentanyl Testing',
  'Batch Conformity Testing',
];

function App() {
  return (
    <main>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero__content">
          <div className="hero__copy">
            <img
              className="hero__logo"
              src="/helix_logo.svg"
              alt="The Helix Group Testing logo"
            />
            <p className="eyebrow">Local MVP</p>
            <h1 id="hero-title">Helix Group Testing</h1>
            <p className="hero__lede">
              A volunteer-run, non-commercial coordination site for formatting
              communication around group testing interest.
            </p>
            <div className="hero__actions" aria-label="Project status">
              <span>Static frontend</span>
              <span>No accounts</span>
              <span>No payments</span>
              <span>No backend</span>
            </div>
          </div>

          <aside className="hero__panel" aria-label="Testing scope summary">
            <h2>Platinum testing focus</h2>
            <ul>
              {testingFocus.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </aside>
        </div>
      </section>

      <section className="brand-band" aria-label="Helix Group Testing">
        <div className="brand-band__content">
          <img src="/helix_logo.svg" alt="" aria-hidden="true" />
          <span>The Helix</span>
          <strong>Group Testing</strong>
        </div>
      </section>

      <section className="section section--intro" aria-labelledby="about-title">
        <div className="section__content split">
          <div>
            <p className="eyebrow">Purpose</p>
            <h2 id="about-title">Built for clearer coordination</h2>
          </div>
          <p>
            Helix Group Testing is a private coordination project for research
            peptide group-interest tracking and pooled third-party lab testing.
            It is organized on a no-profit basis and keeps product decisions,
            vendor payments, and delivery outside this site.
          </p>
        </div>
      </section>

      <section className="section" aria-labelledby="coordination-title">
        <div className="section__content">
          <div className="section__header">
            <p className="eyebrow">Workflow</p>
            <h2 id="coordination-title">What this site should coordinate</h2>
            <p>
              The current group workflow lives in a Google Sheet/Form. This MVP
              prepares a clearer public-facing structure before any automated
              order-interest submission is added.
            </p>
          </div>

          <div className="info-grid">
            {coordinationPoints.map((point) => (
              <article className="info-card" key={point}>
                <p>{point}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section section--testing" aria-labelledby="testing-title">
        <div className="section__content split">
          <div>
            <p className="eyebrow">Testing Interest</p>
            <h2 id="testing-title">Third-party lab testing focus</h2>
            <p>
              The group&apos;s stated testing workflow centers on comparing
              vendor documentation with independent lab results from sample and
              volunteer-supplied vials.
            </p>
          </div>
          <ul className="check-list check-list--columns">
            {testingFocus.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section" aria-labelledby="planned-form-title">
        <div className="section__content">
          <div className="section__header">
            <p className="eyebrow">TODO</p>
            <h2 id="planned-form-title">Planned order-interest form</h2>
            <p>
              The order-interest form is intentionally not implemented yet.
              When added, it should replace or supplement the current
              Google Sheet/Form process without asking users to copy and paste
              entries manually.
            </p>
          </div>

          <div className="field-grid" aria-label="Planned form fields">
            {plannedFields.map((field) => (
              <div className="field-card" key={field}>
                {field}
              </div>
            ))}
          </div>

          <p className="note">
            Testing cost is excluded from the planned form for now.
          </p>
        </div>
      </section>

      <section className="section section--disclaimer" aria-labelledby="disclaimer-title">
        <div className="section__content disclaimer">
          <div>
            <p className="eyebrow">Disclaimer</p>
            <h2 id="disclaimer-title">Clear boundaries</h2>
          </div>
          <ul>
            <li>Helix Group Testing does not sell products.</li>
            <li>Helix Group Testing does not handle money.</li>
            <li>Helix Group Testing does not fulfill orders.</li>
            <li>
              The site is only for formatting communication and organizing
              third-party lab testing interest.
            </li>
            <li>
              Products discussed by the group are research chemicals not
              approved for human use, and nothing on this site is medical
              advice.
            </li>
            <li>Each participant is responsible for their own decisions.</li>
          </ul>
        </div>
      </section>
    </main>
  );
}

export default App;
