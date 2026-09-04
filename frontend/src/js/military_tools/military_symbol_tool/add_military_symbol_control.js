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
import { getGeoJsonDispatcher, destroyGeoJsonDispatcher } from '@layers/geojson-dispatcher.js';
import { queryHoverFeatures } from '@tools/helpers/hover-query.helpers.js';
import { readGeoJSONSourceData } from '@utils/geojson-source.js';

/**
 * Layer onHoverMove needs: the single layer drawn from the 'military_symbols' source, in
 * layers/styles/symbol.layers.js. This tool has no edit handles.
 */
const HOVER_LAYER_IDS = ['military-symbols-layer'];

/**
 * The dispatcher that owns the `military_symbols` source.
 *
 * EVERY write to `military_symbols` made in this file goes through it. The reason is not style:
 * a raw `source.setData()` issued while a diff is queued replaces MapLibre's pending-update slot
 * and the diff disappears with no error at all.
 *
 * Each public method here also awaits `flush()` before it returns. Two reasons, and the second
 * is the one that matters:
 * - the deferred write would otherwise land one animation frame after the caller resumed;
 * - `military_symbols` still has co-writers outside this file (the point-to-symbol conversion in
 *   `tool_manager/helpers/feature-header.helpers.js`, plus the generic by-storageType writers:
 *   attribute table, features tab, import, clipboard, multi-selection actions, context menu,
 *   phone layout), and they all do read-modify-write with a raw `setData`. Draining inside the
 *   awaited method keeps the queue empty between gestures, so no co-writer can read a collection
 *   that is missing what this tool just wrote.
 * @param {Object} map - MapLibre map instance
 * @returns {Object} dispatcher owning the `military_symbols` source
 */
