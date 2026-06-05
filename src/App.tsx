import { useEffect, useState } from 'react';

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

type PageId = (typeof navItems)[number]['id'];
type FaqItem = {
  question: string;
  answer: string;
};
type TestingTier = (typeof testingTiers)[number];
type TestingTierId = TestingTier['id'];
type TestingIconType = TestingTier['panel'][number]['icon'];
type OrderPeptide = {
  id: string;
  shorthand: string;
  fullName: string;
  supplierCode: string;
  massMg: number;
  price: number;
  tier: TestingTierId;
  headcount: number;
  totalOrdered: number;
  upgradeGoal: number;
  upgradePledged: number;
};
type ContactInfo = {
  name: string;
  address: string;
  phone: string;
};
type OrderDialogStep = 'contact' | 'message';
type SelectedOrderPeptide = OrderPeptide & {
  quantity: number;
};
type LabelFormData = {
  peptideName: string;
  massMg: string;
  batchNumber: string;
  vendor: string;
  purity: string;
  vialSize: string;
  expirationDate: string;
  coaLink: string;
};
type LabelTemplate = {
  id: string;
  name: string;
  author: string;
  peptideTypes: string[];
  generic: boolean;
  featured: boolean;
  editable: boolean;
  votes: number;
  style: 'clinical' | 'dark' | 'safety';
  description: string;
};
type UploadedLabelForm = {
  name: string;
  author: string;
  peptideType: string;
  generic: boolean;
};

const bulkDiscountRate = 0.15;
const maxOrderQuantity = 999;

const testingTierLookup = testingTiers.reduce(
  (accumulator, tier) => ({
    ...accumulator,
    [tier.id]: tier,
  }),
  {} as Record<TestingTierId, TestingTier>,
);

const orderPeptides: OrderPeptide[] = [
  {
    id: 'reta-30',
    shorthand: 'RETA',
    fullName: 'Retatrutide',
    supplierCode: 'HX-RET-30',
    massMg: 30,
    price: 285,
    tier: 'platinum',
    headcount: 18,
    totalOrdered: 44,
    upgradeGoal: 0,
    upgradePledged: 0,
  },
  {
    id: 'bpc-10',
    shorthand: 'BPC',
    fullName: 'BPC-157',
    supplierCode: 'HX-BPC-10',
    massMg: 10,
    price: 42,
    tier: 'platinum',
    headcount: 26,
    totalOrdered: 82,
    upgradeGoal: 0,
    upgradePledged: 0,
  },
  {
    id: 'klow-80',
    shorthand: 'KLOW',
    fullName: 'Kisspeptin-10 Low Endotoxin',
    supplierCode: 'HX-KLW-80',
    massMg: 80,
    price: 118,
    tier: 'gold',
    headcount: 9,
    totalOrdered: 18,
    upgradeGoal: 425,
    upgradePledged: 120,
  },
  {
    id: 'mots-40',
    shorthand: 'MOTS',
    fullName: 'MOTS-c',
    supplierCode: 'HX-MOT-40',
    massMg: 40,
    price: 96,
    tier: 'bronze',
    headcount: 12,
    totalOrdered: 24,
    upgradeGoal: 650,
    upgradePledged: 210,
  },
  {
    id: 'ss31-10',
    shorthand: 'SS-31',
    fullName: 'Elamipretide SS-31',
    supplierCode: 'HX-SS31-10',
    massMg: 10,
    price: 78,
    tier: 'gold',
    headcount: 11,
    totalOrdered: 19,
    upgradeGoal: 425,
    upgradePledged: 75,
  },
  {
    id: 'tirz-15',
    shorthand: 'TIRZ',
    fullName: 'Tirzepatide',
    supplierCode: 'HX-TIR-15',
    massMg: 15,
    price: 115,
    tier: 'platinum',
    headcount: 22,
    totalOrdered: 51,
    upgradeGoal: 0,
    upgradePledged: 0,
  },
  {
    id: 'cjcipa-10',
    shorthand: 'CJC/IP',
    fullName: 'CJC-1295 / Ipamorelin',
    supplierCode: 'HX-CJI-10',
    massMg: 10,
    price: 58,
    tier: 'gold',
    headcount: 15,
    totalOrdered: 31,
    upgradeGoal: 425,
    upgradePledged: 260,
  },
  {
    id: 'tesa-20',
    shorthand: 'TESA',
    fullName: 'Tesamorelin',
    supplierCode: 'HX-TES-20',
    massMg: 20,
    price: 128,
    tier: 'bronze',
    headcount: 8,
    totalOrdered: 14,
    upgradeGoal: 650,
    upgradePledged: 90,
  },
  {
    id: 'semax-5',
    shorthand: 'SEMAX',
    fullName: 'Semax',
    supplierCode: 'HX-SEM-05',
    massMg: 5,
    price: 34,
    tier: 'gold',
    headcount: 7,
    totalOrdered: 16,
    upgradeGoal: 425,
    upgradePledged: 40,
  },
  {
    id: 'selank-5',
    shorthand: 'SELANK',
    fullName: 'Selank',
    supplierCode: 'HX-SEL-05',
    massMg: 5,
    price: 32,
    tier: 'gold',
    headcount: 10,
    totalOrdered: 21,
    upgradeGoal: 425,
    upgradePledged: 155,
  },
  {
    id: 'nad-500',
    shorthand: 'NAD+',
    fullName: 'NAD+',
    supplierCode: 'HX-NAD-500',
    massMg: 500,
    price: 72,
    tier: 'platinum',
    headcount: 16,
    totalOrdered: 38,
    upgradeGoal: 0,
    upgradePledged: 0,
  },
  {
    id: 'kpv-10',
    shorthand: 'KPV',
    fullName: 'KPV',
    supplierCode: 'HX-KPV-10',
    massMg: 10,
    price: 46,
    tier: 'gold',
    headcount: 13,
    totalOrdered: 27,
    upgradeGoal: 425,
    upgradePledged: 185,
  },
  {
    id: 'tb500-10',
    shorthand: 'TB-500',
    fullName: 'TB-500',
    supplierCode: 'HX-TB5-10',
    massMg: 10,
    price: 54,
    tier: 'platinum',
    headcount: 19,
    totalOrdered: 46,
    upgradeGoal: 0,
    upgradePledged: 0,
  },
  {
    id: 'ghkcu-50',
    shorthand: 'GHKCU',
    fullName: 'GHK-Cu',
    supplierCode: 'HX-GHK-50',
    massMg: 50,
    price: 62,
    tier: 'gold',
    headcount: 14,
    totalOrdered: 29,
    upgradeGoal: 425,
    upgradePledged: 315,
  },
  {
    id: 'aod-10',
    shorthand: 'AOD',
    fullName: 'AOD-9604',
    supplierCode: 'HX-AOD-10',
    massMg: 10,
    price: 45,
    tier: 'bronze',
    headcount: 6,
    totalOrdered: 11,
    upgradeGoal: 650,
    upgradePledged: 60,
  },
  {
    id: 'pt141-10',
    shorthand: 'PT-141',
    fullName: 'PT-141',
    supplierCode: 'HX-PT1-10',
    massMg: 10,
    price: 38,
    tier: 'gold',
    headcount: 9,
    totalOrdered: 20,
    upgradeGoal: 425,
    upgradePledged: 130,
  },
];

