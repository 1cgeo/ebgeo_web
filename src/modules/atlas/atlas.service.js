// Path: src/modules/atlas/atlas.service.js
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { query, tx } from '../../database/index.js';
import { NotFoundError } from '../../utils/errors.js';
import config from '../../config.js';
import * as Q from './atlas.queries.js';

/**
 * Creates a new atlas owned by the specified user.
 */
export async function createAtlas(userId, data) {
  const { rows } = await query(Q.INSERT_ATLAS, [
    data.name,
    data.description || null,
    userId,
  ]);
  return rows[0];
}

/**
 * Lists all atlas accessible by a user (owned or shared).
 */
export async function listUserAtlas(userId) {
  const { rows } = await query(Q.LIST_USER_ATLAS, [userId]);
  return rows;
}

/**
 * Gets a single atlas by ID with maps summary.
 */
export async function getAtlasById(atlasId) {
  const { rows } = await query(Q.FIND_ATLAS_BY_ID, [atlasId]);

  if (rows.length === 0) {
    throw new NotFoundError('Atlas');
  }

  const atlas = rows[0];

  // Get maps summary
  const mapsResult = await query(Q.GET_ATLAS_MAPS_SUMMARY, [atlasId]);
  atlas.maps = mapsResult.rows;

  return atlas;
}

/**
 * Updates atlas metadata.
 */
export async function updateAtlas(atlasId, data) {
  const { rows } = await query(Q.UPDATE_ATLAS, [
    atlasId,
    data.name || null,
    data.description !== undefined ? data.description : null,
    data.map_order || null,
  ]);

  if (rows.length === 0) {
    throw new NotFoundError('Atlas');
  }

  return rows[0];
}

/**
 * Soft-deletes an atlas.
 */
export async function deleteAtlas(atlasId) {
  const { rows } = await query(Q.SOFT_DELETE_ATLAS, [atlasId]);

  if (rows.length === 0) {
    throw new NotFoundError('Atlas');
  }

  return true;
}

/**
 * Gets atlas settings.
 */
export async function getAtlasSettings(atlasId) {
  const { rows } = await query(Q.FIND_ATLAS_BY_ID, [atlasId]);

  if (rows.length === 0) {
    throw new NotFoundError('Atlas');
  }

  return rows[0].settings;
}

/**
 * Updates atlas settings (partial merge).
 */
export async function updateAtlasSettings(atlasId, settings) {
  const { rows } = await query(Q.UPDATE_ATLAS_SETTINGS, [
    atlasId,
    JSON.stringify(settings),
  ]);

  if (rows.length === 0) {
    throw new NotFoundError('Atlas');
  }

  return rows[0];
}

/**
 * Gets atlas by public link and generates a temporary read-only token for WebSocket access.
 */
export async function getAtlasByPublicLink(publicLink) {
  const { rows } = await query(Q.FIND_ATLAS_BY_PUBLIC_LINK, [publicLink]);

  if (rows.length === 0) {
    throw new NotFoundError('Atlas');
  }

  const atlas = rows[0];

  // Generate temporary public token for WebSocket access (read-only, 1 hour expiry)
  const publicUserId = `public-${crypto.randomUUID()}`;
  const publicToken = jwt.sign(
    {
      sub: publicUserId,
      atlasId: atlas.id,
      isPublic: true,
      permission: 'read',
      nome: 'Visitante',
    },
    config.jwt.secret,
    { expiresIn: '1h' }
  );

  atlas.publicToken = publicToken;

  return atlas;
}

/**
 * Clones an atlas to a new owner.
 */
