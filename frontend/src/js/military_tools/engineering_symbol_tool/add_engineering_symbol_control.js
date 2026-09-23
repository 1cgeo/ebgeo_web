// Path: js/military_tools/engineering_symbol_tool/add_engineering_symbol_control.js
import { getGeoJsonDispatcher } from '@layers/geojson-dispatcher.js';
import AddCoordinationMeasureControl from '../coordination_measure_tool/add_coordination_measure_control.js';
import AddEngineeringSymbolGeometry from './add_engineering_symbol_geometry.js';
import { EngineeringSymbolGenerator, engineeringDraft } from './engineering_generator.js';
import { addEngineeringSymbolAttributesToPanel } from './engineering_attributes_panel.js';

/** Reuses the measure lifecycle: selection, drag, zoom, clipboard and peer regeneration. */
export default class AddEngineeringSymbolControl extends AddCoordinationMeasureControl {
    featureType = 'engineering_symbol';
    storageType = 'engineering_symbols';
    symbolLayerId = 'engineering-symbols-layer';

    static DEFAULT_PROPERTIES = {
        pointCode: '9', engineering: engineeringDraft('9'),
        size: 1, width: 100, height: 100, pixelRatio: 1, opacity: 1, rotation: 0,
        fillColor: null, createdAtZoom: 0, calculatedSize: 1, zoomCorrectionEnabled: true,
        selectionBox: null, source: 'engineering_symbol', nome: '', descricao: '', visivel: true, bloqueado: false
    };

    constructor(toolManager) {
        super(toolManager);
        this._name = 'AddEngineeringSymbolControl';
        this.geometry = new AddEngineeringSymbolGeometry();
        this.symbolGenerator = new EngineeringSymbolGenerator();
    }

    getSourceDispatcher() { return getGeoJsonDispatcher(this.map, 'engineering_symbols'); }

    createAttributePanel(container, features, selectionManager, uiManager, options = {}) {
        addEngineeringSymbolAttributesToPanel(container, features, this, selectionManager, uiManager, options);
    }

    hasFeatureChanged = (feature, initial) => !initial || Object.keys(feature.properties).some(key =>
        JSON.stringify(feature.properties[key]) !== JSON.stringify(initial[key]));

    setDefaultProperties = properties => {
        for (const key of ['pointCode', 'size', 'opacity', 'rotation', 'fillColor', 'zoomCorrectionEnabled']) {
            this.constructor.DEFAULT_PROPERTIES[key] = properties[key];
        }
        this.constructor.DEFAULT_PROPERTIES.engineering = structuredClone(properties.engineering);
    };

    discardChangeFeatures = async (features, initialPropertiesMap) => {
        this.cancelPendingSymbolUpdates();
        for (const feature of features) {
            feature.properties = structuredClone(initialPropertiesMap.get(feature.properties.id));
            await this.updateFeatures([feature], false, true);
            await this.updateSymbolImage(feature);
        }
    };
}
