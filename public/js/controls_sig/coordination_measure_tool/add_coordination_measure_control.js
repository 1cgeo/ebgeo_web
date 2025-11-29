// Path: js\controls_sig\coordination_measure_tool\add_coordination_measure_control.js

import {
  addFeature,
  updateFeature,
  removeFeature,
  storeImage,
  removeImage,
} from "../store/store.js";
import { CoordinationMeasureGenerator } from './coordination_measure_generator.js';
import { IDUtils } from "../id_utils.js";
import { addCoordinationMeasureAttributesToPanel } from "./coordination_measure_attributes_panel.js";
import AddCoordinationMeasureGeometry from './add_coordination_measure_geometry.js';
import BaseControl from "../tool_manager/base_control.js";

class AddCoordinationMeasureControl extends BaseControl {
  constructor(toolManager) {
    super(toolManager);

    // Geometry handler
    this.geometry = new AddCoordinationMeasureGeometry();

    // Symbol generator for coordination measures
    this.symbolGenerator = new CoordinationMeasureGenerator();

    // Performance optimization for symbols
    this.symbolRafId = null;
    this.pendingSymbolUpdate = false;
    this.lastSymbolFeature = null;
    this.symbolDebounceTimer = null;

    // Zoom handling for zoom-invariant behavior
    this.zoomRafId = null;
    this.pendingZoomUpdate = false;
  }

