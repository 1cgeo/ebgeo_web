// Path: js/military_tools/coordination_measure_tool/add_coordination_measure_control.js

import {
  addFeature,
  updateFeature,
  removeFeature,
  storeImage,
  getActiveLayerIdSync
} from "../../store";
import { CoordinationMeasureGenerator } from './coordination_measure_generator.js';
import { IDUtils, showWarning as showWarningToast, loadImageToMap } from "../../utilities";
import { addCoordinationMeasureAttributesToPanel } from "./attributes/index.js";
import AddCoordinationMeasureGeometry from './add_coordination_measure_geometry.js';
import { BaseControl } from "../../tool_manager";
import {
    applyZoomCorrections as applyZoomCorrectionsUtil,
    syncZoomCorrectedProperty,
} from '../../tool_manager/helpers/zoom-correction.helpers.js';
import { reanchorOnMove } from '@js/temporal/trajectory-anchor.js';
import { getGeoJsonDispatcher, destroyGeoJsonDispatcher } from '@layers/geojson-dispatcher.js';

/**
 * The dispatcher that owns the `coordination_measures` source.
 *
 * EVERY write to `coordination_measures` made in this file goes through it. The reason is not
 * style: a raw `source.setData()` issued while a diff is queued replaces MapLibre's pending-update
 * slot and the diff disappears with no error at all.
 *
 * Each public method here also awaits `flush()` before it returns. Two reasons, and the second is
 * the one that matters:
 * - the deferred write would otherwise land one animation frame after the caller resumed;
 * - `coordination_measures` still has co-writers outside this file (the point-to-measure conversion
 *   in `tool_manager/helpers/feature-header.helpers.js`, plus the generic by-storageType writers:
 *   attribute table, features tab, import, clipboard, multi-selection actions, context menu, phone
 *   layout), and they all do read-modify-write with a raw `setData`. Draining inside the awaited
 *   method keeps the queue empty between gestures, so no co-writer can read a collection that is
 *   missing what this tool just wrote.
 * @param {Object} map - MapLibre map instance
 * @returns {Object} dispatcher owning the `coordination_measures` source
 */
function coordinationMeasuresSource(map) {
    return getGeoJsonDispatcher(map, 'coordination_measures');
}

class AddCoordinationMeasureControl extends BaseControl {
  featureType = 'coordination_measure';

  constructor(toolManager) {
    super(toolManager);

    this.geometry = new AddCoordinationMeasureGeometry();
    this.symbolGenerator = new CoordinationMeasureGenerator();

    this.symbolRafId = null;
    this.pendingSymbolUpdate = false;
    this.lastSymbolFeature = null;
    this.symbolDebounceTimer = null;

    this.zoomRafId = null;
    this.pendingZoomUpdate = false;
    this._name = 'AddCoordinationMeasureControl';
  }

  static DEFAULT_PROPERTIES = {
    pointCode: "130100",
    echelonCode: null,

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

    source: "coordination_measure",
    nome: "",
    descricao: "",
    visivel: true,
    bloqueado: false,

    tipo: null,
    identificacao: null,
    gdhIni: null,
    gdhFim: null,
    numero: null,
    classeSuprimento: null,
    status: null,
    numeroConcentracao: null,
    altitude: null
  };

  // ===== MAPBOX CONTROL INTERFACE =====

  onAdd = (map) => {
    this.map = map;
    this.setupZoomListener();
    // The measure PNG is local-only — never uploaded — so a peer renders an error icon.
    // Regenerate it from the synced props on every remote coordination-measure op (deterministic).
    this._subscribeRemoteImageRegen("coordination_measure", (f) => this._regenerateRemote(f));
  };

