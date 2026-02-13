// Path: js/url_router.js

/**
 * @fileoverview URL deep linking router.
 * Parses URL query parameters to open 3D models or 360 photos on startup.
 * Used by map_sig.js after map load.
 */

import config from './config.js';

// URL parameter name for 3D model deep linking
const MODEL_PARAM = 'model';
// URL parameter name for Street View 360 photo deep linking
const PHOTO_360_PARAM = 'foto360';

/**
 * URL Router for handling deep linking to 3D models.
 * Parses URL query parameters and executes corresponding actions.
 * @namespace URLRouter
 */
const URLRouter = {
    /** @type {URLSearchParams|null} Parsed URL parameters */
    _params: null,

    /** @type {boolean} Whether parse() has been called */
    _initialized: false,

    /**
     * Parses the current URL query parameters.
     * Should be called once during application initialization.
     * @returns {void}
     */
    parse() {
        this._params = new URLSearchParams(window.location.search);
        this._initialized = true;
    },

    /**
     * Gets the model ID from URL parameters.
     * @returns {string|null} The model/tileset ID or null if not present
     */
    getModelId() {
        if (!this._initialized) {
            console.warn('URLRouter.parse() not called before getModelId()');
            return null;
        }
        return this._params.get(MODEL_PARAM);
    },

    /**
     * Gets the 360 photo name from URL parameters.
     * @returns {string|null} The photo name or null if not present
     */
    getPhoto360Id() {
        if (!this._initialized) {
            console.warn('URLRouter.parse() not called before getPhoto360Id()');
            return null;
        }
        return this._params.get(PHOTO_360_PARAM);
    },

    /**
     * Validates if a model ID exists in the configured tilesets.
     * @param {string} modelId - The model ID to validate
     * @returns {boolean} True if the model exists in config.tilesets
     */
    validateModel(modelId) {
        if (!modelId) return false;
        if (!config.tilesets || config.tilesets.length === 0) return false;

        return config.tilesets.some(tileset => tileset.id === modelId);
    },

    /**
     * Updates the URL with a model parameter without page reload.
     * Uses history.replaceState to avoid creating browser history entries.
     * @param {string} modelId - The model/tileset ID to set
     * @returns {void}
     */
    setModel(modelId) {
        if (!modelId) return;

        const url = new URL(window.location.href);
        url.searchParams.set(MODEL_PARAM, modelId);
        window.history.replaceState({}, '', url.toString());

        // Update internal state
        this._params = url.searchParams;
    },

    /**
     * Removes the model parameter from the URL without page reload.
     * @returns {void}
     */
    clearModel() {
        const url = new URL(window.location.href);
        url.searchParams.delete(MODEL_PARAM);

        // Clean URL: remove trailing '?' if no params remain
        const newUrl = url.searchParams.toString()
            ? url.toString()
            : url.origin + url.pathname;

        window.history.replaceState({}, '', newUrl);

        // Update internal state
        this._params = new URLSearchParams(url.search);
    },

    /**
     * Updates the URL with a 360 photo parameter without page reload.
     * Uses history.replaceState to avoid creating browser history entries.
     * @param {string} photoName - The photo name to set
     * @returns {void}
     */
    setPhoto360(photoName) {
        if (!photoName) return;

        const url = new URL(window.location.href);
        url.searchParams.set(PHOTO_360_PARAM, photoName);
        window.history.replaceState({}, '', url.toString());

        // Update internal state
        this._params = url.searchParams;
    },

    /**
     * Removes the 360 photo parameter from the URL without page reload.
     * @returns {void}
     */
    clearPhoto360() {
        const url = new URL(window.location.href);
        url.searchParams.delete(PHOTO_360_PARAM);

        // Clean URL: remove trailing '?' if no params remain
        const newUrl = url.searchParams.toString()
            ? url.toString()
            : url.origin + url.pathname;

        window.history.replaceState({}, '', newUrl);

        // Update internal state
        this._params = new URLSearchParams(url.search);
    },

    /**
     * Validates if a 360 photo exists by attempting to fetch its metadata.
     * @param {string} photoName - The photo name to validate
     * @returns {Promise<boolean>} True if the photo metadata exists
     */
    async validatePhoto360(photoName) {
        if (!photoName) return false;

        try {
            const metadataLocation = config.streetView360.metadataLocation;
            const response = await fetch(`${metadataLocation}/${photoName}.json`, { method: 'HEAD' });
            return response.ok;
        } catch {
            return false;
        }
    },

    /**
     * Executes deep link actions based on parsed URL parameters.
     * Should be called after the map is fully loaded.
     * @param {Object} deps - Dependencies required for execution
     * @param {Object} deps.modelsControl - The Add3DModelsViewerControl instance
     * @param {Object} [deps.streetViewControl] - The AddStreetViewControl instance
     * @param {Object} [deps.map] - The MapLibre map instance (optional)
     * @returns {Promise<boolean>} True if a deep link action was executed
     */
    async execute(deps) {
        if (!this._initialized) {
            console.warn('URLRouter.parse() not called before execute()');
            return false;
        }

        const { modelsControl, streetViewControl } = deps;

        // Try 3D model deep link first
        const modelId = this.getModelId();
        if (modelId && modelsControl) {
            // Check if 3D map feature is enabled
            const isMap3dEnabled = config.features?.map_3d ?? true;
            if (!isMap3dEnabled) {
                console.debug(`URLRouter: 3D map disabled, ignoring model param "${modelId}"`);
                this.clearModel();
            } else if (!this.validateModel(modelId)) {
                console.warn(`URLRouter: Model "${modelId}" not found in config.tilesets`);
                this.clearModel();
            } else {
                // Execute deep link: open 3D viewer with the specified model
                try {
                    console.debug(`URLRouter: Opening 3D viewer with model "${modelId}"`);
                    await modelsControl.openViewer(modelId);
                    return true;
                } catch (error) {
                    console.error(`URLRouter: Failed to open model "${modelId}"`, error);
                    this.clearModel();
                }
            }
        }

        // Try 360 photo deep link
        const photoId = this.getPhoto360Id();
        if (photoId && streetViewControl) {
            // Check if Street View feature is enabled
            const isStreetViewEnabled = config.features?.imagens_panoramicas ?? true;
            if (!isStreetViewEnabled) {
                console.debug(`URLRouter: Street View disabled, ignoring photo param "${photoId}"`);
                this.clearPhoto360();
                return false;
            }

            // Validate photo exists
            const photoValid = await this.validatePhoto360(photoId);
            if (!photoValid) {
                console.warn(`URLRouter: Photo "${photoId}" not found`);
                this.clearPhoto360();
                return false;
            }

            // Execute deep link: open 360 viewer with the specified photo
            try {
                console.debug(`URLRouter: Opening 360 viewer with photo "${photoId}"`);

                // Open the viewer directly without activating the street view tool
                // (we don't want to show the 2D map markers, just open the 360 viewer)
                const { openViewer360WithPhoto } = await import('./street_view_tool/street_view_viewer.js');
                await openViewer360WithPhoto(photoId, {
                    miniMap: streetViewControl.miniMap,
                    controlInstance: streetViewControl
                });

                streetViewControl.isOpen = true;
                return true;
            } catch (error) {
                console.error(`URLRouter: Failed to open photo "${photoId}"`, error);
                this.clearPhoto360();
                return false;
            }
        }

        return false;
    }
};

export { URLRouter };
