// Path: js/map/maplibre.js
// FIXTURE, the allowed half: this is the single entry point, matched by path,
// and it is the ONE file that may name the global, because it is the file that
// publishes it. Nothing here may be reported.
//
// It sits under a real `src/js/map/` tree because the rule's exception is about
// the file's location on disk, exactly like `require-path-comment`: a violation
// (or an allowance) of a file-level rule cannot be expressed as a snippet
// inside the shared flat fixture.

import * as maplibregl from 'maplibre-gl';

maplibregl.setWorkerUrl('/worker.mjs');

window.maplibregl = maplibregl;

export { maplibregl };
