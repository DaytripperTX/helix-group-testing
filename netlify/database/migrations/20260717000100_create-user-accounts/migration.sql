CREATE TABLE accounts (
  id UUID PRIMARY KEY,
  identity_user_id TEXT NOT NULL UNIQUE
    CHECK (CHAR_LENGTH(identity_user_id) BETWEEN 1 AND 200),
  email TEXT NOT NULL
    CHECK (CHAR_LENGTH(email) BETWEEN 3 AND 320),
  email_normalized TEXT NOT NULL UNIQUE
    CHECK (email_normalized = LOWER(BTRIM(email))),
  username VARCHAR(30) NOT NULL
    CHECK (CHAR_LENGTH(username) BETWEEN 3 AND 30)
    CHECK (username ~ '^[A-Za-z0-9_-]+$'),
  username_normalized VARCHAR(30) NOT NULL UNIQUE
    CHECK (username_normalized = LOWER(username)),
  role TEXT NOT NULL DEFAULT 'user'
    CHECK (role IN ('user', 'admin', 'owner')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'deletion_pending')),
  email_verified_at TIMESTAMPTZ NOT NULL,
  last_login_at TIMESTAMPTZ NOT NULL,
  deletion_requested_at TIMESTAMPTZ,
  deletion_scheduled_for TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT accounts_deletion_state_check CHECK (
    (
      status = 'active'
      AND deletion_requested_at IS NULL
      AND deletion_scheduled_for IS NULL
    ) OR (
      status = 'deletion_pending'
      AND deletion_requested_at IS NOT NULL
      AND deletion_scheduled_for IS NOT NULL
      AND deletion_scheduled_for > deletion_requested_at
    )
  )
);

CREATE UNIQUE INDEX accounts_single_owner_idx
  ON accounts ((role))
  WHERE role = 'owner';

CREATE INDEX accounts_role_idx
  ON accounts (role, created_at);

CREATE INDEX accounts_deletion_due_idx
  ON accounts (deletion_scheduled_for)
  WHERE status = 'deletion_pending';

CREATE TABLE admin_invites (
  id UUID PRIMARY KEY,
  token_hash CHAR(64) NOT NULL UNIQUE
    CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  recipient_email TEXT NOT NULL
    CHECK (CHAR_LENGTH(recipient_email) BETWEEN 3 AND 320),
  recipient_email_normalized TEXT NOT NULL
    CHECK (recipient_email_normalized = LOWER(BTRIM(recipient_email))),
  role TEXT NOT NULL DEFAULT 'admin'
    CHECK (role = 'admin'),
  created_by_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  consumed_by_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT admin_invites_expiration_check CHECK (expires_at > created_at),
  CONSTRAINT admin_invites_terminal_state_check CHECK (
    NOT (consumed_at IS NOT NULL AND revoked_at IS NOT NULL)
  ),
  CONSTRAINT admin_invites_consumption_check CHECK (
    (consumed_at IS NULL AND consumed_by_account_id IS NULL) OR
    (consumed_at IS NOT NULL AND consumed_by_account_id IS NOT NULL)
  )
);

CREATE INDEX admin_invites_recipient_idx
  ON admin_invites (recipient_email_normalized, created_at DESC);

CREATE INDEX admin_invites_active_idx
  ON admin_invites (expires_at)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;
