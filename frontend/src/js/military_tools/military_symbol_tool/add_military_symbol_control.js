// Path: js/military_tools/military_symbol_tool/add_military_symbol_control.js

import { normalizeSIDC } from './brazilian_sidc_extension.js';
import {
  addFeature,
  updateFeature,
  removeFeature,
  storeImage,
  getActiveLayerIdSync
} from '@store';
import { MilitarySymbolGenerator } from './military_symbol_generator.js';
import { IDUtils, showError, loadImageToMap } from '@utils';
import { addMilitarySymbolAttributesToPanel } from './attributes/index.js';
import AddMilitarySymbolGeometry from './add_military_symbol_geometry.js';
import { BaseControl } from '@tools';
import {
    applyZoomCorrections as applyZoomCorrectionsUtil,
    syncZoomCorrectedProperty,
} from '@tools/helpers/zoom-correction.helpers.js';
import { reanchorOnMove } from '@js/temporal/trajectory-anchor.js';

/**
 * Properties that feed the SIDC builder.
 * Mirrors AddMilitarySymbolGeometry#affectsSIDC (pinned by
 * `tests/unit/military-symbol-tracked-props.test.js`).
 * @type {string[]}
 */
export const SIDC_PROPS = [
    'context', 'standardIdentity', 'status', 'hqTfDummy',
    'echelon', 'mainIcon', 'modifier1', 'modifier2',
    'mainIconExtension', 'modifier1Extension', 'modifier2Extension',
    'specialModifier', 'isCommand', 'symbolSet'
];

/**
 * Text amplifiers drawn onto the symbol image.
 * Mirrors AddMilitarySymbolGeometry#affectsTextModifiers (same test pins it).
 * @type {string[]}
 */
export const TEXT_MODIFIER_PROPS = [
    'uniqueDesignation', 'higherFormation', 'quantity', 'reinforcedReduced',
    'additionalInformation', 'credibility', 'type', 'iffSif', 'dateTimeGroup',
    'altitudeDepth', 'equipmentTeardownTime', 'location', 'speed',
    'specialHeadquarters', 'direction', 'engagementBar'
];

/**
 * Style and identity properties worth persisting.
 * Render-derived values (calculatedSize, selectionBox, width, height) are left out
 * on purpose: they change on every zoom and would make the save gate fire forever.
 * @type {string[]}
 */
export const STYLE_PROPS = [
    'sidc', 'size', 'opacity', 'rotation', 'fillColor', 'createdAtZoom',
    'zoomCorrectionEnabled', 'nome', 'descricao', 'visivel', 'bloqueado'
];

/**
 * Every property whose change must reach the store.
 * @type {string[]}
 */
export const TRACKED_PROPS = [...SIDC_PROPS, ...TEXT_MODIFIER_PROPS, ...STYLE_PROPS];

/**
 * Properties copied by "Definir como padrão".
 * White list on purpose: a black list silently adopts every property added later,
 * which is how trajectory/temporal/lock state leaked into brand-new symbols.
 * @type {string[]}
 */
export const DEFAULTABLE_KEYS = [
    'context', 'standardIdentity', 'symbolSet', 'status', 'hqTfDummy',
    'echelon', 'specialModifier', 'isCommand', 'mainIcon', 'modifier1', 'modifier2',
    'mainIconExtension', 'modifier1Extension', 'modifier2Extension',
    'size', 'opacity', 'rotation', 'fillColor', 'zoomCorrectionEnabled'
];

/**
 * Builds the patch applied to DEFAULT_PROPERTIES from a source feature's properties.
 * Pure: takes and returns plain objects.
 * @param {Object} properties - Source feature properties
 * @param {string[]} [keys=DEFAULTABLE_KEYS] - Keys allowed into the patch
 * @returns {Object} Patch with only the allowed keys present in `properties`
 */
export function buildDefaultSymbolPatch(properties, keys = DEFAULTABLE_KEYS) {
    const patch = {};
    if (!properties) return patch;

    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(properties, key)) {
            patch[key] = properties[key];
        }
    }
    return patch;
}

/**
 * Compares the tracked properties of a feature against its initial snapshot.
 * Pure. `null`, `undefined` and `''` are treated as the same empty value, because
 * the modal writes `''` where the feature was created with `null` — without that
 * every Apply would persist an unchanged symbol.
 * @param {Object} properties - Current feature properties
 * @param {Object} initialProperties - Snapshot taken when the feature was selected
 * @param {string[]} [keys=TRACKED_PROPS] - Keys to compare
 * @returns {boolean} True when at least one tracked property changed
 */
