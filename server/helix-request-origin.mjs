const defaultNetlifySiteName = 'helix-group-testing';
const netlifyUrlEnvironmentKeys = ['URL', 'DEPLOY_URL', 'DEPLOY_PRIME_URL'];

export function verifyHelixRequestOrigin(request, verifier, environment = process.env) {
  verifier(request, {
    allowedOrigins: getHelixAllowedRequestOrigins(request, environment),
  });
}

export function getHelixAllowedRequestOrigins(request, environment = process.env) {
  const allowedOrigins = new Set();

  addHttpOrigin(allowedOrigins, request.url);

  for (const key of netlifyUrlEnvironmentKeys) {
    addHttpOrigin(allowedOrigins, environment[key]);
  }

  const browserOrigin = normalizeHttpOrigin(request.headers.get('origin'));

  if (isExpectedPreviewServerOrigin(browserOrigin, environment)) {
    allowedOrigins.add(browserOrigin);
  }

  return [...allowedOrigins];
}

export function getHelixPublicRequestOrigin(request, environment = process.env) {
  const browserOrigin = normalizeHttpOrigin(request.headers.get('origin'));

  if (browserOrigin && getHelixAllowedRequestOrigins(request, environment).includes(browserOrigin)) {
    return browserOrigin;
  }

  return new URL(request.url).origin;
}

function isExpectedPreviewServerOrigin(origin, environment) {
  if (!origin || environment.NETLIFY_PREVIEW_SERVER !== 'true') {
    return false;
  }

  const url = new URL(origin);

  if (url.protocol !== 'https:' || url.port) {
    return false;
  }

  const siteName = getNetlifySiteName(environment);
  const previewPrefix = 'devserver-';
  const previewSuffix = `--${siteName}.netlify.app`;

  if (!url.hostname.startsWith(previewPrefix) || !url.hostname.endsWith(previewSuffix)) {
    return false;
  }

  const branchSlug = url.hostname.slice(previewPrefix.length, -previewSuffix.length);
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(branchSlug);
}

function getNetlifySiteName(environment) {
  const configuredSiteName = normalizeDnsLabel(environment.SITE_NAME);

  if (configuredSiteName) {
    return configuredSiteName;
  }

  const mainSiteName = getNetlifySiteNameFromUrl(environment.URL);
  return mainSiteName || defaultNetlifySiteName;
}

function getNetlifySiteNameFromUrl(value) {
  const origin = normalizeHttpOrigin(value);

  if (!origin) {
    return '';
  }

  const hostname = new URL(origin).hostname;
  const suffix = '.netlify.app';

  if (!hostname.endsWith(suffix)) {
    return '';
  }

  const siteName = hostname.slice(0, -suffix.length);
  return siteName.includes('--') ? '' : normalizeDnsLabel(siteName);
}

function normalizeDnsLabel(value) {
  const label = String(value ?? '').trim().toLowerCase();
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label) ? label : '';
}

function addHttpOrigin(origins, value) {
  const origin = normalizeHttpOrigin(value);

  if (origin) {
    origins.add(origin);
  }
}

function normalizeHttpOrigin(value) {
  if (!value) {
    return '';
  }

  try {
    const url = new URL(String(value));

    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      return '';
    }

    return url.origin;
  } catch {
    return '';
  }
}
