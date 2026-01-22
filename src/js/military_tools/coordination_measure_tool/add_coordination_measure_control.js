// Path: js/military_tools/coordination_measure_tool/add_coordination_measure_control.js

import {
  addFeature,
  updateFeature,
  removeFeature,
  storeImage,
  removeImage,
  getActiveLayerIdSync
} from "../../store";
import { CoordinationMeasureGenerator } from './coordination_measure_generator.js';
import { IDUtils } from "../../utilities";
import { addCoordinationMeasureAttributesToPanel } from "./attributes/index.js";
import AddCoordinationMeasureGeometry from './add_coordination_measure_geometry.js';
import { BaseControl } from "../../tool_manager";

class AddCoordinationMeasureControl extends BaseControl {
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

  // ===== SINGLE SOURCE OF TRUTH =====

  /**
   * Get currently selected coordination measure feature from SelectionManager
   * @returns {Object|null} Selected coordination measure feature or null
   */
  getSelectedFeature() {
    const selectedItems =
      this.selectionManager.getSelectedFeaturesByType("coordination_measure");
    return selectedItems.length > 0 ? selectedItems[0].feature : null;
  }

  /**
   * Get all selected coordination measure features from SelectionManager
   * @returns {Array} Array of selected coordination measure features
   */
  getSelectedFeatures() {
    return this.selectionManager
      .getSelectedFeaturesByType("coordination_measure")
      .map((item) => item.feature);
  }

  // ===== MAPBOX CONTROL INTERFACE =====

  onAdd = (map) => {
    this.map = map;
    this.container = document.createElement("div");
    this.container.className =
      "mapboxgl-ctrl-group mapboxgl-ctrl coordination-measure-control controls-column-right";

    const button = document.createElement("button");
    button.className = "mapbox-gl-draw_ctrl-draw-btn";
    button.setAttribute("id", "coordination-measure-tool");
    button.innerHTML =
      '<img class="icon-coordination-tool" src="./images/icon_coordination_black.svg" alt="COORD" />';
    button.title = "Adicionar medida de coordenação (C)";
    button.onclick = () => this.toolManager.setActiveTool(this);

    this.container.appendChild(button);
    this.setupBaseEventListeners();
    this.setupZoomListener();
    this.updateButtonAppearance();

    return this.container;
  };