export function hasTrackedPropsChanged(properties, initialProperties, keys = TRACKED_PROPS) {
    if (!initialProperties) return true;

    const current = properties || {};
    return keys.some((key) => (current[key] ?? '') !== (initialProperties[key] ?? ''));
}

class AddMilitarySymbolControl extends BaseControl {
    featureType = 'military_symbol';
  constructor(toolManager) {
    super(toolManager);

    this.geometry = new AddMilitarySymbolGeometry();
    this.symbolGenerator = new MilitarySymbolGenerator();

    this.symbolRafId = null;
    this.pendingSymbolUpdate = false;
    this.lastSymbolFeature = null;
    this.symbolDebounceTimer = null;

    this.zoomRafId = null;
    this.pendingZoomUpdate = false;
    this._name = 'AddMilitarySymbolControl';
  }

  static DEFAULT_PROPERTIES = {
    context: "0",
    standardIdentity: "3",
    status: "0",
    symbolSet: "10",
    hqTfDummy: "0",
    echelon: "16",
    mainIcon: "121100",
    modifier1: "00",
    modifier2: "00",

    size: 1.0,
    width: 100,
    height: 100,
    opacity: 1.0,
    rotation: 0,
    fillColor: null,

    createdAtZoom: 0,
    calculatedSize: 1.0,
    zoomCorrectionEnabled: true,
    selectionBox: null,

    source: "military_symbol",
    nome: "",
    descricao: "",
    visivel: true,
    bloqueado: false,

    uniqueDesignation: null,
    higherFormation: null,
    quantity: null,
    reinforcedReduced: null,
    additionalInformation: null,
    credibility: null,
    location: null,
    dateTimeGroup: null,
    altitudeDepth: null,
    speed: null,
    specialHeadquarters: null,
    type: null,
    iffSif: null,
    equipmentTeardownTime: null,
    direction: null,
    engagementBar: null
  };

  onAdd = (map) => {
    this.map = map;
    this.setupZoomListener();
    // The symbol PNG (milsymbol) is local-only — never uploaded — so a peer renders an error
    // icon. Regenerate it from the synced SIDC/props on every remote symbol op (deterministic).
    this._subscribeRemoteImageRegen("military_symbol", (f) => this._regenerateRemote(f));
  };

  onRemove = () => {
    this.map.off("zoom", this.handleZoomChange);
    this._unsubscribeRemoteImageRegen();
    if (this.zoomRafId) {
      cancelAnimationFrame(this.zoomRafId);
      this.zoomRafId = null;
    }
    this.pendingZoomUpdate = false;
    this.cancelPendingSymbolUpdates();
    this.deactivate();
    this.removeAllEventListeners();
    this.map = undefined;
  };

  hasAttributePanel() {
    return true;
  }

  createAttributePanel(container, features, selectionManager, uiManager, options = {}) {
    const sectionPanel = document.createElement("div");
    sectionPanel.className = "military-symbol-attributes-section";

    try {
      addMilitarySymbolAttributesToPanel(
        sectionPanel,
        features,
        this,
        selectionManager,
        uiManager,
        options
      );
      container.appendChild(sectionPanel);
    } catch (error) {
      console.error("Error creating military symbol attribute panel:", error);
    }
  }

  getDragSources() {
    return ["military_symbols"];
  }

  getEditHandleSources() {
    return [];
  }

  createSelectionBox(feature) {
    // Military symbols use pre-calculated selection boxes stored as properties.
    // A moving (trajectory) symbol is displaced from its authored position, so the
    // stored box (computed at home) no longer matches — recompute from live coords.
    const moving = Array.isArray(feature.properties.trajetoria) && feature.properties.trajetoria.length >= 2;
    if (feature.properties.selectionBox && !moving) {
      return { geometry: feature.properties.selectionBox };
    }

    // Fallback: calculate on demand if missing
    const effectiveZoom = feature.properties.zoomCorrectionEnabled === false ? this.map.getZoom() : null;
    const selectionBox = this.geometry.calculateSelectionBoxGeometry(
      feature.geometry.coordinates,
      feature.properties.width,
      feature.properties.height,
      feature.properties.size,
      feature.properties.rotation,
      feature.properties.createdAtZoom,
      this.selectionManager.uiManager,
      effectiveZoom
    );

    return { geometry: selectionBox };
  }

