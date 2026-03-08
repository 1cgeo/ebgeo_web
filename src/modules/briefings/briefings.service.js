// Path: src/modules/briefings/briefings.service.js
import { query } from '../../database/index.js';
import { NotFoundError } from '../../utils/errors.js';
import * as Q from './briefings.queries.js';

export async function listBriefings(atlasId) {
  const { rows } = await query(Q.LIST_BRIEFINGS_BY_ATLAS, [atlasId]);
  return rows;
}

export async function createBriefing(atlasId, data) {
  const defaultSettings = {
    panelPosition: 'left',
    panelWidth: 350,
    panelBackgroundColor: 'rgba(255, 255, 255, 0.95)',
    ...data.settings,
  };

  const { rows } = await query(Q.INSERT_BRIEFING, [
    atlasId,
    data.name,
    data.description || null,
    JSON.stringify(defaultSettings),
  ]);
  return rows[0];
}

export async function getBriefingById(atlasId, briefingId) {
  const { rows } = await query(Q.FIND_BRIEFING_BY_ID, [briefingId, atlasId]);
  if (rows.length === 0) {
    throw new NotFoundError('Briefing');
  }
  const briefing = rows[0];

  // Get slides
  const slidesResult = await query(Q.LIST_SLIDES_BY_BRIEFING, [briefingId]);
  briefing.slides = slidesResult.rows;

  return briefing;
}

export async function updateBriefing(atlasId, briefingId, data) {
  const { rows } = await query(Q.UPDATE_BRIEFING, [
    briefingId,
    atlasId,
    data.name || null,
    data.description !== undefined ? data.description : null,
    data.settings ? JSON.stringify(data.settings) : null,
  ]);
  if (rows.length === 0) {
    throw new NotFoundError('Briefing');
  }
  return rows[0];
}

export async function deleteBriefing(atlasId, briefingId) {
  const { rows } = await query(Q.SOFT_DELETE_BRIEFING, [briefingId, atlasId]);
  if (rows.length === 0) {
    throw new NotFoundError('Briefing');
  }
  return true;
}

export async function createSlide(atlasId, briefingId, data) {
  // Verify briefing exists
  await getBriefingById(atlasId, briefingId);

  const defaultPosition = {
    longitude: null,
    latitude: null,
    zoom: null,
    altitude: null,
    ...data.position,
  };

  const defaultOrientation = {
    bearing: 0,
    pitch: 0,
    heading: null,
    ...data.orientation,
  };

  const { rows } = await query(Q.INSERT_SLIDE, [
    briefingId,
    data.title || null,
    data.content || null,
    data.mode || '2d',
    data.map_id || null,
    data.model_id || null,
    data.photo_id || null,
    JSON.stringify(defaultPosition),
    JSON.stringify(defaultOrientation),
  ]);

  // Add to slide order
  await query(Q.ADD_SLIDE_TO_ORDER, [briefingId, rows[0].id]);

  return rows[0];
}

export async function updateSlide(atlasId, briefingId, slideId, data) {
  // Verify briefing exists
  await getBriefingById(atlasId, briefingId);

  const { rows } = await query(Q.UPDATE_SLIDE, [
    slideId,
    briefingId,
    data.title !== undefined ? data.title : null,
    data.content !== undefined ? data.content : null,
    data.mode || null,
    data.map_id !== undefined ? data.map_id : null,
    data.model_id !== undefined ? data.model_id : null,
    data.photo_id !== undefined ? data.photo_id : null,
    data.position ? JSON.stringify(data.position) : null,
    data.orientation ? JSON.stringify(data.orientation) : null,
  ]);

  if (rows.length === 0) {
    throw new NotFoundError('Slide');
  }
  return rows[0];
}

export async function deleteSlide(atlasId, briefingId, slideId) {
  // Verify briefing exists
  await getBriefingById(atlasId, briefingId);

  const { rows } = await query(Q.SOFT_DELETE_SLIDE, [slideId, briefingId]);
  if (rows.length === 0) {
    throw new NotFoundError('Slide');
  }

  // Remove from slide order
  await query(Q.REMOVE_SLIDE_FROM_ORDER, [briefingId, slideId]);

  return true;
}

export async function reorderSlides(atlasId, briefingId, slideOrder) {
  // Verify briefing exists
  await getBriefingById(atlasId, briefingId);

  const { rows } = await query(Q.UPDATE_SLIDE_ORDER, [briefingId, slideOrder]);
  return rows[0];
}
