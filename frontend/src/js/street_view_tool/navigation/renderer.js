// Path: js/street_view_tool/navigation/renderer.js

/**
 * @fileoverview Canvas 2D renderer for Street View 360 navigation elements.
 * Renders navigation markers as armillary spheres, edge arrows, POIs and
 * selection highlights.
 */

import { NAV_CONSTANTS } from './constants.js';

/**
 * Draws a navigation target as an armillary sphere: rings rather than a solid
 * ball, so it reads as a sphere and as a panorama at once, and being open it
 * sits over the photograph instead of punching a hole in it.
 *
 * Exported and state-driven because three places draw this exact marker: the
 * viewer overlay, the calibration overlay and the calibration rear view. A
 * fourth hand-rolled copy is how they drifted apart in the first place.
 *
 * The ring geometry is real, not decorative: a parallel at height h on a unit
 * sphere has radius sqrt(1 - h^2). Every ring is drawn at every size, so the
 * marker never changes identity as the operator walks towards it.
 *
 * @param {CanvasRenderingContext2D} ctx - Context, already translated to the centre
 * @param {number} radius - Sphere radius in pixels
 * @param {Object} [state] - Visual state
 * @param {boolean} [state.highlighted] - The target a click would take
 * @param {boolean} [state.selected] - Selected for editing (calibration only)
 * @param {boolean} [state.hidden] - Hidden from navigation (calibration only)
 * @param {number} [state.opacity] - Fades markers further down the queue
 */
export function drawArmillarySphere(ctx, radius, state = {}) {
    const { highlighted = false, selected = false, hidden = false, opacity = 1 } = state;
    const r = Math.max(1, radius);
    const TILT = 0.30;

    let ring, fill;
    if (hidden) {
        // Unmistakably off: red, dashed, and struck through. Dimming alone was
        // read as "far away" rather than "disabled".
        ring = 'rgba(255, 138, 138, 0.95)';
        fill = 'rgba(70, 12, 12, 0.42)';
    } else if (selected) {
        ring = 'rgba(255, 240, 214, 0.98)';
        fill = 'rgba(217, 119, 6, 0.42)';
    } else if (highlighted) {
        ring = 'rgba(255, 255, 255, 1)';
        fill = 'rgba(37, 99, 235, 0.62)';
    } else {
        ring = 'rgba(255, 255, 255, 0.95)';
        fill = 'rgba(17, 24, 36, 0.26)';
    }

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, opacity));

    // Halo, only when highlighted: the cue that says "this is the one a click
    // takes you to" has to survive a busy photograph.
    if (highlighted && !hidden) {
        ctx.beginPath();
        ctx.arc(0, 0, r * 1.45, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(59, 130, 246, 0.28)';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(0, 0, r * 1.28, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(147, 197, 253, 0.85)';
        ctx.lineWidth = Math.max(1, r * 0.09);
        ctx.stroke();
    }

    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = Math.max(1.5, r * 0.3);

    // Body: translucent, just enough to separate from the scene
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();

    ctx.strokeStyle = ring;
    ctx.lineCap = 'round';
    if (hidden) {
        ctx.setLineDash([Math.max(2, r * 0.28), Math.max(2, r * 0.2)]);
    }

    // Outer ring
    ctx.lineWidth = Math.max(1, r * (highlighted ? 0.12 : 0.09));
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();

    // Equator
    ctx.lineWidth = Math.max(0.8, r * (highlighted ? 0.09 : 0.07));
    ctx.beginPath();
    ctx.ellipse(0, 0, r, r * TILT, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Two parallels, each at the true radius for its height
    for (const h of [-0.55, 0.55]) {
        const rx = r * Math.sqrt(1 - h * h);
        ctx.beginPath();
        ctx.ellipse(0, r * h * (1 - TILT * 0.5), rx, rx * TILT, 0, 0, Math.PI * 2);
        ctx.stroke();
    }

    // Meridian through the poles
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.34, r, 0, 0, Math.PI * 2);
    ctx.stroke();

    // The tilted band, what makes it read as armillary rather than wireframe
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.97, r * 0.24, -0.42, 0, Math.PI * 2);
    ctx.stroke();

    ctx.setLineDash([]);

    // Strike-through for a disabled target
    if (hidden) {
        const d = r * 0.78;
        ctx.beginPath();
        ctx.moveTo(-d, d);
        ctx.lineTo(d, -d);
        ctx.strokeStyle = 'rgba(255, 90, 90, 0.95)';
        ctx.lineWidth = Math.max(1.5, r * 0.16);
        ctx.stroke();
    }

    ctx.restore();
}