  getSelectionBoxStrategy() {
    return "preCalculated";
  }

  getSelectionBoxPadding() {
    return 5;
  }

  getLayerIds() {
    return ["military_symbols-layer"];
  }

  getSourceNames() {
    return ["military_symbols"];
  }

  getEditHandleSource() {
    return null;
  }

  canCopy(_feature) {
    return true;
  }

  canPaste(_feature) {
    return true;
  }

  prepareForPaste(feature, offset) {
    const oldCoordinates = feature.geometry.coordinates;
    const newCoordinates = [
      oldCoordinates[0] + offset.dx,
      oldCoordinates[1] + offset.dy,
    ];

    const effectiveZoom = feature.properties.zoomCorrectionEnabled === false ? this.map.getZoom() : null;
    const newSelectionBox = this.geometry.calculateSelectionBoxGeometry(
      newCoordinates,
      feature.properties.width,
      feature.properties.height,
      feature.properties.size,
      feature.properties.rotation,
      feature.properties.createdAtZoom,
      this.selectionManager.uiManager,
      effectiveZoom
    );

    return {
      ...feature,
      geometry: this.geometry.generate(newCoordinates),
      properties: {
        ...feature.properties,
        selectionBox: newSelectionBox,
      },
    };
  }

  calculateMoveOffset(feature, referencePoint) {
    const coords = feature.geometry.coordinates;
    return [coords[0] - referencePoint.lng, coords[1] - referencePoint.lat];
  }

  updateFeatureForMove(feature, dx, dy, newCoords) {
    const newCoordinates = [newCoords.lng, newCoords.lat];

    const effectiveZoom = feature.properties.zoomCorrectionEnabled === false ? this.map.getZoom() : null;
    const newSelectionBox = this.geometry.calculateSelectionBoxGeometry(
      newCoordinates,
      feature.properties.width,
      feature.properties.height,
      feature.properties.size,
      feature.properties.rotation,
      feature.properties.createdAtZoom,
      this.selectionManager.uiManager,
      effectiveZoom
    );

    // Moving a trajectory feature relocates its anchor (kp 0 = the start position).
    const anchorPatch = reanchorOnMove(feature.properties, newCoordinates, feature.geometry.coordinates);

    const updatedFeature = {
      ...feature,
      geometry: this.geometry.generate(newCoordinates),
      properties: {
        ...feature.properties,
        ...(anchorPatch || null),
        selectionBox: newSelectionBox,
      },
    };

    return updatedFeature;
  }

  canMove(feature) {
    return !feature.properties?.bloqueado;
  }

  activate = () => {
    this.isActive = true;
    this.map.getCanvas().style.cursor = "crosshair";
  };

  deactivate = () => {
    this.isActive = false;
    this.map.getCanvas().style.cursor = "";
    this.deselectFeature();
    this.cancelPendingSymbolUpdates();
  };

  onFeatureSelected = (feature) => {
    this.selectFeature(feature);
  };

  onFeatureDeselected = (feature) => {
    const selectedFeature = this.getSelectedFeature();
    const featureId = feature.properties.id;
    if (selectedFeature && selectedFeature.properties.id === featureId) {
      this.deselectFeature();
    }
  };

  onGlobalDeselect = () => {
    const selectedFeature = this.getSelectedFeature();
    if (selectedFeature) {
      this.deselectFeature();
    }
  };

  isEditingMode = () => {
    return false;
  };

  hasEditHandle = (_featureId) => {
    return false;
  };

  syncEditHandlesAfterDrag = (movedFeatures) => {
    this.updateSelectionBoxesForFeatures(movedFeatures);
  };

