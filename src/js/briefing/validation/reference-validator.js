// Path: js/briefing/validation/reference-validator.js

/**
 * @fileoverview Reference validator for briefing slides.
 * Validates that slide references (maps, models, photos) exist.
 *
 * @module briefing/validation/reference-validator
 */

import { SlideMode, getAllMapNamesStore } from '@store/index.js';
import config from '@js/config.js';

// ============================================================================
// VALIDATION ERROR TYPES
// ============================================================================

/**
 * Validation error types.
 * @readonly
 * @enum {string}
 */
export const ValidationErrorType = Object.freeze({
    NO_POSITION: 'no_position',
    MAP_NOT_FOUND: 'map_not_found',
    MODEL_NOT_FOUND: 'model_not_found',
    PHOTO_NOT_FOUND: 'photo_not_found',
    INVALID_MODE: 'invalid_mode'
});

/**
 * Error severity levels.
 * @readonly
 * @enum {string}
 */
export const ErrorSeverity = Object.freeze({
    /** Warning - presentation can continue but may have issues */
    WARNING: 'warning',
    /** Error - slide cannot be displayed properly */
    ERROR: 'error'
});

// ============================================================================
// VALIDATION MESSAGES (Portuguese)
// ============================================================================

const ERROR_MESSAGES = {
    [ValidationErrorType.NO_POSITION]: 'Posição não definida',
    [ValidationErrorType.MAP_NOT_FOUND]: 'Mapa não encontrado',
    [ValidationErrorType.MODEL_NOT_FOUND]: 'Modelo 3D não encontrado',
    [ValidationErrorType.PHOTO_NOT_FOUND]: 'Foto 360 não encontrada',
    [ValidationErrorType.INVALID_MODE]: 'Modo de visualização inválido'
};

// ============================================================================
// VALIDATION RESULT CLASS
// ============================================================================

/**
 * Represents a single validation error.
 */
export class ValidationError {
    /**
     * @param {number} slideIndex - Index of the slide with error
     * @param {string} slideId - ID of the slide
     * @param {string} slideTitle - Title of the slide
     * @param {string} errorType - Type of error from ValidationErrorType
     * @param {string} severity - Severity from ErrorSeverity
     * @param {string} [details] - Additional details about the error
     */
    constructor(slideIndex, slideId, slideTitle, errorType, severity, details = '') {
        this.slideIndex = slideIndex;
        this.slideId = slideId;
        this.slideTitle = slideTitle || `Slide ${slideIndex + 1}`;
        this.errorType = errorType;
        this.severity = severity;
        this.message = ERROR_MESSAGES[errorType] || errorType;
        this.details = details;
    }

    /**
     * Gets a full description of the error.
     * @returns {string}
     */
    toString() {
        const prefix = this.severity === ErrorSeverity.ERROR ? '[ERRO]' : '[AVISO]';
        return `${prefix} Slide ${this.slideIndex + 1} "${this.slideTitle}": ${this.message}${this.details ? ` - ${this.details}` : ''}`;
    }
}

/**
 * Result of briefing validation.
 */
export class ValidationResult {
    constructor() {
        /** @type {ValidationError[]} */
        this.errors = [];
        /** @type {ValidationError[]} */
        this.warnings = [];
    }

    /**
     * Adds an error to the result.
     * @param {ValidationError} error - Validation error
     */
    addError(error) {
        if (error.severity === ErrorSeverity.ERROR) {
            this.errors.push(error);
        } else {
            this.warnings.push(error);
        }
    }

    /**
     * Checks if the briefing is valid (no errors).
     * Presentation can proceed with warnings but not errors.
     * @returns {boolean}
     */
    isValid() {
        return this.errors.length === 0;
    }

    /**
     * Alias for isValid() -- briefing can be presented if there are no errors.
     * @returns {boolean}
     */
    canPresent() {
        return this.isValid();
    }

    /**
     * Checks if there are any issues (errors or warnings).
     * @returns {boolean}
     */
    hasIssues() {
        return this.errors.length > 0 || this.warnings.length > 0;
    }

