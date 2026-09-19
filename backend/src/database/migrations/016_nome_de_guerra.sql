-- Preserve the full name; presence uses an explicitly chosen military display name.
ALTER TABLE users ADD COLUMN nome_guerra VARCHAR(100);