  /**
   * Update selection boxes for specific features (used after drag or attribute changes)
   */
  updateSelectionBoxesForFeatures = async (features) => {
    if (!features || features.length === 0) return;

    const data = await this.map.getSource("military_symbols").getData();
    let hasChanges = false;

    features.forEach((inputFeature) => {
      if (inputFeature.properties.source === "military_symbol") {
        // Find the current feature in the map source (this has the latest coordinates)
        const currentSourceFeature = data.features.find(
          (f) => f.properties.id === inputFeature.properties.id
        );

        if (currentSourceFeature) {
          const effectiveZoom = currentSourceFeature.properties.zoomCorrectionEnabled === false ? this.map.getZoom() : null;
          const newSelectionBox = this.geometry.calculateSelectionBoxGeometry(
            currentSourceFeature.geometry.coordinates,
            currentSourceFeature.properties.width,
            currentSourceFeature.properties.height,
            currentSourceFeature.properties.size,
            currentSourceFeature.properties.rotation,
            currentSourceFeature.properties.createdAtZoom,
            this.selectionManager.uiManager,
            effectiveZoom
          );

          currentSourceFeature.properties.selectionBox = newSelectionBox;
          hasChanges = true;
        }
      }
    });

    if (hasChanges) {
      this.map.getSource("military_symbols").setData(data);

      const freshFeatures = features.map((inputFeature) => {
        const sourceFeature = data.features.find(
          (f) => f.properties.id === inputFeature.properties.id
        );
        return sourceFeature || inputFeature;
      });

      this.updateSelectionManagerFeatures(freshFeatures);

      requestAnimationFrame(() => {
        if (this.selectionManager.uiManager.updateSelectionHighlight) {
          this.selectionManager.uiManager.updateSelectionHighlight();
        }
      });
    }
  };

  selectFeature = (_feature) => {
    this.setupHoverListeners();
  };

  deselectFeature = () => {
    this.removeHoverListeners();
    this.map.getCanvas().style.cursor = "";
  };

  handleMapClick = async (e) => {
    if (!this.isActive) return;

    if (!e.lngLat || isNaN(e.lngLat.lng) || isNaN(e.lngLat.lat)) {
      console.warn("Invalid coordinates for military symbol");
      return;
    }

    await this.createMilitarySymbolFeature(e.lngLat);
    this.toolManager.deactivateCurrentTool();
  };

  createMilitarySymbolFeature = async (lngLat) => {
    const { id: featureId, geoJsonId } = IDUtils.generateFeatureIds();
    const featureName = await IDUtils.generateFeatureName(
      "military_symbol",
      this.map
    );

    const currentZoom = this.map.getZoom();
    const coordinates = [lngLat.lng, lngLat.lat];

    const sidc30 = this.symbolGenerator.buildSIDC(
      AddMilitarySymbolControl.DEFAULT_PROPERTIES
    );

    const selectionBox = this.geometry.calculateSelectionBoxGeometry(
      coordinates,
      AddMilitarySymbolControl.DEFAULT_PROPERTIES.width,
      AddMilitarySymbolControl.DEFAULT_PROPERTIES.height,
      AddMilitarySymbolControl.DEFAULT_PROPERTIES.size,
      AddMilitarySymbolControl.DEFAULT_PROPERTIES.rotation,
      currentZoom,
      this.selectionManager.uiManager
    );

    const feature = {
      type: "Feature",
      id: geoJsonId,
      properties: {
        ...AddMilitarySymbolControl.DEFAULT_PROPERTIES,
        layerId: getActiveLayerIdSync(),
        id: featureId,
        nome: featureName,
        sidc: sidc30,
        createdAtZoom: currentZoom,
        calculatedSize: AddMilitarySymbolControl.DEFAULT_PROPERTIES.size,
        selectionBox: selectionBox,
        uniqueDesignation: null,
        higherFormation: null,
        reinforcedReduced: null,
        additionalInformation: null,
        credibility: null,
        location: null,
        dateTimeGroup: null,
        altitudeDepth: null,
        speed: null,
        specialHeadquarters: null,
        type: null,
        iffSif: null,
        equipmentTeardownTime: null,
        direction: null,
        engagementBar: null
      },
      geometry: this.geometry.generate(coordinates),
    };

    try {
      const result = await this.symbolGenerator.generateSymbolBlob(
        feature.properties
      );

      feature.properties.width = result.width;
      feature.properties.height = result.height;

      feature.properties.selectionBox = this.geometry.calculateSelectionBoxGeometry(
        coordinates,
        result.width,
        result.height,
        feature.properties.size,
        feature.properties.rotation,
        currentZoom,
        this.selectionManager.uiManager
      );

      await storeImage(featureId, result.blob);
      await this.loadSymbolToMap(featureId, result.blob);

      await addFeature("military_symbols", feature);

      const data = await this.map.getSource("military_symbols").getData();
      data.features.push(feature);
      this.map.getSource("military_symbols").setData(data);

      await this.selectionManager.toggleFeatureSelection(
        "military_symbol",
        featureId,
        feature
      );
      this.selectionManager.updateUI();
    } catch (error) {
      console.error("Error creating military symbol feature:", error);
      showError("Erro ao criar símbolo militar");
    }
  };

