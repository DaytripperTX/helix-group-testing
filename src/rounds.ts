export type TestingTierId = 'none' | 'platinum' | 'gold' | 'gold-plus' | 'bronze';

export type VendorPriceSheet =
  | { type: 'google-sheet'; url: string }
  | { type: 'file'; fileName: string; mimeType: string; blobKey?: string };

export type RoundPriceListItem = {
  id: string;
  vendorCode: string;
  productName: string;
  mass: string;
  price: number | null;
  vialsPerPack: number;
  peptideIds: string[];
  needsReview?: boolean;
};

export type RoundPriceListSnapshot = {
  id: string;
  vendorId: string;
  vendorName: string;
  source: VendorPriceSheet | null;
  parsedAt: string;
  items: RoundPriceListItem[];
};

export type RoundPeptide = {
  id: string;
  peptideId: string;
  peptideName: string;
  priceListItemId: string;
  vendorCode: string;
  vendorPrice: number | null;
  vendorPriceOverridden: boolean;
  mass: string;
  testingTier: TestingTierId;
  additionalTesting: string;
  batchConformity: boolean;
  capColor: string;
  notes: string;
  participantCount: number;
  totalOrdered: number;
};

export type Round = {
  id: string;
  name: string;
  status: string;
  vendorId: string;
  isCurrent: boolean;
  priceSourceMode: 'none' | 'vendor-default' | 'round-override';
  startDate: string;
  endDate: string;
  targetWindow: string;
  resultPasscode: string;
  hasResultPasscode?: boolean;
  participants: number;
  roundDiscountPercent: number;
  priceListSnapshot: RoundPriceListSnapshot | null;
  peptides: RoundPeptide[];
  createdAt?: string;
  updatedAt?: string;
};

type PeptideDictionaryItem = {
  id: string;
  name: string;
};

export async function fetchRounds() {
  const [roundsResponse, priceListsResponse, peptidesResponse] = await Promise.all([
    fetch('/api/data/rounds'),
    fetch('/api/data/vendor-price-lists'),
    fetch('/api/data/peptides'),
  ]);

  if (!roundsResponse.ok) {
    throw new Error('Rounds could not be loaded.');
  }

  const records = (await roundsResponse.json()) as unknown;
  const priceListRecords = priceListsResponse.ok ? (await priceListsResponse.json()) as unknown : [];
  const peptideRecords = peptidesResponse.ok ? (await peptidesResponse.json()) as unknown : [];
  const rounds = Array.isArray(records)
    ? records.map(normalizeRound).filter((round): round is Round => Boolean(round))
    : [];

  return hydrateVendorDefaultRounds(
    rounds,
    Array.isArray(priceListRecords)
      ? priceListRecords.map(normalizePriceListSnapshot).filter((snapshot): snapshot is RoundPriceListSnapshot => Boolean(snapshot))
      : [],
    Array.isArray(peptideRecords)
      ? peptideRecords.map(normalizePeptideDictionaryItem).filter((peptide): peptide is PeptideDictionaryItem => Boolean(peptide))
      : [],
  );
}

export function getCurrentRounds(rounds: Round[]) {
  return sortRoundsForDisplay(rounds.filter((round) => round.isCurrent));
}

export function sortRoundsForDisplay(rounds: Round[]) {
  return [...rounds].sort((first, second) => {
    if (first.isCurrent !== second.isCurrent) {
      return first.isCurrent ? -1 : 1;
    }

    const firstDate = getRoundSortDate(first);
    const secondDate = getRoundSortDate(second);

    if (firstDate !== secondDate) {
      return secondDate - firstDate;
    }

    return first.name.localeCompare(second.name);
  });
}

export function formatRoundDateRange(round: Round) {
  if (round.startDate && round.endDate) {
    return `${round.startDate} to ${round.endDate}`;
  }

  return round.startDate || round.endDate || round.targetWindow;
}

export function parseRoundMassMg(mass: string) {
  const match = mass.match(/\d+(?:\.\d+)?/);

  return match ? Number.parseFloat(match[0]) : 0;
}

