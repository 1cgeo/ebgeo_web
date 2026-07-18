// Path: js/locking/index.js

/**
 * @fileoverview Public barrel for the map-locking UX subsystem
 * (Slice 3 of the multiuser UX).
 *
 * Re-exports the lock state + actions controller (singleton + class) and the
 * on-map "Mapa bloqueado" banner IControl. Consumers (map_sig.js, maps.tab.js)
 * wire locking by importing from here only.
 */

export { MapLockController, mapLockController } from '@js/locking/map-lock.controller.js';
export { LockedBannerControl } from '@js/locking/locked-banner.control.js';