    /**
     * Gets all issues (errors and warnings combined).
     * @returns {ValidationError[]}
     */
    getAllIssues() {
        return [...this.errors, ...this.warnings];
    }

    /**
     * Gets a summary of the validation result.
     * @returns {string}
     */
    getSummary() {
        if (!this.hasIssues()) {
            return 'Briefing valido';
        }

        const parts = [];
        if (this.errors.length > 0) {
            parts.push(`${this.errors.length} erro(s)`);
        }
        if (this.warnings.length > 0) {
            parts.push(`${this.warnings.length} aviso(s)`);
        }
        return parts.join(', ');
    }
}

// ============================================================================
// VALIDATOR CLASS
// ============================================================================

/**
 * Reference validator for briefings.
 * Checks that all slide references are valid.
 */
export class ReferenceValidator {
    /**
     * Validates a briefing.
     *
     * @param {Object} briefing - Briefing to validate
     * @returns {Promise<ValidationResult>} Validation result
     */
    async validate(briefing) {
        const result = new ValidationResult();

        if (!briefing || !briefing.slides) {
            return result;
        }

        // Get available resources for validation
        const availableMaps = await this._getAvailableMaps();
        const availableModels = this._getAvailableModels();
        const availablePhotos = await this._getAvailablePhotos();

        // Validate each slide
        for (let i = 0; i < briefing.slides.length; i++) {
            const slide = briefing.slides[i];
            await this._validateSlide(slide, i, result, {
                availableMaps,
                availableModels,
                availablePhotos
            });
        }

        return result;
    }

    /**
     * Validates a single slide.
     * @private
     * @param {Object} slide - Slide to validate
     * @param {number} index - Slide index
     * @param {ValidationResult} result - Result to add errors to
     * @param {Object} resources - Available resources
     */
    async _validateSlide(slide, index, result, resources) {
        const { availableMaps, availableModels, availablePhotos } = resources;

        // Check position
        if (!slide.position || slide.position.longitude === null || slide.position.latitude === null) {
            result.addError(new ValidationError(
                index,
                slide.id,
                slide.title,
                ValidationErrorType.NO_POSITION,
                ErrorSeverity.WARNING
            ));
        } else if (slide.mode === SlideMode.VIEWER_360) {
            // For 360 slides, position should contain geographic coordinates (not camera rotation).
            // Legacy briefings may have camera rotation values in position - detect and warn.
            const { longitude, latitude } = slide.position;
            const looksLikeCameraRotation = longitude != null && latitude != null
                && Math.abs(latitude) > 90;
            if (looksLikeCameraRotation) {
                result.addError(new ValidationError(
                    index,
                    slide.id,
                    slide.title,
                    ValidationErrorType.NO_POSITION,
                    ErrorSeverity.WARNING,
                    'Posição contém valores de rotação de câmera (briefing legado)'
                ));
            }
        }

        // Check mode-specific references
        switch (slide.mode) {
            case SlideMode.MAP_2D:
                // Map is optional for 2D mode, but if specified it should exist
                if (slide.mapId && !availableMaps.has(slide.mapId)) {
                    result.addError(new ValidationError(
                        index,
                        slide.id,
                        slide.title,
                        ValidationErrorType.MAP_NOT_FOUND,
                        ErrorSeverity.WARNING,
                        `ID: ${slide.mapId}`
                    ));
                }
                break;

            case SlideMode.VIEWER_3D:
                // Model is required for 3D mode
                if (!slide.modelId) {
                    result.addError(new ValidationError(
                        index,
                        slide.id,
                        slide.title,
                        ValidationErrorType.MODEL_NOT_FOUND,
                        ErrorSeverity.ERROR,
                        'Nenhum modelo especificado'
                    ));
                } else if (!availableModels.has(slide.modelId)) {
                    result.addError(new ValidationError(
                        index,
                        slide.id,
                        slide.title,
                        ValidationErrorType.MODEL_NOT_FOUND,
                        ErrorSeverity.ERROR,
                        `ID: ${slide.modelId}`
                    ));
                }
                break;

            case SlideMode.VIEWER_360:
                // Photo is required for 360 mode
                if (!slide.photoId) {
                    result.addError(new ValidationError(
                        index,
                        slide.id,
                        slide.title,
                        ValidationErrorType.PHOTO_NOT_FOUND,
                        ErrorSeverity.ERROR,
                        'Nenhuma foto especificada'
                    ));
                } else if (!availablePhotos.has(slide.photoId)) {
                    // Not in local project cache — validate via API (covers non-entry photos)
                    try {
                        const { validatePhoto } = await import(
                            '@js/street_view_tool/streetview-api.service.js'
                        );
                        const exists = await validatePhoto(slide.photoId);
                        if (!exists) {
                            result.addError(new ValidationError(
                                index,
                                slide.id,
                                slide.title,
                                ValidationErrorType.PHOTO_NOT_FOUND,
                                ErrorSeverity.ERROR,
                                `ID: ${slide.photoId}`
                            ));
                        }
                    } catch {
                        result.addError(new ValidationError(
                            index,
                            slide.id,
                            slide.title,
                            ValidationErrorType.PHOTO_NOT_FOUND,
                            ErrorSeverity.WARNING,
                            `Não foi possível verificar: ${slide.photoId}`
                        ));
                    }
                }
                break;

            default:
                // Invalid or unknown mode
                if (slide.mode && !Object.values(SlideMode).includes(slide.mode)) {
                    result.addError(new ValidationError(
                        index,
                        slide.id,
                        slide.title,
                        ValidationErrorType.INVALID_MODE,
                        ErrorSeverity.ERROR,
                        `Modo: ${slide.mode}`
                    ));
                }
                break;
        }
    }

