// Path: js/street_view_tool/navigation/renderer.js

/**
 * @fileoverview Canvas 2D renderer for Street View 360 navigation elements.
 * Renders navigation markers (simple circles), ground cursor with arrow, POIs, and selection highlights.
 * Implements Google Street View-like cursor behavior.
 */

import { NAV_CONSTANTS } from './constants.js';

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
        this.visible = true;

        // Ground cursor state
        this.groundCursor = null; // { screenX, screenY, flattenY, arrowAngle }

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
     * Sets the ground cursor position and direction
     * @param {Object|null} cursor - Cursor data { screenX, screenY, flattenY, arrowAngle } or null to hide
     */
    setGroundCursor(cursor) {
        this.groundCursor = cursor;
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

        // Render ground cursor on top
        if (this.groundCursor) {
            this.renderGroundCursor();
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
            flattenY,
            type,
            style
        } = marker;

        const isHovered = this.hoveredMarkerId === id;
        const isSelected = this.selectedMarkerId === id;
        const isNearest = this.nearestMarkerId === id;
        const isCursorNearest = this.cursorNearestMarkerId === id;

        // Calculate animation scale
        const targetScale = isHovered ? NAV_CONSTANTS.HOVER_SCALE : 1;
        const currentScale = this.getAnimatedScale(id, targetScale);

        const ctx = this.ctx;
        ctx.save();
        ctx.translate(screenX, screenY);

        // Apply scale
        const finalRadius = radius * currentScale;

        if (type === 'navigation') {
            this.renderNavigationMarker(ctx, finalRadius, flattenY, isHovered, isNearest, isCursorNearest);
        } else if (type === 'poi') {
            // Only render marker circle if showMarker is not false
            if (style?.showMarker !== false) {
                this.renderPOIMarker(ctx, finalRadius, flattenY, style, isHovered, isSelected);
            }

            // Render label if present (can show label without marker)
            if (style?.label && style.showLabel !== false) {
                this.renderLabel(ctx, style, finalRadius);
            }
        }

        ctx.restore();
    }

    /**
     * Renders a navigation marker (Google Street View style - circle with inner dot)
     * @param {CanvasRenderingContext2D} ctx - Canvas context
     * @param {number} radius - Marker radius
     * @param {number} flattenY - Y-axis flatten ratio (perspective-based)
     * @param {boolean} isHovered - Whether marker is hovered
     * @param {boolean} isNearest - Whether this is the nearest marker to camera
     * @param {boolean} isCursorNearest - Whether this is the nearest marker to cursor position
     */
    renderNavigationMarker(ctx, radius, flattenY, isHovered, isNearest, isCursorNearest) {
        // Apply perspective scaling (ellipse on ground plane)
        ctx.save();
        ctx.scale(1, flattenY);

        // Determine style based on state
        // isCursorNearest takes priority - it's the one the user will navigate to on click
        const isHighlighted = isHovered || isCursorNearest;

        // Shadow below marker
        ctx.beginPath();
        ctx.arc(0, 4 / flattenY, radius * 1.1, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fill();

        // Draw glow effect for cursor nearest marker
        if (isCursorNearest && !isHovered) {
            ctx.beginPath();
            ctx.arc(0, 0, radius * 1.3, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(59, 130, 246, 0.25)';
            ctx.fill();
        }

        // Outer circle - fill (white background)
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.fillStyle = isHighlighted
            ? 'rgba(255, 255, 255, 0.95)'
            : 'rgba(255, 255, 255, 0.7)';
        ctx.fill();

        // Outer circle - border
        ctx.strokeStyle = isHighlighted
            ? 'rgba(59, 130, 246, 0.9)' // Blue border when highlighted
            : 'rgba(0, 0, 0, 0.4)';
        ctx.lineWidth = isHighlighted ? 3 : 2;
        ctx.stroke();

        // Inner circle (dot) - key Google Street View style element
        const innerRadius = radius * 0.45;
        ctx.beginPath();
        ctx.arc(0, 0, innerRadius, 0, Math.PI * 2);
        ctx.fillStyle = isHighlighted
            ? 'rgba(59, 130, 246, 0.95)' // Blue when highlighted
            : 'rgba(100, 100, 100, 0.5)'; // Gray when not
        ctx.fill();

        ctx.restore();
    }

    /**
     * Renders the ground cursor that follows the mouse
     * Large cursor with circle on ground and chevron arrow INSIDE the circle pointing to nearest marker
     * Styled like Google Street View navigation cursor
     */
    renderGroundCursor() {
        const { screenX, screenY, flattenY, arrowAngle, distance } = this.groundCursor;
        const ctx = this.ctx;

        ctx.save();
        ctx.translate(screenX, screenY);

        // Calculate cursor size based on distance (closer = larger)
        const baseSize = NAV_CONSTANTS.CURSOR_SIZE;
        const refDist = NAV_CONSTANTS.CURSOR_REFERENCE_DISTANCE || 10;
        const distanceScale = Math.max(0.5, Math.min(2, refDist / Math.max(1, distance || refDist)));
        let cursorSize = baseSize * distanceScale;
        cursorSize = Math.max(NAV_CONSTANTS.CURSOR_MIN_SIZE || 50, Math.min(NAV_CONSTANTS.CURSOR_MAX_SIZE || 140, cursorSize));

        // Draw cursor circle (ellipse with perspective) - Google Street View style
        ctx.save();
        ctx.scale(1, flattenY);

        // Outer shadow
        ctx.beginPath();
        ctx.arc(0, 5 / flattenY, cursorSize * 0.52, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
        ctx.fill();

        // Outer ring with white fill (semi-transparent)
        ctx.beginPath();
        ctx.arc(0, 0, cursorSize * 0.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.fill();

        // White border ring
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.lineWidth = Math.max(3, cursorSize * 0.07);
        ctx.stroke();

        ctx.restore();

        // Draw chevron arrow INSIDE the circle, centered, pointing to nearest marker
        if (arrowAngle !== null && arrowAngle !== undefined) {
            this.renderCursorArrow(ctx, cursorSize, flattenY, arrowAngle);
        }

        ctx.restore();
    }

    /**
     * Renders the arrow on the ground cursor pointing to nearest marker
     * Large chevron style CENTERED inside the cursor circle
     * @param {CanvasRenderingContext2D} ctx - Canvas context
     * @param {number} cursorSize - Size of the cursor
     * @param {number} flattenY - Y-axis flatten ratio for perspective
     * @param {number} angle - Rotation angle in radians (0 = pointing up/forward)
     */
    renderCursorArrow(ctx, cursorSize, flattenY, angle) {
        ctx.save();

        // Apply perspective first (same as cursor circle)
        ctx.scale(1, flattenY);

        // Then rotate around center - arrow stays centered and rotates
        ctx.rotate(angle);

        // Chevron dimensions - sized to fit nicely inside the circle
        const chevronWidth = cursorSize * 0.55;
        const chevronHeight = cursorSize * 0.38;
        const strokeWidth = Math.max(4, cursorSize * 0.09);

        // Offset the chevron slightly in the direction it's pointing
        // This creates a visual indication of direction while staying centered
        const offsetAmount = cursorSize * 0.08;
        ctx.translate(0, -offsetAmount);

        // Draw shadow first (behind)
        ctx.beginPath();
        ctx.moveTo(-chevronWidth / 2, chevronHeight / 2);
        ctx.lineTo(0, -chevronHeight / 2);
        ctx.lineTo(chevronWidth / 2, chevronHeight / 2);

        ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.lineWidth = strokeWidth + 4;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();

        // Draw main white chevron
        ctx.beginPath();
        ctx.moveTo(-chevronWidth / 2, chevronHeight / 2);
        ctx.lineTo(0, -chevronHeight / 2);
        ctx.lineTo(chevronWidth / 2, chevronHeight / 2);

        ctx.strokeStyle = 'rgba(255, 255, 255, 1)';
        ctx.lineWidth = strokeWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();

        ctx.restore();
    }

    /**
     * Renders a POI marker (user-created marker)
     * @param {CanvasRenderingContext2D} ctx - Canvas context
     * @param {number} radius - Marker radius
     * @param {number} flattenY - Y-axis flatten ratio
     * @param {Object} style - Marker style
     * @param {boolean} isHovered - Whether marker is hovered
     * @param {boolean} isSelected - Whether marker is selected
     */
    renderPOIMarker(ctx, radius, flattenY, style, isHovered, isSelected) {
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
