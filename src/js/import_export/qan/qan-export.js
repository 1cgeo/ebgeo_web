// Path: js/import_export/qan/qan-export.js

/**
 * @fileoverview QAN (Quadro Auxiliar de Navegação) generation and export.
 * Generates a navigation table from line/polygon features with per-leg data.
 */

import {
    calculateSegmentDistance,
    formatDistanceAuto,
    getBearing,
} from '../../measurement_tool/measurement-geometry.js';
import { formatCoordinates } from '@utils/coordinate_converter.js';
import { escapeHtml } from '@utils/html-escape.js';

/**
 * Generate QAN data from a feature's coordinates and observations.
 * @param {Object} feature - Line or polygon feature
 * @returns {Object[]} Array of leg data objects
 */
export function generateQAN(feature) {
    const coords = feature.properties.baseCoordinates || [];
    const observations = feature.properties.observations || [];
    const isPolygon = feature.properties.source === 'polygon';

    // For polygons, close the ring
    const points = isPolygon ? [...coords, coords[0]] : coords;
    const legs = [];

    for (let i = 0; i < points.length - 1; i++) {
        const from = points[i];
        const to = points[i + 1];

        // Bearing: turf returns -180..180, convert to 0..360
        let azimuth = getBearing(from, to);
        if (azimuth < 0) azimuth += 360;

        const distance = calculateSegmentDistance(from, to);

        const fromText = formatCoordinates(from[1], from[0], 'latlong');
        const toText = formatCoordinates(to[1], to[0], 'latlong');

        legs.push({
            leg: i + 1,
            from: fromText,
            to: toText,
            azimuth: azimuth.toFixed(1),
            distance: formatDistanceAuto(distance),
            distanceMeters: distance,
            observation: observations[i] || '',
        });
    }

    return legs;
}

/**
 * Download QAN data as a styled HTML file.
 * @param {Object[]} qanData - Array of leg data from generateQAN
 * @param {string} featureName - Feature name for the title
 */
export function downloadQANAsHTML(qanData, featureName) {
    const safeName = escapeHtml(featureName || 'Sem nome');
    const timestamp = new Date().toLocaleString('pt-BR');

    const rows = qanData.map(leg => `
        <tr>
            <td>${leg.leg}</td>
            <td>${escapeHtml(leg.from)}</td>
            <td>${escapeHtml(leg.to)}</td>
            <td>${escapeHtml(leg.azimuth)}&deg;</td>
            <td>${escapeHtml(leg.distance)}</td>
            <td>${escapeHtml(leg.observation)}</td>
        </tr>`).join('');

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>QAN - ${safeName}</title>
<style>
body { font-family: Arial, sans-serif; margin: 20px; color: #333; }
h1 { font-size: 18px; margin-bottom: 4px; }
.subtitle { font-size: 12px; color: #666; margin-bottom: 16px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { background: #2d3748; color: #fff; padding: 8px 10px; text-align: left; font-weight: 600; }
td { padding: 6px 10px; border-bottom: 1px solid #e2e8f0; }
tr:nth-child(even) { background: #f7fafc; }
tr:hover { background: #edf2f7; }
.footer { margin-top: 16px; font-size: 11px; color: #999; }
@media print {
    body { margin: 0; }
    tr:hover { background: inherit; }
}
</style>
</head>
<body>
<h1>Quadro Auxiliar de Navega\u00e7\u00e3o - ${safeName}</h1>
<div class="subtitle">Gerado em ${escapeHtml(timestamp)} &mdash; EBGeo Web</div>
<table>
<thead>
<tr>
    <th>Perna</th>
    <th>Ponto Inicial</th>
    <th>Ponto Final</th>
    <th>Azimute</th>
    <th>Dist\u00e2ncia</th>
    <th>Observa\u00e7\u00e3o</th>
</tr>
</thead>
<tbody>
${rows}
</tbody>
</table>
<div class="footer">EBGeo Web &mdash; Ex\u00e9rcito Brasileiro</div>
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `QAN_${(featureName || 'feature').replace(/\s+/g, '_')}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