const massFilters = [
  { id: 'all', label: 'All masses' },
  { id: 'small', label: '5-10 mg' },
  { id: 'medium', label: '15-50 mg' },
  { id: 'large', label: '80+ mg' },
] as const;

type MassFilterId = (typeof massFilters)[number]['id'];

const labelPeptideTypes = [
  'BPC-157',
  'TB-500',
  'Tirzepatide',
  'Retatrutide',
  'Semaglutide',
  'GHK-Cu',
  'NAD+',
  'KPV',
  'Generic',
] as const;

const labelFormDefaults: LabelFormData = {
  peptideName: 'BPC-157',
  massMg: '10',
  batchNumber: 'HX-BPC-10-A',
  vendor: 'Vendor Direct',
  purity: '99.2%',
  vialSize: '3 mL',
  expirationDate: '2027-06-05',
  coaLink: '',
};

const labelFieldLabels: Record<keyof LabelFormData, string> = {
  peptideName: 'Peptide name',
  massMg: 'Mass (mg)',
  batchNumber: 'Batch #',
  vendor: 'Vendor',
  purity: 'Purity',
  vialSize: 'Vial size',
  expirationDate: 'Expiration date',
  coaLink: 'COA link',
};

const labelTemplates: LabelTemplate[] = [
  {
    id: 'clinical-strip',
    name: 'Clinical Strip',
    author: 'Helix Starter',
    peptideTypes: ['Generic'],
    generic: true,
    featured: true,
    editable: true,
    votes: 128,
    style: 'clinical',
    description: 'Clean lab label with high contrast rows and optional COA QR.',
  },
  {
    id: 'night-batch',
    name: 'Night Batch',
    author: 'Helix Starter',
    peptideTypes: ['BPC-157', 'TB-500', 'Tirzepatide'],
    generic: false,
    featured: true,
    editable: true,
    votes: 94,
    style: 'dark',
    description: 'Dark header template built for peptide name and mass-first scanning.',
  },
  {
    id: 'safety-band',
    name: 'Safety Band',
    author: 'Helix Starter',
    peptideTypes: ['Generic'],
    generic: true,
    featured: false,
    editable: true,
    votes: 63,
    style: 'safety',
    description: 'Utility label with a left color band and compact field stack.',
  },
];

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
        {activePage === 'labels' && <LabelsPage />}
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
  const [selectedTierIds, setSelectedTierIds] = useState<Set<TestingTierId>>(
    () => new Set(testingTiers.map((tier) => tier.id)),
  );
  const [massFilter, setMassFilter] = useState<MassFilterId>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [peptideQuantities, setPeptideQuantities] = useState<Record<string, number>>({});
  const [isOrderDialogOpen, setIsOrderDialogOpen] = useState(false);
  const [orderDialogStep, setOrderDialogStep] = useState<OrderDialogStep>('contact');
  const [contactInfo, setContactInfo] = useState<ContactInfo>({
    name: '',
    address: '',
    phone: '',
  });
  const [copyStatus, setCopyStatus] = useState('');

  const filteredPeptides = orderPeptides.filter((peptide) => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    const matchesTier = selectedTierIds.has(peptide.tier);
    const matchesSearch =
      normalizedSearch.length === 0 ||
      peptide.fullName.toLowerCase().includes(normalizedSearch) ||
      peptide.supplierCode.toLowerCase().includes(normalizedSearch) ||
      peptide.shorthand.toLowerCase().includes(normalizedSearch);
    const matchesMass =
      massFilter === 'all' ||
      (massFilter === 'small' && peptide.massMg >= 5 && peptide.massMg <= 10) ||
      (massFilter === 'medium' && peptide.massMg >= 15 && peptide.massMg <= 50) ||
      (massFilter === 'large' && peptide.massMg >= 80);

    return matchesTier && matchesSearch && matchesMass;
  });

  const selectedPeptides = orderPeptides
    .map((peptide) => ({
      ...peptide,
      quantity: peptideQuantities[peptide.id] ?? 0,
    }))
    .filter((peptide) => peptide.quantity > 0);
  const vendorMessage = buildVendorMessage(contactInfo, selectedPeptides);
  const isContactComplete =
    contactInfo.name.trim().length > 0 &&
    contactInfo.address.trim().length > 0 &&
    contactInfo.phone.trim().length > 0;
  const selectedItemCount = selectedPeptides.reduce(
    (total, peptide) => total + peptide.quantity,
    0,
  );
  const selectedOriginalTotal = selectedPeptides.reduce(
    (total, peptide) => total + peptide.price * peptide.quantity,
    0,
  );
  const selectedTotal = selectedPeptides.reduce(
    (total, peptide) => total + getDiscountedPrice(peptide.price) * peptide.quantity,
    0,
  );

  const toggleTierFilter = (tierId: TestingTierId) => {
    setSelectedTierIds((currentTierIds) => {
      const nextTierIds = new Set(currentTierIds);

      if (nextTierIds.has(tierId)) {
        nextTierIds.delete(tierId);
      } else {
        nextTierIds.add(tierId);
      }

      return nextTierIds;
    });
  };

  const setPeptideQuantity = (peptideId: string, quantity: number) => {
    const normalizedQuantity = Math.min(
      maxOrderQuantity,
      Math.max(0, Math.trunc(Number.isFinite(quantity) ? quantity : 0)),
    );

    setPeptideQuantities((currentQuantities) => {
      const nextQuantities = { ...currentQuantities };

      if (normalizedQuantity === 0) {
        delete nextQuantities[peptideId];
      } else {
        nextQuantities[peptideId] = normalizedQuantity;
      }

      return nextQuantities;
    });
  };

  const openOrderDialog = () => {
    setOrderDialogStep('contact');
    setCopyStatus('');
    setIsOrderDialogOpen(true);
  };

  const closeOrderDialog = () => {
    setIsOrderDialogOpen(false);
    setCopyStatus('');
  };

  const updateContactInfo = (field: keyof ContactInfo, value: string) => {
    setContactInfo((currentInfo) => ({
      ...currentInfo,
      [field]: value,
    }));
    setCopyStatus('');
  };

  const copyVendorMessage = async () => {
    try {
      await navigator.clipboard.writeText(vendorMessage);
      setCopyStatus('Copied');
    } catch {
      setCopyStatus('Copy manually');
    }
  };

  return (
    <>
      <section className="order-page" aria-labelledby="order-form-title">
        <div className="order-page__layout">
          <aside className="order-filters" aria-label="Peptide filters">
            <div>
              <p className="eyebrow">Filters</p>
              <h1 id="order-form-title">Order Form</h1>
            </div>

            <label className="filter-search">
              <span>Search</span>
              <input
                type="search"
                value={searchTerm}
                placeholder="Name or code"
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </label>

            <fieldset className="filter-group">
              <legend>Testing tier</legend>
              {testingTiers.map((tier) => (
                <label className={`filter-check filter-check--${tier.id}`} key={tier.id}>
                  <input
                    type="checkbox"
                    checked={selectedTierIds.has(tier.id)}
                    onChange={() => toggleTierFilter(tier.id)}
                  />
                  <span>{tier.name}</span>
                </label>
              ))}
            </fieldset>

            <fieldset className="filter-group">
              <legend>Mass</legend>
              <div className="mass-filter-list">
                {massFilters.map((filter) => (
                  <button
                    className={massFilter === filter.id ? 'mass-filter is-selected' : 'mass-filter'}
                    type="button"
                    key={filter.id}
                    aria-pressed={massFilter === filter.id}
                    onClick={() => setMassFilter(filter.id)}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            </fieldset>
          </aside>

          <section className="peptide-shop" aria-label="Peptides list">
            <div className="peptide-shop__header">
              <div>
                <p className="eyebrow">Current round</p>
                <h2>Peptides List</h2>
              </div>
              <span>{filteredPeptides.length} shown</span>
            </div>

            <div className="peptide-grid">
              {filteredPeptides.map((peptide) => (
                <PeptideCard
                  peptide={peptide}
                  quantity={peptideQuantities[peptide.id] ?? 0}
                  onQuantityChange={(quantity) => setPeptideQuantity(peptide.id, quantity)}
                  key={peptide.id}
                />
              ))}
            </div>

            {filteredPeptides.length === 0 && (
              <p className="empty-state">No peptides match the current filters.</p>
            )}
          </section>

          <aside className="order-summary" aria-label="Your order">
            <div>
              <p className="eyebrow">Your Order</p>
              <h2>{formatCurrency(selectedTotal)}</h2>
            </div>

            <div className="order-summary__meta">
              <span>{selectedItemCount} total vials</span>
              <span>{selectedPeptides.length} peptides</span>
              <span>Vendor direct</span>
            </div>

            <div className="order-summary__items">
              {selectedPeptides.map((peptide) => (
                <div className="order-line" key={peptide.id}>
                  <div>
                    <strong>{peptide.fullName}</strong>
                    <span className="order-line__meta">
                      <span>{peptide.supplierCode}</span>
                      <span>{peptide.massMg} mg</span>
                      <span>Qty {peptide.quantity}</span>
                    </span>
                  </div>
                  <em>{formatCurrency(getDiscountedPrice(peptide.price) * peptide.quantity)}</em>
                </div>
              ))}

              {selectedPeptides.length === 0 && (
                <p className="empty-state">Select peptides to build a running total.</p>
              )}
            </div>

            <div className="order-summary__total">
              <span>Original</span>
              <s>{formatCurrency(selectedOriginalTotal)}</s>
            </div>

            <div className="order-summary__total order-summary__total--discounted">
              <span>Bulk total</span>
              <strong>{formatCurrency(selectedTotal)}</strong>
            </div>

            <button
              className="order-submit"
              type="button"
              disabled={selectedItemCount === 0}
              onClick={openOrderDialog}
            >
              Submit Interest
            </button>

            <p className="order-note">
              This records interest only. Payment and fulfillment remain directly between each
              participant and the vendor.
            </p>
          </aside>
        </div>
      </section>

      {isOrderDialogOpen && (
        <div className="order-dialog-backdrop" role="presentation">
          <section
            className="order-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="order-dialog-title"
          >
            <button
              className="order-dialog__close"
              type="button"
              aria-label="Close"
              onClick={closeOrderDialog}
            >
              x
            </button>

            {orderDialogStep === 'contact' && (
              <form
                className="order-dialog__content"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (isContactComplete) {
                    setOrderDialogStep('message');
                  }
                }}
              >
                <div>
                  <p className="eyebrow">Vendor Message</p>
                  <h2 id="order-dialog-title">Contact Info</h2>
                </div>

                <label className="order-dialog__field">
                  <span>Name</span>
                  <input
                    type="text"
                    value={contactInfo.name}
                    autoFocus
                    onChange={(event) => updateContactInfo('name', event.target.value)}
                  />
                </label>

                <label className="order-dialog__field">
                  <span>Address</span>
                  <textarea
                    rows={4}
                    value={contactInfo.address}
                    onChange={(event) => updateContactInfo('address', event.target.value)}
                  />
                </label>

                <label className="order-dialog__field">
                  <span>Phone</span>
                  <input
                    type="tel"
                    value={contactInfo.phone}
                    onChange={(event) => updateContactInfo('phone', event.target.value)}
                  />
                </label>

                <button className="order-dialog__primary" type="submit" disabled={!isContactComplete}>
                  Next
                </button>
              </form>
            )}

            {orderDialogStep === 'message' && (
              <div className="order-dialog__content">
                <div>
                  <p className="eyebrow">Ready to Copy</p>
                  <h2 id="order-dialog-title">Vendor Message</h2>
                </div>

                <textarea
                  className="vendor-message"
                  value={vendorMessage}
                  readOnly
                  rows={Math.min(14, selectedPeptides.length + 7)}
                />

                <div className="order-dialog__actions">
                  <button
                    className="order-dialog__secondary"
                    type="button"
                    onClick={() => {
                      setOrderDialogStep('contact');
                      setCopyStatus('');
                    }}
                  >
                    Back
                  </button>
                  <button className="order-dialog__primary" type="button" onClick={copyVendorMessage}>
                    Copy
                  </button>
                </div>

                {copyStatus && <p className="copy-status">{copyStatus}</p>}
              </div>
            )}
          </section>
        </div>
      )}

      <DisclaimerSection />
    </>
  );
}

