// Path: js/url_router.js

import config from './config.js';

// URL parameter name for 3D model deep linking
const MODEL_PARAM = 'model';

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
     * Executes deep link actions based on parsed URL parameters.
     * Should be called after the map is fully loaded.
     * @param {Object} deps - Dependencies required for execution
     * @param {Object} deps.modelsControl - The Add3DModelsViewerControl instance
     * @param {Object} [deps.map] - The MapLibre map instance (optional)
     * @returns {Promise<boolean>} True if a deep link action was executed
     */
    async execute(deps) {
        if (!this._initialized) {
            console.warn('URLRouter.parse() not called before execute()');
            return false;
        }

        const { modelsControl } = deps;
        if (!modelsControl) {
            console.warn('URLRouter.execute() called without modelsControl');
            return false;
        }

        const modelId = this.getModelId();
        if (!modelId) {
            return false;
        }

        // Check if 3D map feature is enabled
        const isMap3dEnabled = config.features?.map_3d ?? true;
        if (!isMap3dEnabled) {
            console.info(`URLRouter: 3D map disabled, ignoring model param "${modelId}"`);
            this.clearModel();
            return false;
        }

        // Validate model exists in config
        if (!this.validateModel(modelId)) {
            console.warn(`URLRouter: Model "${modelId}" not found in config.tilesets`);
            this.clearModel();
            return false;
        }

        // Execute deep link: open 3D viewer with the specified model
        try {
            console.info(`URLRouter: Opening 3D viewer with model "${modelId}"`);
            await modelsControl.openViewer(modelId);
            return true;
        } catch (error) {
            console.error(`URLRouter: Failed to open model "${modelId}"`, error);
            this.clearModel();
            return false;
        }
    }
};

export { URLRouter };
export default URLRouter;
