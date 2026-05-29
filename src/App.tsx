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

function App() {
  return (
    <main>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero__content">
          <p className="eyebrow">Local MVP</p>
          <h1 id="hero-title">Helix Group Testing</h1>
          <p className="hero__lede">
            A simple coordination site for formatting communication and
            organizing third-party lab testing interest.
          </p>
          <div className="hero__actions" aria-label="Project status">
            <span>Static frontend</span>
            <span>No accounts</span>
            <span>No payments</span>
            <span>No backend</span>
          </div>
        </div>
      </section>

      <section className="section section--intro" aria-labelledby="about-title">
        <div className="section__content split">
          <div>
            <p className="eyebrow">Purpose</p>
            <h2 id="about-title">Built for clearer coordination</h2>
          </div>
          <p>
            This first version keeps the website focused: explain the project,
            set expectations clearly, and prepare for a future workflow that can
            submit order-interest entries into the group&apos;s Google Sheet
            automatically.
          </p>
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
          </ul>
        </div>
      </section>
    </main>
  );
}

export default App;
