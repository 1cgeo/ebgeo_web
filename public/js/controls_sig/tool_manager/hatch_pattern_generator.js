// Path: js\controls_sig\tool_manager\hatch_pattern_generator.js

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
     * Desenha padrão diagonal "/" - Linha da esquerda-baixo para direita-cima
     * 
     * Para um padrão tileable (repetível), desenhamos linhas paralelas espaçadas
     * pelo valor de spacing. Adicionamos uma pequena sobreposição nas bordas
     * para garantir continuidade perfeita entre tiles.
     */
    drawDiagonalRight(ctx, size, lineWidth) {
        ctx.beginPath();
        
        // spacing real é size/2
        const spacing = size / 2;
        
        // Sobreposição pequena para evitar gaps entre tiles (1-2 pixels)
        const overlap = 2;
        
        // Desenha linhas diagonais "/" que atravessam o tile
        // Estendemos ligeiramente as linhas além dos limites para garantir sobreposição
        for (let offset = -size; offset <= size * 2; offset += spacing) {
            // Cada linha vai de baixo-esquerda para cima-direita com inclinação de 45°
            // Estendemos a linha um pouco além dos limites do tile
            ctx.moveTo(offset - overlap, size + overlap);
            ctx.lineTo(offset + size + overlap, -overlap);
        }
        
        ctx.stroke();
    }

    /**
     * Desenha padrão diagonal "\" - Linha da esquerda-cima para direita-baixo
     * 
     * Similar ao diagonal-right, desenhamos múltiplas linhas paralelas espaçadas
     * uniformemente. Adicionamos sobreposição nas bordas para garantir continuidade.
     */
    drawDiagonalLeft(ctx, size, lineWidth) {
        ctx.beginPath();
        
        // spacing real é size/2
        const spacing = size / 2;
        
        // Sobreposição pequena para evitar gaps entre tiles (1-2 pixels)
        const overlap = 2;
        
        // Desenha linhas diagonais "\" que atravessam o tile  
        // Estendemos ligeiramente as linhas além dos limites para garantir sobreposição
        for (let offset = -size; offset <= size * 2; offset += spacing) {
            // Cada linha vai de cima-esquerda para baixo-direita com inclinação de 45°
            // Estendemos a linha um pouco além dos limites do tile
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