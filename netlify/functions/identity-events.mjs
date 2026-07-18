import { deleteAccountByIdentityUserId } from '../../server/helix-account-postgres.mjs';

export default {
  async userDeleted(event) {
    const identityUserId = event?.user?.id;

    if (identityUserId) {
      await deleteAccountByIdentityUserId(identityUserId);
    }
  },
};
