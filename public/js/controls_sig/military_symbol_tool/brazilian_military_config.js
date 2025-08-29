// Path: js\controls_sig\military_symbol_tool\brazilian_military_config.js

/**
 * Mapeamentos específicos do padrão brasileiro para símbolos militares
 * Mapeia códigos de mainIcon para abreviações brasileiras com tamanho de fonte
 */
export const BRAZILIAN_LABEL_MAPPINGS = {
    '121700': {
        from: ['SF'],  // Possíveis textos americanos
        to: 'Cmdos',                    // Texto brasileiro
        fontSize: '26'                  // Tamanho da fonte menor para "Cmdos"
    },
    '121800': {
        from: ['SOF'],  // Possíveis textos americanos  
        to: 'FE',                       // Texto brasileiro
    }
};

/**
 * Processa o SVG gerado pelo milsymbol aplicando as traduções brasileiras
 * @param {string} svgString - SVG original gerado pelo milsymbol
 * @param {string} mainIcon - Código do mainIcon (6 dígitos)
 * @returns {string} SVG modificado com labels brasileiros
 */
export function applyBrazilianLabelsToSVG(svgString, mainIcon) {
    if (!svgString || !mainIcon) {
        return svgString;
    }

    // Verificar se temos mapeamento para este mainIcon
    const mapping = BRAZILIAN_LABEL_MAPPINGS[mainIcon];
    if (!mapping) {
        return svgString;
    }

    let modifiedSVG = svgString;

    // Processar cada texto americano que deve ser substituído
    mapping.from.forEach(americanText => {
        
        // Regex para encontrar elementos <text> que contêm o texto americano
        // Captura: tag de abertura, conteúdo, tag de fechamento
        const textElementRegex = new RegExp(
            `(<text[^>]*>)([^<]*?)${americanText}([^<]*?)(<\\/text>)`, 
            'gi'
        );
        
        // Substituir o texto mantendo outros conteúdos do elemento
        modifiedSVG = modifiedSVG.replace(textElementRegex, (match, openTag, beforeText, afterText, closeTag) => {
            // Atualizar o texto
            const newContent = beforeText + mapping.to + afterText;
            
            // Modificar o font-size na tag de abertura
            let newOpenTag = openTag;
            
            if(mapping.fontSize){
                if (openTag.includes('font-size=')) {
                    // Substituir font-size existente
                    newOpenTag = openTag.replace(/font-size="[^"]*"/, `font-size="${mapping.fontSize}"`);
                } else {
                    // Adicionar font-size se não existir
                    newOpenTag = openTag.replace('>', ` font-size="${mapping.fontSize}">`);
                }
            }

            
            return newOpenTag + newContent + closeTag;
        });
    });

    return modifiedSVG;
}

/**
 * Obtém o label brasileiro para um mainIcon específico
 */
export function getBrazilianLabel(mainIcon) {
    const mapping = BRAZILIAN_LABEL_MAPPINGS[mainIcon];
    return mapping ? mapping.to : null;
}

/**
 * Verifica se um mainIcon possui tradução brasileira
 */
export function hasBrazilianLabel(mainIcon) {
    return mainIcon in BRAZILIAN_LABEL_MAPPINGS;
}

/**
 * Obtém o tamanho de fonte brasileiro para um mainIcon específico
 */
export function getBrazilianFontSize(mainIcon) {
    const mapping = BRAZILIAN_LABEL_MAPPINGS[mainIcon];
    return mapping ? mapping.fontSize : null;
}

/**
 * Obtém todos os textos americanos que devem ser substituídos para um mainIcon
 */
export function getAmericanLabels(mainIcon) {
    const mapping = BRAZILIAN_LABEL_MAPPINGS[mainIcon];
    return mapping ? mapping.from : [];
}