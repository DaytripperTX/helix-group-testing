export const defaultCoaFilters = Object.freeze({
  roundId: 'all',
  peptideToken: 'all',
  searchTerm: '',
});

export function parseCoaFilterSearch(search = '') {
  const params = new URLSearchParams(String(search).replace(/^\?/, ''));

  return {
    roundId: normalizeFilterValue(params.get('r')) || 'all',
    peptideToken: normalizeFilterValue(params.get('p')) || 'all',
    searchTerm: normalizeFilterValue(params.get('q')),
  };
}

export function serializeCoaFilterSearch(filters = defaultCoaFilters) {
  const params = new URLSearchParams();
  const roundId = normalizeFilterValue(filters.roundId);
  const peptideToken = normalizeFilterValue(filters.peptideToken);
  const searchTerm = normalizeFilterValue(filters.searchTerm);

  if (roundId && roundId !== 'all') {
    params.set('r', roundId);
  }

  if (peptideToken && peptideToken !== 'all') {
    params.set('p', peptideToken);
  }

  if (searchTerm) {
    params.set('q', searchTerm);
  }

  const query = params.toString();
  return query ? `?${query}` : '';
}

export function createCoaListPath(pathname, filters = defaultCoaFilters) {
  return `${normalizePathname(pathname)}${serializeCoaFilterSearch(filters)}`;
}

export function createCoaDetailPath(pathname, resultId) {
  const normalizedResultId = normalizeFilterValue(resultId);
  return normalizedResultId
    ? `${normalizePathname(pathname)}#${encodeURIComponent(normalizedResultId)}`
    : normalizePathname(pathname);
}

export function createCoaPeptideFilterOptions(results = []) {
  const peptideNames = [...new Set(
    results
      .map((result) => normalizeFilterValue(result?.peptideName))
      .filter(Boolean),
  )].sort((first, second) => first.localeCompare(second));
  const candidateOptions = peptideNames.map((label) => {
    const peptideIds = [...new Set(
      results
        .filter((result) => normalizeFilterValue(result?.peptideName) === label)
        .map((result) => normalizeFilterValue(result?.peptideId))
        .filter(Boolean),
    )].sort();

    return {
      label,
      token: peptideIds.length === 1 ? peptideIds[0] : slugifyFilterToken(label) || label,
    };
  });
  const collisionSafeOptions = replaceDuplicateTokensWithLabels(candidateOptions);
  const remainingTokenCounts = countTokens(collisionSafeOptions);

  return collisionSafeOptions.map((option) => (
    remainingTokenCounts.get(option.token) === 1
      ? option
      : { ...option, token: `name:${option.label}` }
  ));
}

function replaceDuplicateTokensWithLabels(options) {
  const tokenCounts = countTokens(options);

  return options.map((option) => (
    tokenCounts.get(option.token) === 1
      ? option
      : { ...option, token: option.label }
  ));
}

function countTokens(options) {
  const tokenCounts = new Map();

  options.forEach((option) => {
    tokenCounts.set(option.token, (tokenCounts.get(option.token) ?? 0) + 1);
  });

  return tokenCounts;
}

function slugifyFilterToken(value) {
  return normalizeFilterValue(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeFilterValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePathname(pathname) {
  const normalizedPathname = normalizeFilterValue(pathname);
  return normalizedPathname || '/coas';
}
