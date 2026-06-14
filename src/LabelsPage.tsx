import { type ChangeEvent, type ClipboardEvent, type FormEvent, useEffect, useState } from 'react';
import printerCatalogData from './Assets/Printers.json';
import PageHero from './Helpers/PageHero';

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

type NativeLabelTemplate = {
  id: string;
  previewDataUrl: string;
  previewFileName: string;
  niimbotCode: string;
  templateName?: string;
  peptideName?: string;
  massMg?: string;
  labelSize?: string;
  peptideCategories?: string[];
  tags?: string[];
  votes?: number;
  moderationStatus?: 'pending' | 'approved' | 'rejected';
  reportCount?: number;
  reports?: NativeLabelReport[];
  createdAt?: string;
  updatedAt?: string;
  clearReports?: boolean;
};

type NativeLabelReport = {
  reason: NativeLabelReportReason;
  details?: string;
  createdAt: string;
};

type NativeLabelUploadForm = {
  previewDataUrl: string;
  previewFileName: string;
  niimbotCode: string;
  templateName: string;
  peptideName: string;
  massMg: string;
  labelSize: string;
  tags: string;
};

type DropdownOption = {
  value: string;
  label: string;
};

type ExportType = 'svg' | 'png' | 'pdf';

type NativeSortKey = 'featured' | 'popular' | 'az' | 'latest';

type NativeLabelReportReason = 'offensive' | 'spam' | 'unsafe' | 'other';

type PrinterColor = {
  id: string;
  name: string;
  hex: string;
  secondaryHex?: string;
  transparent?: boolean;
  finish?: string;
  shape?: string;
};

type LabelMedia = {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
  shape: string;
  cornerRadiusMm: number;
  common?: boolean;
  colorIds: string[];
};

type PrinterConfig = {
  id: string;
  printer: {
    name: string;
    model: string;
  };
  brand: string;
  technology: string;
  resolutionDpi: number;
  supportedLabelSizeMm: {
    min: {
      width: number;
      height: number;
    };
    max: {
      width: number;
      height: number;
    };
    officialWidthRangeInches?: string;
  };
  labelColorsSupported: PrinterColor[];
  printTextColorsSupported: PrinterColor[];
  labelMediaSupported: LabelMedia[];
};

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

const commonPeptideNames = [
  'AOD-9604',
  'BPC-157',
  'CJC-1295',
  'DSIP',
  'Epitalon',
  'GHK-Cu',
  'GHRP-2',
  'GHRP-6',
  'Gonadorelin',
  'Hexarelin',
  'Ipamorelin',
  'Kisspeptin-10',
  'KPV',
  'Melanotan II',
  'MOTS-c',
  'NAD+',
  'NADH',
  'PE-22-28',
  'PT-141',
  'Retatrutide',
  'Selank',
  'Semaglutide',
  'Sermorelin',
  'Tesamorelin',
  'Thymosin Alpha-1',
  'Tirzepatide',
  'TB-500',
] as const;

const peptideCategoryOptions = [
  'GLP',
  'Metabolic',
  'Mitochondrial',
  'Skin',
  'Bioregulators',
  'Recovery',
  'Sleep',
  'Cognitive',
  'Immune',
  'Hormone',
] as const;

const commonLabelSizes = ['40x20 mm', '50x30 mm', '28x14 mm', '31x31 mm', '50x50 mm'] as const;
const emptyNativeLabelForm: NativeLabelUploadForm = {
  previewDataUrl: '',
  previewFileName: '',
  niimbotCode: '',
  templateName: '',
  peptideName: '',
  massMg: '',
  labelSize: '',
  tags: '',
};

const peptideDefinitions: Record<string, { categories: string[] }> = {
  'AOD-9604': { categories: ['Metabolic'] },
  'BPC-157': { categories: ['Recovery'] },
  'CJC-1295': { categories: ['Hormone'] },
  DSIP: { categories: ['Sleep'] },
  Epitalon: { categories: ['Bioregulators'] },
  'GHK-Cu': { categories: ['Skin'] },
  'GHRP-2': { categories: ['Hormone'] },
  'GHRP-6': { categories: ['Hormone'] },
  Gonadorelin: { categories: ['Hormone'] },
  Hexarelin: { categories: ['Hormone'] },
  Ipamorelin: { categories: ['Hormone'] },
  'Kisspeptin-10': { categories: ['Hormone'] },
  KPV: { categories: ['Immune', 'Skin'] },
  'Melanotan II': { categories: ['Skin'] },
  'MOTS-c': { categories: ['Mitochondrial', 'Metabolic'] },
  'NAD+': { categories: ['Mitochondrial', 'Metabolic'] },
  NADH: { categories: ['Mitochondrial', 'Metabolic'] },
  'PE-22-28': { categories: ['Cognitive'] },
  'PT-141': { categories: ['Hormone'] },
  Retatrutide: { categories: ['GLP', 'Metabolic'] },
  Selank: { categories: ['Cognitive'] },
  Semaglutide: { categories: ['GLP', 'Metabolic'] },
  Sermorelin: { categories: ['Hormone'] },
  Tesamorelin: { categories: ['Hormone', 'Metabolic'] },
  'Thymosin Alpha-1': { categories: ['Bioregulators', 'Immune'] },
  Tirzepatide: { categories: ['GLP', 'Metabolic'] },
  'TB-500': { categories: ['Recovery'] },
};

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

const printerCatalog = printerCatalogData as PrinterConfig[];
const supportedLabelMediaIds = ['40x20', '50x30', '28x14-round'] as const;
const exportTypeOptions: DropdownOption[] = [
  { value: 'svg', label: 'SVG' },
  { value: 'png', label: 'PNG' },
  { value: 'pdf', label: 'PDF' },
];
const nativeSortOptions: DropdownOption[] = [
  { value: 'featured', label: 'Featured' },
  { value: 'popular', label: 'Most popular' },
  { value: 'az', label: 'A-Z' },
  { value: 'latest', label: 'Latest' },
];
const minExportDpi = 300;
const maxExportDpi = 2400;
const binaryWhiteThreshold = 235;
const maxNativePreviewBytes = 3 * 1024 * 1024;
const nativePreviewMimeTypes = ['image/png', 'image/jpeg', 'image/webp'];
const nativeReportReasons: { value: NativeLabelReportReason; label: string }[] = [
  { value: 'offensive', label: 'Offensive' },
  { value: 'spam', label: 'Spam' },
  { value: 'unsafe', label: 'Unsafe' },
  { value: 'other', label: 'Other' },
];