  onRemove = () => {
    try {
      this.map.off("zoom", this.handleZoomChange);
      if (this.zoomRafId) {
        cancelAnimationFrame(this.zoomRafId);
        this.zoomRafId = null;
      }
      this.pendingZoomUpdate = false;

      this.cancelPendingSymbolUpdates();

      this.selectionManager.uiManager.removeControl(this.container);
      this.deactivate();
      this.removeAllEventListeners();
      this.map = undefined;
    } catch (error) {
      console.error("Error removing AddCoordinationMeasureControl:", error);
      throw error;
    }
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
    if (feature.properties.selectionBox) {
      return { geometry: feature.properties.selectionBox };
    }

    const selectionBox = this.geometry.calculateSelectionBoxGeometry(
      feature.geometry.coordinates,
      feature.properties.width,
      feature.properties.height,
      feature.properties.size,
      feature.properties.rotation,
      feature.properties.createdAtZoom,
      this.selectionManager.uiManager,
      feature.properties.anchor
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

  canCopy(feature) {
    return true;
  }

  canPaste(feature) {
    return true;
  }

  prepareForPaste(feature, offset) {
    const oldCoordinates = feature.geometry.coordinates;
    const newCoordinates = [
      oldCoordinates[0] + offset.dx,
      oldCoordinates[1] + offset.dy,
    ];

    const newSelectionBox = this.geometry.calculateSelectionBoxGeometry(
      newCoordinates,
      feature.properties.width,
      feature.properties.height,
      feature.properties.size,
      feature.properties.rotation,
      feature.properties.createdAtZoom,
      this.selectionManager.uiManager,
      feature.properties.anchor
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

    const newSelectionBox = this.geometry.calculateSelectionBoxGeometry(
      newCoordinates,
      feature.properties.width,
      feature.properties.height,
      feature.properties.size,
      feature.properties.rotation,
      feature.properties.createdAtZoom,
      this.selectionManager.uiManager,
      feature.properties.anchor
    );

    const updatedFeature = {
      ...feature,
      geometry: this.geometry.generate(newCoordinates),
      properties: {
        ...feature.properties,
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
    this.updateButtonAppearance();
  };

  deactivate = () => {
    this.isActive = false;
    this.map.getCanvas().style.cursor = "";
    this.updateButtonAppearance();
    this.deselectFeature();
    this.cancelPendingSymbolUpdates();
  };

  updateButtonAppearance = () => {
    const iconSrc = this.isActive
      ? "./images/icon_coordination_red.svg"
      : "./images/icon_coordination_black.svg";
    const btn = document.getElementById('coordination-measure-tool');
    if (btn) btn.innerHTML = `<img class="icon-coordination-tool" src="${iconSrc}" alt="COORD" />`;
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

  hasEditHandle = (featureId) => {
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

    const data = await this.map.getSource("coordination_measures").getData();
    let hasChanges = false;

    features.forEach((inputFeature) => {
      if (inputFeature.properties.source === "coordination_measure") {
        const currentSourceFeature = data.features.find(
          (f) => f.properties.id === inputFeature.properties.id
        );

        if (currentSourceFeature) {
          const newSelectionBox = this.geometry.calculateSelectionBoxGeometry(
            currentSourceFeature.geometry.coordinates,
            currentSourceFeature.properties.width,
            currentSourceFeature.properties.height,
            currentSourceFeature.properties.size,
            currentSourceFeature.properties.rotation,
            currentSourceFeature.properties.createdAtZoom,
            this.selectionManager.uiManager,
            currentSourceFeature.properties.anchor
          );

          currentSourceFeature.properties.selectionBox = newSelectionBox;
          hasChanges = true;
        }
      }
    });

    if (hasChanges) {
      this.map.getSource("coordination_measures").setData(data);

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

  selectFeature = (feature) => {
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

    await this.createCoordinationMeasureFeature(e.lngLat);
    this.toolManager.deactivateCurrentTool();
  };

  createCoordinationMeasureFeature = async (lngLat) => {
    const featureId = IDUtils.generateUniqueId();
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
      id: Date.now().toString(),
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

      await addFeature("coordination_measures", feature);

      const data = await this.map.getSource("coordination_measures").getData();
      data.features.push(feature);
      this.map.getSource("coordination_measures").setData(data);

      await this.loadSymbolToMap(featureId, result.blob);

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
    const url = URL.createObjectURL(blob);

    return new Promise((resolve, reject) => {
      const image = new Image();

      image.onload = () => {
        try {
          if (this.map.hasImage(symbolId)) {
            this.map.removeImage(symbolId);
          }
          if (!this.map.hasImage(symbolId)) {
            this.map.addImage(symbolId, image);
          }
          URL.revokeObjectURL(url);
          resolve();
        } catch (error) {
          reject(error);
        }
      };

      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error(`Failed to load coordination measure symbol ${symbolId}`));
      };

      setTimeout(() => {
        URL.revokeObjectURL(url);
        reject(new Error(`Timeout loading coordination measure symbol ${symbolId}`));
      }, 10000);

      image.src = url;
    });
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

      const data = await this.map.getSource("coordination_measures").getData();
      const sourceFeature = data.features.find(
        f => f.properties.id === feature.properties.id
      );

      if (sourceFeature) {
        const newSelectionBox = this.geometry.calculateSelectionBoxGeometry(
          sourceFeature.geometry.coordinates,
          result.width,
          result.height,
          feature.properties.size,
          feature.properties.rotation,
          feature.properties.createdAtZoom,
          this.selectionManager.uiManager,
          result.anchor
        );

        feature.properties.selectionBox = newSelectionBox;

        sourceFeature.properties.imageUrl = result.dataUrl;
        sourceFeature.properties.width = result.width;
        sourceFeature.properties.height = result.height;
        sourceFeature.properties.anchor = result.anchor;
        sourceFeature.properties.selectionBox = newSelectionBox;
      }
      this.map.getSource("coordination_measures").setData(data);

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

      const data = await this.map.getSource("coordination_measures").getData();
      const sourceFeature = data.features.find(
        f => f.properties.id === feature.properties.id
      );

      if (sourceFeature) {
        const newSelectionBox = this.geometry.calculateSelectionBoxGeometry(
          sourceFeature.geometry.coordinates,
          result.width,
          result.height,
          feature.properties.size,
          feature.properties.rotation,
          feature.properties.createdAtZoom,
          this.selectionManager.uiManager,
          result.anchor
        );

        feature.properties.selectionBox = newSelectionBox;

        sourceFeature.properties.imageUrl = result.dataUrl;
        sourceFeature.properties.width = result.width;
        sourceFeature.properties.height = result.height;
        sourceFeature.properties.anchor = result.anchor;
        sourceFeature.properties.selectionBox = newSelectionBox;
      }
      this.map.getSource("coordination_measures").setData(data);

      await storeImage(symbolId, result.blob);

      if (this.map.hasImage(symbolId)) {
        this.map.removeImage(symbolId);
      }
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
    if (!features || !Array.isArray(features)) {
      return [];
    }

    const currentZoom = this.map.getZoom();
    return features.map((feature) => {
      const zoomDifference = currentZoom - feature.properties.createdAtZoom;
      const scaleFactor = Math.pow(2, zoomDifference);
      feature.properties.calculatedSize = Math.min(
        feature.properties.size * scaleFactor,
        10
      );
      return feature;
    });
  };

  updateAllSymbolSizes = async () => {
    if (!this.map.getSource("coordination_measures")) {
      this.pendingZoomUpdate = false;
      return;
    }

    const currentZoom = this.map.getZoom();
    const data = await this.map.getSource("coordination_measures").getData();
    let hasChanges = false;

    data.features.forEach((feature) => {
      const zoomDifference = currentZoom - feature.properties.createdAtZoom;
      const scaleFactor = Math.pow(2, zoomDifference);
      const newCalculatedSize = Math.min(
        feature.properties.size * scaleFactor,
        10
      );

      if (feature.properties.calculatedSize !== newCalculatedSize) {
        feature.properties.calculatedSize = newCalculatedSize;
        hasChanges = true;
      }
    });

    if (hasChanges) {
      this.map.getSource("coordination_measures").setData(data);
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
    const data = await this.map.getSource("coordination_measures").getData();

    for (const feature of features) {
      const sourceFeature = data.features.find(
        (f) => f.properties.id == feature.properties.id
      );
      if (sourceFeature) {
        sourceFeature.properties[property] = value;
        feature.properties[property] = value;

        if (property === "createdAtZoom") {
          const roundedValue = Math.round(value * 10) / 10;
          sourceFeature.properties[property] = roundedValue;
          feature.properties[property] = roundedValue;

          const currentZoom = this.map.getZoom();
          const zoomDifference = currentZoom - roundedValue;
          const scaleFactor = Math.pow(2, zoomDifference);

          const newCalculatedSize = Math.min(
            sourceFeature.properties.size * scaleFactor,
            10
          );
          sourceFeature.properties.calculatedSize = newCalculatedSize;
          feature.properties.calculatedSize = newCalculatedSize;
        } else {
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

          const currentZoom = this.map.getZoom();
          const zoomDifference =
            currentZoom - sourceFeature.properties.createdAtZoom;
          const scaleFactor = Math.pow(2, zoomDifference);
          sourceFeature.properties.calculatedSize = Math.min(
            sourceFeature.properties.size * scaleFactor,
            10
          );
          feature.properties.calculatedSize =
            sourceFeature.properties.calculatedSize;
        }

        if (
          this.geometry.affectsVisuals(property) ||
          property === "createdAtZoom"
        ) {
          const currentCoordinates = sourceFeature.geometry.coordinates;
          const newSelectionBox = this.geometry.calculateSelectionBoxGeometry(
            currentCoordinates,
            sourceFeature.properties.width,
            sourceFeature.properties.height,
            sourceFeature.properties.size,
            sourceFeature.properties.rotation,
            sourceFeature.properties.createdAtZoom,
            this.selectionManager.uiManager,
            sourceFeature.properties.anchor
          );

          sourceFeature.properties.selectionBox = newSelectionBox;
          feature.properties.selectionBox = newSelectionBox;
        }
      }
    }

    this.forceUpdateMainSource(data);
    const freshFeatures = features.map((feature) => {
      const sourceFeature = data.features.find(
        (f) => f.properties.id == feature.properties.id
      );
      return sourceFeature || feature;
    });
    this.updateSelectionManagerFeatures(freshFeatures);
    if (
      this.geometry.affectsVisuals(property) ||
      property === "createdAtZoom"
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
   * @param {Object} data - GeoJSON data
   */
  forceUpdateMainSource = (data) => {
    if (
      this.selectionManager.uiManager &&
      this.selectionManager.uiManager.isDragging
    ) {
      return;
    }

    this.map.getSource("coordination_measures").setData(data);
  };

  ensureFeatureConsistency = (
    feature,
    currentZoom = null,
    forceRecalculateSelectionBox = false
  ) => {
    const zoom = currentZoom || this.map.getZoom();

    const zoomDifference = zoom - feature.properties.createdAtZoom;
    const scaleFactor = Math.pow(2, zoomDifference);
    feature.properties.calculatedSize = Math.min(
      feature.properties.size * scaleFactor,
      10
    );

    if (forceRecalculateSelectionBox && !this.isSourceUpdateBlocked()) {
      feature.properties.selectionBox =
        this.geometry.calculateSelectionBoxGeometry(
          feature.geometry.coordinates,
          feature.properties.width,
          feature.properties.height,
          feature.properties.size,
          feature.properties.rotation,
          feature.properties.createdAtZoom,
          this.selectionManager.uiManager,
          feature.properties.anchor
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
    const currentData = await this.map.getSource("coordination_measures").getData();
    let hasChanges = false;

    for (const selectedFeature of features) {
      if (
        this.hasFeatureChanged(
          selectedFeature,
          initialPropertiesMap.get(selectedFeature.properties.id)
        )
      ) {
        const currentFeature = currentData.features.find(
          (f) => f.properties.id == selectedFeature.properties.id
        );

        if (currentFeature) {
          await updateFeature("coordination_measures", currentFeature);
          hasChanges = true;
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
        const featureId = feature.properties.id;

        await removeFeature("coordination_measures", featureId);

        await removeImage(featureId);

        const data = await this.map.getSource("coordination_measures").getData();
        const idsToDelete = new Set(
          features.map((f) => String(f.properties.id))
        );
        data.features = data.features.filter(
          (f) => !idsToDelete.has(String(f.properties.id))
        );
        this.map.getSource("coordination_measures").setData(data);
      } catch (error) {
        console.error(
          `Error removing coordination measure ${feature.properties.id}:`,
          error
        );
      }
    }
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
      feature.properties.bloqueado !== initialProperties.bloqueado ||
      JSON.stringify(feature.geometry.coordinates) !==
      JSON.stringify(initialProperties.coordinates)
    );
  };

  updateFeatures = async (
    features,
    save = false,
    onlyUpdateProperties = false
  ) => {
    if (features.length > 0) {
      const data = await this.map.getSource("coordination_measures").getData();
      const currentZoom = this.map.getZoom();

      for (const feature of features) {
        const featureIndex = data.features.findIndex(
          (f) => f.properties.id == feature.properties.id
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
            await updateFeature("coordination_measures", featureToUpdate);
          }
        }
      }

      this.forceUpdateMainSource(data);

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
      alert(message);
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
      alert(message);
    }
  }
}

export default AddCoordinationMeasureControl;
