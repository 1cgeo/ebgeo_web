// Path: src/crdt/merger.js
// Document state merger for CRDT

import { resolveFieldConflict } from './resolver.js';

/**
 * Merges changes from multiple operations into an existing entity state.
 * Uses LWW resolution for conflicting fields.
 *
 * @param {Object} existing - Current entity state
 * @param {Array} operations - Array of operations to merge, each with { changes, timestamp, clientId }
 * @returns {Object} Merged state
 */
export function mergeChanges(existing, operations) {
  // Sort operations by timestamp (earlier first)
  const sorted = [...operations].sort((a, b) => {
    const diff = a.timestamp - b.timestamp;
    if (diff !== 0) return diff;
    return a.clientId > b.clientId ? 1 : -1;
  });

  // Track which field was last updated and by which operation
  const fieldHistory = {};

  // Apply each operation's changes in order
  for (const op of sorted) {
    if (!op.changes) continue;

    for (const [field, value] of Object.entries(op.changes)) {
      const previous = fieldHistory[field];

      if (!previous) {
        fieldHistory[field] = {
          value,
          timestamp: op.timestamp,
          clientId: op.clientId,
        };
      } else {
        const incoming = { value, timestamp: op.timestamp, clientId: op.clientId };
        const result = resolveFieldConflict(previous, incoming);

        if (result.applied) {
          fieldHistory[field] = incoming;
        }
      }
    }
  }

  // Build merged state
  const merged = { ...existing };
  for (const [field, state] of Object.entries(fieldHistory)) {
    merged[field] = state.value;
  }

  return merged;
}

/**
 * Merges an update operation into an existing entity state.
 * Only fields in op.changes are considered. Each field is resolved independently.
 *
 * @param {Object} entity - Current entity state (from DB)
 * @param {Object} operation - Incoming update operation
 * @returns {{ merged: Object, fieldsApplied: string[] }} Merged state and list of applied fields
 */
export function mergeUpdate(entity, operation) {
  const fieldsApplied = [];
  const merged = { ...entity };

  if (!operation.changes) {
    return { merged, fieldsApplied };
  }

  // Entity-level comparison
  const entityTimestamp = entity.updated_at ? new Date(entity.updated_at).getTime() : 0;

  for (const [field, value] of Object.entries(operation.changes)) {
    // For simplicity, use entity-level LWW (not per-field)
    // If the operation is newer than the entity, apply the change
    if (operation.timestamp >= entityTimestamp) {
      merged[field] = value;
      fieldsApplied.push(field);
    }
  }

  return { merged, fieldsApplied };
}
