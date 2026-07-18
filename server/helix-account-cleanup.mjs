import { admin as identityAdmin } from '@netlify/identity';
import {
  deleteAccountByIdentityUserId,
  listDueAccountDeletions,
} from './helix-account-postgres.mjs';

export async function runAccountDeletionCleanup(options = {}) {
  const admin = options.admin ?? identityAdmin;
  const now = options.now ?? new Date().toISOString();
  const dueAccounts = await listDueAccountDeletions(now, options.limit ?? 50);
  const summary = {
    checkedAt: now,
    due: dueAccounts.length,
    deleted: 0,
    failed: 0,
    failures: [],
  };

  for (const account of dueAccounts) {
    try {
      try {
        await admin.deleteUser(account.identityUserId);
      } catch (error) {
        if (!isIdentityNotFoundError(error)) {
          throw error;
        }
      }

      await deleteAccountByIdentityUserId(account.identityUserId);
      summary.deleted += 1;
    } catch (error) {
      summary.failed += 1;
      summary.failures.push({
        accountId: account.id,
        identityUserId: account.identityUserId,
        message: error?.message ?? 'Deletion failed.',
      });
    }
  }

  if (summary.failed > 0) {
    console.error('[helix-account-cleanup] account deletion failures', summary);
  }

  return summary;
}

function isIdentityNotFoundError(error) {
  return Number(error?.status ?? error?.statusCode) === 404;
}
