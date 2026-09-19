-- Recovery codes are bound to the confirmed mailbox and session generation.
-- Legacy recovery codes lack a trustworthy snapshot; request a fresh code.
ALTER TABLE email_verification_tokens ADD COLUMN reset_sessions_valid_from TIMESTAMPTZ;

COMMENT ON COLUMN email_verification_tokens.reset_sessions_valid_from IS
  'Exact session cutoff at recovery issuance; changing credentials/revoking sessions invalidates the code.';
