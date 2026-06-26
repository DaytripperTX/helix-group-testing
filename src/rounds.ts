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
  participants: number;
  roundDiscountPercent: number;
  priceListSnapshot: RoundPriceListSnapshot | null;
  peptides: RoundPeptide[];
  createdAt?: string;
  updatedAt?: string;
};

export async function fetchRounds() {
  const response = await fetch('/api/data/rounds');

  if (!response.ok) {
    throw new Error('Rounds could not be loaded.');
  }

  const records = (await response.json()) as unknown;
  return Array.isArray(records)
    ? records.map(normalizeRound).filter((round): round is Round => Boolean(round))
    : [];
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