    /**
     * Gets available maps.
     * Maps are stored and referenced by name in the store.
     * @private
     * @returns {Promise<Set<string>>}
     */
    async _getAvailableMaps() {
        try {
            const mapNames = await getAllMapNamesStore();
            // Maps are identified by their name in the store
            return new Set(mapNames);
        } catch (error) {
            console.error('Error getting available maps:', error);
            return new Set();
        }
    }

    /**
     * Gets available 3D models from config.
     * @private
     * @returns {Set<string>}
     */
    _getAvailableModels() {
        const modelSet = new Set();

        try {
            if (config.tilesets && Array.isArray(config.tilesets)) {
                for (const tileset of config.tilesets) {
                    if (tileset.id) {
                        modelSet.add(tileset.id);
                    }
                    if (tileset.name) {
                        modelSet.add(tileset.name);
                    }
                }
            }
        } catch (error) {
            console.error('Error getting available models:', error);
        }

        return modelSet;
    }

    /**
     * Gets available 360 photos from the cached project list.
     * Uses getCachedProjects() to avoid extra network requests.
     * When streetview feature is disabled, returns empty set — all 360 slides fail validation.
     * @private
     * @returns {Promise<Set<string>>}
     */
    async _getAvailablePhotos() {
        const photoSet = new Set();

        // If streetview feature is disabled, no photos are available
        if (!config.features.imagens_panoramicas) {
            return photoSet;
        }

        try {
            const { getCachedProjects } = await import(
                '@js/street_view_tool/streetview-api.service.js'
            );
            const projects = getCachedProjects();
            if (projects && Array.isArray(projects)) {
                for (const project of projects) {
                    if (project.id) photoSet.add(project.id);
                    if (project.name) photoSet.add(project.name);
                    // Entry photo UUID — slides store photo UUIDs via getCurrentPhotoName()
                    if (project.entryPhotoId) photoSet.add(project.entryPhotoId);
                }
            }
        } catch (error) {
            console.warn('Error getting available photos:', error);
        }

        return photoSet;
    }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Creates a new reference validator.
 * @returns {ReferenceValidator}
 */
export function createReferenceValidator() {
    return new ReferenceValidator();
}

/**
 * Validates a briefing.
 * Convenience function that creates a validator and validates.
 *
 * @param {Object} briefing - Briefing to validate
 * @returns {Promise<ValidationResult>}
 */
export async function validateBriefing(briefing) {
    const validator = new ReferenceValidator();
    return await validator.validate(briefing);
}

export default ReferenceValidator;
