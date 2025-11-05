// Path: js\controls_sig\military_symbol_tool\text_modifiers_catalog.js

/**
 * Text Modifiers Catalog
 * Defines text amplifiers (amplificadores textuais) for each symbol set dimension
 * Based on MD33-M-02 Brazilian military symbology standard
 * 
 * Implemented dimensions:
 * - 02: Missiles (Mísseis)
 * - 10: Land Units (Unidades)
 * - 15: Equipment and Vehicles (Equipamentos e Viaturas)
 * - 20: Aerospace - Aircraft (Aeronaves)
 * - 25: Space (Espaciais)
 * - 27: Dismounted Individuals (Indivíduos Desembarcados)
 * - 30: Sea Surface (Marítimos de Superfície)
 * - 35: Subsurface (Submarinos)
 * - 36: Mine Warfare (Guerra de Minas)
 * - 40: Installations (Instalações)
 * - 60: Activities and Events (Atividades e Eventos)
 */

/**
 * Catálogo de amplificadores textuais por dimensão
 * Mapeamento conforme MD33-M-02 e milsymbol.js
 */
export const TEXT_MODIFIERS_CATALOG = {
    '02': { // SÍMBOLOS DE MÍSSEIS
        label: 'Mísseis',
        fields: [
            {
                id: 'uniqueDesignation',
                label: 'Designação',
                code: 'C',
                placeholder: 'Ex: MSL-001',
                tooltip: 'Identifica unicamente o míssil'
            },
            {
                id: 'type',
                label: 'Tipo de Equipamento',
                code: 'V',
                placeholder: 'Ex: AV-TM 300',
                tooltip: 'Modelo do míssil'
            },
            {
                id: 'additionalInformation',
                label: 'Informações Adicionais',
                code: 'H',
                placeholder: 'Ex: Cruzeiro',
                tooltip: 'Informações úteis imediatamente necessárias'
            },
            {
                id: 'iffSif',
                label: 'Código IFF',
                code: 'P',
                placeholder: 'Ex: 4523',
                tooltip: 'Identification Friend or Foe'
            },
            {
                id: 'altitudeDepth',
                label: 'Altitude',
                code: 'X',
                placeholder: 'Ex: 15000 m',
                tooltip: 'Altitude com unidade de medida (m, km, ft)'
            },
            {
                id: 'speed',
                label: 'Velocidade',
                code: 'Z',
                placeholder: 'Ex: Mach 0.8',
                tooltip: 'Velocidade com unidade (Mach, km/h, m/s)'
            }
        ]
    },
    '10': { // SÍMBOLOS TERRESTRES - UNIDADES
        label: 'Unidades',
        fields: [
            {
                id: 'uniqueDesignation',
                label: 'Designação',
                code: 'C',
                placeholder: 'Ex: 1ª Bda Inf Sl',
                tooltip: 'Identifica unicamente a unidade'
            },
            {
                id: 'higherFormation',
                label: 'Subordinação',
                code: 'B',
                placeholder: 'Ex: 1ª DE',
                tooltip: 'Designação do escalão enquadrante'
            },
            {
                id: 'reinforcedReduced',
                label: 'Reforço/Redução',
                code: 'F',
                placeholder: 'Ex: + ou -',
                tooltip: 'Indica se reforçada (+) ou reduzida (-)'
            },
            {
                id: 'additionalInformation',
                label: 'Informações Adicionais',
                code: 'H',
                placeholder: 'Ex: Op Amazônia',
                tooltip: 'Informações úteis imediatamente necessárias'
            },
            {
                id: 'credibility',
                label: 'Credibilidade/Confiabilidade',
                code: 'J+K',
                placeholder: 'Ex: A1, B3, F6',
                tooltip: 'Idoneidade da fonte (A-F) + Veracidade (1-6). Exemplo: A1',
                label: 'Credibilidade',
                code: 'J',
                placeholder: 'Ex: A, B, C, D, E, F',
                tooltip: 'Código alfanumérico de idoneidade e veracidade da fonte (A-F e 1-6 conforme EB70-MT-10.401)'
            },
            {
                id: 'location',
                label: 'Localização',
                code: 'Y',
                placeholder: 'Ex: 22S 234567 8765432',
                tooltip: 'Localização geográfica (lat/long ou UTM)'
            },
            {
                id: 'dateTimeGroup',
                label: 'GDH',
                code: 'W',
                placeholder: 'Ex: 201400NOV24',
                tooltip: 'Grupo data-hora de localização'
            },
            {
                id: 'altitudeDepth',
                label: 'Altitude',
                code: 'X',
                placeholder: 'Ex: 1500 m',
                tooltip: 'Altitude com unidade de medida (m, km)'
            },
            {
                id: 'speed',
                label: 'Velocidade',
                code: 'Z',
                placeholder: 'Ex: 15 km/h',
                tooltip: 'Velocidade com unidade (nós, km/h, m/s)'
            },
            {
                id: 'specialHeadquarters',
                label: 'Tipo de PC',
                code: 'AA',
                placeholder: 'Ex: PCP, PCR, PCT',
                tooltip: 'Tipo de posto de comando'
            }
        ]
    },
    '15': { // SÍMBOLOS TERRESTRES - EQUIPAMENTOS E VIATURAS
        label: 'Equipamentos e Viaturas',
        fields: [
            {
                id: 'uniqueDesignation',
                label: 'Designação',
                code: 'C',
                placeholder: 'Ex: VBR-01',
                tooltip: 'Identifica unicamente o elemento'
            },
            {
                id: 'higherFormation',
                label: 'Subordinação',
                code: 'B',
                placeholder: 'Ex: 1ª Bda Inf Sl',
                tooltip: 'Designação do escalão enquadrante'
            },
            {
                id: 'type',
                label: 'Tipo de Equipamento',
                code: 'V',
                placeholder: 'Ex: Guarani',
                tooltip: 'Modelo da viatura ou armamento'
            },
            {
                id: 'additionalInformation',
                label: 'Informações Adicionais',
                code: 'H',
                placeholder: 'Ex: Manutenção',
                tooltip: 'Informações úteis imediatamente necessárias'
            },
            {
                id: 'iffSif',
                label: 'Código IFF',
                code: 'P',
                placeholder: 'Ex: 4523',
                tooltip: 'Identification Friend or Foe'
            },
            {
                id: 'location',
                label: 'Localização',
                code: 'Y',
                placeholder: 'Ex: 22S 234567 8765432',
                tooltip: 'Localização geográfica (lat/long ou UTM)'
            },
            {
                id: 'dateTimeGroup',
                label: 'GDH',
                code: 'W',
                placeholder: 'Ex: 201400NOV24',
                tooltip: 'Grupo data-hora de localização'
            },
            {
                id: 'altitudeDepth',
                label: 'Altitude',
                code: 'X',
                placeholder: 'Ex: 1500 m',
                tooltip: 'Altitude com unidade de medida (m, km)'
            },
            {
                id: 'speed',
                label: 'Velocidade',
                code: 'Z',
                placeholder: 'Ex: 60 km/h',
                tooltip: 'Velocidade com unidade (nós, km/h, m/s)'
            },
            {
                id: 'equipmentTeardownTime',
                label: 'Tempo de Destruição',
                code: 'X1',
                placeholder: 'Ex: 152000NOV24',
                tooltip: 'GDH de destruição do equipamento'
            }
        ]
    },
    '20': { // SÍMBOLOS AEROESPACIAIS - AERONAVES
        label: 'Aeronaves',
        fields: [
            {
                id: 'uniqueDesignation',
                label: 'Designação',
                code: 'C',
                placeholder: 'Ex: F-39-001',
                tooltip: 'Identifica unicamente a aeronave'
            },
            {
                id: 'type',
                label: 'Tipo de Equipamento',
                code: 'V',
                placeholder: 'Ex: Gripen',
                tooltip: 'Modelo da aeronave ou armamento'
            },
            {
                id: 'additionalInformation',
                label: 'Informações Adicionais',
                code: 'H',
                placeholder: 'Ex: Patrulha Aérea',
                tooltip: 'Informações úteis imediatamente necessárias'
            },
            {
                id: 'iffSif',
                label: 'Código IFF',
                code: 'P',
                placeholder: 'Ex: 4523',
                tooltip: 'Identification Friend or Foe'
            },
            {
                id: 'altitudeDepth',
                label: 'Altitude',
                code: 'X',
                placeholder: 'Ex: 35000 ft',
                tooltip: 'Altitude com unidade (pés, m, km)'
            },
            {
                id: 'speed',
                label: 'Velocidade',
                code: 'Z',
                placeholder: 'Ex: 450 kts',
                tooltip: 'Velocidade com unidade (nós, km/h, m/s)'
            }
        ]
    },
    '25': { // SÍMBOLOS ESPACIAIS
        label: 'Espaciais',
        fields: [
            {
                id: 'uniqueDesignation',
                label: 'Designação',
                code: 'C',
                placeholder: 'Ex: SAT-BR-01',
                tooltip: 'Identifica unicamente o elemento'
            },
            {
                id: 'type',
                label: 'Tipo de Equipamento',
                code: 'V',
                placeholder: 'Ex: SGDC-1',
                tooltip: 'Modelo de satélite ou sensor'
            },
            {
                id: 'additionalInformation',
                label: 'Informações Adicionais',
                code: 'H',
                placeholder: 'Ex: Órbita Geoestacionária',
                tooltip: 'Informações úteis imediatamente necessárias'
            },
            {
                id: 'altitudeDepth',
                label: 'Altitude',
                code: 'X',
                placeholder: 'Ex: 36000 km',
                tooltip: 'Altitude com unidade (pés, m, km)'
            }
        ]
    },
    '27': { // SÍMBOLOS DE INDIVÍDUOS DESEMBARCADOS
        label: 'Indivíduos Desembarcados',
        fields: [
            {
                id: 'uniqueDesignation',
                label: 'Designação',
                code: 'C',
                placeholder: 'Ex: EQUIPE-1',
                tooltip: 'Identifica unicamente o elemento'
            },
            {
                id: 'higherFormation',
                label: 'Subordinação',
                code: 'B',
                placeholder: 'Ex: 1º Pel Fuz',
                tooltip: 'Designação do escalão enquadrante'
            },
            {
                id: 'quantity',
                label: 'Quantidade',
                code: 'C1',
                placeholder: 'Ex: 4',
                tooltip: 'Indica grupo de indivíduos'
            },
            {
                id: 'type',
                label: 'Tipo de Equipamento',
                code: 'V',
                placeholder: 'Ex: Fuzil IA2',
                tooltip: 'Modelo do armamento empregado'
            },
            {
                id: 'additionalInformation',
                label: 'Informações Adicionais',
                code: 'H',
                placeholder: 'Ex: Reconhecimento',
                tooltip: 'Informações úteis imediatamente necessárias'
            },
            {
                id: 'iffSif',
                label: 'Código IFF',
                code: 'P',
                placeholder: 'Ex: 4523',
                tooltip: 'Identification Friend or Foe'
            },
            {
                id: 'credibility',
                label: 'Credibilidade/Confiabilidade',
                code: 'J+K',
                placeholder: 'Ex: A1, B3, F6',
                tooltip: 'Idoneidade da fonte (A-F) + Veracidade (1-6). Exemplo: A1',
                label: 'Credibilidade',
                code: 'J',
                placeholder: 'Ex: A, B, C, D, E, F',
                tooltip: 'Código alfanumérico de idoneidade da fonte (A-F conforme EB70-MT-10.401)'
            },
            {
                id: 'location',
                label: 'Localização',
                code: 'Y',
                placeholder: 'Ex: 22S 234567 8765432',
                tooltip: 'Localização geográfica (lat/long ou UTM)'
            },
            {
                id: 'dateTimeGroup',
                label: 'GDH',
                code: 'W',
                placeholder: 'Ex: 201400NOV24',
                tooltip: 'Grupo data-hora de localização'
            },
            {
                id: 'altitudeDepth',
                label: 'Altitude',
                code: 'X',
                placeholder: 'Ex: 1500 m',
                tooltip: 'Altitude com unidade de medida (m, km)'
            },
            {
                id: 'speed',
                label: 'Velocidade',
                code: 'Z',
                placeholder: 'Ex: 5 km/h',
                tooltip: 'Velocidade com unidade (nós, km/h, m/s)'
            }
        ]
    },
    '30': { // SÍMBOLOS MARÍTIMOS DE SUPERFÍCIE
        label: 'Marítimos de Superfície',
        fields: [
            {
                id: 'uniqueDesignation',
                label: 'Designação',
                code: 'C',
                placeholder: 'Ex: V-30',
                tooltip: 'Identifica unicamente uma embarcação'
            },
            {
                id: 'type',
                label: 'Identificação AIS',
                code: 'V',
                placeholder: 'Ex: 710012345',
                tooltip: 'Sistema Automatic Identification System'
            },
            {
                id: 'additionalInformation',
                label: 'Informações Adicionais',
                code: 'H',
                placeholder: 'Ex: Patrulha Costeira',
                tooltip: 'Informações úteis imediatamente necessárias'
            },
            {
                id: 'location',
                label: 'Localização',
                code: 'Y',
                placeholder: 'Ex: 23°S 043°W',
                tooltip: 'Localização geográfica (lat/long ou UTM)'
            },
            {
                id: 'speed',
                label: 'Velocidade',
                code: 'Z',
                placeholder: 'Ex: 18 nós',
                tooltip: 'Velocidade com unidade de medida (nós, km/h, m/s)'
            }
        ]
    },
    '35': { // SÍMBOLOS SUBMARINOS
        label: 'Submarinos',
        fields: [
            {
                id: 'uniqueDesignation',
                label: 'Designação',
                code: 'C',
                placeholder: 'Ex: S-40',
                tooltip: 'Identifica unicamente uma embarcação'
            },
            {
                id: 'type',
                label: 'Tipo de Equipamento',
                code: 'V',
                placeholder: 'Ex: Tupi Class',
                tooltip: 'Classe da embarcação ou tipo de armamento'
            },
            {
                id: 'additionalInformation',
                label: 'Informações Adicionais',
                code: 'H',
                placeholder: 'Ex: Patrulha',
                tooltip: 'Informações úteis imediatamente necessárias'
            },
            {
                id: 'altitudeDepth',
                label: 'Profundidade',
                code: 'X',
                placeholder: 'Ex: -150 m',
                tooltip: 'Profundidade com unidade (metros, pés)'
            }
        ]
    },
    '36': { // SÍMBOLOS DE GUERRA DE MINAS
        label: 'Guerra de Minas',
        fields: [
            {
                id: 'uniqueDesignation',
                label: 'Designação',
                code: 'C',
                placeholder: 'Ex: MINA-001',
                tooltip: 'Identifica unicamente a mina'
            },
            {
                id: 'type',
                label: 'Tipo de Equipamento',
                code: 'V',
                placeholder: 'Ex: Mina de Fundo',
                tooltip: 'Tipo de mina ou sistema'
            },
            {
                id: 'additionalInformation',
                label: 'Informações Adicionais',
                code: 'H',
                placeholder: 'Ex: Ativa',
                tooltip: 'Informações úteis imediatamente necessárias'
            },
            {
                id: 'altitudeDepth',
                label: 'Profundidade',
                code: 'X',
                placeholder: 'Ex: -50 m',
                tooltip: 'Profundidade com unidade (metros, pés)'
            }
        ]
    },
    '40': { // SÍMBOLOS DE INSTALAÇÕES
        label: 'Instalações',
        fields: [
            {
                id: 'uniqueDesignation',
                label: 'Designação',
                code: 'C',
                placeholder: 'Ex: HGuRJ',
                tooltip: 'Identifica unicamente a instalação'
            },
            {
                id: 'higherFormation',
                label: 'Subordinação',
                code: 'B',
                placeholder: 'Ex: CML',
                tooltip: 'Designação do escalão enquadrante'
            },
            {
                id: 'additionalInformation',
                label: 'Informações Adicionais',
                code: 'H',
                placeholder: 'Ex: Capacidade 500 leitos',
                tooltip: 'Informações úteis imediatamente necessárias'
            },
            {
                id: 'location',
                label: 'Localização',
                code: 'Y',
                placeholder: 'Ex: 22S 234567 8765432',
                tooltip: 'Localização geográfica (lat/long ou UTM)'
            },
            {
                id: 'dateTimeGroup',
                label: 'GDH',
                code: 'W',
                placeholder: 'Ex: 201400NOV24',
                tooltip: 'Grupo data-hora de localização'
            },
            {
                id: 'altitudeDepth',
                label: 'Altitude',
                code: 'X',
                placeholder: 'Ex: 850 m',
                tooltip: 'Altitude com unidade de medida (m, km)'
            }
        ]
    },
    '60': { // SÍMBOLOS DE ATIVIDADES E EVENTOS
        label: 'Atividades e Eventos',
        fields: [
            {
                id: 'additionalInformation',
                label: 'Informações Adicionais',
                code: 'H',
                placeholder: 'Ex: Ataque aéreo',
                tooltip: 'Informações úteis imediatamente necessárias'
            },
            {
                id: 'credibility',
                label: 'Credibilidade/Confiabilidade',
                code: 'J+K',
                placeholder: 'Ex: A1, B3, F6',
                tooltip: 'Idoneidade da fonte (A-F) + Veracidade (1-6). Exemplo: A1',
                label: 'Credibilidade',
                code: 'J',
                placeholder: 'Ex: A, B, C, D, E, F',
                tooltip: 'Código alfanumérico de idoneidade da fonte (A-F conforme EB70-MT-10.401)'
            },
            {
                id: 'location',
                label: 'Localização',
                code: 'Y',
                placeholder: 'Ex: 22S 234567 8765432',
                tooltip: 'Localização geográfica (lat/long ou UTM)'
            },
            {
                id: 'dateTimeGroup',
                label: 'GDH',
                code: 'W',
                placeholder: 'Ex: 201400NOV24',
                tooltip: 'Momento de ocorrência ou "Mdt O"'
            }
        ]
    }
};

