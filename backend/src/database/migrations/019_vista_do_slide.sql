-- The VIEW of a briefing slide (2026-09-20). The base layer and the temporal switch stopped being
-- synced map settings and became view state of each person, so a slide has to say what IT shows.
-- Both are nullable on purpose: NULL means "inherit what was saved with the map", which is how
-- every slide written before this file keeps presenting exactly as it did.
ALTER TABLE slides
    ADD COLUMN base_layer VARCHAR(100),
    ADD COLUMN temporal_enabled BOOLEAN;
