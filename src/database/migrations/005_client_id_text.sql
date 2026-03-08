-- Path: src/database/migrations/005_client_id_text.sql
-- Fix client_id column type: UUID → TEXT to accept frontend-generated string IDs

ALTER TABLE operations ALTER COLUMN client_id TYPE TEXT;
ALTER TABLE active_sessions ALTER COLUMN client_id TYPE TEXT;
