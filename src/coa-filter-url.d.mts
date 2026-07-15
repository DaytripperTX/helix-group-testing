export type CoaFilterUrlState = {
  roundId: string;
  peptideToken: string;
  searchTerm: string;
};

export type CoaPeptideFilterOption = {
  token: string;
  label: string;
};

export const defaultCoaFilters: Readonly<CoaFilterUrlState>;
export function parseCoaFilterSearch(search?: string): CoaFilterUrlState;
export function serializeCoaFilterSearch(filters?: CoaFilterUrlState): string;
export function createCoaListPath(pathname: string, filters?: CoaFilterUrlState): string;
export function createCoaDetailPath(pathname: string, resultId: string): string;
export function createCoaPeptideFilterOptions(
  results?: Array<{ peptideName?: string; peptideId?: string }>,
): CoaPeptideFilterOption[];
