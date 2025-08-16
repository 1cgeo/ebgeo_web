// Path: js\controls_sig\military_symbol_tool\military_symbol_generator.js

import { ECHELON_MAPPING } from './military_constants.js';

export class MilitarySymbolGenerator {
    constructor() {
        this.symbolCache = new Map(); // Cache para símbolos gerados
    }

    buildSIDC(properties) {
        return properties.version + 
               properties.affiliation + 
               properties.dimension + 
               properties.status + 
               properties.mainIcon.padStart(6, '0') + 
               properties.modifier1.padStart(2, '0') + 
               properties.modifier2.padStart(2, '0') + 
               "00";
    }

    mapEchelonToMilsymbol(echelon) {
        return ECHELON_MAPPING[echelon] || '15';
    }

    async generateSymbolImage(properties) {
        const sidc = properties.sidc;
        
        // Verificar cache
        const cacheKey = `${sidc}-${properties.size}-${properties.echelon}`;
        if (this.symbolCache.has(cacheKey)) {
            return this.symbolCache.get(cacheKey);
        }

        try {
            // Usar milsymbol para gerar o símbolo
            const symbol = new ms.Symbol(sidc, {
                size: properties.size,
                frame: true,
                fill: true,
                strokeWidth: 3,
                uniqueDesignation: "", // Pode ser usado para numeração
                higherFormation: "", // Formação superior
                echelon: this.mapEchelonToMilsymbol(properties.echelon)
            });

            // Converter para ImageData
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const img = new Image();
            
            return new Promise((resolve, reject) => {
                img.onload = () => {
                    canvas.width = img.width;
                    canvas.height = img.height;
                    ctx.drawImage(img, 0, 0);
                    
                    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    const result = {
                        data: imageData.data,
                        width: canvas.width,
                        height: canvas.height
                    };
                    
                    // Adicionar ao cache
                    this.symbolCache.set(cacheKey, result);
                    resolve(result);
                };
                
                img.onerror = reject;
                img.src = symbol.toDataURL();
            });

        } catch (error) {
            console.error('Erro ao gerar símbolo:', error);
            // Retornar imagem padrão em caso de erro
            return this.generateDefaultSymbol(properties.size);
        }
    }

    generateDefaultSymbol(size) {
        // Gerar símbolo padrão simples em caso de erro
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        
        // Desenhar quadrado simples
        ctx.fillStyle = '#0066cc';
        ctx.fillRect(0, 0, size, size);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.strokeRect(0, 0, size, size);
        
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        return {
            data: imageData.data,
            width: canvas.width,
            height: canvas.height
        };
    }

    clearCache() {
        this.symbolCache.clear();
    }

    getCacheSize() {
        return this.symbolCache.size;
    }
}