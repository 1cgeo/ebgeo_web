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
import { getGeoJsonDispatcher, destroyGeoJsonDispatcher } from '@layers/geojson-dispatcher.js';
import { queryFeaturesAtPoint } from '@tools/helpers/feature-hit-test.helpers.js';
import { createRenderedIconSelectionBox } from '@tools/helpers/icon-selection-box.helpers.js';
import { readGeoJSONSourceData } from '@utils/geojson-source.js';

/**
 * Layer onHoverMove needs: the single layer drawn from the 'images' source, in
 * layers/styles/content.layers.js. This tool has no edit handles.
 */
const HOVER_LAYER_IDS = ['image-layer'];

/**
 * The dispatcher that owns the `images` source.
 *
 * EVERY write to `images` made in this file goes through it, and every migrated method awaits
 * `flush()` before returning. A raw `source.setData()` issued while a diff is queued replaces
 * MapLibre's pending-update slot and the diff disappears with no error, so draining inside the
 * awaited method keeps the queue empty between gestures and leaves the co-writers that still use
 * `setData` (the generic `storageType` paths: attribute table, features tab, import, clipboard,
 * multi-selection actions) reading a collection that already carries what this tool wrote.
 * @param {Object} map - MapLibre map instance
 * @returns {Object} dispatcher owning the `images` source
 */
function imagesSource(map) {
  return getGeoJsonDispatcher(map, "images");
}

