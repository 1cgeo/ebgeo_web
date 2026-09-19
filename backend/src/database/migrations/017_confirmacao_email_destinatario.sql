-- Bind confirmation to the mailbox that actually received the link.
-- Historical tokens have no trustworthy recipient snapshot. Leave them NULL:
-- verification refuses them, and resend issues a bound replacement. Accounts,
-- passwords, confirmed addresses and other token purposes remain unchanged.
ALTER TABLE email_verification_tokens ADD COLUMN email_at_issue VARCHAR(255);

COMMENT ON COLUMN email_verification_tokens.email_at_issue IS
  'Mailbox to which a signup/resend verification token was sent. NULL legacy verify tokens require resend.';
