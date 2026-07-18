import { type FormEvent, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CircleCheckBig } from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import AccountPage from './AccountPage';
import AdminPage from './AdminPage';
import FaqsPage from './FaqsPage';
import LabelsPage from './LabelsPage';
import OrderFormPage from './OrderFormPage';
import DisclaimerSection from './Helpers/DisclaimerSection';
import PageHero from './Helpers/PageHero';
import {
  createCoaDetailPath,
  createCoaListPath,
  createCoaPeptideFilterOptions,
  defaultCoaFilters,
  parseCoaFilterSearch,
} from './coa-filter-url.mjs';
import { publicPageItems, type PublicPageId } from './page-disables';
import { fetchRounds, getCurrentRounds, sortRoundsForDisplay, type Round, type RoundPeptide, type TestingTierId } from './rounds';
import {
  type AccountSession,
  signedOutAccountSession,
} from './account-types';

pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

const coordinationPoints = [
  'Members coordinate current testing rounds, selected peptides, and shared third-party lab testing scope.',
  'Vendor payment and delivery happen directly between each member and the vendor, outside this site.',
  'Testing-only funds may be coordinated for lab costs; this site does not sell or fulfill products.',
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
  'Peptide Identity',
  'Purity',
  'Content / Quantity',
  'Endotoxin (USP <85>)',
  'Heavy Metals (ICP-MS)',
  'Microbial Limits',
  'Sterility',
  'Fentanyl Screening',
  'Batch Conformity Add-on',
];

const currentTestingRound = {
  name: 'Round 1',
  status: 'Collecting signups',
  participants: 42,
  selectedPeptides: 18,
  qualifiedPeptides: 18,
  targetWindow: 'June testing queue',
};

type TestingPanelItem = {
  icon: 'flask' | 'atom' | 'microscope' | 'vial' | 'tubes' | 'shield';
  title: string;
  method: string;
  text: string;
};

type TestingPeptidePill = {
  id: string;
  label: string;
  batchConformity: boolean;
};

type TestingTier = {
  id: TestingTierId;
  name: string;
  label: string;
  description: string;
  qualifiedCount: number;
  assignmentLabel?: string;
  turnaround: string;
  turnaroundNote: string;
  peptides: Array<string | TestingPeptidePill>;
  panel: TestingPanelItem[];
  includes: string[];
  additional: {
    title: string;
    text: string;
  }[];
};

type CoaResult = {
  id: string;
  roundId: string;
  roundPeptideId: string;
  peptideId: string;
  peptideName: string;
  code: string;
  mass: string;
  batchNumber: string;
  dateTested: string;
  lab: string;
  coaNumber: string;
  accessionNumber: string;
  verificationUrl: string;
  roundName: string;
  testingTier: TestingTierId;
  averageNetContent: string;
  purity: string;
  endotoxins: string;
  heavyMetals: string;
  sterility: string;
  fentanyl: string;
  capColor: string;
  coaFileName?: string;
  coaMimeType?: string;
  coaBlobKey?: string;
  coaUploadedAt?: string;
  vialImageAssetKey?: string;
  vialImageMimeType?: string;
  vialImageFileName?: string;
  vialImageSource?: string;
  vialImageMode?: 'extracted' | 'placeholder';
  vialImageExtractedAt?: string;
  parsedCoa?: ParsedCoa;
  createdAt?: string;
  updatedAt?: string;
  vialImageUrl?: string;
  isResultLocked: boolean;
  hasRoundPasscode: boolean;
  lockedResultStates: Record<string, 'pending' | 'populated'>;
};

type ParsedCoa = {
  parserVersion: string;
  extractionMethod: string;
  templateId: string;
  templateConfidence: number;
  matchedAnchors: string[];
  pageCount: number;
  confidence: number;
  fields: {
    lab: string;
    coaNumber: string;
    lotNumber: string;
    accessionNumber: string;
    productName: string;
    identityConfirmation: string;
    analysisDate: string;
    dateReceived: string;
    issuedDate: string;
    labeledContent: string;
    purity: string;
    averageNetContent: string;
    meanPurity: string;
    endotoxinResult: string;
    endotoxinThreshold: string;
    heavyMetals: string;
    sterility: string;
    endotoxins: string;
    fentanyl: string;
    accessCode: string;
    verificationUrl: string;
    overallStatus: string;
  };
  warnings: string[];
  raw?: {
    verificationUrls?: string[];
    snippets?: Record<string, string>;
    vialImage?: {
      pageNumber: number;
      operatorIndex: number;
      imageName: string;
      width: number;
      height: number;
      drawnX: number;
      drawnY: number;
      drawnWidth: number;
      drawnHeight: number;
      mimeType: string;
      score: number;
    } | null;
  };
  error?: string;
};

type CoaPreviewPage = {
  pageNumber: number;
  src: string;
  width: number;
  height: number;
};

type CoaBatchFormRow = {
  id: string;
  roundPeptideId: string;
  batchNumber: string;
  capColor: string;
  code: string;
  file: File | null;
};

type CoaEditForm = {
  roundId: string;
  roundPeptideId: string;
  batchNumber: string;
  capColor: string;
  code: string;
  dateTested: string;
  lab: string;
  coaNumber: string;
  accessionNumber: string;
  verificationUrl: string;
  averageNetContent: string;
  purity: string;
  endotoxins: string;
  heavyMetals: string;
  sterility: string;
  fentanyl: string;
  file: File | null;
};

type CoaUploadDraft = {
  id: string;
  file: File;
  matchedCoaId: string;
  parsedBatchNumber: string;
  identificationStatus: 'pending' | 'complete' | 'error';
};

type CoaBatchImportRow = {
  peptideName: string;
  batchNumber: string;
  code: string;
  capColor: string;
};

type CoaBatchImportResult = {
  items: CoaResult[];
  savedCount: number;
  failedCount: number;
  rowErrors: {
    rowNumber: number;
    id: string;
    batchNumber: string;
    error: string;
  }[];
};

type CoaBatchDeleteResult = {
  items: CoaResult[];
  deletedCount: number;
  failedCount: number;
  rowErrors: {
    rowNumber: number;
    id: string;
    error: string;
  }[];
};

type CoaPdfAsset = {
  coaFileName: string;
  coaMimeType: 'application/pdf';
  coaBlobKey: string;
  coaUploadedAt: string;
  vialImageAssetKey?: string;
  vialImageMimeType?: string;
  vialImageFileName?: string;
  vialImageSource?: string;
  vialImageMode?: 'extracted' | 'placeholder';
  vialImageExtractedAt?: string;
  parsedCoa?: ParsedCoa;
  diagnostics?: Record<string, unknown>;
};

type CoaTestResultKey =
  | 'averageNetContent'
  | 'purity'
  | 'endotoxins'
  | 'heavyMetals'
  | 'sterility'
  | 'fentanyl';

type CoaResultColumn = {
  key: CoaTestResultKey;
  label: string;
  detailLabel?: string;
  colClassName: string;
  pillClassName?: string;
  status?: boolean;
};

type CoaDetailRow = {
  label: string;
  value: string;
  capColor?: boolean;
  pillClassName?: string;
  status?: boolean;
};

type CoaResultGroup = {
  roundId: string;
  roundName: string;
  isLocked: boolean;
  results: CoaResult[];
};

type CoaUnlockTarget = {
  roundId: string;
  roundName: string;
} | null;

