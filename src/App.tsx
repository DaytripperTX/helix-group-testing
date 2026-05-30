import { useEffect, useState } from 'react';

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

const missionBenefits = [
  {
    icon: 'percent',
    title: 'Group negotiated discounts',
    text: 'Members pool interest to unlock bulk pricing from vendors. The goal is clearer coordination around rates that may not be available to individual buyers.',
  },
  {
    icon: 'flask',
    title: 'Independent group testing',
    text: 'The group does not rely only on vendor COAs. Planned testing may include HPLC purity, mass-spec identity, endotoxin, and sterility screening.',
  },
  {
    icon: 'group',
    title: 'Group lab discounts',
    text: 'Cost-shared testing can reduce per-member testing fees. Current planning estimates are about $140 to $160 per member for fuller gold or platinum coverage.',
  },
  {
    icon: 'shield',
    title: 'Vendor accountability',
    text: 'When testing identifies a failed batch, the group can coordinate documentation and vendor follow-up for replacement or refund discussions.',
  },
  {
    icon: 'reship',
    title: 'Seizure and reshipment resolution',
    text: 'Customs seizures are a real risk. Group coordination can help members document issues and work with the supplier on possible reshipment paths.',
  },
] as const;

const testingFocus = [
  'Purity & Quantitation (HPLC)',
  'Identity Confirmation',
  'Endotoxin (USP <85>)',
  'Heavy Metals (ICP-MS)',
  'Rapid Sterility Screen',
  'Fentanyl Testing',
  'Batch Conformity Testing',
];

const navItems = [
  { id: 'home', label: 'Home', path: '/' },
  { id: 'order-form', label: 'Order Form', path: '/order-form' },
  { id: 'testing', label: 'Testing', path: '/testing' },
  { id: 'coas', label: 'COAs', path: '/coas' },
  { id: 'faqs', label: 'FAQs', path: '/faqs' },
] as const;

type PageId = (typeof navItems)[number]['id'];
type FaqItem = {
  question: string;
  answer: string;
};

function getPageFromPath(): PageId {
  const currentPath = window.location.pathname.replace(/\/$/, '') || '/';
  const match = navItems.find((item) => item.path === currentPath);
  return match?.id ?? 'home';
}

function App() {
  const [activePage, setActivePage] = useState<PageId>(getPageFromPath);

  useEffect(() => {
    const handleNavigation = () => setActivePage(getPageFromPath());

    window.addEventListener('popstate', handleNavigation);
    return () => window.removeEventListener('popstate', handleNavigation);
  }, []);

  const navigateTo = (path: string) => {
    window.history.pushState({}, '', path);
    setActivePage(getPageFromPath());
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <>
      <SiteHeader activePage={activePage} onNavigate={navigateTo} />
      <main>
        {activePage === 'home' && <HomePage />}
        {activePage === 'order-form' && <OrderFormPage />}
        {activePage === 'testing' && <TestingPage />}
        {activePage === 'coas' && <CoasPage />}
        {activePage === 'faqs' && <FaqsPage />}
      </main>
    </>
  );
}