function militarySymbolsSource(map) {
    return getGeoJsonDispatcher(map, 'military_symbols');
}

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
    this.fixedZoomRafId = null;
    this.pendingFixedZoomUpdate = false;
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
    this.map.off("zoomend", this.handleZoomEnd);
    // Releases the queue, its settle timers and the two map listeners the dispatcher opens per
    // dispatch. Dropping a batch here cannot lose a symbol: the store write always precedes the
    // source write, so the redraw that follows a style switch repopulates `military_symbols`
    // from persistence.
    destroyGeoJsonDispatcher(this.map, "military_symbols");
    this._unsubscribeRemoteImageRegen();
    if (this.zoomRafId) {
      cancelAnimationFrame(this.zoomRafId);
      this.zoomRafId = null;
    }
    if (this.fixedZoomRafId) {
      cancelAnimationFrame(this.fixedZoomRafId);
      this.fixedZoomRafId = null;
    }
    this.pendingFixedZoomUpdate = false;
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

    const dispatcher = militarySymbolsSource(this.map);
    let hasChanges = false;

    // The moved feature already carries the post-drag state: `updateFeatureForMove` built it and
    // `updateFeatures` (called by `selectionManager.updateSelectedFeatures()` just before this)
    // pushed that same object into the source. So the box is recomputed from it and shipped as a
    // one-property patch, instead of reading the whole collection back only to find the copy of
    // what the caller already handed us.
    for (const inputFeature of features) {
      if (inputFeature.properties.source !== "military_symbol") continue;

      const effectiveZoom = inputFeature.properties.zoomCorrectionEnabled === false ? this.map.getZoom() : null;
      const newSelectionBox = this.geometry.calculateSelectionBoxGeometry(
        inputFeature.geometry.coordinates,
        inputFeature.properties.width,
        inputFeature.properties.height,
        inputFeature.properties.size,
        inputFeature.properties.rotation,
        inputFeature.properties.createdAtZoom,
        this.selectionManager.uiManager,
        effectiveZoom
      );

      inputFeature.properties.selectionBox = newSelectionBox;
      dispatcher.patch(inputFeature.properties.id, { setProps: { selectionBox: newSelectionBox } });
      hasChanges = true;
    }

    if (hasChanges) {
      await dispatcher.flush();

      this.updateSelectionManagerFeatures(features);

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

    // Single-shot tool: disarm BEFORE the first await. `createMilitarySymbolFeature`
    // awaits name generation, symbol image generation and the store write before
    // `deactivateCurrentTool()` runs, so two clicks in the same tick both used to
    // pass the guard above and create two symbols with the same generated name.
    this.isActive = false;

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

      const dispatcher = militarySymbolsSource(this.map);
      dispatcher.add(feature);
      await dispatcher.flush();

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
  /**
   * Rebuilds this feature's LOCAL-ONLY PNG from its synced props, and installs it on the map.
   *
   * PÚBLICO DE PROPÓSITO, e o motivo é a carga tardia. `layer_setup.js` regenera o PNG de um
   * símbolo quando um snapshot remoto chega, SEM clique nenhum, e o faz pelo
   * `image-regen-registry`. Com a ferramenta militar fora do payload do boot, quem se registra
   * lá no boot é uma closure de `tool_manager/tool-registry.js`, que carrega esta ferramenta na
   * PRIMEIRA feição que precisar dela e chama este método. O registro é ansioso, o módulo não —
   * e uma closure não alcança um método privado.
   *
   * @param {Object} feature - Feição com as props sincronizadas (SIDC e afins)
   * @returns {Promise<void>}
   */
  regenerateImageFromProps(feature) {
    return this._regenerateRemote(feature);
  }

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

      // Three properties on one feature. The `if (sourceFeature)` guard the read used to provide
      // is what a patch of an absent key already does by itself (documented silent no-op), so the
      // collection read buys nothing here.
      const dispatcher = militarySymbolsSource(this.map);
      dispatcher.patch(symbolId, {
        setProps: {
          width: result.width,
          height: result.height,
          selectionBox: feature.properties.selectionBox,
        },
      });
      await dispatcher.flush();

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

      // Three properties on one feature. The `if (sourceFeature)` guard the read used to provide
      // is what a patch of an absent key already does by itself (documented silent no-op), so the
      // collection read buys nothing here.
      const dispatcher = militarySymbolsSource(this.map);
      dispatcher.patch(symbolId, {
        setProps: {
          width: result.width,
          height: result.height,
          selectionBox: feature.properties.selectionBox,
        },
      });
      await dispatcher.flush();

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

  /**
   * The painted size comes from a style expression now (layers/styles/zoom-expression.js),
   * so the full pass no longer feeds the drawing and is worth ONE run per gesture, on
   * `zoomend`: it refreshes the stored `calculatedSize` for the consumers that still read
   * it (export, feature header, selection box).
   *
   * What an expression cannot do is the ground geometry of a symbol whose correction is
   * OFF: its `selectionBox` is expressed in degrees and has to be rebuilt at every zoom
   * step. Those features, and only those, keep a per-frame pass.
   */
  setupZoomListener = () => {
    this.map.on("zoom", this.handleZoomChange);
    this.map.on("zoomend", this.handleZoomEnd);
  };

  handleZoomChange = () => {
    if (!this.pendingFixedZoomUpdate) {
      this.pendingFixedZoomUpdate = true;
      this.fixedZoomRafId = requestAnimationFrame(this.updateFixedSelectionBoxes);
    }
  };

  handleZoomEnd = () => {
    if (!this.pendingZoomUpdate) {
      this.pendingZoomUpdate = true;
      this.zoomRafId = requestAnimationFrame(this.updateAllSymbolSizes);
    }
  };

  /**
   * The ground-sized selection box of one feature, at a given zoom. ONE derivation,
   * shared by the per-frame pass and the end-of-gesture pass: a second copy of this
   * argument list is how a fix lands in one of them and leaves the other wrong, with
   * the suite still green.
   * @param {Object} feature - Feature whose zoom correction is disabled
   * @param {number} currentZoom - Current map zoom
   * @returns {Object} Selection box geometry
   */
  _fixedSelectionBox = (feature, currentZoom) => this.geometry.calculateSelectionBoxGeometry(
    feature.geometry.coordinates,
    feature.properties.width,
    feature.properties.height,
    feature.properties.size,
    feature.properties.rotation,
    feature.properties.createdAtZoom,
    this.selectionManager.uiManager,
    currentZoom
  );

  /**
   * Per-frame pass, coalesced by rAF: rebuilds the ground-sized selection box of the
   * features whose correction is disabled, and nothing else. The collection is read
   * SYNCHRONOUSLY (`utilities/geojson-source.js`), so a gesture over a map with none of
   * them costs no worker traffic and no write at all. What changed goes out as a diff
   * through the dispatcher, never as a whole-collection `setData`.
   */
  updateFixedSelectionBoxes = async () => {
    try {
      const source = this.map?.getSource("military_symbols");
      if (!source) return;

      const data = readGeoJSONSourceData(source);
      if (!data?.features?.length) return;

      const fixed = data.features.filter(f => f.properties.zoomCorrectionEnabled === false);
      if (!fixed.length) return;

      const currentZoom = this.map.getZoom();
      const dispatcher = militarySymbolsSource(this.map);
      const boxes = new Map();
      for (const feature of fixed) {
        const selectionBox = this._fixedSelectionBox(feature, currentZoom);
        boxes.set(feature.properties.id, selectionBox);
        dispatcher.patch(feature.properties.id, { setProps: { selectionBox } });
      }
      await dispatcher.flush();

      this._syncFixedSelection(boxes);
    } finally {
      this.pendingFixedZoomUpdate = false;
    }
  };

  /**
   * Copy the recalculated boxes onto the selected features and refresh the highlight.
   * @param {Map<string, Object>} boxes - Selection box per feature id
   */
  _syncFixedSelection = (boxes) => {
    const selected = this.getSelectedFeatures?.() || [];
    let touched = false;
    for (const feature of selected) {
      const box = boxes.get(feature.properties.id);
      if (!box) continue;
      feature.properties.selectionBox = box;
      this.selectionManager.updateSelectedFeature?.('militarySymbol', feature.properties.id, feature);
      this.selectionManager.uiManager?.invalidateCache?.(feature.properties.id);
      touched = true;
    }
    if (touched) this.selectionManager.uiManager?.updateSelectionHighlight?.();
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

    // NOT a diff, on purpose: every zoom-corrected symbol changes size on every zoom step, so
    // the delta IS the collection and a diff would carry one update entry per feature for the
    // same O(N) cost. The read-modify-write still has to start from a drained queue, or the copy
    // read back would be missing whatever is queued and the whole-collection write would then
    // erase it.
    const dispatcher = militarySymbolsSource(this.map);
    await dispatcher.flush();
    if (!this.map) {
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

        feature.properties.selectionBox = this._fixedSelectionBox(feature, currentZoom);
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
      dispatcher.setData(data);
      await dispatcher.flush();

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

    const features = queryHoverFeatures(this.map, e.point, HOVER_LAYER_IDS);
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

    // Reads only. The queue is drained first so a symbol created moments ago is counted.
    await militarySymbolsSource(this.map).flush();
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
    // The collection read survives here on purpose. Three things below need the PREVIOUS source
    // feature and no diff hands it back: whether the feature exists at all (an unknown id must be
    // skipped, not created), the old SIDC/fillColor the regeneration test compares against, and
    // the raster size (`width`/`height`) the selection box is measured from. Draining first keeps
    // that read from being stale.
    const dispatcher = militarySymbolsSource(this.map);
    await dispatcher.flush();
    const data = await this.map.getSource("military_symbols").getData();
    const patches = [];

    for (const feature of features) {
      const sourceFeature = data.features.find(
        (f) => f.properties.id === feature.properties.id
      );
      if (sourceFeature) {
        const setProps = { [property]: value };
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

        // Read back rather than recompute: `syncZoomCorrectedProperty` always writes
        // `calculatedSize` and rounds `createdAtZoom`, so the source object is the authority on
        // what the patch has to carry.
        setProps.sidc = sourceFeature.properties.sidc;
        setProps.createdAtZoom = sourceFeature.properties.createdAtZoom;
        setProps.calculatedSize = sourceFeature.properties.calculatedSize;

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
          setProps.selectionBox = newSelectionBox;
        }

        patches.push({ id: sourceFeature.properties.id, setProps });
      }
    }

    // Same drag guard the whole-collection write carried: while the UI owns the on-screen
    // position, a source write would fight it, so the batch is dropped exactly as before.
    if (!this.isSourceUpdateBlocked()) {
      for (const patch of patches) {
        dispatcher.patch(patch.id, { setProps: patch.setProps });
      }
      await dispatcher.flush();
    }

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
    // Reads only, and it persists the SOURCE's version of each feature rather than the selected
    // one, so the queue has to be drained before the collection comes back.
    await militarySymbolsSource(this.map).flush();
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
        // Remove from storage (the rasterized PNG blob is released later, on
        // undo-history eviction, so an Undo can still restore the symbol image).
        await removeFeature("military_symbols", feature.properties.id);
      } catch (error) {
        console.error(
          `Error removing military symbol ${feature.properties.id}:`,
          error
        );
      }
    }

    // Removal by promoted key, with no collection read, and once for the whole batch instead of
    // once per feature. The keys go in raw, never coerced: MapLibre keyed the feature by the very
    // value that sits in `properties.id`, so a `String()` around it would miss a numeric key
    // instead of protecting anything.
    const dispatcher = militarySymbolsSource(this.map);
    dispatcher.remove(features.map((f) => f.properties.id));
    await dispatcher.flush();
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
      // The collection read survives here too: an unknown id must be skipped rather than created,
      // and the merge branch (`onlyUpdateProperties`) needs the previous source properties to
      // merge ONTO. Draining first keeps that read from being stale.
      const dispatcher = militarySymbolsSource(this.map);
      await dispatcher.flush();
      const data = await this.map.getSource("military_symbols").getData();
      const currentZoom = this.map.getZoom();
      const upserts = [];

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

          // The merged/replaced entry is a COMPLETE feature, so it ships as an upsert (`add` is a
          // total replacement in MapLibre) rather than as a property patch: the same result the
          // whole-collection write produced, without the other N-1 features riding along.
          upserts.push(data.features[featureIndex]);

          if (save) {
            const featureToUpdate = onlyUpdateProperties
              ? data.features[featureIndex]
              : feature;
            await updateFeature("military_symbols", featureToUpdate);
          }
        }
      }

      if (!this.isSourceUpdateBlocked()) {
        dispatcher.add(upserts);
        await dispatcher.flush();
      }

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
    if (this.fixedZoomRafId) {
      cancelAnimationFrame(this.fixedZoomRafId);
      this.fixedZoomRafId = null;
    }
    this.pendingFixedZoomUpdate = false;
    this.pendingZoomUpdate = false;
  };
}

export default AddMilitarySymbolControl;
