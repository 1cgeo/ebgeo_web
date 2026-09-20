-- Which map controls a briefing slide shows WHILE PRESENTED (owner's rule, 2026-09-20: a clean stage,
-- every control hidden unless the author ticked it for that slide). JSONB of booleans over a CLOSED
-- list (src/modules/sync/slide-controls.js); NULL and the empty object both mean "none", which is how
-- every slide written before this file presents.
ALTER TABLE slides ADD COLUMN controls JSONB;