function SiteHeader({
  activePage,
  onNavigate,
}: {
  activePage: PageId;
  onNavigate: (path: string) => void;
}) {
  return (
    <header className="brand-band">
      <div className="brand-band__content">
        <a
          className="brand-band__mark"
          href="/"
          onClick={(event) => {
            event.preventDefault();
            onNavigate('/');
          }}
          aria-label="Helix Group Testing home"
        >
          <img src="/helix_logo.svg" alt="" aria-hidden="true" />
          <span>The Helix</span>
          <strong>Group Testing</strong>
        </a>

        <nav className="site-nav" aria-label="Primary navigation">
          {navItems.map((item) => (
            <a
              className={item.id === activePage ? 'site-nav__link is-active' : 'site-nav__link'}
              href={item.path}
              key={item.id}
              onClick={(event) => {
                event.preventDefault();
                onNavigate(item.path);
              }}
            >
              {item.label}
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}

function HomePage() {
  return (
    <>
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

      <section className="section section--mission" aria-labelledby="mission-title">
        <div className="section__content">
          <div className="section__header">
            <p className="eyebrow">Mission</p>
            <h2 id="mission-title">Five reasons this co-op exists</h2>
            <p>
              Helix Group Testing helps organize research peptide interest,
              third-party lab testing, and vendor accountability while keeping
              product decisions, payments, and delivery outside this site.
            </p>
          </div>

          <div className="mission-grid">
            {missionBenefits.map((benefit) => (
              <article className="mission-card" key={benefit.title}>
                <div className="mission-card__icon" aria-hidden="true">
                  <MissionIcon type={benefit.icon} />
                </div>
                <div>
                  <h3>{benefit.title}</h3>
                  <p>{benefit.text}</p>
                </div>
              </article>
            ))}
          </div>
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

      <DisclaimerSection />
    </>
  );
}

function MissionIcon({ type }: { type: (typeof missionBenefits)[number]['icon'] }) {
  if (type === 'percent') {
    return (
      <svg viewBox="0 0 64 64" role="img">
        <circle cx="18" cy="18" r="8" />
        <circle cx="46" cy="46" r="8" />
        <path d="M48 12 16 52" />
      </svg>
    );
  }

  if (type === 'flask') {
    return (
      <svg className="mission-icon mission-icon--filled" viewBox="0 0 64 64" role="img">
        <path d="M22 7h20a4 4 0 0 1 0 8h-3v14l14 21c3 5 0 10-6 10H17c-6 0-9-5-6-10l14-21V15h-3a4 4 0 0 1 0-8Zm11 22V15h-2v14L19 48h26L33 29Z" />
        <path d="M18 47h28l3 6H15l3-6Z" />
      </svg>
    );
  }

  if (type === 'group') {
    return (
      <svg viewBox="0 0 64 64" role="img">
        <circle cx="32" cy="22" r="9" />
        <circle cx="16" cy="28" r="7" />
        <circle cx="48" cy="28" r="7" />
        <path d="M18 52c2-10 8-16 14-16s12 6 14 16" />
        <path d="M4 50c1-8 6-13 12-13" />
        <path d="M60 50c-1-8-6-13-12-13" />
      </svg>
    );
  }

  if (type === 'shield') {
    return (
      <svg className="mission-icon mission-icon--shield" viewBox="0 0 64 64" role="img">
        <path d="M32 5 53 14v15c0 15-8 26-21 31C19 55 11 44 11 29V14L32 5Zm0 9-13 6v10c0 10 5 18 13 22V14Z" />
        <path d="M32 14v38c8-4 13-12 13-22V20L32 14Z" />
      </svg>
    );
  }

  return (
    <svg className="mission-icon mission-icon--arrow" viewBox="0 0 64 64" role="img">
      <path d="M33 11c-12 0-22 10-22 22s10 22 22 22c8 0 15-4 19-10l-7-4c-3 4-7 6-12 6-8 0-14-6-14-14s6-14 14-14c4 0 8 2 11 5h-8v8h22V10h-8v8c-4-4-10-7-17-7Z" />
    </svg>
  );
}

function OrderFormPage() {
  return (
    <>
      <PageHero
        eyebrow="Planned Page"
        title="Order-interest form"
        text="A future page for collecting structured order-interest details and sending them into the group workflow automatically."
      />

      <section className="section" aria-labelledby="order-form-title">
        <div className="section__content">
          <div className="section__header">
            <p className="eyebrow">Stub</p>
            <h2 id="order-form-title">Form fields to build later</h2>
            <p>
              The form is not implemented yet. This page reserves the future
              workflow, including vendor-direct coordination and repeated
              disclaimers that Helix Group Testing does not sell products,
              handle money, or fulfill orders.
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
            Possible future feature: email a waiver for review and signature
            after form submission. Testing cost is excluded from the planned
            order form for now.
          </p>
        </div>
      </section>

      <DisclaimerSection />
    </>
  );
}

function TestingPage() {
  return (
    <>
      <PageHero
        eyebrow="Testing"
        title="Testing levels and round stats"
        text="A future hub for explaining testing levels and showing current and historical round statistics."
      />

      <section className="section section--testing" aria-labelledby="testing-title">
        <div className="section__content split">
          <div>
            <p className="eyebrow">Stub</p>
            <h2 id="testing-title">Testing level overview</h2>
            <p>
              This page will explain bronze, gold, and platinum testing levels,
              then summarize stats for active and past rounds.
            </p>
          </div>
          <ul className="check-list check-list--columns">
            {testingFocus.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}

function CoasPage() {
  return (
    <>
      <PageHero
        eyebrow="COAs"
        title="Certificate library"
        text="A future searchable library for COAs and testing documents by compound, round, and batch."
      />

      <section className="section" aria-labelledby="coa-title">
        <div className="section__content">
          <div className="section__header">
            <p className="eyebrow">Stub</p>
            <h2 id="coa-title">COA filters planned</h2>
            <p>
              Future filters should include compound, round, and batch. This
              page is a placeholder until document storage and publishing rules
              are defined.
            </p>
          </div>

          <div className="field-grid">
            <div className="field-card">Compound filter</div>
            <div className="field-card">Round filter</div>
            <div className="field-card">Batch filter</div>
          </div>
        </div>
      </section>
    </>
  );
}

function FaqsPage() {
  const [faqItems, setFaqItems] = useState<FaqItem[]>([]);
  const [faqStatus, setFaqStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let isMounted = true;

    fetch('/faqs.json')
      .then((response) => {
        if (!response.ok) {
          throw new Error('Unable to load FAQs');
        }

        return response.json() as Promise<FaqItem[]>;
      })
      .then((items) => {
        if (isMounted) {
          setFaqItems(items);
          setFaqStatus('ready');
        }
      })
      .catch(() => {
        if (isMounted) {
          setFaqStatus('error');
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <>
      <PageHero
        eyebrow="FAQs"
        title="Common questions"
        text="Answers to common questions about vendor-direct payment, delivery, testing coordination, and site boundaries."
      />

      <section className="section" aria-labelledby="faq-title">
        <div className="section__content">
          <div className="section__header">
            <p className="eyebrow">Reference</p>
            <h2 id="faq-title">Participation FAQ</h2>
            <p>
              These answers summarize the current participation and testing
              workflow. Details may be refined as the site evolves.
            </p>
          </div>

          {faqStatus === 'loading' && <p className="note">Loading FAQs...</p>}
          {faqStatus === 'error' && (
            <p className="note">FAQs could not be loaded. Please try again later.</p>
          )}
          {faqStatus === 'ready' && (
            <div className="faq-list">
              {faqItems.map((item) => (
                <details className="faq-item" key={item.question}>
                  <summary>{item.question}</summary>
                  <p>{item.answer}</p>
                </details>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}

function PageHero({
  eyebrow,
  title,
  text,
}: {
  eyebrow: string;
  title: string;
  text: string;
}) {
  return (
    <section className="page-hero" aria-labelledby={`${title}-title`}>
      <div className="section__content page-hero__content">
        <p className="eyebrow">{eyebrow}</p>
        <h1 id={`${title}-title`}>{title}</h1>
        <p>{text}</p>
      </div>
    </section>
  );
}

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
          <li>Helix Group Testing does not handle money.</li>
          <li>Helix Group Testing does not fulfill orders.</li>
          <li>
            The site is only for formatting communication and organizing
            third-party lab testing interest.
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

export default App;
