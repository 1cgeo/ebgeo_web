// Path: js\controls_sig\military_symbol_tool\military_symbol_generator.js

export class MilitarySymbolGenerator {
    constructor() {
        this.symbolCache = new Map();
    }

    // Aplicar lógica de tradução antes de construir SIDC
    translateProperties(properties) {
        let finalFunctionId = properties.mainIcon;
        let finalModifier2 = properties.modifier2 || "00";

        // Regra: modificador transversal troca o ID da função
        if (properties.modifierTransversal === 'mechanized' || properties.modifierTransversal === 'armored') {
            if (properties.mainIcon === '121100') { // Infantaria → Infantaria Mecanizada
                finalFunctionId = '121103';
            } else if (properties.mainIcon === '120500') { // Cavalaria → Cavalaria Mecanizada
                finalFunctionId = '120501';
            } else if (properties.mainIcon === '130000') { // Engenharia → Engenharia Mecanizada
                finalFunctionId = '130002';
            } else if (properties.mainIcon === '100300') { // Artilharia → Artilharia Autopropulsada
                finalFunctionId = '100301';
            }
        } else if (properties.modifierTransversal === 'motorized') {
            finalModifier2 = '12'; // Define modificador para motorizado
        }

        // Regra: modifier1 pode trocar função ou modificador
        if (properties.modifier1 === 'ranger') {
            finalFunctionId = '110400'; // Troca para Ações de Comandos
        } else if (properties.modifier1 === 'airmobile') {
            finalModifier2 = '09'; // Define modificador para aeromóvel
        } else if (properties.modifier1 === 'ew') {
            finalModifier2 = '11'; // Define modificador para guerra eletrônica
        }

        return {
            ...properties,
            mainIcon: finalFunctionId,
            modifier2: finalModifier2
        };
    }

    buildSIDC(properties) {
        // Aplicar tradução primeiro
        const translatedProps = this.translateProperties(properties);
        
        // Construir SIDC de 20 dígitos conforme padrão militar
        const symbolSet = translatedProps.dimension || "10";           // Pos 1-2
        const affiliation = translatedProps.affiliation || "03";       // Pos 3-4 (Amigo como padrão)
        const battleDimension = "10";                                  // Pos 5-6 (fixo para terrestres)
        const status = "00";                                           // Pos 7-8 (presente/atual)
        const hq = "00";                                               // Pos 9-10 (não é QG)
        const echelon = translatedProps.echelon || "16";               // Pos 11-12
        const functionId = translatedProps.mainIcon || "121100";       // Pos 13-18
        const modifier = translatedProps.modifier2 || "00";           // Pos 19-20
        
        return `${symbolSet}${affiliation}${battleDimension}${status}${hq}${echelon}${functionId}${modifier}`;
    }

    // Gerar blob da imagem (análogo ao image control)
    async generateSymbolBlob(properties) {
        const sidc = properties.sidc;
        const size = properties.size;
        
        // Cache baseado no SIDC e tamanho
        const cacheKey = `${sidc}-${size}`;
        if (this.symbolCache.has(cacheKey)) {
            return this.symbolCache.get(cacheKey);
        }

        try {
            // Gerar símbolo usando milsymbol.js
            const symbol = new ms.Symbol(sidc, {
                size: size,
                frame: true,
                fill: true,
                strokeWidth: 3
            });

            // Converter para blob (igual ao image control)
            const dataURL = symbol.toDataURL();
            const response = await fetch(dataURL);
            const blob = await response.blob();
            
            // Adicionar ao cache
            this.symbolCache.set(cacheKey, blob);
            return blob;

        } catch (error) {
            console.error('Erro ao gerar símbolo:', error);
            return this.generateDefaultSymbolBlob(size);
        }
    }

    async generateDefaultSymbolBlob(size) {
        // Gerar símbolo padrão em caso de erro
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        
        ctx.fillStyle = '#0066cc';
        ctx.fillRect(0, 0, size, size);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.strokeRect(0, 0, size, size);
        
        // Converter para blob
        return new Promise((resolve) => {
            canvas.toBlob((blob) => {
                resolve(blob);
            });
        });
    }

    clearCache() {
        this.symbolCache.clear();
    }
}