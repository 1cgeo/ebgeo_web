// Path: js/military_tools/engineering_symbol_tool/engineering_attributes_panel.js
import { addCoordinationMeasureAttributesToPanel } from '../coordination_measure_tool/attributes/coordination_measure_attributes_panel.js';
import { EngineeringSelectorModal } from './engineering_selector.js';

/** The same appearance controls as coordination measures, with a dedicated symbol editor. */
export function addEngineeringSymbolAttributesToPanel(panel, features, control, selectionManager, uiManager, options = {}) {
    addCoordinationMeasureAttributesToPanel(panel, features, control, selectionManager, uiManager, {
        ...options,
        configureSymbol: config => new EngineeringSelectorModal({ ...config, control }).show()
    });
}
