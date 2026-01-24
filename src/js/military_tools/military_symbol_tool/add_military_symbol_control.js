// Path: js/military_tools/military_symbol_tool/add_military_symbol_control.js

import { normalizeSIDC } from './brazilian_sidc_extension.js';
import {
  addFeature,
  updateFeature,
  removeFeature,
  storeImage,
  removeImage,
  getActiveLayerIdSync
} from '../../store';
import { MilitarySymbolGenerator } from "./military_symbol_generator.js";
import { IDUtils } from "../../utilities";
import { addMilitarySymbolAttributesToPanel } from "./attributes/index.js";
import AddMilitarySymbolGeometry from "./add_military_symbol_geometry.js";
import { BaseControl } from "../../tool_manager";

class AddMilitarySymbolControl extends BaseControl {
  constructor(toolManager) {
    super(toolManager);

    // Geometry handler
    this.geometry = new AddMilitarySymbolGeometry();

    // Symbol generator for military symbols
    this.symbolGenerator = new MilitarySymbolGenerator();

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
    // SIDC component fields (MIL-STD-2525D)
    context: "0",
    standardIdentity: "3",
    status: "0",
    symbolSet: "10",  // Default to Land Units
    hqTfDummy: "0",
    echelon: "16",
    mainIcon: "121100",
    modifier1: "00",
    modifier2: "00",

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
    source: "military_symbol",
    nome: "",
    descricao: "",
    visivel: true,
    bloqueado: false,

    uniqueDesignation: null,      // C - Designation
    higherFormation: null,        // B - Higher Formation
    quantity: null,               // C1 - Quantity
    reinforcedReduced: null,      // F - Reinforced/Reduced
    additionalInformation: null,  // H - Additional Information
    credibility: null,            // J - Credibility
    location: null,               // Y - Location
    dateTimeGroup: null,          // W - Date-Time Group
    altitudeDepth: null,          // X - Altitude/Depth
    speed: null,                  // Z - Speed
    specialHeadquarters: null,    // AA - HQ Type
    type: null,                   // V - Equipment Type
    iffSif: null,                 // P - IFF/SIF Code
    equipmentTeardownTime: null,  // X1 - Equipment Teardown Time
    direction: null,               // Q - Direction/Azimuth
    engagementBar: null
  };

  // ===== SINGLE SOURCE OF TRUTH =====

  /**
   * Get currently selected military symbol feature from SelectionManager
   * @returns {Object|null} Selected military symbol feature or null
   */
  getSelectedFeature() {
    const selectedItems =
      this.selectionManager.getSelectedFeaturesByType("military_symbol");
    return selectedItems.length > 0 ? selectedItems[0].feature : null;
  }

  /**
   * Get all selected military symbol features from SelectionManager
   * @returns {Array} Array of selected military symbol features
   */
  getSelectedFeatures() {
    return this.selectionManager
      .getSelectedFeaturesByType("military_symbol")
      .map((item) => item.feature);
  }

  // ===== MAPBOX CONTROL INTERFACE =====

  onAdd = (map) => {
    this.map = map;
    this.setupZoomListener();
  };

  onRemove = () => {
    this.map.off("zoom", this.handleZoomChange);
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
    return []; // Military symbols don't have edit handles
  }

  createSelectionBox(feature) {
    // Military symbols use pre-calculated selection boxes stored as properties
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
      this.selectionManager.uiManager
    );