class AddImageControl extends BaseControl {
    featureType = 'image';
  constructor(toolManager) {
    super(toolManager);

    this.geometry = new AddImageGeometry();
    this.zoomRafId = null;
    this.pendingZoomUpdate = false;
    this.fixedZoomRafId = null;
    this.pendingFixedZoomUpdate = false;
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

  /**
   * Pixel dimensions used when a feature's own `width`/`height` cannot be trusted.
   *
   * A legacy `.ebgeo` can carry an image whose dimensions were written under other
   * names (`largura`/`altura`), so `properties.width` reads `undefined` and every
   * derived number turns into NaN. There is no image to measure at that point (the
   * blob may not even be decoded yet), so a declared square is the fallback: it
   * draws something the person can see, select and resize, instead of a NaN that
   * reaches native placement code.
   */
  static FALLBACK_IMAGE_DIMENSION = 100;

  /**
   * The ONE zoom-correction config of this tool, shared by every path that derives
   * `calculatedSize`. `fallbackValue` is not optional here: the image layer reads a
   * bare `['get', 'calculatedSize']` (`layers/styles/content.layers.js`), so it has
   * no default of its own to fall back to.
   */
  static ZOOM_CORRECTION_CONFIG = {
    sourceProperty: 'size',
    calculatedProperty: 'calculatedSize',
    maxValue: 10,
    fallbackValue: AddImageControl.DEFAULT_PROPERTIES.calculatedSize,
  };

  // ===== SINGLE SOURCE OF TRUTH =====

  // ===== MAPBOX CONTROL INTERFACE =====

  onAdd = (map) => {
    this.map = map;
    this.setupZoomListener();
  };

  onRemove = () => {
    this.map.off("zoom", this.handleZoomChange);
    this.map.off("zoomend", this.handleZoomEnd);
    // Releases the queue, its settle timers and the two map listeners the dispatcher opens per
    // dispatch. Dropping a batch here cannot lose an image: the store write always precedes the
    // source write, so the redraw that follows a style switch repopulates `images` from
    // persistence.
    destroyGeoJsonDispatcher(this.map, "images");
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

  /**
   * Zoom a feature's selection box must be sized at.
   *
   * `null` means "use the feature's own `createdAtZoom`", which is what keeps the box
   * glued to the terrain while the correction is on. Two states have no such anchor
   * to honour, and both answer with the zoom the person is actually looking at:
   * the correction switched off (the box is pinned to the screen), and a feature
   * whose `createdAtZoom` is not a finite number. That second one is the defect this
   * guard exists for: passing a missing anchor down makes `pixelsToDegrees` return
   * NaN and puts NaN coordinates into the polygon, which raises nothing.
   *
   * @param {Object} properties - Image feature properties
   * @param {number} [zoom] - Zoom to use in place of the live map zoom
   * @returns {number|null} A finite zoom, or `null` to defer to `createdAtZoom`
   */
  selectionBoxZoom(properties, zoom = null) {
    const live = Number.isFinite(zoom) ? zoom : this.map.getZoom();
    if (properties?.zoomCorrectionEnabled === false) return live;
    if (!Number.isFinite(properties?.createdAtZoom)) return live;
    return null;
  }

  createSelectionBox(feature) {
    // The box is the picture as drawn, plus the frame padding, rotation included.
    const drawn = createRenderedIconSelectionBox(this.map, feature, "image-layer");
    if (drawn) return { geometry: drawn };

    // The image is not in the style yet (still loading, or replaced by the
    // error image): fall back to the stored box until it is.
    if (feature.properties.selectionBox) {
      return { geometry: feature.properties.selectionBox };
    }

    const effectiveZoom = this.selectionBoxZoom(feature.properties);
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
    return "viewport";
  }

  getSelectionBoxPadding() {
    return 5;
  }

  getLayerIds() {
    return ["image-layer"];
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

    const effectiveZoom = this.selectionBoxZoom(feature.properties);
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

    const effectiveZoom = this.selectionBoxZoom(feature.properties);
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

        // No collection read: the diff carries the new feature alone. `images` has no derived
        // label source, so nothing here is a function of the whole collection.
        const dispatcher = imagesSource(this.map);
        dispatcher.add(feature);
        await dispatcher.flush();

        await this.selectionManager.toggleFeatureSelection("image", imageId, feature);
        this.selectionManager.updateUI();
      } catch (error) {
        console.error("Error adding image feature:", error);
        showError("Erro ao adicionar imagem");
      }
    });
  };

  /**
   * First usable pixel dimension of the candidates, or the declared fallback.
   *
   * "Usable" is `Number.isFinite(x) && x > 0`: `x ?? fallback` would accept NaN and
   * `x || fallback` would accept Infinity, and both feed the same native calls.
   *
   * @param {...*} candidates - Dimensions to try, in order of preference
   * @returns {number} A finite dimension above zero
   */
  static usableDimension(...candidates) {
    const usable = candidates.find((value) => Number.isFinite(value) && value > 0);
    return usable ?? AddImageControl.FALLBACK_IMAGE_DIMENSION;
  }

  createImageFeature = (lngLat, imageId, width, height) => {
    return {
      type: "Feature",
      id: IDUtils.generateGeoJSONId(),
      properties: {
        ...AddImageControl.DEFAULT_PROPERTIES,
        // Stamped through the coercion so a feature is never BORN with a dimension
        // that cannot be drawn. Everything downstream reads these two back.
        width: AddImageControl.usableDimension(width),
        height: AddImageControl.usableDimension(height),
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
      // `naturalWidth`/`naturalHeight` are the decoded size and the only pair that
      // cannot be styled away; `width`/`height` are the layout attributes and read 0
      // for an SVG with no intrinsic size. Both are coerced because everything below
      // (the aspect ratio, the canvas, and the dimensions stamped on the feature)
      // divides by them, and a 0 or NaN here reaches `canvas.width` as a native call.
      let width = AddImageControl.usableDimension(img.naturalWidth, img.width);
      let height = AddImageControl.usableDimension(img.naturalHeight, img.height);
      const aspectRatio = width / height;

      if (
        width > AddImageControl.MAX_IMAGE_DIMENSION ||
        height > AddImageControl.MAX_IMAGE_DIMENSION
      ) {
        if (width > height) {
          width = AddImageControl.MAX_IMAGE_DIMENSION;
          height = AddImageControl.usableDimension(Math.round(width / aspectRatio));
        } else {
          height = AddImageControl.MAX_IMAGE_DIMENSION;
          width = AddImageControl.usableDimension(Math.round(height * aspectRatio));
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

  /**
   * The painted size comes from a style expression now (layers/styles/zoom-expression.js),
   * so the full pass no longer feeds the drawing and is worth ONE run per gesture, on
   * `zoomend`: it refreshes the stored `calculatedSize` for the consumers that still read
   * it (export, feature header, selection box).
   *
   * What an expression cannot do is the ground geometry of a image whose correction is
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
      this.zoomRafId = requestAnimationFrame(this.updateAllImageSizes);
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
      const source = this.map?.getSource("images");
      if (!source) return;

      const data = readGeoJSONSourceData(source);
      if (!data?.features?.length) return;

      const fixed = data.features.filter(f => f.properties.zoomCorrectionEnabled === false);
      if (!fixed.length) return;

      const currentZoom = this.map.getZoom();
      const dispatcher = imagesSource(this.map);
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
      this.selectionManager.updateSelectedFeature?.('image', feature.properties.id, feature);
      this.selectionManager.uiManager?.invalidateCache?.(feature.properties.id);
      touched = true;
    }
    if (touched) this.selectionManager.uiManager?.updateSelectionHighlight?.();
  };

  applyZoomCorrections = (features) => {
    return applyZoomCorrectionsUtil(
      features,
      this.map.getZoom(),
      AddImageControl.ZOOM_CORRECTION_CONFIG,
    );
  };

  updateAllImageSizes = async () => {
    if (!this.map.getSource("images")) {
      this.pendingZoomUpdate = false;
      return;
    }

    // NOT a diff, on purpose: every zoom-corrected image changes size on every zoom step, so the
    // delta IS the collection and a diff would carry one update entry per feature for the same
    // O(N) cost. The read-modify-write still has to start from a drained queue, or the copy read
    // back would be missing whatever is queued and this write would then erase it.
    const dispatcher = imagesSource(this.map);
    await dispatcher.flush();
    if (!this.map?.getSource("images")) {
      this.pendingZoomUpdate = false;
      return;
    }

    const currentZoom = this.map.getZoom();
    const data = await this.map.getSource("images").getData();
    let hasChanges = false;

    data.features.forEach((feature) => {
      // ONE derivation for both branches. The disabled branch used to read `size`
      // straight and the enabled one carried its own copy of the `2 ** Δzoom` maths,
      // so a feature with no `createdAtZoom` (legacy `.ebgeo`) produced NaN here on
      // every zoom step and wrote it back into the source. The shared helper answers
      // with the base value when there is no zoom reference, and never with NaN.
      const newCalculatedSize = calculateZoomCorrectedValue(
        feature.properties,
        currentZoom,
        AddImageControl.ZOOM_CORRECTION_CONFIG,
      );

      if (feature.properties.zoomCorrectionEnabled === false) {
        // Recalculate selection box for features with zoom correction disabled
        feature.properties.selectionBox = this._fixedSelectionBox(feature, currentZoom);
        hasChanges = true;
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

    const features = queryFeaturesAtPoint(this.map, e.point, { layers: HOVER_LAYER_IDS });
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
    const dispatcher = imagesSource(this.map);

    // One patch per feature carrying the edited property plus everything derived from it. The
    // selected feature is the only copy consulted: `ensureFeatureConsistency` reads only geometry
    // and properties the two copies share, and it used to write its result into both.
    for (const feature of features) {
      feature.properties[property] = value;

      // Round createdAtZoom to 1 decimal
      if (property === 'createdAtZoom') {
        feature.properties[property] = Math.round(value * 10) / 10;
      }

      const shouldRecalculateSelectionBox =
        ['size', 'rotation', 'zoomCorrectionEnabled', 'createdAtZoom'].includes(property);

      this.ensureFeatureConsistency(feature, null, shouldRecalculateSelectionBox);

      dispatcher.patch(feature.properties.id, {
        setProps: {
          [property]: feature.properties[property],
          calculatedSize: feature.properties.calculatedSize,
          selectionBox: feature.properties.selectionBox,
        },
      });
    }

    await dispatcher.flush();
    this.updateSelectionManagerFeatures(features);
  };

  ensureFeatureConsistency = (
    feature,
    currentZoom = null,
    forceRecalculateSelectionBox = false
  ) => {
    // `currentZoom || this.map.getZoom()` swallowed a legitimate zoom 0 and let a NaN
    // argument through untouched; the finiteness test is the same one the helper uses.
    const zoom = Number.isFinite(currentZoom) ? currentZoom : this.map.getZoom();

    feature.properties.calculatedSize = calculateZoomCorrectedValue(
      feature.properties, zoom,
      AddImageControl.ZOOM_CORRECTION_CONFIG
    );

    if (forceRecalculateSelectionBox || !feature.properties.selectionBox) {
      const effectiveZoom = this.selectionBoxZoom(feature.properties, zoom);
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
    // Reads only, and it persists the SOURCE's version of each feature rather than the selected
    // one, so the queue has to be drained before the collection comes back.
    await imagesSource(this.map).flush();
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
      } catch (error) {
        console.error(`Error removing image ${feature.properties.id}:`, error);
      }
    }

    // Removal by promoted key, with no collection read (the read used to sit INSIDE the loop, so
    // it cost one full round-trip per deleted feature). The keys go in raw, never coerced:
    // MapLibre keyed the feature by the very value in `properties.id`, so a `String()` around it
    // would miss a numeric key instead of protecting anything.
    const dispatcher = imagesSource(this.map);
    dispatcher.remove(features.map((f) => f.properties.id));
    await dispatcher.flush();
  };

  setDefaultProperties = (properties) => {
    Object.assign(AddImageControl.DEFAULT_PROPERTIES, properties);
  };

  hasFeatureChanged = (feature, initialProperties) => {
    if (!initialProperties) return true;

    // Zoom correction defaults to ON by absence, so `undefined` and `true` are the
    // same state: compare the normalized flag, not the raw value.
    const zoomCorrectionOn = feature.properties.zoomCorrectionEnabled !== false;
    const initialZoomCorrectionOn = initialProperties.zoomCorrectionEnabled !== false;

    return (
      zoomCorrectionOn !== initialZoomCorrectionOn ||
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
      // The collection read survives here on purpose. An unknown id must be SKIPPED, not created,
      // and no diff hands back whether the feature exists; the merge branch also needs the
      // previous source properties. Draining first keeps that read from being stale.
      const dispatcher = imagesSource(this.map);
      await dispatcher.flush();
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

          // `add` of the merged source feature, never `patch`: `ensureFeatureConsistency` runs
          // AFTER the merge and writes onto the source copy, so that copy, not the incoming one,
          // is the final state. Total replacement is exactly what the branches above expressed.
          dispatcher.add(data.features[featureIndex]);

          if (save) {
            const featureToUpdate = onlyUpdateProperties
              ? data.features[featureIndex]
              : feature;
            await updateFeature("images", featureToUpdate);
          }
        }
      }

      await dispatcher.flush();
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
    if (this.fixedZoomRafId) {
      cancelAnimationFrame(this.fixedZoomRafId);
      this.fixedZoomRafId = null;
    }
    this.pendingFixedZoomUpdate = false;
    this.pendingZoomUpdate = false;
  };
}

export default AddImageControl;
