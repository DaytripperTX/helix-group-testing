CREATE TABLE label_templates (
  id TEXT PRIMARY KEY,
  preview_asset_key TEXT NOT NULL CHECK (preview_asset_key LIKE 'label-previews/%'),
  preview_mime_type TEXT NOT NULL CHECK (preview_mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
  preview_file_name TEXT NOT NULL,
  preview_byte_length INTEGER NOT NULL DEFAULT 0 CHECK (preview_byte_length >= 0),
  niimbot_code TEXT NOT NULL,
  template_name TEXT,
  peptide_name TEXT NOT NULL,
  mass_mg TEXT NOT NULL,
  label_size TEXT NOT NULL,
  moderation_status TEXT NOT NULL DEFAULT 'unreviewed'
    CHECK (moderation_status IN ('unreviewed', 'approved', 'rejected')),
  vote_count INTEGER NOT NULL DEFAULT 0 CHECK (vote_count >= 0),
  report_count INTEGER NOT NULL DEFAULT 0 CHECK (report_count >= 0),
  deleted_at TIMESTAMPTZ,
  deleted_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT label_templates_deletion_state_check CHECK (
    (deleted_at IS NULL AND deleted_reason IS NULL) OR
    (deleted_at IS NOT NULL AND deleted_reason IN ('admin', 'rejected'))
  ),
  CONSTRAINT label_templates_rejection_state_check CHECK (
    moderation_status <> 'rejected' OR deleted_at IS NOT NULL
  )
);

CREATE TABLE label_template_categories (
  label_id TEXT NOT NULL REFERENCES label_templates(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  ordinal SMALLINT NOT NULL CHECK (ordinal >= 0),
  PRIMARY KEY (label_id, category),
  UNIQUE (label_id, ordinal)
);

CREATE TABLE label_template_tags (
  label_id TEXT NOT NULL REFERENCES label_templates(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  ordinal SMALLINT NOT NULL CHECK (ordinal >= 0),
  PRIMARY KEY (label_id, tag),
  UNIQUE (label_id, ordinal)
);

CREATE TABLE label_votes (
  label_id TEXT NOT NULL REFERENCES label_templates(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  ordinal SMALLINT NOT NULL CHECK (ordinal >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (label_id, fingerprint)
);

CREATE TABLE label_reports (
  label_id TEXT NOT NULL REFERENCES label_templates(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('offensive', 'spam', 'unsafe', 'other')),
  details TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  include_in_reports BOOLEAN NOT NULL DEFAULT TRUE,
  include_in_fingerprints BOOLEAN NOT NULL DEFAULT TRUE,
  report_ordinal SMALLINT CHECK (report_ordinal IS NULL OR report_ordinal >= 0),
  fingerprint_ordinal SMALLINT CHECK (fingerprint_ordinal IS NULL OR fingerprint_ordinal >= 0),
  PRIMARY KEY (label_id, fingerprint)
);

CREATE TABLE label_storage_verifications (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  operation TEXT NOT NULL DEFAULT 'manual'
    CHECK (operation IN ('manual', 'backfill', 'repair')),
  observation_reset BOOLEAN NOT NULL DEFAULT FALSE,
  legacy_count INTEGER NOT NULL CHECK (legacy_count >= 0),
  postgres_count INTEGER NOT NULL CHECK (postgres_count >= 0),
  matched_count INTEGER NOT NULL CHECK (matched_count >= 0),
  missing_count INTEGER NOT NULL CHECK (missing_count >= 0),
  extra_count INTEGER NOT NULL CHECK (extra_count >= 0),
  different_count INTEGER NOT NULL CHECK (different_count >= 0),
  is_exact BOOLEAN NOT NULL,
  legacy_hash TEXT NOT NULL,
  postgres_hash TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::JSONB
);

CREATE INDEX label_templates_public_visibility_idx
  ON label_templates (created_at DESC)
  WHERE deleted_at IS NULL AND moderation_status <> 'rejected' AND report_count < 5;

CREATE INDEX label_templates_moderation_idx
  ON label_templates (moderation_status, updated_at DESC);

CREATE INDEX label_templates_peptide_name_idx
  ON label_templates (LOWER(peptide_name));

CREATE INDEX label_template_categories_category_idx
  ON label_template_categories (LOWER(category), label_id);

CREATE INDEX label_templates_updated_at_idx
  ON label_templates (updated_at DESC);

CREATE INDEX label_storage_verifications_checked_at_idx
  ON label_storage_verifications (checked_at DESC);
