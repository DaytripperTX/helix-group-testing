import {
  getDataMode,
  verifyLabelDatabase,
} from '../../server/helix-data.mjs';

export async function runScheduledLabelDatabaseVerification() {
  const mode = getDataMode();

  if (mode !== 'shadow') {
    return {
      skipped: true,
      mode,
      reason: 'mode-not-shadow',
    };
  }

  const verification = await verifyLabelDatabase({ operation: 'manual' });

  return {
    skipped: false,
    mode,
    checkedAt: verification.checkedAt,
    isExact: verification.isExact,
    legacyCount: verification.legacyCount,
    postgresCount: verification.postgresCount,
    matchedCount: verification.matchedCount,
    missingCount: verification.missingInPostgresIds.length,
    extraCount: verification.extraInPostgresIds.length,
    differentCount: verification.differentIds.length,
    blockedCount: verification.blockedIds.length,
  };
}

export default async function scheduledLabelDatabaseVerification() {
  const result = await runScheduledLabelDatabaseVerification();

  console.info('[label-database-verification]', result);

  if (!result.skipped && !result.isExact) {
    throw new Error('Scheduled label database verification found storage discrepancies.');
  }
}

export const config = {
  schedule: '0 */12 * * *',
};