export function hydrateVendorDefaultRounds(
  rounds: Round[],
  priceLists: RoundPriceListSnapshot[],
  peptides: PeptideDictionaryItem[] = [],
) {
  return rounds.map((round) => {
    if (round.priceSourceMode !== 'vendor-default' || !round.vendorId) {
      return round;
    }

    const latestSnapshot = priceLists.find((priceList) => priceList.vendorId === round.vendorId) ?? null;

    if (!latestSnapshot) {
      return round;
    }

    return {
      ...round,
      priceListSnapshot: latestSnapshot,
      peptides: reconcileRoundPeptidesWithPriceList(round.peptides, latestSnapshot, peptides),
    };
  });
}

function normalizeRound(value: unknown): Round | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const round = value as Partial<Round>;
  const id = sanitizeString(round.id);

  if (!id) {
    return null;
  }

  return {
    id,
    name: sanitizeString(round.name) || 'Untitled round',
    status: sanitizeString(round.status),
    vendorId: sanitizeString(round.vendorId),
    isCurrent: round.isCurrent === true,
    priceSourceMode: normalizeRoundPriceSourceMode(round.priceSourceMode),
    startDate: sanitizeString(round.startDate),
    endDate: sanitizeString(round.endDate),
    targetWindow: sanitizeString(round.targetWindow),
    resultPasscode: sanitizeString(round.resultPasscode),
    hasResultPasscode: round.hasResultPasscode === true,
    participants: normalizeInteger(round.participants),
    roundDiscountPercent: normalizePercent(round.roundDiscountPercent),
    priceListSnapshot: normalizePriceListSnapshot(round.priceListSnapshot),
    peptides: Array.isArray(round.peptides)
      ? round.peptides.map(normalizeRoundPeptide).filter((row): row is RoundPeptide => Boolean(row))
      : [],
    createdAt: sanitizeString(round.createdAt),
    updatedAt: sanitizeString(round.updatedAt),
  };
}

function normalizeRoundPeptide(value: unknown): RoundPeptide | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const row = value as Partial<RoundPeptide>;
  const id = sanitizeString(row.id);

  if (!id) {
    return null;
  }

  return {
    id,
    peptideId: sanitizeString(row.peptideId),
    peptideName: sanitizeString(row.peptideName),
    priceListItemId: sanitizeString(row.priceListItemId),
    vendorCode: sanitizeString(row.vendorCode),
    vendorPrice: normalizeNullableNumber(row.vendorPrice),
    vendorPriceOverridden: row.vendorPriceOverridden === true,
    mass: sanitizeString(row.mass),
    testingTier: normalizeTestingTier(row.testingTier),
    additionalTesting: sanitizeString(row.additionalTesting),
    batchConformity: row.batchConformity === true,
    capColor: sanitizeString(row.capColor),
    notes: sanitizeString(row.notes),
    participantCount: normalizeInteger(row.participantCount),
    totalOrdered: normalizeInteger(row.totalOrdered),
  };
}

function reconcileRoundPeptidesWithPriceList(
  rows: RoundPeptide[],
  priceListSnapshot: RoundPriceListSnapshot,
  peptides: PeptideDictionaryItem[],
) {
  return rows.map((row) => {
    const priceListItem = findUpdatedPriceListItem(row, priceListSnapshot);

    if (!priceListItem) {
      return row;
    }

    return {
      ...row,
      priceListItemId: priceListItem.id,
      vendorCode: priceListItem.vendorCode,
      peptideId: resolvePeptideId(row, priceListItem, peptides),
      peptideName: resolvePeptideName(row, priceListItem, peptides),
      mass: priceListItem.mass,
      vendorPrice: row.vendorPriceOverridden ? row.vendorPrice : priceListItem.price,
    };
  });
}

function resolvePeptideId(
  row: RoundPeptide,
  priceListItem: RoundPriceListItem,
  peptides: PeptideDictionaryItem[],
) {
  const linkedPeptideId = row.peptideId || priceListItem.peptideIds[0] || '';

  if (linkedPeptideId) {
    return linkedPeptideId;
  }

  return findPeptideByName(priceListItem.productName || row.peptideName, peptides)?.id ?? '';
}

function resolvePeptideName(
  row: RoundPeptide,
  priceListItem: RoundPriceListItem,
  peptides: PeptideDictionaryItem[],
) {
  const peptideId = resolvePeptideId(row, priceListItem, peptides);
  const peptide = peptideId
    ? peptides.find((currentPeptide) => currentPeptide.id === peptideId)
    : null;

  return peptide?.name || row.peptideName || priceListItem.productName;
}