/**
 * Opacity for a marker at a given rank in its direction.
 * The one a click would take is never faded: it has to stay the most solid
 * thing on screen no matter how far down the queue it sits.
 *
 * @param {number} rank - Position in the queue, 0 = first
 * @param {boolean} isHighlighted - Whether this is the click target
 * @returns {number} Alpha in [0, 1]
 */
export function rankOpacity(rank, isHighlighted = false) {
    if (isHighlighted) return 1;
    return Math.max(
        NAV_CONSTANTS.HORIZON_RANK_FADE_MIN,
        Math.pow(NAV_CONSTANTS.HORIZON_RANK_FADE, Math.max(0, rank))
    );
}

/**
 * Renders navigation elements on a Canvas 2D overlay.
 */
export class StreetViewRenderer {
    /**
     * @param {HTMLCanvasElement} canvas - The canvas element to render on
     */
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');

        // State
        this.markers = [];
        this.nearestMarkerId = null;
        this.cursorNearestMarkerId = null; // Dynamically calculated based on cursor position
        this.hoveredMarkerId = null;
        this.selectedMarkerId = null;
        // Remote peers' selections (multiuser presence): markerId -> { color, name }.
        // The per-frame render() rewrites selectedMarkerId (local) but NEVER touches
        // this map, so a peer's highlight is independent of the local selection.
        this.remoteSelections = new Map();
        this.visible = true;

