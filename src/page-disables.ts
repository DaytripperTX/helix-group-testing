export const publicPageItems = [
  { id: 'home', label: 'Home', path: '/' },
  { id: 'order-form', label: 'Order Form', path: '/order-form' },
  { id: 'testing', label: 'Testing', path: '/testing' },
  { id: 'coas', label: 'COAs', path: '/coas' },
  { id: 'labels', label: 'Labels', path: '/labels' },
  { id: 'faqs', label: 'FAQs', path: '/faqs' },
] as const;

export const toggleablePageIds = [
  'order-form',
  'testing',
  'coas',
  'labels',
  'faqs',
] as const;

export type PublicPageId = (typeof publicPageItems)[number]['id'];
export type ToggleablePageId = (typeof toggleablePageIds)[number];

const toggleablePageIdSet = new Set<string>(toggleablePageIds);
const pageIdByPath = new Map<string, PublicPageId>(
  publicPageItems.map((page) => [page.path, page.id])
);
const toggleablePageLabels = toggleablePageIds
  .flatMap((id) => {
    const page = publicPageItems.find((item) => item.id === id);
    return page ? [id, page.path] : [id];
  })
  .join(', ');

export function parseDisabledPages(value: string | undefined): ToggleablePageId[] {
  if (!value?.trim()) {
    return [];
  }

  const disabledPages = new Set<ToggleablePageId>();
  const tokens = value.split(/[,\s]+/).map((token) => token.trim()).filter(Boolean);

  for (const token of tokens) {
    const normalizedToken = normalizeDisabledPageToken(token);
    const pageId = normalizedToken.startsWith('/')
      ? pageIdByPath.get(normalizedToken)
      : normalizedToken;

    if (!pageId || !toggleablePageIdSet.has(pageId)) {
      throw new Error(
        `Invalid DISABLED_PAGES value "${token}". Allowed values are: ${toggleablePageLabels}.`
      );
    }

    disabledPages.add(pageId as ToggleablePageId);
  }

  return [...disabledPages];
}

function normalizeDisabledPageToken(token: string) {
  const trimmedToken = token.trim().toLowerCase();

  if (trimmedToken === '/') {
    return trimmedToken;
  }

  return trimmedToken.replace(/\/+$/, '');
}
