export function getAuthenticatedAccountUrl(value, base = 'https://helix.invalid') {
  const url = new URL(String(value), base);

  if (url.pathname !== '/account' || !url.searchParams.has('mode')) {
    return '';
  }

  url.searchParams.delete('mode');
  return `${url.pathname}${url.search}${url.hash}`;
}
