// Path: js/3d_models_viewer_tool/services/cesium-measure.js

/**
 * @fileoverview Ephemeral measurement helpers for the Cesium 3D viewer: a
 * distance polyline, an area polygon and a vertical/horizontal triangle, all
 * drawn into a private `CustomDataSource` and never persisted. The 3D
 * measurements the product actually SAVES are a different thing entirely and
 * live in `tools/measurement_tool_3d.js`; nothing here reaches the store.
 *
 * PROVENANCE, WHICH IS THE REASON THIS HEADER IS LONG. This file is not ours in
 * origin. It arrived on 2024-07-18 in `5828f16fa` as
 * `public/vendors/cesium/cesium-measure.js`, 564 lines, carrying a single credit
 * line (`@author zhangti`) and nothing else: no licence, no URL, no year, no
 * version, comments in Chinese. It is almost certainly from the Chinese Cesium
 * plugin community and no upstream was ever recovered, so "just take the newer
 * release" is not an option that exists. Being unlicensed third-party code in a
 * repository that is PUBLIC by decision is a legal exposure, not a technical
 * one, and no amount of code review closes it; that half of the question is the
 * owner's and is recorded in `docs/seguranca/b10-fecho-proposta-2026-09-13.md`.
 *
 * IT WAS ALREADY A LOCAL FORK BEFORE IT MOVED HERE, and that is what settled
 * the decision (D9 of 2026-09-14, `docs/decisions/decisions-2026.md`): there is
 * no upstream to go back to, so the choice was between auditing a vendor copy
 * forever and adopting 433 effective lines of plain JavaScript that use only
 * public Cesium API. Five commits are ours:
 *
 *   - `d78e93502` (2024-07-26) keeps the two `ScreenSpaceEventHandler`s on the
 *     instance and adds `removeDrawLineMeasureGraphics` /
 *     `removeDrawAreaMeasureGraphics`, so an abandoned measurement stops eating
 *     clicks. This is the pair `map_3d.js` calls on tool deactivation.
 *   - `a961a5942` (2024-07-26) takes both labels from four decimals to one and
 *     switches the decimal separator to a comma, for pt-BR.
 *   - `4d21c6abb` (2024-07-30) replaces the planar shoelace sum of
 *     `getPositionsArea` by `turf.area` over the WGS84 ring, because the
 *     original number was not an area in square metres at all.
 *   - `95f9fe43b` (2024-08-30) fixes the divisor of that same label, which
 *     `4d21c6abb` had left at 1000 instead of 1000000.
 *   - `ac8fa8744` (2026-01-28) removes a `console.log` left behind by the two
 *     above.
 *
 * WHAT THE ADOPTION CHANGED, item by item, because "moved and translated" is
 * not the whole truth:
 *
 *   1. It is an ES module now, imported by `map_3d.js`, instead of a `<script>`
 *      injected at runtime that assigned `Cesium.Measure`. THIS IS NOT COSMETIC:
 *      a module is strict mode, and the line-measure label built its entity with
 *      an UNDECLARED `_labelEntity` (an implicit global since `5828f16fa`, line
 *      281; the area twin one screen below always had its `var`). Under a
 *      `<script>` that silently created a global and worked; under a module it
 *      throws `ReferenceError` on the first vertex. The declaration is the one
 *      edit without which this migration would have shipped a broken tool.
 *   2. The Chinese UI strings of `drawTrianglesMeasureGraphics` are now pt-BR,
 *      because house code does not ship Chinese labels. The NUMBER formatting in
 *      that method is untouched (a dot, two decimals, unlike the two adapted
 *      labels above), since inventing a format is not adoption.
 *   3. `var` became `let`/`const`, `==` became `===`, the comma operator was
 *      split, and unused parameters and bindings were dropped, all of it to get
 *      past the house ESLint. `public/**` is ignored by `frontend/eslint.config.js`,
 *      so until this move the file had never been linted at all.
 *   4. The two label formatters were lifted out as pure exported functions and
 *      pinned by `frontend/tests/unit/cesium-measure-rotulos.test.js`, because
 *      they are what two of the five fork commits are ABOUT and the rest of the
 *      file cannot be exercised without a WebGL context.
 *
 * WHAT WAS DELIBERATELY LEFT ALONE, since each of these is a fact worth having
 * written down rather than a silent half-fix:
 *
 *   - `getPositionsArea` still MUTATES the array it is given (it pushes the
 *     first point to close the ring) and still returns the planar shoelace sum
 *     that `4d21c6abb` stopped trusting. It has no caller.
 *   - `drawTrianglesMeasureGraphics` still reads `!position && !position.z`,
 *     which throws whenever the pick fails instead of returning. It has no
 *     caller either.
 *   - `drawAreaMeasureGraphics` reads the `turf` global, and since 2026-08-25
 *     Turf is loaded ON DEMAND (`utilities/turf-loader.js`); nothing on the 3D
 *     path warms it. Adding `await ensureTurf()` would mean making a synchronous
 *     mouse handler asynchronous, so the gap is declared instead of papered over.
 *
 * AND THE MEASUREMENT THAT PUTS ALL OF THE ABOVE IN PROPORTION: on 2026-09-14 a
 * sweep of `frontend/src` and `frontend/tests` found ZERO callers for every
 * drawing entry point of this file. What `map_3d.js` does is construct it, park
 * it on `window.measure`, and call the two `remove*` methods plus
 * `_drawLayer.entities.removeAll()` defensively on teardown. So this is a live
 * object with a dead API, and the poda question belongs to the owner alongside
 * the other vendor podas, not to this adoption.
 *
 * It sits under `services/` next to `cesium-compat.js` because the chunk rules
 * in `vite.config.js` route `3d_models_viewer_tool/services/` to the lazy
 * `cesium-integration` group, which is where `map_3d.js` itself lives. It needs
 * none of the compat patches (no `defaultValue`, no GLSL, no primitive
 * lifecycle); only the viewshed does.
 *
 * @module 3d_models_viewer_tool/services/cesium-measure
 */

