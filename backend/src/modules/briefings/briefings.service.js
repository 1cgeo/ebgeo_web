// Path: src/modules/briefings/briefings.service.js
// Read-only module. All write operations are managed via sync API (POST /atlas/:id/sync).
import { query } from '../../database/index.js';
import { NotFoundError } from '../../utils/errors.js';
import * as Q from './briefings.queries.js';

export async function listBriefings(atlasId) {
  const { rows } = await query(Q.LIST_BRIEFINGS_BY_ATLAS, [atlasId]);
  return rows;
}

export async function getBriefingById(atlasId, briefingId) {
  const { rows } = await query(Q.FIND_BRIEFING_BY_ID, [briefingId, atlasId]);
  if (rows.length === 0) {
    throw new NotFoundError('Briefing');
  }
  const briefing = rows[0];

  const slidesResult = await query(Q.LIST_SLIDES_BY_BRIEFING, [briefingId]);
  briefing.slides = slidesResult.rows;

  return briefing;
}