function PeptideCard({
  peptide,
  quantity,
  onQuantityChange,
}: {
  peptide: OrderPeptide;
  quantity: number;
  onQuantityChange: (quantity: number) => void;
}) {
  const tier = testingTierLookup[peptide.tier];
  const discountedPrice = getDiscountedPrice(peptide.price);
  const [isInfoPinned, setIsInfoPinned] = useState(false);

  return (
    <article className={`peptide-card peptide-card--${peptide.tier}`}>
      <div className={isInfoPinned ? 'peptide-info is-pinned' : 'peptide-info'}>
        <button
          className="peptide-info__trigger"
          type="button"
          aria-label={`${peptide.fullName} details`}
          aria-expanded={isInfoPinned}
          onClick={() => setIsInfoPinned((currentValue) => !currentValue)}
        >
          i
        </button>
        <div className="peptide-info__panel">
          <dl>
            <div>
              <dt>Heads</dt>
              <dd>{peptide.headcount}</dd>
            </div>
            <div>
              <dt>Ordered</dt>
              <dd>{peptide.totalOrdered}</dd>
            </div>
          </dl>
          <div className="upgrade-pledge">
            {peptide.upgradeGoal > 0 ? (
              <>
                <button type="button">Fund Upgrade</button>
                <span>
                  {formatWholeCurrency(peptide.upgradePledged)} /{' '}
                  {formatWholeCurrency(peptide.upgradeGoal)}
                </span>
              </>
            ) : (
              <span>Top tier</span>
            )}
          </div>
        </div>
      </div>

      <div className="vial-preview" aria-hidden="true">
        <div className="vial-preview__art">
          <img src="/vial.svg" alt="" />
          <div className="vial-preview__label">
            <strong>{peptide.shorthand}</strong>
            <span>{peptide.massMg} MG</span>
          </div>
        </div>
      </div>

      <div className="peptide-card__body">
        <h3>{peptide.fullName}</h3>
        <dl>
          <div>
            <dt>Supplier code</dt>
            <dd>{peptide.supplierCode}</dd>
          </div>
          <div>
            <dt>Mass</dt>
            <dd>{peptide.massMg} mg</dd>
          </div>
          <div>
            <dt>Price</dt>
            <dd>
              <span className="price-pair">
                <s>{formatCurrency(peptide.price)}</s>
                <strong>{formatCurrency(discountedPrice)}</strong>
              </span>
            </dd>
          </div>
        </dl>
      </div>

      <div className="peptide-card__footer">
        <div>
          <span>{tier.name}</span>
          <strong>{tier.label}</strong>
        </div>
        <div className="quantity-control" aria-label={`${peptide.fullName} quantity`}>
          <button
            type="button"
            aria-label={`Decrease ${peptide.fullName} quantity`}
            onClick={() => onQuantityChange(quantity - 1)}
            disabled={quantity === 0}
          >
            -
          </button>
          <input
            type="number"
            min="0"
            max={maxOrderQuantity}
            value={quantity}
            aria-label={`${peptide.fullName} quantity`}
            onChange={(event) => onQuantityChange(event.target.valueAsNumber)}
          />
          <button
            type="button"
            aria-label={`Increase ${peptide.fullName} quantity`}
            onClick={() => onQuantityChange(quantity + 1)}
          >
            +
          </button>
        </div>
      </div>
    </article>
  );
}