export async function cloneAtlas(atlasId, newOwnerId, options = {}) {
  let newAtlasId;

  await tx(async (t) => {
    // Get source atlas
    const source = await t.oneOrNone(Q.FIND_ATLAS_BY_ID, [atlasId]);
    if (!source) {
      throw new NotFoundError('Atlas');
    }

    // Create new atlas
    const cloneName = options.name || `${source.name} (cópia)`;
    const newAtlas = await t.one(
      `INSERT INTO atlas (name, description, owner_id, settings)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [
        cloneName,
        source.description,
        newOwnerId,
        JSON.stringify(source.settings),
      ]
    );
    newAtlasId = newAtlas.id;

    // Clone maps
    const maps = await t.any(
      `SELECT * FROM maps WHERE atlas_id = $1 AND deleted_at IS NULL`,
      [atlasId]
    );

    const mapIdMapping = {};
    const newMapOrder = [];

    for (const map of maps) {
      const newMap = await t.one(
        `INSERT INTO maps (atlas_id, name, base_layer, center_lat, center_long, zoom, bearing, pitch, notes_title, notes_description, analysis_layers, catalog_layers, locked)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING id`,
        [
          newAtlas.id,
          map.name,
          map.base_layer,
          map.center_lat,
          map.center_long,
          map.zoom,
          map.bearing,
          map.pitch,
          map.notes_title,
          map.notes_description,
          JSON.stringify(map.analysis_layers),
          JSON.stringify(map.catalog_layers),
          map.locked || false,
        ]
      );
      mapIdMapping[map.id] = newMap.id;
      newMapOrder.push(newMap.id);

      // Clone layers first (features reference layer_id)
      const layers = await t.any(
        `SELECT * FROM layers WHERE map_id = $1 AND deleted_at IS NULL`,
        [map.id]
      );

      const layerIdMapping = {};
      for (const layer of layers) {
        const newLayer = await t.one(
          `INSERT INTO layers (map_id, name, visible, locked, opacity, sort_order, style)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
           RETURNING id`,
          [
            newMap.id,
            layer.name,
            layer.visible,
            layer.locked,
            layer.opacity,
            layer.sort_order,
            JSON.stringify(layer.style || {}),
          ]
        );
        layerIdMapping[layer.id] = newLayer.id;
      }

      // Clone groups (track ID mapping for parent_id remapping and group_features)
      const groups = await t.any(
        `SELECT * FROM groups WHERE map_id = $1 AND deleted_at IS NULL`,
        [map.id]
      );

      const groupIdMapping = {};
      for (const group of groups) {
        const newGroup = await t.one(
          `INSERT INTO groups (map_id, name, visible, locked, style, parent_id)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6)
           RETURNING id`,
          [
            newMap.id,
            group.name,
            group.visible,
            group.locked,
            JSON.stringify(group.style || {}),
            null, // parent_id set in second pass after all groups exist
          ]
        );
        groupIdMapping[group.id] = newGroup.id;
      }

      // Second pass: fix parent_id references for hierarchical groups
      for (const group of groups) {
        if (group.parent_id && groupIdMapping[group.parent_id]) {
          await t.none(
            `UPDATE groups SET parent_id = $2 WHERE id = $1`,
            [groupIdMapping[group.id], groupIdMapping[group.parent_id]]
          );
        }
      }

      // Clone features with remapped layer_id
      const features = await t.any(
        `SELECT * FROM features WHERE map_id = $1 AND deleted_at IS NULL`,
        [map.id]
      );

      const featureIdMapping = {};
      for (const feature of features) {
        const newFeature = await t.one(
          `INSERT INTO features (map_id, feature_type, geometry, properties, layer_id)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [
            newMap.id,
            feature.feature_type,
            JSON.stringify(feature.geometry),
            JSON.stringify(feature.properties),
            feature.layer_id ? (layerIdMapping[feature.layer_id] || null) : null,
          ]
        );
        featureIdMapping[feature.id] = newFeature.id;
      }

      // Clone group_features associations with remapped IDs
      const groupFeatures = await t.any(
        `SELECT gf.* FROM group_features gf
         JOIN groups g ON g.id = gf.group_id
         JOIN features f ON f.id = gf.feature_id
         WHERE g.map_id = $1 AND g.deleted_at IS NULL AND f.deleted_at IS NULL`,
        [map.id]
      );

      for (const gf of groupFeatures) {
        const newGroupId = groupIdMapping[gf.group_id];
        const newFeatureId = featureIdMapping[gf.feature_id];
        if (newGroupId && newFeatureId) {
          await t.none(
            `INSERT INTO group_features (group_id, feature_id) VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [newGroupId, newFeatureId]
          );
        }
      }

      // Clone Cesium 3D data
      const cesium3dData = await t.any(
        `SELECT * FROM cesium3d_data WHERE map_id = $1 AND deleted_at IS NULL`,
        [map.id]
      );

      for (const cesium3d of cesium3dData) {
        await t.none(
          `INSERT INTO cesium3d_data (map_id, data_type, tileset_id, data)
           VALUES ($1, $2, $3, $4::jsonb)`,
          [
            newMap.id,
            cesium3d.data_type,
            cesium3d.tileset_id,
            JSON.stringify(cesium3d.data || {}),
          ]
        );
      }

      // Clone StreetView 360 data
      const streetview360Data = await t.any(
        `SELECT * FROM streetview360_data WHERE map_id = $1 AND deleted_at IS NULL`,
        [map.id]
      );

      for (const sv360 of streetview360Data) {
        await t.none(
          `INSERT INTO streetview360_data (map_id, data_type, photo_name, data)
           VALUES ($1, $2, $3, $4::jsonb)`,
          [
            newMap.id,
            sv360.data_type,
            sv360.photo_name,
            JSON.stringify(sv360.data || {}),
          ]
        );
      }
    }

    // Update map_order
    await t.none(
      `UPDATE atlas SET map_order = $2 WHERE id = $1`,
      [newAtlas.id, newMapOrder]
    );

    // Clone briefings and slides
    const briefings = await t.any(
      `SELECT * FROM briefings WHERE atlas_id = $1 AND deleted_at IS NULL`,
      [atlasId]
    );

    for (const briefing of briefings) {
      const newBriefing = await t.one(
        `INSERT INTO briefings (atlas_id, name, description, settings)
         VALUES ($1, $2, $3, $4::jsonb)
         RETURNING id`,
        [
          newAtlas.id,
          briefing.name,
          briefing.description,
          JSON.stringify(briefing.settings || {}),
        ]
      );

      // Clone slides for this briefing
      const slides = await t.any(
        `SELECT * FROM slides WHERE briefing_id = $1 AND deleted_at IS NULL`,
        [briefing.id]
      );

      const newSlideOrder = [];
      for (const slide of slides) {
        const newSlide = await t.one(
          `INSERT INTO slides (briefing_id, title, content, mode, map_id, model_id, photo_id, position, orientation)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
           RETURNING id`,
          [
            newBriefing.id,
            slide.title,
            slide.content,
            slide.mode,
            slide.map_id ? (mapIdMapping[slide.map_id] || null) : null,
            slide.model_id,
            slide.photo_id,
            JSON.stringify(slide.position || {}),
            JSON.stringify(slide.orientation || {}),
          ]
        );
        newSlideOrder.push(newSlide.id);
      }

      // Update slide_order
      if (newSlideOrder.length > 0) {
        await t.none(
          `UPDATE briefings SET slide_order = $2 WHERE id = $1`,
          [newBriefing.id, newSlideOrder]
        );
      }
    }
  });

  // Return cloned atlas with maps (outside transaction)
  return getAtlasById(newAtlasId);
}

/**
 * Generates a unique public link for an atlas.
 */
function generatePublicLink() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Enables public sharing for an atlas.
 */
export async function enablePublicSharing(atlasId) {
  const publicLink = generatePublicLink();
  const { rows } = await query(Q.UPDATE_PUBLIC_LINK, [atlasId, true, publicLink]);

  if (rows.length === 0) {
    throw new NotFoundError('Atlas');
  }

  return { publicLink };
}

/**
 * Disables public sharing for an atlas.
 */
export async function disablePublicSharing(atlasId) {
  const { rows } = await query(Q.UPDATE_PUBLIC_LINK, [atlasId, false, null]);

  if (rows.length === 0) {
    throw new NotFoundError('Atlas');
  }

  return true;
}

/**
 * Imports a complete atlas from offline storage (IndexedDB).
 * Creates atlas with all maps, features, layers, groups, briefings, and slides.
 * IDs from the client are preserved.
 */
export async function importAtlas(userId, data) {
  const { atlas, maps, briefings } = data;

  return tx(async (t) => {
    // 1. Create atlas
    const newAtlas = await t.one(
      `INSERT INTO atlas (name, description, owner_id, settings)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [
        atlas.name,
        atlas.description || null,
        userId,
        atlas.settings ? JSON.stringify(atlas.settings) : '{}',
      ]
    );

    const atlasId = newAtlas.id;
    const mapIds = [];
    const summary = {
      mapsImported: 0,
      featuresImported: 0,
      layersImported: 0,
      groupsImported: 0,
      cesium3dImported: 0,
      streetview360Imported: 0,
      briefingsImported: 0,
      slidesImported: 0,
    };

    // 2. Import maps
    for (const map of maps || []) {
      await t.none(
        `INSERT INTO maps (id, atlas_id, name, base_layer, center_lat, center_long,
                          zoom, bearing, pitch, notes_title, notes_description,
                          analysis_layers, catalog_layers, locked)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14)`,
        [
          map.id,
          atlasId,
          map.name,
          map.base_layer || 'carta-topografica',
          map.center_lat,
          map.center_long,
          map.zoom,
          map.bearing || 0,
          map.pitch || 0,
          map.notes_title || null,
          map.notes_description || null,
          JSON.stringify(map.analysis_layers || {}),
          JSON.stringify(map.catalog_layers || []),
          map.locked === true,
        ]
      );

      mapIds.push(map.id);
      summary.mapsImported++;

      // 2.1 Import layers (before features, to allow layer_id references)
      for (const layer of map.layers || []) {
        await t.none(
          `INSERT INTO layers (id, map_id, name, visible, locked, opacity, sort_order, style)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
          [
            layer.id,
            map.id,
            layer.name,
            layer.visible !== false,
            layer.locked === true,
            layer.opacity ?? 1,
            layer.sort_order ?? 0,
            JSON.stringify(layer.style || {}),
          ]
        );
        summary.layersImported++;
      }

      // 2.2 Import groups
      for (const group of map.groups || []) {
        await t.none(
          `INSERT INTO groups (id, map_id, name, visible, locked, style, parent_id)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
          [
            group.id,
            map.id,
            group.name,
            group.visible !== false,
            group.locked === true,
            JSON.stringify(group.style || {}),
            group.parent_id || null,
          ]
        );
        summary.groupsImported++;
      }

      // 2.3 Import features
      for (const feature of map.features || []) {
        await t.none(
          `INSERT INTO features (id, map_id, feature_type, geometry, properties, layer_id)
           VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)`,
          [
            feature.id,
            map.id,
            feature.feature_type,
            JSON.stringify(feature.geometry),
            JSON.stringify(feature.properties || {}),
            feature.layer_id || null,
          ]
        );
        summary.featuresImported++;
      }

      // 2.4 Import group-feature associations
      for (const gf of map.groupFeatures || []) {
        await t.none(
          `INSERT INTO group_features (group_id, feature_id)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [gf.group_id, gf.feature_id]
        );
      }

      // 2.5 Import Cesium 3D data
      for (const cesium3d of map.cesium3dData || []) {
        await t.none(
          `INSERT INTO cesium3d_data (id, map_id, data_type, tileset_id, data)
           VALUES ($1, $2, $3, $4, $5::jsonb)`,
          [
            cesium3d.id,
            map.id,
            cesium3d.data_type,
            cesium3d.tileset_id || null,
            JSON.stringify(cesium3d.data || {}),
          ]
        );
        summary.cesium3dImported++;
      }

      // 2.6 Import StreetView 360 data
      for (const sv360 of map.streetview360Data || []) {
        await t.none(
          `INSERT INTO streetview360_data (id, map_id, data_type, photo_name, data)
           VALUES ($1, $2, $3, $4, $5::jsonb)`,
          [
            sv360.id,
            map.id,
            sv360.data_type,
            sv360.photo_name || null,
            JSON.stringify(sv360.data || {}),
          ]
        );
        summary.streetview360Imported++;
      }
    }

    // 3. Update map_order
    if (mapIds.length > 0) {
      await t.none(`UPDATE atlas SET map_order = $2 WHERE id = $1`, [atlasId, mapIds]);
    }

    // 4. Import briefings
    for (const briefing of briefings || []) {
      const slideIds = (briefing.slides || []).map((s) => s.id);

      await t.none(
        `INSERT INTO briefings (id, atlas_id, name, description, settings, slide_order)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
        [
          briefing.id,
          atlasId,
          briefing.name,
          briefing.description || null,
          JSON.stringify(briefing.settings || {}),
          slideIds,
        ]
      );
      summary.briefingsImported++;

      // 4.1 Import slides
      for (const slide of briefing.slides || []) {
        await t.none(
          `INSERT INTO slides (id, briefing_id, title, content, mode, map_id,
                              model_id, photo_id, position, orientation)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb)`,
          [
            slide.id,
            briefing.id,
            slide.title || null,
            slide.content || null,
            slide.mode || '2d',
            slide.map_id || null,
            slide.model_id || null,
            slide.photo_id || null,
            JSON.stringify(slide.position || {}),
            JSON.stringify(slide.orientation || {}),
          ]
        );
        summary.slidesImported++;
      }
    }

    // 5. Return created atlas with summary
    const result = await t.one(
      `SELECT id, name, description, settings, map_order, version, current_version, created_at
       FROM atlas WHERE id = $1`,
      [atlasId]
    );

    return {
      ...result,
      summary,
    };
  });
}