/**
 * Formats a distance label the way the 3D measurement overlay shows it.
 *
 * Boundary is a strict `< 1000`: metres below it, kilometres from it up, one
 * decimal in both branches and a comma as the decimal separator (pt-BR). The
 * non-finite cases fall out of the comparison rather than being guarded, which
 * is the pre-existing behaviour: `NaN` reads `NaN km`, because `NaN < 1000` is
 * false.
 *
 * @param {number} meters - Distance in metres
 * @returns {string} e.g. '523,4 m', '1,2 km'
 */
export function formatDistanceLabel(meters) {
    const inMeters = meters < 1000;
    const value = inMeters ? meters : meters / 1000;
    return `${value.toFixed(1)} ${inMeters ? 'm' : 'km'}`.replace('.', ',');
}

/**
 * Formats an area label the way the 3D measurement overlay shows it.
 *
 * Boundary is `area / 1000000 < 1`, one decimal in both branches, comma as the
 * decimal separator. Same non-finite behaviour as the distance twin.
 *
 * @param {number} squareMeters - Area in square metres
 * @returns {string} e.g. '1234,5 m²', '2,0 km²'
 */
export function formatAreaLabel(squareMeters) {
    const inMeters = squareMeters / 1000000 < 1;
    const value = inMeters ? squareMeters : squareMeters / 1000000;
    return `${value.toFixed(1)} ${inMeters ? 'm²' : 'km²'}`.replace('.', ',');
}

/**
 * Ephemeral measurement drawing over a Cesium viewer.
 *
 * Every method reads the `Cesium` global at CALL time, never at module
 * evaluation. That was what let this module be imported while the library was
 * still a `<script>` injected at runtime; since 2026-09-14 (V9) the library
 * is a static import of `map_3d.js` (`@js/vendor/cesium.js`, which publishes
 * the global), so the ordering hazard is gone and the late read is now merely
 * harmless. Do not take it as a reason to keep reading the global in code
 * written from here on: the import is the shorter path.
 */
