import { type FormEvent, useEffect, useState } from 'react';
import FaqsPage from './FaqsPage';
import LabelsPage from './LabelsPage';
import OrderFormPage from './OrderFormPage';
import DisclaimerSection from './Helpers/DisclaimerSection';
import PageHero from './Helpers/PageHero';

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

const currentTestingRound = {
  name: 'Round 1',
  status: 'Collecting signups',
  participants: 42,
  selectedPeptides: 18,
  qualifiedPeptides: 18,
  targetWindow: 'June testing queue',
};

const testingTiers = [
  {
    id: 'platinum',
    name: 'Platinum',
    label: '7x Testing',
    description: 'The most comprehensive QC panel with identity, purity, safety screening, and conformity checks.',
    qualifiedCount: 7,
    turnaround: '3-5 business days',
    turnaroundNote: 'Rush service available for time-sensitive projects',
    peptides: [
      'BPC-157',
      'TB-500',
      'Retatrutide',
      'Tirzepatide',
      'Semaglutide',
      'Cagrilintide',
      'NAD+',
    ],
    panel: [
      {
        icon: 'flask',
        title: 'Purity & Quantitation (HPLC)',
        method: 'USP <621> / Reversed-Phase HPLC',
        text: 'Reversed-phase HPLC analysis for peptide purity assessment and active content determination. Results report both purity percentage and quantitative content per vial.',
      },
      {
        icon: 'atom',
        title: 'Identity Confirmation',
        method: 'LC-MS Molecular Weight Confirmation',
        text: 'LC-MS based molecular weight confirmation to verify peptide identity. Results confirm the expected molecular ion matches the target compound.',
      },
      {
        icon: 'microscope',
        title: 'Endotoxin (USP <85>)',
        method: 'USP <85> Kinetic Chromogenic LAL',
        text: 'Kinetic chromogenic LAL method for bacterial endotoxin quantitation. Results are reported in EU/mg with full method documentation on the Certificate of Analysis.',
      },
      {
        icon: 'vial',
        title: 'Heavy Metals (ICP-MS)',
        method: 'ICP-MS / ICH Q3D Elemental Impurities',
        text: 'Multi-element screening for residual metals commonly introduced during solid-phase peptide synthesis, including copper, zinc, iron, and lead.',
      },
      {
        icon: 'tubes',
        title: 'Rapid Sterility Screen',
        method: 'DNA Microarray Rapid Detection',
        text: 'DNA-based microarray platform for rapid detection of a broad panel of microbial contaminants. Results are available in days, not the traditional 14-day incubation period.',
      },
      {
        icon: 'shield',
        title: 'Fentanyl Testing',
        method: 'LC-MS/MS Targeted Screening',
        text: 'LC-MS/MS based targeted screening for fentanyl and its analogs to help ensure product safety and compliance. Sensitive detection at low parts-per-billion levels with full method documentation.',
      },
      {
        icon: 'badge',
        title: 'Batch Conformity Testing',
        method: 'Comparative Analytical Assessment',
        text: 'Comprehensive comparison of critical quality attributes between production batches to ensure consistency and conformity to specification.',
      },
    ],
    includes: [
      'Purity & Quantitation (HPLC)',
      'Identity Confirmation',
      'Endotoxin (USP <85>)',
      'Heavy Metals (ICP-MS)',
      'Rapid Sterility Screen (DNA Microarray)',
      'Fentanyl Testing',
      'Batch Conformity Testing',
    ],
    additional: [
      {
        title: 'Fentanyl Testing',
        text: 'LC-MS/MS targeted screening for fentanyl and analogs to support safety documentation.',
      },
      {
        title: 'Batch Conformity Testing',
        text: 'Comparative analytical assessment to check consistency across production batches.',
      },
    ],
  },
  {
    id: 'gold',
    name: 'Gold',
    label: '5x Testing',
    description: 'Expanded QC for selected peptides that need purity, identity, endotoxin, sterility, and metals coverage.',
    qualifiedCount: 6,
    turnaround: '5-7 business days',
    turnaroundNote: 'Balanced panel for broad round coverage',
    peptides: ['GHK-Cu', 'KPV', 'Selank', 'Epitalon', 'DSIP', 'PT-141'],
    panel: [
      {
        icon: 'flask',
        title: 'Purity & Quantitation (HPLC)',
        method: 'USP <621> / Reversed-Phase HPLC',
        text: 'Purity and content analysis for documenting the primary quality profile of each selected peptide.',
      },
      {
        icon: 'atom',
        title: 'Identity Confirmation',
        method: 'LC-MS Molecular Weight Confirmation',
        text: 'Molecular weight confirmation to verify that the submitted sample matches the expected compound.',
      },
      {
        icon: 'microscope',
        title: 'Endotoxin (USP <85>)',
        method: 'Kinetic Chromogenic LAL',
        text: 'Endotoxin screening with results reported in EU/mg and referenced in the round documentation.',
      },
      {
        icon: 'vial',
        title: 'Heavy Metals (ICP-MS)',
        method: 'Elemental Impurities',
        text: 'Screening for residual metals that can appear during synthesis, handling, or packaging.',
      },
      {
        icon: 'tubes',
        title: 'Rapid Sterility Screen',
        method: 'DNA Microarray Rapid Detection',
        text: 'Rapid microbial contaminant screening for a faster view into sterility risk indicators.',
      },
    ],
    includes: [
      'Purity & Quantitation (HPLC)',
      'Identity Confirmation',
      'Endotoxin (USP <85>)',
      'Heavy Metals (ICP-MS)',
      'Rapid Sterility Screen',
    ],
    additional: [
      {
        title: 'Optional Fentanyl Testing',
        text: 'Can be added when the group wants targeted screening for an individual compound.',
      },
    ],
  },
  {
    id: 'bronze',
    name: 'Bronze',
    label: '2x Testing',
    description: 'Core confirmation for lower-risk round selections with purity and identity documentation.',
    qualifiedCount: 5,
    turnaround: '7-10 business days',
    turnaroundNote: 'Core documentation for routine selections',
    peptides: ['MOTS-c', 'P21', 'AOD-9604', 'Pinealon', 'Tesamorelin'],
    panel: [
      {
        icon: 'flask',
        title: 'Purity & Quantitation (HPLC)',
        method: 'Reversed-Phase HPLC',
        text: 'Baseline purity and quantity reporting for each peptide selected for the bronze tier.',
      },
      {
        icon: 'atom',
        title: 'Identity Confirmation',
        method: 'LC-MS Molecular Weight Confirmation',
        text: 'Identity confirmation to help document that the submitted sample matches the expected target.',
      },
    ],
    includes: ['Purity & Quantitation (HPLC)', 'Identity Confirmation'],
    additional: [
      {
        title: 'Escalation Path',
        text: 'A bronze peptide can move up if round interest or risk review calls for broader screening.',
      },
    ],
  },
] as const;