  onRemove = () => {
    this.map.off("zoom", this.handleZoomChange);
    // Releases the queue, its settle timers and the two map listeners the dispatcher opens per
    // dispatch. Dropping a batch here cannot lose a measure: the store write always precedes the
    // source write, so the redraw that follows a style switch repopulates
    // `coordination_measures` from persistence.
    destroyGeoJsonDispatcher(this.map, "coordination_measures");
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

  // ===== TOOL-CENTRIC INTERFACE IMPLEMENTATIONS =====

  hasAttributePanel() {
    return true;
  }

  createAttributePanel(container, features, selectionManager, uiManager, options = {}) {
    const sectionPanel = document.createElement("div");
    sectionPanel.className = "coordination-measure-attributes-section";

    try {
      addCoordinationMeasureAttributesToPanel(
        sectionPanel,
        features,
        this,
        selectionManager,
        uiManager,
        options
      );
      container.appendChild(sectionPanel);
    } catch (error) {
      console.error("Error creating coordination measure attribute panel:", error);
    }
  }

  getDragSources() {
    return ["coordination_measures"];
  }

  getEditHandleSources() {
    return [];
  }

  createSelectionBox(feature) {
    // A moving (trajectory) measure is displaced from its authored position, so the
    // stored box (computed at home) no longer matches — recompute from live coords.
    const moving = Array.isArray(feature.properties.trajetoria) && feature.properties.trajetoria.length >= 2;
    if (feature.properties.selectionBox && !moving) {
      return { geometry: feature.properties.selectionBox };
    }

    const effectiveZoom = feature.properties.zoomCorrectionEnabled === false ? this.map.getZoom() : null;
    const selectionBox = this.geometry.calculateSelectionBoxGeometry(
      feature.geometry.coordinates,
      feature.properties.width,
      feature.properties.height,
      feature.properties.size,
      feature.properties.rotation,
      feature.properties.createdAtZoom,
      this.selectionManager.uiManager,
      feature.properties.anchor,
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
    return ["coordination-measures-layer"];
  }

  getSourceNames() {
    return ["coordination_measures"];
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
      feature.properties.anchor,
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
      feature.properties.anchor,
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

  // ===== TOOL ACTIVATION/DEACTIVATION =====

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

  // ===== SELECTION SYSTEM INTEGRATION =====

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
   * Update selection boxes for specific features after drag or attribute changes
   * Always uses fresh data from map source to ensure accuracy
   * @param {Array} features - Features to update
   */
  updateSelectionBoxesForFeatures = async (features) => {
    if (!features || features.length === 0) return;

    const dispatcher = coordinationMeasuresSource(this.map);
    let hasChanges = false;

    // The moved feature already carries the post-drag state: `updateFeatureForMove` built it and
    // `updateFeatures` (called by `selectionManager.updateSelectedFeatures()` just before this)
    // pushed that same object into the source. So the box is recomputed from it and shipped as a
    // one-property patch, instead of reading the whole collection back only to find the copy of
    // what the caller already handed us.
    for (const inputFeature of features) {
      if (inputFeature.properties.source !== "coordination_measure") continue;

      const effectiveZoom = inputFeature.properties.zoomCorrectionEnabled === false ? this.map.getZoom() : null;
      const newSelectionBox = this.geometry.calculateSelectionBoxGeometry(
        inputFeature.geometry.coordinates,
        inputFeature.properties.width,
        inputFeature.properties.height,
        inputFeature.properties.size,
        inputFeature.properties.rotation,
        inputFeature.properties.createdAtZoom,
        this.selectionManager.uiManager,
        inputFeature.properties.anchor,
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

  // ===== COORDINATION MEASURE CREATION SYSTEM =====

  handleMapClick = async (e) => {
    if (!this.isActive) return;

    if (!e.lngLat || isNaN(e.lngLat.lng) || isNaN(e.lngLat.lat)) {
      console.warn("Invalid coordinates for coordination measure");
      return;
    }

    // Single-shot tool: disarm BEFORE the first await. `createCoordinationMeasureFeature`
    // awaits name generation, symbol image generation and the store write before
    // `deactivateCurrentTool()` runs, so two clicks in the same tick both used to
    // pass the guard above and create two measures with the same generated name.
    this.isActive = false;

    await this.createCoordinationMeasureFeature(e.lngLat);
    this.toolManager.deactivateCurrentTool();
  };

  createCoordinationMeasureFeature = async (lngLat) => {
    const { id: featureId, geoJsonId } = IDUtils.generateFeatureIds();
    const featureName = await IDUtils.generateFeatureName(
      "coordination_measure",
      this.map
    );

    const currentZoom = this.map.getZoom();
    const coordinates = [lngLat.lng, lngLat.lat];

    const pointCode = AddCoordinationMeasureControl.DEFAULT_PROPERTIES.pointCode;

    const selectionBox = this.geometry.calculateSelectionBoxGeometry(
      coordinates,
      AddCoordinationMeasureControl.DEFAULT_PROPERTIES.width,
      AddCoordinationMeasureControl.DEFAULT_PROPERTIES.height,
      AddCoordinationMeasureControl.DEFAULT_PROPERTIES.size,
      AddCoordinationMeasureControl.DEFAULT_PROPERTIES.rotation,
      currentZoom,
      this.selectionManager.uiManager,
      'center'
    );

    const feature = {
      type: "Feature",
      id: geoJsonId,
      properties: {
        ...AddCoordinationMeasureControl.DEFAULT_PROPERTIES,
        layerId: getActiveLayerIdSync(),
        id: featureId,
        nome: featureName,
        pointCode: pointCode,
        createdAtZoom: currentZoom,
        calculatedSize: AddCoordinationMeasureControl.DEFAULT_PROPERTIES.size,
        selectionBox: selectionBox,
        tipo: null,
        identificacao: null,
        gdhIni: null,
        gdhFim: null,
        numero: null,
        classeSuprimento: null,
        status: null,
        numeroConcentracao: null,
        altitude: null
      },
      geometry: this.geometry.generate(coordinates),
    };

    try {
      let actualPointCode = pointCode;

      if (actualPointCode === 'ECHELON' || actualPointCode === 'ECHELON_FT') {
        actualPointCode = feature.properties.echelonCode ||
          (actualPointCode === 'ECHELON' ? 'ECHELON_16' : 'ECHELON_FT_16');
      }

      const result = await this.symbolGenerator.generate(
        actualPointCode,
        feature.properties
      );

      feature.properties.imageUrl = result.dataUrl;
      feature.properties.width = result.width;
      feature.properties.height = result.height;
      feature.properties.anchor = result.anchor;

      feature.properties.selectionBox = this.geometry.calculateSelectionBoxGeometry(
        coordinates,
        result.width,
        result.height,
        feature.properties.size,
        feature.properties.rotation,
        currentZoom,
        this.selectionManager.uiManager,
        result.anchor
      );

      await storeImage(featureId, result.blob);
      await this.loadSymbolToMap(featureId, result.blob);

      await addFeature("coordination_measures", feature);

      const dispatcher = coordinationMeasuresSource(this.map);
      dispatcher.add(feature);
      await dispatcher.flush();

      await this.selectionManager.toggleFeatureSelection(
        "coordination_measure",
        featureId,
        feature
      );
      this.selectionManager.updateUI();
    } catch (error) {
      console.error("Error creating coordination measure feature:", error);
      this.showError("Erro ao criar medida de coordenação: " + error.message);
    }
  };

  // ===== SYMBOL PROCESSING =====

  async loadSymbolToMap(symbolId, blob) {
    return loadImageToMap(this.map, symbolId, blob, { replaceExisting: true });
  }

  /** Rebuilds and re-installs a coordination measure's image from its synced props (peer side). */
  async _regenerateRemote(feature) {
    if (!this.map || !feature?.properties?.id) return;
    let actualPointCode = feature.properties.pointCode;
    if (actualPointCode === 'ECHELON' || actualPointCode === 'ECHELON_FT') {
      actualPointCode = feature.properties.echelonCode ||
        (actualPointCode === 'ECHELON' ? 'ECHELON_16' : 'ECHELON_FT_16');
    }
    const result = await this.symbolGenerator.generate(actualPointCode, feature.properties);
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

      const properties = {
        tipo: feature.properties.tipo,
        identificacao: feature.properties.identificacao,
        gdhIni: feature.properties.gdhIni,
        gdhFim: feature.properties.gdhFim,
        numero: feature.properties.numero,
        classeSuprimento: feature.properties.classeSuprimento,
        status: feature.properties.status,
        numeroConcentracao: feature.properties.numeroConcentracao,
        altitude: feature.properties.altitude,
        fillColor: feature.properties.fillColor,
        echelonCode: feature.properties.echelonCode
      };

      let actualPointCode = feature.properties.pointCode;

      if (actualPointCode === 'ECHELON' || actualPointCode === 'ECHELON_FT') {
        actualPointCode = feature.properties.echelonCode ||
          (actualPointCode === 'ECHELON' ? 'ECHELON_16' : 'ECHELON_FT_16');
      }

      const result = await this.symbolGenerator.generate(
        actualPointCode,
        properties
      );

      feature.properties.imageUrl = result.dataUrl;
      feature.properties.width = result.width;
      feature.properties.height = result.height;
      feature.properties.anchor = result.anchor;

      // The read stays: the box is measured from the SOURCE geometry, which is the authority on
      // where the measure currently sits, and no diff hands that back. Only the write is a diff.
      const dispatcher = coordinationMeasuresSource(this.map);
      await dispatcher.flush();
      const data = await this.map.getSource("coordination_measures").getData();
      const sourceFeature = data.features.find(
        f => f.properties.id === feature.properties.id
      );

      if (sourceFeature) {
        const effectiveZoom = feature.properties.zoomCorrectionEnabled === false ? this.map.getZoom() : null;
        const newSelectionBox = this.geometry.calculateSelectionBoxGeometry(
          sourceFeature.geometry.coordinates,
          result.width,
          result.height,
          feature.properties.size,
          feature.properties.rotation,
          feature.properties.createdAtZoom,
          this.selectionManager.uiManager,
          result.anchor,
          effectiveZoom
        );

        feature.properties.selectionBox = newSelectionBox;

        dispatcher.patch(sourceFeature.properties.id, {
          setProps: {
            imageUrl: result.dataUrl,
            width: result.width,
            height: result.height,
            anchor: result.anchor,
            selectionBox: newSelectionBox,
          },
        });
        await dispatcher.flush();
      }

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
      console.error("Error updating coordination measure symbol:", error);
    }

    this.pendingSymbolUpdate = false;
    this.lastSymbolFeature = null;
  };

  async updateSymbolImage(feature) {
    try {
      const symbolId = feature.properties.id;

      const properties = {
        tipo: feature.properties.tipo,
        identificacao: feature.properties.identificacao,
        gdhIni: feature.properties.gdhIni,
        gdhFim: feature.properties.gdhFim,
        numero: feature.properties.numero,
        classeSuprimento: feature.properties.classeSuprimento,
        status: feature.properties.status,
        numeroConcentracao: feature.properties.numeroConcentracao,
        altitude: feature.properties.altitude,
        fillColor: feature.properties.fillColor,
        echelonCode: feature.properties.echelonCode
      };

      let actualPointCode = feature.properties.pointCode;

      if (actualPointCode === 'ECHELON' || actualPointCode === 'ECHELON_FT') {
        actualPointCode = feature.properties.echelonCode ||
          (actualPointCode === 'ECHELON' ? 'ECHELON_16' : 'ECHELON_FT_16');
      }

      const result = await this.symbolGenerator.generate(
        actualPointCode,
        properties
      );

      feature.properties.imageUrl = result.dataUrl;
      feature.properties.width = result.width;
      feature.properties.height = result.height;
      feature.properties.anchor = result.anchor;

      // The read stays: the box is measured from the SOURCE geometry, which is the authority on
      // where the measure currently sits, and no diff hands that back. Only the write is a diff.
      const dispatcher = coordinationMeasuresSource(this.map);
      await dispatcher.flush();
      const data = await this.map.getSource("coordination_measures").getData();
      const sourceFeature = data.features.find(
        f => f.properties.id === feature.properties.id
      );

      if (sourceFeature) {
        const effectiveZoom = feature.properties.zoomCorrectionEnabled === false ? this.map.getZoom() : null;
        const newSelectionBox = this.geometry.calculateSelectionBoxGeometry(
          sourceFeature.geometry.coordinates,
          result.width,
          result.height,
          feature.properties.size,
          feature.properties.rotation,
          feature.properties.createdAtZoom,
          this.selectionManager.uiManager,
          result.anchor,
          effectiveZoom
        );

        feature.properties.selectionBox = newSelectionBox;

        dispatcher.patch(sourceFeature.properties.id, {
          setProps: {
            imageUrl: result.dataUrl,
            width: result.width,
            height: result.height,
            anchor: result.anchor,
            selectionBox: newSelectionBox,
          },
        });
        await dispatcher.flush();
      }

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
      console.error("Error updating coordination measure symbol image:", error);
      throw error;
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

  // ===== ZOOM-INVARIANT SYSTEM =====

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
    if (!this.map.getSource("coordination_measures")) {
      this.pendingZoomUpdate = false;
      return;
    }

    // NOT a diff, on purpose: every zoom-corrected measure changes size on every zoom step, so
    // the delta IS the collection and a diff would carry one update entry per feature for the
    // same O(N) cost. The read-modify-write still has to start from a drained queue, or the copy
    // read back would be missing whatever is queued and the whole-collection write would then
    // erase it.
    const dispatcher = coordinationMeasuresSource(this.map);
    await dispatcher.flush();
    if (!this.map) {
      this.pendingZoomUpdate = false;
      return;
    }

    const currentZoom = this.map.getZoom();
    const data = await this.map.getSource("coordination_measures").getData();
    let hasChanges = false;

    data.features.forEach((feature) => {
      let newCalculatedSize;

      if (feature.properties.zoomCorrectionEnabled === false) {
        newCalculatedSize = feature.properties.size;

        // Recalculate selection box for features with zoom correction disabled
        const newSelectionBox = this.geometry.calculateSelectionBoxGeometry(
          feature.geometry.coordinates,
          feature.properties.width,
          feature.properties.height,
          feature.properties.size,
          feature.properties.rotation,
          feature.properties.createdAtZoom,
          this.selectionManager.uiManager,
          feature.properties.anchor,
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
      dispatcher.setData(data);
      await dispatcher.flush();

      // Update SelectionManager with fresh features that have updated selectionBox
      const selectedFeatures = this.getSelectedFeatures();
      const featuresWithDisabledZoomCorrection = selectedFeatures.filter(
        f => f.properties.zoomCorrectionEnabled === false
      );
      if (featuresWithDisabledZoomCorrection.length > 0) {
        featuresWithDisabledZoomCorrection.forEach(selectedFeature => {
          const freshFeature = data.features.find(f => f.properties.id === selectedFeature.properties.id);
          if (freshFeature) {
            this.selectionManager.updateSelectedFeature('coordination_measure', freshFeature.properties.id, freshFeature);
            // Invalidate cache for this feature
            if (this.selectionManager.uiManager.invalidateCache) {
              this.selectionManager.uiManager.invalidateCache(freshFeature.properties.id);
            }
          }
        });
        // Update selection highlight
        if (this.selectionManager.uiManager.updateSelectionHighlight) {
          this.selectionManager.uiManager.updateSelectionHighlight();
        }
      }
    }

    this.pendingZoomUpdate = false;
  };

  // ===== HOVER SYSTEM =====

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
        f.source === "coordination_measures" &&
        f.properties.id === selectedFeature.properties.id
    );
  };

  // ===== FEATURE MANAGEMENT INTERFACE =====

  updateFeaturesProperty = async (features, property, value) => {
    // The collection read survives here on purpose. Two things below need the PREVIOUS source
    // feature and no diff hands them back: whether the feature exists at all (an unknown id must
    // be skipped, not created) and the raster size/anchor the selection box is measured from.
    // Draining first keeps that read from being stale.
    const dispatcher = coordinationMeasuresSource(this.map);
    await dispatcher.flush();
    const data = await this.map.getSource("coordination_measures").getData();
    const patches = [];

    for (const feature of features) {
      const sourceFeature = data.features.find(
        (f) => f.properties.id === feature.properties.id
      );
      if (sourceFeature) {
        const setProps = { [property]: value };
        sourceFeature.properties[property] = value;
        feature.properties[property] = value;

        // Tool-specific: symbol regeneration for non-zoom properties
        if (property !== 'zoomCorrectionEnabled' && property !== 'createdAtZoom') {
          const needsRegeneration =
            this.geometry.affectsSIDC(property) ||
            this.geometry.affectsTextModifiers(property);

          if (needsRegeneration) {
            const symbolCodeChanged = this.geometry.affectsSIDC(property);
            const textModifierChanged = this.geometry.affectsTextModifiers(property);

            if (symbolCodeChanged || textModifierChanged) {
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
            sourceFeature.properties.anchor,
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
          feature.properties.anchor,
          effectiveZoom
        );
    }

    return feature;
  };

  /**
   * Check if source updates should be blocked during drag
   * @returns {boolean} True if updates should be blocked
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
    await coordinationMeasuresSource(this.map).flush();
    const currentData = await this.map.getSource("coordination_measures").getData();

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
          await updateFeature("coordination_measures", currentFeature);
        }
      }
    }
  };

  discardChangeFeatures = async (features, initialPropertiesMap) => {
    for (const f of features) {
      const initialProps = initialPropertiesMap.get(f.properties.id);
      Object.assign(f.properties, initialProps);
      f.geometry = this.geometry.generate(f.geometry.coordinates);

      const sidcProperties = ['pointCode', 'echelonCode'];
      const textModifierProperties = [
        'tipo', 'identificacao', 'gdhIni', 'gdhFim',
        'numero', 'classeSuprimento', 'status',
        'numeroConcentracao', 'altitude', 'fillColor'
      ];

      const needsRegeneration = [...sidcProperties, ...textModifierProperties]
        .some(prop => f.properties[prop] !== initialProps[prop]);

      if (needsRegeneration) {
        this.scheduleSymbolUpdate(f);
      }
    }

    await this.updateFeatures(features, true, true);
  };

  deleteFeatures = async (features) => {
    if (features.length === 0) return;

    for (const feature of features) {
      try {
        // The rasterized blob is released later, on undo-history eviction, so an
        // Undo can still restore the measure image.
        await removeFeature("coordination_measures", feature.properties.id);
      } catch (error) {
        console.error(
          `Error removing coordination measure ${feature.properties.id}:`,
          error
        );
      }
    }

    // Removal by promoted key, with no collection read, and once for the whole batch instead of
    // once per feature. The keys go in raw, never coerced: MapLibre keyed the feature by the very
    // value that sits in `properties.id`, so a `String()` around it would miss a numeric key
    // instead of protecting anything.
    const dispatcher = coordinationMeasuresSource(this.map);
    dispatcher.remove(features.map((f) => f.properties.id));
    await dispatcher.flush();
  };

  setDefaultProperties = (properties) => {
    const TEXT_MODIFIERS = [
      'tipo', 'identificacao', 'gdhIni', 'gdhFim', 'numero',
      'classeSuprimento', 'status', 'numeroConcentracao', 'altitude'
    ];

    const safeProperties = { ...properties };
    TEXT_MODIFIERS.forEach(key => {
      delete safeProperties[key];
    });

    Object.assign(AddCoordinationMeasureControl.DEFAULT_PROPERTIES, safeProperties);

    TEXT_MODIFIERS.forEach(key => {
      AddCoordinationMeasureControl.DEFAULT_PROPERTIES[key] = null;
    });
  };

  hasFeatureChanged = (feature, initialProperties) => {
    if (!initialProperties) return true;

    return (
      feature.properties.pointCode !== initialProperties.pointCode ||
      feature.properties.echelonCode !== initialProperties.echelonCode ||
      feature.properties.tipo !== initialProperties.tipo ||
      feature.properties.identificacao !== initialProperties.identificacao ||
      feature.properties.gdhIni !== initialProperties.gdhIni ||
      feature.properties.gdhFim !== initialProperties.gdhFim ||
      feature.properties.numero !== initialProperties.numero ||
      feature.properties.classeSuprimento !== initialProperties.classeSuprimento ||
      feature.properties.status !== initialProperties.status ||
      feature.properties.numeroConcentracao !== initialProperties.numeroConcentracao ||
      feature.properties.altitude !== initialProperties.altitude ||
      feature.properties.fillColor !== initialProperties.fillColor ||
      feature.properties.size !== initialProperties.size ||
      feature.properties.opacity !== initialProperties.opacity ||
      feature.properties.rotation !== initialProperties.rotation ||
      feature.properties.createdAtZoom !== initialProperties.createdAtZoom ||
      feature.properties.nome !== initialProperties.nome ||
      feature.properties.descricao !== initialProperties.descricao ||
      feature.properties.visivel !== initialProperties.visivel ||
      feature.properties.bloqueado !== initialProperties.bloqueado
    );
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
      const dispatcher = coordinationMeasuresSource(this.map);
      await dispatcher.flush();
      const data = await this.map.getSource("coordination_measures").getData();
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
            await updateFeature("coordination_measures", featureToUpdate);
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

  // ===== SELECTION MANAGER INTEGRATION =====

  /**
   * Update SelectionManager with current feature data
   * @param {Object} feature - Feature to update
   */
  updateSelectionManagerFeature(feature) {
    this.selectionManager.updateSelectedFeature('coordination_measure', feature.properties.id, feature);
  }

  /**
   * Update SelectionManager with multiple features
   * @param {Array} features - Features to update
   */
  updateSelectionManagerFeatures(features) {
    features.forEach((feature) => {
      if (feature.properties.source === "coordination_measure") {
        this.updateSelectionManagerFeature(feature);
      }
    });
  }

  // ===== UTILITY METHODS =====

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

  // ===== UI FEEDBACK METHODS =====

  /**
   * Show success message to user
   * @param {string} message - Success message
   */
  showSuccess(message) {
    if (this.toolManager.uiManager && this.toolManager.uiManager.showNotification) {
      this.toolManager.uiManager.showNotification(message, 'success');
    } else {
      console.log(message);
    }
  }

  /**
   * Show error message to user
   * @param {string} message - Error message
   */
  showError(message) {
    if (this.toolManager.uiManager && this.toolManager.uiManager.showNotification) {
      this.toolManager.uiManager.showNotification(message, 'error');
    } else {
      showWarningToast(message);
    }
  }

  /**
   * Show warning message to user
   * @param {string} message - Warning message
   */
  showWarning(message) {
    if (this.toolManager.uiManager && this.toolManager.uiManager.showNotification) {
      this.toolManager.uiManager.showNotification(message, 'warning');
    } else {
      showWarningToast(message);
    }
  }
}

export default AddCoordinationMeasureControl;
