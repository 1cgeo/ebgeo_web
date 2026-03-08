// Path: src/crdt/operations.js
// Operation creation and validation for CRDT

import crypto from 'crypto';

const VALID_OP_TYPES = ['create', 'update', 'delete'];

const VALID_TARGETS = [
  'feature', 'group', 'layer', 'group_feature',
  'map', 'briefing', 'slide',
  'cesium3d', 'streetview360',
  // Frontend aliases for 3D/360
  'marker3d', 'measurement3d', 'viewshed3d', 'cameraPosition3d',
  'orientation360', 'marker360',
  // Map sub-entities
  'mapPosition', 'baseLayer', 'mapNotes', 'gridStyle', 'catalogLayer',
];

/**
 * Creates a new operation.
 */
export function createOperation(type, target, targetId, data = {}) {
  return {
    id: crypto.randomUUID(),
    type,
    target,
    targetId,
    mapId: data.mapId || null,
    changes: data.changes || null,
    data: data.data || null,
    timestamp: Date.now(),
    clientId: data.clientId || crypto.randomUUID(),
    version: data.version || 0,
  };
}

/**
 * Validates an operation structure.
 */
export function validateOperation(op) {
  const errors = [];

  if (!op.id) {
    errors.push('Missing operation id');
  }

  if (!VALID_OP_TYPES.includes(op.type)) {
    errors.push(`Invalid operation type: ${op.type}`);
  }

  if (!VALID_TARGETS.includes(op.target)) {
    errors.push(`Invalid operation target: ${op.target}`);
  }

  if (!op.targetId) {
    errors.push('Missing operation targetId');
  }

  if (!op.timestamp || typeof op.timestamp !== 'number') {
    errors.push('Invalid or missing timestamp');
  }

  if (!op.clientId) {
    errors.push('Missing clientId');
  }

  // Create operations must have data
  if (op.type === 'create' && !op.data) {
    errors.push('Create operations must have data');
  }

  // Update operations must have changes
  if (op.type === 'update' && !op.changes) {
    errors.push('Update operations must have changes');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export { VALID_OP_TYPES, VALID_TARGETS };
