// Path: js/draw_tools/image_tool/add_image_control.js

import {
  addFeature,
  updateFeature,
  removeFeature,
  storeImage,
  getActiveLayerIdSync
} from "../../store";
import { IDUtils, showError, loadImageToMap as utilLoadImageToMap } from "../../utilities";
import { uploadImageBlob } from "../../store/sync/image-sync.js";
import { addImageAttributesToPanel } from "./image_attributes_panel.js";
import AddImageGeometry from "./add_image_geometry.js";
import { BaseControl } from "../../tool_manager";
import {
    applyZoomCorrections as applyZoomCorrectionsUtil,
    calculateZoomCorrectedValue,
} from '../../tool_manager/helpers/zoom-correction.helpers.js';

class AddImageControl extends BaseControl {
    featureType = 'image';
  constructor(toolManager) {
    super(toolManager);

    this.geometry = new AddImageGeometry();
    this.zoomRafId = null;
    this.pendingZoomUpdate = false;
    this.zoomCorrectionEnabled = true;
    this._name = 'AddImageControl';
  }

  static DEFAULT_PROPERTIES = {
    size: 1,
    rotation: 0,
    opacity: 1,
    source: "image",
    createdAtZoom: 0,
    calculatedSize: 1,
    zoomCorrectionEnabled: true,
    selectionBox: null,
    nome: "",
    descricao: "",
    visivel: true,
    bloqueado: false,
  };

  static MAX_IMAGE_DIMENSION = 800;
  static IMAGE_QUALITY = 0.7;

  // ===== SINGLE SOURCE OF TRUTH =====

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
    sectionPanel.className = "image-attributes-section";