  static DEFAULT_PROPERTIES = {
    // Coordination measure specific
    pointCode: "130100", // Ponto genérico como padrão
    echelonCode: null,

    // Rendering properties
    size: 1.0,
    width: 100,
    height: 100,
    opacity: 1.0,
    rotation: 0,
    fillColor: null,

    // Zoom-invariant properties
    createdAtZoom: 0,
    calculatedSize: 1.0,
    selectionBox: null, // Pre-calculated GeoJSON Polygon geometry

    // Standard properties
    source: "coordination_measure",
    nome: "",
    descricao: "",
    visivel: true,
    bloqueado: false,

    // Text modifiers (nullable)
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

  // ===== FONTE ÚNICA DA VERDADE =====

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

  createAttributePanel(container, features, selectionManager, uiManager) {
    const sectionPanel = document.createElement("div");
    sectionPanel.className = "coordination-measure-attributes-section";

    try {
      addCoordinationMeasureAttributesToPanel(
        sectionPanel,
        features,
        this,
        selectionManager,
        uiManager
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
    return []; // Coordination measures don't have edit handles
  }

  createSelectionBox(feature) {
    // Coordination measures use pre-calculated selection boxes stored as properties
    if (feature.properties.selectionBox) {
      return { geometry: feature.properties.selectionBox };
    }

    // Fallback: calculate on demand if missing
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
    return "preCalculated"; // Coordination measures use stored selection boxes
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
    return null; // Coordination measures don't have edit handles
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

    // Recalculate selection box for new position
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

    // Recalculate selection box for new position
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
    $("#coordination-measure-tool").html(
      `<img class="icon-coordination-tool" src="${iconSrc}" alt="COORD" />`
    );
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
    return false; // Coordination measures don't have edit handles
  };

  hasEditHandle = (featureId) => {
    return false; // Coordination measures don't have edit handles
  };

  syncEditHandlesAfterDrag = (movedFeatures) => {
    // Coordination measures don't have edit handles, but we need to update selection boxes
    // Update selection boxes for moved features
    this.updateSelectionBoxesForFeatures(movedFeatures);
  };

  /**
   * Update selection boxes for specific features (used after drag or attribute changes)
   * Always uses fresh data from map source to ensure accuracy
   */
  updateSelectionBoxesForFeatures = async (features) => {
    if (!features || features.length === 0) return;

    // CRITICAL: Always get fresh data from map source
    const data = await this.map.getSource("coordination_measures").getData();
    let hasChanges = false;

    features.forEach((inputFeature) => {
      if (inputFeature.properties.source === "coordination_measure") {
        // Find the current feature in the map source (this has the latest coordinates)
        const currentSourceFeature = data.features.find(
          (f) => f.properties.id === inputFeature.properties.id
        );

        if (currentSourceFeature) {
          // Recalculate selection box using CURRENT coordinates from map source
          const newSelectionBox = this.geometry.calculateSelectionBoxGeometry(
            currentSourceFeature.geometry.coordinates, // Use fresh coordinates from map
            currentSourceFeature.properties.width,
            currentSourceFeature.properties.height,
            currentSourceFeature.properties.size,
            currentSourceFeature.properties.rotation,
            currentSourceFeature.properties.createdAtZoom,
            this.selectionManager.uiManager,
            currentSourceFeature.properties.anchor
          );

          // Update selection box in source feature
          currentSourceFeature.properties.selectionBox = newSelectionBox;
          hasChanges = true;
        }
      }
    });

    if (hasChanges) {
      // Update map source with new selection boxes
      this.map.getSource("coordination_measures").setData(data);

      // Get fresh features from updated source for SelectionManager
      const freshFeatures = features.map((inputFeature) => {
        const sourceFeature = data.features.find(
          (f) => f.properties.id === inputFeature.properties.id
        );
        return sourceFeature || inputFeature; // Fallback to input if not found
      });

      // Update SelectionManager with fresh features
      this.updateSelectionManagerFeatures(freshFeatures);

      // Force selection highlight update
      requestAnimationFrame(() => {
        if (this.selectionManager.uiManager.updateSelectionHighlight) {
          this.selectionManager.uiManager.updateSelectionHighlight();
        }
      });
    }
  };

  selectFeature = (feature) => {
    // Coordination measures don't have edit handles, just selection feedback
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
    
    // Use pointCode from DEFAULT_PROPERTIES
    const pointCode = AddCoordinationMeasureControl.DEFAULT_PROPERTIES.pointCode;

    // Calculate initial selection box with default dimensions
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
        id: featureId,
        nome: featureName,
        pointCode: pointCode,
        createdAtZoom: currentZoom,
        calculatedSize: AddCoordinationMeasureControl.DEFAULT_PROPERTIES.size,
        selectionBox: selectionBox,
        // Explicitly initialize all text modifiers to null
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
      // Determine actual point code to use
      let actualPointCode = pointCode;
      
      // Handle echelon placeholders - use the actual echelon code
      if (actualPointCode === 'ECHELON' || actualPointCode === 'ECHELON_FT') {
        actualPointCode = feature.properties.echelonCode || 
          (actualPointCode === 'ECHELON' ? 'ECHELON_16' : 'ECHELON_FT_16');
      }
      
      // ✅ Generate symbol and CAPTURE REAL DIMENSIONS
      const result = await this.symbolGenerator.generate(
        actualPointCode,
        feature.properties
      );

      // ✅ UPDATE feature with real dimensions from generated image
      feature.properties.imageUrl = result.dataUrl;
      feature.properties.width = result.width;
      feature.properties.height = result.height;
      feature.properties.anchor = result.anchor;

      // ✅ RECALCULATE selection box with real dimensions
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

      // Store image (blob only)
      await storeImage(featureId, result.blob);

      // Add to storage
      await addFeature("coordination_measures", feature);

      // Add to map
      const data = await this.map.getSource("coordination_measures").getData();
      data.features.push(feature);
      this.map.getSource("coordination_measures").setData(data);

      // Load symbol image to map for rendering
      await this.loadSymbolToMap(featureId, result.blob);

      // Select the new feature
      this.selectionManager.toggleFeatureSelection(
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

      // Collect properties for regeneration
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

      // Determine actual point code to use
      let actualPointCode = feature.properties.pointCode;
      
      // Handle echelon placeholders - use the actual echelon code
      if (actualPointCode === 'ECHELON' || actualPointCode === 'ECHELON_FT') {
        actualPointCode = feature.properties.echelonCode || 
          (actualPointCode === 'ECHELON' ? 'ECHELON_16' : 'ECHELON_FT_16');
      }

      // ✅ Generate symbol with dimensions
      const result = await this.symbolGenerator.generate(
        actualPointCode,
        properties
      );

      // ✅ UPDATE dimensions in feature
      feature.properties.imageUrl = result.dataUrl;
      feature.properties.width = result.width;
      feature.properties.height = result.height;
      feature.properties.anchor = result.anchor;

      // ✅ GET CURRENT coordinates from map source BEFORE recalculating selection box
      const data = await this.map.getSource("coordination_measures").getData();
      const sourceFeature = data.features.find(
        f => f.properties.id === feature.properties.id
      );
      
      if (sourceFeature) {
        // ✅ RECALCULATE selection box using CURRENT coordinates from source
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
        
        // ✅ PERSIST changes to map source
        sourceFeature.properties.imageUrl = result.dataUrl;
        sourceFeature.properties.width = result.width;
        sourceFeature.properties.height = result.height;
        sourceFeature.properties.anchor = result.anchor;
        sourceFeature.properties.selectionBox = newSelectionBox;
      }
      this.map.getSource("coordination_measures").setData(data);

      // Update imageStore and map
      await storeImage(symbolId, result.blob);
      await this.loadSymbolToMap(symbolId, result.blob);

      // ✅ INVALIDATE cache for this feature (anchor/selectionBox changed)
      if (this.selectionManager.uiManager.invalidateCache) {
        this.selectionManager.uiManager.invalidateCache(symbolId);
      }

      // ✅ UPDATE selection highlight
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

  // Alias method for compatibility with attributes panel
  async updateSymbolImage(feature) {
    try {
      const symbolId = feature.properties.id;

      // Collect properties for regeneration
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

      // Determine actual point code to use
      let actualPointCode = feature.properties.pointCode;
      
      // Handle echelon placeholders - use the actual echelon code
      if (actualPointCode === 'ECHELON' || actualPointCode === 'ECHELON_FT') {
        actualPointCode = feature.properties.echelonCode || 
          (actualPointCode === 'ECHELON' ? 'ECHELON_16' : 'ECHELON_FT_16');
      }

      // ✅ Generate symbol with dimensions
      const result = await this.symbolGenerator.generate(
        actualPointCode,
        properties
      );

      feature.properties.imageUrl = result.dataUrl;
      feature.properties.width = result.width;
      feature.properties.height = result.height;
      feature.properties.anchor = result.anchor;

      // ✅ GET CURRENT coordinates from map source BEFORE recalculating selection box
      const data = await this.map.getSource("coordination_measures").getData();
      const sourceFeature = data.features.find(
        f => f.properties.id === feature.properties.id
      );
      
      if (sourceFeature) {
        // ✅ RECALCULATE selection box using CURRENT coordinates from source
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
        
        // ✅ PERSIST changes to map source
        sourceFeature.properties.imageUrl = result.dataUrl;
        sourceFeature.properties.width = result.width;
        sourceFeature.properties.height = result.height;
        sourceFeature.properties.anchor = result.anchor;
        sourceFeature.properties.selectionBox = newSelectionBox;
      }
      this.map.getSource("coordination_measures").setData(data);

      // Update imageStore
      await storeImage(symbolId, result.blob);

      // Remove old image from map and add new one
      if (this.map.hasImage(symbolId)) {
        this.map.removeImage(symbolId);
      }
      await this.loadSymbolToMap(symbolId, result.blob);

      // ✅ INVALIDATE cache for this feature (anchor/selectionBox changed)
      if (this.selectionManager.uiManager.invalidateCache) {
        this.selectionManager.uiManager.invalidateCache(symbolId);
      }

      // ✅ UPDATE selection highlight
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

  // Alias method for compatibility with attributes panel
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
    // Defensive validation: protect against undefined, null or non-array
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

        // Special handling for createdAtZoom
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
          // Check if property requires regeneration using geometry methods
          const needsRegeneration =
            this.geometry.affectsSIDC(property) ||
            this.geometry.affectsTextModifiers(property);

          if (needsRegeneration) {
            // Update symbol code if SIDC-affecting property changed
            if (this.geometry.affectsSIDC(property)) {
              // For coordination measures, pointCode/echelonCode changes
              // are direct property updates (no complex SIDC building needed)
            }

            const symbolCodeChanged = this.geometry.affectsSIDC(property);
            const textModifierChanged = this.geometry.affectsTextModifiers(property);

            if (symbolCodeChanged || textModifierChanged) {
              this.scheduleSymbolUpdate(feature);
            }
          }

          // Update calculatedSize for consistency
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

        // For visual properties, recalculate selection box using CURRENT geometry
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
   * Force update main source with drag protection (same pattern as military symbol control)
   */
  forceUpdateMainSource = (data) => {
    // PERFORMANCE FIX: Don't update source during drag operations to prevent conflicts
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

    // Always recalculate calculatedSize based on current zoom
    const zoomDifference = zoom - feature.properties.createdAtZoom;
    const scaleFactor = Math.pow(2, zoomDifference);
    feature.properties.calculatedSize = Math.min(
      feature.properties.size * scaleFactor,
      10
    );

    // Only recalculate selection box if explicitly requested and not during drag
    if (forceRecalculateSelectionBox && !this.isSourceUpdateBlocked()) {
      feature.properties.selectionBox =
        this.geometry.calculateSelectionBoxGeometry(
          feature.geometry.coordinates,
          feature.properties.width,
          feature.properties.height,
          feature.properties.size, // Use original size, not calculatedSize
          feature.properties.rotation,
          feature.properties.createdAtZoom, // CRUCIAL: creation zoom
          this.selectionManager.uiManager,
          feature.properties.anchor
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
    // Always get fresh feature data from map source before saving
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
          // Use complete current feature (with updated geometry + properties)
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

      // Check if any property that requires regeneration changed
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

        // Remove from storage
        await removeFeature("coordination_measures", featureId);

        // Remove image from store
        await removeImage(featureId);

        // Update map source
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
    // Text modifiers são conteúdo específico de cada símbolo, não configurações padrão
    const TEXT_MODIFIERS = [
      'tipo', 'identificacao', 'gdhIni', 'gdhFim', 'numero',
      'classeSuprimento', 'status', 'numeroConcentracao', 'altitude'
    ];

    // Criar cópia das propriedades SEM text modifiers
    const safeProperties = { ...properties };
    TEXT_MODIFIERS.forEach(key => {
      delete safeProperties[key];
    });

    // Aplicar apenas propriedades seguras (configurações de estilo)
    Object.assign(AddCoordinationMeasureControl.DEFAULT_PROPERTIES, safeProperties);

    // Isso garante que mesmo se houve contaminação anterior, ela é limpa
    TEXT_MODIFIERS.forEach(key => {
      AddCoordinationMeasureControl.DEFAULT_PROPERTIES[key] = null;
    });
  };

  hasFeatureChanged = (feature, initialProperties) => {
    if (!initialProperties) return true;

    return (
      // All coordination measure specific properties
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

          // Ensure consistency for updated feature
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

      // CRITICAL FIX: Use protected method for source updates
      this.forceUpdateMainSource(data);

      // Update SelectionManager with updated features
      this.updateSelectionManagerFeatures(features);
    }
  };

  // ===== SELECTION MANAGER INTEGRATION =====

  /**
   * Update SelectionManager with current feature data
   */
  updateSelectionManagerFeature(feature) {
    const key = `coordination_measure:${feature.properties.id}`;
    this.selectionManager.selectedFeatures.set(key, {
      type: "coordination_measure",
      feature,
    });
  }

  /**
   * Update SelectionManager with multiple features
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
    // Base listeners setup if needed
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
   * Show success message
   * @param {string} message - Success message
   */
  showSuccess(message) {
    if (this.toolManager.uiManager && this.toolManager.uiManager.showNotification) {
      this.toolManager.uiManager.showNotification(message, 'success');
    } else {
      console.log('✓', message);
    }
  }

  /**
   * Show error message
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
   * Show warning message
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