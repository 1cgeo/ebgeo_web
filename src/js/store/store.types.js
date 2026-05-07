// Path: js/store/store.types.js

/**
 * @fileoverview JSDoc type definitions for the store module.
 *
 * Provides shared type definitions consumed via `import('./store.types.js')`
 * across store operations (feature, layer, map, group, settings).
 */

// ============================================================================
// GeoJSON Primitives
// ============================================================================

/**
 * @typedef {Object} GeoJSONGeometry
 * @property {string} type - Geometry type (Point, LineString, Polygon, etc.)
 * @property {Array} coordinates - Coordinates array
 */

/**
 * @typedef {Object} FeatureProperties
 * @property {string} id - Unique feature identifier (UUID)
 * @property {string} source - Feature type (point, line, polygon, etc.)
 * @property {string} nome - Feature name (pt-BR)
 * @property {string} [descricao] - Feature description (pt-BR)
 * @property {string} [layerId] - Layer ID the feature belongs to
 * @property {string} [groupId] - Group ID the feature belongs to
 * @property {boolean} [visivel=true] - Visibility state
 * @property {boolean} [bloqueado=false] - Lock state
 * @property {string} [color] - Fill/stroke color
 * @property {number} [opacity] - Opacity (0-1)
 * @property {number} [size] - Size/width
 * @property {number} [createdAt] - Creation timestamp (epoch ms)
 * @property {number} [updatedAt] - Last update timestamp (epoch ms)
 * @property {number} [version] - Optimistic concurrency version
 */

/**
 * @typedef {Object} Feature
 * @property {string} type - Always "Feature"
 * @property {GeoJSONGeometry} geometry - GeoJSON geometry
 * @property {FeatureProperties} properties - Feature properties
 */

// ============================================================================
// Collections & Containers
// ============================================================================

/**
 * @typedef {Object} Layer
 * @property {string} id - Unique layer identifier
 * @property {string} name - Layer display name
 * @property {boolean} visible - Visibility state
 * @property {boolean} locked - Lock state
 * @property {number} [opacity=1] - Layer opacity multiplier (0-1)
 * @property {number} order - Sort order
 */

/**
 * @typedef {Object} Group
 * @property {string} id - Unique group identifier
 * @property {string} name - Group display name
 * @property {boolean} visible - Visibility state
 * @property {boolean} locked - Lock state
 * @property {Array<{type: string, id: string}>} features - Feature references
 */

/**
 * Feature arrays keyed by storage type.
 * Keys match FEATURE_TYPE_MAPPINGS values in store.constants.js.
 *
 * @typedef {Object} FeaturesCollection
 * @property {Feature[]} points - Point features
 * @property {Feature[]} lines - Line features
 * @property {Feature[]} polygons - Polygon features
 * @property {Feature[]} texts - Text features
 * @property {Feature[]} images - Image features
 * @property {Feature[]} circles - Circle features
 * @property {Feature[]} rectangles - Rectangle features
 * @property {Feature[]} ellipses - Ellipse features
 * @property {Feature[]} brushes - Brush features
 * @property {Feature[]} setores - Sector features
 * @property {Feature[]} arrows - Arrow features
 * @property {Feature[]} boundarys - Boundary features
 * @property {Feature[]} occupied_fronts - Occupied front features
 * @property {Feature[]} military_symbols - Military symbol features
 * @property {Feature[]} coordination_measures - Coordination measure features
 * @property {Feature[]} los - Line of sight features
 * @property {Feature[]} visibility - Visibility features
 * @property {Feature[]} processed_los - Processed LOS results
 * @property {Feature[]} processed_visibility - Processed visibility results
 */

// ============================================================================
// Map State
// ============================================================================

/**
 * @typedef {Object} MapPosition
 * @property {number|null} center_lat - Center latitude
 * @property {number|null} center_long - Center longitude
 * @property {number|null} zoom - Zoom level
 * @property {number|null} bearing - Bearing in degrees
 * @property {number|null} pitch - Pitch in degrees
 */

/**
 * @typedef {Object} MapNotes
 * @property {string} [title] - Notes title
 * @property {string} [description] - Notes description
 */

/**
 * @typedef {Object} GridStyle
 * @property {boolean} [visible] - Grid visibility
 * @property {string} [type] - Grid type
 * @property {string} [color] - Grid color
 * @property {number} [spacing] - Grid spacing
 */

/**
 * @typedef {Object} MapData
 * @property {string} schemaVersion - Data schema version
 * @property {string} baseLayer - Current base layer ID
 * @property {number|null} center_lat - Center latitude
 * @property {number|null} center_long - Center longitude
 * @property {number|null} zoom - Zoom level
 * @property {number|null} bearing - Bearing in degrees
 * @property {number|null} pitch - Pitch in degrees
 * @property {boolean} [hillshadeEnabled] - Hillshade enabled state
 * @property {Object} [analysisLayers] - Analysis layer toggle states
 * @property {FeaturesCollection} features - Features keyed by storage type
 */

// ============================================================================
// Store Infrastructure
// ============================================================================

/**
 * @typedef {Object} StoreDependencies
 * @property {import('../events/event_bus.js').EventBus|null} eventBus
 * @property {import('../tool_manager/group_manager.js').GroupManager|null} groupManager
 * @property {import('../layers/layer.manager.js').LayerManager|null} layerManager
 */

/**
 * @typedef {Object} UndoRedoAction
 * @property {'add'|'update'|'remove'|'addMultiple'|'removeWithProcessed'|'moveBetweenMaps'} type - Action type
 * @property {string} [featureType] - Feature type for single-feature operations
 * @property {Feature} [feature] - Feature snapshot for add/remove operations
 * @property {Feature} [oldFeature] - Previous state for update operations
 * @property {Feature} [newFeature] - New state for update operations
 * @property {Object} [features] - Features map for batch operations
 */

/**
 * @typedef {Object} RemoveResult
 * @property {boolean} success - Whether removal succeeded
 * @property {string} [reason] - Failure reason
 * @property {boolean} [wasCurrentMap] - Whether removed map was the active map
 * @property {number} [remainingMapsCount] - Count of remaining maps
 * @property {string} [newCurrentMap] - New active map name after removal
 */

/**
 * @typedef {Object} RemovedFeatureData
 * @property {Feature} mainFeature - The removed feature
 * @property {Object|null} processedFeatures - Associated processed features
 * @property {string} processedFeatures.type - Processed feature type
 * @property {Feature[]} processedFeatures.features - Processed features array
 */

export {};
