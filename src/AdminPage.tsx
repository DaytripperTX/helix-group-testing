import { type ChangeEvent, type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  sortRoundsForDisplay,
  type Round,
  type RoundPeptide,
  type RoundPriceListSnapshot,
  type TestingTierId,
} from './rounds';

type AdminSession = {
  isAuthenticated: boolean;
  role?: 'owner' | 'admin';
};

type AdminRole = 'owner' | 'admin';
type AdminTab = 'vendors' | 'rounds' | 'peptides' | 'notes' | 'labels';

type VendorPriceSheet =
  | { type: 'google-sheet'; url: string }
  | { type: 'file'; fileName: string; mimeType: string; blobKey: string };

type Vendor = {
  id: string;
  name: string;
  nickname: string;
  whatsapp: string;
  description: string;
  negotiatedDiscount: string;
  priceSheet?: VendorPriceSheet;
};

type VendorPriceListItem = {
  id: string;
  vendorCode: string;
  productName: string;
  mass: string;
  price: number | null;
  vialsPerPack: number;
  peptideIds: string[];
  needsReview?: boolean;
};

type VendorPriceList = {
  id: string;
  vendorId: string;
  vendorName: string;
  source:
    | VendorPriceSheet
    | { type: 'file'; fileName: string; mimeType: string; base64?: string };
  items: VendorPriceListItem[];
  parsedAt: string;
};

type WikiSource = 'peptidepedia' | 'pep-pedia' | 'other';
type WikiStatus = 'verified' | 'suggested' | 'manual';

type WikiLink = {
  source: WikiSource;
  url: string;
  status: WikiStatus;
};

type Peptide = {
  id: string;
  name: string;
  categories: string[];
  description?: string;
  wikiLinks?: WikiLink[];
  peptidepediaUrl?: string;
};

type PeptideCategory = {
  id: string;
  name: string;
};

type VendorForm = {
  name: string;
  nickname: string;
  whatsapp: string;
  description: string;
  negotiatedDiscount: string;
  priceSheetMode: 'none' | 'google-sheet' | 'file';
  priceSheetUrl: string;
  priceSheetFile: File | null;
};

type PeptideForm = {
  name: string;
  categories: string;
  description: string;
  wikiLinks: WikiLink[];
};

type BatchPeptideRow = Peptide & {
  rowNumber: number;
  errors: string[];
};

type RoundPeptideBatchRow = RoundPeptide & {
  rowNumber: number;
  errors: string[];
};

type PeptideTransfer = {
  version: number;
  collection: 'peptides';
  exportedAt: string;
  items: Peptide[];
};

type AdminNote = {
  id: string;
  sender: string;
  subject: string;
  body: string;
  tags: AdminRole[];
  createdAt: string;
};

type AdminNoteForm = {
  sender: string;
  subject: string;
  body: string;
  tags: AdminRole[];
};

type RoundPriceSourceMode = 'none' | 'vendor-default' | 'round-override';

type RoundForm = {
  name: string;
  status: string;
  vendorId: string;
  isCurrent: boolean;
  startDate: string;
  endDate: string;
  targetWindow: string;
  participants: string;
  roundDiscountPercent: string;
  priceSourceMode: RoundPriceSourceMode;
  priceListSnapshot: RoundPriceListSnapshot | null;
  peptides: RoundPeptide[];
};

type RoundPeptideSortKey =
  | 'peptideName'
  | 'vendorCode'
  | 'vendorPrice'
  | 'mass'
  | 'testingTier'
  | 'additionalTesting'
  | 'batchConformity'
  | 'capColor'
  | 'participantCount'
  | 'totalOrdered'
  | 'notes';

type RoundPeptideSort = {
  key: RoundPeptideSortKey;
  direction: 'asc' | 'desc';
};

const emptyVendorForm: VendorForm = {
  name: '',
  nickname: '',
  whatsapp: '',
  description: '',
  negotiatedDiscount: '',
  priceSheetMode: 'none',
  priceSheetUrl: '',
  priceSheetFile: null,
};

const emptyPeptideForm: PeptideForm = {
  name: '',
  categories: '',
  description: '',
  wikiLinks: createDefaultWikiLinks(),
};

const emptyAdminNoteForm: AdminNoteForm = {
  sender: '',
  subject: '',
  body: '',
  tags: [],
};

const emptyRoundForm: RoundForm = {
  name: '',
  status: 'Collecting signups',
  vendorId: '',
  isCurrent: false,
  startDate: '',
  endDate: '',
  targetWindow: '',
  participants: '',
  roundDiscountPercent: '',
  priceSourceMode: 'none',
  priceListSnapshot: null,
  peptides: [],
};

const testingTierOptions: { id: TestingTierId; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'platinum', label: 'Platinum' },
  { id: 'gold', label: 'Gold' },
  { id: 'gold-plus', label: 'Gold+' },
  { id: 'bronze', label: 'Bronze' },
];

const testingTierSummaryOptions: { id: TestingTierId; label: string }[] = [
  { id: 'platinum', label: 'Platinum' },
  { id: 'gold-plus', label: 'Gold+' },
  { id: 'gold', label: 'Gold' },
  { id: 'bronze', label: 'Bronze' },
  { id: 'none', label: 'None' },
];