const testingTiers: TestingTier[] = [
  {
    id: 'platinum',
    name: 'Platinum',
    label: '8x Testing',
    description: 'Full QA testing for high-risk peptides with identity, purity, microbial, sterility, and safety screening.',
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
        icon: 'atom',
        title: 'Peptide Identity',
        method: 'LC-MS Molecular Weight Confirmation',
        text: 'LC-MS based molecular weight confirmation to verify peptide identity. Results confirm the expected molecular ion matches the target compound.',
      },
      {
        icon: 'flask',
        title: 'Purity',
        method: 'USP <621> / Reversed-Phase HPLC',
        text: 'Reversed-phase HPLC analysis for peptide purity assessment, with the purity percentage documented on the Certificate of Analysis.',
      },
      {
        icon: 'vial',
        title: 'Content / Quantity',
        method: 'Quantitative content determination',
        text: 'Quantity confirmation to compare expected and observed vial content for the submitted sample.',
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
        icon: 'microscope',
        title: 'Microbial Limits',
        method: 'Microbial limits screening',
        text: 'Microbial limits testing adds a contamination screen for bioburden indicators that can affect high-risk peptide selections.',
      },
      {
        icon: 'tubes',
        title: 'Sterility',
        method: 'Rapid sterility screen',
        text: 'Rapid sterility screening provides an added safety check for high-risk compounds and full QA selections.',
      },
      {
        icon: 'shield',
        title: 'Fentanyl Screening',
        method: 'LC-MS/MS Targeted Screening',
        text: 'LC-MS/MS based targeted screening for fentanyl and its analogs to help ensure product safety and compliance. Sensitive detection at low parts-per-billion levels with full method documentation.',
      },
    ],
    includes: [
      'Peptide Identity',
      'Purity',
      'Content / Quantity',
      'Endotoxin (USP <85>)',
      'Heavy Metals (ICP-MS)',
      'Microbial Limits',
      'Sterility',
      'Fentanyl Screening',
    ],
    additional: [
      {
        title: 'Batch Conformity Add-on',
        text: 'Can be attached separately for eligible peptides when lot consistency needs review.',
      },
    ],
  },
  {
    id: 'gold',
    name: 'Gold',
    label: '4x Testing',
    description: 'Essential lower-risk testing for standard peptides with identity, purity, quantity, and fentanyl screening.',
    qualifiedCount: 6,
    turnaround: '5-7 business days',
    turnaroundNote: 'Balanced panel for broad round coverage',
    peptides: ['GHK-Cu', 'KPV', 'Selank', 'Epitalon', 'DSIP', 'PT-141'],
    panel: [
      {
        icon: 'atom',
        title: 'Peptide Identity',
        method: 'LC-MS Molecular Weight Confirmation',
        text: 'Molecular weight confirmation to verify that the submitted sample matches the expected compound.',
      },
      {
        icon: 'flask',
        title: 'Purity',
        method: 'USP <621> / Reversed-Phase HPLC',
        text: 'Purity analysis for documenting the primary quality profile of each selected standard peptide.',
      },
      {
        icon: 'vial',
        title: 'Content / Quantity',
        method: 'Quantity confirmation',
        text: 'Checks vial content so the round can compare expected and observed quantity.',
      },
      {
        icon: 'shield',
        title: 'Fentanyl Screening',
        method: 'Targeted screening',
        text: 'Adds targeted screening for fentanyl risk when selected by the group.',
      },
    ],
    includes: [
      'Peptide Identity',
      'Purity',
      'Content / Quantity',
      'Fentanyl Screening',
    ],
    additional: [
      {
        title: 'Batch Conformity Add-on',
        text: 'Can be attached separately for eligible peptides when lot consistency needs review.',
      },
    ],
  },
  {
    id: 'gold-plus',
    name: 'Gold+',
    label: '5x Testing',
    description: 'Advanced moderate/high-risk testing for complex peptides that need endotoxin coverage.',
    qualifiedCount: 0,
    assignmentLabel: 'Pending assignment',
    turnaround: 'Confirm per lab queue',
    turnaroundNote: 'Used when risk review calls for added screening beyond Gold',
    peptides: [],
    panel: [
      {
        icon: 'atom',
        title: 'Peptide Identity',
        method: 'Identity confirmation',
        text: 'Confirms the submitted sample aligns with the expected peptide identity.',
      },
      {
        icon: 'flask',
        title: 'Purity',
        method: 'Analytical purity check',
        text: 'Documents the main purity profile for the selected complex peptide.',
      },
      {
        icon: 'vial',
        title: 'Content / Quantity',
        method: 'Quantity confirmation',
        text: 'Checks vial content so the round can compare expected and observed quantity.',
      },
      {
        icon: 'microscope',
        title: 'Endotoxin',
        method: 'Endotoxin screening',
        text: 'Adds bacterial endotoxin screening for moderate/high-risk selections.',
      },
      {
        icon: 'shield',
        title: 'Fentanyl Screening',
        method: 'Targeted screening',
        text: 'Adds targeted screening for fentanyl risk when selected by the group.',
      },
    ],
    includes: [
      'Peptide Identity',
      'Purity',
      'Content / Quantity',
      'Endotoxin',
      'Fentanyl Screening',
    ],
    additional: [
      {
        title: 'Batch Conformity Add-on',
        text: 'Can be attached separately for eligible peptides when lot consistency needs review.',
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
];

const coaTestResultsByTier: Record<TestingTierId, readonly CoaTestResultKey[]> = {
  none: [],
  bronze: ['averageNetContent', 'purity'],
  gold: ['averageNetContent', 'purity', 'fentanyl'],
  'gold-plus': ['averageNetContent', 'purity', 'endotoxins', 'fentanyl'],
  platinum: ['averageNetContent', 'purity', 'endotoxins', 'heavyMetals', 'sterility', 'fentanyl'],
};

const coaResultColumns: CoaResultColumn[] = [
  {
    key: 'averageNetContent',
    label: 'Avg Net Content',
    detailLabel: 'Quantity',
    colClassName: 'coa-col-average',
    pillClassName: 'coa-pill--neutral',
  },
  {
    key: 'purity',
    label: 'Purity',
    colClassName: 'coa-col-purity',
    pillClassName: 'coa-pill--purity',
  },
  {
    key: 'endotoxins',
    label: 'Endotoxins',
    colClassName: 'coa-col-endo',
    status: true,
  },
  {
    key: 'heavyMetals',
    label: 'Heavy Metals',
    colClassName: 'coa-col-heavy',
    status: true,
  },
  {
    key: 'sterility',
    label: 'Sterility',
    colClassName: 'coa-col-sterility',
    status: true,
  },
  {
    key: 'fentanyl',
    label: 'Fentanyl',
    colClassName: 'coa-col-fentanyl',
    status: true,
  },
];

const testingTierSelectorOrder = ['platinum', 'gold-plus', 'gold', 'bronze'] as const;
const testingTierSelectorItems = testingTierSelectorOrder
  .map((tierId) => testingTiers.find((tier) => tier.id === tierId))
  .filter((tier): tier is TestingTier => Boolean(tier));

const batchConformityAddon = {
  label: 'Add-on',
  title: 'Batch Conformity',
  text: 'Applies to eligible peptides regardless of tier and is often paired with Platinum selections.',
  checks: [
    '5 spot-checks across lots for consistency confirmation',
    'Rapid identity screen',
  ],
} as const;

const navItems = publicPageItems;
const configuredDisabledPages =
  typeof __HELIX_DISABLED_PAGES__ === 'undefined' ? [] : __HELIX_DISABLED_PAGES__;
const disabledPages = new Set<string>(configuredDisabledPages);

type PageId = PublicPageId | 'account' | 'hxadmin' | 'hxowner';
type TestingIconType = TestingTier['panel'][number]['icon'] | 'badge';
type AdminSession = {
  isAuthenticated: boolean;
  role?: 'owner' | 'admin';
};

const identityCallbackHashPattern = /^#(?:confirmation_token|recovery_token|invite_token|email_change_token|access_token)=/;

function getPageFromPath(): PageId {
  if (identityCallbackHashPattern.test(window.location.hash)) {
    return 'account';
  }

  const currentPath = window.location.pathname.replace(/\/$/, '') || '/';

  if (currentPath === '/account') {
    return 'account';
  }

  if (currentPath === '/hxadmin' || currentPath === '/hxowner') {
    return currentPath.slice(1) as PageId;
  }

  const match = navItems.find((item) => item.path === currentPath);
  return match && !disabledPages.has(match.id) ? match.id : 'home';
}

function App() {
  const [activePage, setActivePage] = useState<PageId>(getPageFromPath);
  const [adminSession, setAdminSession] = useState<AdminSession>({ isAuthenticated: false });
  const [accountSession, setAccountSession] = useState<AccountSession>(signedOutAccountSession);

  useEffect(() => {
    const handleNavigation = () => {
      const nextPage = getPageFromPath();

      if (nextPage === 'account' && identityCallbackHashPattern.test(window.location.hash)) {
        const accountUrl = `/account${window.location.search}${window.location.hash}`;

        if (window.location.pathname !== '/account') {
          window.history.replaceState(window.history.state, '', accountUrl);
        }
      }

      if (nextPage === 'home' && isDisabledPublicPath(window.location.pathname)) {
        window.history.replaceState({}, '', '/');
      }

      setActivePage(nextPage);
    };

    window.addEventListener('popstate', handleNavigation);
    handleNavigation();

    return () => window.removeEventListener('popstate', handleNavigation);
  }, []);

  useEffect(() => {
    let isMounted = true;

    Promise.all([fetchAccountSession(), fetchAdminSession()])
      .then(([nextAccountSession, nextAdminSession]) => {
        if (isMounted) {
          setAccountSession(nextAccountSession);
          setAdminSession(resolveClientAdminSession(nextAccountSession, nextAdminSession));
        }
      })
      .catch(() => {
        if (isMounted) {
          setAccountSession(signedOutAccountSession);
          setAdminSession({ isAuthenticated: false });
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const navigateTo = (path: string) => {
    const targetPath = isDisabledPublicPath(path) ? '/' : path;

    window.history.pushState({}, '', targetPath);
    setActivePage(getPageFromPath());
    window.dispatchEvent(new PopStateEvent('popstate'));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const applyAccountSession = (nextSession: AccountSession) => {
    const mergedSession = {
      ...nextSession,
      legacyAuthEnabled: nextSession.legacyAuthEnabled ?? accountSession.legacyAuthEnabled,
    };

    setAccountSession(mergedSession);

    if (
      mergedSession.account?.status === 'active'
      && (mergedSession.account.role === 'admin' || mergedSession.account.role === 'owner')
    ) {
      setAdminSession({ isAuthenticated: true, role: mergedSession.account.role });
    } else {
      setAdminSession({ isAuthenticated: false });
    }
  };

  const refreshAccountAndAdminSessions = async () => {
    const [nextAccountSession, nextAdminSession] = await Promise.all([
      fetchAccountSession(),
      fetchAdminSession(),
    ]);

    setAccountSession(nextAccountSession);
    setAdminSession(resolveClientAdminSession(nextAccountSession, nextAdminSession));
    return nextAccountSession;
  };

  const logoutAccount = async () => {
    await logoutAccountSession();
    setAccountSession({
      isAuthenticated: false,
      legacyAuthEnabled: accountSession.legacyAuthEnabled,
    });
    setAdminSession({ isAuthenticated: false });
  };

  return (
    <>
      <SiteHeader
        accountSession={accountSession}
        activePage={activePage}
        isAdmin={adminSession.isAuthenticated}
        onLogout={logoutAccount}
        onNavigate={navigateTo}
      />
      <main>
        {activePage === 'home' && <HomePage />}
        {activePage === 'order-form' && <OrderFormPage />}
        {activePage === 'testing' && <TestingPage />}
        {activePage === 'coas' && <CoasPage isAdmin={adminSession.isAuthenticated} />}
        {activePage === 'labels' && <LabelsPage isAdmin={adminSession.isAuthenticated} />}
        {activePage === 'faqs' && <FaqsPage />}
        {activePage === 'account' && (
          <AccountPage
            session={accountSession}
            onSessionChange={applyAccountSession}
            onRefreshSession={refreshAccountAndAdminSessions}
            onNavigate={navigateTo}
          />
        )}
        {(activePage === 'hxadmin' || activePage === 'hxowner') && (
          <AdminPage
            session={adminSession}
            loginRole={activePage === 'hxowner' ? 'owner' : 'admin'}
            legacyAuthEnabled={accountSession.legacyAuthEnabled === true}
            onLogout={logoutAccount}
            onSessionChange={setAdminSession}
            onNavigate={navigateTo}
          />
        )}
      </main>
    </>
  );
}

function SiteHeader({
  accountSession,
  activePage,
  isAdmin,
  onLogout,
  onNavigate,
}: {
  accountSession: AccountSession;
  activePage: PageId;
  isAdmin: boolean;
  onLogout: () => Promise<void>;
  onNavigate: (path: string) => void;
}) {
  const enabledNavItems = navItems.filter((item) => !disabledPages.has(item.id));
  const visibleNavItems = isAdmin && !accountSession.account
    ? [...enabledNavItems, { id: 'hxadmin', label: 'Admin', path: '/hxadmin' } as const]
    : enabledNavItems;

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
              className={[
                'site-nav__link',
                item.id === activePage ? 'is-active' : '',
                item.id === 'hxadmin' ? 'site-nav__link--admin' : '',
              ]
                .filter(Boolean)
                .join(' ')}
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

        <div className="site-account-actions">
          {accountSession.account ? (
            <details className="site-account-menu">
              <summary>{accountSession.account.username}</summary>
              <div className="site-account-menu__panel">
                <a
                  className={activePage === 'account' ? 'is-active' : ''}
                  href="/account"
                  onClick={(event) => {
                    event.preventDefault();
                    onNavigate('/account');
                  }}
                >
                  Account
                </a>
                {accountSession.account.status === 'active'
                  && (accountSession.account.role === 'admin' || accountSession.account.role === 'owner') && (
                  <a
                    href={accountSession.account.role === 'owner' ? '/hxowner' : '/hxadmin'}
                    onClick={(event) => {
                      event.preventDefault();
                      onNavigate(accountSession.account?.role === 'owner' ? '/hxowner' : '/hxadmin');
                    }}
                  >
                    Admin
                  </a>
                )}
                <button type="button" onClick={() => void onLogout()}>Sign out</button>
              </div>
            </details>
          ) : accountSession.isAuthenticated ? (
            <a
              className="site-account-link site-account-link--primary"
              href="/account"
              onClick={(event) => {
                event.preventDefault();
                onNavigate('/account');
              }}
            >
              Finish setup
            </a>
          ) : (
            <>
              <a
                className="site-account-link"
                href="/account?mode=signin"
                onClick={(event) => {
                  event.preventDefault();
                  onNavigate('/account?mode=signin');
                }}
              >
                Sign in
              </a>
              <a
                className="site-account-link site-account-link--primary"
                href="/account?mode=signup"
                onClick={(event) => {
                  event.preventDefault();
                  onNavigate('/account?mode=signup');
                }}
              >
                Sign up
              </a>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function isDisabledPublicPath(path: string) {
  const normalizedPath = path.replace(/\/$/, '') || '/';
  const match = navItems.find((item) => item.path === normalizedPath);

  return Boolean(match && disabledPages.has(match.id));
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
            <p className="eyebrow">Testing coordination</p>
            <h1 id="hero-title">Helix Group Testing</h1>
            <p className="hero__lede">
              A volunteer-run, non-commercial coordination site for formatting
              communication around group testing interest.
            </p>
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
            <h2 id="coordination-title">What this site coordinates</h2>
            <p>
              Helix Group Testing is primarily used to coordinate third-party
              testing details, round status, and communication around selected
              peptides.
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
  const [expandedMobileTierId, setExpandedMobileTierId] = useState<TestingTier['id'] | null>(null);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [selectedRoundId, setSelectedRoundId] = useState('');
  const [roundSearchTerm, setRoundSearchTerm] = useState('');
  const [roundsLoadFailed, setRoundsLoadFailed] = useState(false);
  const currentRounds = useMemo(() => getCurrentRounds(rounds), [rounds]);
  const selectableRounds = useMemo(() => sortRoundsForDisplay(rounds), [rounds]);
  const filteredSelectableRounds = useMemo(
    () => filterTestingRounds(selectableRounds, roundSearchTerm),
    [selectableRounds, roundSearchTerm],
  );
  const selectedRound =
    selectableRounds.find((round) => round.id === selectedRoundId) ?? currentRounds[0] ?? selectableRounds[0] ?? null;
  const visibleRoundOptions = useMemo(
    () =>
      selectedRound && !filteredSelectableRounds.some((round) => round.id === selectedRound.id)
        ? [selectedRound, ...filteredSelectableRounds]
        : filteredSelectableRounds,
    [filteredSelectableRounds, selectedRound],
  );
  const activeTestingRound = selectedRound ? createTestingRoundSummary(selectedRound) : currentTestingRound;
  const activeTestingTiers = selectedRound ? createTestingTiersForRound(selectedRound) : testingTiers;
  const selectedTier =
    activeTestingTiers.find((tier) => tier.id === selectedTierId) ?? activeTestingTiers[0];

  useEffect(() => {
    let isMounted = true;

    fetchRounds()
      .then((nextRounds) => {
        if (isMounted) {
          setRounds(nextRounds);
          setRoundsLoadFailed(false);
        }
      })
      .catch(() => {
        if (isMounted) {
          setRoundsLoadFailed(true);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (selectableRounds.length === 0) {
      return;
    }

    if (!selectableRounds.some((round) => round.id === selectedRoundId)) {
      setSelectedRoundId((currentRounds[0] ?? selectableRounds[0]).id);
    }
  }, [currentRounds, selectableRounds, selectedRoundId]);

  useEffect(() => {
    if (!activeTestingTiers.some((tier) => tier.id === selectedTierId)) {
      setSelectedTierId(activeTestingTiers[0]?.id ?? 'platinum');
    }
  }, [activeTestingTiers, selectedTierId]);

  useEffect(() => {
    if (expandedMobileTierId && !activeTestingTiers.some((tier) => tier.id === expandedMobileTierId)) {
      setExpandedMobileTierId(null);
    }
  }, [activeTestingTiers, expandedMobileTierId]);

  return (
    <section className="testing-dashboard" aria-labelledby="testing-title">
      <div className="section__content testing-dashboard__content">
        {selectableRounds.length > 0 && (
          <div className="testing-round-controls">
            <select value={selectedRound?.id ?? ''} onChange={(event) => setSelectedRoundId(event.target.value)} aria-label="Round">
              {visibleRoundOptions.map((round) => (
                <option value={round.id} key={round.id}>
                  {getTestingRoundOptionLabel(round)}
                </option>
              ))}
            </select>
            <input
              type="search"
              value={roundSearchTerm}
              placeholder="Search rounds"
              aria-label="Search rounds"
              onChange={(event) => setRoundSearchTerm(event.target.value)}
            />
          </div>
        )}
        <div className="testing-overview">
          <aside className="round-summary" aria-label="Current round stats">
            <p className="eyebrow">Current round</p>
            <h1 id="testing-title">{activeTestingRound.name}</h1>
            <p>{activeTestingRound.status}</p>
            {roundsLoadFailed && <p className="round-summary__fallback">Showing saved fallback details.</p>}

            <dl className="round-summary__stats">
              <div>
                <dt>Members</dt>
                <dd>{activeTestingRound.participants}</dd>
              </div>
              <div>
                <dt>Selected peptides</dt>
                <dd>{activeTestingRound.selectedPeptides}</dd>
              </div>
              <div>
                <dt>Qualified</dt>
                <dd>{activeTestingRound.qualifiedPeptides}</dd>
              </div>
              <div>
                <dt>Target window</dt>
                <dd>{activeTestingRound.targetWindow}</dd>
              </div>
            </dl>
          </aside>

          <div className="tier-selector" aria-label="Testing tiers">
            {testingTierSelectorOrder
              .map((tierId) => activeTestingTiers.find((tier) => tier.id === tierId))
              .filter((tier): tier is TestingTier => Boolean(tier))
              .map((tier) => {
                const isMobileExpanded = expandedMobileTierId === tier.id;
                const tierDetailId = getTestingTierDetailId(tier.id, 'mobile');

                return (
                  <div className="tier-selector__item" key={tier.id}>
                    <button
                      className={`tier-button tier-button--${tier.id} ${
                        selectedTier.id === tier.id ? 'is-selected' : ''
                      } ${isMobileExpanded ? 'is-expanded' : ''}`}
                      type="button"
                      aria-pressed={selectedTier.id === tier.id}
                      aria-expanded={isMobileExpanded}
                      aria-controls={tierDetailId}
                      onClick={() => {
                        setSelectedTierId(tier.id);
                        setExpandedMobileTierId((currentTierId) =>
                          currentTierId === tier.id ? null : tier.id,
                        );
                      }}
                    >
                      <span>{tier.name}</span>
                      <strong>{tier.label}</strong>
                      <em>{tier.description}</em>
                      <small>
                        {tier.assignmentLabel
                          ? tier.assignmentLabel
                          : `${tier.qualifiedCount} peptides`}
                      </small>
                    </button>
                    <TestingTierDetails
                      tier={tier}
                      id={tierDetailId}
                      titleId={`${tierDetailId}-title`}
                      className={`tier-detail--mobile ${isMobileExpanded ? 'is-open' : ''}`}
                      ariaHidden={!isMobileExpanded}
                    />
                  </div>
                );
              })}
          </div>
        </div>

        <TestingTierDetails
          tier={selectedTier}
          id={getTestingTierDetailId(selectedTier.id, 'desktop')}
          titleId={`${getTestingTierDetailId(selectedTier.id, 'desktop')}-title`}
          className="tier-detail--desktop"
        />
        <BatchConformityAddon />
      </div>
    </section>
  );
}

function TestingTierDetails({
  tier,
  id,
  titleId,
  className = '',
  ariaHidden = false,
}: {
  tier: TestingTier;
  id: string;
  titleId: string;
  className?: string;
  ariaHidden?: boolean;
}) {
  const [activeBatchPill, setActiveBatchPill] = useState<{ id: string; pinned: boolean } | null>(null);
  const peptidePills = tier.peptides.map(normalizeTestingPeptidePill);

  useEffect(() => {
    if (!activeBatchPill?.pinned) {
      return undefined;
    }

    const clearActivePill = () => setActiveBatchPill(null);

    window.addEventListener('pointerdown', clearActivePill);
    return () => window.removeEventListener('pointerdown', clearActivePill);
  }, [activeBatchPill]);

  return (
    <article
      className={`tier-detail tier-detail--${tier.id} ${className}`.trim()}
      id={id}
      aria-labelledby={titleId}
      aria-hidden={ariaHidden || undefined}
    >
      <div className="tier-detail__main">
        <header className="tier-detail__header">
          <div className="tier-detail__brand" aria-hidden="true">
            <img src="/helix_logo.svg" alt="" />
          </div>
          <div>
            <p className="eyebrow">{tier.name} testing</p>
            <h2 id={titleId}>{tier.name.toUpperCase()} TESTING</h2>
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
          <h3>
            {tier.assignmentLabel
              ? tier.assignmentLabel
              : `${tier.qualifiedCount} peptides assigned to ${tier.name}`}
          </h3>
        </div>
        {peptidePills.length > 0 ? (
          <ul>
            {peptidePills.map((peptide) => (
              <li className="qualified-pill" key={peptide.id}>
                <span>{peptide.label}</span>
                {peptide.batchConformity && (
                  <span
                    className="batch-conformity-marker"
                    onMouseEnter={() => setActiveBatchPill({ id: peptide.id, pinned: false })}
                    onMouseLeave={() => {
                      setActiveBatchPill((current) =>
                        current?.id === peptide.id && !current.pinned ? null : current,
                      );
                    }}
                  >
                    <button
                      className="batch-conformity-marker__button"
                      type="button"
                      aria-label="Batch conformity"
                      aria-expanded={activeBatchPill?.id === peptide.id}
                      onFocus={() => setActiveBatchPill({ id: peptide.id, pinned: false })}
                      onBlur={() => {
                        setActiveBatchPill((current) =>
                          current?.id === peptide.id && !current.pinned ? null : current,
                        );
                      }}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        setActiveBatchPill((current) =>
                          current?.id === peptide.id && current.pinned
                            ? null
                            : { id: peptide.id, pinned: true },
                        );
                      }}
                    >
                      <BatchConformityMiniIcon />
                    </button>
                    {activeBatchPill?.id === peptide.id && (
                      <span className="batch-conformity-marker__bubble" role="tooltip">
                        Batch conformity
                      </span>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="qualified-list__empty">
            Specific peptides will be listed after the round review assigns this tier.
          </p>
        )}
      </section>
    </article>
  );
}

function getTestingTierDetailId(tierId: TestingTier['id'], context: 'desktop' | 'mobile') {
  return `testing-tier-details-${context}-${tierId}`;
}

function normalizeTestingPeptidePill(peptide: string | TestingPeptidePill): TestingPeptidePill {
  if (typeof peptide === 'string') {
    return {
      id: peptide,
      label: peptide,
      batchConformity: false,
    };
  }

  return peptide;
}

function BatchConformityMiniIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.5 21 7v6.2c0 4.4-3.1 7.6-9 9.3-5.9-1.7-9-4.9-9-9.3V7l9-4.5Z" />
      <path d="M8.2 12.2 10.7 15l5.2-6" />
    </svg>
  );
}

function BatchConformityAddon() {
  return (
    <section className="batch-addon" aria-labelledby="batch-addon-title">
      <div className="batch-addon__icon" aria-hidden="true">
        <TestingIcon type="badge" />
      </div>
      <div className="batch-addon__copy">
        <p className="eyebrow">{batchConformityAddon.label}</p>
        <h2 id="batch-addon-title">{batchConformityAddon.title}</h2>
        <p>{batchConformityAddon.text}</p>
      </div>
      <ul className="batch-addon__checks">
        {batchConformityAddon.checks.map((check) => (
          <li key={check}>{check}</li>
        ))}
      </ul>
    </section>
  );
}

function createTestingRoundSummary(round: Round) {
  const selectedPeptides = round.peptides.filter((row) => row.peptideName.trim());
  const qualifiedPeptides = selectedPeptides.filter((row) => row.testingTier !== 'none').length;

  return {
    name: round.name,
    status: round.status || 'Round in progress',
    participants: round.participants,
    selectedPeptides: selectedPeptides.length,
    qualifiedPeptides,
    targetWindow: round.targetWindow || round.startDate || 'Current round',
  };
}

function getTestingRoundOptionLabel(round: Round) {
  return [
    round.name,
    round.isCurrent ? 'Current' : 'Past',
  ].filter(Boolean).join(' - ');
}

function filterTestingRounds(rounds: Round[], searchTerm: string) {
  const normalizedSearchTerm = searchTerm.trim().toLowerCase();

  if (!normalizedSearchTerm) {
    return rounds;
  }

  return rounds.filter((round) =>
    [
      round.name,
      round.status,
      round.targetWindow,
      round.startDate,
      round.endDate,
      round.isCurrent ? 'current' : 'past scheduled previous',
    ]
      .join(' ')
      .toLowerCase()
      .includes(normalizedSearchTerm),
  );
}

function createTestingTiersForRound(round: Round): TestingTier[] {
  return testingTiers.map((tier) => {
    const tierRows = round.peptides.filter((row) => row.testingTier === tier.id && row.peptideName.trim());
    const peptidePills = tierRows.map(createRoundPeptidePill);

    return {
      ...tier,
      qualifiedCount: peptidePills.length,
      assignmentLabel: peptidePills.length === 0 ? 'Pending assignment' : undefined,
      peptides: peptidePills,
    };
  });
}

function createRoundPeptidePill(row: RoundPeptide): TestingPeptidePill {
  const details = [
    row.mass,
    row.additionalTesting,
  ].filter(Boolean).join(' - ');

  return {
    id: row.id,
    label: details ? `${row.peptideName} (${details})` : row.peptideName,
    batchConformity: row.batchConformity,
  };
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

function CoasPage({ isAdmin }: { isAdmin: boolean }) {
  const [initialFilters] = useState(getInitialCoaFilterState);
  const [searchTerm, setSearchTerm] = useState(initialFilters.searchTerm);
  const [peptideFilter, setPeptideFilter] = useState(initialFilters.peptideToken);
  const [selectedCoaId, setSelectedCoaId] = useState(getCoaHashSelection);
  const [coaResults, setCoaResults] = useState<CoaResult[]>([]);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [coaStatus, setCoaStatus] = useState('');
  const [isSubmittingCoa, setIsSubmittingCoa] = useState(false);
  const [roundFilter, setRoundFilter] = useState(initialFilters.roundId);
  const [hasLoadedCoaData, setHasLoadedCoaData] = useState(false);
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  const [batchRoundId, setBatchRoundId] = useState('');
  const [batchRows, setBatchRows] = useState<CoaBatchFormRow[]>([]);
  const [batchImportStatus, setBatchImportStatus] = useState('');
  const [isBulkUploadModalOpen, setIsBulkUploadModalOpen] = useState(false);
  const [bulkUploadDrafts, setBulkUploadDrafts] = useState<CoaUploadDraft[]>([]);
  const [editingCoa, setEditingCoa] = useState<CoaResult | null>(null);
  const [coaEditForm, setCoaEditForm] = useState<CoaEditForm>(createEmptyCoaEditForm());
  const [attachingCoa, setAttachingCoa] = useState<CoaResult | null>(null);
  const [attachCoaFile, setAttachCoaFile] = useState<File | null>(null);
  const [unlockTarget, setUnlockTarget] = useState<CoaUnlockTarget>(null);
  const [unlockPasscode, setUnlockPasscode] = useState('');
  const [unlockStatus, setUnlockStatus] = useState('');
  const [isUnlockingRound, setIsUnlockingRound] = useState(false);
  const sortedCoaResults = useMemo(() => sortCoaResults(coaResults, rounds), [coaResults, rounds]);
  const peptideOptions = useMemo(
    () => createCoaPeptideFilterOptions(sortedCoaResults),
    [sortedCoaResults],
  );
  const selectedPeptideName = peptideFilter === 'all'
    ? 'all'
    : peptideOptions.find((option) => option.token === peptideFilter)?.label ?? 'all';
  const filteredResults = useMemo(
    () => filterCoaResults(sortedCoaResults, searchTerm, selectedPeptideName, roundFilter),
    [sortedCoaResults, searchTerm, selectedPeptideName, roundFilter],
  );
  const filteredResultGroups = useMemo(
    () => groupCoaResultsByRound(filteredResults),
    [filteredResults],
  );
  const selectedCoaResult = sortedCoaResults.find((result) => result.id === selectedCoaId) ?? null;
  const selectedFilterRound = roundFilter === 'all' ? null : rounds.find((round) => round.id === roundFilter) ?? null;
  const selectedBatchRound = rounds.find((round) => round.id === batchRoundId) ?? rounds[0] ?? null;
  const selectableBatchRoundPeptides = useMemo(
    () => sortRoundPeptidesByVendorCode(
      selectedBatchRound?.peptides.filter((peptide) => peptide.peptideId || peptide.vendorCode) ?? [],
    ),
    [selectedBatchRound],
  );
  const editRound = rounds.find((round) => round.id === coaEditForm.roundId) ?? null;

  useEffect(() => {
    const handleLocationChange = () => {
      const nextSelectedCoaId = getCoaHashSelection();

      setSelectedCoaId(nextSelectedCoaId);

      if (!nextSelectedCoaId) {
        const nextFilters = parseCoaFilterSearch(window.location.search);

        setRoundFilter(nextFilters.roundId);
        setPeptideFilter(nextFilters.peptideToken);
        setSearchTerm(nextFilters.searchTerm);
      }
    };

    window.addEventListener('hashchange', handleLocationChange);
    window.addEventListener('popstate', handleLocationChange);
    return () => {
      window.removeEventListener('hashchange', handleLocationChange);
      window.removeEventListener('popstate', handleLocationChange);
    };
  }, []);

  useLayoutEffect(() => {
    const nextPath = selectedCoaId
      ? createCoaDetailPath(window.location.pathname, selectedCoaId)
      : createCoaListPath(window.location.pathname, {
          roundId: roundFilter,
          peptideToken: peptideFilter,
          searchTerm,
        });
    const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;

    if (currentPath !== nextPath) {
      window.history.replaceState(window.history.state, '', nextPath);
    }
  }, [peptideFilter, roundFilter, searchTerm, selectedCoaId]);

  useEffect(() => {
    if (!hasLoadedCoaData) {
      return;
    }

    if (roundFilter !== 'all' && !rounds.some((round) => round.id === roundFilter)) {
      setRoundFilter('all');
    }

    if (peptideFilter !== 'all' && !peptideOptions.some((option) => option.token === peptideFilter)) {
      setPeptideFilter('all');
    }
  }, [hasLoadedCoaData, peptideFilter, peptideOptions, roundFilter, rounds]);

  useEffect(() => {
    void refreshCoaData();
  }, []);

  const refreshCoaData = async () => {
    try {
      const [nextCoas, nextRounds] = await Promise.all([
        fetchCoaResults(),
        fetchRounds(),
      ]);

      const sortedRounds = sortRoundsForDisplay(nextRounds);

      setCoaResults(nextCoas);
      setRounds(sortedRounds);
      setHasLoadedCoaData(true);
      setCoaStatus('');
    } catch (error) {
      console.error(error);
      setCoaStatus('COA data could not be loaded.');
    }
  };

  const openRoundUnlockModal = (roundId: string, roundName: string) => {
    setUnlockTarget({ roundId, roundName });
    setUnlockPasscode('');
    setUnlockStatus('');
  };

  const closeRoundUnlockModal = () => {
    if (isUnlockingRound) {
      return;
    }

    setUnlockTarget(null);
    setUnlockPasscode('');
    setUnlockStatus('');
  };

  const submitRoundUnlock = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!unlockTarget || !unlockPasscode.trim()) {
      setUnlockStatus('Enter the round passcode.');
      return;
    }

    setIsUnlockingRound(true);
    setUnlockStatus('');

    try {
      await unlockCoaRound(unlockTarget.roundId, unlockPasscode);
      await refreshCoaData();
      setUnlockTarget(null);
      setUnlockPasscode('');
      setUnlockStatus('');
    } catch (error) {
      console.error(error);
      setUnlockStatus('Passcode not recognized.');
    } finally {
      setIsUnlockingRound(false);
    }
  };

  const selectCoaResult = (resultId: string) => {
    const nextPath = createCoaDetailPath(window.location.pathname, resultId);
    const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;

    if (currentPath !== nextPath) {
      window.history.pushState({}, '', nextPath);
    }

    setSelectedCoaId(resultId);
  };

  const clearSelectedCoaResult = () => {
    window.history.pushState({}, '', createCoaListPath(window.location.pathname, {
      roundId: roundFilter,
      peptideToken: peptideFilter,
      searchTerm,
    }));
    setSelectedCoaId('');
  };

  const openBatchModal = async () => {
    setIsSubmittingCoa(true);
    setCoaStatus('');
    setBatchImportStatus('');

    try {
      const nextRounds = sortRoundsForDisplay(await fetchRounds());
      const firstRound = nextRounds[0] ?? null;
      const defaultBatchRound = nextRounds.find((round) => round.id === roundFilter) ?? firstRound;

      setRounds(nextRounds);
      setRoundFilter((currentRoundId) =>
        currentRoundId === 'all' || nextRounds.some((round) => round.id === currentRoundId)
          ? currentRoundId
          : 'all',
      );
      setBatchRoundId(defaultBatchRound?.id ?? '');
      setBatchRows([createCoaBatchFormRow()]);
      setIsBatchModalOpen(true);
    } catch (error) {
      console.error(error);
      setCoaStatus('Round data could not be refreshed.');
    } finally {
      setIsSubmittingCoa(false);
    }
  };

  const updateBatchRow = (rowId: string, fields: Partial<CoaBatchFormRow>) => {
    setBatchRows((currentRows) =>
      currentRows.map((row) => (row.id === rowId ? { ...row, ...fields } : row)),
    );
  };

  const loadBatchNumberFile = async (file: File | null) => {
    if (!file) {
      return;
    }

    if (!selectedBatchRound) {
      setBatchImportStatus('Choose a round before importing batch numbers.');
      return;
    }

    setIsSubmittingCoa(true);
    setBatchImportStatus('Importing batch numbers...');

    try {
      const importedRows = await parseCoaBatchNumberFile(file);
      const nextRows = importedRows.map((row) => {
        const roundPeptide = findRoundPeptideForCoaBatchImport(row, selectableBatchRoundPeptides);

        return {
          ...createCoaBatchFormRow(),
          roundPeptideId: roundPeptide?.id ?? '',
          batchNumber: row.batchNumber,
          capColor: row.capColor,
          code: row.code || roundPeptide?.vendorCode || '',
        };
      });

      if (nextRows.length === 0) {
        setBatchImportStatus('No batch rows were found in that file.');
        return;
      }

      setBatchRows(nextRows);
      setBatchImportStatus(`${nextRows.length} batch ${nextRows.length === 1 ? 'row' : 'rows'} imported.`);
    } catch (error) {
      console.error(error);
      setBatchImportStatus('Batch number file could not be imported.');
    } finally {
      setIsSubmittingCoa(false);
    }
  };

  const saveBatchRows = async () => {
    if (!selectedBatchRound) {
      setCoaStatus('Choose a round first.');
      return;
    }

    const validRows = batchRows.filter((row) => row.roundPeptideId && row.batchNumber.trim());

    if (validRows.length === 0) {
      setCoaStatus('Add at least one linked batch number.');
      return;
    }

    setIsSubmittingCoa(true);

    try {
      const entries: CoaResult[] = [];

      for (const row of validRows) {
        const roundPeptide = selectedBatchRound.peptides.find((peptide) => peptide.id === row.roundPeptideId);

        if (!roundPeptide) {
          continue;
        }

        const asset = row.file ? await uploadCoaPdf(row.file) : {};
        entries.push(mergeCoaPdfAsset(
          createCoaEntryFromRoundRow(selectedBatchRound, roundPeptide, row),
          asset,
        ));
      }

      const result = await saveCoaEntriesBatch(entries);

      setCoaResults(result.items);
      setIsBatchModalOpen(false);
      setCoaStatus(`${result.savedCount} batch ${result.savedCount === 1 ? 'entry' : 'entries'} saved.`);
    } catch (error) {
      console.error('[coa-batch] save failed', {
        error,
        rows: batchRows,
      });
      setCoaStatus(getCoaErrorMessage(error, 'Batch entries could not be saved.'));
    } finally {
      setIsSubmittingCoa(false);
    }
  };

  const openBulkUploadModal = () => {
    setBulkUploadDrafts([]);
    setCoaStatus('');
    setIsBulkUploadModalOpen(true);
  };

  const loadBulkCoaFiles = (files: FileList | null) => {
    const nextFiles = Array.from(files ?? []).filter((file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
    const nextDrafts = nextFiles.map((file) => ({
      id: `${file.name}-${file.lastModified}-${file.size}`,
      file,
      matchedCoaId: findCoaMatchForFile(file, coaResults)?.id ?? '',
      parsedBatchNumber: '',
      identificationStatus: 'pending' as const,
    }));

    setBulkUploadDrafts(nextDrafts);

    for (const draft of nextDrafts) {
      void identifyCoaPdf(draft.file)
        .then((batchNumber) => {
          const parsedMatch = batchNumber ? findCoaMatchForBatchNumber(batchNumber, coaResults) : null;

          setBulkUploadDrafts((currentDrafts) => currentDrafts.map((currentDraft) => (
            currentDraft.id === draft.id
              ? {
                  ...currentDraft,
                  matchedCoaId: batchNumber ? parsedMatch?.id ?? '' : currentDraft.matchedCoaId,
                  parsedBatchNumber: batchNumber,
                  identificationStatus: 'complete',
                }
              : currentDraft
          )));
        })
        .catch((error) => {
          console.error('[coa-pdf-identify] batch identification failed', {
            fileName: draft.file.name,
            error,
          });
          setBulkUploadDrafts((currentDrafts) => currentDrafts.map((currentDraft) => (
            currentDraft.id === draft.id
              ? { ...currentDraft, identificationStatus: 'error' }
              : currentDraft
          )));
        });
    }
  };

  const saveBulkCoaUploads = async () => {
    const uploadRows = bulkUploadDrafts.filter((draft) => draft.matchedCoaId);

    if (uploadRows.length === 0) {
      setCoaStatus('Match at least one PDF to a COA entry.');
      return;
    }

    setIsSubmittingCoa(true);

    try {
      const entries: CoaResult[] = [];

      for (const draft of uploadRows) {
        const currentCoa = coaResults.find((coa) => coa.id === draft.matchedCoaId);

        if (!currentCoa) {
          continue;
        }

        const asset = await uploadCoaPdf(draft.file);
        entries.push(mergeCoaPdfAsset(currentCoa, asset));
      }

      const result = await saveCoaEntriesBatch(entries);

      setCoaResults(result.items);
      setIsBulkUploadModalOpen(false);
      setCoaStatus(`${result.savedCount} COA ${result.savedCount === 1 ? 'PDF' : 'PDFs'} attached.`);
    } catch (error) {
      console.error('[coa-bulk-pdf] save failed', {
        error,
        rows: uploadRows.map((row) => ({
          id: row.id,
          fileName: row.file.name,
          matchedCoaId: row.matchedCoaId,
        })),
      });
      setCoaStatus(getCoaErrorMessage(error, 'COA PDFs could not be uploaded.'));
    } finally {
      setIsSubmittingCoa(false);
    }
  };

  const openEditCoaModal = (result: CoaResult) => {
    setEditingCoa(result);
    setCoaEditForm(createCoaEditForm(result));
    setCoaStatus('');
  };

  const saveEditedCoa = async () => {
    if (!editingCoa) {
      return;
    }

    const round = rounds.find((currentRound) => currentRound.id === coaEditForm.roundId);
    const roundPeptide = round?.peptides.find((row) => row.id === coaEditForm.roundPeptideId);

    if (!round || !roundPeptide || !coaEditForm.batchNumber.trim()) {
      setCoaStatus('Choose a linked round peptide and batch number.');
      return;
    }

    setIsSubmittingCoa(true);

    try {
      const asset = coaEditForm.file ? await uploadCoaPdf(coaEditForm.file) : {};
      const nextCoas = await saveCoaEntry(mergeCoaPdfAsset({
        ...editingCoa,
        ...createCoaEntryFromRoundRow(round, roundPeptide, {
          id: editingCoa.id,
          batchNumber: coaEditForm.batchNumber,
          capColor: coaEditForm.capColor,
          code: coaEditForm.code,
        }),
        dateTested: coaEditForm.dateTested,
        lab: coaEditForm.lab,
        coaNumber: coaEditForm.coaNumber,
        accessionNumber: coaEditForm.accessionNumber,
        verificationUrl: coaEditForm.verificationUrl,
        averageNetContent: coaEditForm.averageNetContent,
        purity: coaEditForm.purity,
        endotoxins: coaEditForm.endotoxins,
        heavyMetals: coaEditForm.heavyMetals,
        sterility: coaEditForm.sterility,
        fentanyl: coaEditForm.fentanyl,
      }, asset));

      setCoaResults(nextCoas);
      setEditingCoa(null);
      setCoaStatus('COA entry saved.');
    } catch (error) {
      console.error(error);
      setCoaStatus(getCoaErrorMessage(error, 'COA entry could not be saved.'));
    } finally {
      setIsSubmittingCoa(false);
    }
  };

  const deleteEditedCoa = async () => {
    if (!editingCoa || !window.confirm(`Delete COA entry "${editingCoa.batchNumber}"? This cannot be undone.`)) {
      return;
    }

    setIsSubmittingCoa(true);

    try {
      setCoaResults(await deleteCoaEntry(editingCoa.id));
      if (selectedCoaId === editingCoa.id) {
        clearSelectedCoaResult();
      }
      setEditingCoa(null);
      setCoaStatus('COA entry deleted.');
    } catch (error) {
      console.error(error);
      setCoaStatus('COA entry could not be deleted.');
    } finally {
      setIsSubmittingCoa(false);
    }
  };

  const deleteAllCoasForSelectedRound = async () => {
    if (!selectedFilterRound) {
      setCoaStatus('Choose a round filter before deleting entries.');
      return;
    }

    const entriesToDelete = coaResults.filter((result) => result.roundId === selectedFilterRound.id);

    if (entriesToDelete.length === 0) {
      setCoaStatus(`No COA entries found for ${selectedFilterRound.name}.`);
      return;
    }

    const entryLabel = entriesToDelete.length === 1 ? 'entry' : 'entries';

    if (!window.confirm(`Delete ${entriesToDelete.length} COA ${entryLabel} from ${selectedFilterRound.name}? This cannot be undone.`)) {
      return;
    }

    setIsSubmittingCoa(true);

    try {
      const result = await deleteCoaEntriesBatch(entriesToDelete.map((entry) => entry.id));

      setCoaResults(result.items);

      if (selectedCoaId && entriesToDelete.some((entry) => entry.id === selectedCoaId)) {
        clearSelectedCoaResult();
      }

      setCoaStatus(`${result.deletedCount} COA ${result.deletedCount === 1 ? 'entry' : 'entries'} deleted from ${selectedFilterRound.name}.`);
    } catch (error) {
      console.error('[coa-bulk-delete] delete failed', {
        error,
        ids: entriesToDelete.map((entry) => entry.id),
      });
      setCoaStatus(getCoaErrorMessage(error, 'COA entries could not be deleted.'));
    } finally {
      setIsSubmittingCoa(false);
    }
  };

  const saveAttachCoa = async () => {
    if (!attachingCoa || !attachCoaFile) {
      setCoaStatus('Choose a PDF first.');
      return;
    }

    setIsSubmittingCoa(true);

    try {
      const asset = await uploadCoaPdf(attachCoaFile);
      setCoaResults(await saveCoaEntry(mergeCoaPdfAsset(attachingCoa, asset)));
      setAttachingCoa(null);
      setAttachCoaFile(null);
      setCoaStatus(createParsedCoaStatus(asset.parsedCoa, 'COA PDF attached.'));
    } catch (error) {
      console.error(error);
      setCoaStatus(getCoaErrorMessage(error, 'COA PDF could not be attached.'));
    } finally {
      setIsSubmittingCoa(false);
    }
  };

  const saveCoaVialImageMode = async (result: CoaResult, mode: 'extracted' | 'placeholder') => {
    if (!result.vialImageAssetKey) {
      return;
    }

    setIsSubmittingCoa(true);

    try {
      setCoaResults(await saveCoaEntry({ ...result, vialImageMode: mode }));
      setCoaStatus(mode === 'placeholder' ? 'Generated vial restored.' : 'COA vial image restored.');
    } catch (error) {
      console.error(error);
      setCoaStatus('Vial image setting could not be saved.');
    } finally {
      setIsSubmittingCoa(false);
    }
  };

  return (
    <section className="coa-page" aria-labelledby="coa-title">
      <div className={`section__content coa-page__content${isAdmin ? ' coa-page__content--admin' : ''}`}>
        <header className="coa-page__header">
          <div>
            <p className="eyebrow">COAs</p>
            <h1 id="coa-title">Testing results</h1>
          </div>
          <p>Every batch is independently tested. Select a batch to view the full result summary.</p>
          {isAdmin && (
            <div className="coa-admin-actions">
              <button className="coa-admin-primary" type="button" disabled={isSubmittingCoa} onClick={() => void openBatchModal()}>
                Add batch numbers
              </button>
              <button type="button" onClick={openBulkUploadModal}>
                Add COAs
              </button>
              <button
                className="coa-admin-danger"
                type="button"
                disabled={isSubmittingCoa || !selectedFilterRound}
                onClick={() => void deleteAllCoasForSelectedRound()}
              >
                Delete all
              </button>
            </div>
          )}
        </header>

        {coaStatus && <p className="coa-admin-status">{coaStatus}</p>}

        {!selectedCoaId && (
          <>
            <div className="coa-toolbar" aria-label="COA filters">
              <label className="coa-round-filter">
                <span>Round</span>
                <select value={roundFilter} onChange={(event) => setRoundFilter(event.target.value)}>
                  <option value="all">All rounds</option>
                  {rounds.map((round) => (
                    <option value={round.id} key={round.id}>
                      {round.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="coa-search">
                <span>Search</span>
                <input
                  type="search"
                  value={searchTerm}
                  placeholder="Search peptide, batch, round, tier, or result..."
                  onChange={(event) => setSearchTerm(event.target.value)}
                />
              </label>

              <label className="coa-filter">
                <span>Peptide name</span>
                <select value={peptideFilter} onChange={(event) => setPeptideFilter(event.target.value)}>
                  <option value="all">All peptides</option>
                  {peptideOptions.map((option) => (
                    <option value={option.token} key={option.token}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="coa-results-summary" id="coa-results-count">
              Showing {filteredResults.length} of {sortedCoaResults.length} results
            </div>

            <div className="coa-table-shell" tabIndex={0} aria-label="Scrollable COA results table">
              <table className={`coa-results-table${isAdmin ? ' coa-results-table--admin' : ''}`} aria-describedby="coa-results-count">
                <colgroup>
                  <col className="coa-col-peptide" />
                  <col className="coa-col-mass" />
                  <col className="coa-col-batch" />
                  <col className="coa-col-round" />
                  <col className="coa-col-date" />
                  <col className="coa-col-tier" />
                  {coaResultColumns.map((column) => (
                    <col className={column.colClassName} key={column.key} />
                  ))}
                  <col className="coa-col-link" />
                  {isAdmin && <col className="coa-col-admin" />}
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col">Peptide Name</th>
                    <th scope="col">Mass</th>
                    <th scope="col">Batch #</th>
                    <th scope="col">Round</th>
                    <th scope="col">Date Tested</th>
                    <th scope="col">Testing Tier</th>
                    {coaResultColumns.map((column) => (
                      <th scope="col" key={column.key}>{column.label}</th>
                    ))}
                    <th scope="col">COA</th>
                    {isAdmin && <th scope="col">Admin</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredResultGroups.length > 0 ? (
                    filteredResultGroups.flatMap((group) =>
                      group.results.map((result, index) => (
                        <CoaResultTableRow
                          group={group}
                          isAdmin={isAdmin}
                          isSelected={result.id === selectedCoaId}
                          key={result.id}
                          result={result}
                          rowIndex={index}
                          onAttach={(entry) => {
                            setAttachingCoa(entry);
                            setAttachCoaFile(null);
                          }}
                          onEdit={openEditCoaModal}
                          onSelect={selectCoaResult}
                          onUnlock={openRoundUnlockModal}
                        />
                      )),
                    )
                  ) : (
                    <tr className="coa-empty-row">
                      <td colSpan={6 + coaResultColumns.length + 1 + (isAdmin ? 1 : 0)}>No COAs match the current filters.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {selectedCoaResult ? (
          <CoaBatchDetail
            result={selectedCoaResult}
            isAdmin={isAdmin}
            onAttach={(result) => {
              setAttachingCoa(result);
              setAttachCoaFile(null);
            }}
            onClear={clearSelectedCoaResult}
            onEdit={openEditCoaModal}
            onToggleVialImage={(result, mode) => void saveCoaVialImageMode(result, mode)}
            onUnlock={openRoundUnlockModal}
          />
        ) : selectedCoaId ? (
          <div className="coa-detail coa-detail--empty" role="status">
            <div>
              <p className="eyebrow">Batch not found</p>
              <h2>{selectedCoaId}</h2>
              <p>This COA hash does not match a published batch in the current static data.</p>
            </div>
            <button type="button" onClick={clearSelectedCoaResult}>
              Back to all results
            </button>
          </div>
        ) : null}

        {unlockTarget && (
          <CoaModal title={`Unlock ${unlockTarget.roundName}`} onClose={closeRoundUnlockModal}>
            <form className="coa-modal-form" onSubmit={submitRoundUnlock}>
              <p className="coa-modal-note">The password for this round can be found in the Helix Skool</p>
              <label className="coa-modal-field">
                <span>Round passcode</span>
                <input
                  key={unlockTarget.roundId}
                  name={`coa-round-passcode-${unlockTarget.roundId}`}
                  type="password"
                  value={unlockPasscode}
                  autoComplete="new-password"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(event) => setUnlockPasscode(event.target.value)}
                />
              </label>
              {unlockStatus && <p className="coa-admin-status">{unlockStatus}</p>}
              <div className="coa-modal-actions">
                <button type="button" disabled={isUnlockingRound} onClick={closeRoundUnlockModal}>
                  Cancel
                </button>
                <button className="coa-admin-primary" type="submit" disabled={isUnlockingRound}>
                  Unlock
                </button>
              </div>
            </form>
          </CoaModal>
        )}

        {isBatchModalOpen && (
          <CoaModal title="Add batch numbers" onClose={() => setIsBatchModalOpen(false)}>
            <div className="coa-modal-form">
              <label className="coa-modal-field">
                <span>Round</span>
                <select value={batchRoundId} onChange={(event) => setBatchRoundId(event.target.value)}>
                  {rounds.map((round) => (
                    <option value={round.id} key={round.id}>
                      {round.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="coa-modal-field">
                <span>Bulk batch upload</span>
                <input
                  type="file"
                  accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  disabled={isSubmittingCoa}
                  onChange={(event) => {
                    void loadBatchNumberFile(event.target.files?.[0] ?? null);
                    event.currentTarget.value = '';
                  }}
                />
              </label>
              {batchImportStatus && <p className="coa-modal-note">{batchImportStatus}</p>}
              <div className="coa-entry-editor">
                {batchRows.map((row) => {
                  const roundPeptide = selectedBatchRound?.peptides.find((peptide) => peptide.id === row.roundPeptideId) ?? null;

                  return (
                    <div className="coa-entry-row" key={row.id}>
                      <label>
                        <span>Peptide</span>
                        <select
                          value={row.roundPeptideId}
                          onChange={(event) => {
                            const peptide = selectedBatchRound?.peptides.find((currentPeptide) => currentPeptide.id === event.target.value);
                            updateBatchRow(row.id, {
                              roundPeptideId: event.target.value,
                              code: peptide?.vendorCode ?? row.code,
                            });
                          }}
                        >
                          <option value="">Choose peptide</option>
                          {selectableBatchRoundPeptides
                            .map((peptide) => (
                              <option value={peptide.id} key={peptide.id}>
                                {peptide.peptideName} - {peptide.vendorCode || peptide.mass}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label>
                        <span>Batch #</span>
                        <input value={row.batchNumber} onChange={(event) => updateBatchRow(row.id, { batchNumber: event.target.value })} />
                      </label>
                      <label>
                        <span>Code</span>
                        <input value={row.code} onChange={(event) => updateBatchRow(row.id, { code: event.target.value })} />
                      </label>
                      <label>
                        <span>Cap color</span>
                        <input value={row.capColor} onChange={(event) => updateBatchRow(row.id, { capColor: event.target.value })} />
                      </label>
                      <label>
                        <span>COA PDF</span>
                        <input type="file" accept="application/pdf,.pdf" onChange={(event) => updateBatchRow(row.id, { file: event.target.files?.[0] ?? null })} />
                      </label>
                      <div className="coa-row-derived">
                        <span>{roundPeptide ? formatMassWithUnits(roundPeptide.mass) : 'Mass'}</span>
                        <span>{roundPeptide ? formatTestingTierLabel(roundPeptide.testingTier) : 'Tier'}</span>
                      </div>
                      <button type="button" onClick={() => setBatchRows((currentRows) => currentRows.filter((currentRow) => currentRow.id !== row.id))}>
                        Delete
                      </button>
                    </div>
                  );
                })}
              </div>
              <button type="button" onClick={() => setBatchRows((currentRows) => [...currentRows, createCoaBatchFormRow()])}>
                Add Row
              </button>
              <div className="coa-modal-actions">
                <button type="button" onClick={() => setIsBatchModalOpen(false)}>Cancel</button>
                <button className="coa-admin-primary" type="button" disabled={isSubmittingCoa} onClick={() => void saveBatchRows()}>
                  Save batch numbers
                </button>
              </div>
            </div>
          </CoaModal>
        )}

        {isBulkUploadModalOpen && (
          <CoaModal title="Add COAs" onClose={() => setIsBulkUploadModalOpen(false)}>
            <div className="coa-modal-form">
              <label className="coa-modal-field">
                <span>PDF files</span>
                <input type="file" accept="application/pdf,.pdf" multiple onChange={(event) => loadBulkCoaFiles(event.target.files)} />
              </label>
              <div className="coa-upload-list">
                {bulkUploadDrafts.map((draft) => (
                  <label className="coa-upload-row" key={draft.id}>
                    <span className="coa-upload-file">
                      <span>{draft.file.name}</span>
                      <small>
                        {draft.identificationStatus === 'pending'
                          ? 'Reading batch number...'
                          : draft.parsedBatchNumber
                            ? `PDF batch: ${draft.parsedBatchNumber}`
                            : draft.identificationStatus === 'error'
                              ? 'Could not read the PDF batch number; choose manually.'
                              : 'Batch number not found; choose manually.'}
                      </small>
                    </span>
                    <select
                      value={draft.matchedCoaId}
                      disabled={draft.identificationStatus === 'pending'}
                      onChange={(event) => setBulkUploadDrafts((currentDrafts) =>
                        currentDrafts.map((currentDraft) => currentDraft.id === draft.id ? { ...currentDraft, matchedCoaId: event.target.value } : currentDraft),
                      )}
                    >
                      <option value="">Unmatched</option>
                      {sortedCoaResults.map((result) => (
                        <option value={result.id} key={result.id}>
                          {result.batchNumber} - {result.peptideName}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <div className="coa-modal-actions">
                <button type="button" onClick={() => setIsBulkUploadModalOpen(false)}>Cancel</button>
                <button className="coa-admin-primary" type="button" disabled={isSubmittingCoa || bulkUploadDrafts.length === 0 || bulkUploadDrafts.some((draft) => draft.identificationStatus === 'pending')} onClick={() => void saveBulkCoaUploads()}>
                  Attach PDFs
                </button>
              </div>
            </div>
          </CoaModal>
        )}

        {editingCoa && (
          <CoaModal title={`Edit ${editingCoa.batchNumber}`} onClose={() => setEditingCoa(null)}>
            <CoaEditFields
              form={coaEditForm}
              rounds={rounds}
              selectedRound={editRound}
              onChange={setCoaEditForm}
            />
            <div className="coa-modal-actions">
              <button className="coa-delete-button" type="button" disabled={isSubmittingCoa} onClick={() => void deleteEditedCoa()}>
                Delete
              </button>
              <button type="button" onClick={() => setEditingCoa(null)}>Cancel</button>
              <button className="coa-admin-primary" type="button" disabled={isSubmittingCoa} onClick={() => void saveEditedCoa()}>
                Save
              </button>
            </div>
          </CoaModal>
        )}

        {attachingCoa && (
          <CoaModal title={`Add COA for ${attachingCoa.batchNumber}`} onClose={() => setAttachingCoa(null)}>
            <div className="coa-modal-form">
              <label className="coa-modal-field">
                <span>PDF file</span>
                <input type="file" accept="application/pdf,.pdf" onChange={(event) => setAttachCoaFile(event.target.files?.[0] ?? null)} />
              </label>
              <div className="coa-modal-actions">
                <button type="button" onClick={() => setAttachingCoa(null)}>Cancel</button>
                <button className="coa-admin-primary" type="button" disabled={isSubmittingCoa || !attachCoaFile} onClick={() => void saveAttachCoa()}>
                  Save COA
                </button>
              </div>
            </div>
          </CoaModal>
        )}
      </div>
    </section>
  );
}

function CoaResultTableRow({
  group,
  result,
  rowIndex,
  isAdmin,
  isSelected,
  onAttach,
  onEdit,
  onSelect,
  onUnlock,
}: {
  group: CoaResultGroup;
  result: CoaResult;
  rowIndex: number;
  isAdmin: boolean;
  isSelected: boolean;
  onAttach: (result: CoaResult) => void;
  onEdit: (result: CoaResult) => void;
  onSelect: (resultId: string) => void;
  onUnlock: (roundId: string, roundName: string) => void;
}) {
  const unlockButtonRowIndex = group.results.length <= 5 ? Math.floor((group.results.length - 1) / 2) : 2;
  const shouldRenderUnlockButton = group.isLocked && rowIndex === unlockButtonRowIndex;
  const rowRef = useRef<HTMLTableRowElement | null>(null);
  const firstLockedCellRef = useRef<HTMLTableCellElement | null>(null);
  const lastLockedCellRef = useRef<HTMLTableCellElement | null>(null);
  const [unlockOverlayLeft, setUnlockOverlayLeft] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!shouldRenderUnlockButton) {
      return undefined;
    }

    const updateOverlayPosition = () => {
      const row = rowRef.current;
      const firstCell = firstLockedCellRef.current;
      const lastCell = lastLockedCellRef.current;

      if (!row || !firstCell || !lastCell) {
        return;
      }

      const shell = row.closest('.coa-table-shell');
      const rowRect = row.getBoundingClientRect();
      const firstRect = firstCell.getBoundingClientRect();
      const lastRect = lastCell.getBoundingClientRect();
      const shellRect = shell?.getBoundingClientRect();
      const visibleLeft = shellRect ? Math.max(firstRect.left, shellRect.left) : firstRect.left;
      const visibleRight = shellRect ? Math.min(lastRect.right, shellRect.right) : lastRect.right;

      setUnlockOverlayLeft((visibleLeft + visibleRight) / 2 - rowRect.left);
    };

    const shell = rowRef.current?.closest('.coa-table-shell');

    updateOverlayPosition();
    window.addEventListener('resize', updateOverlayPosition);
    shell?.addEventListener('scroll', updateOverlayPosition, { passive: true });

    return () => {
      window.removeEventListener('resize', updateOverlayPosition);
      shell?.removeEventListener('scroll', updateOverlayPosition);
    };
  }, [group.results.length, shouldRenderUnlockButton]);

  return (
    <tr
      ref={rowRef}
      className={[
        isSelected ? 'is-selected' : '',
        result.isResultLocked ? 'is-result-locked' : '',
        shouldRenderUnlockButton ? 'is-unlock-anchor' : '',
      ].filter(Boolean).join(' ')}
      role="button"
      tabIndex={0}
      aria-label={`View testing results for ${result.batchNumber}${result.isResultLocked ? ', locked' : ''}`}
      onClick={() => onSelect(result.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(result.id);
        }
      }}
    >
      <td data-label="Peptide Name">{result.peptideName}</td>
      <td data-label="Mass">{formatMassWithUnits(result.mass)}</td>
      <td data-label="Batch #">
        <code>{result.batchNumber}</code>
      </td>
      <td data-label="Round">{result.roundName}</td>
      <td data-label="Date Tested">{result.dateTested}</td>
      <td data-label="Testing Tier">
        <span className={`coa-tier coa-tier--${result.testingTier}`}>
          {formatTestingTierLabel(result.testingTier)}
        </span>
      </td>
      {coaResultColumns.map((column, columnIndex) => (
        <td
          className={result.isResultLocked ? 'coa-locked-result-cell' : ''}
          data-label={column.label}
          key={column.key}
          ref={columnIndex === 0 ? firstLockedCellRef : undefined}
        >
          {shouldRenderUnlockButton && columnIndex === 0 && (
            <button
              className="coa-result-unlock-overlay"
              style={unlockOverlayLeft === null ? undefined : { left: `${unlockOverlayLeft}px` }}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onUnlock(group.roundId, group.roundName);
              }}
            >
              {getRoundUnlockButtonText(group.roundName)}
            </button>
          )}
          {renderCoaResultTableValue(result, column)}
        </td>
      ))}
      <td className={result.isResultLocked ? 'coa-locked-result-cell' : ''} data-label="COA" ref={lastLockedCellRef}>
        {renderCoaDocumentTableValue(result)}
      </td>
      {result.isResultLocked && (
        <td className="coa-mobile-unlock-cell">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onUnlock(group.roundId, group.roundName);
            }}
          >
            {getRoundUnlockButtonText(group.roundName)}
          </button>
        </td>
      )}
      {isAdmin && (
        <td data-label="Admin">
          <div className="coa-row-actions">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onAttach(result);
              }}
            >
              Add COA
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onEdit(result);
              }}
            >
              Edit
            </button>
          </div>
        </td>
      )}
    </tr>
  );
}

function CoaBatchDetail({
  result,
  isAdmin,
  onAttach,
  onClear,
  onEdit,
  onToggleVialImage,
  onUnlock,
}: {
  result: CoaResult;
  isAdmin: boolean;
  onAttach: (result: CoaResult) => void;
  onClear: () => void;
  onEdit: (result: CoaResult) => void;
  onToggleVialImage: (result: CoaResult, mode: 'extracted' | 'placeholder') => void;
  onUnlock: (roundId: string, roundName: string) => void;
}) {
  const isLocked = result.isResultLocked;
  const vialImageUrl = isLocked ? '' : getCoaVialImageUrl(result);
  const [failedVialImageUrl, setFailedVialImageUrl] = useState('');
  const shouldShowVialImage = Boolean(vialImageUrl && failedVialImageUrl !== vialImageUrl);
  const detailSummaryItems = [
    { label: 'Round', value: result.roundName },
    { label: 'Lab', value: result.lab },
    { label: 'Date', value: result.dateTested },
    { label: 'Tier', value: formatTestingTierLabel(result.testingTier) },
  ].filter((item) => item.value);
  const detailRows: CoaDetailRow[] = [
    { label: 'Cap Color', value: result.capColor, capColor: true },
    ...(isLocked
      ? []
      : coaResultColumns.map((column) => ({
          label: column.detailLabel ?? column.label,
          value: getCoaResultValueForTier(result, column.key),
          status: column.status,
          pillClassName: column.pillClassName,
        }))),
  ].filter((item) => item.value && item.value !== '-');

  useEffect(() => {
    setFailedVialImageUrl('');
  }, [vialImageUrl]);

  return (
    <div className="coa-detail-stack">
      <article className="coa-detail" aria-labelledby="coa-detail-title">
        <div className="coa-detail__header">
          <div>
            <p className="eyebrow">Batch detail</p>
            <h2 id="coa-detail-title">{result.batchNumber}</h2>
            <p>
              <span className="coa-detail__subtitle-product">
                {result.peptideName} {formatMassWithUnits(result.mass)}
                <CoaIdentityConfirmationBadge result={result} />
              </span>
              , tested at the {formatTestingTierLabel(result.testingTier)} tier.
            </p>
          </div>
          <div className="coa-detail__actions">
            <button type="button" onClick={onClear}>
              Back to all results
            </button>
            {isLocked && (
              <button type="button" onClick={() => onUnlock(result.roundId, result.roundName)}>
                {getRoundUnlockButtonText(result.roundName)}
              </button>
            )}
            {!isLocked && !result.coaBlobKey && <span className="coa-pill coa-pill--pending">Pending</span>}
            {isAdmin && (
              <>
                {result.vialImageAssetKey && (
                  <button
                    type="button"
                    onClick={() => onToggleVialImage(result, result.vialImageMode === 'placeholder' ? 'extracted' : 'placeholder')}
                  >
                    {result.vialImageMode === 'placeholder' ? 'Use COA vial' : 'Use generated vial'}
                  </button>
                )}
                <button type="button" onClick={() => onAttach(result)}>
                  Add COA
                </button>
                <button type="button" onClick={() => onEdit(result)}>
                  Edit
                </button>
              </>
            )}
          </div>
        </div>

        <div className="coa-detail__body">
          <div className="coa-vial-slot" aria-label={`Vial image for ${result.batchNumber}`}>
            {shouldShowVialImage ? (
              <img
                src={vialImageUrl}
                alt={`${result.batchNumber} vial`}
                decoding="async"
                loading="eager"
                onError={() => setFailedVialImageUrl(vialImageUrl)}
              />
            ) : (
              <div className="coa-vial-placeholder" aria-hidden="true">
                <span className="coa-vial-placeholder__cap" style={{ background: getCoaCapSwatchColor(result.capColor) }} />
                <span className="coa-vial-placeholder__bottle" />
                <strong>Vial image</strong>
              </div>
            )}
          </div>

          <div className="coa-detail__info">
            <div className="coa-detail__summary" aria-label="COA summary">
              {detailSummaryItems.map((item) => (
                <div className="coa-detail__summary-item" key={item.label}>
                  <span className="coa-detail__summary-label">{item.label}</span>
                  <span className="coa-detail__summary-value">{item.value}</span>
                </div>
              ))}
            </div>

            <dl className="coa-detail__grid">
              {detailRows.map((item) => (
                <div key={item.label}>
                  <dt>{item.label}</dt>
                  <dd>
                    {item.status ? (
                      <span className={getCoaStatusClassName(item.value)}>{item.value}</span>
                    ) : item.capColor ? (
                      <span className="coa-cap-color">
                        <span aria-hidden="true" style={{ background: getCoaCapSwatchColor(result.capColor) }} />
                        {item.value}
                      </span>
                    ) : item.pillClassName ? (
                      <span className={`coa-pill ${item.pillClassName}`}>{item.value}</span>
                    ) : (
                      item.value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
            {isLocked && (
              <div className="coa-detail__locked">
                <span className="coa-pill coa-pill--locked">Locked</span>
                <p>Round results and COA documents are hidden until the round passcode is entered.</p>
              </div>
            )}
          </div>
        </div>
      </article>

      {!isLocked && (result.coaBlobKey || result.verificationUrl) && (
        <div className="coa-detail__preview-actions" aria-label="COA document actions">
          {result.coaBlobKey && (
            <a className="coa-detail__open-link" href={getCoaPdfUrl(result)} target="_blank" rel="noreferrer">
              Open COA
            </a>
          )}
          {result.verificationUrl && (
            <a className="coa-detail__verify-link" href={result.verificationUrl} target="_blank" rel="noreferrer">
              Verify COA
            </a>
          )}
        </div>
      )}

      {!isLocked && result.coaBlobKey && <CoaPdfPreview result={result} pdfUrl={getCoaPdfUrl(result)} />}
    </div>
  );
}

function CoaIdentityConfirmationBadge({ result }: { result: CoaResult }) {
  const [activeBadge, setActiveBadge] = useState<{ pinned: boolean } | null>(null);

  if (!hasCoaIdentityConfirmation(result)) {
    return null;
  }

  const tooltipId = `coa-identity-${createCoaId(result.id || result.batchNumber)}-tooltip`;
  const isOpen = Boolean(activeBadge);

  const closeIfTransient = () => {
    setActiveBadge((current) => (current && !current.pinned ? null : current));
  };

  return (
    <span
      className={`coa-identity-confirmation${activeBadge?.pinned ? ' is-pinned' : ''}`}
      onMouseEnter={() => setActiveBadge({ pinned: false })}
      onMouseLeave={closeIfTransient}
    >
      <button
        className="coa-identity-confirmation__button"
        type="button"
        aria-label="Identity confirmation"
        aria-describedby={isOpen ? tooltipId : undefined}
        aria-expanded={isOpen}
        onFocus={() => setActiveBadge({ pinned: false })}
        onBlur={closeIfTransient}
        onClick={(event) => {
          event.stopPropagation();
          setActiveBadge((current) => (current?.pinned ? null : { pinned: true }));
        }}
      >
        <CircleCheckBig size={15} strokeWidth={2.7} />
      </button>
      {isOpen && (
        <span className="coa-identity-confirmation__bubble" id={tooltipId} role="tooltip">
          confirmed as {result.peptideName} by HPLC
        </span>
      )}
    </span>
  );
}

function CoaPdfPreview({ result, pdfUrl }: { result: CoaResult; pdfUrl: string }) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const animationStartScrollY = useRef(0);
  const [pages, setPages] = useState<CoaPreviewPage[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let isCancelled = false;
    const objectUrls: string[] = [];
    const renderedPages: CoaPreviewPage[] = [];
    const loadingTask = pdfjs.getDocument({ url: pdfUrl });

    setPages([]);
    setStatus('loading');

    void (async () => {
      try {
        const pdf = await loadingTask.promise;

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          if (isCancelled) {
            break;
          }

          const page = await pdf.getPage(pageNumber);
          const baseViewport = page.getViewport({ scale: 1 });
          const renderScale = getCoaPreviewRenderScale(baseViewport.width);
          const viewport = page.getViewport({ scale: renderScale });
          const canvas = document.createElement('canvas');

          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);

          await page.render({ canvas, viewport }).promise;

          if (isCancelled) {
            break;
          }

          const pageBlob = await new Promise<Blob | null>((resolve) => {
            canvas.toBlob(resolve, 'image/png');
          });

          canvas.width = 0;
          canvas.height = 0;

          if (!pageBlob) {
            throw new Error('COA preview image could not be created.');
          }

          const pageUrl = URL.createObjectURL(pageBlob);

          if (isCancelled) {
            URL.revokeObjectURL(pageUrl);
            break;
          }

          objectUrls.push(pageUrl);
          renderedPages.push({
            pageNumber,
            src: pageUrl,
            width: viewport.width,
            height: viewport.height,
          });
          setPages([...renderedPages]);
        }

        if (!isCancelled) {
          setStatus('ready');
        }
      } catch (error) {
        if (!isCancelled) {
          console.error(error);
          setStatus('error');
        }
      }
    })();

    return () => {
      isCancelled = true;
      objectUrls.forEach((objectUrl) => URL.revokeObjectURL(objectUrl));
      void loadingTask.destroy();
    };
  }, [pdfUrl]);

  useEffect(() => {
    const shell = shellRef.current;

    if (!shell) {
      return undefined;
    }

    let layoutFrame = 0;
    let smoothFrame = 0;
    let currentProgress = 0;
    let targetProgress = 0;
    let latestPreviewHeight = 360;
    let latestPageWidth = 248;
    let latestPageShift = 0;
    animationStartScrollY.current = window.scrollY || window.pageYOffset || 0;

    const measurePreviewLayout = () => {
      const rect = shell.getBoundingClientRect();
      const scrollY = window.scrollY || window.pageYOffset || 0;
      const viewportHeight = window.innerHeight || 800;
      const viewportWidth = window.innerWidth || 1280;
      const remainingHeight = viewportHeight - rect.top - 28;
      latestPreviewHeight = Math.max(320, Math.min(760, remainingHeight));
      const progressDistance = Math.max(360, viewportHeight * 0.52);
      const scrollProgress = (scrollY - animationStartScrollY.current) / progressDistance;
      targetProgress = Math.max(0, Math.min(1, scrollProgress));

      const easedProgress = 1 - Math.pow(1 - currentProgress, 3);
      const compactWidth = 248;
      const expandedWidth = Math.min(1160, viewportWidth * 0.6, shell.clientWidth - 24);
      latestPageWidth = viewportWidth <= 760
        ? Math.max(260, Math.min(shell.clientWidth - 12, viewportWidth - 32))
        : compactWidth + (Math.max(compactWidth, expandedWidth) - compactWidth) * easedProgress;
      latestPageShift = easedProgress * 62;
    };

    const applyPreviewLayout = () => {
      shell.style.setProperty('--coa-preview-min-height', `${Math.round(latestPreviewHeight)}px`);
      shell.style.setProperty('--coa-preview-progress', currentProgress.toFixed(3));
      shell.style.setProperty('--coa-preview-page-width', `${Math.round(latestPageWidth)}px`);
      shell.style.setProperty('--coa-preview-page-shift', `${Math.round(latestPageShift)}px`);
    };

    const animatePreviewLayout = () => {
      const progressDelta = targetProgress - currentProgress;

      currentProgress += progressDelta * 0.12;

      if (Math.abs(progressDelta) < 0.001) {
        currentProgress = targetProgress;
      }

      measurePreviewLayout();
      applyPreviewLayout();

      if (currentProgress !== targetProgress) {
        smoothFrame = window.requestAnimationFrame(animatePreviewLayout);
      } else {
        smoothFrame = 0;
      }
    };

    const scheduleUpdate = () => {
      if (layoutFrame) {
        return;
      }

      layoutFrame = window.requestAnimationFrame(() => {
        layoutFrame = 0;
        measurePreviewLayout();

        if (!smoothFrame) {
          smoothFrame = window.requestAnimationFrame(animatePreviewLayout);
        }
      });
    };

    scheduleUpdate();
    window.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate);

    let wheelFrame = 0;
    let wheelTargetY = window.scrollY || window.pageYOffset || 0;

    const getMaxScrollY = () => Math.max(
      0,
      document.documentElement.scrollHeight - (window.innerHeight || document.documentElement.clientHeight),
    );

    const animateWheelScroll = () => {
      const currentScrollY = window.scrollY || window.pageYOffset || 0;
      const scrollDelta = wheelTargetY - currentScrollY;

      if (Math.abs(scrollDelta) < 0.75) {
        window.scrollTo({ top: wheelTargetY, left: 0, behavior: 'auto' });
        wheelFrame = 0;
        return;
      }

      window.scrollTo({ top: currentScrollY + scrollDelta * 0.16, left: 0, behavior: 'auto' });
      wheelFrame = window.requestAnimationFrame(animateWheelScroll);
    };

    const syncWheelTarget = () => {
      if (!wheelFrame) {
        wheelTargetY = window.scrollY || window.pageYOffset || 0;
      }
    };

    const handleWheel = (event: WheelEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
        return;
      }

      const deltaUnit = event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? window.innerHeight
        : event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : 1;
      const softenedDelta = event.deltaY * deltaUnit * 0.55;

      event.preventDefault();
      wheelTargetY = Math.max(0, Math.min(getMaxScrollY(), wheelTargetY + softenedDelta));

      if (!wheelFrame) {
        wheelFrame = window.requestAnimationFrame(animateWheelScroll);
      }
    };

    window.addEventListener('scroll', syncWheelTarget, { passive: true });
    window.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      if (layoutFrame) {
        window.cancelAnimationFrame(layoutFrame);
      }

      if (smoothFrame) {
        window.cancelAnimationFrame(smoothFrame);
      }

      if (wheelFrame) {
        window.cancelAnimationFrame(wheelFrame);
      }

      window.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('scroll', syncWheelTarget);
      window.removeEventListener('resize', scheduleUpdate);
      window.removeEventListener('wheel', handleWheel);
    };
  }, [pdfUrl]);

  return (
    <section className="coa-pdf-preview" ref={shellRef} aria-label={`PDF preview for ${result.batchNumber}`}>
      {status === 'loading' && pages.length === 0 && <div className="coa-pdf-preview__status">Loading COA preview...</div>}
      {status === 'error' && <div className="coa-pdf-preview__status coa-pdf-preview__status--error">COA preview could not be loaded.</div>}
      {pages.length > 0 && (
        <div className="coa-pdf-preview__pages">
          {pages.map((page) => (
            <figure className="coa-pdf-preview__page" key={page.pageNumber}>
              <img
                src={page.src}
                alt={`${result.batchNumber} COA page ${page.pageNumber}`}
                style={{ aspectRatio: `${page.width} / ${page.height}` }}
              />
            </figure>
          ))}
        </div>
      )}
    </section>
  );
}

function getCoaPreviewRenderScale(basePageWidth: number) {
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1280;

  if (viewportWidth <= 760) {
    return Math.min(1.55, Math.max(1.12, 760 / basePageWidth));
  }

  return Math.min(2.2, Math.max(1.35, 1120 / basePageWidth));
}

function CoaModal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="coa-modal-backdrop" role="presentation">
      <section className="coa-modal" role="dialog" aria-modal="true" aria-labelledby="coa-modal-title">
        <div className="coa-modal__header">
          <h2 id="coa-modal-title">{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose}>
            x
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function CoaEditFields({
  form,
  rounds,
  selectedRound,
  onChange,
}: {
  form: CoaEditForm;
  rounds: Round[];
  selectedRound: Round | null;
  onChange: (form: CoaEditForm) => void;
}) {
  return (
    <div className="coa-modal-form">
      <div className="coa-modal-grid">
        <label className="coa-modal-field">
          <span>Round</span>
          <select
            value={form.roundId}
            onChange={(event) => onChange({
              ...form,
              roundId: event.target.value,
              roundPeptideId: '',
            })}
          >
            <option value="">Choose round</option>
            {rounds.map((round) => (
              <option value={round.id} key={round.id}>
                {round.name}
              </option>
            ))}
          </select>
        </label>
        <label className="coa-modal-field">
          <span>Peptide</span>
          <select
            value={form.roundPeptideId}
            onChange={(event) => {
              const peptide = selectedRound?.peptides.find((row) => row.id === event.target.value);
              onChange({
                ...form,
                roundPeptideId: event.target.value,
                code: peptide?.vendorCode ?? form.code,
              });
            }}
          >
            <option value="">Choose peptide</option>
            {sortRoundPeptidesByVendorCode(selectedRound?.peptides
              .filter((row) => row.peptideId || row.vendorCode) ?? [])
              .map((row) => (
                <option value={row.id} key={row.id}>
                  {row.peptideName} - {row.vendorCode || row.mass}
                </option>
              ))}
          </select>
        </label>
        <CoaTextInput label="Batch #" value={form.batchNumber} onChange={(value) => onChange({ ...form, batchNumber: value })} />
        <CoaTextInput label="Code" value={form.code} onChange={(value) => onChange({ ...form, code: value })} />
        <CoaTextInput label="Cap color" value={form.capColor} onChange={(value) => onChange({ ...form, capColor: value })} />
        <CoaTextInput label="Date tested" value={form.dateTested} onChange={(value) => onChange({ ...form, dateTested: value })} />
        <CoaTextInput label="Lab" value={form.lab} onChange={(value) => onChange({ ...form, lab: value })} />
        <CoaTextInput label="COA #" value={form.coaNumber} onChange={(value) => onChange({ ...form, coaNumber: value })} />
        <CoaTextInput label="Accession #" value={form.accessionNumber} onChange={(value) => onChange({ ...form, accessionNumber: value })} />
        <CoaTextInput label="Verify URL" value={form.verificationUrl} onChange={(value) => onChange({ ...form, verificationUrl: value })} />
        <CoaTextInput label="Avg net content" value={form.averageNetContent} onChange={(value) => onChange({ ...form, averageNetContent: value })} />
        <CoaTextInput label="Purity" value={form.purity} onChange={(value) => onChange({ ...form, purity: value })} />
        <CoaTextInput label="Endotoxins" value={form.endotoxins} onChange={(value) => onChange({ ...form, endotoxins: value })} />
        <CoaTextInput label="Heavy metals" value={form.heavyMetals} onChange={(value) => onChange({ ...form, heavyMetals: value })} />
        <CoaTextInput label="Sterility" value={form.sterility} onChange={(value) => onChange({ ...form, sterility: value })} />
        <CoaTextInput label="Fentanyl" value={form.fentanyl} onChange={(value) => onChange({ ...form, fentanyl: value })} />
        <label className="coa-modal-field">
          <span>COA PDF</span>
          <input type="file" accept="application/pdf,.pdf" onChange={(event) => onChange({ ...form, file: event.target.files?.[0] ?? null })} />
        </label>
      </div>
    </div>
  );
}

function CoaTextInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="coa-modal-field">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function getCoaHashSelection() {
  if (typeof window === 'undefined') {
    return '';
  }

  return decodeURIComponent(window.location.hash.replace(/^#/, '')).trim();
}

function getInitialCoaFilterState() {
  if (typeof window === 'undefined' || getCoaHashSelection()) {
    return { ...defaultCoaFilters };
  }

  return parseCoaFilterSearch(window.location.search);
}

function filterCoaResults(results: CoaResult[], searchTerm: string, peptideFilter: string, roundFilter: string) {
  const normalizedSearchTerm = normalizeCoaSearchText(searchTerm);

  return results.filter((result) => {
    if (roundFilter !== 'all' && result.roundId !== roundFilter) {
      return false;
    }

    if (peptideFilter !== 'all' && result.peptideName !== peptideFilter) {
      return false;
    }

    if (!normalizedSearchTerm) {
      return true;
    }

    return normalizeCoaSearchText([
      result.peptideName,
      result.mass,
      result.batchNumber,
      result.roundName,
      result.dateTested,
      formatTestingTierLabel(result.testingTier),
      ...coaResultColumns
        .map((column) => getCoaResultValueForTier(result, column.key))
        .filter((value) => value !== '-'),
      result.capColor,
    ]
      .join(' '))
      .includes(normalizedSearchTerm);
  });
}

function renderCoaResultTableValue(result: CoaResult, column: CoaResultColumn) {
  if (result.isResultLocked) {
    const lockedState = result.lockedResultStates[column.key];
    const pillClassName = lockedState === 'populated' ? 'coa-pill--pass' : 'coa-pill--pending';

    return <span className={`coa-pill ${pillClassName} coa-obscured-value`}>Hidden</span>;
  }

  const value = getCoaResultValueForTier(result, column.key);

  if (value === '-') {
    return value;
  }

  if (column.status) {
    return <span className={getCoaStatusClassName(value)}>{value}</span>;
  }

  return <span className={`coa-pill ${column.pillClassName ?? 'coa-pill--neutral'}`}>{value}</span>;
}

function renderCoaDocumentTableValue(result: CoaResult) {
  if (result.isResultLocked) {
    return <span className="coa-pill coa-pill--locked coa-obscured-value">Locked</span>;
  }

  if (!result.coaBlobKey) {
    return <span className="coa-pill coa-pill--pending">Pending</span>;
  }

  return (
    <a
      className="coa-link"
      href={getCoaPdfUrl(result)}
      target="_blank"
      rel="noreferrer"
      aria-label={`Open COA for ${result.batchNumber}`}
      onClick={(event) => event.stopPropagation()}
    >
      View
    </a>
  );
}

function hasCoaIdentityConfirmation(result: CoaResult) {
  return Boolean(result.coaBlobKey && result.parsedCoa?.fields.identityConfirmation);
}

function getCoaResultValueForTier(result: CoaResult, key: CoaTestResultKey) {
  if (!isCoaTestResultIncluded(result.testingTier, key)) {
    return '-';
  }

  return result[key] || 'Pending';
}

function getRoundUnlockButtonText(roundName: string) {
  return `Unlock ${roundName || 'round'} results`;
}

function isCoaTestResultIncluded(tier: TestingTierId, key: CoaTestResultKey) {
  return coaTestResultsByTier[tier].includes(key);
}

function normalizeCoaSearchText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.%+]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function createCoaId(batchNumber: string) {
  return batchNumber
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function sortCoaResults(results: CoaResult[], rounds: Round[] = []) {
  const roundOrder = new Map(rounds.map((round, index) => [round.id, index]));

  return [...results].sort((first, second) =>
    (roundOrder.get(first.roundId) ?? Number.MAX_SAFE_INTEGER) - (roundOrder.get(second.roundId) ?? Number.MAX_SAFE_INTEGER)
    || first.roundName.localeCompare(second.roundName, undefined, { numeric: true, sensitivity: 'base' })
    || first.batchNumber.localeCompare(second.batchNumber, undefined, { numeric: true, sensitivity: 'base' }),
  );
}

function groupCoaResultsByRound(results: CoaResult[]): CoaResultGroup[] {
  const groups = new Map<string, CoaResultGroup>();

  for (const result of results) {
    const groupKey = result.roundId || result.roundName || 'unknown-round';
    const existingGroup = groups.get(groupKey);

    if (existingGroup) {
      existingGroup.results.push(result);
      existingGroup.isLocked ||= result.isResultLocked;
      continue;
    }

    groups.set(groupKey, {
      roundId: result.roundId,
      roundName: result.roundName || 'Round',
      isLocked: result.isResultLocked,
      results: [result],
    });
  }

  return [...groups.values()];
}

function normalizeCoaResult(value: unknown): CoaResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const coa = value as Partial<CoaResult>;
  const id = sanitizeClientText(coa.id);
  const batchNumber = sanitizeClientText(coa.batchNumber);

  if (!id || !batchNumber) {
    return null;
  }

  return {
    id,
    roundId: sanitizeClientText(coa.roundId),
    roundName: sanitizeClientText(coa.roundName),
    roundPeptideId: sanitizeClientText(coa.roundPeptideId),
    peptideId: sanitizeClientText(coa.peptideId),
    peptideName: sanitizeClientText(coa.peptideName),
    code: sanitizeClientText(coa.code),
    batchNumber,
    capColor: sanitizeClientText(coa.capColor) || 'TBD',
    mass: sanitizeClientText(coa.mass),
    testingTier: normalizeClientTestingTier(coa.testingTier),
    dateTested: sanitizeClientText(coa.dateTested),
    lab: sanitizeClientText(coa.lab),
    coaNumber: sanitizeClientText(coa.coaNumber),
    accessionNumber: sanitizeClientText(coa.accessionNumber),
    verificationUrl: sanitizeClientText(coa.verificationUrl),
    averageNetContent: sanitizeClientText(coa.averageNetContent) || 'Pending',
    purity: sanitizeClientText(coa.purity) || 'Pending',
    endotoxins: sanitizeClientText(coa.endotoxins) || 'Pending',
    heavyMetals: sanitizeClientText(coa.heavyMetals) || 'Pending',
    sterility: sanitizeClientText(coa.sterility) || 'Pending',
    fentanyl: sanitizeClientText(coa.fentanyl) || 'Pending',
    coaFileName: sanitizeClientText(coa.coaFileName),
    coaMimeType: sanitizeClientText(coa.coaMimeType),
    coaBlobKey: sanitizeClientText(coa.coaBlobKey),
    coaUploadedAt: sanitizeClientText(coa.coaUploadedAt),
    vialImageAssetKey: sanitizeClientText(coa.vialImageAssetKey),
    vialImageMimeType: sanitizeClientText(coa.vialImageMimeType),
    vialImageFileName: sanitizeClientText(coa.vialImageFileName),
    vialImageSource: sanitizeClientText(coa.vialImageSource),
    vialImageMode: coa.vialImageMode === 'placeholder' ? 'placeholder' : 'extracted',
    vialImageExtractedAt: sanitizeClientText(coa.vialImageExtractedAt),
    parsedCoa: normalizeParsedCoa(coa.parsedCoa),
    createdAt: sanitizeClientText(coa.createdAt),
    updatedAt: sanitizeClientText(coa.updatedAt),
    isResultLocked: coa.isResultLocked === true,
    hasRoundPasscode: coa.hasRoundPasscode === true,
    lockedResultStates: normalizeLockedResultStates(coa.lockedResultStates),
  };
}

function normalizeLockedResultStates(value: unknown): CoaResult['lockedResultStates'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, 'pending' | 'populated'] => entry[1] === 'pending' || entry[1] === 'populated'),
  );
}

function normalizeParsedCoa(value: unknown): ParsedCoa | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const parsed = value as Partial<ParsedCoa>;
  const fields = (parsed.fields && typeof parsed.fields === 'object' && !Array.isArray(parsed.fields)
    ? parsed.fields
    : {}) as Partial<ParsedCoa['fields']>;
  const raw = (parsed.raw && typeof parsed.raw === 'object' && !Array.isArray(parsed.raw)
    ? parsed.raw
    : {}) as Partial<NonNullable<ParsedCoa['raw']>>;

  return {
    parserVersion: sanitizeClientText(parsed.parserVersion),
    extractionMethod: sanitizeClientText(parsed.extractionMethod),
    templateId: sanitizeClientText(parsed.templateId),
    templateConfidence: normalizeClientNumber(parsed.templateConfidence),
    matchedAnchors: normalizeClientStringList(parsed.matchedAnchors),
    pageCount: Math.max(0, Math.round(normalizeClientNumber(parsed.pageCount))),
    confidence: normalizeClientNumber(parsed.confidence),
    fields: {
      lab: sanitizeClientText(fields.lab),
      coaNumber: sanitizeClientText(fields.coaNumber),
      lotNumber: sanitizeClientText(fields.lotNumber),
      accessionNumber: sanitizeClientText(fields.accessionNumber),
      productName: sanitizeClientText(fields.productName),
      identityConfirmation: sanitizeClientText(fields.identityConfirmation),
      analysisDate: sanitizeClientText(fields.analysisDate),
      dateReceived: sanitizeClientText(fields.dateReceived),
      issuedDate: sanitizeClientText(fields.issuedDate),
      labeledContent: sanitizeClientText(fields.labeledContent),
      purity: sanitizeClientText(fields.purity),
      averageNetContent: sanitizeClientText(fields.averageNetContent),
      meanPurity: sanitizeClientText(fields.meanPurity),
      endotoxinResult: sanitizeClientText(fields.endotoxinResult),
      endotoxinThreshold: sanitizeClientText(fields.endotoxinThreshold),
      heavyMetals: sanitizeClientText(fields.heavyMetals) || 'Pending',
      sterility: sanitizeClientText(fields.sterility) || 'Pending',
      endotoxins: sanitizeClientText(fields.endotoxins) || 'Pending',
      fentanyl: sanitizeClientText(fields.fentanyl) || 'Pending',
      accessCode: sanitizeClientText(fields.accessCode),
      verificationUrl: sanitizeClientText(fields.verificationUrl),
      overallStatus: sanitizeClientText(fields.overallStatus),
    },
    warnings: normalizeClientStringList(parsed.warnings),
    raw: {
      verificationUrls: normalizeClientStringList(raw.verificationUrls),
      snippets: normalizeClientStringRecord(raw.snippets),
      vialImage: normalizeParsedVialImage(raw.vialImage),
    },
    error: sanitizeClientText(parsed.error),
  };
}

function normalizeParsedVialImage(value: unknown): NonNullable<ParsedCoa['raw']>['vialImage'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const image = value as Partial<NonNullable<NonNullable<ParsedCoa['raw']>['vialImage']>>;

  return {
    pageNumber: Math.max(0, Math.round(normalizeClientNumber(image.pageNumber))),
    operatorIndex: Math.max(0, Math.round(normalizeClientNumber(image.operatorIndex))),
    imageName: sanitizeClientText(image.imageName),
    width: Math.max(0, Math.round(normalizeClientNumber(image.width))),
    height: Math.max(0, Math.round(normalizeClientNumber(image.height))),
    drawnX: normalizeClientNumber(image.drawnX),
    drawnY: normalizeClientNumber(image.drawnY),
    drawnWidth: normalizeClientNumber(image.drawnWidth),
    drawnHeight: normalizeClientNumber(image.drawnHeight),
    mimeType: sanitizeClientText(image.mimeType) || 'image/png',
    score: normalizeClientNumber(image.score),
  };
}

function normalizeClientTestingTier(value: unknown): TestingTierId {
  return value === 'platinum' || value === 'gold' || value === 'gold-plus' || value === 'bronze'
    ? value
    : 'none';
}

function formatTestingTierLabel(tier: TestingTierId) {
  if (tier === 'none') {
    return 'None';
  }

  if (tier === 'gold-plus') {
    return 'Gold Plus';
  }

  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

function formatMassWithUnits(value: string) {
  const cleanValue = sanitizeClientText(value);

  if (!cleanValue) {
    return '';
  }

  return /[a-z]/i.test(cleanValue) ? cleanValue : `${cleanValue} mg`;
}

function getCoaPdfUrl(result: CoaResult) {
  return `/api/coas/${encodeURIComponent(result.id)}/pdf`;
}

function getCoaVialImageUrl(result: CoaResult) {
  if (!result.vialImageAssetKey || result.vialImageMode === 'placeholder') {
    return '';
  }

  const version = encodeURIComponent(result.vialImageExtractedAt || result.vialImageAssetKey);

  return `/api/coas/${encodeURIComponent(result.id)}/vial-image?v=${version}`;
}

async function fetchCoaResults() {
  const response = await fetch('/api/data/coas');

  if (!response.ok) {
    throw new Error('COAs could not be loaded.');
  }

  const records = (await response.json()) as unknown;
  return Array.isArray(records)
    ? records.map(normalizeCoaResult).filter((result): result is CoaResult => Boolean(result))
    : [];
}

async function unlockCoaRound(roundId: string, passcode: string) {
  const response = await fetch('/api/coas/round-passcode', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ roundId, passcode }),
  });

  if (!response.ok) {
    throw new Error('Round could not be unlocked.');
  }
}

async function saveCoaEntry(entry: CoaResult) {
  const response = await fetch(`/api/admin/data/coas/${encodeURIComponent(entry.id)}`, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(entry),
  });

  if (!response.ok) {
    throw new Error('COA entry could not be saved.');
  }

  const records = (await response.json()) as unknown;
  return Array.isArray(records)
    ? records.map(normalizeCoaResult).filter((result): result is CoaResult => Boolean(result))
    : [];
}

async function saveCoaEntriesBatch(entries: CoaResult[]): Promise<CoaBatchImportResult> {
  const response = await fetch('/api/admin/coas/import-batch', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ rows: entries }),
  });

  const payload = await readCoaJsonResponse<Partial<CoaBatchImportResult> & { error?: string; details?: unknown }>(
    response,
    'COA batch entries could not be saved.',
  );

  if (!response.ok) {
    const details = payload.details === undefined ? '' : ` Details: ${JSON.stringify(payload.details)}`;
    throw new Error(`${payload.error || 'COA batch entries could not be saved.'}${details}`);
  }

  return {
    items: Array.isArray(payload.items)
      ? payload.items.map(normalizeCoaResult).filter((result): result is CoaResult => Boolean(result))
      : [],
    savedCount: Number(payload.savedCount) || 0,
    failedCount: Number(payload.failedCount) || 0,
    rowErrors: Array.isArray(payload.rowErrors) ? payload.rowErrors : [],
  };
}

async function deleteCoaEntry(entryId: string) {
  const response = await fetch(`/api/admin/data/coas/${encodeURIComponent(entryId)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  });

  if (!response.ok) {
    throw new Error('COA entry could not be deleted.');
  }

  const records = (await response.json()) as unknown;
  return Array.isArray(records)
    ? records.map(normalizeCoaResult).filter((result): result is CoaResult => Boolean(result))
    : [];
}

async function deleteCoaEntriesBatch(ids: string[]): Promise<CoaBatchDeleteResult> {
  const response = await fetch('/api/admin/coas/delete-batch', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ids }),
  });

  const payload = await readCoaJsonResponse<Partial<CoaBatchDeleteResult> & { error?: string; details?: unknown }>(
    response,
    'COA entries could not be deleted.',
  );

  if (!response.ok) {
    const details = payload.details === undefined ? '' : ` Details: ${JSON.stringify(payload.details)}`;
    throw new Error(`${payload.error || 'COA entries could not be deleted.'}${details}`);
  }

  return {
    items: Array.isArray(payload.items)
      ? payload.items.map(normalizeCoaResult).filter((result): result is CoaResult => Boolean(result))
      : [],
    deletedCount: Number(payload.deletedCount) || 0,
    failedCount: Number(payload.failedCount) || 0,
    rowErrors: Array.isArray(payload.rowErrors) ? payload.rowErrors : [],
  };
}

async function readCoaJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const text = await response.text();

  if (!text.trim()) {
    return {} as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch (error) {
    console.error('[coa-api] response JSON parse failed', {
      fallbackMessage,
      status: response.status,
      statusText: response.statusText,
      bodyPreview: text.slice(0, 500),
      error,
    });
    throw new Error(`${fallbackMessage} Response was not valid JSON.`);
  }
}

async function uploadCoaPdf(file: File): Promise<CoaPdfAsset> {
  console.info('[coa-pdf] upload start', {
    fileName: file.name,
    mimeType: file.type || 'application/pdf',
    size: file.size,
    lastModified: file.lastModified,
  });

  const base64 = await fileToBase64(file);

  console.info('[coa-pdf] upload file encoded', {
    fileName: file.name,
    size: file.size,
    base64Length: base64.length,
  });

  const response = await fetch('/api/admin/assets/coa-pdf', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fileName: file.name,
      mimeType: file.type || 'application/pdf',
      base64,
    }),
  });

  console.info('[coa-pdf] upload response received', {
    fileName: file.name,
    status: response.status,
    statusText: response.statusText,
    ok: response.ok,
  });

  if (!response.ok) {
    const text = await response.text();

    console.error('[coa-pdf] upload request failed', {
      fileName: file.name,
      status: response.status,
      statusText: response.statusText,
      bodyPreview: text.slice(0, 1200),
    });

    throw new Error('COA PDF could not be uploaded.');
  }

  const asset = (await response.json()) as CoaPdfAsset;
  const parserWarnings = asset.parsedCoa?.warnings ?? [];

  if (asset.parsedCoa?.error || parserWarnings.length > 0) {
    console.error('[coa-pdf] upload completed with parser diagnostics', {
      fileName: file.name,
      coaBlobKey: asset.coaBlobKey,
      parserError: asset.parsedCoa?.error,
      parserWarnings,
      diagnostics: asset.diagnostics,
      parsedCoa: asset.parsedCoa,
    });
  } else {
    console.info('[coa-pdf] upload completed with parsed COA', {
      fileName: file.name,
      coaBlobKey: asset.coaBlobKey,
      diagnostics: asset.diagnostics,
      parsedFields: asset.parsedCoa?.fields,
    });
  }

  return asset;
}

async function identifyCoaPdf(file: File) {
  const base64 = await fileToBase64(file);
  const response = await fetch('/api/admin/assets/coa-pdf-identify', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fileName: file.name,
      mimeType: file.type || 'application/pdf',
      base64,
    }),
  });

  if (!response.ok) {
    throw new Error('COA PDF batch number could not be identified.');
  }

  const result = (await response.json()) as { batchNumber?: unknown };
  return sanitizeClientText(result.batchNumber);
}

async function parseCoaBatchNumberFile(file: File): Promise<CoaBatchImportRow[]> {
  const response = await fetch('/api/admin/coas/parse-batch-numbers', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      source: {
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        base64: await fileToBase64(file),
      },
    }),
  });

  if (!response.ok) {
    throw new Error('Batch number file could not be parsed.');
  }

  const payload = (await response.json()) as { rows?: unknown };
  return Array.isArray(payload.rows)
    ? payload.rows.map(normalizeCoaBatchImportRow).filter((row): row is CoaBatchImportRow => Boolean(row))
    : [];
}

function normalizeCoaBatchImportRow(value: unknown): CoaBatchImportRow | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const row = value as Partial<CoaBatchImportRow>;
  const batchNumber = sanitizeClientText(row.batchNumber);

  if (!batchNumber) {
    return null;
  }

  return {
    peptideName: sanitizeClientText(row.peptideName),
    batchNumber,
    code: sanitizeClientText(row.code),
    capColor: sanitizeClientText(row.capColor),
  };
}

function createCoaBatchFormRow(): CoaBatchFormRow {
  return {
    id: `coa-row-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    roundPeptideId: '',
    batchNumber: '',
    capColor: '',
    code: '',
    file: null,
  };
}

function findRoundPeptideForCoaBatchImport(row: CoaBatchImportRow, roundPeptides: RoundPeptide[]) {
  const normalizedCode = normalizeBatchMatchText(row.code);
  const normalizedPeptideName = normalizeCoaSearchText(row.peptideName);
  const normalizedBatch = normalizeBatchMatchText(row.batchNumber);

  if (normalizedCode) {
    const codeMatch = roundPeptides.find((peptide) => normalizeBatchMatchText(peptide.vendorCode) === normalizedCode);

    if (codeMatch) {
      return codeMatch;
    }
  }

  if (normalizedBatch) {
    const batchCodeMatch = roundPeptides.find((peptide) => {
      const vendorCode = normalizeBatchMatchText(peptide.vendorCode);
      return vendorCode && normalizedBatch.includes(vendorCode);
    });

    if (batchCodeMatch) {
      return batchCodeMatch;
    }
  }

  if (normalizedPeptideName) {
    return roundPeptides.find((peptide) => normalizeCoaSearchText(peptide.peptideName) === normalizedPeptideName) ?? null;
  }

  return null;
}

function sortRoundPeptidesByVendorCode(rows: RoundPeptide[]) {
  return [...rows].sort((first, second) => {
    const vendorCodeComparison = first.vendorCode.localeCompare(second.vendorCode, undefined, {
      sensitivity: 'base',
      numeric: true,
    });

    if (vendorCodeComparison !== 0) {
      return vendorCodeComparison;
    }

    return first.peptideName.localeCompare(second.peptideName, undefined, { sensitivity: 'base', numeric: true });
  });
}

function createEmptyCoaEditForm(): CoaEditForm {
  return {
    roundId: '',
    roundPeptideId: '',
    batchNumber: '',
    capColor: '',
    code: '',
    dateTested: '',
    lab: '',
    coaNumber: '',
    accessionNumber: '',
    verificationUrl: '',
    averageNetContent: 'Pending',
    purity: 'Pending',
    endotoxins: 'Pending',
    heavyMetals: 'Pending',
    sterility: 'Pending',
    fentanyl: 'Pending',
    file: null,
  };
}

function createCoaEditForm(result: CoaResult): CoaEditForm {
  return {
    roundId: result.roundId,
    roundPeptideId: result.roundPeptideId,
    batchNumber: result.batchNumber,
    capColor: result.capColor,
    code: result.code,
    dateTested: result.dateTested,
    lab: result.lab,
    coaNumber: result.coaNumber,
    accessionNumber: result.accessionNumber,
    verificationUrl: result.verificationUrl,
    averageNetContent: result.averageNetContent,
    purity: result.purity,
    endotoxins: result.endotoxins,
    heavyMetals: result.heavyMetals,
    sterility: result.sterility,
    fentanyl: result.fentanyl,
    file: null,
  };
}

function createCoaEntryFromRoundRow(
  round: Round,
  roundPeptide: RoundPeptide,
  formRow: Pick<CoaBatchFormRow, 'batchNumber' | 'capColor' | 'code'> & { id?: string },
): CoaResult {
  const id = formRow.id && !formRow.id.startsWith('coa-row-')
    ? formRow.id
    : createCoaId(formRow.batchNumber);

  return {
    id,
    roundId: round.id,
    roundName: round.name,
    roundPeptideId: roundPeptide.id,
    peptideId: roundPeptide.peptideId,
    peptideName: roundPeptide.peptideName,
    code: sanitizeClientText(formRow.code || roundPeptide.vendorCode),
    batchNumber: sanitizeClientText(formRow.batchNumber),
    capColor: sanitizeClientText(formRow.capColor) || 'TBD',
    mass: roundPeptide.mass,
    testingTier: roundPeptide.testingTier,
    dateTested: '',
    lab: '',
    coaNumber: '',
    accessionNumber: '',
    verificationUrl: '',
    averageNetContent: 'Pending',
    purity: 'Pending',
    endotoxins: 'Pending',
    heavyMetals: 'Pending',
    sterility: 'Pending',
    fentanyl: 'Pending',
    isResultLocked: false,
    hasRoundPasscode: false,
    lockedResultStates: {},
  };
}

function mergeCoaPdfAsset(entry: CoaResult, asset: Partial<CoaPdfAsset>): CoaResult {
  const parsedCoa = normalizeParsedCoa(asset.parsedCoa);

  if (parsedCoa && !doesParsedCoaMatchEntry(entry, parsedCoa)) {
    throw new Error(`COA PDF lot ${parsedCoa.fields.lotNumber} does not match ${entry.batchNumber}.`);
  }

  const mergedEntry = {
    ...entry,
    ...asset,
    ...(parsedCoa ? { parsedCoa } : {}),
  };

  if (asset.vialImageAssetKey) {
    mergedEntry.vialImageMode = entry.vialImageMode === 'placeholder' ? 'placeholder' : 'extracted';
  }

  return applyParsedCoaFields(mergedEntry, parsedCoa);
}

function applyParsedCoaFields(entry: CoaResult, parsedCoa?: ParsedCoa): CoaResult {
  if (!parsedCoa) {
    return entry;
  }

  const fields = parsedCoa.fields;

  return {
    ...entry,
    lab: fields.lab || entry.lab,
    coaNumber: fields.coaNumber || entry.coaNumber,
    accessionNumber: fields.accessionNumber || entry.accessionNumber,
    dateTested: fields.analysisDate || entry.dateTested,
    verificationUrl: fields.verificationUrl || entry.verificationUrl,
    averageNetContent: fields.averageNetContent || entry.averageNetContent,
    purity: fields.purity || entry.purity,
    endotoxins: normalizeParsedStatus(fields.endotoxins, entry.endotoxins),
    heavyMetals: normalizeParsedStatus(fields.heavyMetals, entry.heavyMetals),
    sterility: normalizeParsedStatus(fields.sterility, entry.sterility),
    fentanyl: normalizeParsedStatus(fields.fentanyl, entry.fentanyl),
  };
}

function doesParsedCoaMatchEntry(entry: CoaResult, parsedCoa: ParsedCoa) {
  const parsedLot = normalizeBatchMatchText(parsedCoa.fields.lotNumber);
  const targetBatch = normalizeBatchMatchText(entry.batchNumber);

  return !parsedLot || !targetBatch || parsedLot === targetBatch;
}

function normalizeParsedStatus(value: string, fallback: string) {
  return value && value !== 'Pending' ? value : fallback;
}

function createParsedCoaStatus(parsedCoa: ParsedCoa | undefined, fallback: string) {
  const warnings = parsedCoa?.warnings ?? [];
  const parserError = parsedCoa?.error ? `Parser error: ${parsedCoa.error}` : '';
  const details = [...warnings.slice(0, 2), parserError].filter(Boolean);

  if (details.length === 0) {
    return fallback;
  }

  return `${fallback} ${details.join(' ')}`;
}

function getCoaErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function findCoaMatchForFile(file: File, results: CoaResult[]) {
  const fileName = normalizeBatchMatchText(file.name.replace(/\.pdf$/i, ''));

  return results.find((result) => {
    const batch = normalizeBatchMatchText(result.batchNumber);
    return batch && fileName.includes(batch);
  }) ?? null;
}

function findCoaMatchForBatchNumber(batchNumber: string, results: CoaResult[]) {
  const targetBatch = normalizeBatchMatchText(batchNumber);

  return results.find((result) => (
    targetBatch && normalizeBatchMatchText(result.batchNumber) === targetBatch
  )) ?? null;
}

function normalizeBatchMatchText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizeClientNumber(value: unknown) {
  const number = Number(value);

  return Number.isFinite(number) ? number : 0;
}

function normalizeClientStringList(value: unknown) {
  return Array.isArray(value)
    ? value.map(sanitizeClientText).filter(Boolean).slice(0, 12)
    : [];
}

function normalizeClientStringRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, recordValue]) => [sanitizeClientText(key), sanitizeClientText(recordValue)])
      .filter(([key, recordValue]) => key && recordValue)
      .slice(0, 8),
  );
}

function sanitizeClientText(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(result.includes(',') ? result.split(',')[1] : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('File could not be read.'));
    reader.readAsDataURL(file);
  });
}

function getCoaStatusClassName(value: string) {
  const normalizedValue = value.trim().toLowerCase();

  if (normalizedValue === 'pass') {
    return 'coa-pill coa-pill--pass';
  }

  if (normalizedValue === 'pending') {
    return 'coa-pill coa-pill--pending';
  }

  return 'coa-pill coa-pill--review';
}

function getCoaCapSwatchColor(capColor: string) {
  const normalizedColor = capColor.trim().toLowerCase();
  const swatches: Record<string, string> = {
    black: '#111827',
    blue: '#2f80ed',
    clear: '#dbe5ec',
    copper: '#b96b3d',
    gray: '#8a95a3',
    green: '#16a873',
    orange: '#f08a24',
    purple: '#8b5cf6',
    red: '#e5484d',
    silver: '#c8d0d8',
    white: '#ffffff',
    yellow: '#f6cf45',
  };

  return swatches[normalizedColor] ?? '#cbd5e1';
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

async function fetchAccountSession(): Promise<AccountSession> {
  const response = await fetch('/api/account/session', {
    credentials: 'same-origin',
  });

  if (!response.ok) {
    return signedOutAccountSession;
  }

  return normalizeAccountSession(await response.json());
}

async function logoutAccountSession() {
  const response = await fetch('/api/account/logout', {
    method: 'POST',
    credentials: 'same-origin',
  });

  if (!response.ok) {
    throw new Error('Account logout failed.');
  }
}

function normalizeAccountSession(value: unknown): AccountSession {
  if (!value || typeof value !== 'object') {
    return signedOutAccountSession;
  }

  const session = value as AccountSession;

  return {
    ...session,
    isAuthenticated: session.isAuthenticated === true,
  };
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

function resolveClientAdminSession(
  accountSession: AccountSession,
  fallbackSession: AdminSession,
): AdminSession {
  const account = accountSession.account;

  if (
    account?.status === 'active'
    && (account.role === 'admin' || account.role === 'owner')
  ) {
    return { isAuthenticated: true, role: account.role };
  }

  return fallbackSession;
}

export default App;