  async loadSymbolToMap(symbolId, blob) {
    return loadImageToMap(this.map, symbolId, blob, { replaceExisting: true });
  }

  /** Rebuilds and re-installs a military symbol's image from its synced props (peer side). */
  async _regenerateRemote(feature) {
    if (!this.map || !feature?.properties?.id) return;
    const result = await this.symbolGenerator.generateSymbolBlob(feature.properties);
    if (result?.blob) {
      await storeImage(feature.properties.id, result.blob);
      await this.loadSymbolToMap(feature.properties.id, result.blob);
    }
  }

  scheduleSymbolUpdate = (feature) => {
    this.lastSymbolFeature = feature;

    if (!this.pendingSymbolUpdate) {
      this.pendingSymbolUpdate = true;
      this.symbolRafId = requestAnimationFrame(this.performSymbolUpdate);
    }
  };

  performSymbolUpdate = async () => {
    if (!this.lastSymbolFeature) {
      this.pendingSymbolUpdate = false;
      return;
    }

    try {
      const feature = this.lastSymbolFeature;
      const symbolId = feature.properties.id;

      const result = await this.symbolGenerator.generateSymbolBlob(
        feature.properties
      );

      feature.properties.width = result.width;
      feature.properties.height = result.height;

      feature.properties.selectionBox = this.geometry.recalculateSelectionBox(
        feature,
        this.selectionManager.uiManager
      );

      const data = await this.map.getSource("military_symbols").getData();
      const sourceFeature = data.features.find(
        f => f.properties.id === feature.properties.id
      );
      if (sourceFeature) {
        sourceFeature.properties.width = result.width;
        sourceFeature.properties.height = result.height;
        sourceFeature.properties.selectionBox = feature.properties.selectionBox;
      }
      this.map.getSource("military_symbols").setData(data);

      await storeImage(symbolId, result.blob);
      await this.loadSymbolToMap(symbolId, result.blob);

      if (this.selectionManager.uiManager.invalidateCache) {
        this.selectionManager.uiManager.invalidateCache(symbolId);
      }

      if (this.selectionManager.uiManager.updateSelectionHighlight) {
        requestAnimationFrame(() => {
          this.selectionManager.uiManager.updateSelectionHighlight();
        });
      }
    } catch (error) {
      console.error("Error updating symbol:", error);
    }

    this.pendingSymbolUpdate = false;
    this.lastSymbolFeature = null;
  };

  async updateSymbolImage(feature) {
    try {
      const symbolId = feature.properties.id;

      const result = await this.symbolGenerator.generateSymbolBlob(
        feature.properties
      );

      feature.properties.width = result.width;
      feature.properties.height = result.height;

      feature.properties.selectionBox = this.geometry.recalculateSelectionBox(
        feature,
        this.selectionManager.uiManager
      );

      const data = await this.map.getSource("military_symbols").getData();
      const sourceFeature = data.features.find(
        f => f.properties.id === feature.properties.id
      );
      if (sourceFeature) {
        sourceFeature.properties.width = result.width;
        sourceFeature.properties.height = result.height;
        sourceFeature.properties.selectionBox = feature.properties.selectionBox;
      }
      this.map.getSource("military_symbols").setData(data);

      await storeImage(symbolId, result.blob);
      await this.loadSymbolToMap(symbolId, result.blob);

      if (this.selectionManager.uiManager.invalidateCache) {
        this.selectionManager.uiManager.invalidateCache(symbolId);
      }

      if (this.selectionManager.uiManager.updateSelectionHighlight) {
        requestAnimationFrame(() => {
          this.selectionManager.uiManager.updateSelectionHighlight();
        });
      }
    } catch (error) {
      console.error("Error updating symbol image:", error);
    }
  }

  async loadSymbolImageToMap(symbolId, blob) {
    return this.loadSymbolToMap(symbolId, blob);
  }

  cancelPendingSymbolUpdates = () => {
    if (this.symbolRafId) {
      cancelAnimationFrame(this.symbolRafId);
      this.symbolRafId = null;
    }
    this.pendingSymbolUpdate = false;
    this.lastSymbolFeature = null;

    if (this.symbolDebounceTimer) {
      clearTimeout(this.symbolDebounceTimer);
      this.symbolDebounceTimer = null;
    }
  };

  setupZoomListener = () => {
    this.map.on("zoom", this.handleZoomChange);
  };