function findUpdatedPriceListItem(
  row: RoundPeptide,
  priceListSnapshot: RoundPriceListSnapshot,
) {
  const exactItem = row.priceListItemId
    ? priceListSnapshot.items.find((item) => item.id === row.priceListItemId)
    : null;

  if (exactItem) {
    return exactItem;
  }

  const normalizedVendorCode = normalizeMatchText(row.vendorCode);

  if (normalizedVendorCode) {
    const codeMatch = priceListSnapshot.items.find((item) => normalizeMatchText(item.vendorCode) === normalizedVendorCode);

    if (codeMatch) {
      return codeMatch;
    }
  }

  const normalizedMass = normalizeMatchText(row.mass);
  const peptideIdMatch = row.peptideId
    ? priceListSnapshot.items.find((item) =>
        item.peptideIds.includes(row.peptideId)
        && (!normalizedMass || normalizeMatchText(item.mass) === normalizedMass),
      )
    : null;

  if (peptideIdMatch) {
    return peptideIdMatch;
  }

  const normalizedProductName = normalizeMatchText(row.peptideName);

  return priceListSnapshot.items.find((item) =>
    normalizeMatchText(item.productName) === normalizedProductName
    && (!normalizedMass || normalizeMatchText(item.mass) === normalizedMass),
  ) ?? null;
}

function normalizePriceListSnapshot(value: unknown): RoundPriceListSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const snapshot = value as Partial<RoundPriceListSnapshot>;

  return {
    id: sanitizeString(snapshot.id),
    vendorId: sanitizeString(snapshot.vendorId),
    vendorName: sanitizeString(snapshot.vendorName),
    source: normalizePriceSheet(snapshot.source),
    parsedAt: sanitizeString(snapshot.parsedAt),
    items: Array.isArray(snapshot.items)
      ? snapshot.items.map(normalizePriceListItem).filter((item): item is RoundPriceListItem => Boolean(item))
      : [],
  };
}

function normalizePeptideDictionaryItem(value: unknown): PeptideDictionaryItem | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const peptide = value as Partial<PeptideDictionaryItem>;
  const id = sanitizeString(peptide.id);
  const name = sanitizeString(peptide.name);

  return id && name ? { id, name } : null;
}

function normalizePriceSheet(value: unknown): VendorPriceSheet | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const source = value as Partial<VendorPriceSheet>;

  if (source.type === 'google-sheet') {
    return {
      type: 'google-sheet',
      url: sanitizeString(source.url),
    };
  }

  if (source.type === 'file') {
    return {
      type: 'file',
      fileName: sanitizeString(source.fileName),
      mimeType: sanitizeString(source.mimeType),
      blobKey: sanitizeString(source.blobKey),
    };
  }

  return null;
}

function normalizePriceListItem(value: unknown): RoundPriceListItem | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const item = value as Partial<RoundPriceListItem>;
  const id = sanitizeString(item.id);

  if (!id) {
    return null;
  }

  return {
    id,
    vendorCode: sanitizeString(item.vendorCode),
    productName: sanitizeString(item.productName),
    mass: sanitizeString(item.mass),
    price: normalizeNullableNumber(item.price),
    vialsPerPack: Math.max(1, normalizeInteger(item.vialsPerPack) || 1),
    peptideIds: Array.isArray(item.peptideIds) ? item.peptideIds.map(sanitizeString).filter(Boolean) : [],
    needsReview: item.needsReview === true,
  };
}

function getRoundSortDate(round: Round) {
  const dateValue = round.startDate || round.endDate || round.updatedAt || round.createdAt || '';
  const timestamp = Date.parse(dateValue);

  return Number.isFinite(timestamp) ? timestamp : 0;
}

function normalizeTestingTier(value: unknown): TestingTierId {
  return value === 'platinum' || value === 'gold' || value === 'gold-plus' || value === 'bronze'
    ? value
    : 'none';
}

function normalizeRoundPriceSourceMode(value: unknown): Round['priceSourceMode'] {
  return value === 'vendor-default' || value === 'round-override' ? value : 'none';
}

function normalizeInteger(value: unknown) {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function normalizePercent(value: unknown) {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : 0;
}

function normalizeNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
}

function sanitizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeMatchText(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function findPeptideByName(name: string, peptides: PeptideDictionaryItem[]) {
  const normalizedName = normalizeMatchText(name);

  if (!normalizedName) {
    return null;
  }

  return peptides.find((peptide) => normalizeMatchText(peptide.name) === normalizedName) ?? null;
}