const navItems = [
  { id: 'home', label: 'Home', path: '/' },
  { id: 'order-form', label: 'Order Form', path: '/order-form' },
  { id: 'testing', label: 'Testing', path: '/testing' },
  { id: 'coas', label: 'COAs', path: '/coas' },
  { id: 'labels', label: 'Labels', path: '/labels' },
  { id: 'faqs', label: 'FAQs', path: '/faqs' },
] as const;

type PageId = (typeof navItems)[number]['id'] | 'hxadmin';
type TestingTier = (typeof testingTiers)[number];
type TestingIconType = TestingTier['panel'][number]['icon'];
type AdminSession = {
  isAuthenticated: boolean;
  role?: 'owner' | 'admin';
};

function getPageFromPath(): PageId {
  const currentPath = window.location.pathname.replace(/\/$/, '') || '/';

  if (currentPath === '/hxadmin') {
    return 'hxadmin';
  }

  const match = navItems.find((item) => item.path === currentPath);
  return match?.id ?? 'home';
}

function App() {
  const [activePage, setActivePage] = useState<PageId>(getPageFromPath);
  const [adminSession, setAdminSession] = useState<AdminSession>({ isAuthenticated: false });

  useEffect(() => {
    const handleNavigation = () => setActivePage(getPageFromPath());

    window.addEventListener('popstate', handleNavigation);
    return () => window.removeEventListener('popstate', handleNavigation);
  }, []);

  useEffect(() => {
    let isMounted = true;

    fetchAdminSession()
      .then((session) => {
        if (isMounted) {
          setAdminSession(session);
        }
      })
      .catch(() => {
        if (isMounted) {
          setAdminSession({ isAuthenticated: false });
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const navigateTo = (path: string) => {
    window.history.pushState({}, '', path);
    setActivePage(getPageFromPath());
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <>
      <SiteHeader activePage={activePage} isAdmin={adminSession.isAuthenticated} onNavigate={navigateTo} />
      <main>
        {activePage === 'home' && <HomePage />}
        {activePage === 'order-form' && <OrderFormPage />}
        {activePage === 'testing' && <TestingPage />}
        {activePage === 'coas' && <CoasPage />}
        {activePage === 'labels' && <LabelsPage isAdmin={adminSession.isAuthenticated} />}
        {activePage === 'faqs' && <FaqsPage />}
        {activePage === 'hxadmin' && (
          <AdminPage
            session={adminSession}
            onSessionChange={setAdminSession}
            onNavigate={navigateTo}
          />
        )}
      </main>
    </>
  );
}

function SiteHeader({
  activePage,
  isAdmin,
  onNavigate,
}: {
  activePage: PageId;
  isAdmin: boolean;
  onNavigate: (path: string) => void;
}) {
  const visibleNavItems = isAdmin
    ? [...navItems, { id: 'hxadmin', label: 'Admin', path: '/hxadmin' } as const]
    : navItems;

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
          {visibleNavItems.map((item) => (
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

function TestingPage() {
  const [selectedTierId, setSelectedTierId] = useState<TestingTier['id']>('platinum');
  const selectedTier =
    testingTiers.find((tier) => tier.id === selectedTierId) ?? testingTiers[0];

  return (
    <section className="testing-dashboard" aria-labelledby="testing-title">
      <div className="section__content testing-dashboard__content">
        <div className="testing-overview">
          <aside className="round-summary" aria-label="Current round stats">
            <p className="eyebrow">Current round</p>
            <h1 id="testing-title">{currentTestingRound.name}</h1>
            <p>{currentTestingRound.status}</p>

            <dl className="round-summary__stats">
              <div>
                <dt>Members</dt>
                <dd>{currentTestingRound.participants}</dd>
              </div>
              <div>
                <dt>Selected peptides</dt>
                <dd>{currentTestingRound.selectedPeptides}</dd>
              </div>
              <div>
                <dt>Qualified</dt>
                <dd>{currentTestingRound.qualifiedPeptides}</dd>
              </div>
              <div>
                <dt>Target window</dt>
                <dd>{currentTestingRound.targetWindow}</dd>
              </div>
            </dl>
          </aside>

          <div className="tier-selector" aria-label="Testing tiers">
            {testingTiers.map((tier) => (
              <button
                className={`tier-button tier-button--${tier.id} ${
                  selectedTier.id === tier.id ? 'is-selected' : ''
                }`}
                type="button"
                key={tier.id}
                aria-pressed={selectedTier.id === tier.id}
                aria-controls="testing-tier-details"
                onClick={() => setSelectedTierId(tier.id)}
              >
                <span>{tier.name}</span>
                <strong>{tier.label}</strong>
                <em>{tier.description}</em>
                <small>{tier.qualifiedCount} qualified peptides</small>
              </button>
            ))}
          </div>
        </div>

        <TestingTierDetails tier={selectedTier} />
      </div>
    </section>
  );
}

function AdminPage({
  session,
  onSessionChange,
  onNavigate,
}: {
  session: AdminSession;
  onSessionChange: (session: AdminSession) => void;
  onNavigate: (path: string) => void;
}) {
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setStatus('');

    try {
      const nextSession = await loginAdmin(password);

      onSessionChange(nextSession);
      setPassword('');
      setStatus(nextSession.isAuthenticated ? 'Logged in' : 'Login failed');
    } catch {
      setStatus('Login failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const logout = async () => {
    setIsSubmitting(true);
    setStatus('');

    try {
      await logoutAdmin();
      onSessionChange({ isAuthenticated: false });
      setStatus('Logged out');
    } catch {
      setStatus('Logout failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="admin-page" aria-labelledby="admin-title">
      <div className="admin-page__panel">
        <p className="eyebrow">Admin</p>
        <h1 id="admin-title">Helix admin</h1>

        {session.isAuthenticated ? (
          <div className="admin-session-card">
            <p>Signed in as {session.role ?? 'owner'}.</p>
            <div className="admin-actions">
              <button type="button" onClick={() => onNavigate('/labels')}>
                Open Labels
              </button>
              <button type="button" disabled={isSubmitting} onClick={logout}>
                Log Out
              </button>
            </div>
          </div>
        ) : (
          <form className="admin-login" onSubmit={login}>
            <label>
              <span>Password</span>
              <input
                type="password"
                value={password}
                autoComplete="current-password"
                autoFocus
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <button type="submit" disabled={isSubmitting || password.trim().length === 0}>
              Log In
            </button>
          </form>
        )}

        {status && <p className="admin-status">{status}</p>}
      </div>
    </section>
  );
}

function TestingTierDetails({ tier }: { tier: TestingTier }) {
  return (
    <article
      className={`tier-detail tier-detail--${tier.id}`}
      id="testing-tier-details"
      aria-labelledby="tier-detail-title"
    >
      <div className="tier-detail__main">
        <header className="tier-detail__header">
          <div className="tier-detail__brand" aria-hidden="true">
            <img src="/helix_logo.svg" alt="" />
          </div>
          <div>
            <p className="eyebrow">{tier.name} testing</p>
            <h2 id="tier-detail-title">{tier.name.toUpperCase()} TESTING</h2>
            <p>
              <strong className="testing-label">{tier.label}</strong> - {tier.description}
            </p>
          </div>
        </header>

        <div className="qc-grid">
          {tier.panel.map((item) => (
            <section className="qc-tile" key={item.title}>
              <div className="qc-tile__icon" aria-hidden="true">
                <TestingIcon type={item.icon} />
              </div>
              <div>
                <h3>{item.title}</h3>
                <strong>{item.method}</strong>
                <p>{item.text}</p>
              </div>
            </section>
          ))}
        </div>
      </div>

      <aside className="tier-detail__side">
        <h3>Full QC Panel Includes</h3>
        <ul className="panel-list">
          {tier.includes.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>

        <div className="turnaround">
          <strong>{tier.turnaround}</strong>
          <span>{tier.turnaroundNote}</span>
        </div>

        <div className="additional-tests">
          <h4>Additional Tests</h4>
          {tier.additional.map((item) => (
            <div key={item.title}>
              <strong>{item.title}</strong>
              <p>{item.text}</p>
            </div>
          ))}
        </div>
      </aside>

      <section className="qualified-list" aria-label={`${tier.name} qualified peptides`}>
        <div>
          <p className="eyebrow">Qualified this round</p>
          <h3>{tier.qualifiedCount} peptides assigned to {tier.name}</h3>
        </div>
        <ul>
          {tier.peptides.map((peptide) => (
            <li key={peptide}>{peptide}</li>
          ))}
        </ul>
      </section>
    </article>
  );
}

function TestingIcon({ type }: { type: TestingIconType }) {
  if (type === 'atom') {
    return (
      <svg viewBox="0 0 64 64" role="img">
        <circle cx="32" cy="32" r="5" />
        <ellipse cx="32" cy="32" rx="25" ry="10" />
        <ellipse cx="32" cy="32" rx="25" ry="10" transform="rotate(60 32 32)" />
        <ellipse cx="32" cy="32" rx="25" ry="10" transform="rotate(120 32 32)" />
      </svg>
    );
  }

  if (type === 'microscope') {
    return (
      <svg viewBox="0 0 64 64" role="img">
        <path d="M25 9h12v18H25z" />
        <path d="M31 27v10c0 6-5 11-11 11h-5" />
        <path d="M37 16h9v16h-9" />
        <path d="M18 56h31" />
        <path d="M43 48c0 4-3 8-8 8" />
      </svg>
    );
  }

  if (type === 'vial') {
    return (
      <svg viewBox="0 0 64 64" role="img">
        <path d="M24 8h16" />
        <path d="M28 8v12L18 46c-2 6 1 10 7 10h14c6 0 9-4 7-10L36 20V8" />
        <path d="M22 42h20" />
      </svg>
    );
  }

  if (type === 'tubes') {
    return (
      <svg viewBox="0 0 64 64" role="img">
        <path d="M14 9h12" />
        <path d="M18 9v37a6 6 0 0 0 12 0V9" />
        <path d="M38 9h12" />
        <path d="M42 9v37a6 6 0 0 0 12 0V9" />
        <path d="M18 36h12" />
        <path d="M42 31h12" />
      </svg>
    );
  }

  if (type === 'shield') {
    return (
      <svg viewBox="0 0 64 64" role="img">
        <path d="M32 7 52 16v14c0 14-8 23-20 28-12-5-20-14-20-28V16L32 7Z" />
        <path d="m23 32 6 6 13-15" />
      </svg>
    );
  }

  if (type === 'badge') {
    return (
      <svg viewBox="0 0 64 64" role="img">
        <path d="M32 6 50 16v19c0 10-7 18-18 23-11-5-18-13-18-23V16L32 6Z" />
        <path d="M23 34h18" />
        <path d="M23 25h18" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 64 64" role="img">
      <path d="M24 7h16" />
      <path d="M28 7v18L15 49c-2 4 1 8 6 8h22c5 0 8-4 6-8L36 25V7" />
      <path d="M22 42h20" />
    </svg>
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

async function fetchAdminSession(): Promise<AdminSession> {
  const response = await fetch('/api/admin/session', {
    credentials: 'same-origin',
  });

  if (!response.ok) {
    return { isAuthenticated: false };
  }

  return normalizeAdminSession(await response.json());
}

async function loginAdmin(password: string): Promise<AdminSession> {
  const response = await fetch('/api/admin/login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password }),
  });

  if (!response.ok) {
    throw new Error('Admin login failed.');
  }

  return normalizeAdminSession(await response.json());
}

async function logoutAdmin() {
  const response = await fetch('/api/admin/logout', {
    method: 'POST',
    credentials: 'same-origin',
  });

  if (!response.ok) {
    throw new Error('Admin logout failed.');
  }
}

function normalizeAdminSession(value: unknown): AdminSession {
  if (!value || typeof value !== 'object') {
    return { isAuthenticated: false };
  }

  const session = value as Partial<AdminSession>;

  return {
    isAuthenticated: session.isAuthenticated === true,
    role: session.role === 'admin' ? 'admin' : session.isAuthenticated ? 'owner' : undefined,
  };
}

export default App;