  handleZoomChange = () => {
    if (!this.pendingZoomUpdate) {
      this.pendingZoomUpdate = true;
      this.zoomRafId = requestAnimationFrame(this.updateAllSymbolSizes);
    }
  };

  applyZoomCorrections = (features) => {
    return applyZoomCorrectionsUtil(features, this.map.getZoom(), {
      sourceProperty: 'size',
      calculatedProperty: 'calculatedSize',
      maxValue: 10,
    });
  };

  updateAllSymbolSizes = async () => {
    if (!this.map.getSource("military_symbols")) {
      this.pendingZoomUpdate = false;
      return;
    }

    const currentZoom = this.map.getZoom();
    const data = await this.map.getSource("military_symbols").getData();
    let hasChanges = false;

    data.features.forEach((feature) => {
      let newCalculatedSize;

      if (feature.properties.zoomCorrectionEnabled === false) {
        newCalculatedSize = feature.properties.size;

        const newSelectionBox = this.geometry.calculateSelectionBoxGeometry(
          feature.geometry.coordinates,
          feature.properties.width,
          feature.properties.height,
          feature.properties.size,
          feature.properties.rotation,
          feature.properties.createdAtZoom,
          this.selectionManager.uiManager,
          currentZoom
        );
        feature.properties.selectionBox = newSelectionBox;
        hasChanges = true;
      } else {
        const zoomDifference = currentZoom - feature.properties.createdAtZoom;
        const scaleFactor = Math.pow(2, zoomDifference);
        newCalculatedSize = Math.min(
          feature.properties.size * scaleFactor,
          10
        );
      }

      if (feature.properties.calculatedSize !== newCalculatedSize) {
        feature.properties.calculatedSize = newCalculatedSize;
        hasChanges = true;
      }
    });

    if (hasChanges) {
      this.map.getSource("military_symbols").setData(data);

      const selectedFeatures = this.getSelectedFeatures();
      const featuresWithDisabledZoomCorrection = selectedFeatures.filter(
        f => f.properties.zoomCorrectionEnabled === false
      );
      if (featuresWithDisabledZoomCorrection.length > 0) {
        featuresWithDisabledZoomCorrection.forEach(selectedFeature => {
          const freshFeature = data.features.find(f => f.properties.id === selectedFeature.properties.id);
          if (freshFeature) {
            this.selectionManager.updateSelectedFeature('military_symbol', freshFeature.properties.id, freshFeature);
            if (this.selectionManager.uiManager.invalidateCache) {
              this.selectionManager.uiManager.invalidateCache(freshFeature.properties.id);
            }
          }
        });
        if (this.selectionManager.uiManager.updateSelectionHighlight) {
          this.selectionManager.uiManager.updateSelectionHighlight();
        }
      }
    }

    this.pendingZoomUpdate = false;
  };

  setupHoverListeners = () => {
    this.map.on("mousemove", this.onHoverMove);
  };

  removeHoverListeners = () => {
    this.map.off("mousemove", this.onHoverMove);
  };

  onHoverMove = (e) => {
    const selectedFeature = this.getSelectedFeature();
    if (!selectedFeature) return;

    const features = this.map.queryRenderedFeatures(e.point);
    const hasFeature = this.hasSelectedFeatureAtPoint(features);

    this.map.getCanvas().style.cursor = hasFeature ? "move" : "";
  };

  hasSelectedFeatureAtPoint = (features) => {
    const selectedFeature = this.getSelectedFeature();
    if (!selectedFeature) return false;
    return features.some(
      (f) =>
        f.source === "military_symbols" &&
        f.properties.id === selectedFeature.properties.id
    );
  };

  getDistinctSymbolsByUsage = async () => {
    if (!this.map.getSource("military_symbols")) {
      return [];
    }

    const data = await this.map.getSource("military_symbols").getData();
    const symbolCounts = new Map(); // Map<sidc, {feature, count}>

    data.features.forEach((feature) => {
      const sidc = feature.properties.sidc;
      if (symbolCounts.has(sidc)) {
        symbolCounts.get(sidc).count++;
      } else {
        symbolCounts.set(sidc, { feature, count: 1 });
      }
    });

    return Array.from(symbolCounts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 20)
      .map((item) => ({ ...item.feature, usageCount: item.count }));
  };

