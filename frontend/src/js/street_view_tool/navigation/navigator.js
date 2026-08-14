// Path: js/street_view_tool/navigation/navigator.js

/**
 * @fileoverview Main orchestrator for Street View 360 navigation system.
 * Coordinates the projector, renderer, hit tester, and minimap sync.
 * Draws navigation targets as a relative band on the corrected horizon.
 */

import { NAV_CONSTANTS } from './constants.js';
import { StreetViewProjector } from './projector.js';
import { StreetViewRenderer } from './renderer.js';
import { StreetViewHitTester } from './hit-tester.js';
import { StreetViewMinimapSync } from './minimap-sync.js';
import { getEventBus } from '@store/services.js';
import { EventTypes } from '@events/event_types.js';
import { showToast } from '@utils';

// Threshold in pixels to distinguish drag from click
const DRAG_THRESHOLD = 5;

/**
 * Main navigation system for the 360 viewer.
 * Manages navigation targets, POIs, and user interactions.
 */
export class StreetViewNavigator {
    /**
     * @param {HTMLElement} container - Container element for the 360 viewer
     * @param {maplibregl.Map} minimap - MapLibre minimap instance
     * @param {Function} getCameraFn - Function to get the current Three.js camera
     * @param {Function} [requestRenderFn] - Requests a redraw from the viewer's render loop
     */
    constructor(container, minimap, getCameraFn, requestRenderFn = null) {
        this.container = container;
        this.minimap = minimap;
        this.getCamera = getCameraFn;
        this.requestRender = requestRenderFn || (() => {});
        /** @type {Function|null} Notified when the hovered marker changes */
        this.onHoverChange = null;
        this._lastHoveredId = null;

        // Create canvas overlay
        this.canvas = null;
        this.projector = null;
        this.renderer = null;
        this.hitTester = null;
        this.minimapSync = null;

        // State
        this.targets = [];
        this.pois = [];
        this.cameraConfig = null;
        this.mousePosition = { x: 0, y: 0 };
        this.selectedPOIId = null;
        this.markerToolActive = false;
        this.nearestTargetId = null;

        // Drag detection state
        this.pointerDownPos = null;
        this.isDragging = false;

        // Bound event handlers
        this.handleMouseMove = this.handleMouseMove.bind(this);
        this.handleMouseLeave = this.handleMouseLeave.bind(this);
        this.handlePointerDown = this.handlePointerDown.bind(this);
        this.handlePointerUp = this.handlePointerUp.bind(this);
        this.handleResize = this.handleResize.bind(this);

        this.initialized = false;
    }