export class CesiumMeasure {
    /**
     * @param {object} viewer - A `Cesium.Viewer`; anything else leaves the
     *   instance inert, exactly as the original did.
     * @param {object} [options]
     * @param {string} [options.basePath] - Kept for call-site compatibility; no
     *   method reads it.
     */
    constructor(viewer, options = {}) {
        if (viewer && viewer instanceof Cesium.Viewer) {
            this._drawLayer = new Cesium.CustomDataSource('measureLayer');

            viewer.dataSources.add(this._drawLayer);

            this._basePath = options.basePath || '';

            this._viewer = viewer;
        }
    }

    /**
     * Converts a WGS84 position to Cartesian3.
     * @param {{lng?:number, lon?:number, lat:number, alt?:number}} position
     * @param {number} [alt] - Height override
     * @returns {object|undefined} Cartesian3, or `Cesium.Cartesian3.ZERO`
     */
    transformWGS84ToCartesian(position, alt) {
        if (this._viewer) {
            return position
                ? Cesium.Cartesian3.fromDegrees(
                    position.lng || position.lon,
                    position.lat,
                    // Parenthesised so `no-return-assign` accepts it. The
                    // assignment is load-bearing and arrived that way: this
                    // MUTATES the caller's object, which is how a height
                    // override of 0.1 metre survives back in getCatesian3FromPX.
                    (position.alt = alt || position.alt),
                    Cesium.Ellipsoid.WGS84
                )
                : Cesium.Cartesian3.ZERO;
        }
    }

    /**
     * Converts an array of WGS84 positions to Cartesian3.
     * @param {Array<object>} WSG84Arr - WGS84 positions
     * @param {number} [alt] - Height override applied to every point
     * @returns {Array<object>|undefined} Cartesian3 array
     */
    transformWGS84ArrayToCartesianArray(WSG84Arr, alt) {
        if (this._viewer && WSG84Arr) {
            const $this = this;
            return WSG84Arr
                ? WSG84Arr.map(function (item) { return $this.transformWGS84ToCartesian(item, alt); })
                : [];
        }
    }

    /**
     * Converts a Cartesian3 to WGS84.
     * @param {object} cartesian - Cartesian3 position
     * @returns {{lng:number, lat:number, alt:number}|undefined}
     */
    transformCartesianToWGS84(cartesian) {
        if (this._viewer && cartesian) {
            const ellipsoid = Cesium.Ellipsoid.WGS84;
            const cartographic = ellipsoid.cartesianToCartographic(cartesian);
            return {
                lng: Cesium.Math.toDegrees(cartographic.longitude),
                lat: Cesium.Math.toDegrees(cartographic.latitude),
                alt: cartographic.height
            };
        }
    }

    /**
     * Converts an array of Cartesian3 to WGS84.
     * @param {Array<object>} cartesianArr - Cartesian3 array
     * @returns {Array<object>|undefined} WGS84 array
     */
    transformCartesianArrayToWGS84Array(cartesianArr) {
        if (this._viewer) {
            const $this = this;
            return cartesianArr
                ? cartesianArr.map(function (item) { return $this.transformCartesianToWGS84(item); })
                : [];
        }
    }

    /**
     * Converts a WGS84 position to radians (Cartographic).
     * @param {{lng?:number, lon?:number, lat:number, alt?:number}} position
     * @returns {object} Cartographic
     */
    transformWGS84ToCartographic(position) {
        return position
            ? Cesium.Cartographic.fromDegrees(
                position.lng || position.lon,
                position.lat,
                position.alt
            )
            : Cesium.Cartographic.ZERO;
    }

