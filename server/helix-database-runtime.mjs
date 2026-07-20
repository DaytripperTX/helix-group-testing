import { getDatabase } from '@netlify/database';

export function getHelixDatabaseOverride() {
  return getRuntimeEnvironmentValue('HELIX_DATABASE_URL');
}

export function createHelixDatabase(connectionString = getHelixDatabaseOverride()) {
  return connectionString
    ? getDatabase({ connectionString })
    : getDatabase();
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