    /**
     * Initializes the navigation system
     */
    async initialize() {
        if (this.initialized) return;

        // Create canvas overlay
        this.canvas = document.createElement('canvas');
        this.canvas.id = 'streetview-nav-canvas';
        this.canvas.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 10;
        `;

        // Set canvas size based on container (accounts for sidebar offset)
        this.canvas.width = this.container.clientWidth;
        this.canvas.height = this.container.clientHeight;

        // Add to container
        this.container.appendChild(this.canvas);

        // Create subcomponents
        this.projector = new StreetViewProjector(this.canvas.width, this.canvas.height);
        this.renderer = new StreetViewRenderer(this.canvas);
        this.hitTester = new StreetViewHitTester();

        // Initialize minimap sync
        if (this.minimap) {
            this.minimapSync = new StreetViewMinimapSync(this.minimap);
            await this.minimapSync.initialize();
        }

        // Add event listeners
        this.container.addEventListener('mousemove', this.handleMouseMove);
        // Sair do 360 apaga o realce dos dois lados. Sem isto o ultimo alvo
        // apontado ficava aceso no minimapa com o mouse ja longe dali.
        this.container.addEventListener('mouseleave', this.handleMouseLeave);
        this.container.addEventListener('pointerdown', this.handlePointerDown);
        this.container.addEventListener('pointerup', this.handlePointerUp);
        window.addEventListener('resize', this.handleResize);

        // Enable pointer events on canvas for hit testing
        this.canvas.style.pointerEvents = 'auto';

        this.initialized = true;
    }

    /**
     * Sets the current photo's camera configuration and targets
     * @param {Object} cameraConfig - Camera metadata
     * @param {Array} targets - Navigation targets
     */
    setPhoto(cameraConfig, targets) {
        this.cameraConfig = cameraConfig;
        this.targets = targets || [];

        // Update projector with camera config
        this.projector.setCameraConfig(cameraConfig);

        // Find the nearest target
        this.updateNearestTarget();

        // Update minimap
        if (this.minimapSync) {
            this.minimapSync.setCameraPosition(
                cameraConfig.lon,
                cameraConfig.lat,
                cameraConfig.heading
            );
        }

        this.requestRender();
    }

    /**
     * Updates which target is the nearest (for highlighting)
     */
    updateNearestTarget() {
        if (!this.targets || this.targets.length === 0) {
            this.nearestTargetId = null;
            return;
        }

        let nearestId = null;
        let nearestDist = Infinity;

        for (const target of this.targets) {
            // Calculate distance in meters using lon/lat
            const { x, z } = this.projector.lonLatToMeters(
                target.lon,
                target.lat,
                this.cameraConfig.lon,
                this.cameraConfig.lat
            );
            const dist = Math.sqrt(x * x + z * z);

            if (dist < nearestDist) {
                nearestDist = dist;
                nearestId = target.id;
            }
        }

        this.nearestTargetId = nearestId;
    }

    /**
     * Sets the POIs (360 markers) to display
     * @param {Array} pois - Array of POI objects
     */
    setPOIs(pois) {
        this.pois = pois || [];
        this.requestRender();
    }

    /**
     * Renders a single frame of navigation elements
     * @param {number} lonDeg - Camera longitude (horizontal rotation) in degrees
     * @param {number} latDeg - Camera latitude (vertical rotation) in degrees
     * @param {number} fov - Camera FOV in degrees
     */
    render(lonDeg, latDeg, fov) {
        if (!this.initialized) return;

        // lon=0 means looking at imageHeading direction
        // Drag right → lon decreases → looking left (counter-clockwise)
        // Drag left → lon increases → looking right (clockwise)
        // worldHeading = imageHeading + lon
        const imageHeading = this.cameraConfig?.heading ?? 0;
        const worldHeadingDeg = imageHeading + lonDeg;

        // Convert to radians for projection
        // In our projection system:
        // - Targets at north (heading=0) should be at -Z in world space
        // - yaw=0 means camera looking at -Z (north)
        // - positive yaw rotates camera counter-clockwise (looking more west)
        // Since worldHeading is measured clockwise from north (0=N, 90=E),
        // we need yaw = -worldHeading to convert properly
        const yaw = -(worldHeadingDeg * Math.PI) / 180;
        const pitch = (latDeg * Math.PI) / 180;

        // Store for the marker tool's screen->spherical click mapping
        this.currentYaw = yaw;
        this.currentPitch = pitch;
        this.currentFov = fov;

        const markers = [];

        // The layout is a property of the whole set: every icon's size and height
        // depends on the ones in front of it, so it is computed once per frame,
        // before anything is projected.
        this.directionLayout = this.layoutDirections(this.targets, fov);

        for (const target of this.targets) {
            const projected = this.projectTargetOnHorizon(target, yaw, pitch, fov);
            if (projected) {
                projected.type = 'navigation';
                projected.data = target;
                markers.push(projected);
            }
        }

        // No decluttering pass: the stack gap already guarantees that no icon
        // buries another, which is what keeps every target clickable.
        this.assignHitRadii(markers);

        // Project POIs (always visible)
        for (const poi of this.pois) {
            const projected = this.projectPOI(poi, yaw, pitch, fov);
            if (projected) {
                projected.type = 'poi';
                projected.data = poi;
                markers.push(projected);
            }
        }

        // Update hit tester
        this.hitTester.setMarkers(markers);

        // Update renderer
        this.renderer.setMarkers(markers);
        this.renderer.setSelectedMarker(this.selectedPOIId);
        this.renderer.setNearestMarker(this.nearestTargetId);

        // Render
        this.renderer.render();
    }

    /**
     * Resolves the world bearing and ground distance of a target.
     *
     * Lat/lon is the only source. The per-target overrides that used to be
     * consulted here are gone on purpose: they were calibration of the ICON, and
     * a wrong position is now corrected by moving the PHOTO, not by nudging the
     * marker that points at it. One of them, an override_distance of 17.3 m on a
     * target actually 10.2 m away, silently reordered the queue.
     *
     * @param {Object} target - Target object
     * @returns {{bearing: number, distance: number}} Bearing in degrees, distance in meters
     */
    resolveTargetVector(target) {
        if (target.bearing != null && target.distance != null) {
            return { bearing: target.bearing, distance: target.distance };
        }

        // Fallback for older metadata that carries no precomputed vector
        const { x, z } = this.projector.lonLatToMeters(
            target.lon,
            target.lat,
            this.cameraConfig.lon,
            this.cameraConfig.lat
        );
        return {
            bearing: target.bearing ?? ((((Math.atan2(x, -z) * 180) / Math.PI) + 360) % 360),
            distance: target.distance ?? Math.sqrt(x * x + z * z)
        };
    }

    /**
     * Lays out every target as a queue along its direction.
     *
     * This is where "relative, not faithful" lives. Distance never reaches the
     * screen as a length: it is used twice, and only as an ORDER. Once to rank
     * the targets within a direction, and once, weighted, to place each target in
     * the distance order of the whole photo, so that a far target still reads as
     * far even when nothing shares its direction.
     *
     * A target only joins a queue when it would actually COVER the one in front:
     * two icons of angular radius r cover each other below 2r of bearing
     * separation, so that, and not a guessed bucket, is what defines "the same
     * direction". A target off to the side keeps its own place near the bottom
     * of the band instead of being pushed up for nothing.
     *
     * Height and size then decay by the same ratio (see constants.js), which
     * makes the queue fit the band for ANY number of icons, with every centre
     * clear of the disc in front. Nothing caps the count: a queue ends only when
     * the next icon would be too small to read.
     *
     * @param {Array} targets - Navigation targets for the current photo
     * @param {number} fov - Camera vertical FOV in degrees
     * @returns {Map<string, {rank: number, radius: number, elevationDeg: number}>} Layout per target id
     */
    layoutDirections(targets, fov) {
        const vectors = targets
            .map(t => ({
                id: t.id,
                // O degrau entra AQUI, e nao so na hora de desenhar, porque ele
                // decide de que lado do horizonte o icone fica.
                floorDelta: this.deltaDeAndar(t),
                ...this.resolveTargetVector(t),
            }))
            .sort((a, b) => a.distance - b.distance);

        // Place in the distance order of the whole photo, 0 = nearest of all.
        // A single target is the nearest of all, so it gets no nudge at all.
        const span = Math.max(1, vectors.length - 1);
        vectors.forEach((v, index) => { v.distanceRatio = index / span; });

        const directions = [];
        const layout = new Map();

        for (const v of vectors) {
            const candidateRank = this.projector.effectiveRank(0, v.distanceRatio);

            // A target belongs to a queue when the icon it WOULD get overlaps the
            // icon of the one already there, so the threshold shrinks as the
            // queue grows: what is side by side stays side by side.
            const group = directions.find(d => {
                const diff = Math.abs(((v.bearing - d.bearing + 540) % 360) - 180);
                const last = d.members[d.members.length - 1];
                const joinedRank = this.projector.effectiveRank(d.members.length, v.distanceRatio);
                const reach = (this.projector.angularRadiusDeg(last.rank)
                    + this.projector.angularRadiusDeg(joinedRank))
                    * (NAV_CONSTANTS.HORIZON_DIRECTION_OVERLAP_FACTOR / 2);
                return diff <= reach;
            });

            if (group) {
                v.rank = this.projector.effectiveRank(group.members.length, v.distanceRatio);
                group.members.push(v);
            } else {
                v.rank = candidateRank;
                directions.push({ bearing: v.bearing, members: [v] });
            }
        }

        for (const direction of directions) {
            for (const member of direction.members) {
                // The queue ends where legibility does, not at a chosen number.
                if (this.projector.angularRadiusDeg(member.rank) < NAV_CONSTANTS.HORIZON_MIN_ANGULAR_DRAW) {
                    continue;
                }

                layout.set(member.id, {
                    rank: member.rank,
                    radius: this.projector.angularMarkerRadius(member.rank, fov),
                    elevationDeg: this.projector.elevacaoComAndar(member.rank, member.floorDelta),
                });
            }
        }

        return layout;
    }

    /**
     * Quantos andares o alvo sobe (positivo) ou desce (negativo).
     *
     * Zero quando os dois estao no mesmo nivel E quando o projeto nao declara
     * andar: nos projetos externos o `floor_level` e 1 em tudo, entao o calculo
     * da zero e o marcador continua identico ao de sempre.
     *
     * @param {Object} target - Alvo, com `floor_level` vindo da API
     * @returns {number} Diferenca de nivel, 0 quando nao ha o que distinguir
     */
    deltaDeAndar(target) {
        const aqui = this.cameraConfig?.floor_level;
        const la = target?.floor_level;
        if (typeof aqui !== 'number' || typeof la !== 'number') return 0;
        return la - aqui;
    }

    /**
     * Projects a navigation target: horizontal from its true bearing, vertical
     * from its place in the queue.
     *
     * @param {Object} target - Target object
     * @param {number} yaw - Camera yaw in radians
     * @param {number} pitch - Camera pitch in radians
     * @param {number} fov - Camera FOV in degrees
     * @returns {Object|null} Projected marker data, or null when it should not be drawn
     */
    projectTargetOnHorizon(target, yaw, pitch, fov) {
        const placement = this.directionLayout?.get(target.id);
        if (!placement) return null;   // too small to read: the queue ended here

        const { bearing } = this.resolveTargetVector(target);
        const projected = this.projector.projectOnHorizon(
            bearing, yaw, pitch, fov, placement.elevationDeg
        );

        // Outside the horizontal field of view: keep it as an edge arrow so the
        // operator still knows there is a way out in that direction.
        if (!projected.visible) {
            if (Math.abs(projected.azimuthRelDeg) > NAV_CONSTANTS.HORIZON_EDGE_MAX_AZIMUTH) {
                return null;
            }
            const margin = this.canvas.width * NAV_CONSTANTS.HORIZON_EDGE_MARGIN_REL;
            return {
                id: target.id,
                screenX: projected.azimuthRelDeg > 0 ? this.canvas.width - margin : margin,
                screenY: this.canvas.height / 2,
                distance: placement.rank,
                radius: Math.max(
                    this.canvas.height * NAV_CONSTANTS.HORIZON_MIN_SIZE_REL,
                    placement.radius * 0.7
                ),
                rank: placement.rank,
                offscreen: true,
                offscreenSide: projected.azimuthRelDeg > 0 ? 'right' : 'left',
                // Kept so a click on the edge arrow can TURN to the target: the
                // arrow's whole message is "it is that many degrees away".
                azimuthRelDeg: projected.azimuthRelDeg,
                floorDelta: this.deltaDeAndar(target),
                floorLevel: target?.floor_level ?? null,
                floorLabel: target?.floor_label ?? null
            };
        }

        return {
            id: target.id,
            screenX: projected.screenX,
            // The height already came from the projection: the icon is placed at
            // its own elevation, not at the horizon plus a pixel offset. That is
            // what keeps the layout identical at any zoom.
            screenY: projected.screenY,
            // Sorting key for draw order: nearer icons paint on top.
            distance: placement.rank,
            radius: placement.radius,
            rank: placement.rank,
            offscreen: false,
            sphere: true,
            // Quantos andares o alvo sobe (positivo) ou desce (negativo). Zero
            // para o mesmo andar E para todo projeto SEM andar declarado, entao
            // o acervo externo desenha exatamente como antes.
            floorDelta: this.deltaDeAndar(target),
            // O andar de DESTINO, que vira o texto ao lado da seta. O rotulo
            // manda, e o nivel so vale quando o banco nao nomeou o andar.
            floorLevel: target?.floor_level ?? null,
            floorLabel: target?.floor_label ?? null
        };
    }

    /**
     * Gives every marker a clickable radius that is larger than its drawing and
     * never smaller than a fingertip.
     *
     * Doing it here, rather than in the hit tester, is what allows the floor to
     * be relative to the canvas: the navigator is the only one that knows how
     * big the canvas is.
     *
     * @param {Array} markers - Projected navigation markers, mutated in place
     */
    assignHitRadii(markers) {
        const floor = this.canvas.height * NAV_CONSTANTS.HIT_RADIUS_MIN_REL;
        for (const marker of markers) {
            marker.hitRadius = Math.max(
                marker.radius * NAV_CONSTANTS.HIT_RADIUS_MULTIPLIER,
                floor
            );
        }
    }

    /**
     * Projects a POI marker to screen coordinates
     * @param {Object} poi - POI object with position data
     * @param {number} yaw - Camera yaw
     * @param {number} pitch - Camera pitch
     * @param {number} fov - Camera FOV
     * @returns {Object|null} Projected marker data or null
     */
    projectPOI(poi, yaw, pitch, fov) {
        if (!poi.position) return null;

        // POIs are stored as heading/pitch/distance relative to sphere center
        const { heading, pitch: poiPitch, distance } = poi.position;

        // Convert to 3D coordinates
        const headingRad = (heading * Math.PI) / 180;
        const x = Math.sin(headingRad) * Math.cos(poiPitch) * distance;
        const y = Math.sin(poiPitch) * distance;
        const z = -Math.cos(headingRad) * Math.cos(poiPitch) * distance;

        // Project to screen
        const projected = this.projector.metersToScreen(x, y, z, yaw, pitch, fov);

        if (!projected.visible) return null;

        // Use marker size directly (user-controlled, not distance-scaled)
        // Default to 12px if not set (matching DEFAULT_MARKER_360_STYLE.markerSize)
        const radius = poi.style?.markerSize || 12;

        return {
            id: poi.id,
            screenX: projected.screenX,
            screenY: projected.screenY,
            distance: projected.distance,
            radius,
            style: {
                showMarker: poi.style?.showMarker,
                color: poi.style?.markerColor,
                opacity: poi.style?.markerOpacity,
                label: poi.style?.showLabel ? (poi.style.labelText || poi.properties?.nome) : null,
                showLabel: poi.style?.showLabel,
                labelStyle: {
                    color: poi.style?.labelColor,
                    backgroundColor: poi.style?.labelBackgroundColor,
                    backgroundOpacity: poi.style?.labelBackgroundOpacity,
                    size: poi.style?.labelSize
                }
            }
        };
    }

    /**
     * Clears the highlight when the pointer leaves the 360 view.
     */
    handleMouseLeave() {
        if (this._lastHoveredId === null) return;
        this._lastHoveredId = null;
        this.renderer.setHoveredMarker(null);
        this.onHoverChange?.(null);

        const container = document.getElementById('street-view-container');
        container?.classList.remove('nav-hover');

        this.requestRender();
    }

    /**
     * Handles mouse move events
     * @param {MouseEvent} event - Mouse event
     */
    handleMouseMove(event) {
        const rect = this.canvas.getBoundingClientRect();
        this.mousePosition = {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top
        };

        // Hit test for hover
        const hit = this.hitTester.testPoint(this.mousePosition.x, this.mousePosition.y);

        // Pointer movement changes the highlight without touching the camera,
        // so the overlay has to be redrawn on demand.
        this.requestRender();

        // Update cursor style via CSS class
        const container = document.getElementById('street-view-container');

        const hoveredId = hit ? hit.id : null;
        if (hoveredId !== this._lastHoveredId) {
            this._lastHoveredId = hoveredId;
            // Vinculo 360 -> minimapa, carregado por callback para o navigator
            // nao depender do modulo do visualizador.
            this.onHoverChange?.(hoveredId);
        }

        if (hit) {
            this.renderer.setHoveredMarker(hit.id);

            // Show pointer cursor when hovering markers
            if (container) {
                container.classList.add('nav-hover');
            }

        } else {
            this.renderer.setHoveredMarker(null);

            // Remove pointer cursor
            if (container) {
                container.classList.remove('nav-hover');
            }
        }

    }

    /**
     * Handles pointer down events (for drag detection)
     * @param {PointerEvent} event - Pointer event
     */
    handlePointerDown(event) {
        if (event.isPrimary === false) return;
        // Only track left-click for navigation; right-click is for camera drag only
        if (event.button !== 0) return;

        this.pointerDownPos = {
            x: event.clientX,
            y: event.clientY
        };
        this.isDragging = false;

        // Listen for move to detect drag
        const handleDragMove = (moveEvent) => {
            if (!this.pointerDownPos) return;

            const dx = moveEvent.clientX - this.pointerDownPos.x;
            const dy = moveEvent.clientY - this.pointerDownPos.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance > DRAG_THRESHOLD) {
                this.isDragging = true;
            }
        };

        // Cleanup on pointer up OR cancel (touch interruption / browser gesture
        // takeover). Without pointercancel, handleDragMove leaks on the document.
        // Exposed via _activeDragCleanup so dispose() can detach an in-flight drag.
        const cleanup = () => {
            document.removeEventListener('pointermove', handleDragMove);
            document.removeEventListener('pointerup', cleanup);
            document.removeEventListener('pointercancel', cleanup);
            this._activeDragCleanup = null;
        };
        this._activeDragCleanup = cleanup;

        document.addEventListener('pointermove', handleDragMove);
        document.addEventListener('pointerup', cleanup);
        document.addEventListener('pointercancel', cleanup);
    }

    /**
     * Handles pointer up events (click detection)
     * @param {PointerEvent} event - Pointer event
     */
    handlePointerUp(event) {
        if (event.isPrimary === false) return;
        // Only handle left-click for navigation; right-click is for camera drag only
        if (event.button !== 0) return;

        // If it was a drag, don't handle as click
        if (this.isDragging) {
            this.pointerDownPos = null;
            this.isDragging = false;
            return;
        }

        // This is a click
        this.pointerDownPos = null;

        const rect = this.canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;

        this.handleNavigationClick(x, y);
    }

    /**
     * Handles navigation click (after drag detection)
     * @param {number} x - Click X coordinate
     * @param {number} y - Click Y coordinate
     * @returns {Object|null} Click result with type and data
     */
    handleNavigationClick(x, y) {
        // Check for marker tool mode
        if (this.markerToolActive) {
            // Use currentYaw/currentPitch from render() which include imageHeading,
            // matching the coordinate system used for projecting POIs back to screen
            if (this.currentYaw !== undefined) {
                const spherical = this.projector.screenToSpherical(
                    x, y,
                    this.currentYaw,
                    this.currentPitch,
                    this.currentFov
                );
                // Emit event for marker creation
                getEventBus().emit(EventTypes.MARKER_360_POSITION_CLICKED, {
                    position: spherical,
                    photoName: this.cameraConfig?.img
                });
                return { type: 'new-marker', position: spherical };
            }
        }

        // Hit test
        const hit = this.hitTester.testPoint(x, y);

        if (hit) {
            if (hit.type === 'navigation') {
                // An EDGE ARROW is not the target, it is a pointer AT the target:
                // it only exists because the target is outside the field of view.
                // Acting on it should bring the target into view, so the operator
                // can see what they are about to walk into and then decide. Moving
                // straight there teleported them somewhere they had never seen.
                // The sphere marker (the target itself, on screen) still navigates.
                if (hit.offscreen) {
                    this.turnToTarget(hit);
                    return { type: 'turn', target: hit.data };
                }
                // Navigation target clicked - navigate to it
                this.navigateToTarget(hit.data);
                return { type: 'navigation', target: hit.data };
            } else if (hit.type === 'poi') {
                // POI clicked - select it
                this.selectPOI(hit.id);
                getEventBus().emit(EventTypes.MARKER_360_CLICKED, {
                    marker: hit.data,
                    photoName: this.cameraConfig?.img
                });
                return { type: 'poi', poi: hit.data };
            }
        } else {
            // Clicked on empty space: only deselect a POI, if any. Clicking the
            // void no longer navigates (the ground cursor that used to point at
            // the nearest target is gone with the flat-ground model).
            if (this.selectedPOIId) {
                this.deselectPOI();
            }
            return null;
        }

        return null;
    }

    /**
     * Turns the view until an off-screen target is in front of the operator.
     *
     * `azimuthRelDeg` is measured from the current view direction, positive to the
     * right, which is exactly what `turnViewBy` consumes — so no conversion, and
     * nothing here needs to know the photo's own heading.
     *
     * @param {Object} marker - The off-screen marker that was clicked
     */
    turnToTarget(marker) {
        const delta = marker?.azimuthRelDeg;
        if (!Number.isFinite(delta)) return;

        import('../street_view_viewer.js')
            .then(module => module.turnViewBy(delta))
            .catch(error => {
                console.error('Error turning towards target:', error);
            });
    }

    /**
     * Navigates to a target photo
     * @param {Object} target - Target object with img property
     */
    navigateToTarget(target) {
        import('../street_view_viewer.js')
            .then(module => module.navigateToTarget(target.img))
            .catch(error => {
                console.error('Error navigating to target photo:', error);
                showToast('Erro ao navegar para a foto', 'error');
            });
    }

    /**
     * Selects a POI marker
     * @param {string} poiId - POI ID to select
     */
    selectPOI(poiId) {
        this.selectedPOIId = poiId;
        this.renderer.setSelectedMarker(poiId);
    }

    /**
     * Deselects the current POI
     */
    deselectPOI() {
        if (this.selectedPOIId) {
            const photoName = this.cameraConfig?.img;
            this.selectedPOIId = null;
            this.renderer.setSelectedMarker(null);
            getEventBus().emit(EventTypes.MARKER_360_DESELECTED, { photoName });
        }
    }

    /**
     * Sets visibility of the navigation overlay
     * @param {boolean} visible - Whether to show the overlay
     */
    setVisible(visible) {
        if (this.renderer) {
            this.renderer.setVisible(visible);
        }
        if (this.canvas) {
            this.canvas.style.display = visible ? 'block' : 'none';
        }
    }

    /**
     * Sets the marker tool active state
     * @param {boolean} active - Whether marker tool is active
     */
    setMarkerToolActive(active) {
        this.markerToolActive = active;
        // Toggle CSS class on container for crosshair cursor
        const container = document.getElementById('street-view-container');
        if (container) {
            container.classList.toggle('marker-tool-active', active);
        }
        this.requestRender();
    }

    /**
     * Handles window resize
     */
    handleResize() {
        if (!this.canvas || !this.container) return;

        // Use container dimensions (accounts for sidebar offset)
        this.canvas.width = this.container.clientWidth;
        this.canvas.height = this.container.clientHeight;

        if (this.projector) {
            this.projector.resize(this.canvas.width, this.canvas.height);
        }
        if (this.renderer) {
            this.renderer.resize(this.canvas.width, this.canvas.height);
        }

        this.requestRender();
    }

    /**
     * Resizes the navigation canvas
     */
    resize() {
        this.handleResize();
    }

    /**
     * Disposes of the navigator
     */
    dispose() {
        if (!this.initialized) return;

        // Detach any in-flight per-drag document listeners (drag interrupted by
        // dispose without a pointerup/pointercancel).
        if (this._activeDragCleanup) this._activeDragCleanup();

        // Remove event listeners
        this.container.removeEventListener('mousemove', this.handleMouseMove);
        this.container.removeEventListener('mouseleave', this.handleMouseLeave);
        this.container.removeEventListener('pointerdown', this.handlePointerDown);
        this.container.removeEventListener('pointerup', this.handlePointerUp);
        window.removeEventListener('resize', this.handleResize);

        // Dispose subcomponents
        if (this.renderer) {
            this.renderer.dispose();
        }
        if (this.minimapSync) {
            this.minimapSync.dispose();
        }

        // Remove canvas
        if (this.canvas && this.canvas.parentNode) {
            this.canvas.parentNode.removeChild(this.canvas);
        }

        this.initialized = false;
    }
}
