// Path: js/store/store.types.js

/**
 * @fileoverview JSDoc type definitions for the store module.
 */

/**
 * @typedef {Object} GeoJSONGeometry
 * @property {string} type - Geometry type (Point, LineString, Polygon, etc.)
 * @property {Array} coordinates - Coordinates array
 */

/**
 * @typedef {Object} FeatureProperties
 * @property {string} id - Unique feature identifier
 * @property {string} source - Feature type (point, line, polygon, etc.)
 * @property {string} nome - Feature name
 * @property {string} [descricao] - Feature description
 * @property {string} [layerId] - Layer ID the feature belongs to
 * @property {string} [groupId] - Group ID the feature belongs to
 * @property {boolean} [visivel=true] - Visibility state
 * @property {boolean} [bloqueado=false] - Lock state
 * @property {string} [color] - Fill/stroke color
 * @property {number} [opacity] - Opacity (0-1)
 * @property {number} [size] - Size/width
 */

/**
 * @typedef {Object} Feature
 * @property {string} type - Always "Feature"
 * @property {GeoJSONGeometry} geometry - GeoJSON geometry
 * @property {FeatureProperties} properties - Feature properties
 */

/**
 * @typedef {Object} Layer
 * @property {string} id - Unique layer identifier
 * @property {string} name - Layer display name
 * @property {boolean} visible - Visibility state
 * @property {boolean} locked - Lock state
 * @property {number} order - Sort order
 */

/**
 * @typedef {Object} Group
 * @property {string} id - Unique group identifier
 * @property {string} name - Group display name
 * @property {boolean} visible - Visibility state
 * @property {boolean} locked - Lock state
 * @property {Array<{type: string, id: string}>} features - Feature references in the group
 */

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
 * @typedef {Object} FrameStyle
 * @property {boolean} [visible] - Frame visibility
 * @property {string} [color] - Frame color
 * @property {number} [width] - Frame width
 */

/**
 * @typedef {Object} GridStyle
 * @property {boolean} [visible] - Grid visibility
 * @property {string} [type] - Grid type
 * @property {string} [color] - Grid color
 * @property {number} [spacing] - Grid spacing
 */

/**
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
 * @property {Feature[]} arrows - Arrow features
 * @property {Feature[]} boundarys - Boundary features
 * @property {Feature[]} occupied_fronts - Occupied front features
 * @property {Feature[]} military_symbols - Military symbol features
 * @property {Feature[]} coordination_measures - Coordination measure features
 * @property {Feature[]} los - Line of sight features
 * @property {Feature[]} visibility - Visibility features
 * @property {Feature[]} processed_los - Processed LOS features
 * @property {Feature[]} processed_visibility - Processed visibility features
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
 * @property {Object} [analysisLayers] - Analysis layers states
 * @property {FeaturesCollection} features - Features by type
 */

/**
 * @typedef {Object} StoreDependencies
 * @property {import('../events/event_bus.js').EventBus|null} eventBus - Event bus instance
 * @property {import('../tool_manager/group_manager.js').GroupManager|null} groupManager - Group manager instance
 * @property {import('../layers/layer.manager.js').LayerManager|null} layerManager - Layer manager instance
 */

/**
 * @typedef {Object} UndoRedoAction
 * @property {string} type - Action type (add, update, remove, addMultiple, removeWithProcessed, moveBetweenMaps)
 * @property {string} [featureType] - Feature type for single operations
 * @property {Feature} [feature] - Feature for add operations
 * @property {Feature} [oldFeature] - Old feature for update operations
 * @property {Feature} [newFeature] - New feature for update operations
 * @property {Object} [features] - Features map for batch operations
 */

/**
 * @typedef {Object} RemoveResult
 * @property {boolean} success - Whether removal was successful
 * @property {string} [reason] - Reason for failure
 * @property {boolean} [wasCurrentMap] - Whether removed map was current
 * @property {number} [remainingMapsCount] - Count of remaining maps
 * @property {string} [newCurrentMap] - New current map name
 */

/**
 * @typedef {Object} RemovedFeatureData
 * @property {Feature} mainFeature - The main removed feature
 * @property {Object|null} processedFeatures - Processed features data
 * @property {string} processedFeatures.type - Processed feature type
 * @property {Feature[]} processedFeatures.features - Processed features array
 */

// Export empty object to make this a module
export {};
