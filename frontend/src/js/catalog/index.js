// Path: js/catalog/index.js

/**
 * @fileoverview Public exports for the catalog module.
 */

// Constants and types
export {
    CATALOG_ITEM_TYPES,
    CATALOG_TYPE_CONFIG,
    CATALOG_ICONS,
    CATALOG_MODAL_ICON,
    CATALOG_CHIP_CONFIG,
    CATALOG_UI_ICONS,
    DEFAULT_THUMBNAILS,
    CATALOG_MODAL_FILTERS,
    RESOURCE_ACCESS_BY_CATALOG_TYPE,
    GRANT_LEVELS
} from './catalog.constants.js';

// Service
export { CatalogService } from './catalog.service.js';

// Modal
export { CatalogModal } from './catalog.modal.js';
export { ResourceShareModal, showResourceShareModal } from './resource-share.modal.js';

// Components
export {
    createCatalogHeader,
    createCatalogFilters,
    createCatalogGrid,
    createCatalogCard
} from './components/index.js';