  updateFeaturesProperty = async (features, property, value) => {
    const data = await this.map.getSource("military_symbols").getData();

    for (const feature of features) {
      const sourceFeature = data.features.find(
        (f) => f.properties.id === feature.properties.id
      );
      if (sourceFeature) {
        const oldSIDC = sourceFeature.properties.sidc;
        const oldFillColor = sourceFeature.properties.fillColor;

        sourceFeature.properties[property] = value;
        feature.properties[property] = value;

        if (property === 'sidc') {
          const normalized = normalizeSIDC(value);
          if (normalized) {
            sourceFeature.properties.sidc = normalized;
            feature.properties.sidc = normalized;
          }
        }

        // Tool-specific: SIDC regeneration for non-zoom properties
        if (property !== 'zoomCorrectionEnabled' && property !== 'createdAtZoom') {
          const needsRegeneration =
            this.geometry.affectsSIDC(property) ||
            this.geometry.affectsTextModifiers(property) ||
            property === "fillColor";

          if (needsRegeneration) {
            if (this.geometry.affectsSIDC(property)) {
              const newSIDC30 = this.symbolGenerator.buildSIDC(sourceFeature.properties);
              sourceFeature.properties.sidc = newSIDC30;
              feature.properties.sidc = newSIDC30;
            }

            const sidcChanged =
              this.geometry.affectsSIDC(property) &&
              oldSIDC !== sourceFeature.properties.sidc;
            const colorChanged =
              property === "fillColor" && oldFillColor !== value;
            const textModifierChanged = this.geometry.affectsTextModifiers(property);

            if (sidcChanged || colorChanged || textModifierChanged) {
              this.scheduleSymbolUpdate(feature);
            }
          }
        }

        syncZoomCorrectedProperty(
          sourceFeature, feature, property, value, this.map.getZoom(),
          { sourceProperty: 'size', calculatedProperty: 'calculatedSize', maxValue: 10 }
        );

        if (
          this.geometry.affectsVisuals(property) ||
          property === "createdAtZoom" ||
          property === "zoomCorrectionEnabled"
        ) {
          const currentCoordinates = sourceFeature.geometry.coordinates;
          const effectiveZoom = sourceFeature.properties.zoomCorrectionEnabled === false ? this.map.getZoom() : null;
          const newSelectionBox = this.geometry.calculateSelectionBoxGeometry(
            currentCoordinates,
            sourceFeature.properties.width,
            sourceFeature.properties.height,
            sourceFeature.properties.size,
            sourceFeature.properties.rotation,
            sourceFeature.properties.createdAtZoom,
            this.selectionManager.uiManager,
            effectiveZoom
          );

          sourceFeature.properties.selectionBox = newSelectionBox;
          feature.properties.selectionBox = newSelectionBox;
        }
      }
    }

    this.forceUpdateMainSource(data);
    const freshFeatures = features.map((feature) => {
      const sourceFeature = data.features.find(
        (f) => f.properties.id === feature.properties.id
      );
      return sourceFeature || feature;
    });
    this.updateSelectionManagerFeatures(freshFeatures);
    if (
      this.geometry.affectsVisuals(property) ||
      property === "createdAtZoom" ||
      property === "zoomCorrectionEnabled"
    ) {
      requestAnimationFrame(() => {
        if (this.selectionManager.uiManager.updateSelectionHighlight) {
          this.selectionManager.uiManager.updateSelectionHighlight();
        }
      });
    }
  };

  /**
   * Force update main source with drag protection
   */
  forceUpdateMainSource = (data) => {
    if (
      this.selectionManager.uiManager &&
      this.selectionManager.uiManager.isDragging
    ) {
      return;
    }

    this.map.getSource("military_symbols").setData(data);
  };

  ensureFeatureConsistency = (
    feature,
    currentZoom = null,
    forceRecalculateSelectionBox = false
  ) => {
    const zoom = currentZoom || this.map.getZoom();

    if (feature.properties.zoomCorrectionEnabled === false) {
      feature.properties.calculatedSize = feature.properties.size;
    } else {
      const zoomDifference = zoom - feature.properties.createdAtZoom;
      const scaleFactor = Math.pow(2, zoomDifference);
      feature.properties.calculatedSize = Math.min(
        feature.properties.size * scaleFactor,
        10
      );
    }

    if (forceRecalculateSelectionBox && !this.isSourceUpdateBlocked()) {
      const effectiveZoom = feature.properties.zoomCorrectionEnabled === false ? zoom : null;
      feature.properties.selectionBox =
        this.geometry.calculateSelectionBoxGeometry(
          feature.geometry.coordinates,
          feature.properties.width,
          feature.properties.height,
          feature.properties.size,
          feature.properties.rotation,
          feature.properties.createdAtZoom,
          this.selectionManager.uiManager,
          effectiveZoom
        );
    }

    return feature;
  };

