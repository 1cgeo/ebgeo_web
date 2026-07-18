// Path: js/measurement_tool/measurement.constants.js

/**
 * @module measurement_tool/measurement.constants
 * @description Constants for ephemeral measurement tools (distance, area, angle).
 */

export const MEASUREMENT_SOURCES = {
    PREVIEW_LINE: 'measurement-preview-line',
    PREVIEW_FILL: 'measurement-preview-fill',
    VERTICES: 'measurement-vertices',
    LABELS: 'measurement-labels',
    ANGLE_ARC: 'measurement-angle-arc',
    ANGLE_RAYS: 'measurement-angle-rays',
};

export const MEASUREMENT_LAYERS = {
    PREVIEW_LINE: 'measurement-preview-line-layer',
    PREVIEW_FILL: 'measurement-preview-fill-layer',
    VERTICES: 'measurement-vertices-layer',
    LABELS: 'measurement-labels-layer',
    ANGLE_ARC: 'measurement-angle-arc-layer',
    ANGLE_RAYS: 'measurement-angle-rays-layer',
};

export const MEASUREMENT_STYLE = {
    lineColor: '#ff6600',
    lineWidth: 2.5,
    lineDasharray: [6, 3],
    fillColor: '#ff6600',
    fillOpacity: 0.12,
    vertexRadius: 5,
    vertexColor: '#ffffff',
    vertexStrokeColor: '#ff6600',
    vertexStrokeWidth: 2,
    labelColor: '#ffffff',
    labelHaloColor: '#333333',
    labelHaloWidth: 1.5,
    labelSize: 13,
    angleArcColor: '#ff6600',
    angleArcWidth: 2,
};

export const DISTANCE_UNITS = [
    { id: 'meters', label: 'Metros (m)', factor: 1, suffix: 'm', decimals: 1 },
    { id: 'kilometers', label: 'Quilômetros (km)', factor: 0.001, suffix: 'km', decimals: 3 },
    { id: 'nautical_miles', label: 'Milhas Náuticas (NM)', factor: 1 / 1852, suffix: 'NM', decimals: 3 },
    { id: 'feet', label: 'Pés (ft)', factor: 1 / 0.3048, suffix: 'ft', decimals: 1 },
];

export const DEFAULT_DISTANCE_UNIT = 'meters';

export const AREA_UNITS = [
    { id: 'sqmeters', label: 'Metros² (m²)', factor: 1, suffix: 'm²', decimals: 1 },
    { id: 'hectares', label: 'Hectares (ha)', factor: 0.0001, suffix: 'ha', decimals: 3 },
    { id: 'sqkilometers', label: 'Quilômetros² (km²)', factor: 1e-6, suffix: 'km²', decimals: 4 },
];

export const DEFAULT_AREA_UNIT = 'sqmeters';

export const ANGLE_UNITS = [
    { id: 'degrees', label: 'Graus (°)', factor: 1, suffix: '°', decimals: 2 },
    { id: 'mils', label: 'Milésimos (mil)', factor: 6400 / 360, suffix: 'mil', decimals: 0 },
    { id: 'gradians', label: 'Grados (gon)', factor: 400 / 360, suffix: 'gon', decimals: 2 },
];
