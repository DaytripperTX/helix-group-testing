CREATE TABLE admin_access_links (
  id UUID PRIMARY KEY,
  token_hash CHAR(64) NOT NULL UNIQUE
    CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_by_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT admin_access_links_expiration_check CHECK (expires_at > created_at)
);

CREATE INDEX admin_access_links_active_idx
  ON admin_access_links (created_by_account_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE admin_access_requests (
  id UUID PRIMARY KEY,
  link_id UUID NOT NULL REFERENCES admin_access_links(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  CONSTRAINT admin_access_requests_link_account_unique UNIQUE (link_id, account_id),
  CONSTRAINT admin_access_requests_review_check CHECK (
    (status = 'pending' AND reviewed_at IS NULL AND reviewed_by_account_id IS NULL) OR
    (status IN ('approved', 'rejected') AND reviewed_at IS NOT NULL AND reviewed_by_account_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX admin_access_requests_one_pending_per_account_idx
  ON admin_access_requests (account_id)
  WHERE status = 'pending';

CREATE INDEX admin_access_requests_status_idx
  ON admin_access_requests (status, requested_at DESC);