    /**
     * Picks a world position from screen coordinates, trying 3D tiles and
     * models first, then terrain, then the ellipsoid.
     * @param {object} px - Screen position (Cartesian2)
     * @returns {object|false|undefined} Cartesian3, or false when nothing was hit
     */
    getCatesian3FromPX(px) {
        if (this._viewer && px) {
            const picks = this._viewer.scene.drillPick(px);
            let cartesian = null;
            let isOn3dtiles = false;
            let isOnTerrain = false;
            // drillPick
            for (const i in picks) {
                const pick = picks[i];

                if (pick &&
                    pick.primitive instanceof Cesium.Cesium3DTileFeature
                    || pick && pick.primitive instanceof Cesium.Cesium3DTileset
                    || pick && pick.primitive instanceof Cesium.Model) { // picked on a model
                    isOn3dtiles = true;
                }
                // 3dtileset
                if (isOn3dtiles) {
                    this._viewer.scene.pick(px); // pick
                    cartesian = this._viewer.scene.pickPosition(px);
                    if (cartesian) {
                        const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
                        if (cartographic.height < 0) cartographic.height = 0;
                        const lon = Cesium.Math.toDegrees(cartographic.longitude),
                            lat = Cesium.Math.toDegrees(cartographic.latitude),
                            height = cartographic.height;
                        cartesian = this.transformWGS84ToCartesian({ lng: lon, lat: lat, alt: height });
                    }
                }
            }
            // terrain
            const boolTerrain = this._viewer.terrainProvider instanceof Cesium.EllipsoidTerrainProvider;
            // Terrain
            if (!isOn3dtiles && !boolTerrain) {
                const ray = this._viewer.scene.camera.getPickRay(px);
                if (!ray) return null;
                cartesian = this._viewer.scene.globe.pick(ray, this._viewer.scene);
                isOnTerrain = true;
            }
            // globe
            if (!isOn3dtiles && !isOnTerrain && boolTerrain) {
                cartesian = this._viewer.scene.camera.pickEllipsoid(px, this._viewer.scene.globe.ellipsoid);
            }
            if (cartesian) {
                const position = this.transformCartesianToWGS84(cartesian);
                if (position.alt < 0) {
                    cartesian = this.transformWGS84ToCartesian(position, 0.1);
                }
                return cartesian;
            }
            return false;
        }
    }

    /**
     * Cumulative slant distance along a WGS84 polyline.
     * @param {Array<object>} positions - WGS84 positions
     * @returns {string} Distance in metres, three decimals, AS A STRING (the
     *   call sites coerce it with a unary plus)
     */
    getPositionDistance(positions) {
        let distance = 0;
        for (let i = 0; i < positions.length - 1; i++) {
            const point1cartographic = this.transformWGS84ToCartographic(positions[i]);
            const point2cartographic = this.transformWGS84ToCartographic(positions[i + 1]);
            const geodesic = new Cesium.EllipsoidGeodesic();
            geodesic.setEndPoints(point1cartographic, point2cartographic);
            let s = geodesic.surfaceDistance;
            s = Math.sqrt(
                Math.pow(s, 2) +
                Math.pow(point2cartographic.height - point1cartographic.height, 2)
            );
            distance = distance + s;
        }
        return distance.toFixed(3);
    }

    /**
     * Planar shoelace sum over the polygon's ECEF x/y, kept as it arrived.
     *
     * It has no caller: `4d21c6abb` replaced it with `turf.area` in the label
     * because the number it returns is not an area in square metres. It also
     * MUTATES `positions`, closing the ring in place.
     *
     * @param {Array<object>} positions - WGS84 positions
     * @returns {string|number} The shoelace sum, two decimals, as a string
     */
    getPositionsArea(positions) {
        let result = 0;
        if (positions) {
            let h = 0;
            const ellipsoid = Cesium.Ellipsoid.WGS84;
            positions.push(positions[0]);
            for (let i = 1; i < positions.length; i++) {
                const oel = ellipsoid.cartographicToCartesian(
                    this.transformWGS84ToCartographic(positions[i - 1])
                );
                const el = ellipsoid.cartographicToCartesian(
                    this.transformWGS84ToCartographic(positions[i])
                );
                h += oel.x * el.y - el.x * oel.y;
            }
            result = Math.abs(h).toFixed(2);
        }
        return result;
    }

