// Path: js/military_tools/military_symbol_tool/data/index.js

/**
 * @fileoverview The eleven symbol-set tables (main icon / modifier 1 / modifier 2
 * option lists), the payload that feeds the symbol selector comboboxes.
 *
 * This barrel is the ONLY place that statically imports the tables, and it exists
 * so the whole block can be pulled in with a single dynamic `import()` from
 * `symbol_sets.registry.js`. Nothing on the symbol GENERATION path (SIDC build,
 * milsymbol render, Brazilian SVG post-processing) reads these tables: the map
 * draws symbols of an already-saved project without ever loading this module.
 * Importing it statically from anywhere else would put ~215 kB back into the
 * eager `military-tools` chunk, which is exactly what the split removed.
 *
 * Entries are keyed by the COMPOSITE (code, extension) pair: the same `code` can
 * repeat inside one table and only `extension` tells the entries apart (e.g.
 * `111299` occurs twelve times in `instalacoes.js`). Never de-duplicate by `code`.
 */

import aeronaves from './aeronaves.js';
import misseis from './misseis.js';
import espaciais from './espaciais.js';
import landUnitsData from './unidades.js';
import equipamentosViaturas from './equipamentos_viaturas.js';
import instalacoes from './instalacoes.js';
import individuosDesembarcados from './individuos_desembarcados.js';
import maritimosSuperficie from './maritimos_superficie.js';
import submarinos from './submarinos.js';
import guerraMinas from './guerra_minas.js';
import atividadesEventos from './atividades_eventos.js';

/**
 * Maps symbol set code to its table.
 * @type {Object<string, Object>}
 */
export const SYMBOL_SET_TABLES = {
    '01': aeronaves.symbol_sets[0],
    '02': misseis.symbol_sets[0],
    '05': espaciais.symbol_sets[0],
    '10': landUnitsData.symbol_sets[0],
    '15': equipamentosViaturas.symbol_sets[0],
    '20': instalacoes.symbol_sets[0],
    '27': individuosDesembarcados.symbol_sets[0],
    '30': maritimosSuperficie.symbol_sets[0],
    '35': submarinos.symbol_sets[0],
    '36': guerraMinas.symbol_sets[0],
    '40': atividadesEventos.symbol_sets[0]
};