        // Animation state
        this.hoverAnimation = new Map();
    }

    /**
     * Sets the markers to render
     * @param {Array} markers - Array of marker objects with screen positions
     */
    setMarkers(markers) {
        this.markers = markers;
    }

    /**
     * Sets the nearest navigation marker (will be highlighted)
     * @param {string|null} id - Marker ID or null
     */
    setNearestMarker(id) {
        this.nearestMarkerId = id;
    }

    /**
     * Sets the nearest marker based on cursor position (dynamically calculated)
     * @param {string|null} id - Marker ID or null
     */
    setCursorNearestMarker(id) {
        this.cursorNearestMarkerId = id;
    }

    /**
     * Sets the currently hovered marker
     * @param {string|null} id - Marker ID or null
     */
    setHoveredMarker(id) {
        this.hoveredMarkerId = id;
    }

    /**
     * Sets the currently selected marker
     * @param {string|null} id - Marker ID or null
     */
    setSelectedMarker(id) {
        this.selectedMarkerId = id;
    }

    /**
     * Sets the remote peers' selections to highlight (multiuser presence).
     * @param {Map<string, { color: string, name: string }>} selections - markerId -> peer info
     */
    setRemoteSelections(selections) {
        this.remoteSelections = selections instanceof Map ? selections : new Map();
    }

    /**
     * Sets visibility of the overlay
     * @param {boolean} visible - Whether to show the overlay
     */
    setVisible(visible) {
        this.visible = visible;
        if (!visible) {
            this.clear();
        }
    }

    /**
     * Clears the canvas
     */
    clear() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    /**
     * Resizes the canvas
     * @param {number} width - New width
     * @param {number} height - New height
     */
    resize(width, height) {
        this.canvas.width = width;
        this.canvas.height = height;
    }

    /**
     * Renders a single frame
     */
    render() {
        if (!this.visible) {
            return;
        }

        this.clear();

        // Sort markers by distance (far to near for proper overlap)
        const sortedMarkers = [...this.markers].sort((a, b) => b.distance - a.distance);

        // Render markers
        for (const marker of sortedMarkers) {
            this.renderMarker(marker);
        }

    }

    /**
     * Renders a navigation or POI marker
     * @param {Object} marker - Marker data
     */
    renderMarker(marker) {
        const {
            id,
            screenX,
            screenY,
            radius,
            type,
            style
        } = marker;

        const isHovered = this.hoveredMarkerId === id;
        const isSelected = this.selectedMarkerId === id;
        const isCursorNearest = this.cursorNearestMarkerId === id;

        // Calculate animation scale
        const targetScale = isHovered ? NAV_CONSTANTS.HOVER_SCALE : 1;
        const currentScale = this.getAnimatedScale(id, targetScale);

        const ctx = this.ctx;
        ctx.save();
        ctx.translate(screenX, screenY);

        // Apply scale
        const finalRadius = radius * currentScale;

        if (type === 'navigation' && marker.offscreen) {
            this.renderEdgeArrow(ctx, finalRadius, marker.offscreenSide, isHovered || isCursorNearest);
        } else if (type === 'navigation' && marker.sphere) {
            this.renderSphereMarker(ctx, finalRadius, isHovered || isCursorNearest, marker.rank);
        } else if (type === 'poi') {
            // Only render marker circle if showMarker is not false
            if (style?.showMarker !== false) {
                this.renderPOIMarker(ctx, finalRadius, style, isHovered, isSelected);
            }

            // Render label if present (can show label without marker)
            if (style?.label && style.showLabel !== false) {
                this.renderLabel(ctx, style, finalRadius);
            }

            // Multiuser: highlight if a remote peer has this POI selected (drawn even
            // when showMarker is false, so the highlight is always visible).
            const remoteSel = this.remoteSelections.get(id);
            if (remoteSel) {
                this.renderRemoteSelection(ctx, finalRadius, remoteSel);
            }
        }

        ctx.restore();
    }

    /**
     * Renders a navigation target as an armillary sphere.
     * Delegates to the shared drawing so the viewer, the calibration overlay and
     * the calibration rear view cannot drift apart.
     *
     * @param {CanvasRenderingContext2D} ctx - Canvas context, already translated
     * @param {number} radius - Sphere radius in pixels
     * @param {boolean} isHighlighted - Whether this is the target a click would take
     */
    renderSphereMarker(ctx, radius, isHighlighted, rank = 0) {
        drawArmillarySphere(ctx, radius, {
            highlighted: isHighlighted,
            opacity: rankOpacity(rank, isHighlighted),
        });
    }

    /**
     * Renders a chevron at the canvas edge for a target that sits outside the
     * horizontal field of view, so the operator knows a way out exists there.
     *
     * @param {CanvasRenderingContext2D} ctx - Canvas context, already translated
     * @param {number} radius - Marker radius in pixels
     * @param {'left'|'right'} side - Which edge the target lies beyond
     * @param {boolean} isHighlighted - Whether to draw it in the highlight colour
     */
    renderEdgeArrow(ctx, radius, side, isHighlighted) {
        const direction = side === 'right' ? 1 : -1;
        const w = radius * 0.8;
        const h = radius * 1.1;

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(-direction * w * 0.4, -h);
        ctx.lineTo(direction * w * 0.6, 0);
        ctx.lineTo(-direction * w * 0.4, h);
        ctx.closePath();

        ctx.fillStyle = isHighlighted
            ? 'rgba(59, 130, 246, 0.9)'
            : 'rgba(255, 255, 255, 0.75)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
    }

    /**
     * Renders a POI marker (user-created marker)
     * @param {CanvasRenderingContext2D} ctx - Canvas context
     * @param {number} radius - Marker radius
     * @param {Object} style - Marker style
     * @param {boolean} isHovered - Whether marker is hovered
     * @param {boolean} isSelected - Whether marker is selected
     */
    renderPOIMarker(ctx, radius, style, isHovered, isSelected) {
        const color = style?.color || NAV_CONSTANTS.POI_DEFAULT_COLOR;
        // Use nullish coalescing to properly handle opacity 0
        const opacity = style?.opacity ?? 1;

        // Draw selection glow (circle, not ellipse)
        if (isSelected) {
            ctx.beginPath();
            ctx.arc(0, 0, radius + NAV_CONSTANTS.SELECTED_GLOW_SIZE, 0, Math.PI * 2);
            ctx.fillStyle = NAV_CONSTANTS.SELECTED_GLOW_COLOR;
            ctx.fill();
        }

        // Draw circle (not ellipse - markers should be round)
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);

        // Fill with color
        ctx.globalAlpha = opacity;
        ctx.fillStyle = color;
        ctx.fill();
        ctx.globalAlpha = 1;

        // Border
        ctx.strokeStyle = isSelected
            ? color
            : NAV_CONSTANTS.POI_BORDER_COLOR;
        ctx.lineWidth = isSelected
            ? NAV_CONSTANTS.POI_BORDER_WIDTH + 1
            : NAV_CONSTANTS.POI_BORDER_WIDTH;
        ctx.stroke();

        // Hover highlight (circle)
        if (isHovered && !isSelected) {
            ctx.beginPath();
            ctx.arc(0, 0, radius - 2, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }

    /**
     * Renders a label for a POI marker
     * @param {CanvasRenderingContext2D} ctx - Canvas context
     * @param {Object} style - Label style
     * @param {number} markerRadius - Marker radius for positioning
     */
    renderLabel(ctx, style, markerRadius) {
        const text = style.label || '';
        if (!text) return;

        const fontSize = style.labelStyle?.size || NAV_CONSTANTS.LABEL_FONT_SIZE;
        const padding = NAV_CONSTANTS.LABEL_PADDING;
        const borderRadius = NAV_CONSTANTS.LABEL_BORDER_RADIUS;

        ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        const metrics = ctx.measureText(text);
        const textWidth = metrics.width;
        const textHeight = fontSize;

        const boxWidth = textWidth + padding * 2;
        const boxHeight = textHeight + padding * 1.5;
        const offsetY = -(markerRadius + boxHeight / 2 + 8);

        // Background
        const bgColor = style.labelStyle?.backgroundColor || style.color || NAV_CONSTANTS.POI_DEFAULT_COLOR;
        const bgOpacity = style.labelStyle?.backgroundOpacity ?? 0.9;

        ctx.save();
        ctx.translate(0, offsetY);

        // Draw rounded rectangle background
        ctx.beginPath();
        ctx.roundRect(-boxWidth / 2, -boxHeight / 2, boxWidth, boxHeight, borderRadius);
        ctx.globalAlpha = bgOpacity;
        ctx.fillStyle = bgColor;
        ctx.fill();
        ctx.globalAlpha = 1;

        // Draw text
        ctx.fillStyle = style.labelStyle?.color || '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 0, 1);

        ctx.restore();
    }

    /**
     * Renders a remote peer's selection highlight on a POI: a colored ring in the
     * peer's presence color plus a name chip below the marker (so it doesn't collide
     * with the POI's own label, which renders above).
     * @param {CanvasRenderingContext2D} ctx - Canvas context (already translated to the marker)
     * @param {number} radius - Marker radius
     * @param {{ color: string, name: string }} info - Peer color + display name
     */
    renderRemoteSelection(ctx, radius, info) {
        const color = info.color || '#2563eb';

        // Colored ring around the POI.
        ctx.save();
        ctx.beginPath();
        ctx.arc(0, 0, radius + NAV_CONSTANTS.SELECTED_GLOW_SIZE + 2, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.restore();

        if (info.name) {
            this.renderRemoteLabel(ctx, info.name, color, radius);
        }
    }

    /**
     * Renders a peer's name chip below a remotely-selected POI.
     * @param {CanvasRenderingContext2D} ctx - Canvas context
     * @param {string} text - Peer display name
     * @param {string} color - Peer presence color (chip background)
     * @param {number} markerRadius - Marker radius for positioning
     */
    renderRemoteLabel(ctx, text, color, markerRadius) {
        const fontSize = NAV_CONSTANTS.LABEL_FONT_SIZE;
        const padding = NAV_CONSTANTS.LABEL_PADDING;
        const borderRadius = NAV_CONSTANTS.LABEL_BORDER_RADIUS;

        ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        const metrics = ctx.measureText(text);
        const boxWidth = metrics.width + padding * 2;
        const boxHeight = fontSize + padding * 1.5;
        // Below the marker (the POI's own label sits above).
        const offsetY = markerRadius + boxHeight / 2 + 8;

        ctx.save();
        ctx.translate(0, offsetY);

        ctx.beginPath();
        ctx.roundRect(-boxWidth / 2, -boxHeight / 2, boxWidth, boxHeight, borderRadius);
        ctx.fillStyle = color;
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 0, 1);

        ctx.restore();
    }

    /**
     * Gets animated scale for hover effect
     * @param {string} id - Marker ID
     * @param {number} targetScale - Target scale
     * @returns {number} Current interpolated scale
     */
    getAnimatedScale(id, targetScale) {
        if (!this.hoverAnimation.has(id)) {
            this.hoverAnimation.set(id, { scale: 1, target: 1 });
        }

        const anim = this.hoverAnimation.get(id);
        anim.target = targetScale;

        // Simple lerp
        const speed = 0.2;
        anim.scale += (anim.target - anim.scale) * speed;

        // Cleanup if at rest
        if (Math.abs(anim.scale - 1) < 0.01 && anim.target === 1) {
            this.hoverAnimation.delete(id);
            return 1;
        }

        return anim.scale;
    }

    /**
     * Disposes of the renderer
     */
    dispose() {
        this.clear();
        this.markers = [];
        this.hoverAnimation.clear();
    }
}
