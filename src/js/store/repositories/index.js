// Path: js/store/repositories/index.js

/**
 * @fileoverview Barrel file for repositories module.
 * Exports repository interface and implementations.
 */

// Interface and validation
export {
    RepositoryMethods,
    validateRepository,
    getMissingMethods
} from './repository.interface.js';

// Local implementation (IndexedDB)
export {
    LocalRepository,
    localRepository
} from './local.repository.js';