    /**
     * Distance measurement: left click adds a vertex, mouse move rubber-bands
     * the last one, right click finishes and invokes the callback.
     * @param {object} [options]
     * @param {number} [options.width] - Polyline width
     * @param {object} [options.material] - Polyline material
     * @param {boolean} [options.clampToGround] - Clamp the polyline to terrain
     * @param {Function} [options.callback] - Receives (WGS84 positions, entity)
     */
    drawLineMeasureGraphics(options = {}) {
        if (this._viewer && options) {
            const positions = [];
            const _lineEntity = new Cesium.Entity();
            const $this = this;
            let _handlers = new Cesium.ScreenSpaceEventHandler(this._viewer.scene.canvas);

            this.lineMeasureHandlers = _handlers;
            // left
            _handlers.setInputAction(function (movement) {
                const cartesian = $this.getCatesian3FromPX(movement.position);
                if (cartesian && cartesian.x) {
                    if (positions.length === 0) {
                        positions.push(cartesian.clone());
                    }
                    // add the measurement label point
                    _addInfoPoint(cartesian);
                    positions.push(cartesian);
                }
            }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

            _handlers.setInputAction(function (movement) {
                const cartesian = $this.getCatesian3FromPX(movement.endPosition);
                if (positions.length >= 2) {
                    if (cartesian && cartesian.x) {
                        positions.pop();
                        positions.push(cartesian);
                    }
                }
            }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
            // right
            _handlers.setInputAction(function (movement) {
                _handlers.destroy();
                _handlers = null;

                const cartesian = $this.getCatesian3FromPX(movement.position);
                _addInfoPoint(cartesian);

                if (typeof options.callback === 'function') {
                    options.callback($this.transformCartesianArrayToWGS84Array(positions), lineObj);
                }
            }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

            _lineEntity.polyline = {
                width: options.width || 5
                , material: options.material || Cesium.Color.BLUE.withAlpha(0.8)
                , clampToGround: options.clampToGround || false
            };
            _lineEntity.polyline.positions = new Cesium.CallbackProperty(function () {
                return positions;
            }, false);

            // Declared HERE, after the three handlers that close over it: they
            // only run on a later mouse event, so the closure is safe, and
            // `const` is what the house lint asks for.
            const lineObj = this._drawLayer.entities.add(_lineEntity);

            // add the vertex point plus its running-total label
            function _addInfoPoint(position) {
                // DECLARED, and it was not in the original. See item 1 of the
                // file header: as a module this is strict mode, so the implicit
                // global would be a ReferenceError on the first vertex.
                const _labelEntity = new Cesium.Entity();
                _labelEntity.position = position;
                _labelEntity.point = {
                    pixelSize: 10,
                    outlineColor: Cesium.Color.BLUE,
                    outlineWidth: 5
                };
                const distance = +$this.getPositionDistance($this.transformCartesianArrayToWGS84Array(positions));
                _labelEntity.label = {
                    text: formatDistanceLabel(distance),
                    show: true,
                    showBackground: true,
                    font: '14px monospace',
                    horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
                    verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                    pixelOffset: new Cesium.Cartesian2(-20, -80) // left top
                };
                $this._drawLayer.entities.add(_labelEntity);
            }
        }
    }

    /**
     * Tears down the distance handler left behind by an abandoned measurement.
     */
    removeDrawLineMeasureGraphics() {
        const _handlers = this.lineMeasureHandlers;
        if (!_handlers) return;
        _handlers.destroy();
    }

    /**
     * Area measurement: left click adds a vertex, mouse move rubber-bands the
     * last one, right click closes the ring and invokes the callback.
     * @param {object} [options]
     * @param {boolean} [options.clampToGround] - Clamp the outline to terrain
     * @param {Function} [options.callback] - Receives (WGS84 positions, entity)
     */
    drawAreaMeasureGraphics(options = {}) {
        if (this._viewer && options) {
            const positions = [];
            const polygon = new Cesium.PolygonHierarchy();
            const _polygonEntity = new Cesium.Entity();
            const $this = this;
            let polyObj = null;
            const _handler = new Cesium.ScreenSpaceEventHandler(this._viewer.scene.canvas);
            this.areaMeasureHandlers = _handler;
            // left
            _handler.setInputAction(function (movement) {
                const cartesian = $this.getCatesian3FromPX(movement.position);
                if (cartesian && cartesian.x) {
                    if (positions.length === 0) {
                        polygon.positions.push(cartesian.clone());
                        positions.push(cartesian.clone());
                    }
                    positions.push(cartesian.clone());
                    polygon.positions.push(cartesian.clone());

                    if (!polyObj) create();
                }
            }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
            // mouse
            _handler.setInputAction(function (movement) {
                const cartesian = $this.getCatesian3FromPX(movement.endPosition);
                if (positions.length >= 2) {
                    if (cartesian && cartesian.x) {
                        positions.pop();
                        positions.push(cartesian);
                        polygon.positions.pop();
                        polygon.positions.push(cartesian);
                    }
                }
            }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

            // right
            _handler.setInputAction(function (movement) {
                // The pick is kept for its scene side effects and its result was
                // never read, which is how it arrived.
                $this.getCatesian3FromPX(movement.endPosition);

                _handler.destroy();

                positions.push(positions[0]);

                // add the label point
                _addInfoPoint(positions[0]);
                if (typeof options.callback === 'function') {
                    options.callback($this.transformCartesianArrayToWGS84Array(positions), polyObj);
                }
            }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

            function create() {
                _polygonEntity.polyline = {
                    width: 3
                    , material: Cesium.Color.BLUE.withAlpha(0.8)
                    , clampToGround: options.clampToGround || false
                };

                _polygonEntity.polyline.positions = new Cesium.CallbackProperty(function () {
                    return positions;
                }, false);

                _polygonEntity.polygon = {
                    hierarchy: new Cesium.CallbackProperty(function () {
                        return polygon;
                    }, false),

                    material: Cesium.Color.WHITE.withAlpha(0.1)
                    , clampToGround: options.clampToGround || false
                };

                polyObj = $this._drawLayer.entities.add(_polygonEntity);
            }

            function _addInfoPoint(position) {
                const _labelEntity = new Cesium.Entity();
                _labelEntity.position = position;
                _labelEntity.point = {
                    pixelSize: 10,
                    outlineColor: Cesium.Color.BLUE,
                    outlineWidth: 5
                };
                // `turf` is a lazily loaded global; see the file header.
                const ring = turf.polygon([
                    $this.transformCartesianArrayToWGS84Array(positions).map(i => [i.lng, i.lat])
                ]);

                const area = +turf.area(ring);
                _labelEntity.label = {
                    text: formatAreaLabel(area),
                    show: true,
                    showBackground: true,
                    font: '14px monospace',
                    horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
                    verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                    pixelOffset: new Cesium.Cartesian2(-20, -50) // left top
                };
                $this._drawLayer.entities.add(_labelEntity);
            }
        }
    }

    /**
     * Tears down the area handler left behind by an abandoned measurement.
     */
    removeDrawAreaMeasureGraphics() {
        const _handlers = this.areaMeasureHandlers;
        if (!_handlers) return;
        _handlers.destroy();
    }

    /**
     * Triangle measurement: slant line, height and horizontal distance between
     * two picked points.
     * @param {object} [options]
     * @param {object} [options.style] - Polyline style for the three lines
     * @param {Function} [options.callback] - Receives the three entities
     */
    drawTrianglesMeasureGraphics(options = {}) {
        options.style = options.style ||
        {
            width: 3
            , material: Cesium.Color.BLUE.withAlpha(0.5)
        };
        if (this._viewer && options) {
            const _trianglesEntity = new Cesium.Entity(),
                _tempLineEntity = new Cesium.Entity(),
                _tempLineEntity2 = new Cesium.Entity(),
                _positions = [], _tempPoints = [], _tempPoints2 = [], $this = this,
                _handler = new Cesium.ScreenSpaceEventHandler(this._viewer.scene.canvas);
            // height difference
            function _getHeading(startPosition, endPosition) {
                if (!startPosition && !endPosition) return 0;
                if (Cesium.Cartesian3.equals(startPosition, endPosition)) return 0;
                const cartographic = Cesium.Cartographic.fromCartesian(startPosition);
                const cartographic2 = Cesium.Cartographic.fromCartesian(endPosition);
                return (cartographic2.height - cartographic.height).toFixed(2);
            }
            // the point offset down to the first point's height
            function _computesHorizontalLine(positions) {
                const cartographic = Cesium.Cartographic.fromCartesian(positions[0]);
                const cartographic2 = Cesium.Cartographic.fromCartesian(positions[1]);
                return Cesium.Cartesian3.fromDegrees(
                    Cesium.Math.toDegrees(cartographic.longitude),
                    Cesium.Math.toDegrees(cartographic.latitude),
                    cartographic2.height
                );
            }
            // left
            _handler.setInputAction(function (movement) {
                const position = $this.getCatesian3FromPX(movement.position);
                // Kept as it arrived: this throws when the pick fails, instead
                // of returning. See the file header.
                if (!position && !position.z) return false;
                if (_positions.length === 0) {
                    _positions.push(position.clone());
                    _positions.push(position.clone());
                    _tempPoints.push(position.clone());
                    _tempPoints.push(position.clone());
                } else {
                    _handler.destroy();
                    if (typeof options.callback === 'function') {
                        options.callback({ e: _trianglesEntity, e2: _tempLineEntity, e3: _tempLineEntity2 });
                    }
                }
            }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
            // mouse
            _handler.setInputAction(function (movement) {
                const position = $this.getCatesian3FromPX(movement.endPosition);
                if (position && _positions.length > 0) {
                    // slant line
                    _positions.pop();
                    _positions.push(position.clone());
                    const horizontalPosition = _computesHorizontalLine(_positions);
                    // height
                    _tempPoints.pop();
                    _tempPoints.push(horizontalPosition.clone());
                    // horizontal line
                    _tempPoints2.pop();
                    _tempPoints2.pop();
                    _tempPoints2.push(position.clone());
                    _tempPoints2.push(horizontalPosition.clone());
                }
            }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

            // create entity

            // slant line
            _trianglesEntity.polyline = {
                positions: new Cesium.CallbackProperty(function () {
                    return _positions;
                }, false),
                ...options.style
            };
            _trianglesEntity.position = new Cesium.CallbackProperty(function () {
                return _positions[0];
            }, false);
            _trianglesEntity.point = {
                pixelSize: 5,
                outlineColor: Cesium.Color.BLUE,
                outlineWidth: 5
            };
            _trianglesEntity.label = {
                text: new Cesium.CallbackProperty(function () {
                    return 'Linha reta: ' + $this.getPositionDistance($this.transformCartesianArrayToWGS84Array(_positions)) + ' m';
                }, false),
                show: true,
                showBackground: true,
                font: '14px monospace',
                horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                pixelOffset: new Cesium.Cartesian2(50, -100) // left top
            };
            // height
            _tempLineEntity.polyline = {
                positions: new Cesium.CallbackProperty(function () {
                    return _tempPoints;
                }, false),
                ...options.style
            };
            _tempLineEntity.position = new Cesium.CallbackProperty(function () {
                return _tempPoints2[1];
            }, false);
            _tempLineEntity.point = {
                pixelSize: 5,
                outlineColor: Cesium.Color.BLUE,
                outlineWidth: 5
            };
            _tempLineEntity.label = {
                text: new Cesium.CallbackProperty(function () {
                    return 'Altura: ' + _getHeading(_tempPoints[0], _tempPoints[1]) + ' m';
                }, false),
                show: true,
                showBackground: true,
                font: '14px monospace',
                horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                pixelOffset: new Cesium.Cartesian2(-20, 100) // left top
            };
            // horizontal
            _tempLineEntity2.polyline = {
                positions: new Cesium.CallbackProperty(function () {
                    return _tempPoints2;
                }, false),
                ...options.style
            };
            _tempLineEntity2.position = new Cesium.CallbackProperty(function () {
                return _positions[1];
            }, false);
            _tempLineEntity2.point = {
                pixelSize: 5,
                outlineColor: Cesium.Color.BLUE,
                outlineWidth: 5
            };
            _tempLineEntity2.label = {
                text: new Cesium.CallbackProperty(function () {
                    return 'Distância horizontal: ' + $this.getPositionDistance($this.transformCartesianArrayToWGS84Array(_tempPoints2)) + ' m';
                }, false),
                show: true,
                showBackground: true,
                font: '14px monospace',
                horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                pixelOffset: new Cesium.Cartesian2(-150, -20) // left top
            };
            this._drawLayer.entities.add(_tempLineEntity2);
            this._drawLayer.entities.add(_tempLineEntity);
            this._drawLayer.entities.add(_trianglesEntity);
        }
    }
}