  /**
   * Check if source updates should be blocked (during drag)
   */
  isSourceUpdateBlocked = () => {
    return (
      this.selectionManager.uiManager &&
      this.selectionManager.uiManager.isDragging
    );
  };

  saveFeatures = async (features, initialPropertiesMap) => {
    const currentData = await this.map.getSource("military_symbols").getData();

    for (const selectedFeature of features) {
      if (
        this.hasFeatureChanged(
          selectedFeature,
          initialPropertiesMap.get(selectedFeature.properties.id)
        )
      ) {
        const currentFeature = currentData.features.find(
          (f) => f.properties.id === selectedFeature.properties.id
        );

        if (currentFeature) {
          await updateFeature("military_symbols", currentFeature);
        }
      }
    }
  };

  discardChangeFeatures = async (features, initialPropertiesMap) => {
    for (const f of features) {
      const initialProps = initialPropertiesMap.get(f.properties.id);
      Object.assign(f.properties, initialProps);
      f.geometry = this.geometry.generate(f.geometry.coordinates);

      if (
        f.properties.sidc !== initialProps.sidc ||
        f.properties.fillColor !== initialProps.fillColor
      ) {
        this.scheduleSymbolUpdate(f);
      }
    }

    await this.updateFeatures(features, true, true);
  };

  deleteFeatures = async (features) => {
    if (features.length === 0) return;

    for (const feature of features) {
      try {
        const featureId = feature.properties.id;

        // Remove from storage (the rasterized PNG blob is released later, on
        // undo-history eviction, so an Undo can still restore the symbol image).
        await removeFeature("military_symbols", featureId);

        // Update map source
        const data = await this.map.getSource("military_symbols").getData();
        const idsToDelete = new Set(
          features.map((f) => String(f.properties.id))
        );
        data.features = data.features.filter(
          (f) => !idsToDelete.has(String(f.properties.id))
        );
        this.map.getSource("military_symbols").setData(data);
      } catch (error) {
        console.error(
          `Error removing military symbol ${feature.properties.id}:`,
          error
        );
      }
    }
  };

  setDefaultProperties = (properties) => {
    Object.assign(
      AddMilitarySymbolControl.DEFAULT_PROPERTIES,
      buildDefaultSymbolPatch(properties)
    );
  };

  hasFeatureChanged = (feature, initialProperties) => {
    return hasTrackedPropsChanged(feature?.properties, initialProperties);
  };

  updateFeatures = async (
    features,
    save = false,
    onlyUpdateProperties = false
  ) => {
    if (features.length > 0) {
      const data = await this.map.getSource("military_symbols").getData();
      const currentZoom = this.map.getZoom();

      for (const feature of features) {
        const featureIndex = data.features.findIndex(
          (f) => f.properties.id === feature.properties.id
        );
        if (featureIndex !== -1) {
          if (onlyUpdateProperties) {
            Object.assign(
              data.features[featureIndex].properties,
              feature.properties
            );
          } else {
            data.features[featureIndex] = feature;
          }

          this.ensureFeatureConsistency(
            data.features[featureIndex],
            currentZoom,
            !onlyUpdateProperties
          );

          if (save) {
            const featureToUpdate = onlyUpdateProperties
              ? data.features[featureIndex]
              : feature;
            await updateFeature("military_symbols", featureToUpdate);
          }
        }
      }

      this.forceUpdateMainSource(data);
      this.updateSelectionManagerFeatures(features);
    }
  };

  /**
   * Update SelectionManager with current feature data
   */
  updateSelectionManagerFeature(feature) {
    this.selectionManager.updateSelectedFeature('military_symbol', feature.properties.id, feature);
  }

  /**
   * Update SelectionManager with multiple features
   */
  updateSelectionManagerFeatures(features) {
    features.forEach((feature) => {
      if (feature.properties.source === "military_symbol") {
        this.updateSelectionManagerFeature(feature);
      }
    });
  }

  setupBaseEventListeners = () => {
  };

  removeAllEventListeners = () => {
    this.removeHoverListeners();
    this.cancelPendingSymbolUpdates();

    if (this.zoomRafId) {
      cancelAnimationFrame(this.zoomRafId);
      this.zoomRafId = null;
    }
    this.pendingZoomUpdate = false;
  };
}

export default AddMilitarySymbolControl;