    return { geometry: selectionBox };
  }

  getSelectionBoxStrategy() {
    return "preCalculated"; // Military symbols use stored selection boxes
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
    return null; // Military symbols don't have edit handles
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
      this.selectionManager.uiManager
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
      this.selectionManager.uiManager
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
    return false; // Military symbols don't have edit handles
  };

  hasEditHandle = (featureId) => {
    return false; // Military symbols don't have edit handles
  };

  syncEditHandlesAfterDrag = (movedFeatures) => {
    // Military symbols don't have edit handles, but we need to update selection boxes
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
    const data = await this.map.getSource("military_symbols").getData();
    let hasChanges = false;

    features.forEach((inputFeature) => {
      if (inputFeature.properties.source === "military_symbol") {
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
            this.selectionManager.uiManager
          );

          // Update selection box in source feature
          currentSourceFeature.properties.selectionBox = newSelectionBox;
          hasChanges = true;
        }
      }
    });

    if (hasChanges) {
      // Update map source with new selection boxes
      this.map.getSource("military_symbols").setData(data);

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
    // Military symbols don't have edit handles, just selection feedback
    this.setupHoverListeners();
  };

  deselectFeature = () => {
    this.removeHoverListeners();
    this.map.getCanvas().style.cursor = "";
  };

  // ===== MILITARY SYMBOL CREATION SYSTEM =====

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
    const featureId = IDUtils.generateUniqueId();
    const featureName = await IDUtils.generateFeatureName(
      "military_symbol",
      this.map
    );

    const currentZoom = this.map.getZoom();
    const coordinates = [lngLat.lng, lngLat.lat];

    // Build initial SIDC from default properties (20 digits)
    const sidc30 = this.symbolGenerator.buildSIDC(
      AddMilitarySymbolControl.DEFAULT_PROPERTIES
    );

    // Calculate initial selection box
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
      id: Date.now().toString(),
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
      // ✅ Generate symbol and CAPTURE REAL DIMENSIONS
      const result = await this.symbolGenerator.generateSymbolBlob(
        feature.properties
      );

      // UPDATE feature with real dimensions from generated image
      feature.properties.width = result.width;
      feature.properties.height = result.height;

      // RECALCULATE selection box with real dimensions
      feature.properties.selectionBox = this.geometry.calculateSelectionBoxGeometry(
        coordinates,
        result.width,
        result.height,
        feature.properties.size,
        feature.properties.rotation,
        currentZoom,
        this.selectionManager.uiManager
      );

      // Store image (blob only)
      await storeImage(featureId, result.blob);

      // Add to storage
      await addFeature("military_symbols", feature);

      // Add to map
      const data = await this.map.getSource("military_symbols").getData();
      data.features.push(feature);
      this.map.getSource("military_symbols").setData(data);

      // Load symbol image to map for rendering
      await this.loadSymbolToMap(featureId, result.blob);

      // Select the new feature
      await this.selectionManager.toggleFeatureSelection(
        "military_symbol",
        featureId,
        feature
      );
      this.selectionManager.updateUI();
    } catch (error) {
      console.error("Error creating military symbol feature:", error);
      alert("Erro ao criar símbolo militar");
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
        reject(new Error(`Failed to load military symbol ${symbolId}`));
      };

      setTimeout(() => {
        URL.revokeObjectURL(url);
        reject(new Error(`Timeout loading military symbol ${symbolId}`));
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

      // ✅ Generate symbol with dimensions
      const result = await this.symbolGenerator.generateSymbolBlob(
        feature.properties
      );

      // UPDATE dimensions in feature
      feature.properties.width = result.width;
      feature.properties.height = result.height;

      // RECALCULATE selection box with new dimensions
      feature.properties.selectionBox = this.geometry.recalculateSelectionBox(
        feature,
        this.selectionManager.uiManager
      );

      // PERSIST changes to map source
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

      // Update imageStore and map
      await storeImage(symbolId, result.blob);
      await this.loadSymbolToMap(symbolId, result.blob);

      // ✅ INVALIDATE cache for this feature (dimensions/selectionBox changed)
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
      console.error("Error updating symbol:", error);
    }

    this.pendingSymbolUpdate = false;
    this.lastSymbolFeature = null;
  };

  // Alias method for compatibility with attributes panel
  async updateSymbolImage(feature) {
    try {
      const symbolId = feature.properties.id;

      // ✅ Generate symbol with dimensions
      const result = await this.symbolGenerator.generateSymbolBlob(
        feature.properties
      );

      feature.properties.width = result.width;
      feature.properties.height = result.height;

      feature.properties.selectionBox = this.geometry.recalculateSelectionBox(
        feature,
        this.selectionManager.uiManager
      );

      // PERSIST changes to map source
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

      // Update imageStore
      await storeImage(symbolId, result.blob);

      // Remove old image from map and add new one
      if (this.map.hasImage(symbolId)) {
        this.map.removeImage(symbolId);
      }
      await this.loadSymbolToMap(symbolId, result.blob);

      // INVALIDATE cache for this feature (dimensions/selectionBox changed)
      if (this.selectionManager.uiManager.invalidateCache) {
        this.selectionManager.uiManager.invalidateCache(symbolId);
      }

      // UPDATE selection highlight
      if (this.selectionManager.uiManager.updateSelectionHighlight) {
        requestAnimationFrame(() => {
          this.selectionManager.uiManager.updateSelectionHighlight();
        });
      }
    } catch (error) {
      console.error("Error updating symbol image:", error);
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
    if (!this.map.getSource("military_symbols")) {
      this.pendingZoomUpdate = false;
      return;
    }

    const currentZoom = this.map.getZoom();
    const data = await this.map.getSource("military_symbols").getData();
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
      this.map.getSource("military_symbols").setData(data);
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
        f.source === "military_symbols" &&
        f.properties.id === selectedFeature.properties.id
    );
  };

  // ===== GALLERY METHODS (for Attributes Panel) =====

  getDistinctSymbolsByUsage = async () => {
    if (!this.map.getSource("military_symbols")) {
      return [];
    }

    const data = await this.map.getSource("military_symbols").getData();
    const symbolCounts = new Map(); // Map<sidc, {feature, count}>

    // Count occurrences of each SIDC
    data.features.forEach((feature) => {
      const sidc = feature.properties.sidc;
      if (symbolCounts.has(sidc)) {
        symbolCounts.get(sidc).count++;
      } else {
        symbolCounts.set(sidc, { feature, count: 1 });
      }
    });

    // Sort by count (most used first) and limit to 20
    return Array.from(symbolCounts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 20)
      .map((item) => ({ ...item.feature, usageCount: item.count }));
  };

  // ===== FEATURE MANAGEMENT INTERFACE =====

  updateFeaturesProperty = async (features, property, value) => {
    const data = await this.map.getSource("military_symbols").getData();

    for (const feature of features) {
      const sourceFeature = data.features.find(
        (f) => f.properties.id == feature.properties.id
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
          const needsRegeneration =
            this.geometry.affectsSIDC(property) ||
            this.geometry.affectsTextModifiers(property) ||
            property === "fillColor";

          if (needsRegeneration) {
            // Calculate new SIDC if SIDC-affecting property changed
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
            const textModifierChanged = this.geometry.affectsTextModifiers(property);  // ✅ NEW

            if (sidcChanged || colorChanged || textModifierChanged) {
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
            this.selectionManager.uiManager
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
   * Force update main source with drag protection (same pattern as circle control)
   */
  forceUpdateMainSource = (data) => {
    // PERFORMANCE FIX: Don't update source during drag operations to prevent conflicts
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
          this.selectionManager.uiManager
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
    const currentData = await this.map.getSource("military_symbols").getData();
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
          await updateFeature("military_symbols", currentFeature);
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

      // If SIDC or fillColor changed, regenerate symbol
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

        // Remove from storage
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
    // Text modifiers are symbol-specific content, not default configuration settings
    const TEXT_MODIFIERS = [
      'uniqueDesignation',
      'higherFormation',
      'reinforcedReduced',
      'additionalInformation',
      'credibility',
      'location',
      'dateTimeGroup',
      'altitudeDepth',
      'speed',
      'specialHeadquarters',
      'type',
      'iffSif',
      'equipmentTeardownTime',
      'direction',
      'engagementBar'
    ];

    // Create copy of properties WITHOUT text modifiers
    const safeProperties = { ...properties };
    TEXT_MODIFIERS.forEach(key => {
      delete safeProperties[key];
    });

    // Apply only safe properties (style configuration)
    Object.assign(AddMilitarySymbolControl.DEFAULT_PROPERTIES, safeProperties);

    // This ensures that even if there was previous contamination, it is cleaned
    TEXT_MODIFIERS.forEach(key => {
      AddMilitarySymbolControl.DEFAULT_PROPERTIES[key] = null;
    });
  };

  hasFeatureChanged = (feature, initialProperties) => {
    if (!initialProperties) return true;

    return (
      // All military symbol specific properties
      feature.properties.context !== initialProperties.context ||
      feature.properties.standardIdentity !==
      initialProperties.standardIdentity ||
      feature.properties.status !== initialProperties.status ||
      feature.properties.hqTfDummy !== initialProperties.hqTfDummy ||
      feature.properties.echelon !== initialProperties.echelon ||
      feature.properties.mainIcon !== initialProperties.mainIcon ||
      feature.properties.modifier1 !== initialProperties.modifier1 ||
      feature.properties.modifier2 !== initialProperties.modifier2 ||
      feature.properties.size !== initialProperties.size ||
      feature.properties.opacity !== initialProperties.opacity ||
      feature.properties.rotation !== initialProperties.rotation ||
      feature.properties.fillColor !== initialProperties.fillColor ||
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
      const data = await this.map.getSource("military_symbols").getData();
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
            await updateFeature("military_symbols", featureToUpdate);
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
}

export default AddMilitarySymbolControl;
