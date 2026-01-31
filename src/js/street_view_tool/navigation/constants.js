// Path: js/street_view_tool/navigation/constants.js

/**
 * @fileoverview Configuration constants for the Street View 360 navigation system.
 */

export const NAV_CONSTANTS = Object.freeze({
    // ===== CAMERA DEFAULTS =====
    /** Default camera height in meters */
    DEFAULT_CAMERA_HEIGHT: 2.5,

    // ===== MARKER APPEARANCE =====
    /** Base size of navigation markers in pixels (Google Street View style - large) */
    MARKER_BASE_SIZE: 80,
    /** Minimum marker size in pixels */
    MARKER_MIN_SIZE: 40,
    /** Maximum marker size in pixels */
    MARKER_MAX_SIZE: 150,
    /** Reference distance for marker scaling in meters */
    REFERENCE_DISTANCE: 12,
    /** Scale factor when hovering over marker */
    HOVER_SCALE: 1.15,

    // ===== MARKER COLORS =====
    /** Fill color for navigation markers */
    MARKER_COLOR: 'rgba(255, 255, 255, 0.85)',
    /** Border color for navigation markers */
    MARKER_BORDER_COLOR: 'rgba(0, 0, 0, 0.4)',
    /** Border width for navigation markers */
    MARKER_BORDER_WIDTH: 3,

    // ===== CURSOR =====
    /** Color for the ground cursor indicator */
    CURSOR_COLOR: 'rgba(255, 255, 255, 0.8)',
    /** Base size of the ground cursor in pixels (large like Google Street View) */
    CURSOR_SIZE: 120,
    /** Reference distance for cursor scaling (meters) */
    CURSOR_REFERENCE_DISTANCE: 10,
    /** Minimum cursor size in pixels */
    CURSOR_MIN_SIZE: 70,
    /** Maximum cursor size in pixels */
    CURSOR_MAX_SIZE: 180,

    // ===== HIT TESTING =====
    /** Multiplier for clickable area (larger = easier to click) */
    HIT_RADIUS_MULTIPLIER: 1.5,

    // ===== FOV SETTINGS =====
    /** Margin from FOV edge for showing markers (degrees) */
    FOV_MARGIN: 5,
    /** FOV threshold below which to hide arrows */
    HIDE_ARROWS_FOV: 35,
    /** FOV threshold for scaling arrows */
    SCALE_ARROWS_FOV: 45,

    // ===== POI MARKER STYLES =====
    /** Default color for POI markers */
    POI_DEFAULT_COLOR: '#3f4fb5',
    /** Border color for POI markers */
    POI_BORDER_COLOR: '#ffffff',
    /** Border width for POI markers */
    POI_BORDER_WIDTH: 3,

    // ===== SELECTED MARKER =====
    /** Glow color for selected markers */
    SELECTED_GLOW_COLOR: 'rgba(63, 79, 181, 0.5)',
    /** Glow size for selected markers */
    SELECTED_GLOW_SIZE: 10,

    // ===== ANIMATION =====
    /** Duration for hover animation in ms */
    HOVER_ANIMATION_DURATION: 150,
    /** Duration for selection animation in ms */
    SELECTION_ANIMATION_DURATION: 200,

    // ===== LABEL SETTINGS =====
    /** Default label font size */
    LABEL_FONT_SIZE: 14,
    /** Label padding */
    LABEL_PADDING: 6,
    /** Label border radius */
    LABEL_BORDER_RADIUS: 4,
    /** Label offset from marker center */
    LABEL_OFFSET_Y: -30
});

/**
 * Default style for 360 markers (POIs)
 */
export const DEFAULT_MARKER_360_STYLE = Object.freeze({
    visible: true,
    showMarker: true,
    markerColor: '#3f4fb5',
    markerSize: 12,
    markerOpacity: 1,
    showLabel: true,
    labelText: '',
    labelColor: '#ffffff',
    labelBackgroundColor: '#3f4fb5',
    labelBackgroundOpacity: 0.9,
    labelSize: 14
});
