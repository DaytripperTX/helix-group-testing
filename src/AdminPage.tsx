import { type ChangeEvent, type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';

type AdminSession = {
  isAuthenticated: boolean;
  role?: 'owner' | 'admin';
};

type AdminRole = 'owner' | 'admin';
type AdminTab = 'vendors' | 'peptides' | 'notes' | 'labels';

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

  useEffect(() => {
    if (!session.isAuthenticated) {
      return;
    }

    void refreshAdminData();
  }, [session.isAuthenticated]);

  const sortedVendors = useMemo(
    () => [...vendors].sort((first, second) => first.name.localeCompare(second.name)),
    [vendors],
  );
  const sortedPeptides = useMemo(
    () => [...peptides].sort((first, second) => first.name.localeCompare(second.name)),
    [peptides],
  );
  const sortedAdminNotes = useMemo(
    () => [...adminNotes].sort((first, second) => new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime()),
    [adminNotes],
  );

  const refreshAdminData = async () => {
    const [nextVendors, nextPeptides, nextPriceLists, nextPeptideCategories, nextAdminNotes] = await Promise.all([
      fetchCollection<Vendor>('vendors'),
      fetchCollection<Peptide>('peptides'),
      fetchCollection<VendorPriceList>('vendor-price-lists'),
      fetchCollection<PeptideCategory>('peptide-categories'),
      fetchCollection<AdminNote>('admin-notes'),
    ]);

    setVendors(nextVendors);
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
        negotiatedDiscount: sanitizeText(vendorForm.negotiatedDiscount),
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

  const parseVendorPriceList = async () => {
    if (!priceListVendor) {
      return;
    }

    const source = await getPriceListParseSource(priceListFile, priceListUrl);

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
      setPriceListStatus('Price list saved.');
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

    try {
      const rows = await parsePeptideSpreadsheet(file, peptides);

      setBatchRows(rows);
      setBatchStatus(`${rows.length} rows ready for review.`);
    } catch (error) {
      console.error(error);
      setBatchRows([]);
      setBatchStatus('Could not read that spreadsheet.');
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
          {(['vendors', 'peptides', 'notes', 'labels'] as AdminTab[]).map((tab) => (
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
                  <div>
                    <strong>{vendor.name}</strong>
                    <span>{vendor.nickname || 'No nickname'} - {vendor.whatsapp || 'No WhatsApp'}</span>
                    {vendor.description && <p>{vendor.description}</p>}
                  </div>
                  <div>
                    <span>{vendor.negotiatedDiscount || 'No discount'}</span>
                    <small>
                      {formatPriceSheet(
                        vendor.priceSheet,
                        priceLists.find((priceList) => priceList.vendorId === vendor.id)?.source,
                      )}; {formatPriceListSummary(priceLists, vendor.id)}
                    </small>
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
              <AdminTextField label="Google Sheet URL" value={vendorForm.priceSheetUrl} onChange={(value) => setVendorForm({ ...vendorForm, priceSheetUrl: value })} />
            )}
            {vendorForm.priceSheetMode === 'file' && (
              <label className="admin-field">
                <span>Excel or CSV file</span>
                <input
                  type="file"
                  accept=".csv,.xls,.xlsx,.xlsm,.xlsb,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
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
              <button className="admin-primary-button" type="submit" disabled={isSubmitting}>
                Save Vendor
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
              <span>CSV or Excel file</span>
              <input
                type="file"
                accept=".csv,.xls,.xlsx,.xlsm,.xlsb,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
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
        <AdminModal title={`${priceListVendor.name} price list`} onClose={() => setPriceListVendor(null)}>
          <div className="admin-form admin-form--wide">
            <div className="admin-price-source">
              <label className="admin-field">
                <span>Upload CSV or Excel price sheet</span>
                <input
                  type="file"
                  accept=".csv,.xls,.xlsx,.xlsm,.xlsb,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={(event) => setPriceListFile(event.target.files?.[0] ?? null)}
                />
              </label>
              <AdminTextField
                label="Google Sheet URL"
                value={priceListUrl}
                onChange={setPriceListUrl}
              />
              <button className="admin-primary-button" type="button" disabled={isSubmitting} onClick={() => void parseVendorPriceList()}>
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
                      <span>{formatPeptideLinks(item.peptideIds, peptides)}</span>
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
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="admin-modal-backdrop" role="presentation">
      <section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="admin-modal-title">
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

function AdminTextField({
  label,
  value,
  placeholder,
  required,
  onBlur,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  required?: boolean;
  onBlur?: () => void;
  onChange: (value: string) => void;
}) {
  return (
    <label className="admin-field">
      <span>{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        required={required}
        onBlur={onBlur}
        onChange={(event) => onChange(event.target.value)}
      />
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

async function parsePeptideSpreadsheet(file: File, existingPeptides: Peptide[]) {
  const XLSX = await import('xlsx');
  const extension = file.name.split('.').pop()?.toLowerCase();
  const workbook =
    extension === 'csv'
      ? XLSX.read(await file.text(), { type: 'string' })
      : XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, {
    defval: '',
  });

  const seenNames = new Set<string>();

  return rawRows.map((row, index) => {
    const normalizedRow = normalizeSpreadsheetRow(row);
    const name = normalizePeptideName(normalizedRow.name);
    const existingPeptide = findByNormalizedName(existingPeptides, name);
    const normalizedRowName = normalizeName(name);
    const peptide: BatchPeptideRow = {
      rowNumber: index + 2,
      id: existingPeptide?.id ?? createUniqueId(name || `peptide-${index + 2}`, existingPeptides),
      name,
      categories: normalizeCategories(normalizedRow.categories),
      description: sanitizeText(normalizedRow.description),
      wikiLinks: normalizedRow.wikiLinks,
      errors: [],
    };

    if (!name) {
      peptide.errors.push('Missing name');
    }

    if (normalizedRowName) {
      if (seenNames.has(normalizedRowName)) {
        peptide.errors.push('Duplicate name in import');
      } else {
        seenNames.add(normalizedRowName);
      }
    }

    if (normalizedRow.wikiLinksError) {
      peptide.errors.push(normalizedRow.wikiLinksError);
    }

    return peptide;
  });
}

function normalizeSpreadsheetRow(row: Record<string, unknown>) {
  const fields = new Map(
    Object.entries(row).map(([key, value]) => [key.trim().toLowerCase().replace(/[^a-z0-9]/g, ''), String(value ?? '').trim()]),
  );

  const wikiLinksResult = parseSpreadsheetWikiLinks({
    wikiLinks: fields.get('wikilinks') ?? '',
    peptidepediaUrl: fields.get('peptidepediaurl') ?? fields.get('peptidepedia') ?? fields.get('url') ?? '',
    pepPediaUrl: fields.get('peppediaurl') ?? fields.get('peppedia') ?? '',
  });

  return {
    name: fields.get('name') ?? '',
    categories: fields.get('categories') ?? fields.get('category') ?? '',
    description: fields.get('description') ?? '',
    wikiLinks: wikiLinksResult.wikiLinks,
    wikiLinksError: wikiLinksResult.error,
  };
}

function parseSpreadsheetWikiLinks({
  wikiLinks,
  peptidepediaUrl,
  pepPediaUrl,
}: {
  wikiLinks: string;
  peptidepediaUrl: string;
  pepPediaUrl: string;
}) {
  const links: WikiLink[] = [];
  let error = '';

  if (wikiLinks.trim()) {
    try {
      const parsedLinks = JSON.parse(wikiLinks);
      links.push(...normalizeWikiLinks({ wikiLinks: parsedLinks }));
    } catch {
      error = 'Invalid wikiLinks JSON';
    }
  }

  if (peptidepediaUrl.trim()) {
    links.push(createWikiLink({
      source: 'peptidepedia',
      url: peptidepediaUrl,
      status: 'manual',
    }));
  }

  if (pepPediaUrl.trim()) {
    links.push(createWikiLink({
      source: 'pep-pedia',
      url: pepPediaUrl,
      status: 'manual',
    }));
  }

  return {
    wikiLinks: normalizeWikiLinks({ wikiLinks: links }),
    error,
  };
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

function sanitizeUrl(value: string) {
  const cleanValue = sanitizeText(value);

  if (!cleanValue) {
    return '';
  }

  try {
    return new URL(cleanValue).toString();
  } catch {
    return cleanValue;
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
    return 'No parsed list';
  }

  return `${priceList.items.length} parsed rows`;
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
  const normalizedProduct = normalizeName(productName);

  if (!normalizedProduct) {
    return [];
  }

  const exactMatch = peptides.find((peptide) => normalizeName(peptide.name) === normalizedProduct);

  if (exactMatch) {
    return [exactMatch.id];
  }

  return peptides
    .filter((peptide) => {
      const normalizedPeptide = normalizeName(peptide.name);
      return normalizedPeptide.length > 0 && normalizedProduct.includes(normalizedPeptide);
    })
    .map((peptide) => peptide.id);
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
