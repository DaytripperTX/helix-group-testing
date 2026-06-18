function DisclaimerSection() {
  return (
    <section className="section section--disclaimer" aria-labelledby="disclaimer-title">
      <div className="section__content disclaimer">
        <div>
          <p className="eyebrow">Disclaimer</p>
          <h2 id="disclaimer-title">Clear boundaries</h2>
        </div>
        <ul>
          <li>Helix Group Testing does not sell products.</li>
          <li>
            Helix Group Testing may coordinate testing-only funds for shared
            third-party lab costs.
          </li>
          <li>Helix Group Testing does not fulfill orders.</li>
          <li>Vendor payments and product delivery remain separate from testing coordination.</li>
          <li>
            The site is for organizing testing information, round status, and
            related communication.
          </li>
          <li>
            Products discussed by the group are research chemicals not approved
            for human use, and nothing on this site is medical advice.
          </li>
          <li>Each participant is responsible for their own decisions.</li>
        </ul>
      </div>
    </section>
  );
}

export default DisclaimerSection;
