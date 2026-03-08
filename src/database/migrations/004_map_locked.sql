-- Path: src/database/migrations/004_map_locked.sql
-- Add locked field to maps (same pattern as layers and groups)

ALTER TABLE maps ADD COLUMN locked BOOLEAN NOT NULL DEFAULT FALSE;