    try {
      addImageAttributesToPanel(
        sectionPanel,
        features,
        this,
        selectionManager,
        uiManager,
        options
      );
      container.appendChild(sectionPanel);
    } catch (error) {
      console.error("Error creating image attribute panel:", error);
    }
  }

  getDragSources() {
    return ["images"];
  }

  getEditHandleSources() {
    return [];
  }

  createSelectionBox(feature) {
    if (feature.properties.selectionBox) {
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
    return ["images-layer"];
  }

  getSourceNames() {
    return ["images"];
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

    return {
      ...feature,
      geometry: this.geometry.generate(newCoordinates),
      properties: {
        ...feature.properties,
        selectionBox: newSelectionBox,
      },
    };
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

  syncEditHandlesAfterDrag = (_movedFeatures) => {
  };

  selectFeature = (_feature) => {
    this.setupHoverListeners();
  };

  deselectFeature = () => {
    this.removeHoverListeners();
    this.map.getCanvas().style.cursor = "";
  };

  // ===== FILE UPLOAD SYSTEM =====

  handleMapClick = (e) => {
    if (!this.isActive) return;

    if (!e.lngLat || isNaN(e.lngLat.lng) || isNaN(e.lngLat.lat)) {
      console.warn("Invalid coordinates for image");
      return;
    }

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async (event) => {
      const file = event.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = async () => {
          const imageBase64 = reader.result;
          await this.addImageFeature(e.lngLat, imageBase64);
        };
        reader.readAsDataURL(file);
      }
    };
    input.click();
    this.toolManager.deactivateCurrentTool();
  };

  addImageFeature = async (lngLat, imageBase64) => {
    this.resizeImage(imageBase64, async (resizedImageBase64, width, height) => {
      try {
        const response = await fetch(resizedImageBase64);
        const blob = await response.blob();
        // §17.14: when online, upload so collaborators can fetch the photo; the
        // backend image id becomes the feature's imageId. Offline → a local id.
        const uploaded = await uploadImageBlob(blob, 'photo.png');
        const imageId = uploaded?.id || IDUtils.generateUniqueId();
        await storeImage(imageId, blob);

        const feature = this.createImageFeature(lngLat, imageId, width, height);

        const currentZoom = this.map.getZoom();
        feature.properties.createdAtZoom = currentZoom;
        feature.properties.calculatedSize = feature.properties.size;

        feature.properties.selectionBox =
          this.geometry.calculateSelectionBoxGeometry(
            feature.geometry.coordinates,
            feature.properties.width,
            feature.properties.height,
            feature.properties.size,
            feature.properties.rotation,
            feature.properties.createdAtZoom,
            this.selectionManager.uiManager
          );

        feature.properties.nome = await IDUtils.generateFeatureName(
          "image",
          this.map
        );

        await this.loadImageToMap(imageId, blob);

        await addFeature("images", feature);

        const data = await this.map.getSource("images").getData();
        data.features.push(feature);
        this.map.getSource("images").setData(data);

        await this.selectionManager.toggleFeatureSelection("image", imageId, feature);
        this.selectionManager.updateUI();
      } catch (error) {
        console.error("Error adding image feature:", error);
        showError("Erro ao adicionar imagem");
      }
    });
  };

  createImageFeature = (lngLat, imageId, width, height) => {
    return {
      type: "Feature",
      id: IDUtils.generateGeoJSONId(),
      properties: {
        ...AddImageControl.DEFAULT_PROPERTIES,
        width,
        height,
        id: imageId,
        layerId: getActiveLayerIdSync(),
      },
      geometry: this.geometry.generate([lngLat.lng, lngLat.lat]),
    };
  };

  // ===== IMAGE PROCESSING =====

  resizeImage = (imageBase64, callback) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      const aspectRatio = width / height;

      if (
        width > AddImageControl.MAX_IMAGE_DIMENSION ||
        height > AddImageControl.MAX_IMAGE_DIMENSION
      ) {
        if (width > height) {
          width = AddImageControl.MAX_IMAGE_DIMENSION;
          height = Math.round(width / aspectRatio);
        } else {
          height = AddImageControl.MAX_IMAGE_DIMENSION;
          width = Math.round(height * aspectRatio);
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");

      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      let imageType = "image/png";
      if (imageBase64.startsWith("data:image/jpeg")) {
        imageType = "image/jpeg";
      } else if (imageBase64.startsWith("data:image/gif")) {
        imageType = "image/gif";
      }

      const resizedImageBase64 = canvas.toDataURL(
        imageType,
        AddImageControl.IMAGE_QUALITY
      );
      callback(resizedImageBase64, width, height);
    };
    img.src = imageBase64;
  };

  // ===== BLOB STORAGE METHODS =====

  async loadImageToMap(imageId, blob) {
    return utilLoadImageToMap(this.map, imageId, blob);
  }

  // ===== ZOOM-INVARIANT SYSTEM =====

  setupZoomListener = () => {
    this.map.on("zoom", this.handleZoomChange);
  };

  handleZoomChange = () => {
    if (!this.pendingZoomUpdate) {
      this.pendingZoomUpdate = true;
      this.zoomRafId = requestAnimationFrame(this.updateAllImageSizes);
    }
  };

  applyZoomCorrections = (features) => {
    return applyZoomCorrectionsUtil(features, this.map.getZoom(), {
      sourceProperty: 'size',
      calculatedProperty: 'calculatedSize',
      maxValue: 10,
    });
  };

  updateAllImageSizes = async () => {
    if (!this.map.getSource("images")) {
      this.pendingZoomUpdate = false;
      return;
    }

    const currentZoom = this.map.getZoom();
    const data = await this.map.getSource("images").getData();
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
      this.map.getSource("images").setData(data);

      // Update SelectionManager with fresh features that have updated selectionBox
      const selectedFeatures = this.getSelectedFeatures();
      const featuresWithDisabledZoomCorrection = selectedFeatures.filter(
        f => f.properties.zoomCorrectionEnabled === false
      );
      if (featuresWithDisabledZoomCorrection.length > 0) {
        featuresWithDisabledZoomCorrection.forEach(selectedFeature => {
          const freshFeature = data.features.find(f => f.properties.id === selectedFeature.properties.id);
          if (freshFeature) {
            this.selectionManager.updateSelectedFeature('image', freshFeature.properties.id, freshFeature);
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
        f.source === "images" &&
        f.properties.id === selectedFeature.properties.id
    );
  };

  // ===== FEATURE MANAGEMENT INTERFACE =====

  updateFeaturesProperty = async (features, property, value) => {
    const data = await this.map.getSource("images").getData();

    for (const feature of features) {
      const sourceFeature = data.features.find(
        (f) => f.properties.id === feature.properties.id
      );
      if (sourceFeature) {
        sourceFeature.properties[property] = value;
        feature.properties[property] = value;

        // Round createdAtZoom to 1 decimal
        if (property === 'createdAtZoom') {
          const roundedValue = Math.round(value * 10) / 10;
          sourceFeature.properties[property] = roundedValue;
          feature.properties[property] = roundedValue;
        }

        const shouldRecalculateSelectionBox =
          ['size', 'rotation', 'zoomCorrectionEnabled', 'createdAtZoom'].includes(property);

        this.ensureFeatureConsistency(sourceFeature, null, shouldRecalculateSelectionBox);

        feature.properties.calculatedSize = sourceFeature.properties.calculatedSize;
        feature.properties.selectionBox = sourceFeature.properties.selectionBox;
      }
    }

    this.map.getSource("images").setData(data);
    this.updateSelectionManagerFeatures(features);
  };

  ensureFeatureConsistency = (
    feature,
    currentZoom = null,
    forceRecalculateSelectionBox = false
  ) => {
    const zoom = currentZoom || this.map.getZoom();

    feature.properties.calculatedSize = calculateZoomCorrectedValue(
      feature.properties, zoom,
      { sourceProperty: 'size', maxValue: 10 }
    );

    if (forceRecalculateSelectionBox || !feature.properties.selectionBox) {
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
  };

  saveFeatures = async (features, initialPropertiesMap) => {
    const currentData = await this.map.getSource("images").getData();

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
          await updateFeature("images", currentFeature);
        }
      }
    }
  };

  discardChangeFeatures = async (features, initialPropertiesMap) => {
    features.forEach((f) => {
      const initialProps = initialPropertiesMap.get(f.properties.id);
      Object.assign(f.properties, initialProps);
      f.geometry = this.geometry.generate(f.geometry.coordinates);
    });

    await this.updateFeatures(features, true, true);
  };

  deleteFeatures = async (features) => {
    if (features.length === 0) return;

    for (const feature of features) {
      try {
        const featureId = feature.properties.id;

        await removeFeature("images", featureId);

        // Release the MapLibre image (GPU texture). The IndexedDB blob is released
        // later, on undo-history eviction, so an Undo can still restore the image.
        if (this.map.hasImage(featureId)) {
          this.map.removeImage(featureId);
        }

        const data = await this.map.getSource("images").getData();
        const idsToDelete = new Set(
          features.map((f) => String(f.properties.id))
        );
        data.features = data.features.filter(
          (f) => !idsToDelete.has(String(f.properties.id))
        );
        this.map.getSource("images").setData(data);
      } catch (error) {
        console.error(`Error removing image ${feature.properties.id}:`, error);
      }
    }
  };

  setDefaultProperties = (properties) => {
    Object.assign(AddImageControl.DEFAULT_PROPERTIES, properties);
  };

  hasFeatureChanged = (feature, initialProperties) => {
    if (!initialProperties) return true;

    return (
      feature.properties.size !== initialProperties.size ||
      feature.properties.rotation !== initialProperties.rotation ||
      feature.properties.opacity !== initialProperties.opacity ||
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
      const data = await this.map.getSource("images").getData();
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
            await updateFeature("images", featureToUpdate);
          }
        }
      }

      this.map.getSource("images").setData(data);
      this.updateSelectionManagerFeatures(features);
    }
  };
  /**
   * Update SelectionManager with current feature data
   * @param {Object} feature - Feature to update in SelectionManager
   */
  updateSelectionManagerFeature(feature) {
    this.selectionManager.updateSelectedFeature('image', feature.properties.id, feature);
  }

  /**
   * Update SelectionManager with multiple features
   * @param {Array} features - Features to update in SelectionManager
   */
  updateSelectionManagerFeatures(features) {
    features.forEach((feature) => {
      if (feature.properties.source === "image") {
        this.updateSelectionManagerFeature(feature);
      }
    });
  }

  // ===== UTILITY METHODS =====

  setupBaseEventListeners = () => {
  };

  removeAllEventListeners = () => {
    this.removeHoverListeners();

    if (this.zoomRafId) {
      cancelAnimationFrame(this.zoomRafId);
      this.zoomRafId = null;
    }
    this.pendingZoomUpdate = false;
  };
}

export default AddImageControl;
