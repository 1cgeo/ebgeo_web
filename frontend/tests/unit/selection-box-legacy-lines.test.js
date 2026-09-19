// Path: tests/unit/selection-box-legacy-lines.test.js

import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import * as turf from '@turf/turf';

let CoordinationLine;
let LOS;
let CoordinationGeometry;
let LOSGeometry;
const originalTurf = globalThis.turf;
beforeAll(async () => {
    globalThis.turf = turf;
    ({ default: CoordinationLine } = await import('@js/military_tools/coordination_line_tool/add_coordination_line_control.js'));
    ({ default: LOS } = await import('@js/analysis_tools/los_tool/add_los_control.js'));
    ({ default: CoordinationGeometry } = await import('@js/military_tools/coordination_line_tool/add_coordination_line_geometry.js'));
    ({ default: LOSGeometry } = await import('@js/analysis_tools/los_tool/add_los_geometry.js'));
}, 120000);
afterAll(() => { globalThis.turf = originalTurf; });

describe('selection boxes of older line documents', () => {
    it.each(['coordination_line', 'los'])('%s fallback returns a polygon instead of bbox numbers', (type) => {
        // Missing authored spine on a coordination line; unexpected imported LOS
        // geometry reaches the other existing fallback through its real extractor.
        const feature = type === 'los' ? turf.point([-43.2, -22.9]) : turf.lineString([[-43.2, -22.9], [-43.1, -22.8]]);
        const expand = ([west, south, east, north]) => [west - 0.001, south - 0.001, east + 0.001, north + 0.001];
        const control = {
            geometry: type === 'los' ? new LOSGeometry() : new CoordinationGeometry(),
            getSelectionBoxPadding: () => 5,
            expandBboxWithPadding: expand,
        };
        const Klass = type === 'los' ? LOS : CoordinationLine;
        const box = Klass.prototype.createSelectionBox.call(control, feature);
        expect(box?.geometry?.type).toBe('Polygon');
        expect(turf.bbox(box)).toEqual(expand(turf.bbox(feature)));
    });
});
