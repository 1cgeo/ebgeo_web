// Path: js/military_tools/engineering_symbol_tool/add_engineering_symbol_geometry.js
import AddCoordinationMeasureGeometry from '../coordination_measure_tool/add_coordination_measure_geometry.js';

/** Point geometry and zoom/selection behavior shared with coordination measures. */
export default class AddEngineeringSymbolGeometry extends AddCoordinationMeasureGeometry {
    affectsSIDC(property) { return property === 'pointCode'; }
    affectsTextModifiers(property) { return property === 'engineering' || property === 'fillColor'; }
}
