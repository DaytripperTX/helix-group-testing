import { runAccountDeletionCleanup } from '../../server/helix-account-cleanup.mjs';

export default async () => {
  const summary = await runAccountDeletionCleanup();

  console.log('[helix-account-cleanup] completed', summary);
};

export const config = {
  schedule: '@hourly',
};
