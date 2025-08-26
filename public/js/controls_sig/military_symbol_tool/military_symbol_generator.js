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

    parseSIDC(sidc) {
        // Validate first
        const validation = this.validateSIDC(sidc);
        if (!validation.valid) {
            throw new Error(`Invalid SIDC: ${validation.error}`);
        }

        // Extract each component according to MIL-STD-2525D structure
        const properties = {
            formatId: sidc.substring(0, 2),        // A: positions 1-2
            context: sidc.substring(2, 3),         // B: position 3
            standardIdentity: sidc.substring(3, 4), // C: position 4
            symbolSet: sidc.substring(4, 6),       // D: positions 5-6
            status: sidc.substring(6, 7),          // E: position 7
            hqTfDummy: sidc.substring(7, 8),       // F: position 8
            echelon: sidc.substring(8, 10),        // G: positions 9-10
            mainIcon: sidc.substring(10, 16),      // H: positions 11-16
            modifier1: sidc.substring(16, 18),     // I: positions 17-18
            modifier2: sidc.substring(18, 20)      // J: positions 19-20
        };

        return properties;
    }

    canParseSIDC(sidc) {
        try {
            const validation = this.validateSIDC(sidc);
            if (!validation.valid) {
                return { canParse: false, error: validation.error };
            }

            // Additional check: ensure we can extract meaningful properties
            const parsed = this.parseSIDC(sidc);
            
            // Verify core components are present
            if (!parsed.context || !parsed.standardIdentity || !parsed.echelon || !parsed.mainIcon) {
                return { canParse: false, error: 'SIDC missing required components' };
            }

            return { canParse: true, properties: parsed };
        } catch (error) {
            return { canParse: false, error: error.message };
        }
    }

    // Converter qualquer imagem (SVG/PNG/etc) para PNG blob usando canvas
    async convertToPngBlob(dataURL, targetSize = DEFAULT_SIZE) {
        return new Promise((resolve, reject) => {
            const img = new Image();

            img.onload = () => {
                try {
                    // 1. Obter dimensões originais da imagem
                    const originalWidth = img.naturalWidth || img.width;
                    const originalHeight = img.naturalHeight || img.height;

                    // 2. Calcular aspect ratio
                    const aspectRatio = originalWidth / originalHeight;

                    // 3. Calcular novas dimensões mantendo proporção
                    let newWidth, newHeight;
                    if (aspectRatio >= 1) {
                        // Imagem mais larga que alta (landscape ou quadrada)
                        newWidth = targetSize;
                        newHeight = Math.round(targetSize / aspectRatio);
                    } else {
                        // Imagem mais alta que larga (portrait)
                        newHeight = targetSize;
                        newWidth = Math.round(targetSize * aspectRatio);
                    }

                    // 4. Criar canvas com dimensões do targetSize (quadrado para padding)
                    const canvas = document.createElement('canvas');
                    canvas.width = targetSize;
                    canvas.height = targetSize;
                    const ctx = canvas.getContext('2d');

                    // 5. Limpar fundo (transparente)
                    ctx.clearRect(0, 0, targetSize, targetSize);

                    // 6. Calcular posição para centralizar a imagem
                    const offsetX = Math.round((targetSize - newWidth) / 2);
                    const offsetY = Math.round((targetSize - newHeight) / 2);

                    // 7. Desenhar a imagem centralizada e com proporção correta
                    ctx.drawImage(img, offsetX, offsetY, newWidth, newHeight);

                    // 8. Converter canvas para PNG blob
                    canvas.toBlob((blob) => {
                        if (blob) {
                            resolve(blob);
                        } else {
                            reject(new Error('Falha ao converter para PNG blob'));
                        }
                    }, 'image/png', 1.0);

                } catch (error) {
                    reject(error);
                }
            };

            img.onerror = () => {
                reject(new Error('Falha ao carregar imagem para conversão PNG'));
            };

            // Carregar a imagem do data URL
            img.src = dataURL;
        });
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

            // Obter data URL do símbolo (pode ser SVG ou PNG)
            const dataURL = symbol.toDataURL();

            // FORÇAR conversão para PNG usando canvas
            const pngBlob = await this.convertToPngBlob(dataURL, DEFAULT_SIZE);

            // Adicionar ao cache
            this.symbolCache.set(cacheKey, pngBlob);
            return pngBlob;

        } catch (error) {
            console.error('Erro ao gerar símbolo:', error);
            throw error;
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

    // Gerar preview para UI (reutiliza a lógica de conversão PNG)
    async generatePreviewDataURL(sidc, size = 80) {
        try {
            const symbol = new ms.Symbol(sidc, {
                size: size,
                frame: true,
                fill: true,
                strokeWidth: 2,
                colorMode: 'Light'
            });

            if (!symbol || symbol.isValid === false) {
                console.warn('milsymbol.js returned invalid symbol for SIDC:', sidc);
                return null;
            }

            // Obter data URL original
            const originalDataURL = symbol.toDataURL();

            // Converter para PNG e depois para data URL
            const pngBlob = await this.convertToPngBlob(originalDataURL, size);

            // Converter blob para data URL
            return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.readAsDataURL(pngBlob);
            });

        } catch (error) {
            console.error('Erro ao gerar preview:', error);
            return null;
        }
    }

    clearCache() {
        this.symbolCache.clear();
    }
}