function LabelsPage({ isAdmin = false }: { isAdmin?: boolean }) {
  const defaultPrinter = printerCatalog[0];
  const [selectedTemplateId, setSelectedTemplateId] = useState(labelTemplates[0].id);
  const [selectedPeptideType, setSelectedPeptideType] = useState<'all' | string>('all');
  const [selectedExportType, setSelectedExportType] = useState<ExportType>('svg');
  const [selectedExportDpi, setSelectedExportDpi] = useState(defaultPrinter.resolutionDpi * 2);
  const [isExporting, setIsExporting] = useState(false);
  const [labelFormData, setLabelFormData] = useState<LabelFormData>(labelFormDefaults);
  const [uploadedTemplates, setUploadedTemplates] = useState<LabelTemplate[]>([]);
  const [nativeLabelTemplates, setNativeLabelTemplates] = useState<NativeLabelTemplate[]>([]);
  const [nativeTemplateStatus, setNativeTemplateStatus] = useState('Loading templates...');
  const [nativeSearchQuery, setNativeSearchQuery] = useState('');
  const [nativeCategoryFilters, setNativeCategoryFilters] = useState<string[]>([]);
  const [nativeLabelSizeFilter, setNativeLabelSizeFilter] = useState('all');
  const [nativeTagFilter, setNativeTagFilter] = useState('');
  const [nativeSortKey, setNativeSortKey] = useState<NativeSortKey>('featured');
  const [isNativeSortReversed, setIsNativeSortReversed] = useState(false);
  const [expandedNativeLabelId, setExpandedNativeLabelId] = useState<string | null>(null);
  const [nativeUploadForm, setNativeUploadForm] = useState<NativeLabelUploadForm>(emptyNativeLabelForm);
  const [nativeUploadStartedAt, setNativeUploadStartedAt] = useState(Date.now());
  const [nativeUploadTrap, setNativeUploadTrap] = useState('');
  const [editingNativeLabel, setEditingNativeLabel] = useState<NativeLabelTemplate | null>(null);
  const [nativeEditForm, setNativeEditForm] = useState<NativeLabelUploadForm>(emptyNativeLabelForm);
  const [nativeEditStatus, setNativeEditStatus] = useState('');
  const [reportingNativeLabel, setReportingNativeLabel] = useState<NativeLabelTemplate | null>(null);
  const [nativeReportReason, setNativeReportReason] = useState<NativeLabelReportReason>('offensive');
  const [nativeReportDetails, setNativeReportDetails] = useState('');
  const [nativeReportStatus, setNativeReportStatus] = useState('');
  const [localVotes, setLocalVotes] = useState<Record<string, boolean>>({});
  const [selectedPrinterId, setSelectedPrinterId] = useState(defaultPrinter.id);
  const [availablePrintColorIds, setAvailablePrintColorIds] = useState<string[]>(
    defaultPrinter.printTextColorsSupported.map((color) => color.id),
  );
  const [selectedPrintColorId, setSelectedPrintColorId] = useState(
    defaultPrinter.printTextColorsSupported[0].id,
  );
  const [selectedLabelMediaId, setSelectedLabelMediaId] = useState(
    defaultPrinter.labelMediaSupported[0].id,
  );
  const [selectedLabelColorId, setSelectedLabelColorId] = useState(
    defaultPrinter.labelMediaSupported[0].colorIds[0],
  );
  const [uploadForm, setUploadForm] = useState<UploadedLabelForm>({
    name: '',
    author: '',
    peptideType: 'Generic',
    generic: true,
  });

  useEffect(() => {
    let isMounted = true;

    fetchNativeLabelTemplates()
      .then((templates) => {
        if (!isMounted) {
          return;
        }

        setNativeLabelTemplates(templates);
        setNativeTemplateStatus('');
      })
      .catch(() => {
        if (!isMounted) {
          return;
        }

        setNativeTemplateStatus('Server storage is unavailable. Start the app with the Node server to persist labels.');
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const selectedPrinter =
    printerCatalog.find((printer) => printer.id === selectedPrinterId) ?? defaultPrinter;
  const supportedLabelMediaOptions = selectedPrinter.labelMediaSupported.filter((media) =>
    supportedLabelMediaIds.includes(media.id as (typeof supportedLabelMediaIds)[number]),
  );
  const selectedLabelMedia =
    supportedLabelMediaOptions.find((media) => media.id === selectedLabelMediaId) ??
    supportedLabelMediaOptions[0] ??
    selectedPrinter.labelMediaSupported[0];
  const supportedLabelColors = selectedPrinter.labelColorsSupported.filter((color) =>
    selectedLabelMedia.colorIds.includes(color.id),
  );
  const selectedLabelColor =
    selectedPrinter.labelColorsSupported.find(
      (color) => color.id === selectedLabelColorId && selectedLabelMedia.colorIds.includes(color.id),
    ) ??
    supportedLabelColors[0] ??
    selectedPrinter.labelColorsSupported[0];
  const availablePrintColors = selectedPrinter.printTextColorsSupported.filter((color) =>
    availablePrintColorIds.includes(color.id),
  );
  const selectedPrintColor =
    availablePrintColors.find((color) => color.id === selectedPrintColorId) ??
    availablePrintColors[0] ??
    selectedPrinter.printTextColorsSupported[0];
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
  const nativeCategoryOptions = getUniqueSortedValues([...peptideCategoryOptions]);
  const nativeLabelSizeOptions = getUniqueSortedValues([
    ...commonLabelSizes,
    ...nativeLabelTemplates.map((template) => template.labelSize ?? ''),
  ]);
  const nativeTagOptions = getUniqueSortedValues(nativeLabelTemplates.flatMap((template) => template.tags ?? []));
  const nativeFavoriteIds = new Set(
    [...nativeLabelTemplates]
      .filter((template) => getNativeLabelVotes(template) > 0)
      .sort((first, second) => getNativeLabelVotes(second) - getNativeLabelVotes(first))
      .slice(0, 3)
      .map((template) => template.id),
  );
  const filteredNativeLabelTemplates = nativeLabelTemplates
    .filter((template) =>
      matchesNativeLabelFilters(
        template,
        nativeSearchQuery,
        nativeCategoryFilters,
        nativeLabelSizeFilter,
        nativeTagFilter,
      ),
    )
    .sort((first, second) => {
      const sortResult = compareNativeLabels(first, second, nativeSortKey, nativeFavoriteIds);

      return isNativeSortReversed ? -sortResult : sortResult;
    });

  const updateLabelField = (field: keyof LabelFormData, value: string) => {
    setLabelFormData((currentData) => ({
      ...currentData,
      [field]: value,
    }));
  };

  const updateSelectedPrinter = (printerId: string) => {
    const nextPrinter = printerCatalog.find((printer) => printer.id === printerId) ?? defaultPrinter;

    setSelectedPrinterId(nextPrinter.id);
    const nextSupportedMedia =
      nextPrinter.labelMediaSupported.find((media) =>
        supportedLabelMediaIds.includes(media.id as (typeof supportedLabelMediaIds)[number]),
      ) ?? nextPrinter.labelMediaSupported[0];

    setSelectedLabelMediaId(nextSupportedMedia.id);
    setSelectedLabelColorId(nextSupportedMedia.colorIds[0]);
    setAvailablePrintColorIds(nextPrinter.printTextColorsSupported.map((color) => color.id));
    setSelectedPrintColorId(nextPrinter.printTextColorsSupported[0].id);
  };

  const updateSelectedLabelMedia = (mediaId: string) => {
    const nextMedia =
      supportedLabelMediaOptions.find((media) => media.id === mediaId) ??
      supportedLabelMediaOptions[0] ??
      selectedPrinter.labelMediaSupported[0];

    setSelectedLabelMediaId(nextMedia.id);

    if (!nextMedia.colorIds.includes(selectedLabelColorId)) {
      setSelectedLabelColorId(nextMedia.colorIds[0]);
    }
  };

  const toggleAvailablePrintColor = (colorId: string) => {
    setAvailablePrintColorIds((currentColorIds) => {
      if (currentColorIds.includes(colorId)) {
        const nextColorIds = currentColorIds.filter((currentColorId) => currentColorId !== colorId);

        if (nextColorIds.length === 0) {
          return currentColorIds;
        }

        if (selectedPrintColorId === colorId) {
          setSelectedPrintColorId(nextColorIds[0]);
        }

        return nextColorIds;
      }

      return [...currentColorIds, colorId];
    });
  };

  const uploadTemplate = (event: FormEvent<HTMLFormElement>) => {
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

  const updateNativeUploadField = (field: keyof NativeLabelUploadForm, value: string) => {
    setNativeUploadForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }));
  };

  const toggleNativeCategoryFilter = (category: string) => {
    setNativeCategoryFilters((currentCategories) =>
      currentCategories.includes(category)
        ? currentCategories.filter((currentCategory) => currentCategory !== category)
        : [...currentCategories, category],
    );
  };

  const updateNativeCode = (value: string) => {
    const parsedShare = parseNiimbotShareText(value);

    setNativeUploadForm((currentForm) => ({
      ...currentForm,
      niimbotCode: parsedShare.codeWithDelimiters ?? value,
      templateName:
        currentForm.templateName.trim() || !parsedShare.templateName
          ? currentForm.templateName
          : parsedShare.templateName,
    }));
  };

  const loadNativePreviewFile = (file: File, onLoad: (previewDataUrl: string, previewFileName: string) => void) => {
    const fileError = validateNativePreviewFile(file);

    if (fileError) {
      setNativeTemplateStatus(fileError);
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      onLoad(String(reader.result ?? ''), file.name || `clipboard-preview-${Date.now()}.png`);
    };
    reader.onerror = () => {
      setNativeTemplateStatus('Could not read that preview image.');
    };
    reader.readAsDataURL(file);
  };

  const updateNativePreview = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      setNativeUploadForm((currentForm) => ({
        ...currentForm,
        previewDataUrl: '',
        previewFileName: '',
      }));
      return;
    }

    loadNativePreviewFile(file, (previewDataUrl, previewFileName) => {
      setNativeUploadForm((currentForm) => ({
        ...currentForm,
        previewDataUrl,
        previewFileName,
      }));
      setNativeTemplateStatus('');
    });
  };

  const pasteNativePreview = (event: ClipboardEvent<HTMLFormElement>) => {
    const imageItem = Array.from(event.clipboardData.items).find(
      (item) => item.kind === 'file' && item.type.startsWith('image/'),
    );
    const file = imageItem?.getAsFile();

    if (!file) {
      return;
    }

    event.preventDefault();
    loadNativePreviewFile(file, (previewDataUrl, previewFileName) => {
      setNativeUploadForm((currentForm) => ({
        ...currentForm,
        previewDataUrl,
        previewFileName,
      }));
      setNativeTemplateStatus('');
    });
  };

  const uploadNativeTemplate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const niimbotCode = nativeUploadForm.niimbotCode.trim();
    const labelSize = normalizeLabelSize(nativeUploadForm.labelSize);
    const peptideName = nativeUploadForm.peptideName.trim();
    const massMg = nativeUploadForm.massMg.trim();
    const tags = parseNativeTags(nativeUploadForm.tags);

    if (!nativeUploadForm.previewDataUrl || !niimbotCode || !peptideName || !massMg || !labelSize) {
      return;
    }

    const nativeTemplate: NativeLabelTemplate = {
      id: `niimbot-${Date.now()}`,
      previewDataUrl: nativeUploadForm.previewDataUrl,
      previewFileName: nativeUploadForm.previewFileName,
      niimbotCode,
      templateName: nativeUploadForm.templateName.trim() || undefined,
      peptideName,
      massMg,
      labelSize,
      peptideCategories: getPeptideCategories(peptideName).slice(0, 3),
      tags,
      votes: 0,
    };

    try {
      const templates = await saveNativeLabelTemplate(nativeTemplate, {
        formStartedAt: nativeUploadStartedAt,
        honeypot: nativeUploadTrap,
      });

      setNativeLabelTemplates(templates);
      setNativeTemplateStatus('');
      setNativeUploadForm(emptyNativeLabelForm);
      setNativeUploadTrap('');
      setNativeUploadStartedAt(Date.now());
      event.currentTarget.reset();
    } catch (error) {
      console.error(error);
      setNativeTemplateStatus('Could not save to server storage. Make sure the Node server is running.');
    }
  };

  const toggleVote = (templateId: string) => {
    setLocalVotes((currentVotes) => ({
      ...currentVotes,
      [templateId]: !currentVotes[templateId],
    }));
  };

  const openNativeLabelEditor = (template: NativeLabelTemplate) => {
    setEditingNativeLabel(template);
    setNativeEditForm({
      previewDataUrl: template.previewDataUrl,
      previewFileName: template.previewFileName,
      niimbotCode: template.niimbotCode,
      templateName: template.templateName ?? '',
      peptideName: template.peptideName ?? '',
      massMg: template.massMg ?? '',
      labelSize: template.labelSize ?? '',
      tags: (template.tags ?? []).join(', '),
    });
    setNativeEditStatus('');
  };

  const closeNativeLabelEditor = () => {
    setEditingNativeLabel(null);
    setNativeEditForm(emptyNativeLabelForm);
    setNativeEditStatus('');
  };

  const updateNativeEditField = (field: keyof NativeLabelUploadForm, value: string) => {
    setNativeEditForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }));
  };

  const updateNativeEditCode = (value: string) => {
    const parsedShare = parseNiimbotShareText(value);

    setNativeEditForm((currentForm) => ({
      ...currentForm,
      niimbotCode: parsedShare.codeWithDelimiters ?? value,
      templateName:
        currentForm.templateName.trim() || !parsedShare.templateName
          ? currentForm.templateName
          : parsedShare.templateName,
    }));
  };

  const updateNativeEditPreview = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const fileError = validateNativePreviewFile(file);

    if (fileError) {
      setNativeEditStatus(fileError);
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      setNativeEditForm((currentForm) => ({
        ...currentForm,
        previewDataUrl: String(reader.result ?? ''),
        previewFileName: file.name || `edited-preview-${Date.now()}.png`,
      }));
    };
    reader.onerror = () => {
      setNativeEditStatus('Could not read that preview image.');
    };
    reader.readAsDataURL(file);
  };

  const saveNativeLabelEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!editingNativeLabel) {
      return;
    }

    const labelSize = normalizeLabelSize(nativeEditForm.labelSize);
    const peptideName = nativeEditForm.peptideName.trim();
    const massMg = nativeEditForm.massMg.trim();
    const niimbotCode = nativeEditForm.niimbotCode.trim();

    if (!nativeEditForm.previewDataUrl || !niimbotCode || !peptideName || !massMg || !labelSize) {
      setNativeEditStatus('Complete the required fields before saving.');
      return;
    }

    const nextTemplate: NativeLabelTemplate = {
      ...editingNativeLabel,
      previewDataUrl: nativeEditForm.previewDataUrl,
      previewFileName: nativeEditForm.previewFileName,
      niimbotCode,
      templateName: nativeEditForm.templateName.trim() || undefined,
      peptideName,
      massMg,
      labelSize,
      peptideCategories: getPeptideCategories(peptideName).slice(0, 3),
      tags: parseNativeTags(nativeEditForm.tags),
    };

    try {
      const templates = await updateNativeLabelTemplate(nextTemplate);

      setNativeLabelTemplates(templates);
      closeNativeLabelEditor();
    } catch (error) {
      console.error(error);
      setNativeEditStatus('Could not save changes. Check your admin session and try again.');
    }
  };

  const deleteNativeLabel = async () => {
    if (!editingNativeLabel) {
      return;
    }

    const title = getNativeLabelTitle(editingNativeLabel);
    const confirmed = window.confirm(`Delete "${title}" from the label library? This cannot be undone.`);

    if (!confirmed) {
      return;
    }

    try {
      const templates = await deleteNativeLabelTemplate(editingNativeLabel.id);

      setNativeLabelTemplates(templates);
      closeNativeLabelEditor();
    } catch (error) {
      console.error(error);
      setNativeEditStatus('Could not delete this template. Check your admin session and try again.');
    }
  };

  const toggleNativeLabelVote = async (template: NativeLabelTemplate) => {
    const wasVoted = localVotes[template.id] ?? false;
    const direction = wasVoted ? -1 : 1;
    const nextTemplate = {
      ...template,
      votes: Math.max(0, getNativeLabelVotes(template) + direction),
    };

    setLocalVotes((currentVotes) => ({
      ...currentVotes,
      [template.id]: !wasVoted,
    }));
    setNativeLabelTemplates((currentTemplates) =>
      currentTemplates.map((currentTemplate) =>
        currentTemplate.id === template.id ? nextTemplate : currentTemplate,
      ),
    );

    try {
      const templates = await voteNativeLabelTemplate(template.id, direction);

      setNativeLabelTemplates(templates);
      setNativeTemplateStatus('');
    } catch (error) {
      console.error(error);
      setLocalVotes((currentVotes) => ({
        ...currentVotes,
        [template.id]: wasVoted,
      }));
      setNativeLabelTemplates((currentTemplates) =>
        currentTemplates.map((currentTemplate) =>
          currentTemplate.id === template.id ? template : currentTemplate,
        ),
      );
      setNativeTemplateStatus('Could not save vote to server storage. Make sure the Node server is running.');
    }
  };

  const openNativeLabelReport = (template: NativeLabelTemplate) => {
    setReportingNativeLabel(template);
    setNativeReportReason('offensive');
    setNativeReportDetails('');
    setNativeReportStatus('');
  };

  const closeNativeLabelReport = () => {
    setReportingNativeLabel(null);
    setNativeReportDetails('');
    setNativeReportStatus('');
  };

  const submitNativeLabelReport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!reportingNativeLabel) {
      return;
    }

    try {
      const templates = await reportNativeLabelTemplate(
        reportingNativeLabel.id,
        nativeReportReason,
        nativeReportDetails,
      );

      setNativeLabelTemplates(templates);
      closeNativeLabelReport();
      setNativeTemplateStatus('Thanks for the report. Admins will review it.');
    } catch (error) {
      console.error(error);
      setNativeReportStatus('Could not submit the report. Try again later.');
    }
  };

  const updateNativeLabelModeration = async (
    template: NativeLabelTemplate,
    moderationStatus: NonNullable<NativeLabelTemplate['moderationStatus']>,
    clearReports = false,
  ) => {
    try {
      const templates = await updateNativeLabelTemplate({
        ...template,
        moderationStatus,
        clearReports,
      });

      setNativeLabelTemplates(templates);
      setNativeTemplateStatus('');
    } catch (error) {
      console.error(error);
      setNativeTemplateStatus('Could not update moderation. Check your admin session.');
    }
  };

  const downloadGeneratedLabel = async () => {
    setIsExporting(true);

    try {
      const binarySvg = createBinaryLabelSvg(generatedSvg);
      const fileName = getLabelFileName(labelFormData, selectedTemplate);

      if (selectedExportType === 'svg') {
        downloadBlob(new Blob([binarySvg], { type: 'image/svg+xml' }), `${fileName}.svg`);
        return;
      }

      if (selectedExportType === 'pdf') {
        const pdfBlob = createVectorPdfBlob(selectedTemplate, labelFormData);
        downloadBlob(pdfBlob, `${fileName}-${selectedExportDpi}dpi.pdf`);
        return;
      }

      const rasterSvg = await inlineSvgImages(binarySvg);
      const rasterLabel = await renderBinarySvgToCanvas(
        rasterSvg,
        selectedExportDpi,
        selectedLabelMedia,
      );

      if (selectedExportType === 'png') {
        const pngBlob = await canvasToBlob(rasterLabel.canvas, 'image/png');
        downloadBlob(pngBlob, `${fileName}-${selectedExportDpi}dpi.png`);
      }
    } catch (error) {
      console.error(error);
      window.alert('The label export failed. Try SVG export or remove the COA link and export again.');
    } finally {
      setIsExporting(false);
    }
  };

  const isGeneratorDisabled = true;

  if (isGeneratorDisabled) {
    return (
      <>
        <PageHero
          eyebrow="NIIMBOT Library"
          title="Native label library"
          text="Store NIIMBOT-native label template codes with screenshot previews and optional peptide metadata."
        />

        <section className="label-page label-page--native" aria-labelledby="native-label-library-title">
          <div className="native-label-layout">
            <aside className="native-label-filters" aria-label="Filter NIIMBOT templates">
              <div>
                <p className="eyebrow">Filters</p>
                <h2>Find labels</h2>
              </div>

              <label className="filter-search">
                <span>Search</span>
                <input
                  type="search"
                  value={nativeSearchQuery}
                  placeholder="Peptide, template, tag..."
                  onChange={(event) => setNativeSearchQuery(event.target.value)}
                />
              </label>

              <fieldset className="filter-group">
                <legend>Peptide category</legend>
                <DropdownSelect
                  value="category-dropdown"
                  options={[
                    { value: 'category-dropdown', label: 'Select category' },
                    ...nativeCategoryOptions
                      .filter((category) => !nativeCategoryFilters.includes(category))
                      .map((category) => ({
                        value: category,
                        label: category,
                      })),
                  ]}
                  onChange={(value) => {
                    if (value !== 'category-dropdown') {
                      toggleNativeCategoryFilter(value);
                    }
                  }}
                />
                <div className="native-filter-chips">
                  {nativeCategoryFilters.length > 0 ? (
                    <>
                      {nativeCategoryFilters.map((category) => (
                        <button type="button" key={category} onClick={() => toggleNativeCategoryFilter(category)}>
                          {category}
                          <span className="native-filter-chips__remove" aria-hidden="true" />
                        </button>
                      ))}
                      {nativeCategoryFilters.length >= 2 && (
                        <button
                          className="native-filter-chips__clear"
                          type="button"
                          onClick={() => setNativeCategoryFilters([])}
                        >
                          Clear all
                        </button>
                      )}
                    </>
                  ) : (
                    <span>All categories</span>
                  )}
                </div>
              </fieldset>

              <label className="label-field">
                <span>Label size</span>
                <DropdownSelect
                  value={nativeLabelSizeFilter}
                  options={[
                    { value: 'all', label: 'All sizes' },
                    ...nativeLabelSizeOptions.map((labelSize) => ({
                      value: labelSize,
                      label: labelSize,
                    })),
                  ]}
                  onChange={setNativeLabelSizeFilter}
                />
              </label>

              <label className="filter-search">
                <span>Tags</span>
                <input
                  type="search"
                  list="native-tag-filter-options"
                  value={nativeTagFilter}
                  placeholder="Style, color, label type..."
                  onChange={(event) => setNativeTagFilter(event.target.value)}
                />
                <datalist id="native-tag-filter-options">
                  {nativeTagOptions.map((tag) => (
                    <option value={tag} key={tag} />
                  ))}
                </datalist>
              </label>
            </aside>

            <section className="native-label-library" aria-label="NIIMBOT label templates">
              <div className="native-label-library__header">
                <div>
                  <p className="eyebrow">Library</p>
                  <h2 id="native-label-library-title">NIIMBOT templates</h2>
                </div>
                <div className="native-label-library__tools">
                  <span>
                    {filteredNativeLabelTemplates.length} of {nativeLabelTemplates.length} saved
                  </span>
                  <div className="native-sort-controls" aria-label="Sort labels">
                    <DropdownSelect
                      value={nativeSortKey}
                      options={nativeSortOptions}
                      onChange={(value) => setNativeSortKey(value as NativeSortKey)}
                    />
                    <button
                      className={isNativeSortReversed ? 'native-sort-order is-reversed' : 'native-sort-order'}
                      type="button"
                      aria-label={isNativeSortReversed ? 'Use default sort order' : 'Reverse sort order'}
                      aria-pressed={isNativeSortReversed}
                      onClick={() => setIsNativeSortReversed((currentValue) => !currentValue)}
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24">
                        <path d="M7 4h2v12h3l-4 4-4-4h3V4Zm8 0 4 4h-3v12h-2V8h-3l4-4Z" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>

              {nativeTemplateStatus && <p className="native-label-status">{nativeTemplateStatus}</p>}

              {filteredNativeLabelTemplates.length > 0 ? (
                <div className="native-label-grid">
                  {filteredNativeLabelTemplates.map((template) => (
                    <NativeLabelTemplateCard
                      template={template}
                      isAdmin={isAdmin}
                      isTagListExpanded={expandedNativeLabelId === template.id}
                      isVoted={localVotes[template.id] ?? false}
                      isCommunityFavorite={nativeFavoriteIds.has(template.id)}
                      key={template.id}
                      votes={getNativeLabelVotes(template)}
                      onSelectLabel={() =>
                        setExpandedNativeLabelId((currentId) =>
                          currentId === template.id ? currentId : null,
                        )
                      }
                      onToggleTagList={() =>
                        setExpandedNativeLabelId((currentId) =>
                          currentId === template.id ? null : template.id,
                        )
                      }
                      onVote={() => {
                        void toggleNativeLabelVote(template);
                      }}
                      onReport={() => openNativeLabelReport(template)}
                      onEdit={() => openNativeLabelEditor(template)}
                      onApprove={() => {
                        void updateNativeLabelModeration(template, 'approved', true);
                      }}
                      onPend={() => {
                        void updateNativeLabelModeration(template, 'pending');
                      }}
                      onReject={() => {
                        void updateNativeLabelModeration(template, 'rejected');
                      }}
                      onClearReports={() => {
                        void updateNativeLabelModeration(template, template.moderationStatus ?? 'pending', true);
                      }}
                    />
                  ))}
                </div>
              ) : (
                <div className="native-label-empty">
                  <strong>{nativeLabelTemplates.length > 0 ? 'No matches' : 'No NIIMBOT templates yet'}</strong>
                  <span>
                    {nativeLabelTemplates.length > 0
                      ? 'Adjust the filters or search text.'
                      : 'Upload a screenshot preview and template code to start the library.'}
                  </span>
                </div>
              )}
            </section>

            <aside className="label-panel native-label-upload" aria-label="Upload NIIMBOT template">
              <form className="label-upload" onPaste={pasteNativePreview} onSubmit={uploadNativeTemplate}>
                <div>
                  <p className="eyebrow">Upload</p>
                  <h2>Add template</h2>
                </div>

                <label className="label-field">
                  <span>Template name</span>
                  <input
                    type="text"
                    value={nativeUploadForm.templateName}
                    onChange={(event) => updateNativeUploadField('templateName', event.target.value)}
                  />
                </label>

                <label className="label-field">
                  <span>Screenshot preview *</span>
                  <input
                    type="file"
                    accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                    aria-required="true"
                    onChange={updateNativePreview}
                  />
                </label>

                <input
                  className="label-honeypot"
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={nativeUploadTrap}
                  onChange={(event) => setNativeUploadTrap(event.target.value)}
                />

                {nativeUploadForm.previewDataUrl && (
                  <div className="native-upload-preview">
                    <img src={nativeUploadForm.previewDataUrl} alt="" />
                    <span>{nativeUploadForm.previewFileName}</span>
                  </div>
                )}

                <label className="label-field">
                  <span>NIIMBOT share code *</span>
                  <textarea
                    required
                    value={nativeUploadForm.niimbotCode}
                    rows={3}
                    onChange={(event) => updateNativeCode(event.target.value)}
                  />
                </label>

                <label className="label-field">
                  <span>Peptide name</span>
                  <input
                    type="text"
                    list="common-peptide-names"
                    required
                    value={nativeUploadForm.peptideName}
                    onChange={(event) => updateNativeUploadField('peptideName', event.target.value)}
                  />
                  <datalist id="common-peptide-names">
                    {commonPeptideNames.map((peptideName) => (
                      <option value={peptideName} key={peptideName} />
                    ))}
                  </datalist>
                </label>

                <label className="label-field">
                  <span>Mass (mg)</span>
                  <input
                    type="text"
                    required
                    value={nativeUploadForm.massMg}
                    onChange={(event) => updateNativeUploadField('massMg', event.target.value)}
                  />
                </label>

                <label className="label-field">
                  <span>Label size *</span>
                  <input
                    type="text"
                    list="native-label-sizes"
                    required
                    placeholder="40x20 mm"
                    value={nativeUploadForm.labelSize}
                    onChange={(event) => updateNativeUploadField('labelSize', event.target.value)}
                  />
                  <datalist id="native-label-sizes">
                    {nativeLabelSizeOptions.map((labelSize) => (
                      <option value={labelSize} key={labelSize} />
                    ))}
                  </datalist>
                </label>

                <label className="label-field">
                  <span>Tags</span>
                  <input
                    type="text"
                    value={nativeUploadForm.tags}
                    placeholder="black print, vial wrap, minimal"
                    onChange={(event) => updateNativeUploadField('tags', event.target.value)}
                  />
                </label>

                <button className="label-primary-action" type="submit">
                  Add to Library
                </button>
              </form>
            </aside>
          </div>
        </section>

        {isAdmin && editingNativeLabel && (
          <div className="admin-modal-backdrop" role="presentation">
            <section
              className="admin-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="native-label-edit-title"
            >
              <form className="admin-modal__content" onSubmit={saveNativeLabelEdit}>
                <div className="admin-modal__header">
                  <div>
                    <p className="eyebrow">Admin edit</p>
                    <h2 id="native-label-edit-title">Label template</h2>
                  </div>
                  <button
                    className="admin-modal__close"
                    type="button"
                    aria-label="Close editor"
                    onClick={closeNativeLabelEditor}
                  >
                    x
                  </button>
                </div>

                <label className="label-field">
                  <span>Template name</span>
                  <input
                    type="text"
                    value={nativeEditForm.templateName}
                    onChange={(event) => updateNativeEditField('templateName', event.target.value)}
                  />
                </label>

                <label className="label-field">
                  <span>Screenshot preview</span>
                  <input
                    type="file"
                    accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                    onChange={updateNativeEditPreview}
                  />
                </label>

                {nativeEditForm.previewDataUrl && (
                  <div className="native-upload-preview">
                    <img src={nativeEditForm.previewDataUrl} alt="" />
                    <span>{nativeEditForm.previewFileName}</span>
                  </div>
                )}

                <label className="label-field">
                  <span>NIIMBOT share code *</span>
                  <textarea
                    required
                    value={nativeEditForm.niimbotCode}
                    rows={3}
                    onChange={(event) => updateNativeEditCode(event.target.value)}
                  />
                </label>

                <label className="label-field">
                  <span>Peptide name *</span>
                  <input
                    type="text"
                    list="common-peptide-names"
                    required
                    value={nativeEditForm.peptideName}
                    onChange={(event) => updateNativeEditField('peptideName', event.target.value)}
                  />
                </label>

                <label className="label-field">
                  <span>Mass (mg) *</span>
                  <input
                    type="text"
                    required
                    value={nativeEditForm.massMg}
                    onChange={(event) => updateNativeEditField('massMg', event.target.value)}
                  />
                </label>

                <label className="label-field">
                  <span>Label size *</span>
                  <input
                    type="text"
                    list="native-label-sizes"
                    required
                    value={nativeEditForm.labelSize}
                    onChange={(event) => updateNativeEditField('labelSize', event.target.value)}
                  />
                </label>

                <label className="label-field">
                  <span>Tags</span>
                  <input
                    type="text"
                    value={nativeEditForm.tags}
                    onChange={(event) => updateNativeEditField('tags', event.target.value)}
                  />
                </label>

                {nativeEditStatus && <p className="admin-status">{nativeEditStatus}</p>}

                <div className="admin-modal__actions">
                  <button className="admin-delete-button" type="button" onClick={deleteNativeLabel}>
                    Delete
                  </button>
                  <button className="label-primary-action" type="submit">
                    Save Changes
                  </button>
                </div>
              </form>
            </section>
          </div>
        )}

        {reportingNativeLabel && (
          <div className="admin-modal-backdrop" role="presentation">
            <section
              className="admin-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="native-label-report-title"
            >
              <form className="admin-modal__content" onSubmit={submitNativeLabelReport}>
                <div className="admin-modal__header">
                  <div>
                    <p className="eyebrow">Report</p>
                    <h2 id="native-label-report-title">{getNativeLabelTitle(reportingNativeLabel)}</h2>
                  </div>
                  <button
                    className="admin-modal__close"
                    type="button"
                    aria-label="Close report"
                    onClick={closeNativeLabelReport}
                  >
                    x
                  </button>
                </div>

                <label className="label-field">
                  <span>Reason</span>
                  <DropdownSelect
                    value={nativeReportReason}
                    options={nativeReportReasons}
                    onChange={(value) => setNativeReportReason(value as NativeLabelReportReason)}
                  />
                </label>

                <label className="label-field">
                  <span>Details</span>
                  <textarea
                    rows={3}
                    maxLength={400}
                    value={nativeReportDetails}
                    onChange={(event) => setNativeReportDetails(event.target.value)}
                  />
                </label>

                {nativeReportStatus && <p className="admin-status">{nativeReportStatus}</p>}

                <div className="admin-modal__actions">
                  <button className="admin-delete-button" type="button" onClick={closeNativeLabelReport}>
                    Cancel
                  </button>
                  <button className="label-primary-action" type="submit">
                    Submit Report
                  </button>
                </div>
              </form>
            </section>
          </div>
        )}
      </>
    );
  }

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
              <DropdownSelect
                value={selectedPeptideType}
                options={[
                  { value: 'all', label: 'All labels' },
                  ...labelPeptideTypes.map((peptideType) => ({
                    value: peptideType,
                    label: peptideType,
                  })),
                ]}
                onChange={setSelectedPeptideType}
              />
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
                  onVote={() => toggleVote(template.id)}
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
              <div className="label-export-controls">
                <label className="label-field">
                  <span>Export type</span>
                  <DropdownSelect
                    value={selectedExportType}
                    options={exportTypeOptions}
                    onChange={(value) => setSelectedExportType(value as ExportType)}
                  />
                </label>
                <label className="label-field label-field--range">
                  <span>Output DPI</span>
                  <input
                    type="range"
                    min={minExportDpi}
                    max={maxExportDpi}
                    step="50"
                    value={selectedExportDpi}
                    onChange={(event) => setSelectedExportDpi(Number(event.target.value))}
                  />
                  <strong>{selectedExportDpi} DPI</strong>
                </label>
                <button
                  className="label-primary-action"
                  type="button"
                  disabled={isExporting}
                  onClick={() => {
                    void downloadGeneratedLabel();
                  }}
                >
                  {isExporting ? 'Exporting...' : `Download ${selectedExportType.toUpperCase()}`}
                </button>
              </div>
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

            <section className="printer-settings" aria-labelledby="printer-settings-title">
              <div className="printer-settings__header">
                <div>
                  <p className="eyebrow">Printer</p>
                  <h3 id="printer-settings-title">Printer setup</h3>
                </div>
                <span>
                  {selectedPrinter.supportedLabelSizeMm.min.width}-
                  {selectedPrinter.supportedLabelSizeMm.max.width} mm width
                </span>
              </div>

              <div className="printer-settings__grid">
                <label className="label-field">
                  <span>Printer model</span>
                  <DropdownSelect
                    value={selectedPrinterId}
                    options={printerCatalog.map((printer) => ({
                      value: printer.id,
                      label: `${printer.brand} ${printer.printer.model}`,
                    }))}
                    onChange={updateSelectedPrinter}
                  />
                </label>

                <div className="label-field">
                  <span>Label size</span>
                  <DropdownSelect
                    value={selectedLabelMedia.id}
                    options={supportedLabelMediaOptions.map((media) => ({
                      value: media.id,
                      label: media.name,
                    }))}
                    onChange={updateSelectedLabelMedia}
                  />
                </div>

                <label className="label-field">
                  <span>Label color</span>
                  <DropdownSelect
                    value={selectedLabelColor.id}
                    options={supportedLabelColors.map((color) => ({
                      value: color.id,
                      label: color.name,
                    }))}
                    onChange={setSelectedLabelColorId}
                  />
                </label>

                <label className="label-field">
                  <span>Active print color</span>
                  <DropdownSelect
                    value={selectedPrintColor.id}
                    options={availablePrintColors.map((color) => ({
                      value: color.id,
                      label: color.name,
                    }))}
                    onChange={setSelectedPrintColorId}
                  />
                </label>

                <div className="printer-summary" aria-label="Selected label media summary">
                  <span
                    className="printer-summary__swatch"
                    style={{ background: selectedLabelColor.hex }}
                    aria-hidden="true"
                  />
                  <div>
                    <strong>
                      {selectedLabelMedia.widthMm} x {selectedLabelMedia.heightMm} mm
                    </strong>
                    <span>
                      {selectedLabelColor.name} {selectedLabelMedia.shape}
                    </span>
                  </div>
                </div>
              </div>

              <fieldset className="printer-color-picker">
                <legend>Available print colors</legend>
                <div>
                  {selectedPrinter.printTextColorsSupported.map((color) => (
                    <label className="printer-color-option" key={color.id}>
                      <input
                        type="checkbox"
                        checked={availablePrintColorIds.includes(color.id)}
                        onChange={() => toggleAvailablePrintColor(color.id)}
                      />
                      <span
                        className="printer-color-option__swatch"
                        style={{
                          background: color.secondaryHex
                            ? `linear-gradient(135deg, ${color.hex} 0 50%, ${color.secondaryHex} 50% 100%)`
                            : color.hex,
                        }}
                        aria-hidden="true"
                      />
                      <span>{color.name}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </section>
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
                  <DropdownSelect
                    value={uploadForm.peptideType}
                    options={labelPeptideTypes
                      .filter((peptideType) => peptideType !== 'Generic')
                      .map((peptideType) => ({
                        value: peptideType,
                        label: peptideType,
                      }))}
                    onChange={(value) =>
                      setUploadForm((currentForm) => ({
                        ...currentForm,
                        peptideType: value,
                      }))
                    }
                  />
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

function NativeLabelTemplateCard({
  template,
  isAdmin,
  isTagListExpanded,
  isVoted,
  isCommunityFavorite,
  onSelectLabel,
  onToggleTagList,
  onVote,
  onReport,
  onEdit,
  onApprove,
  onPend,
  onReject,
  onClearReports,
  votes,
}: {
  template: NativeLabelTemplate;
  isAdmin: boolean;
  isTagListExpanded: boolean;
  isVoted: boolean;
  isCommunityFavorite: boolean;
  onSelectLabel: () => void;
  onToggleTagList: () => void;
  onVote: () => void;
  onReport: () => void;
  onEdit: () => void;
  onApprove: () => void;
  onPend: () => void;
  onReject: () => void;
  onClearReports: () => void;
  votes: number;
}) {
  const title = getNativeLabelTitle(template);
  const moderationStatus = template.moderationStatus ?? 'approved';
  const reportCount = Math.max(0, Math.round(template.reportCount ?? 0));
  const metadata = [
    template.peptideName ?? '',
    template.massMg ? `${template.massMg} mg` : '',
    template.labelSize ?? '',
    ...(template.peptideCategories ?? []),
    ...(template.tags ?? []).map((tag) => `#${tag}`),
  ].filter(Boolean);
  const canExpandTags = metadata.length > 6;
  const visibleMetadata = canExpandTags && !isTagListExpanded ? metadata.slice(0, 5) : metadata;

  return (
    <article className="native-label-card" onClick={onSelectLabel}>
      {!isAdmin && (
        <button
          className="native-label-report-button"
          type="button"
          aria-label={`Report ${title}`}
          onClick={(event) => {
            event.stopPropagation();
            onReport();
          }}
        >
          !
        </button>
      )}
      <div className="native-label-card__title">
        <h3>{title}</h3>
        <div className="native-label-card__badges">
          {isCommunityFavorite && <span>Community favorite</span>}
          {isAdmin && <span>{moderationStatus}</span>}
          {isAdmin && reportCount > 0 && <span>{reportCount} reports</span>}
          {isAdmin && (
            <button
              className="admin-icon-button"
              type="button"
              aria-label={`Edit ${title}`}
              onClick={(event) => {
                event.stopPropagation();
                onEdit();
              }}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M4 16.8V20h3.2L18.5 8.7l-3.2-3.2L4 16.8Zm13-12.9 3.1 3.1 1.2-1.2a1.5 1.5 0 0 0 0-2.1l-1-1a1.5 1.5 0 0 0-2.1 0L17 3.9Z" />
              </svg>
            </button>
          )}
        </div>
      </div>
      <div className="native-label-card__preview">
        <img src={template.previewDataUrl} alt={`${title} preview`} />
      </div>
      <div className="native-label-card__body">
        <div className="native-label-card__metadata">
          {metadata.length > 0 && (
            <div
              className={
                isTagListExpanded
                  ? 'native-label-card__meta native-label-card__meta--expanded'
                  : 'native-label-card__meta'
              }
            >
              {visibleMetadata.map((item) => (
                <span key={item}>{item}</span>
              ))}

              {canExpandTags && (
                <button
                  className="native-label-card__tags-toggle"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleTagList();
                  }}
                >
                  {isTagListExpanded ? 'Show less' : 'Show more'}
                </button>
              )}
            </div>
          )}
        </div>

        <label className="native-label-code">
          <span>NIIMBOT code</span>
          <input readOnly value={template.niimbotCode} />
        </label>

        <div className="native-label-card__actions">
          <button
            className="label-primary-action"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              void navigator.clipboard?.writeText(template.niimbotCode);
            }}
          >
            Copy Code
          </button>
          <button
            className={isVoted ? 'native-label-like is-voted' : 'native-label-like'}
            type="button"
            aria-label={`${isVoted ? 'Remove vote from' : 'Vote for'} ${title}`}
            aria-pressed={isVoted}
            onClick={(event) => {
              event.stopPropagation();
              onVote();
            }}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M7 21H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3v11Zm4.8-18.3a1.3 1.3 0 0 1 1.5 1.1l.2 1.2a6.9 6.9 0 0 1-.6 3.8L12.4 10H19a2.5 2.5 0 0 1 2.4 3.1l-1.4 5.6A3 3 0 0 1 17.1 21H9V10.7l1.6-1.8a5.3 5.3 0 0 0 1.2-3.4l-.1-1.2a1.3 1.3 0 0 1 1.1-1.6Z" />
            </svg>
            <span>{Math.min(votes, 999)}</span>
          </button>
        </div>
        {isAdmin && (
          <div className="native-label-card__moderation">
            <button type="button" onClick={(event) => { event.stopPropagation(); onApprove(); }}>
              Approve
            </button>
            <button type="button" onClick={(event) => { event.stopPropagation(); onPend(); }}>
              Pending
            </button>
            <button type="button" onClick={(event) => { event.stopPropagation(); onReject(); }}>
              Reject
            </button>
            {reportCount > 0 && (
              <button type="button" onClick={(event) => { event.stopPropagation(); onClearReports(); }}>
                Clear reports
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function DropdownSelect({
  value,
  options,
  extraAction,
  onChange,
}: {
  value: string;
  options: DropdownOption[];
  extraAction?: {
    label: string;
    onClick: () => void;
  };
  onChange: (value: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedOption = options.find((option) => option.value === value) ?? options[0];

  return (
    <div
      className="dropdown-select"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setIsOpen(false);
        }
      }}
    >
      <button
        className="dropdown-select__trigger"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((currentValue) => !currentValue)}
      >
        {selectedOption?.label ?? ''}
      </button>

      {isOpen && (
        <div className="dropdown-select__list" role="listbox" tabIndex={-1}>
          {options.map((option) => (
            <button
              className={
                option.value === value
                  ? 'dropdown-select__option is-selected'
                  : 'dropdown-select__option'
              }
              type="button"
              role="option"
              aria-selected={option.value === value}
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}

          {extraAction && (
            <button
              className="dropdown-select__option dropdown-select__option--more"
              type="button"
              onClick={() => {
                extraAction.onClick();
                setIsOpen(true);
              }}
            >
              {extraAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function getTemplateVotes(template: LabelTemplate, localVotes: Record<string, boolean>) {
  return template.votes + (localVotes[template.id] ? 1 : 0);
}

function getNativeLabelVotes(template: NativeLabelTemplate) {
  return Math.max(0, Math.round(template.votes ?? 0));
}

function compareNativeLabels(
  first: NativeLabelTemplate,
  second: NativeLabelTemplate,
  sortKey: NativeSortKey,
  favoriteIds: Set<string>,
): number {
  if (sortKey === 'featured') {
    const favoriteComparison = Number(favoriteIds.has(second.id)) - Number(favoriteIds.has(first.id));

    if (favoriteComparison !== 0) {
      return favoriteComparison;
    }

    return compareNativeLabels(first, second, 'popular', favoriteIds) || compareNativeLabels(first, second, 'latest', favoriteIds);
  }

  if (sortKey === 'popular') {
    return getNativeLabelVotes(second) - getNativeLabelVotes(first) || compareNativeLabels(first, second, 'latest', favoriteIds);
  }

  if (sortKey === 'az') {
    return getNativeLabelTitle(first).localeCompare(getNativeLabelTitle(second), undefined, {
      sensitivity: 'base',
      numeric: true,
    });
  }

  return getNativeLabelCreatedAt(second) - getNativeLabelCreatedAt(first);
}

function getNativeLabelTitle(template: NativeLabelTemplate) {
  return (
    template.templateName?.trim() ||
    template.peptideName?.trim() ||
    template.previewFileName ||
    'NIIMBOT template'
  );
}

function getNativeLabelCreatedAt(template: NativeLabelTemplate) {
  const createdAtTimestamp = Date.parse(template.createdAt ?? '');

  if (Number.isFinite(createdAtTimestamp)) {
    return createdAtTimestamp;
  }

  const idTimestamp = Number(template.id.replace(/^niimbot-/, ''));

  return Number.isFinite(idTimestamp) ? idTimestamp : 0;
}

function getLabelFileName(data: LabelFormData, template: LabelTemplate) {
  return (
    `${data.peptideName || template.name}`
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'vial-label'
  );
}

function parseNiimbotShareText(value: string) {
  const codeMatch = value.match(/⊙([^⊙]+)⊙/u);
  const rawTemplateName = value.match(/^【([^】]+)】/u)?.[1]?.trim();
  const templateName = rawTemplateName
    ?.replace(/\s*[（(]\s*\d+(?:\.\d+)?\s*x\s*\d+(?:\.\d+)?\s*[）)]\s*$/iu, '')
    .trim();

  return {
    codeWithDelimiters: codeMatch ? `⊙${codeMatch[1].trim()}⊙` : null,
    templateName: templateName || null,
  };
}

function getUniqueSortedValues(values: readonly string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort((first, second) =>
    first.localeCompare(second),
  );
}

function parseNativeTags(value: string) {
  const tags: string[] = [];

  value
    .split(',')
    .map((tag) => tag.replace(/^#/, '').trim())
    .filter(Boolean)
    .forEach((tag) => {
      if (!tags.some((currentTag) => currentTag.toLowerCase() === tag.toLowerCase())) {
        tags.push(tag);
      }
    });

  return tags.slice(0, 10);
}

function validateNativePreviewFile(file: File) {
  if (!nativePreviewMimeTypes.includes(file.type)) {
    return 'Use a PNG, JPEG, or WebP preview image.';
  }

  if (file.size > maxNativePreviewBytes) {
    return 'Preview image must be 3 MB or smaller.';
  }

  return '';
}

function normalizeLabelSize(value: string) {
  const trimmedValue = value.trim();
  const match = trimmedValue.match(/^(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*(mm)?$/i);

  if (!match) {
    return trimmedValue;
  }

  return `${match[1]}x${match[2]} mm`;
}

function matchesNativeLabelFilters(
  template: NativeLabelTemplate,
  searchQuery: string,
  categoryFilters: string[],
  labelSizeFilter: string,
  tagFilter: string,
) {
  const categories = template.peptideCategories ?? [];
  const tags = template.tags ?? [];

  if (
    categoryFilters.length > 0 &&
    !categoryFilters.every((categoryFilter) => categories.includes(categoryFilter))
  ) {
    return false;
  }

  if (labelSizeFilter !== 'all' && template.labelSize !== labelSizeFilter) {
    return false;
  }

  const normalizedTagFilter = tagFilter.trim().replace(/^#/, '').toLowerCase();

  if (
    normalizedTagFilter &&
    !tags.some((tag) => tag.toLowerCase().includes(normalizedTagFilter))
  ) {
    return false;
  }

  const normalizedQuery = searchQuery.trim().toLowerCase();

  if (!normalizedQuery) {
    return true;
  }

  return [
    template.templateName,
    template.peptideName,
    template.massMg,
    template.labelSize,
    template.previewFileName,
    template.niimbotCode,
    ...categories,
    ...tags,
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(normalizedQuery));
}

function getPeptideCategories(peptideName: string) {
  const normalizedPeptideName = peptideName.trim().toLowerCase();
  const matchingDefinition = Object.entries(peptideDefinitions).find(
    ([definedPeptideName]) => definedPeptideName.toLowerCase() === normalizedPeptideName,
  );

  return matchingDefinition?.[1].categories ?? [];
}

async function fetchNativeLabelTemplates() {
  const response = await fetch('/api/data/label-templates');

  if (!response.ok) {
    throw new Error('Labels could not be loaded.');
  }

  const templates = (await response.json()) as unknown;

  if (!Array.isArray(templates)) {
    return [];
  }

  return templates.filter(isNativeLabelTemplate);
}

async function saveNativeLabelTemplate(
  template: NativeLabelTemplate,
  metadata: { formStartedAt: number; honeypot: string },
) {
  const response = await fetch('/api/labels', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...template,
      formStartedAt: metadata.formStartedAt,
      honeypot: metadata.honeypot,
    }),
  });

  if (!response.ok) {
    throw new Error('Label could not be saved.');
  }

  const templates = (await response.json()) as unknown;

  if (!Array.isArray(templates)) {
    throw new Error('Stored label response was invalid.');
  }

  return templates.filter(isNativeLabelTemplate);
}

async function voteNativeLabelTemplate(templateId: string, direction: 1 | -1) {
  const response = await fetch('/api/labels/vote', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ id: templateId, direction }),
  });

  if (!response.ok) {
    throw new Error('Vote could not be saved.');
  }

  const templates = (await response.json()) as unknown;

  if (!Array.isArray(templates)) {
    throw new Error('Stored label response was invalid.');
  }

  return templates.filter(isNativeLabelTemplate);
}

async function reportNativeLabelTemplate(
  templateId: string,
  reason: NativeLabelReportReason,
  details: string,
) {
  const response = await fetch('/api/labels/report', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ id: templateId, reason, details }),
  });

  if (!response.ok) {
    throw new Error('Label report could not be saved.');
  }

  const templates = (await response.json()) as unknown;

  if (!Array.isArray(templates)) {
    throw new Error('Stored label response was invalid.');
  }

  return templates.filter(isNativeLabelTemplate);
}

async function updateNativeLabelTemplate(template: NativeLabelTemplate) {
  const response = await fetch(`/api/admin/data/label-templates/${encodeURIComponent(template.id)}`, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(template),
  });

  if (!response.ok) {
    throw new Error('Label could not be updated.');
  }

  const templates = (await response.json()) as unknown;

  if (!Array.isArray(templates)) {
    throw new Error('Stored label response was invalid.');
  }

  return templates.filter(isNativeLabelTemplate);
}

async function deleteNativeLabelTemplate(templateId: string) {
  const response = await fetch(`/api/admin/data/label-templates/${encodeURIComponent(templateId)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  });

  if (!response.ok) {
    throw new Error('Label could not be deleted.');
  }

  const templates = (await response.json()) as unknown;

  if (!Array.isArray(templates)) {
    throw new Error('Stored label response was invalid.');
  }

  return templates.filter(isNativeLabelTemplate);
}

function isNativeLabelTemplate(value: unknown): value is NativeLabelTemplate {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const template = value as Partial<NativeLabelTemplate>;

  return (
    typeof template.id === 'string' &&
    typeof template.previewDataUrl === 'string' &&
    typeof template.previewFileName === 'string' &&
    typeof template.niimbotCode === 'string' &&
    (template.votes === undefined || typeof template.votes === 'number') &&
    (
      template.moderationStatus === undefined ||
      template.moderationStatus === 'pending' ||
      template.moderationStatus === 'approved' ||
      template.moderationStatus === 'rejected'
    ) &&
    (template.reportCount === undefined || typeof template.reportCount === 'number')
  );
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function createBinaryLabelSvg(svg: string) {
  const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const parseError = document.querySelector('parsererror');

  if (parseError) {
    return svg;
  }

  const root = document.documentElement;
  const paintAttributes = ['fill', 'stroke', 'color', 'stop-color'];
  const opacityAttributes = ['opacity', 'fill-opacity', 'stroke-opacity', 'stop-opacity'];

  root.setAttribute('color', '#000000');
  root.setAttribute('shape-rendering', 'crispEdges');

  [root, ...Array.from(root.querySelectorAll('*'))].forEach((element) => {
    paintAttributes.forEach((attribute) => {
      const value = element.getAttribute(attribute);

      if (value) {
        element.setAttribute(attribute, toBinarySvgPaint(value));
      }
    });

    opacityAttributes.forEach((attribute) => {
      if (element.hasAttribute(attribute)) {
        element.setAttribute(attribute, '1');
      }
    });

    const style = element.getAttribute('style');
    if (style) {
      element.setAttribute(
        'style',
        style
          .split(';')
          .map((declaration) => declaration.trim())
          .filter(Boolean)
          .map((declaration) => {
            const separatorIndex = declaration.indexOf(':');

            if (separatorIndex === -1) {
              return declaration;
            }

            const property = declaration.slice(0, separatorIndex).trim();
            const value = declaration.slice(separatorIndex + 1).trim();

            if (paintAttributes.includes(property)) {
              return `${property}: ${toBinarySvgPaint(value)}`;
            }

            if (opacityAttributes.includes(property)) {
              return `${property}: 1`;
            }

            return declaration;
          })
          .join('; '),
      );
    }
  });

  return new XMLSerializer().serializeToString(root);
}

function toBinarySvgPaint(value: string) {
  const normalizedValue = value.trim().toLowerCase();

  if (normalizedValue === 'none' || normalizedValue.startsWith('url(')) {
    return normalizedValue;
  }

  if (normalizedValue === 'transparent') {
    return '#ffffff';
  }

  if (normalizedValue === 'currentcolor') {
    return '#000000';
  }

  if (normalizedValue === 'white') {
    return '#ffffff';
  }

  if (normalizedValue === 'black') {
    return '#000000';
  }

  const color = parseSvgColor(normalizedValue);

  if (!color) {
    return '#000000';
  }

  if (color.alpha < 0.5) {
    return '#ffffff';
  }

  return getColorLuminance(color.red, color.green, color.blue) >= binaryWhiteThreshold
    ? '#ffffff'
    : '#000000';
}

function parseSvgColor(value: string) {
  const hexMatch = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);

  if (hexMatch) {
    const hex = hexMatch[1];
    const expandedHex =
      hex.length === 3
        ? hex
            .split('')
            .map((digit) => `${digit}${digit}`)
            .join('')
        : hex;

    return {
      red: Number.parseInt(expandedHex.slice(0, 2), 16),
      green: Number.parseInt(expandedHex.slice(2, 4), 16),
      blue: Number.parseInt(expandedHex.slice(4, 6), 16),
      alpha: 1,
    };
  }

  const rgbMatch = value.match(/^rgba?\(([^)]+)\)$/);

  if (!rgbMatch) {
    return null;
  }

  const channels = rgbMatch[1].split(',').map((channel) => channel.trim());
  const [red, green, blue] = channels.slice(0, 3).map(parseCssColorChannel);
  const alpha = channels[3] ? Number.parseFloat(channels[3]) : 1;

  if ([red, green, blue, alpha].some((channel) => Number.isNaN(channel))) {
    return null;
  }

  return { red, green, blue, alpha };
}

function parseCssColorChannel(value: string) {
  if (value.endsWith('%')) {
    return Math.round((Number.parseFloat(value) / 100) * 255);
  }

  return Number.parseFloat(value);
}

function getColorLuminance(red: number, green: number, blue: number) {
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

async function inlineSvgImages(svg: string) {
  const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const parseError = document.querySelector('parsererror');

  if (parseError) {
    return svg;
  }

  const images = Array.from(document.querySelectorAll('image'));

  await Promise.all(
    images.map(async (image) => {
      const href = image.getAttribute('href') ?? image.getAttribute('xlink:href');

      if (!href || href.startsWith('data:')) {
        return;
      }

      try {
        const response = await fetch(href);
        const blob = await response.blob();
        const dataUrl = await blobToDataUrl(blob);

        image.setAttribute('href', dataUrl);
        image.setAttributeNS('http://www.w3.org/1999/xlink', 'href', dataUrl);
      } catch (error) {
        console.warn('Could not inline SVG image for export.', error);
      }
    }),
  );

  return new XMLSerializer().serializeToString(document.documentElement);
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Blob could not be read.'));
    reader.readAsDataURL(blob);
  });
}

async function renderBinarySvgToCanvas(svg: string, dpi: number, fallbackMedia: LabelMedia) {
  const dimensions = getSvgDimensionsMm(svg, fallbackMedia);
  const widthPx = Math.max(1, Math.round((dimensions.widthMm / 25.4) * dpi));
  const heightPx = Math.max(1, Math.round((dimensions.heightMm / 25.4) * dpi));
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Canvas rendering is not available.');
  }

  canvas.width = widthPx;
  canvas.height = heightPx;
  context.imageSmoothingEnabled = false;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, widthPx, heightPx);

  const image = await loadSvgImage(svg);
  context.drawImage(image, 0, 0, widthPx, heightPx);

  const imageData = context.getImageData(0, 0, widthPx, heightPx);
  const pixels = imageData.data;

  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3];
    const luminance = getColorLuminance(pixels[index], pixels[index + 1], pixels[index + 2]);
    const binaryValue = alpha < 128 || luminance >= binaryWhiteThreshold ? 255 : 0;

    pixels[index] = binaryValue;
    pixels[index + 1] = binaryValue;
    pixels[index + 2] = binaryValue;
    pixels[index + 3] = 255;
  }

  context.putImageData(imageData, 0, 0);

  return {
    canvas,
    imageData,
    widthPx,
    heightPx,
    widthMm: dimensions.widthMm,
    heightMm: dimensions.heightMm,
  };
}

function getSvgDimensionsMm(svg: string, fallbackMedia: LabelMedia) {
  const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = document.documentElement;
  const widthMm = parseSvgLengthToMm(root.getAttribute('width'));
  const heightMm = parseSvgLengthToMm(root.getAttribute('height'));

  if (widthMm && heightMm) {
    return { widthMm, heightMm };
  }

  const viewBox = root.getAttribute('viewBox')?.split(/\s+/).map(Number);

  if (viewBox?.length === 4 && viewBox.every((value) => !Number.isNaN(value))) {
    return { widthMm: viewBox[2], heightMm: viewBox[3] };
  }

  return { widthMm: fallbackMedia.widthMm, heightMm: fallbackMedia.heightMm };
}

function parseSvgLengthToMm(value: string | null) {
  if (!value) {
    return null;
  }

  const match = value.trim().match(/^([0-9.]+)\s*(mm|cm|in|pt|px)?$/i);

  if (!match) {
    return null;
  }

  const length = Number.parseFloat(match[1]);
  const unit = match[2]?.toLowerCase() ?? 'mm';

  if (Number.isNaN(length)) {
    return null;
  }

  if (unit === 'cm') {
    return length * 10;
  }

  if (unit === 'in') {
    return length * 25.4;
  }

  if (unit === 'pt') {
    return (length / 72) * 25.4;
  }

  if (unit === 'px') {
    return (length / 96) * 25.4;
  }

  return length;
}

function loadSvgImage(svg: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('SVG could not be rendered.'));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }

      reject(new Error('Canvas export failed.'));
    }, type);
  });
}

function createVectorPdfBlob(template: LabelTemplate, data: LabelFormData) {
  const widthMm = 40;
  const heightMm = 20;
  const pageWidthPt = mmToPdfPt(widthMm);
  const pageHeightPt = mmToPdfPt(heightMm);
  const labelRows = getLabelRows(data);
  const peptideName = data.peptideName.trim();
  const mass = data.massMg.trim();
  const coaLink = data.coaLink.trim();
  const rowLimit = coaLink ? 25 : 42;
  const commands: string[] = [];
  const drawRect = (x: number, y: number, width: number, height: number, gray: 0 | 1) => {
    commands.push(
      `${gray} g ${formatPdfNumber(mmToPdfPt(x))} ${formatPdfNumber(
        pageHeightPt - mmToPdfPt(y + height),
      )} ${formatPdfNumber(mmToPdfPt(width))} ${formatPdfNumber(mmToPdfPt(height))} re f`,
    );
  };
  const drawRoundedRect = ({
    x,
    y,
    width,
    height,
    radius,
    fillGray,
    strokeGray,
    strokeWidth,
  }: {
    x: number;
    y: number;
    width: number;
    height: number;
    radius: number;
    fillGray?: 0 | 1;
    strokeGray?: 0 | 1;
    strokeWidth?: number;
  }) => {
    const paintOperator = fillGray !== undefined && strokeGray !== undefined ? 'B' : fillGray !== undefined ? 'f' : 'S';

    commands.push(
      [
        fillGray !== undefined ? `${fillGray} g` : '',
        strokeGray !== undefined ? `${strokeGray} G ${formatPdfNumber(mmToPdfPt(strokeWidth ?? 0.18))} w` : '',
        roundedRectPath(x, y, width, height, radius, pageHeightPt),
        paintOperator,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  };
  const drawText = ({
    text,
    x,
    y,
    size,
    gray,
    bold,
    align = 'left',
  }: {
    text: string;
    x: number;
    y: number;
    size: number;
    gray: 0 | 1;
    bold?: boolean;
    align?: 'left' | 'center' | 'right';
  }) => {
    if (!text) {
      return;
    }

    const fontSizePt = mmToPdfPt(size);
    const textWidthPt = estimatePdfTextWidth(text, fontSizePt, bold);
    const anchorX =
      align === 'center'
        ? mmToPdfPt(x) - textWidthPt / 2
        : align === 'right'
          ? mmToPdfPt(x) - textWidthPt
          : mmToPdfPt(x);

    commands.push(
      `${gray} g BT ${bold ? '/F2' : '/F1'} ${formatPdfNumber(fontSizePt)} Tf 1 0 0 1 ${formatPdfNumber(
        anchorX,
      )} ${formatPdfNumber(pageHeightPt - mmToPdfPt(y))} Tm (${escapePdfString(text)}) Tj ET`,
    );
  };
  const drawRows = () => {
    labelRows.forEach((row, index) => {
      const y = 8.7 + index * 1.75;
      const labelText = row.label;
      const valueText = truncateLabelText(row.value, rowLimit);
      const valueX = 3 + estimateSvgTextWidthMm(labelText, 1.25, true) + 0.75;

      drawText({ text: labelText, x: 3, y, size: 1.25, gray: 0, bold: true });
      drawText({ text: valueText, x: valueX, y, size: 1.25, gray: 0 });
    });
  };

  const drawCoaMark = () => {
    if (!coaLink) {
      return;
    }

    drawRoundedRect({
      x: 31.1,
      y: 11.2,
      width: 7,
      height: 7,
      radius: 0,
      strokeGray: 0,
      strokeWidth: 0.18,
    });
    drawText({ text: 'COA', x: 34.6, y: heightMm - 1, size: 0.9, gray: 0, bold: true, align: 'center' });
  };

  drawRoundedRect({ x: 0, y: 0, width: widthMm, height: heightMm, radius: 2, fillGray: 1 });
  commands.push(`q\n${roundedRectPath(0, 0, widthMm, heightMm, 2, pageHeightPt)}\nW n`);

  if (template.style === 'dark') {
    drawRect(0, 0, widthMm, 6.5, 0);
    drawRect(0, 5.6, widthMm, 1, 0);
    drawText({
      text: truncateLabelText(peptideName, 13),
      x: 3,
      y: 4.6,
      size: 3.2,
      gray: 1,
      bold: true,
    });
    drawText({
      text: mass ? truncateLabelText(`${mass} mg`, 8) : '',
      x: 36.5,
      y: 4.5,
      size: 2.25,
      gray: 1,
      bold: true,
      align: 'right',
    });
  } else if (template.style === 'safety') {
    drawRect(0, 0, 4.3, heightMm, 0);
    drawRoundedRect({ x: 6, y: 2.1, width: 20.5, height: 3.9, radius: 0.75, fillGray: 0 });
    drawText({
      text: truncateLabelText(peptideName, 12),
      x: 7.2,
      y: 4.8,
      size: 2.25,
      gray: 1,
      bold: true,
    });
    drawText({
      text: mass ? truncateLabelText(`${mass} mg`, 8) : '',
      x: 35.6,
      y: 4.9,
      size: 2.1,
      gray: 0,
      bold: true,
      align: 'center',
    });
  } else {
    drawRect(0, 0, widthMm, 3.8, 0);
    drawRect(0, 3.7, widthMm, 0.55, 0);
    drawText({
      text: truncateLabelText(peptideName, 14),
      x: 3,
      y: 6.9,
      size: 2.65,
      gray: 0,
      bold: true,
    });

    if (mass) {
      drawRoundedRect({
        x: 29.4,
        y: 5,
        width: 8.8,
        height: 3.1,
        radius: 0.85,
        fillGray: 1,
        strokeGray: 0,
        strokeWidth: 0.25,
      });
      drawText({
        text: truncateLabelText(`${mass} mg`, 7),
        x: 33.8,
        y: 7.15,
        size: 1.55,
        gray: 0,
        bold: true,
        align: 'center',
      });
    }
  }

  drawRows();
  drawCoaMark();
  commands.push('Q');

  return createPdfBlobFromContent(commands.join('\n'), pageWidthPt, pageHeightPt);
}

function createPdfBlobFromContent(content: string, widthPt: number, heightPt: number) {
  const encoder = new TextEncoder();
  const chunks: BlobPart[] = [];
  const offsets: number[] = [0];
  let byteLength = 0;
  const appendBytes = (bytes: Uint8Array<ArrayBuffer>) => {
    chunks.push(bytes);
    byteLength += bytes.byteLength;
  };
  const appendText = (text: string) => {
    appendBytes(encoder.encode(text));
  };
  const beginObject = (objectNumber: number) => {
    offsets[objectNumber] = byteLength;
    appendText(`${objectNumber} 0 obj\n`);
  };
  const endObject = () => {
    appendText('endobj\n');
  };
  const formattedWidth = formatPdfNumber(widthPt);
  const formattedHeight = formatPdfNumber(heightPt);

  appendText('%PDF-1.4\n');

  beginObject(1);
  appendText('<< /Type /Catalog /Pages 2 0 R >>\n');
  endObject();

  beginObject(2);
  appendText('<< /Type /Pages /Kids [3 0 R] /Count 1 >>\n');
  endObject();

  beginObject(3);
  appendText(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${formattedWidth} ${formattedHeight}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>\n`,
  );
  endObject();

  beginObject(4);
  appendText(`<< /Length ${encoder.encode(content).byteLength} >>\nstream\n${content}\nendstream\n`);
  endObject();

  beginObject(5);
  appendText('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\n');
  endObject();

  beginObject(6);
  appendText('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\n');
  endObject();

  const xrefOffset = byteLength;
  appendText('xref\n0 7\n0000000000 65535 f \n');

  for (let objectNumber = 1; objectNumber <= 6; objectNumber += 1) {
    appendText(`${String(offsets[objectNumber]).padStart(10, '0')} 00000 n \n`);
  }

  appendText(`trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return new Blob(chunks, { type: 'application/pdf' });
}

function roundedRectPath(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  pageHeightPt: number,
) {
  const curve = 0.5522847498;
  const x1 = mmToPdfPt(x);
  const x2 = mmToPdfPt(x + width);
  const yTop = pageHeightPt - mmToPdfPt(y);
  const yBottom = pageHeightPt - mmToPdfPt(y + height);
  const radiusPt = Math.min(mmToPdfPt(radius), Math.abs(x2 - x1) / 2, Math.abs(yTop - yBottom) / 2);
  const control = radiusPt * curve;

  if (radiusPt === 0) {
    return `${formatPdfNumber(x1)} ${formatPdfNumber(yBottom)} ${formatPdfNumber(x2 - x1)} ${formatPdfNumber(
      yTop - yBottom,
    )} re`;
  }

  return [
    `${formatPdfNumber(x1 + radiusPt)} ${formatPdfNumber(yTop)} m`,
    `${formatPdfNumber(x2 - radiusPt)} ${formatPdfNumber(yTop)} l`,
    `${formatPdfNumber(x2 - radiusPt + control)} ${formatPdfNumber(yTop)} ${formatPdfNumber(x2)} ${formatPdfNumber(
      yTop - radiusPt + control,
    )} ${formatPdfNumber(x2)} ${formatPdfNumber(yTop - radiusPt)} c`,
    `${formatPdfNumber(x2)} ${formatPdfNumber(yBottom + radiusPt)} l`,
    `${formatPdfNumber(x2)} ${formatPdfNumber(yBottom + radiusPt - control)} ${formatPdfNumber(
      x2 - radiusPt + control,
    )} ${formatPdfNumber(yBottom)} ${formatPdfNumber(x2 - radiusPt)} ${formatPdfNumber(yBottom)} c`,
    `${formatPdfNumber(x1 + radiusPt)} ${formatPdfNumber(yBottom)} l`,
    `${formatPdfNumber(x1 + radiusPt - control)} ${formatPdfNumber(yBottom)} ${formatPdfNumber(x1)} ${formatPdfNumber(
      yBottom + radiusPt - control,
    )} ${formatPdfNumber(x1)} ${formatPdfNumber(yBottom + radiusPt)} c`,
    `${formatPdfNumber(x1)} ${formatPdfNumber(yTop - radiusPt)} l`,
    `${formatPdfNumber(x1)} ${formatPdfNumber(yTop - radiusPt + control)} ${formatPdfNumber(
      x1 + radiusPt - control,
    )} ${formatPdfNumber(yTop)} ${formatPdfNumber(x1 + radiusPt)} ${formatPdfNumber(yTop)} c`,
    'h',
  ].join('\n');
}

function mmToPdfPt(value: number) {
  return (value / 25.4) * 72;
}

function estimateSvgTextWidthMm(text: string, fontSizeMm: number, bold?: boolean) {
  return text.length * fontSizeMm * (bold ? 0.62 : 0.55);
}

function estimatePdfTextWidth(text: string, fontSizePt: number, bold?: boolean) {
  return text.length * fontSizePt * (bold ? 0.62 : 0.55);
}

function escapePdfString(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function formatPdfNumber(value: number) {
  return Number(value.toFixed(4)).toString();
}

function renderLabelSvg(template: LabelTemplate, data: LabelFormData) {
  const labelRows = getLabelRows(data);
  const peptideName = data.peptideName.trim();
  const mass = data.massMg.trim();
  const coaLink = data.coaLink.trim();
  const labelWidth = 40;
  const labelHeight = 20;
  const cornerRadius = 2;
  const labelClipId = `label-clip-${template.id}`;
  const labelClipPath = `<defs><clipPath id="${labelClipId}"><rect width="${labelWidth}" height="${labelHeight}" rx="${cornerRadius}" ry="${cornerRadius}" /></clipPath></defs>`;
  const qrSize = 7;
  const qrX = 31.1;
  const qrY = 11.2;
  const qrImage = coaLink
    ? `<image href="${escapeSvgAttribute(
        `https://api.qrserver.com/v1/create-qr-code/?size=160x160&margin=1&color=000000&bgcolor=ffffff&data=${encodeURIComponent(
          coaLink,
        )}`,
      )}" x="${qrX}" y="${qrY}" width="${qrSize}" height="${qrSize}" preserveAspectRatio="none" /><rect x="${qrX}" y="${qrY}" width="${qrSize}" height="${qrSize}" fill="none" stroke="#07101f" stroke-width=".18" /><text x="${qrX + qrSize / 2}" y="${labelHeight - 1}" text-anchor="middle" font-size=".9" font-family="Inter, Arial, sans-serif" font-weight="800" fill="#344154">COA</text>`
    : '';
  const rowLimit = coaLink ? 25 : 42;
  const rowsSvg = labelRows
    .map(
      (row, index) =>
        `<text x="3" y="${8.7 + index * 1.75}" font-size="1.25" font-family="Inter, Arial, sans-serif" fill="#344154"><tspan font-weight="800">${escapeSvgText(
          row.label,
        )}</tspan><tspan dx=".75" fill="#07101f">${escapeSvgText(
          truncateLabelText(row.value, rowLimit),
        )}</tspan></text>`,
    )
    .join('');

  if (template.style === 'dark') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${labelWidth}mm" height="${labelHeight}mm" viewBox="0 0 ${labelWidth} ${labelHeight}" role="img" aria-label="Generated vial label">
  ${labelClipPath}
  <rect width="${labelWidth}" height="${labelHeight}" rx="${cornerRadius}" ry="${cornerRadius}" fill="#f7fafc" />
  <g clip-path="url(#${labelClipId})">
    <rect width="${labelWidth}" height="6.5" fill="#07101f" />
    <rect y="5.6" width="${labelWidth}" height="1" fill="#13f4ff" />
    ${peptideName ? `<text x="3" y="4.6" font-size="3.2" font-family="Inter, Arial, sans-serif" font-weight="900" fill="#ffffff">${escapeSvgText(truncateLabelText(peptideName, 13))}</text>` : ''}
    ${mass ? `<text x="36.5" y="4.5" text-anchor="end" font-size="2.25" font-family="Inter, Arial, sans-serif" font-weight="900" fill="#13f4ff">${escapeSvgText(truncateLabelText(`${mass} mg`, 8))}</text>` : ''}
    ${rowsSvg}
    ${qrImage}
  </g>
</svg>`;
  }

  if (template.style === 'safety') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${labelWidth}mm" height="${labelHeight}mm" viewBox="0 0 ${labelWidth} ${labelHeight}" role="img" aria-label="Generated vial label">
  ${labelClipPath}
  <rect width="${labelWidth}" height="${labelHeight}" rx="${cornerRadius}" ry="${cornerRadius}" fill="#fffefd" />
  <g clip-path="url(#${labelClipId})">
    <rect width="4.3" height="${labelHeight}" fill="#e8b943" />
    <rect x="6" y="2.1" width="20.5" height="3.9" rx=".75" ry=".75" fill="#07101f" />
    ${peptideName ? `<text x="7.2" y="4.8" font-size="2.25" font-family="Inter, Arial, sans-serif" font-weight="900" fill="#ffffff">${escapeSvgText(truncateLabelText(peptideName, 12))}</text>` : ''}
    ${mass ? `<text x="35.6" y="4.9" text-anchor="middle" font-size="2.1" font-family="Inter, Arial, sans-serif" font-weight="900" fill="#9b5526">${escapeSvgText(truncateLabelText(`${mass} mg`, 8))}</text>` : ''}
    ${rowsSvg}
    ${qrImage}
  </g>
</svg>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${labelWidth}mm" height="${labelHeight}mm" viewBox="0 0 ${labelWidth} ${labelHeight}" role="img" aria-label="Generated vial label">
  ${labelClipPath}
  <rect width="${labelWidth}" height="${labelHeight}" rx="${cornerRadius}" ry="${cornerRadius}" fill="#ffffff" />
  <g clip-path="url(#${labelClipId})">
    <rect x="0" y="0" width="${labelWidth}" height="3.8" fill="#13f4ff" />
    <rect x="0" y="3.7" width="${labelWidth}" height=".55" fill="#07101f" />
    ${peptideName ? `<text x="3" y="6.9" font-size="2.65" font-family="Inter, Arial, sans-serif" font-weight="900" fill="#07101f">${escapeSvgText(truncateLabelText(peptideName, 14))}</text>` : ''}
    ${mass ? `<rect x="29.4" y="5" width="8.8" height="3.1" rx=".85" ry=".85" fill="#eafbff" stroke="#00aeb8" stroke-width=".25" /><text x="33.8" y="7.15" text-anchor="middle" font-size="1.55" font-family="Inter, Arial, sans-serif" font-weight="900" fill="#006f78">${escapeSvgText(truncateLabelText(`${mass} mg`, 7))}</text>` : ''}
    ${rowsSvg}
    ${qrImage}
  </g>
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

export default LabelsPage;
