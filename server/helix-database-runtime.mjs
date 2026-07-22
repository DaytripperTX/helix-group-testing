import { getDatabase } from '@netlify/database';

export function getHelixDatabaseOverride() {
  const configuredOverride = getRuntimeEnvironmentValue('HELIX_DATABASE_URL');

  if (configuredOverride) {
    return configuredOverride;
  }

  return addNetlifyDevDatabaseUser(getRuntimeEnvironmentValue('NETLIFY_DB_URL'));
}

export function createHelixDatabase(connectionString = getHelixDatabaseOverride()) {
  return connectionString
    ? getDatabase({ connectionString })
    : getDatabase();
}

export function addNetlifyDevDatabaseUser(connectionString) {
  try {
    const url = new URL(connectionString);
    const isPostgres = url.protocol === 'postgres:' || url.protocol === 'postgresql:';
    const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);

    if (!isPostgres || !isLoopback || url.username) {
      return '';
    }

    url.username = 'netlify';
    return url.toString();
  } catch {
    return '';
  }
}

function getRuntimeEnvironmentValue(name) {
  try {
    const runtimeValue = globalThis.Netlify?.env?.get?.(name);

    if (typeof runtimeValue === 'string' && runtimeValue.trim()) {
      return runtimeValue.trim();
    }
  } catch {
    // Fall back to process.env outside the Netlify runtime.
  }

  const processValue = process.env[name];
  return typeof processValue === 'string' ? processValue.trim() : '';
}