function AdminPage({
  session,
  loginRole,
  onSessionChange,
  onNavigate,
}: {
  session: AdminSession;
  loginRole: AdminRole;
  onSessionChange: (session: AdminSession) => void;
  onNavigate: (path: string) => void;
}) {
  const [password, setPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [status, setStatus] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<AdminTab>('vendors');
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [peptides, setPeptides] = useState<Peptide[]>([]);
  const [adminNotes, setAdminNotes] = useState<AdminNote[]>([]);
  const [peptideCategories, setPeptideCategories] = useState<PeptideCategory[]>([]);
  const [priceLists, setPriceLists] = useState<VendorPriceList[]>([]);
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);
  const [vendorForm, setVendorForm] = useState<VendorForm>(emptyVendorForm);
  const [isVendorModalOpen, setIsVendorModalOpen] = useState(false);
  const [editingPeptide, setEditingPeptide] = useState<Peptide | null>(null);
  const [peptideForm, setPeptideForm] = useState<PeptideForm>(emptyPeptideForm);
  const [isPeptideModalOpen, setIsPeptideModalOpen] = useState(false);
  const [editingRound, setEditingRound] = useState<Round | null>(null);
  const [roundForm, setRoundForm] = useState<RoundForm>(emptyRoundForm);
  const [roundPeptideSort, setRoundPeptideSort] = useState<RoundPeptideSort | null>(null);
  const [isRoundModalOpen, setIsRoundModalOpen] = useState(false);
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  const [isNoteModalOpen, setIsNoteModalOpen] = useState(false);
  const [batchRows, setBatchRows] = useState<BatchPeptideRow[]>([]);
  const [noteForm, setNoteForm] = useState<AdminNoteForm>(emptyAdminNoteForm);
  const [batchStatus, setBatchStatus] = useState('');
  const [wikiStatus, setWikiStatus] = useState('');
  const [priceListVendor, setPriceListVendor] = useState<Vendor | null>(null);
  const [priceListDraft, setPriceListDraft] = useState<VendorPriceList | null>(null);
  const [priceListFile, setPriceListFile] = useState<File | null>(null);
  const [priceListUrl, setPriceListUrl] = useState('');
  const [priceListStatus, setPriceListStatus] = useState('');
  const [roundPriceListFile, setRoundPriceListFile] = useState<File | null>(null);
  const [roundPriceListUrl, setRoundPriceListUrl] = useState('');
  const [roundPriceListStatus, setRoundPriceListStatus] = useState('');
  const priceListFileInputRef = useRef<HTMLInputElement | null>(null);
  const roundPriceListFileInputRef = useRef<HTMLInputElement | null>(null);
  const roundPeptideImportInputRef = useRef<HTMLInputElement | null>(null);
  const peptideImportInputRef = useRef<HTMLInputElement | null>(null);
  const [savedPriceListVendorId, setSavedPriceListVendorId] = useState('');
  const vendorGoogleSheetUrlError =
    vendorForm.priceSheetMode === 'google-sheet' ? validateGoogleSheetSourceInput(vendorForm.priceSheetUrl) : '';

  useEffect(() => {
    if (!session.isAuthenticated) {
      return;
    }

    void refreshAdminData();
  }, [session.isAuthenticated]);

  useEffect(() => {
    if (!savedPriceListVendorId) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => setSavedPriceListVendorId(''), 4000);
    return () => window.clearTimeout(timeoutId);
  }, [savedPriceListVendorId]);

  const sortedVendors = useMemo(
    () => [...vendors].sort((first, second) => first.name.localeCompare(second.name)),
    [vendors],
  );
  const sortedPeptides = useMemo(
    () => [...peptides].sort((first, second) => first.name.localeCompare(second.name)),
    [peptides],
  );
  const sortedRounds = useMemo(
    () => sortRoundsForDisplay(rounds),
    [rounds],
  );
  const sortedRoundPeptideRows = useMemo(
    () => sortRoundPeptideRows(roundForm.peptides, roundPeptideSort),
    [roundForm.peptides, roundPeptideSort],
  );
  const sortedAdminNotes = useMemo(
    () => [...adminNotes].sort((first, second) => new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime()),
    [adminNotes],
  );

  const refreshAdminData = async () => {
    const [nextVendors, nextRounds, nextPeptides, nextPriceLists, nextPeptideCategories, nextAdminNotes] = await Promise.all([
      fetchCollection<Vendor>('vendors'),
      fetchCollection<Round>('rounds'),
      fetchCollection<Peptide>('peptides'),
      fetchCollection<VendorPriceList>('vendor-price-lists'),
      fetchCollection<PeptideCategory>('peptide-categories'),
      fetchCollection<AdminNote>('admin-notes'),
    ]);

    setVendors(nextVendors);
    setRounds(nextRounds);
    setPeptides(nextPeptides);
    setPriceLists(nextPriceLists);
    setPeptideCategories(nextPeptideCategories);
    setAdminNotes(nextAdminNotes);
  };

  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setStatus('');

    try {
      const nextSession = await loginAdmin(password, loginRole);

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

  const openNewVendorModal = () => {
    setEditingVendor(null);
    setVendorForm(emptyVendorForm);
    setIsVendorModalOpen(true);
    setStatus('');
  };

  const openEditVendorModal = (vendor: Vendor) => {
    setEditingVendor(vendor);
    setVendorForm({
      name: vendor.name,
      nickname: vendor.nickname,
      whatsapp: vendor.whatsapp,
      description: vendor.description,
      negotiatedDiscount: vendor.negotiatedDiscount,
      priceSheetMode: vendor.priceSheet?.type ?? 'none',
      priceSheetUrl: vendor.priceSheet?.type === 'google-sheet' ? vendor.priceSheet.url : '',
      priceSheetFile: null,
    });
    setIsVendorModalOpen(true);
    setStatus('');
  };

  const saveVendor = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const name = titleCase(sanitizeText(vendorForm.name));

    if (!name) {
      setStatus('Vendor name is required.');
      return;
    }

    if (vendorGoogleSheetUrlError) {
      setStatus(vendorGoogleSheetUrlError);
      return;
    }

    setIsSubmitting(true);

    try {
      const existingVendor = findByNormalizedName(vendors, name);
      const id = editingVendor?.id ?? existingVendor?.id ?? createUniqueId(name, vendors);
      const priceSheet = await resolveVendorPriceSheet(editingVendor, vendorForm);
      const vendor: Vendor = {
        id,
        name,
        nickname: sanitizeText(vendorForm.nickname),
        whatsapp: sanitizeText(vendorForm.whatsapp),
        description: sanitizeText(vendorForm.description),
        negotiatedDiscount: formatVendorDiscountInput(vendorForm.negotiatedDiscount),
        ...(priceSheet ? { priceSheet } : {}),
      };

      const nextVendors = await saveCollectionItem<Vendor>('vendors', vendor);

      setVendors(nextVendors);
      setIsVendorModalOpen(false);
      setStatus('Vendor saved.');
    } catch (error) {
      console.error(error);
      setStatus('Vendor could not be saved.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const deleteVendor = async (vendor: Vendor) => {
    if (!window.confirm(`Delete vendor "${vendor.name}"? This cannot be undone.`)) {
      return;
    }

    try {
      setVendors(await deleteCollectionItem<Vendor>('vendors', vendor.id));
      setStatus('Vendor deleted.');
    } catch (error) {
      console.error(error);
      setStatus('Vendor could not be deleted.');
    }
  };

  const openPriceListModal = (vendor: Vendor) => {
    const existingPriceList = priceLists.find((priceList) => priceList.vendorId === vendor.id) ?? null;

    setPriceListVendor(vendor);
    setPriceListDraft(existingPriceList);
    setPriceListFile(null);
    setPriceListUrl(vendor.priceSheet?.type === 'google-sheet' ? vendor.priceSheet.url : '');
    setPriceListStatus(
      existingPriceList
        ? `${existingPriceList.items.length} saved rows.`
        : 'Upload a price sheet or use a public Google Sheet link to parse a preview.',
    );
  };

  const parseVendorPriceList = async (override?: { file?: File | null; url?: string }) => {
    if (!priceListVendor) {
      return;
    }

    const source = await getPriceListParseSource(
      override?.file === undefined ? priceListFile : override.file,
      override?.url === undefined ? priceListUrl : override.url,
    );

    if (!source) {
      setPriceListStatus('Choose a file or enter a Google Sheet URL first.');
      return;
    }

    setIsSubmitting(true);
    setPriceListStatus('Parsing price list...');

    try {
      const parsedPriceList = await parseVendorPriceListSource(
        priceListVendor,
        source,
      );

      setPriceListDraft(parsedPriceList);
      setPriceListStatus(`${parsedPriceList.items.length} rows parsed. Review before saving.`);
    } catch (error) {
      console.error(error);
      setPriceListStatus('Price list could not be parsed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const updatePriceListItem = (
    itemId: string,
    field: keyof Pick<VendorPriceListItem, 'vendorCode' | 'productName' | 'mass' | 'price' | 'vialsPerPack'>,
    value: string,
  ) => {
    setPriceListDraft((currentDraft) => {
      if (!currentDraft) {
        return currentDraft;
      }

      return {
        ...currentDraft,
        items: currentDraft.items.map((item) =>
          item.id === itemId
            ? {
                ...item,
                [field]:
                  field === 'price'
                    ? parseNullableNumber(value)
                    : field === 'vialsPerPack'
                      ? Math.max(1, Math.trunc(parseNullableNumber(value) ?? 10))
                      : value,
                ...(field === 'productName' ? { peptideIds: matchPeptideIds(value, peptides) } : {}),
                ...(field === 'price' ? { needsReview: parseNullableNumber(value) === null } : {}),
              }
            : item,
        ),
      };
    });
  };

  const removePriceListItem = (itemId: string) => {
    setPriceListDraft((currentDraft) =>
      currentDraft
        ? {
            ...currentDraft,
            items: currentDraft.items.filter((item) => item.id !== itemId),
          }
        : currentDraft,
    );
  };

  const updatePriceListItemPeptide = (itemId: string, peptideId: string) => {
    setPriceListDraft((currentDraft) =>
      currentDraft
        ? {
            ...currentDraft,
            items: currentDraft.items.map((item) =>
              item.id === itemId
                ? {
                    ...item,
                    peptideIds: peptideId ? [peptideId] : [],
                  }
                : item,
            ),
          }
        : currentDraft,
    );
  };

  const saveVendorPriceList = async () => {
    if (!priceListDraft) {
      setPriceListStatus('Parse or load a price list before saving.');
      return;
    }

    setIsSubmitting(true);

    try {
      const savedSource =
        priceListDraft.source.type === 'file' && !('blobKey' in priceListDraft.source) && priceListFile
          ? await uploadVendorPriceSheetFile(priceListFile)
          : priceListDraft.source;
      const nextDraft = {
        ...priceListDraft,
        source: savedSource,
      };
      const nextPriceLists = await saveCollectionItem<VendorPriceList>('vendor-price-lists', nextDraft);
      const currentVendor = vendors.find((vendor) => vendor.id === priceListDraft.vendorId) ?? priceListVendor;
      let nextVendors = vendors;

      if (currentVendor && isVendorPriceSheetSource(savedSource)) {
        const nextVendor = {
          ...currentVendor,
          priceSheet: savedSource,
        };
        nextVendors = await saveCollectionItem<Vendor>('vendors', nextVendor);
        setVendors(nextVendors);
        setPriceListVendor(nextVendor);
      }

      setPriceLists(nextPriceLists);
      setPriceListDraft(nextDraft);
      setPriceListStatus('');
      setPriceListFile(null);
      setPriceListVendor(null);
      setSavedPriceListVendorId(priceListDraft.vendorId);
      setStatus('');
    } catch (error) {
      console.error(error);
      setPriceListStatus('Price list could not be saved.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const refreshPriceListPeptideLinks = () => {
    setPriceListDraft((currentDraft) =>
      currentDraft
        ? {
            ...currentDraft,
            items: currentDraft.items.map((item) => ({
              ...item,
              peptideIds: matchPeptideIds(item.productName, peptides),
            })),
          }
        : currentDraft,
    );
    setPriceListStatus('Peptide links refreshed from the current dictionary.');
  };

  const deleteVendorPriceList = async () => {
    if (!priceListVendor || !priceListDraft) {
      return;
    }

    if (!window.confirm(`Delete the saved price list for "${priceListVendor.name}"? This cannot be undone.`)) {
      return;
    }

    setIsSubmitting(true);

    try {
      const nextPriceLists = await deleteCollectionItem<VendorPriceList>('vendor-price-lists', priceListDraft.id);

      setPriceLists(nextPriceLists);
      setPriceListDraft(null);
      setPriceListFile(null);
      setPriceListUrl('');
      setPriceListStatus('Saved price list deleted.');
    } catch (error) {
      console.error(error);
      setPriceListStatus('Price list could not be deleted.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const openNewRoundModal = () => {
    setEditingRound(null);
    setRoundForm({
      ...emptyRoundForm,
      name: createNextRoundName(rounds),
    });
    setRoundPriceListFile(null);
    setRoundPriceListUrl('');
    setRoundPriceListStatus('');
    setIsRoundModalOpen(true);
    setStatus('');
  };

  const openEditRoundModal = (round: Round) => {
    setEditingRound(round);
    setRoundForm({
      name: round.name,
      status: round.status,
      vendorId: round.vendorId,
      isCurrent: round.isCurrent,
      startDate: round.startDate,
      endDate: round.endDate,
      targetWindow: round.targetWindow,
      participants: String(round.participants || ''),
      roundDiscountPercent: String(round.roundDiscountPercent || ''),
      priceSourceMode: round.priceSourceMode,
      priceListSnapshot: round.priceListSnapshot,
      peptides: round.peptides,
    });
    setRoundPriceListFile(null);
    setRoundPriceListUrl(round.priceListSnapshot?.source?.type === 'google-sheet' ? round.priceListSnapshot.source.url : '');
    setRoundPriceListStatus(
      round.priceListSnapshot
        ? `${round.priceListSnapshot.items.length} price rows in this round snapshot.`
        : 'Use the default vendor list, parse a round-specific sheet, or enter rows manually.',
    );
    setIsRoundModalOpen(true);
    setStatus('');
  };

  const updateRoundVendor = (vendorId: string) => {
    setRoundForm((currentForm) => ({
      ...currentForm,
      vendorId,
      priceSourceMode: currentForm.priceSourceMode === 'vendor-default' ? 'vendor-default' : currentForm.priceSourceMode,
      priceListSnapshot:
        currentForm.priceSourceMode === 'vendor-default'
          ? getSavedVendorPriceListSnapshot(priceLists, vendorId)
          : currentForm.priceListSnapshot,
    }));
  };

  const updateRoundPriceSourceMode = (priceSourceMode: RoundPriceSourceMode) => {
    setRoundForm((currentForm) => ({
      ...currentForm,
      priceSourceMode,
      priceListSnapshot:
        priceSourceMode === 'vendor-default'
          ? getSavedVendorPriceListSnapshot(priceLists, currentForm.vendorId)
          : priceSourceMode === 'none'
            ? null
            : currentForm.priceListSnapshot,
    }));
    setRoundPriceListStatus(
      priceSourceMode === 'vendor-default'
        ? 'Using a snapshot of the default vendor price list.'
        : priceSourceMode === 'round-override'
          ? 'Parse a round-specific file or Google Sheet.'
          : '',
    );
  };

  const parseRoundPriceList = async (override?: { file?: File | null; url?: string }) => {
    const vendor = vendors.find((currentVendor) => currentVendor.id === roundForm.vendorId);

    if (!vendor) {
      setRoundPriceListStatus('Choose a vendor before parsing a price sheet.');
      return;
    }

    const source = await getPriceListParseSource(
      override?.file === undefined ? roundPriceListFile : override.file,
      override?.url === undefined ? roundPriceListUrl : override.url,
    );

    if (!source) {
      setRoundPriceListStatus('Choose a file or enter a Google Sheet URL first.');
      return;
    }

    setIsSubmitting(true);
    setRoundPriceListStatus('Parsing round price list...');

    try {
      const parsedPriceList = await parseVendorPriceListSource(vendor, source);
      const snapshot = toRoundPriceListSnapshot(parsedPriceList);

      setRoundForm((currentForm) => ({
        ...currentForm,
        priceSourceMode: 'round-override',
        priceListSnapshot: snapshot,
      }));
      setRoundPriceListStatus(`${snapshot.items.length} rows parsed for this round.`);
    } catch (error) {
      console.error(error);
      setRoundPriceListStatus('Round price list could not be parsed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const addRoundPeptideRow = () => {
    setRoundForm((currentForm) => ({
      ...currentForm,
      peptides: [...currentForm.peptides, createRoundPeptideRow(currentForm.peptides)],
    }));
  };

  const beginRoundPeptideImport = () => {
    roundPeptideImportInputRef.current?.click();
  };

  const importRoundPeptides = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
      return;
    }

    setIsSubmitting(true);
    setRoundPriceListStatus('Importing peptide rows...');

    try {
      const rows = await parseRoundPeptideBatchFile(file, roundForm.priceListSnapshot?.items ?? [], roundForm.peptides);
      const validRows = rows.filter((row) => row.errors.length === 0).map(stripRoundPeptideBatchFields);

      if (validRows.length === 0) {
        setRoundPriceListStatus('No valid peptide rows found.');
        return;
      }

      setRoundForm((currentForm) => ({
        ...currentForm,
        peptides: [...currentForm.peptides, ...validRows],
      }));
      setRoundPriceListStatus(`${validRows.length} peptide rows imported.`);
    } catch (error) {
      console.error(error);
      setRoundPriceListStatus('Peptide rows could not be imported.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const duplicateRoundPeptideRow = (row: RoundPeptide) => {
    setRoundForm((currentForm) => ({
      ...currentForm,
      peptides: insertAfterRoundPeptide(currentForm.peptides, row.id, {
        ...row,
        id: createUniqueId(`${row.id}-copy`, currentForm.peptides),
      }),
    }));
  };

  const removeRoundPeptideRow = (rowId: string) => {
    setRoundForm((currentForm) => ({
      ...currentForm,
      peptides: currentForm.peptides.filter((row) => row.id !== rowId),
    }));
  };

  const updateRoundPeptideRow = (rowId: string, fields: Partial<RoundPeptide>) => {
    setRoundForm((currentForm) => ({
      ...currentForm,
      peptides: currentForm.peptides.map((row) => (row.id === rowId ? { ...row, ...fields } : row)),
    }));
  };

  const updateRoundPeptideSort = (key: RoundPeptideSortKey) => {
    setRoundPeptideSort((currentSort) => ({
      key,
      direction: currentSort?.key === key
        ? currentSort.direction === 'asc' ? 'desc' : 'asc'
        : getDefaultRoundPeptideSortDirection(key),
    }));
  };

  const applyPriceListItemToRoundRow = (rowId: string, priceListItemId: string) => {
    const item = roundForm.priceListSnapshot?.items.find((currentItem) => currentItem.id === priceListItemId);

    if (!item) {
      updateRoundPeptideRow(rowId, {
        priceListItemId: '',
        vendorCode: '',
      });
      return;
    }

    const linkedPeptide = item.peptideIds.length > 0
      ? peptides.find((peptide) => peptide.id === item.peptideIds[0])
      : null;

    updateRoundPeptideRow(rowId, {
      priceListItemId: item.id,
      vendorCode: item.vendorCode,
      peptideId: linkedPeptide?.id ?? '',
      peptideName: linkedPeptide?.name ?? item.productName,
      mass: item.mass,
      vendorPrice: item.price,
      vendorPriceOverridden: false,
    });
  };

  const saveRound = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const name = sanitizeText(roundForm.name);

    if (!name) {
      setStatus('Round name is required.');
      return;
    }

    setIsSubmitting(true);

    try {
      const existingRound = findByNormalizedName(rounds, name);
      const id = editingRound?.id ?? existingRound?.id ?? createUniqueId(name, rounds);
      const now = new Date().toISOString();
      const priceListSnapshot = await resolveRoundPriceListSnapshot(roundForm, roundPriceListFile);
      const round: Round = {
        id,
        name,
        status: sanitizeText(roundForm.status),
        vendorId: roundForm.vendorId,
        isCurrent: roundForm.isCurrent,
        priceSourceMode: roundForm.priceSourceMode,
        startDate: roundForm.startDate,
        endDate: roundForm.endDate,
        targetWindow: sanitizeText(roundForm.targetWindow),
        participants: Math.max(0, Math.trunc(parseNullableNumber(roundForm.participants) ?? 0)),
        roundDiscountPercent: Math.min(100, Math.max(0, parseNullableNumber(roundForm.roundDiscountPercent) ?? 0)),
        priceListSnapshot,
        peptides: roundForm.peptides.map(normalizeRoundPeptideFormRow),
        createdAt: editingRound?.createdAt || now,
        updatedAt: now,
      };

      const nextRounds = await saveCollectionItem<Round>('rounds', round);

      setRounds(nextRounds);
      setIsRoundModalOpen(false);
      setStatus('Round saved.');
    } catch (error) {
      console.error(error);
      setStatus('Round could not be saved.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const deleteRound = async (round: Round) => {
    if (!window.confirm(`Delete round "${round.name}"? This cannot be undone.`)) {
      return;
    }

    try {
      setRounds(await deleteCollectionItem<Round>('rounds', round.id));
      setStatus('Round deleted.');
    } catch (error) {
      console.error(error);
      setStatus('Round could not be deleted.');
    }
  };

  const openNewPeptideModal = () => {
    setEditingPeptide(null);
    setPeptideForm(createEmptyPeptideForm());
    setWikiStatus('');
    setIsPeptideModalOpen(true);
    setStatus('');
  };

  const openEditPeptideModal = (peptide: Peptide) => {
    setEditingPeptide(peptide);
    setPeptideForm({
      name: peptide.name,
      categories: peptide.categories.join(', '),
      description: peptide.description ?? '',
      wikiLinks: createWikiLinkFormRows(peptide),
    });
    setWikiStatus('');
    setIsPeptideModalOpen(true);
    setStatus('');
  };

  const savePeptide = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const name = normalizePeptideName(peptideForm.name);

    if (!name) {
      setStatus('Peptide name is required.');
      return;
    }

    const existingPeptide = findByNormalizedName(peptides, name);

    if (editingPeptide && existingPeptide && existingPeptide.id !== editingPeptide.id) {
      setStatus('A different peptide already uses that name.');
      return;
    }

    setIsSubmitting(true);

    try {
      const id = editingPeptide?.id ?? existingPeptide?.id ?? createUniqueId(name, peptides);
      const normalizedCategories = normalizeCategories(peptideForm.categories);
      const nextPeptideCategories = await ensurePeptideCategories(normalizedCategories, peptideCategories);
      const peptide: Peptide = {
        id,
        name,
        categories: normalizedCategories,
        description: sanitizeText(peptideForm.description),
        wikiLinks: normalizeWikiLinks({ wikiLinks: peptideForm.wikiLinks }),
      };

      const nextPeptides = await saveCollectionItem<Peptide>('peptides', peptide);

      setPeptides(nextPeptides);
      setPeptideCategories(nextPeptideCategories);
      setIsPeptideModalOpen(false);
      setStatus('Peptide saved.');
    } catch (error) {
      console.error(error);
      setStatus('Peptide could not be saved.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const deletePeptide = async (peptide: Peptide) => {
    if (!window.confirm(`Delete peptide "${peptide.name}"? This cannot be undone.`)) {
      return;
    }

    try {
      setPeptides(await deleteCollectionItem<Peptide>('peptides', peptide.id));
      setStatus('Peptide deleted.');
    } catch (error) {
      console.error(error);
      setStatus('Peptide could not be deleted.');
    }
  };

  const fillMissingWikiLinksForPeptides = async () => {
    const candidates = peptides.filter((peptide) => {
      const links = normalizeWikiLinks(peptide);

      return !links.some((link) => link.source === 'peptidepedia') || !links.some((link) => link.source === 'pep-pedia');
    });

    if (candidates.length === 0) {
      setStatus('All peptides already have primary wiki links.');
      return;
    }

    setIsSubmitting(true);
    setStatus(`Searching wiki links for ${candidates.length} peptides...`);

    try {
      let nextPeptides = peptides;
      let updatedCount = 0;

      for (const peptide of candidates) {
        const match = await searchWikiLinks(peptide.name);

        if (!match) {
          continue;
        }

        const wikiLinks = mergeWikiLinks(normalizeWikiLinks(peptide), match.wikiLinks);
        const changed = JSON.stringify(wikiLinks) !== JSON.stringify(normalizeWikiLinks(peptide));

        if (!changed) {
          continue;
        }

        nextPeptides = await saveCollectionItem<Peptide>('peptides', {
          ...peptide,
          wikiLinks,
        });
        updatedCount += 1;
      }

      setPeptides(nextPeptides);
      setStatus(updatedCount > 0 ? `Wiki links updated for ${updatedCount} peptides.` : 'No new wiki links found.');
    } catch (error) {
      console.error(error);
      setStatus('Batch wiki link search failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateWikiLink = (index: number, field: keyof WikiLink, value: string) => {
    setPeptideForm((currentForm) => {
      const wikiLinks = currentForm.wikiLinks.map((link, currentIndex) => {
        if (currentIndex !== index) {
          return link;
        }

        const nextLink = {
          ...link,
          [field]: value,
        };

        if (field === 'url') {
          return {
            ...nextLink,
            source: inferWikiSourceFromUrl(value),
          };
        }

        return nextLink;
      });

      return { ...currentForm, wikiLinks };
    });
  };

  const addWikiLink = () => {
    setPeptideForm((currentForm) => ({
      ...currentForm,
      wikiLinks: [
        ...currentForm.wikiLinks,
        createWikiLink({ source: 'other', status: 'manual', url: '' }),
      ],
    }));
  };

  const removeWikiLink = (index: number) => {
    setPeptideForm((currentForm) => {
      const wikiLinks = currentForm.wikiLinks.filter((_, currentIndex) => currentIndex !== index);

      return {
        ...currentForm,
        wikiLinks: wikiLinks.length > 0 ? wikiLinks : [createWikiLink({ source: 'other', status: 'manual', url: '' })],
      };
    });
  };

  const autofillWikiLinks = async () => {
    const name = peptideForm.name.trim();

    if (!name) {
      setWikiStatus('Enter a peptide name first.');
      return;
    }

    setWikiStatus('Searching wiki sources...');

    try {
      const match = await searchWikiLinks(name);

      if (!match) {
        setWikiStatus('No wiki match found.');
        return;
      }

      setPeptideForm((currentForm) => ({
        ...currentForm,
        wikiLinks: mergeWikiLinks(currentForm.wikiLinks, match.wikiLinks),
        categories: mergeCategoryText(currentForm.categories, match.categories ?? [], peptideCategories),
      }));
      const suggestedLinks = match.wikiLinks.filter((link) => link.status === 'suggested');
      const categoryText = match.categories?.length
        ? ` Categories suggested: ${match.categories.join(', ')}.`
        : '';
      const warningText = suggestedLinks.length > 0
        ? ' Suggested wiki links should be verified before trusting.'
        : '';

      setWikiStatus(`Matched ${match.name}.${categoryText}${warningText}`);
    } catch {
      setWikiStatus('Wiki search failed.');
    }
  };

  const openNewNoteModal = () => {
    setNoteForm({
      ...emptyAdminNoteForm,
      sender: session.role === 'owner' ? 'Owner' : 'Admin',
    });
    setStatus('');
    setIsNoteModalOpen(true);
  };

  const saveAdminNote = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const sender = sanitizeText(noteForm.sender);
    const subject = sanitizeText(noteForm.subject);
    const body = noteForm.body.trim();

    if (!sender || !subject || !body) {
      setStatus('Sender, subject, and note are required.');
      return;
    }

    setIsSubmitting(true);

    try {
      const createdAt = new Date().toISOString();
      const note: AdminNote = {
        id: createUniqueId(`${subject}-${createdAt}`, adminNotes),
        sender,
        subject,
        body,
        tags: normalizeNoteTags(noteForm.tags),
        createdAt,
      };

      const nextNotes = await saveCollectionItem<AdminNote>('admin-notes', note);

      setAdminNotes(nextNotes);
      setIsNoteModalOpen(false);
      setStatus('Note saved.');
    } catch (error) {
      console.error(error);
      setStatus('Note could not be saved.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const loadPeptideBatch = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setIsSubmitting(true);
    setBatchStatus('Reading spreadsheet...');

    try {
      const rows = await parsePeptideBatchFile(file);

      setBatchRows(rows);
      setBatchStatus(`${rows.length} rows ready for review.`);
    } catch (error) {
      console.error(error);
      setBatchRows([]);
      setBatchStatus('Could not read that spreadsheet.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const savePeptideBatch = async () => {
    const seenNames = new Set<string>();
    const validRows = batchRows.filter((row) => {
      if (row.errors.length > 0) {
        return false;
      }

      const normalizedRowName = normalizeName(row.name);

      if (seenNames.has(normalizedRowName)) {
        return false;
      }

      seenNames.add(normalizedRowName);
      return true;
    });

    if (validRows.length === 0) {
      setBatchStatus('No valid rows to save.');
      return;
    }

    setIsSubmitting(true);

    try {
      let nextPeptides = peptides;
      let nextPeptideCategories = peptideCategories;

      for (const row of validRows) {
        const existingPeptide = findByNormalizedName(nextPeptides, row.name);
        nextPeptideCategories = await ensurePeptideCategories(row.categories, nextPeptideCategories);
        const peptide = {
          id: existingPeptide?.id ?? row.id,
          name: normalizePeptideName(row.name),
          categories: row.categories,
          description: row.description ?? '',
          wikiLinks: normalizeWikiLinks(row),
        };

        nextPeptides = await saveCollectionItem<Peptide>('peptides', peptide);
      }

      setPeptides(nextPeptides);
      setPeptideCategories(nextPeptideCategories);
      setIsBatchModalOpen(false);
      setBatchRows([]);
      setBatchStatus('');
      setStatus(`${validRows.length} peptide rows saved.`);
    } catch (error) {
      console.error(error);
      setBatchStatus('Batch save failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const exportPeptides = async (fileName = createPeptideExportFileName()) => {
    setIsSubmitting(true);

    try {
      const transfer = await exportPeptideTransfer();

      downloadJson(transfer, fileName);
      setStatus(`${transfer.items.length} peptides exported.`);
      return transfer;
    } catch (error) {
      console.error(error);
      setStatus('Peptide export failed.');
      return null;
    } finally {
      setIsSubmitting(false);
    }
  };

  const beginPeptideImport = () => {
    peptideImportInputRef.current?.click();
  };

  const importPeptides = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';

    if (!file) {
      return;
    }

    setIsSubmitting(true);

    try {
      const transfer = normalizePeptideTransfer(JSON.parse(await file.text()));
      const shouldImport = window.confirm(
        `Import ${transfer.items.length} peptides and replace the current peptide collection? A backup will download first.`,
      );

      if (!shouldImport) {
        setStatus('Peptide import cancelled.');
        return;
      }

      const backup = await exportPeptideTransfer();
      downloadJson(backup, createPeptideExportFileName('backup'));

      const nextPeptides = await importPeptideTransfer(transfer);

      setPeptides(nextPeptides);
      setStatus(`${nextPeptides.length} peptides imported.`);
    } catch (error) {
      console.error(error);
      setStatus('Peptide import failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!session.isAuthenticated) {
    return (
      <section className="admin-page admin-page--login" aria-labelledby="admin-title">
        <div className="admin-page__panel">
          <p className="eyebrow">Admin</p>
          <h1 id="admin-title">{loginRole === 'owner' ? 'Helix owner' : 'Helix admin'}</h1>
          <form className="admin-login" onSubmit={login}>
            <label>
              <span>{loginRole === 'owner' ? 'Owner password' : 'Admin password'}</span>
              <span className="admin-password-field">
                <input
                  type={isPasswordVisible ? 'text' : 'password'}
                  value={password}
                  autoComplete="current-password"
                  autoFocus
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  type="button"
                  aria-label={isPasswordVisible ? 'Hide password' : 'Show password'}
                  onClick={() => setIsPasswordVisible((currentValue) => !currentValue)}
                >
                  {isPasswordVisible ? 'Hide' : 'Show'}
                </button>
              </span>
            </label>
            <button type="submit" disabled={isSubmitting || password.trim().length === 0}>
              Log In
            </button>
          </form>
          {status && <p className="admin-status">{status}</p>}
        </div>
      </section>
    );
  }

  return (
    <section className="admin-page" aria-labelledby="admin-title">
      <div className="admin-shell">
        <header className="admin-shell__header">
          <div>
            <p className="eyebrow">Admin only</p>
            <h1 id="admin-title">Helix admin</h1>
            <span>Signed in as {session.role ?? 'owner'}</span>
          </div>
          <button type="button" disabled={isSubmitting} onClick={logout}>
            Log Out
          </button>
        </header>

        <nav className="admin-tabs" aria-label="Admin sections">
          {(['vendors', 'rounds', 'peptides', 'notes', 'labels'] as AdminTab[]).map((tab) => (
            <button
              className={activeTab === tab ? 'is-selected' : ''}
              type="button"
              aria-pressed={activeTab === tab}
              key={tab}
              onClick={() => setActiveTab(tab)}
            >
              {tab[0].toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </nav>

        {status && <p className="admin-status admin-status--panel">{status}</p>}

        {activeTab === 'vendors' && (
          <section className="admin-panel" aria-labelledby="vendors-title">
            <AdminPanelHeader
              title="Vendors"
              count={vendors.length}
              actionLabel="Add Vendor"
              onAction={openNewVendorModal}
            />
            <div className="admin-table">
              {sortedVendors.map((vendor) => (
                <article className="admin-row" key={vendor.id}>
                  {savedPriceListVendorId === vendor.id && (
                    <div className="admin-row__banner" role="status">
                      Price list saved.
                    </div>
                  )}
                  <div>
                    <strong>{vendor.name}</strong>
                    <span>{vendor.nickname || 'No nickname'} - {vendor.whatsapp || 'No WhatsApp'}</span>
                    {vendor.description && <p>{vendor.description}</p>}
                  </div>
                  <div className="admin-row__meta">
                    <span>{vendor.negotiatedDiscount || 'No discount'}</span>
                    <span>
                      {formatPriceSheet(
                        vendor.priceSheet,
                        priceLists.find((priceList) => priceList.vendorId === vendor.id)?.source,
                      )}
                    </span>
                    {formatPriceListSummary(priceLists, vendor.id) && (
                      <span>{formatPriceListSummary(priceLists, vendor.id)}</span>
                    )}
                  </div>
                  <div className="admin-row__actions">
                    <button type="button" onClick={() => openPriceListModal(vendor)}>
                      Price List
                    </button>
                    <button type="button" onClick={() => openEditVendorModal(vendor)}>
                      Edit
                    </button>
                    <button type="button" onClick={() => void deleteVendor(vendor)}>
                      Delete
                    </button>
                  </div>
                </article>
              ))}
              {vendors.length === 0 && <p className="admin-empty">No vendors yet.</p>}
            </div>
          </section>
        )}

        {activeTab === 'rounds' && (
          <section className="admin-panel" aria-labelledby="rounds-title">
            <AdminPanelHeader
              title="Rounds"
              count={rounds.length}
              actionLabel="Add Round"
              onAction={openNewRoundModal}
            />
            <div className="admin-table">
              {sortedRounds.map((round) => {
                const vendor = vendors.find((currentVendor) => currentVendor.id === round.vendorId);
                const tierSummary = getRoundTierSummary(round);

                return (
                  <article className={round.isCurrent ? 'admin-row admin-row--pinned' : 'admin-row'} key={round.id}>
                    <div>
                      <strong>
                        {round.name}
                        {round.isCurrent ? <span className="admin-pin-badge">Current</span> : null}
                      </strong>
                      <span>{round.status || 'No status'} - {vendor?.name ?? 'No vendor'}</span>
                      <p>{round.targetWindow || formatRoundAdminDates(round) || 'No target window'}</p>
                    </div>
                    <div className="admin-row__meta">
                      <span>{round.participants} participants</span>
                      <span>{round.peptides.length} peptides</span>
                      <span>{round.roundDiscountPercent}% discount</span>
                      {tierSummary && <span>{tierSummary}</span>}
                    </div>
                    <div className="admin-row__actions">
                      <button type="button" onClick={() => openEditRoundModal(round)}>
                        Edit
                      </button>
                      <button type="button" onClick={() => void deleteRound(round)}>
                        Delete
                      </button>
                    </div>
                  </article>
                );
              })}
              {rounds.length === 0 && <p className="admin-empty">No rounds yet.</p>}
            </div>
          </section>
        )}

        {activeTab === 'peptides' && (
          <section className="admin-panel" aria-labelledby="peptides-title">
            <AdminPanelHeader
              title="Peptide dictionary"
              count={peptides.length}
              actionLabel="Add Peptide"
              secondaryActionLabel="Batch Import"
              tertiaryActionLabel="Find Missing Wiki Links"
              onAction={openNewPeptideModal}
              onSecondaryAction={() => {
                setBatchRows([]);
                setBatchStatus('');
                setIsBatchModalOpen(true);
              }}
              onTertiaryAction={() => void fillMissingWikiLinksForPeptides()}
            />
            {session.role === 'owner' && (
              <div className="admin-owner-tools" aria-label="Owner peptide transfer tools">
                <button type="button" disabled={isSubmitting} onClick={() => void exportPeptides()}>
                  Export Peptides
                </button>
                <button type="button" disabled={isSubmitting} onClick={beginPeptideImport}>
                  Import Peptides
                </button>
                <input
                  ref={peptideImportInputRef}
                  type="file"
                  accept=".json,application/json"
                  className="admin-hidden-file-input"
                  onChange={(event) => void importPeptides(event)}
                />
              </div>
            )}
            <div className="admin-table">
              {sortedPeptides.map((peptide) => (
                <article className="admin-row" key={peptide.id}>
                  <div>
                    <strong>{peptide.name}</strong>
                    <span>{peptide.categories.length > 0 ? peptide.categories.join(', ') : 'No categories'}</span>
                    {peptide.description && <p>{peptide.description}</p>}
                  </div>
                  <div className="admin-wiki-links">
                    {formatWikiLinks(peptide)}
                  </div>
                  <div className="admin-row__actions">
                    <button type="button" onClick={() => openEditPeptideModal(peptide)}>
                      Edit
                    </button>
                    <button type="button" onClick={() => void deletePeptide(peptide)}>
                      Delete
                    </button>
                  </div>
                </article>
              ))}
              {peptides.length === 0 && <p className="admin-empty">No peptides yet.</p>}
            </div>
          </section>
        )}

        {activeTab === 'notes' && (
          <section className="admin-panel" aria-labelledby="notes-title">
            <AdminPanelHeader
              title="Admin Notes"
              count={adminNotes.length}
              actionLabel="Add Note"
              onAction={openNewNoteModal}
            />
            {hasRoleTaggedNotes(sortedAdminNotes, session.role) && (
              <p className="admin-status admin-status--panel">
                Notes tagged @{session.role} need attention.
              </p>
            )}
            <div className="admin-table">
              {sortedAdminNotes.map((note) => (
                <article className="admin-row admin-note-row" key={note.id}>
                  <div>
                    <strong>{note.subject}</strong>
                    <span>
                      From {note.sender} - {formatDateTime(note.createdAt)}
                    </span>
                    <p>{note.body}</p>
                  </div>
                  <div className="admin-note-tags">
                    {note.tags.length > 0 ? note.tags.map((tag) => <span key={tag}>@{tag}</span>) : <span>No role tags</span>}
                  </div>
                </article>
              ))}
              {adminNotes.length === 0 && <p className="admin-empty">No notes yet.</p>}
            </div>
          </section>
        )}

        {activeTab === 'labels' && (
          <section className="admin-panel admin-panel--shortcut" aria-labelledby="labels-admin-title">
            <p className="eyebrow">Labels</p>
            <h2 id="labels-admin-title">Label template tools live on the Labels page</h2>
            <p>Admin edit buttons appear on label template cards while you are signed in.</p>
            <button type="button" onClick={() => onNavigate('/labels')}>
              Open Labels
            </button>
          </section>
        )}
      </div>

      {isVendorModalOpen && (
        <AdminModal title={editingVendor ? 'Edit vendor' : 'Add vendor'} onClose={() => setIsVendorModalOpen(false)}>
          <form className="admin-form" onSubmit={saveVendor}>
            <AdminTextField label="Name" value={vendorForm.name} required onChange={(value) => setVendorForm({ ...vendorForm, name: value })} />
            <AdminTextField label="Nickname" value={vendorForm.nickname} onChange={(value) => setVendorForm({ ...vendorForm, nickname: value })} />
            <AdminTextField label="WhatsApp" value={vendorForm.whatsapp} onChange={(value) => setVendorForm({ ...vendorForm, whatsapp: value })} />
            <AdminTextField label="Negotiated discount" value={vendorForm.negotiatedDiscount} placeholder="15% off list" onChange={(value) => setVendorForm({ ...vendorForm, negotiatedDiscount: value })} />
            <AdminTextArea label="Description" value={vendorForm.description} onChange={(value) => setVendorForm({ ...vendorForm, description: value })} />
            <label className="admin-field">
              <span>Price sheet</span>
              <select
                value={vendorForm.priceSheetMode}
                onChange={(event) => setVendorForm({ ...vendorForm, priceSheetMode: event.target.value as VendorForm['priceSheetMode'] })}
              >
                <option value="none">No price sheet</option>
                <option value="google-sheet">Google Sheet link</option>
                <option value="file">Upload file</option>
              </select>
            </label>
            {vendorForm.priceSheetMode === 'google-sheet' && (
              <AdminTextField
                label="Google Sheet URL"
                value={vendorForm.priceSheetUrl}
                error={vendorGoogleSheetUrlError}
                onChange={(value) => setVendorForm({ ...vendorForm, priceSheetUrl: value })}
              />
            )}
            {vendorForm.priceSheetMode === 'file' && (
              <label className="admin-field">
                <span>CSV or XLSX file</span>
                <input
                  type="file"
                  accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={(event) => setVendorForm({ ...vendorForm, priceSheetFile: event.target.files?.[0] ?? null })}
                />
                {editingVendor?.priceSheet?.type === 'file' && !vendorForm.priceSheetFile && (
                  <small>Keeping current file: {editingVendor.priceSheet.fileName}</small>
                )}
              </label>
            )}
            <div className="admin-modal__actions">
              <button type="button" onClick={() => setIsVendorModalOpen(false)}>
                Cancel
              </button>
              <button className="admin-primary-button" type="submit" disabled={isSubmitting || Boolean(vendorGoogleSheetUrlError)}>
                Save Vendor
              </button>
            </div>
          </form>
        </AdminModal>
      )}

      {isRoundModalOpen && (
        <AdminModal title={editingRound ? 'Edit round' : 'Add round'} wide onClose={() => setIsRoundModalOpen(false)}>
          <form className="admin-form admin-form--wide" onSubmit={saveRound}>
            <div className="admin-round-grid">
              <AdminTextField label="Round name" value={roundForm.name} required onChange={(value) => setRoundForm({ ...roundForm, name: value })} />
              <AdminTextField label="Status" value={roundForm.status} onChange={(value) => setRoundForm({ ...roundForm, status: value })} />
              <label className="admin-field">
                <span>Vendor</span>
                <select value={roundForm.vendorId} onChange={(event) => updateRoundVendor(event.target.value)}>
                  <option value="">No vendor selected</option>
                  {sortedVendors.map((vendor) => (
                    <option value={vendor.id} key={vendor.id}>
                      {vendor.name}
                    </option>
                  ))}
                </select>
              </label>
              <AdminTextField label="Target window" value={roundForm.targetWindow} placeholder="June testing queue" onChange={(value) => setRoundForm({ ...roundForm, targetWindow: value })} />
              <AdminTextField label="Start date" value={roundForm.startDate} onChange={(value) => setRoundForm({ ...roundForm, startDate: value })} />
              <AdminTextField label="End date" value={roundForm.endDate} onChange={(value) => setRoundForm({ ...roundForm, endDate: value })} />
              <AdminTextField label="Participants" value={roundForm.participants} onChange={(value) => setRoundForm({ ...roundForm, participants: value })} />
              <AdminTextField label="Round discount %" value={roundForm.roundDiscountPercent} onChange={(value) => setRoundForm({ ...roundForm, roundDiscountPercent: value })} />
              <label className="admin-field admin-check-field">
                <input
                  type="checkbox"
                  checked={roundForm.isCurrent}
                  onChange={(event) => setRoundForm({ ...roundForm, isCurrent: event.target.checked })}
                />
                <span>Current / pinned</span>
              </label>
            </div>

            <section className="admin-round-source" aria-label="Round price source">
              <div className="admin-round-source__header">
                <div>
                  <span>Price source</span>
                  <small>{roundForm.priceListSnapshot ? `${roundForm.priceListSnapshot.items.length} linked rows` : 'No price snapshot'}</small>
                </div>
                <label>
                  <span>Mode</span>
                  <select
                    value={roundForm.priceSourceMode}
                    onChange={(event) => updateRoundPriceSourceMode(event.target.value as RoundPriceSourceMode)}
                  >
                    <option value="none">No sheet</option>
                    <option value="vendor-default">Use default</option>
                    <option value="round-override">Round-specific override</option>
                  </select>
                </label>
              </div>

              {roundForm.priceSourceMode === 'round-override' && (
                <div className="admin-price-source">
                  <label className="admin-field">
                    <span>Upload CSV or XLSX price sheet</span>
                    <input
                      ref={roundPriceListFileInputRef}
                      type="file"
                      accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                      onChange={(event) => {
                        const file = event.target.files?.[0] ?? null;
                        setRoundPriceListFile(file);

                        if (file) {
                          setRoundPriceListUrl('');
                          void parseRoundPriceList({ file, url: '' });
                        }
                      }}
                    />
                  </label>
                  <AdminTextField
                    label="Google Sheet URL"
                    value={roundPriceListUrl}
                    onChange={(value) => {
                      setRoundPriceListUrl(value);

                      if (value.trim()) {
                        setRoundPriceListFile(null);

                        if (roundPriceListFileInputRef.current) {
                          roundPriceListFileInputRef.current.value = '';
                        }
                      }
                    }}
                  />
                  <button type="button" disabled={isSubmitting} onClick={() => void parseRoundPriceList()}>
                    Parse Preview
                  </button>
                </div>
              )}
              {roundPriceListStatus && <p className="admin-status">{roundPriceListStatus}</p>}
            </section>

            <div className="admin-round-toolbar">
              <div>
                <strong>{roundForm.peptides.length} peptide rows</strong>
                <span>{getRoundFormTierSummary(roundForm.peptides)}</span>
              </div>
              <div className="admin-round-toolbar__actions">
                <button type="button" onClick={addRoundPeptideRow}>
                  Add Peptide Row
                </button>
                <button type="button" disabled={isSubmitting} onClick={beginRoundPeptideImport}>
                  Batch Import
                </button>
                <input
                  ref={roundPeptideImportInputRef}
                  type="file"
                  accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="admin-hidden-file-input"
                  onChange={(event) => void importRoundPeptides(event)}
                />
              </div>
            </div>

            <div className="admin-round-table">
              <div className="admin-round-row admin-round-row--header">
                <RoundPeptideSortButton sortKey="peptideName" label="Peptide" activeSort={roundPeptideSort} onSort={updateRoundPeptideSort} />
                <RoundPeptideSortButton sortKey="vendorCode" label="Vendor code" activeSort={roundPeptideSort} onSort={updateRoundPeptideSort} />
                <RoundPeptideSortButton sortKey="vendorPrice" label="Price" activeSort={roundPeptideSort} onSort={updateRoundPeptideSort} />
                <RoundPeptideSortButton sortKey="mass" label="Mass" activeSort={roundPeptideSort} onSort={updateRoundPeptideSort} />
                <RoundPeptideSortButton sortKey="testingTier" label="Tier" activeSort={roundPeptideSort} onSort={updateRoundPeptideSort} />
                <RoundPeptideSortButton sortKey="additionalTesting" label="Additional" activeSort={roundPeptideSort} onSort={updateRoundPeptideSort} />
                <RoundPeptideSortButton sortKey="batchConformity" label="Batch conf." activeSort={roundPeptideSort} onSort={updateRoundPeptideSort} />
                <RoundPeptideSortButton sortKey="capColor" label="Cap color" activeSort={roundPeptideSort} onSort={updateRoundPeptideSort} />
                <span className="admin-round-sort-pair">
                  <RoundPeptideSortButton sortKey="participantCount" label="Heads" activeSort={roundPeptideSort} onSort={updateRoundPeptideSort} />
                  <RoundPeptideSortButton sortKey="totalOrdered" label="Total" activeSort={roundPeptideSort} onSort={updateRoundPeptideSort} />
                </span>
                <RoundPeptideSortButton sortKey="notes" label="Notes" activeSort={roundPeptideSort} onSort={updateRoundPeptideSort} />
                <span />
              </div>
              {sortedRoundPeptideRows.map((row) => (
                <div className="admin-round-row" key={row.id}>
                  <input
                    value={row.peptideName}
                    list="round-peptide-options"
                    onChange={(event) => updateRoundPeptideRow(row.id, { peptideName: event.target.value })}
                  />
                  <select
                    value={row.priceListItemId}
                    aria-label={`Price list item for ${row.peptideName || 'round peptide'}`}
                    onChange={(event) => applyPriceListItemToRoundRow(row.id, event.target.value)}
                  >
                    <option value="">{row.vendorCode || 'Manual'}</option>
                    {roundForm.priceListSnapshot?.items.map((item) => (
                      <option value={item.id} key={item.id}>
                        {item.vendorCode || item.productName}
                      </option>
                    ))}
                  </select>
                  <input
                    value={row.vendorPrice ?? ''}
                    onChange={(event) => updateRoundPeptideRow(row.id, {
                      vendorPrice: parseNullableNumber(event.target.value),
                      vendorPriceOverridden: true,
                    })}
                  />
                  <input value={row.mass} onChange={(event) => updateRoundPeptideRow(row.id, { mass: event.target.value })} />
                  <select
                    value={row.testingTier}
                    onChange={(event) => updateRoundPeptideRow(row.id, { testingTier: event.target.value as TestingTierId })}
                  >
                    {testingTierOptions.map((tier) => (
                      <option value={tier.id} key={tier.id}>
                        {tier.label}
                      </option>
                    ))}
                  </select>
                  <input value={row.additionalTesting} onChange={(event) => updateRoundPeptideRow(row.id, { additionalTesting: event.target.value })} />
                  <label className="admin-round-checkbox" aria-label={`${row.peptideName || 'Peptide'} batch conformity`}>
                    <input
                      type="checkbox"
                      checked={row.batchConformity}
                      onChange={(event) => updateRoundPeptideRow(row.id, { batchConformity: event.target.checked })}
                    />
                  </label>
                  <input value={row.capColor} onChange={(event) => updateRoundPeptideRow(row.id, { capColor: event.target.value })} />
                  <div className="admin-round-counts">
                    <input
                      aria-label={`${row.peptideName || 'Peptide'} participant count`}
                      value={row.participantCount || ''}
                      onChange={(event) => updateRoundPeptideRow(row.id, { participantCount: Math.max(0, Math.trunc(parseNullableNumber(event.target.value) ?? 0)) })}
                    />
                    <input
                      aria-label={`${row.peptideName || 'Peptide'} total ordered`}
                      value={row.totalOrdered || ''}
                      onChange={(event) => updateRoundPeptideRow(row.id, { totalOrdered: Math.max(0, Math.trunc(parseNullableNumber(event.target.value) ?? 0)) })}
                    />
                  </div>
                  <input value={row.notes} onChange={(event) => updateRoundPeptideRow(row.id, { notes: event.target.value })} />
                  <div className="admin-round-actions">
                    <button type="button" onClick={() => duplicateRoundPeptideRow(row)}>
                      Copy
                    </button>
                    <button type="button" onClick={() => removeRoundPeptideRow(row.id)}>
                      Delete
                    </button>
                  </div>
                </div>
              ))}
              {roundForm.peptides.length === 0 && <p className="admin-empty">No peptide rows yet.</p>}
            </div>
            <datalist id="round-peptide-options">
              {peptides.map((peptide) => (
                <option value={peptide.name} key={peptide.id} />
              ))}
            </datalist>

            <div className="admin-modal__actions">
              <button type="button" onClick={() => setIsRoundModalOpen(false)}>
                Cancel
              </button>
              <button className="admin-primary-button" type="submit" disabled={isSubmitting}>
                Save Round
              </button>
            </div>
          </form>
        </AdminModal>
      )}

      {isPeptideModalOpen && (
        <AdminModal title={editingPeptide ? 'Edit peptide' : 'Add peptide'} onClose={() => setIsPeptideModalOpen(false)}>
          <form className="admin-form" onSubmit={savePeptide}>
            <AdminTextField
              label="Name"
              value={peptideForm.name}
              required
              onBlur={() => {
                if (!hasWikiLinkUrl(peptideForm.wikiLinks)) {
                  void autofillWikiLinks();
                }
              }}
              onChange={(value) => setPeptideForm({ ...peptideForm, name: value })}
            />
            <label className="admin-field">
              <span>Categories</span>
              <input
                type="text"
                list="peptide-category-options"
                value={peptideForm.categories}
                placeholder="GLP, Metabolic"
                onChange={(event) => setPeptideForm({ ...peptideForm, categories: event.target.value })}
              />
              <datalist id="peptide-category-options">
                {peptideCategories.map((category) => (
                  <option value={category.name} key={category.id} />
                ))}
              </datalist>
            </label>
            <AdminTextArea label="Description" value={peptideForm.description} onChange={(value) => setPeptideForm({ ...peptideForm, description: value })} />
            <div className="admin-wiki-editor">
              <div className="admin-wiki-editor__header">
                <span>Wiki Links</span>
                <button type="button" onClick={() => void autofillWikiLinks()}>
                  Find Wiki Links
                </button>
              </div>
              {peptideForm.wikiLinks.map((link, index) => (
                <div className="admin-wiki-row" key={`${link.source}-${index}`}>
                  <label>
                    <span>Source</span>
                    <select
                      value={link.source}
                      onChange={(event) => updateWikiLink(index, 'source', event.target.value as WikiSource)}
                    >
                      <option value="peptidepedia">Peptidepedia</option>
                      <option value="pep-pedia">Pep-Pedia</option>
                      <option value="other">Other</option>
                    </select>
                  </label>
                  <label>
                    <span>Status</span>
                    <select
                      value={link.status}
                      onChange={(event) => updateWikiLink(index, 'status', event.target.value as WikiStatus)}
                    >
                      <option value="verified">Verified</option>
                      <option value="suggested">Suggested</option>
                      <option value="manual">Manual</option>
                    </select>
                  </label>
                  <label>
                    <span>URL</span>
                    <input
                      type="url"
                      value={link.url}
                      onChange={(event) => updateWikiLink(index, 'url', event.target.value)}
                    />
                  </label>
                  <button type="button" onClick={() => removeWikiLink(index)}>
                    Remove
                  </button>
                </div>
              ))}
              <button type="button" onClick={addWikiLink}>
                Add Wiki Link
              </button>
            </div>
            {wikiStatus && <p className="admin-status">{wikiStatus}</p>}
            <div className="admin-modal__actions">
              <button type="button" onClick={() => setIsPeptideModalOpen(false)}>
                Cancel
              </button>
              <button className="admin-primary-button" type="submit" disabled={isSubmitting}>
                Save Peptide
              </button>
            </div>
          </form>
        </AdminModal>
      )}

      {isBatchModalOpen && (
        <AdminModal title="Batch import peptides" onClose={() => setIsBatchModalOpen(false)}>
          <div className="admin-form">
            <label className="admin-field">
              <span>CSV or XLSX file</span>
              <input
                type="file"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={loadPeptideBatch}
              />
            </label>
            <p className="admin-help">Accepted columns: name, categories, description, wikiLinks, peptidepediaUrl, pepPediaUrl.</p>
            {batchStatus && <p className="admin-status">{batchStatus}</p>}
            {batchRows.length > 0 && (
              <div className="admin-batch-preview">
                {batchRows.slice(0, 12).map((row) => (
                  <div className={row.errors.length > 0 ? 'admin-batch-row has-error' : 'admin-batch-row'} key={`${row.rowNumber}-${row.name}`}>
                    <strong>{row.name || `Row ${row.rowNumber}`}</strong>
                    <span>{row.categories.join(', ') || 'No categories'}</span>
                    <small>{row.errors.length > 0 ? row.errors.join(', ') : 'Ready'}</small>
                  </div>
                ))}
              </div>
            )}
            <div className="admin-modal__actions">
              <button type="button" onClick={() => setIsBatchModalOpen(false)}>
                Cancel
              </button>
              <button className="admin-primary-button" type="button" disabled={isSubmitting || batchRows.length === 0} onClick={() => void savePeptideBatch()}>
                Save Valid Rows
              </button>
            </div>
          </div>
        </AdminModal>
      )}

      {isNoteModalOpen && (
        <AdminModal title="Add admin note" onClose={() => setIsNoteModalOpen(false)}>
          <form className="admin-form" onSubmit={saveAdminNote}>
            <AdminTextField label="Sender" value={noteForm.sender} required onChange={(value) => setNoteForm({ ...noteForm, sender: value })} />
            <AdminTextField label="Subject" value={noteForm.subject} required onChange={(value) => setNoteForm({ ...noteForm, subject: value })} />
            <AdminTextArea label="Note" value={noteForm.body} onChange={(value) => setNoteForm({ ...noteForm, body: value })} />
            <fieldset className="admin-field admin-check-group">
              <legend>Role tags</legend>
              <label>
                <input
                  type="checkbox"
                  checked={noteForm.tags.includes('admin')}
                  onChange={(event) => setNoteForm({ ...noteForm, tags: toggleNoteTag(noteForm.tags, 'admin', event.target.checked) })}
                />
                <span>@admin</span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={noteForm.tags.includes('owner')}
                  onChange={(event) => setNoteForm({ ...noteForm, tags: toggleNoteTag(noteForm.tags, 'owner', event.target.checked) })}
                />
                <span>@owner</span>
              </label>
            </fieldset>
            <div className="admin-modal__actions">
              <button type="button" onClick={() => setIsNoteModalOpen(false)}>
                Cancel
              </button>
              <button className="admin-primary-button" type="submit" disabled={isSubmitting}>
                Save Note
              </button>
            </div>
          </form>
        </AdminModal>
      )}

      {priceListVendor && (
        <AdminModal title={`${priceListVendor.name} price list`} wide onClose={() => setPriceListVendor(null)}>
          <div className="admin-form admin-form--wide">
            <div className="admin-price-source">
              <label className="admin-field">
                <span>Upload CSV or XLSX price sheet</span>
                <input
                  ref={priceListFileInputRef}
                  type="file"
                  accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    setPriceListFile(file);

                    if (file) {
                      setPriceListUrl('');
                      void parseVendorPriceList({ file, url: '' });
                    }
                  }}
                />
              </label>
              <AdminTextField
                label="Google Sheet URL"
                value={priceListUrl}
                onChange={(value) => {
                  setPriceListUrl(value);

                  if (value.trim()) {
                    setPriceListFile(null);

                    if (priceListFileInputRef.current) {
                      priceListFileInputRef.current.value = '';
                    }
                  }
                }}
              />
              <button type="button" disabled={isSubmitting} onClick={() => void parseVendorPriceList()}>
                Parse Preview
              </button>
            </div>

            {priceListStatus && <p className="admin-status">{priceListStatus}</p>}

            {priceListDraft && (
              <>
                <div className="admin-price-toolbar">
                  <div className="admin-price-meta">
                    <span>{priceListDraft.items.length} rows</span>
                    <span>Parsed {formatDateTime(priceListDraft.parsedAt)}</span>
                  </div>
                  <button className="admin-delete-button" type="button" onClick={() => void deleteVendorPriceList()}>
                    Delete Entire Price List
                  </button>
                </div>
                <div className="admin-price-table">
                  <div className="admin-price-row admin-price-row--header">
                    <span>Code</span>
                    <span>Product</span>
                    <span>Mass</span>
                    <span>Price</span>
                    <span>Pack</span>
                    <span>Peptides</span>
                    <span />
                  </div>
                  {priceListDraft.items.map((item) => (
                    <div className={item.needsReview ? 'admin-price-row has-review' : 'admin-price-row'} key={item.id}>
                      <input value={item.vendorCode} onChange={(event) => updatePriceListItem(item.id, 'vendorCode', event.target.value)} />
                      <input value={item.productName} onChange={(event) => updatePriceListItem(item.id, 'productName', event.target.value)} />
                      <input value={item.mass} onChange={(event) => updatePriceListItem(item.id, 'mass', event.target.value)} />
                      <input value={item.price ?? ''} onChange={(event) => updatePriceListItem(item.id, 'price', event.target.value)} />
                      <input value={item.vialsPerPack} onChange={(event) => updatePriceListItem(item.id, 'vialsPerPack', event.target.value)} />
                      <select
                        className="admin-price-peptide-select"
                        value={item.peptideIds[0] ?? ''}
                        aria-label={`Peptide link for ${item.productName || item.vendorCode || 'price row'}`}
                        onChange={(event) => updatePriceListItemPeptide(item.id, event.target.value)}
                      >
                        <option value="">Unlinked</option>
                        {peptides.map((peptide) => (
                          <option key={peptide.id} value={peptide.id}>
                            {peptide.name}
                          </option>
                        ))}
                      </select>
                      <button type="button" onClick={() => removePriceListItem(item.id)}>
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="admin-modal__actions admin-price-footer-actions">
              <button type="button" onClick={() => setPriceListVendor(null)}>
                Close
              </button>
              <div className="admin-price-footer-main">
                {priceListDraft && (
                  <button type="button" onClick={refreshPriceListPeptideLinks}>
                    Refresh Peptide Links
                  </button>
                )}
                <button className="admin-primary-button" type="button" disabled={isSubmitting || !priceListDraft} onClick={() => void saveVendorPriceList()}>
                  Save Price List
                </button>
              </div>
            </div>
          </div>
        </AdminModal>
      )}
    </section>
  );
}

function AdminPanelHeader({
  title,
  count,
  actionLabel,
  secondaryActionLabel,
  tertiaryActionLabel,
  onAction,
  onSecondaryAction,
  onTertiaryAction,
}: {
  title: string;
  count: number;
  actionLabel: string;
  secondaryActionLabel?: string;
  tertiaryActionLabel?: string;
  onAction: () => void;
  onSecondaryAction?: () => void;
  onTertiaryAction?: () => void;
}) {
  return (
    <div className="admin-panel__header">
      <div>
        <p className="eyebrow">{count} records</p>
        <h2>{title}</h2>
      </div>
      <div className="admin-panel__actions">
        {secondaryActionLabel && onSecondaryAction && (
          <button type="button" onClick={onSecondaryAction}>
            {secondaryActionLabel}
          </button>
        )}
        {tertiaryActionLabel && onTertiaryAction && (
          <button type="button" onClick={onTertiaryAction}>
            {tertiaryActionLabel}
          </button>
        )}
        <button className="admin-primary-button" type="button" onClick={onAction}>
          {actionLabel}
        </button>
      </div>
    </div>
  );
}

function AdminModal({
  title,
  children,
  onClose,
  wide,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div className="admin-modal-backdrop" role="presentation">
      <section className={wide ? 'admin-modal admin-modal--wide' : 'admin-modal'} role="dialog" aria-modal="true" aria-labelledby="admin-modal-title">
        <div className="admin-modal__header">
          <h2 id="admin-modal-title">{title}</h2>
          <button className="admin-modal__close" type="button" aria-label="Close" onClick={onClose}>
            x
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function RoundPeptideSortButton({
  sortKey,
  label,
  activeSort,
  onSort,
}: {
  sortKey: RoundPeptideSortKey;
  label: string;
  activeSort: RoundPeptideSort | null;
  onSort: (key: RoundPeptideSortKey) => void;
}) {
  const isActive = activeSort?.key === sortKey;
  const direction = isActive ? activeSort.direction : 'none';

  return (
    <button
      className={isActive ? 'admin-round-sort admin-round-sort--active' : 'admin-round-sort'}
      type="button"
      aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : undefined}
      onClick={() => onSort(sortKey)}
    >
      <span className="admin-round-sort__label">{label}</span>
      <RoundPeptideSortIcon direction={direction} />
    </button>
  );
}

function RoundPeptideSortIcon({ direction }: { direction: 'asc' | 'desc' | 'none' }) {
  const upClassName = direction === 'asc' ? 'admin-round-sort__arrow admin-round-sort__arrow--active' : 'admin-round-sort__arrow';
  const downClassName = direction === 'desc' ? 'admin-round-sort__arrow admin-round-sort__arrow--active' : 'admin-round-sort__arrow';

  if (direction === 'desc') {
    return (
      <svg className="admin-round-sort__icon" aria-hidden="true" viewBox="0 0 24 24">
        <path className={downClassName} d="m3 16 4 4 4-4" />
        <path className={downClassName} d="M7 20V4" />
        <path className={upClassName} d="m21 8-4-4-4 4" />
        <path className={upClassName} d="M17 4v16" />
      </svg>
    );
  }

  return (
    <svg className="admin-round-sort__icon" aria-hidden="true" viewBox="0 0 24 24">
      <path className={downClassName} d="m21 16-4 4-4-4" />
      <path className={downClassName} d="M17 20V4" />
      <path className={upClassName} d="m3 8 4-4 4 4" />
      <path className={upClassName} d="M7 4v16" />
    </svg>
  );
}

function AdminTextField({
  label,
  value,
  placeholder,
  required,
  error,
  onBlur,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  required?: boolean;
  error?: string;
  onBlur?: () => void;
  onChange: (value: string) => void;
}) {
  return (
    <label className={error ? 'admin-field admin-field--invalid' : 'admin-field'}>
      <span>{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        required={required}
        aria-invalid={error ? 'true' : undefined}
        onBlur={onBlur}
        onChange={(event) => onChange(event.target.value)}
      />
      {error && <small className="admin-field__error">{error}</small>}
    </label>
  );
}

function AdminTextArea({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="admin-field">
      <span>{label}</span>
      <textarea rows={4} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

async function loginAdmin(password: string, role: AdminRole): Promise<AdminSession> {
  const response = await fetch('/api/admin/login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password, role }),
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

async function fetchCollection<T>(collectionName: string): Promise<T[]> {
  const response = await fetch(`/api/data/${collectionName}`);

  if (!response.ok) {
    throw new Error(`${collectionName} could not be loaded.`);
  }

  const records = (await response.json()) as unknown;
  return Array.isArray(records) ? (records as T[]) : [];
}

async function saveCollectionItem<T extends { id: string }>(collectionName: string, item: T): Promise<T[]> {
  const response = await fetch(`/api/admin/data/${collectionName}/${encodeURIComponent(item.id)}`, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(item),
  });

  if (!response.ok) {
    throw new Error(`${collectionName} item could not be saved.`);
  }

  const records = (await response.json()) as unknown;
  return Array.isArray(records) ? (records as T[]) : [];
}

async function deleteCollectionItem<T>(collectionName: string, itemId: string): Promise<T[]> {
  const response = await fetch(`/api/admin/data/${collectionName}/${encodeURIComponent(itemId)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  });

  if (!response.ok) {
    throw new Error(`${collectionName} item could not be deleted.`);
  }

  const records = (await response.json()) as unknown;
  return Array.isArray(records) ? (records as T[]) : [];
}

async function exportPeptideTransfer(): Promise<PeptideTransfer> {
  const response = await fetch('/api/admin/data/peptides/export', {
    credentials: 'same-origin',
  });

  if (!response.ok) {
    throw new Error('Peptide export failed.');
  }

  return normalizePeptideTransfer(await response.json());
}

async function importPeptideTransfer(transfer: PeptideTransfer): Promise<Peptide[]> {
  const response = await fetch('/api/admin/data/peptides/import', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(transfer),
  });

  if (!response.ok) {
    throw new Error('Peptide import failed.');
  }

  const records = (await response.json()) as unknown;
  return Array.isArray(records) ? (records as Peptide[]) : [];
}

async function resolveVendorPriceSheet(
  editingVendor: Vendor | null,
  form: VendorForm,
): Promise<VendorPriceSheet | undefined> {
  if (form.priceSheetMode === 'none') {
    return undefined;
  }

  if (form.priceSheetMode === 'google-sheet') {
    const url = form.priceSheetUrl.trim();
    return url ? { type: 'google-sheet', url } : undefined;
  }

  if (!form.priceSheetFile && editingVendor?.priceSheet?.type === 'file') {
    return editingVendor.priceSheet;
  }

  if (!form.priceSheetFile) {
    return undefined;
  }

  const base64 = await fileToBase64(form.priceSheetFile);
  const response = await fetch('/api/admin/assets/vendor-price-sheet', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fileName: form.priceSheetFile.name,
      mimeType: form.priceSheetFile.type || 'application/octet-stream',
      base64,
    }),
  });

  if (!response.ok) {
    throw new Error('Vendor price sheet could not be uploaded.');
  }

  return (await response.json()) as VendorPriceSheet;
}

function validateGoogleSheetSourceInput(value: string) {
  const cleanValue = value.trim();

  if (!cleanValue) {
    return '';
  }

  if (isRawGoogleSheetId(cleanValue)) {
    return '';
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(cleanValue);
  } catch {
    return 'Use a valid Google Sheet URL or Sheet id.';
  }

  if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== 'docs.google.com') {
    return 'Google Sheet links must start with https://docs.google.com.';
  }

  if (!getGoogleSheetIdFromUrl(parsedUrl)) {
    return 'Google Sheet link must include a Sheet id.';
  }

  return '';
}

function isRawGoogleSheetId(value: string) {
  return /^[A-Za-z0-9_-]{10,}$/.test(value.trim());
}

function getGoogleSheetIdFromUrl(parsedUrl: URL) {
  const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
  const idMarkerIndex = pathParts.findIndex((part) => part === 'd');
  const pathSheetId = idMarkerIndex >= 0 ? pathParts[idMarkerIndex + 1] ?? '' : '';

  if (isRawGoogleSheetId(pathSheetId)) {
    return pathSheetId;
  }

  const querySheetId = parsedUrl.searchParams.get('id') ?? '';
  return isRawGoogleSheetId(querySheetId) ? querySheetId : '';
}

async function getPriceListParseSource(file: File | null, url: string) {
  if (file) {
    return {
      type: 'file',
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      base64: await fileToBase64(file),
    };
  }

  const cleanUrl = url.trim();

  if (cleanUrl) {
    return {
      type: 'google-sheet',
      url: cleanUrl,
    };
  }

  return null;
}

async function parseVendorPriceListSource(
  vendor: Vendor,
  source: Awaited<ReturnType<typeof getPriceListParseSource>>,
) {
  const response = await fetch('/api/admin/vendor-price-lists/parse', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      vendorId: vendor.id,
      vendorName: vendor.name,
      source,
    }),
  });

  if (!response.ok) {
    throw new Error('Vendor price list could not be parsed.');
  }

  return (await response.json()) as VendorPriceList;
}

async function parsePeptideBatchFile(file: File) {
  const response = await fetch('/api/admin/peptides/parse-batch', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      source: {
        type: 'file',
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        base64: await fileToBase64(file),
      },
    }),
  });

  if (!response.ok) {
    throw new Error('Peptide batch file could not be parsed.');
  }

  const result = (await response.json()) as { rows?: BatchPeptideRow[] };
  return Array.isArray(result.rows) ? result.rows : [];
}

async function parseRoundPeptideBatchFile(
  file: File,
  priceListItems: RoundPriceListSnapshot['items'],
  existingRows: RoundPeptide[],
) {
  const response = await fetch('/api/admin/rounds/parse-peptides', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      source: {
        type: 'file',
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        base64: await fileToBase64(file),
      },
      priceListItems,
      existingRows,
    }),
  });

  if (!response.ok) {
    throw new Error('Round peptide batch file could not be parsed.');
  }

  const result = (await response.json()) as { rows?: RoundPeptideBatchRow[] };
  return Array.isArray(result.rows) ? result.rows : [];
}

function stripRoundPeptideBatchFields(row: RoundPeptideBatchRow): RoundPeptide {
  const { rowNumber, errors, ...roundPeptide } = row;

  void rowNumber;
  void errors;

  return roundPeptide;
}

function sortRoundPeptideRows(rows: RoundPeptide[], sort: RoundPeptideSort | null) {
  if (!sort) {
    return rows;
  }

  const indexedRows = rows.map((row, index) => ({ row, index }));

  indexedRows.sort((first, second) => {
    const comparison = compareRoundPeptideRows(first.row, second.row, sort.key);

    if (comparison !== 0) {
      return sort.direction === 'asc' ? comparison : -comparison;
    }

    return first.index - second.index;
  });

  return indexedRows.map(({ row }) => row);
}

function getDefaultRoundPeptideSortDirection(key: RoundPeptideSortKey): RoundPeptideSort['direction'] {
  return key === 'participantCount' || key === 'totalOrdered' ? 'desc' : 'asc';
}

function compareRoundPeptideRows(first: RoundPeptide, second: RoundPeptide, key: RoundPeptideSortKey) {
  if (key === 'vendorPrice') {
    return compareNullableNumbers(first.vendorPrice, second.vendorPrice);
  }

  if (key === 'participantCount' || key === 'totalOrdered') {
    return compareNumbers(first[key], second[key]);
  }

  if (key === 'mass') {
    const massComparison = compareNullableNumbers(parseMassNumber(first.mass), parseMassNumber(second.mass));

    return massComparison || compareText(first.mass, second.mass);
  }

  if (key === 'batchConformity') {
    return compareNumbers(first.batchConformity ? 1 : 0, second.batchConformity ? 1 : 0);
  }

  if (key === 'testingTier') {
    return compareNumbers(getTestingTierSortValue(first.testingTier), getTestingTierSortValue(second.testingTier));
  }

  return compareText(String(first[key] ?? ''), String(second[key] ?? ''));
}

function compareText(first: string, second: string) {
  return first.localeCompare(second, undefined, { sensitivity: 'base', numeric: true });
}

function compareNumbers(first: number, second: number) {
  return first - second;
}

function compareNullableNumbers(first: number | null, second: number | null) {
  if (first === null && second === null) {
    return 0;
  }

  if (first === null) {
    return 1;
  }

  if (second === null) {
    return -1;
  }

  return first - second;
}

function parseMassNumber(value: string) {
  const match = value.match(/-?\d+(?:\.\d+)?/);

  return match ? Number(match[0]) : null;
}

function getTestingTierSortValue(tier: TestingTierId) {
  const tierOrder: Record<TestingTierId, number> = {
    platinum: 0,
    'gold-plus': 1,
    gold: 2,
    bronze: 3,
    none: 4,
  };

  return tierOrder[tier];
}

async function uploadVendorPriceSheetFile(file: File): Promise<VendorPriceSheet> {
  const base64 = await fileToBase64(file);
  const response = await fetch('/api/admin/assets/vendor-price-sheet', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      base64,
    }),
  });

  if (!response.ok) {
    throw new Error('Vendor price sheet could not be uploaded.');
  }

  return (await response.json()) as VendorPriceSheet;
}

async function searchWikiLinks(name: string): Promise<{ name: string; wikiLinks: WikiLink[]; categories?: string[] } | null> {
  const response = await fetch(`/api/admin/wiki/search?name=${encodeURIComponent(name)}`, {
    credentials: 'same-origin',
  });

  if (!response.ok) {
    throw new Error('Wiki search failed.');
  }

  const result = (await response.json()) as { match?: { name: string; wikiLinks: WikiLink[]; categories?: string[] } | null };
  return result.match ?? null;
}

function createEmptyPeptideForm(): PeptideForm {
  return {
    name: '',
    categories: '',
    description: '',
    wikiLinks: createDefaultWikiLinks(),
  };
}

function createDefaultWikiLinks() {
  return [
    createWikiLink({ source: 'peptidepedia', status: 'manual', url: '' }),
    createWikiLink({ source: 'pep-pedia', status: 'manual', url: '' }),
  ];
}

function createWikiLink(link: Partial<WikiLink>): WikiLink {
  const source = link.source ?? 'other';

  return {
    source,
    url: sanitizeUrl(link.url ?? ''),
    status: link.status ?? 'manual',
  };
}

function createWikiLinkFormRows(peptide: Partial<Peptide>) {
  const links = normalizeWikiLinks(peptide);

  return links.length > 0 ? links : createDefaultWikiLinks();
}

function normalizeWikiLinks(peptide: { wikiLinks?: unknown; peptidepediaUrl?: string }) {
  const rawLinks = Array.isArray(peptide.wikiLinks) ? peptide.wikiLinks : [];
  const links = rawLinks
    .map((link) => normalizeWikiLink(link))
    .filter((link): link is WikiLink => Boolean(link));

  if (links.length === 0 && peptide.peptidepediaUrl) {
    const legacyLink = createWikiLink({
      source: 'peptidepedia',
      url: peptide.peptidepediaUrl,
      status: 'verified',
    });

    if (legacyLink.url) {
      links.push(legacyLink);
    }
  }

  return sortWikiLinks(dedupeWikiLinks(links));
}

function normalizeWikiLink(value: unknown): WikiLink | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const link = value as Partial<WikiLink>;
  const url = sanitizeUrl(String(link.url ?? ''));

  if (!url) {
    return null;
  }

  const source = normalizeWikiSource(link.source);
  const status = normalizeWikiStatus(link.status);

  return createWikiLink({
    source,
    url,
    status,
  });
}

function normalizeWikiSource(value: unknown): WikiSource {
  return value === 'peptidepedia' || value === 'pep-pedia' || value === 'other'
    ? value
    : 'other';
}

function inferWikiSourceFromUrl(url: string): WikiSource {
  try {
    const host = new URL(sanitizeUrl(url)).hostname.replace(/^www\./, '');

    if (host === 'peptidepedia.org') {
      return 'peptidepedia';
    }

    if (host === 'pep-pedia.org') {
      return 'pep-pedia';
    }
  } catch {
    // Fall through to other for incomplete or invalid URLs while editing.
  }

  return 'other';
}

function normalizeWikiStatus(value: unknown): WikiStatus {
  return value === 'verified' || value === 'suggested' || value === 'manual'
    ? value
    : 'manual';
}

function dedupeWikiLinks(links: WikiLink[]) {
  const seen = new Set<string>();
  const nextLinks: WikiLink[] = [];

  for (const link of links) {
    const key = `${link.source}:${normalizeName(link.url)}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    nextLinks.push(link);
  }

  return nextLinks;
}

function sortWikiLinks(links: WikiLink[]) {
  const order: Record<WikiSource, number> = {
    peptidepedia: 0,
    'pep-pedia': 1,
    other: 2,
  };

  return [...links].sort((first, second) => order[first.source] - order[second.source]);
}

function mergeWikiLinks(currentLinks: WikiLink[], incomingLinks: WikiLink[]) {
  const nextLinks = normalizeWikiLinks({ wikiLinks: currentLinks });

  for (const incomingLink of normalizeWikiLinks({ wikiLinks: incomingLinks })) {
    const existingIndex = nextLinks.findIndex((link) => link.source === incomingLink.source);

    if (existingIndex >= 0) {
      nextLinks[existingIndex] = incomingLink;
    } else {
      nextLinks.push(incomingLink);
    }
  }

  return createWikiLinkFormRows({ wikiLinks: nextLinks });
}

function hasWikiLinkUrl(wikiLinks: WikiLink[]) {
  return normalizeWikiLinks({ wikiLinks }).length > 0;
}

function getWikiSourceLabel(source: WikiSource) {
  return {
    peptidepedia: 'Peptidepedia',
    'pep-pedia': 'Pep-Pedia',
    other: 'Wiki',
  }[source];
}

function formatWikiLinks(peptide: Peptide): ReactNode {
  const links = normalizeWikiLinks(peptide);

  if (links.length === 0) {
    return <span>No wiki links</span>;
  }

  return links.map((link) => (
    <a href={link.url} target="_blank" rel="noreferrer" key={`${link.source}-${link.url}`}>
      {getWikiSourceLabel(link.source)}
      {link.status === 'suggested' ? ' (suggested)' : ''}
    </a>
  ));
}

function normalizeNoteTags(tags: AdminRole[]) {
  const nextTags: AdminRole[] = [];

  for (const tag of tags) {
    if ((tag === 'admin' || tag === 'owner') && !nextTags.includes(tag)) {
      nextTags.push(tag);
    }
  }

  return nextTags;
}

function toggleNoteTag(tags: AdminRole[], tag: AdminRole, checked: boolean) {
  const nextTags = new Set(tags);

  if (checked) {
    nextTags.add(tag);
  } else {
    nextTags.delete(tag);
  }

  return normalizeNoteTags([...nextTags]);
}

function hasRoleTaggedNotes(notes: AdminNote[], role: AdminSession['role']) {
  return Boolean(role && notes.some((note) => note.tags.includes(role)));
}

async function ensurePeptideCategories(
  categoryNames: string[],
  existingCategories: PeptideCategory[],
) {
  let nextCategories = existingCategories;

  for (const categoryName of categoryNames) {
    const existingCategory = findByNormalizedName(nextCategories, categoryName);

    if (existingCategory) {
      continue;
    }

    const category: PeptideCategory = {
      id: createUniqueId(categoryName, nextCategories),
      name: categoryName,
    };

    nextCategories = await saveCollectionItem<PeptideCategory>('peptide-categories', category);
  }

  return nextCategories;
}

function mergeCategoryText(
  currentCategoryText: string,
  suggestedCategories: string[],
  existingCategories: PeptideCategory[],
) {
  const currentCategories = normalizeCategories(currentCategoryText);
  const mappedSuggestions = suggestedCategories.map((category) =>
    mapSuggestedCategory(category, existingCategories),
  );
  const mergedCategories = [...currentCategories];

  for (const category of mappedSuggestions) {
    if (!mergedCategories.some((currentCategory) => normalizeName(currentCategory) === normalizeName(category))) {
      mergedCategories.push(category);
    }
  }

  return mergedCategories.join(', ');
}

function mapSuggestedCategory(category: string, existingCategories: PeptideCategory[]) {
  const normalizedCategory = normalizeName(category);
  const existingCategory = existingCategories.find(
    (currentCategory) => normalizeName(currentCategory.name) === normalizedCategory,
  );

  return existingCategory?.name ?? normalizeCategoryName(category);
}

function normalizePeptideName(value: string) {
  const cleanValue = sanitizeText(value);
  const specialNames = new Map([
    ['bpc157', 'BPC-157'],
    ['tb500', 'TB-500'],
    ['pt141', 'PT-141'],
    ['cjc1295', 'CJC-1295'],
    ['ghkcu', 'GHK-Cu'],
    ['nad', 'NAD+'],
    ['nadplus', 'NAD+'],
    ['ss31', 'SS-31'],
    ['aod9604', 'AOD-9604'],
    ['ghrp2', 'GHRP-2'],
    ['ghrp6', 'GHRP-6'],
  ]);

  return specialNames.get(normalizeName(cleanValue)) ?? titleCase(cleanValue);
}

function normalizeCategories(value: string | string[]) {
  const rawCategories = Array.isArray(value) ? value : parseList(value);
  const categories: string[] = [];

  for (const category of rawCategories) {
    const normalizedCategory = normalizeCategoryName(category);

    if (
      normalizedCategory &&
      !categories.some((currentCategory) => normalizeName(currentCategory) === normalizeName(normalizedCategory))
    ) {
      categories.push(normalizedCategory);
    }
  }

  return categories;
}

function normalizeCategoryName(value: string) {
  const cleanValue = sanitizeText(value);
  const specialCategories = new Map([
    ['glp', 'GLP'],
    ['glp1', 'GLP'],
    ['nad', 'NAD+'],
    ['nadplus', 'NAD+'],
  ]);

  return specialCategories.get(normalizeName(cleanValue)) ?? titleCase(cleanValue);
}

function sanitizeText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function formatVendorDiscountInput(value: string) {
  const cleanValue = sanitizeText(value);

  if (!cleanValue) {
    return '';
  }

  const numericValue = cleanValue.replace(/%$/, '').trim();

  if (/^\d+(?:\.\d+)?$/.test(numericValue)) {
    return `${numericValue}%`;
  }

  return cleanValue;
}

function sanitizeUrl(value: string) {
  const cleanValue = sanitizeText(value);

  if (!cleanValue) {
    return '';
  }

  try {
    const parsedUrl = new URL(cleanValue);
    return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:' ? parsedUrl.toString() : '';
  } catch {
    return '';
  }
}

function titleCase(value: string) {
  return value
    .split(' ')
    .filter(Boolean)
    .map((word) => {
      if (word === word.toUpperCase() && word.length <= 5) {
        return word;
      }

      return word
        .split('-')
        .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}` : part))
        .join('-');
    })
    .join(' ');
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

function findByNormalizedName<T extends { name: string }>(items: T[], name: string) {
  const normalizedName = normalizeName(name);
  return items.find((item) => normalizeName(item.name) === normalizedName);
}

function createUniqueId(name: string, items: { id: string }[]) {
  const baseId = slugify(name) || `item-${Date.now()}`;
  const usedIds = new Set(items.map((item) => item.id));
  let nextId = baseId;
  let suffix = 2;

  while (usedIds.has(nextId)) {
    nextId = `${baseId}-${suffix}`;
    suffix += 1;
  }

  return nextId;
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeName(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function parseList(value: string) {
  return value
    .split(/[,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatPriceSheet(
  priceSheet: VendorPriceSheet | undefined,
  priceListSource?: VendorPriceList['source'],
) {
  const displaySource = priceSheet ?? priceListSource;

  if (!displaySource) {
    return 'No price sheet';
  }

  return displaySource.type === 'google-sheet'
    ? 'Google Sheet linked'
    : `File: ${displaySource.fileName}`;
}

function formatPriceListSummary(priceLists: VendorPriceList[], vendorId: string) {
  const priceList = priceLists.find((currentPriceList) => currentPriceList.vendorId === vendorId);

  if (!priceList) {
    return '';
  }

  return `${priceList.items.length} parsed rows`;
}

function createNextRoundName(rounds: Round[]) {
  const roundNumbers = rounds
    .map((round) => round.name.match(/round\s+(\d+)/i)?.[1])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  const nextNumber = roundNumbers.length > 0 ? Math.max(...roundNumbers) + 1 : rounds.length + 1;

  return `Round ${nextNumber}`;
}

function getSavedVendorPriceListSnapshot(priceLists: VendorPriceList[], vendorId: string): RoundPriceListSnapshot | null {
  const priceList = priceLists.find((currentPriceList) => currentPriceList.vendorId === vendorId);

  return priceList ? toRoundPriceListSnapshot(priceList) : null;
}

function toRoundPriceListSnapshot(priceList: VendorPriceList): RoundPriceListSnapshot {
  return {
    id: priceList.id,
    vendorId: priceList.vendorId,
    vendorName: priceList.vendorName,
    source: priceList.source.type === 'google-sheet'
      ? { type: 'google-sheet', url: priceList.source.url }
      : {
          type: 'file',
          fileName: priceList.source.fileName,
          mimeType: priceList.source.mimeType,
          blobKey: 'blobKey' in priceList.source ? priceList.source.blobKey : undefined,
        },
    parsedAt: priceList.parsedAt,
    items: priceList.items.map((item) => ({
      id: item.id,
      vendorCode: item.vendorCode,
      productName: item.productName,
      mass: item.mass,
      price: item.price,
      vialsPerPack: item.vialsPerPack,
      peptideIds: item.peptideIds,
      needsReview: item.needsReview,
    })),
  };
}

async function resolveRoundPriceListSnapshot(
  form: RoundForm,
  roundPriceListFile: File | null,
): Promise<RoundPriceListSnapshot | null> {
  if (!form.priceListSnapshot || form.priceSourceMode === 'none') {
    return null;
  }

  if (form.priceListSnapshot.source?.type !== 'file' || form.priceListSnapshot.source.blobKey || !roundPriceListFile) {
    return form.priceListSnapshot;
  }

  const savedSource = await uploadVendorPriceSheetFile(roundPriceListFile);

  return {
    ...form.priceListSnapshot,
    source: savedSource,
  };
}

function createRoundPeptideRow(existingRows: { id: string }[]): RoundPeptide {
  return {
    id: createUniqueId(`round-row-${Date.now()}`, existingRows),
    peptideId: '',
    peptideName: '',
    priceListItemId: '',
    vendorCode: '',
    vendorPrice: null,
    vendorPriceOverridden: false,
    mass: '',
    testingTier: 'none',
    additionalTesting: '',
    batchConformity: false,
    capColor: '',
    notes: '',
    participantCount: 0,
    totalOrdered: 0,
  };
}

function insertAfterRoundPeptide(rows: RoundPeptide[], sourceRowId: string, insertedRow: RoundPeptide) {
  const sourceIndex = rows.findIndex((row) => row.id === sourceRowId);

  if (sourceIndex < 0) {
    return [...rows, insertedRow];
  }

  return [
    ...rows.slice(0, sourceIndex + 1),
    insertedRow,
    ...rows.slice(sourceIndex + 1),
  ];
}

function normalizeRoundPeptideFormRow(row: RoundPeptide): RoundPeptide {
  return {
    ...row,
    peptideId: sanitizeText(row.peptideId),
    peptideName: sanitizeText(row.peptideName),
    priceListItemId: sanitizeText(row.priceListItemId),
    vendorCode: sanitizeText(row.vendorCode),
    vendorPrice: row.vendorPrice === null ? null : Math.max(0, Number(row.vendorPrice) || 0),
    mass: sanitizeText(row.mass),
    additionalTesting: sanitizeText(row.additionalTesting),
    batchConformity: row.batchConformity === true,
    capColor: sanitizeText(row.capColor),
    notes: sanitizeText(row.notes),
    participantCount: Math.max(0, Math.trunc(Number(row.participantCount) || 0)),
    totalOrdered: Math.max(0, Math.trunc(Number(row.totalOrdered) || 0)),
  };
}

function getRoundTierSummary(round: Round) {
  return getRoundFormTierSummary(round.peptides);
}

function getRoundFormTierSummary(rows: RoundPeptide[]) {
  const counts = testingTierSummaryOptions
    .map((tier) => ({
      ...tier,
      count: rows.filter((row) => row.testingTier === tier.id).length,
    }))
    .filter((tier) => tier.count > 0);

  return counts.map((tier) => `${tier.label}: ${tier.count}`).join(' / ');
}

function formatRoundAdminDates(round: Round) {
  if (round.startDate && round.endDate) {
    return `${round.startDate} to ${round.endDate}`;
  }

  return round.startDate || round.endDate || '';
}

function isVendorPriceSheetSource(
  source: VendorPriceList['source'] | undefined,
): source is VendorPriceSheet {
  return source?.type === 'google-sheet' || (source?.type === 'file' && 'blobKey' in source);
}

function formatPeptideLinks(peptideIds: string[], peptides: Peptide[]) {
  if (peptideIds.length === 0) {
    return 'Unlinked';
  }

  return peptideIds
    .map((peptideId) => peptides.find((peptide) => peptide.id === peptideId)?.name ?? peptideId)
    .join(', ');
}

function matchPeptideIds(productName: string, peptides: Peptide[]) {
  const productNames = getNameMatchVariants(productName);

  if (productNames.length === 0) {
    return [];
  }

  const exactMatch = peptides.find((peptide) =>
    getNameMatchVariants(peptide.name).some((peptideName) => productNames.includes(peptideName)),
  );

  if (exactMatch) {
    return [exactMatch.id];
  }

  return peptides
    .filter((peptide) => {
      const peptideNames = getNameMatchVariants(peptide.name);
      return peptideNames.some((peptideName) => productNames.includes(peptideName));
    })
    .map((peptide) => peptide.id);
}

function getNameMatchVariants(value: string) {
  return [
    value,
    value.replace(/\([^)]*\)/g, ' '),
  ]
    .map((variant) => normalizeName(variant))
    .filter(Boolean)
    .filter((variant, index, variants) => variants.indexOf(variant) === index);
}

function formatDateTime(value: string) {
  if (!value) {
    return 'not saved';
  }

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function normalizePeptideTransfer(value: unknown): PeptideTransfer {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid peptide transfer file.');
  }

  const transfer = value as Partial<PeptideTransfer>;

  if (transfer.collection !== 'peptides' || !Array.isArray(transfer.items)) {
    throw new Error('Invalid peptide transfer file.');
  }

  return {
    version: Number(transfer.version) || 1,
    collection: 'peptides',
    exportedAt: typeof transfer.exportedAt === 'string' ? transfer.exportedAt : new Date().toISOString(),
    items: transfer.items,
  };
}

function createPeptideExportFileName(label = 'export') {
  return `helix-peptides-${label}-${new Date().toISOString().slice(0, 10)}.json`;
}

function downloadJson(value: unknown, fileName: string) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function parseNullableNumber(value: string) {
  const cleanValue = value.trim().replace(/[$,\s]/g, '');

  if (!cleanValue) {
    return null;
  }

  const parsed = Number.parseFloat(cleanValue);
  return Number.isFinite(parsed) ? parsed : null;
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

export default AdminPage;