/**
 * Get text modifiers configuration for a symbol set
 * @param {string} symbolSetCode - Symbol set code (e.g., "10", "15", "20", etc.)
 * @returns {Object|null} Configuration object with label and fields, or null if not found
 */
export function getTextModifiersConfig(symbolSetCode) {
    return TEXT_MODIFIERS_CATALOG[symbolSetCode] || null;
}

/**
 * Check if symbol set has text modifiers configured
 * @param {string} symbolSetCode - Symbol set code
 * @returns {boolean} True if has text modifiers
 */
export function hasTextModifiers(symbolSetCode) {
    return !!TEXT_MODIFIERS_CATALOG[symbolSetCode];
}

/**
 * Get all text modifier field IDs for a symbol set
 * Useful for validation and property extraction
 * @param {string} symbolSetCode - Symbol set code
 * @returns {Array<string>} Array of field IDs
 */
export function getTextModifierFieldIds(symbolSetCode) {
    const config = TEXT_MODIFIERS_CATALOG[symbolSetCode];
    return config ? config.fields.map(field => field.id) : [];
}

/**
 * Get all implemented symbol set codes
 * @returns {Array<string>} Array of symbol set codes
 */
export function getImplementedSymbolSets() {
    return Object.keys(TEXT_MODIFIERS_CATALOG);
}

/**
 * Get text modifier field by ID for a symbol set
 * @param {string} symbolSetCode - Symbol set code
 * @param {string} fieldId - Field ID to search for
 * @returns {Object|null} Field configuration or null if not found
 */
export function getTextModifierField(symbolSetCode, fieldId) {
    const config = TEXT_MODIFIERS_CATALOG[symbolSetCode];
    if (!config) return null;
    
    return config.fields.find(field => field.id === fieldId) || null;
}