function getDiscountedPrice(price: number) {
  return price * (1 - bulkDiscountRate);
}

function buildVendorMessage(contactInfo: ContactInfo, selectedPeptides: SelectedOrderPeptide[]) {
  const orderLines = selectedPeptides.map(
    (peptide) => `${peptide.supplierCode} x${peptide.quantity}`,
  );

  return [
    `Name: ${contactInfo.name.trim()}`,
    `Address: ${contactInfo.address.trim().replace(/\s+/g, ' ')}`,
    `Phone: ${contactInfo.phone.trim()}`,
    '',
    'Order:',
    ...orderLines,
  ].join('\n');
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatWholeCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
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

function LabelsPage() {
  const [selectedTemplateId, setSelectedTemplateId] = useState(labelTemplates[0].id);
  const [selectedPeptideType, setSelectedPeptideType] = useState<'all' | string>('all');
  const [labelFormData, setLabelFormData] = useState<LabelFormData>(labelFormDefaults);
  const [uploadedTemplates, setUploadedTemplates] = useState<LabelTemplate[]>([]);
  const [localVotes, setLocalVotes] = useState<Record<string, boolean>>({});
  const [uploadForm, setUploadForm] = useState<UploadedLabelForm>({
    name: '',
    author: '',
    peptideType: 'Generic',
    generic: true,
  });

  const allTemplates = [...labelTemplates, ...uploadedTemplates];
  const selectedTemplate =
    allTemplates.find((template) => template.id === selectedTemplateId) ?? allTemplates[0];
  const generatedSvg = renderLabelSvg(selectedTemplate, labelFormData);
  const filteredTemplates = allTemplates.filter((template) => {
    if (selectedPeptideType === 'all') {
      return true;
    }

    if (selectedPeptideType === 'Generic') {
      return template.generic;
    }

    return template.generic || template.peptideTypes.includes(selectedPeptideType);
  });
  const featuredTemplates = allTemplates
    .filter((template) => template.featured || localVotes[template.id])
    .sort((first, second) => getTemplateVotes(second, localVotes) - getTemplateVotes(first, localVotes))
    .slice(0, 4);

  const updateLabelField = (field: keyof LabelFormData, value: string) => {
    setLabelFormData((currentData) => ({
      ...currentData,
      [field]: value,
    }));
  };

  const uploadTemplate = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const cleanName = uploadForm.name.trim();
    if (!cleanName) {
      return;
    }

    const peptideTypes = uploadForm.generic ? ['Generic'] : [uploadForm.peptideType];
    const uploadedTemplate: LabelTemplate = {
      id: `community-${Date.now()}`,
      name: cleanName,
      author: uploadForm.author.trim() || 'Community member',
      peptideTypes,
      generic: uploadForm.generic,
      featured: false,
      editable: true,
      votes: 0,
      style: 'clinical',
      description: 'Community-submitted SVG template awaiting review and votes.',
    };

    setUploadedTemplates((currentTemplates) => [uploadedTemplate, ...currentTemplates]);
    setSelectedTemplateId(uploadedTemplate.id);
    setUploadForm({
      name: '',
      author: '',
      peptideType: 'Generic',
      generic: true,
    });
  };

  const downloadGeneratedSvg = () => {
    const blob = new Blob([generatedSvg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const fileName = `${labelFormData.peptideName || selectedTemplate.name}`
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    link.href = url;
    link.download = `${fileName || 'vial-label'}.svg`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHero
        eyebrow="Label Library"
        title="Vial label generator"
        text="Choose editable SVG templates, filter by peptide type, fill common vial fields, and include an optional COA QR code for printable labels."
      />

      <section className="label-page" aria-labelledby="label-library-title">
        <div className="label-page__layout">
          <aside className="label-panel label-library" aria-label="Label template library">
            <div>
              <p className="eyebrow">Library</p>
              <h2 id="label-library-title">Templates</h2>
            </div>

            <label className="label-field">
              <span>Peptide filter</span>
              <select
                value={selectedPeptideType}
                onChange={(event) => setSelectedPeptideType(event.target.value)}
              >
                <option value="all">All labels</option>
                {labelPeptideTypes.map((peptideType) => (
                  <option value={peptideType} key={peptideType}>
                    {peptideType}
                  </option>
                ))}
              </select>
            </label>

            <div className="label-template-list">
              {filteredTemplates.map((template) => (
                <LabelTemplateCard
                  template={template}
                  isSelected={template.id === selectedTemplate.id}
                  votes={getTemplateVotes(template, localVotes)}
                  isVoted={localVotes[template.id] ?? false}
                  key={template.id}
                  onSelect={() => setSelectedTemplateId(template.id)}
                  onVote={() =>
                    setLocalVotes((currentVotes) => ({
                      ...currentVotes,
                      [template.id]: !currentVotes[template.id],
                    }))
                  }
                />
              ))}
            </div>
          </aside>

          <section className="label-generator" aria-labelledby="label-generator-title">
            <div className="label-generator__header">
              <div>
                <p className="eyebrow">Generator</p>
                <h2 id="label-generator-title">{selectedTemplate.name}</h2>
                <p>{selectedTemplate.description}</p>
              </div>
              <button className="label-primary-action" type="button" onClick={downloadGeneratedSvg}>
                Download SVG
              </button>
            </div>

            <div className="label-preview-shell">
              <div
                className="label-preview"
                aria-label="Generated vial label preview"
                dangerouslySetInnerHTML={{ __html: generatedSvg }}
              />
            </div>

            <div className="featured-labels" aria-label="Featured community labels">
              <div>
                <p className="eyebrow">Featured Queue</p>
                <h3>Community picks</h3>
              </div>
              <div className="featured-labels__grid">
                {featuredTemplates.map((template) => (
                  <button
                    className="featured-label"
                    type="button"
                    key={template.id}
                    onClick={() => setSelectedTemplateId(template.id)}
                  >
                    <strong>{template.name}</strong>
                    <span>{getTemplateVotes(template, localVotes)} votes</span>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <aside className="label-panel label-controls" aria-label="Label generator fields">
            <form className="label-form">
              <div>
                <p className="eyebrow">Fill Label</p>
                <h2>Fields</h2>
              </div>

              {(
                [
                  'peptideName',
                  'massMg',
                  'batchNumber',
                  'vendor',
                  'purity',
                  'vialSize',
                  'expirationDate',
                ] as (keyof LabelFormData)[]
              ).map((field) => (
                <label className="label-field" key={field}>
                  <span>{labelFieldLabels[field]}</span>
                  <input
                    type={field === 'expirationDate' ? 'date' : 'text'}
                    value={labelFormData[field]}
                    onChange={(event) => updateLabelField(field, event.target.value)}
                  />
                </label>
              ))}

              <label className="label-field">
                <span>{labelFieldLabels.coaLink}</span>
                <input
                  type="url"
                  value={labelFormData.coaLink}
                  placeholder="https://..."
                  onChange={(event) => updateLabelField('coaLink', event.target.value)}
                />
              </label>
            </form>

            <form className="label-upload" onSubmit={uploadTemplate}>
              <div>
                <p className="eyebrow">Upload</p>
                <h2>Share a template</h2>
              </div>

              <label className="label-field">
                <span>Template SVG</span>
                <input type="file" accept=".svg,image/svg+xml" />
              </label>

              <label className="label-field">
                <span>Template name</span>
                <input
                  type="text"
                  value={uploadForm.name}
                  onChange={(event) =>
                    setUploadForm((currentForm) => ({
                      ...currentForm,
                      name: event.target.value,
                    }))
                  }
                />
              </label>

              <label className="label-field">
                <span>Author</span>
                <input
                  type="text"
                  value={uploadForm.author}
                  onChange={(event) =>
                    setUploadForm((currentForm) => ({
                      ...currentForm,
                      author: event.target.value,
                    }))
                  }
                />
              </label>

              <label className="label-toggle">
                <input
                  type="checkbox"
                  checked={uploadForm.generic}
                  onChange={(event) =>
                    setUploadForm((currentForm) => ({
                      ...currentForm,
                      generic: event.target.checked,
                    }))
                  }
                />
                <span>Generic label</span>
              </label>

              {!uploadForm.generic && (
                <label className="label-field">
                  <span>Peptide type</span>
                  <select
                    value={uploadForm.peptideType}
                    onChange={(event) =>
                      setUploadForm((currentForm) => ({
                        ...currentForm,
                        peptideType: event.target.value,
                      }))
                    }
                  >
                    {labelPeptideTypes
                      .filter((peptideType) => peptideType !== 'Generic')
                      .map((peptideType) => (
                        <option value={peptideType} key={peptideType}>
                          {peptideType}
                        </option>
                      ))}
                  </select>
                </label>
              )}

              <button className="label-primary-action" type="submit">
                Add to Library
              </button>
            </form>
          </aside>
        </div>
      </section>
    </>
  );
}

function LabelTemplateCard({
  template,
  isSelected,
  votes,
  isVoted,
  onSelect,
  onVote,
}: {
  template: LabelTemplate;
  isSelected: boolean;
  votes: number;
  isVoted: boolean;
  onSelect: () => void;
  onVote: () => void;
}) {
  return (
    <article className={isSelected ? 'label-template is-selected' : 'label-template'}>
      <button className="label-template__preview" type="button" onClick={onSelect}>
        <span dangerouslySetInnerHTML={{ __html: renderLabelSvg(template, labelFormDefaults) }} />
      </button>
      <div className="label-template__body">
        <div>
          <h3>{template.name}</h3>
          <p>{template.author}</p>
        </div>
        <div className="label-template__tags">
          {template.generic && <span>Generic</span>}
          {template.featured && <span>Featured</span>}
          {template.editable && <span>Editable</span>}
        </div>
        <button
          className={isVoted ? 'label-vote is-voted' : 'label-vote'}
          type="button"
          aria-pressed={isVoted}
          onClick={onVote}
        >
          {votes} votes
        </button>
      </div>
    </article>
  );
}

function getTemplateVotes(template: LabelTemplate, localVotes: Record<string, boolean>) {
  return template.votes + (localVotes[template.id] ? 1 : 0);
}

function renderLabelSvg(template: LabelTemplate, data: LabelFormData) {
  const labelRows = getLabelRows(data);
  const peptideName = data.peptideName.trim();
  const mass = data.massMg.trim();
  const coaLink = data.coaLink.trim();
  const qrImage = coaLink
    ? `<image href="${escapeSvgAttribute(
        `https://api.qrserver.com/v1/create-qr-code/?size=160x160&margin=1&data=${encodeURIComponent(
          coaLink,
        )}`,
      )}" x="57" y="18" width="10" height="10" preserveAspectRatio="none" /><rect x="57" y="18" width="10" height="10" fill="none" stroke="#07101f" stroke-width=".25" /><text x="62" y="30.5" text-anchor="middle" font-size="1.55" font-family="Inter, Arial, sans-serif" font-weight="800" fill="#344154">COA</text>`
    : '';
  const rowLimit = coaLink ? 42 : 55;
  const rowsSvg = labelRows
    .map(
      (row, index) =>
        `<text x="5" y="${14 + index * 2.8}" font-size="1.95" font-family="Inter, Arial, sans-serif" fill="#344154"><tspan font-weight="800">${escapeSvgText(
          row.label,
        )}</tspan><tspan dx="1.1" fill="#07101f">${escapeSvgText(
          truncateLabelText(row.value, rowLimit),
        )}</tspan></text>`,
    )
    .join('');

  if (template.style === 'dark') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="70mm" height="32mm" viewBox="0 0 70 32" role="img" aria-label="Generated vial label">
  <rect width="70" height="32" rx="2" fill="#f7fafc" />
  <rect width="70" height="10.8" rx="2" fill="#07101f" />
  <rect y="9" width="70" height="1.8" fill="#13f4ff" />
  ${peptideName ? `<text x="5" y="6.8" font-size="4.6" font-family="Inter, Arial, sans-serif" font-weight="900" fill="#ffffff">${escapeSvgText(truncateLabelText(peptideName, 22))}</text>` : ''}
  ${mass ? `<text x="64" y="6.6" text-anchor="end" font-size="3.2" font-family="Inter, Arial, sans-serif" font-weight="900" fill="#13f4ff">${escapeSvgText(truncateLabelText(`${mass} mg`, 10))}</text>` : ''}
  ${rowsSvg}
  ${qrImage}
</svg>`;
  }

  if (template.style === 'safety') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="70mm" height="32mm" viewBox="0 0 70 32" role="img" aria-label="Generated vial label">
  <rect width="70" height="32" rx="2" fill="#fffefd" />
  <rect width="7.4" height="32" fill="#e8b943" />
  <rect x="9.8" y="3.4" width="36" height="5.8" rx="1.2" fill="#07101f" />
  ${peptideName ? `<text x="12" y="7.6" font-size="3.3" font-family="Inter, Arial, sans-serif" font-weight="900" fill="#ffffff">${escapeSvgText(truncateLabelText(peptideName, 20))}</text>` : ''}
  ${mass ? `<text x="50" y="7.6" font-size="3.1" font-family="Inter, Arial, sans-serif" font-weight="900" fill="#9b5526">${escapeSvgText(truncateLabelText(`${mass} mg`, 11))}</text>` : ''}
  ${rowsSvg}
  ${qrImage}
</svg>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="70mm" height="32mm" viewBox="0 0 70 32" role="img" aria-label="Generated vial label">
  <rect width="70" height="32" rx="2" fill="#ffffff" />
  <rect x="0" y="0" width="70" height="5.6" fill="#13f4ff" />
  <rect x="0" y="5.6" width="70" height=".8" fill="#07101f" />
  ${peptideName ? `<text x="5" y="10.5" font-size="4" font-family="Inter, Arial, sans-serif" font-weight="900" fill="#07101f">${escapeSvgText(truncateLabelText(peptideName, 24))}</text>` : ''}
  ${mass ? `<rect x="49" y="7.4" width="17" height="5" rx="1.4" fill="#eafbff" stroke="#00aeb8" stroke-width=".35" /><text x="57.5" y="10.9" text-anchor="middle" font-size="2.7" font-family="Inter, Arial, sans-serif" font-weight="900" fill="#006f78">${escapeSvgText(truncateLabelText(`${mass} mg`, 9))}</text>` : ''}
  ${rowsSvg}
  ${qrImage}
</svg>`;
}

function getLabelRows(data: LabelFormData) {
  return [
    { label: 'Mass', value: data.massMg.trim() ? `${data.massMg.trim()} mg` : '' },
    { label: 'Batch', value: data.batchNumber.trim() },
    { label: 'Vendor', value: data.vendor.trim() },
    { label: 'Purity', value: data.purity.trim() },
    { label: 'Vial', value: data.vialSize.trim() },
    { label: 'Exp', value: data.expirationDate.trim() },
  ].filter((row) => row.value.length > 0);
}

function escapeSvgText(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeSvgAttribute(value: string) {
  return escapeSvgText(value).replace(/"/g, '&quot;');
}

function truncateLabelText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
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
