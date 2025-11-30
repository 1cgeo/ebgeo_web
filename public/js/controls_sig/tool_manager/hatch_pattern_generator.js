// Path: js/controls_sig/tool_manager/hatch_pattern_generator.js

export class HatchPatternGenerator {
    constructor() {
        this.patternCache = new Map();
    }

    generatePattern(config) {
        const cacheKey = this.getCacheKey(config);

        if (this.patternCache.has(cacheKey)) {
            return this.patternCache.get(cacheKey);
        }

        const imageData = this.createPatternImageData(config);
        this.patternCache.set(cacheKey, imageData);
        return imageData;
    }

    createPatternImageData(config) {
        const { type, spacing, lineWidth, color } = config;
        const size = spacing * 2;

        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.lineCap = 'butt';
        ctx.lineJoin = 'miter';

        switch (type) {
            case 'diagonal-right':
                this.drawDiagonalRight(ctx, size, lineWidth);
                break;
            case 'diagonal-left':
                this.drawDiagonalLeft(ctx, size, lineWidth);
                break;
            case 'horizontal':
                this.drawHorizontal(ctx, size, lineWidth);
                break;
            case 'vertical':
                this.drawVertical(ctx, size, lineWidth);
                break;
            case 'cross':
                this.drawCross(ctx, size, lineWidth);
                break;
            case 'cross-diagonal':
                this.drawCrossDiagonal(ctx, size, lineWidth);
                break;
            case 'dots':
                this.drawDots(ctx, size, lineWidth, color);
                break;
            default:
                break;
        }

        const imageData = ctx.getImageData(0, 0, size, size);
        return { width: size, height: size, data: imageData.data };
    }

    /**
     * Draw diagonal "/" pattern - line from bottom-left to top-right
     *
     * For tileable pattern, draw parallel lines spaced by the spacing value.
     * Add small overlap at edges to ensure perfect continuity between tiles.
     */
    drawDiagonalRight(ctx, size, lineWidth) {
        ctx.beginPath();

        const spacing = size / 2;
        const overlap = 2;

        for (let offset = -size; offset <= size * 2; offset += spacing) {
            ctx.moveTo(offset - overlap, size + overlap);
            ctx.lineTo(offset + size + overlap, -overlap);
        }

        ctx.stroke();
    }

    /**
     * Draw diagonal "\" pattern - line from top-left to bottom-right
     *
     * Similar to diagonal-right, draw multiple parallel lines spaced uniformly.
     * Add overlap at edges to ensure continuity.
     */
    drawDiagonalLeft(ctx, size, lineWidth) {
        ctx.beginPath();

        const spacing = size / 2;
        const overlap = 2;

        for (let offset = -size; offset <= size * 2; offset += spacing) {
            ctx.moveTo(offset - overlap, -overlap);
            ctx.lineTo(offset + size + overlap, size + overlap);
        }

        ctx.stroke();
    }

    drawHorizontal(ctx, size, lineWidth) {
        ctx.beginPath();
        ctx.moveTo(0, size / 2);
        ctx.lineTo(size, size / 2);
        ctx.stroke();
    }

    drawVertical(ctx, size, lineWidth) {
        ctx.beginPath();
        ctx.moveTo(size / 2, 0);
        ctx.lineTo(size / 2, size);
        ctx.stroke();
    }

    drawCross(ctx, size, lineWidth) {
        this.drawHorizontal(ctx, size, lineWidth);
        this.drawVertical(ctx, size, lineWidth);
    }

    drawCrossDiagonal(ctx, size, lineWidth) {
        this.drawDiagonalRight(ctx, size, lineWidth);
        this.drawDiagonalLeft(ctx, size, lineWidth);
    }

    drawDots(ctx, size, lineWidth, color) {
        ctx.fillStyle = color;
        const radius = lineWidth;
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, radius, 0, Math.PI * 2);
        ctx.fill();
    }

    getCacheKey(config) {
        const colorHex = config.color.replace('#', '');
        return `hatch_${config.type}_${config.spacing}_${config.lineWidth}_${colorHex}`;
    }

    getPatternId(feature) {
        const config = {
            type: feature.properties.hatchType || 'diagonal-right',
            spacing: feature.properties.hatchSpacing || 8,
            lineWidth: feature.properties.hatchLineWidth || 2,
            color: feature.properties.hatchColor || '#000000'
        };
        return this.getCacheKey(config);
    }

    loadPatternsToMap(map, features) {
        if (!features || features.length === 0) {
            return;
        }

        const uniquePatterns = new Map();
        const currentPatternIds = new Set();

        features.forEach(feature => {
            if (feature.properties.hatchEnabled) {
                const config = {
                    type: feature.properties.hatchType || 'diagonal-right',
                    spacing: feature.properties.hatchSpacing || 8,
                    lineWidth: feature.properties.hatchLineWidth || 2,
                    color: feature.properties.hatchColor || '#000000'
                };

                const patternId = this.getCacheKey(config);
                feature.properties.hatchPatternId = patternId;
                currentPatternIds.add(patternId);

                if (!uniquePatterns.has(patternId)) {
                    uniquePatterns.set(patternId, config);
                }
            }
        });

        uniquePatterns.forEach((config, patternId) => {
            try {
                const imageData = this.generatePattern(config);

                if (!imageData || !imageData.data || imageData.width === 0 || imageData.height === 0) {
                    console.warn(`Invalid image data for pattern ${patternId}`);
                    return;
                }

                if (map.hasImage(patternId)) {
                    map.updateImage(patternId, imageData);
                } else {
                    map.addImage(patternId, imageData);
                }
            } catch (error) {
                console.error(`Error loading pattern ${patternId}:`, error);
            }
        });
    }

    clearCache() {
        this.patternCache.clear();
    }
}
