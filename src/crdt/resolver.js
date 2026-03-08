// Path: src/crdt/resolver.js
// Last-Writer-Wins (LWW) conflict resolution

/**
 * Compares two operations and returns 1 if a wins, -1 if b wins, 0 if tie.
 * Uses timestamp as primary comparator, clientId as tiebreaker.
 */
function compareOperations(a, b) {
  if (a.timestamp !== b.timestamp) {
    return a.timestamp > b.timestamp ? 1 : -1;
  }
  // Tiebreaker: lexicographic comparison of clientId
  if (a.clientId !== b.clientId) {
    return a.clientId > b.clientId ? 1 : -1;
  }
  return 0;
}

/**
 * Resolves a field-level conflict between current state and incoming operation.
 *
 * @param {Object} currentState - { value, timestamp, clientId }
 * @param {Object} incoming - { value, timestamp, clientId }
 * @returns {{ value: any, applied: boolean, winner: 'current' | 'incoming' }}
 */
export function resolveFieldConflict(currentState, incoming) {
  const comparison = compareOperations(incoming, currentState);

  if (comparison > 0) {
    return {
      value: incoming.value,
      applied: true,
      winner: 'incoming',
    };
  }

  return {
    value: currentState.value,
    applied: false,
    winner: 'current',
  };
}

/**
 * Resolves entity-level LWW between two states.
 * Delete always wins over update.
 *
 * @param {Object} local - Local state or operation
 * @param {Object} remote - Remote state or operation
 * @returns {Object} Winner state
 */
export function resolveLWW(local, remote) {
  // Delete always wins
  if (remote.type === 'delete' || remote.deleted_at) {
    return remote;
  }
  if (local.type === 'delete' || local.deleted_at) {
    return local;
  }

  // Compare timestamps
  const localTs = local.timestamp || local.updated_at || 0;
  const remoteTs = remote.timestamp || remote.updated_at || 0;

  if (remoteTs > localTs) {
    return remote;
  }
  if (localTs > remoteTs) {
    return local;
  }

  // Tiebreaker: clientId
  const localClient = local.clientId || '';
  const remoteClient = remote.clientId || '';

  if (remoteClient > localClient) {
    return remote;
  }

  return local;
}
