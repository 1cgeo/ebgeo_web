// Path: js\controls_sig\military_symbol_tool\military_symbol_generator.js

const DEFAULT_SIZE = 100;

export class MilitarySymbolGenerator {
    constructor() {
        this.symbolCache = new Map();
    }

    buildSIDC(properties) {
        // Construir SIDC de 20 dígitos conforme padrão MIL-STD-2525D
        // Estrutura: A-B-C-D-E-F-G-H-I-J = 10-0-3-10-0-0-16-121100-00-00
        
        const formatId = "10";                                              // A: 2 dígitos (sempre "10")
        const context = properties.context || "0";                         // B: 1 dígito (0=realidade)
        const standardIdentity = properties.standardIdentity || "3";       // C: 1 dígito (3=amigo)
        const symbolSet = "10";                                            // D: 2 dígitos (sempre "10"=terrestre)
        const status = properties.status || "0";                          // E: 1 dígito (0=presente)
        const hqTfDummy = properties.hqTfDummy || "0";                     // F: 1 dígito (0=não aplicável)
        const echelon = properties.echelon || "16";                       // G: 2 dígitos (16=batalhão)
        const mainIcon = properties.mainIcon || "121100";                 // H: 6 dígitos (121100=infantaria)
        const modifier1 = properties.modifier1 || "00";                   // I: 2 dígitos
        const modifier2 = properties.modifier2 || "00";                   // J: 2 dígitos
        
        const sidc = `${formatId}${context}${standardIdentity}${symbolSet}${status}${hqTfDummy}${echelon}${mainIcon}${modifier1}${modifier2}`;
        
        return sidc;
    }

    // Gerar blob da imagem
    async generateSymbolBlob(properties) {
        const sidc = properties.sidc;
        
        // Cache baseado apenas no SIDC
        const cacheKey = `${sidc}`;
        if (this.symbolCache.has(cacheKey)) {
            return this.symbolCache.get(cacheKey);
        }

        try {
            const validation = this.validateSIDC(sidc);
            if (!validation.valid) {
                console.error('Invalid SIDC:', validation.error);
            }

            // Gerar símbolo sempre com tamanho fixo
            const symbol = new ms.Symbol(sidc, {
                size: DEFAULT_SIZE * 0.5,
                frame: true,
                fill: true,
                strokeWidth: 3,
                colorMode: 'Light'
            });

            // Verificar se o símbolo foi gerado com sucesso
            if (!symbol || symbol.isValid === false) {
                console.warn('milsymbol.js returned invalid symbol for SIDC:', sidc);
            }

            // Converter para blob
            const dataURL = symbol.toDataURL();
            const response = await fetch(dataURL);
            const blob = await response.blob();
            
            // Adicionar ao cache
            this.symbolCache.set(cacheKey, blob);
            return blob;

        } catch (error) {
            console.error('Erro ao gerar símbolo:', error);
        }
    }

    // Validar SIDC
    validateSIDC(sidc) {
        if (!sidc || sidc.length !== 20) {
            return { valid: false, error: `SIDC deve ter 20 dígitos, tem ${sidc?.length || 0}` };
        }

        // Verificar se todos os caracteres são válidos (números)
        if (!/^[0-9]{20}$/.test(sidc)) {
            return { valid: false, error: 'SIDC deve conter apenas números' };
        }

        // Validar estrutura específica
        const formatId = sidc.substring(0, 2);
        if (formatId !== "10") {
            return { valid: false, error: `Format ID deve ser "10", recebido "${formatId}"` };
        }

        return { valid: true };
    }

    clearCache() {
        this.symbolCache.clear();
    }
}