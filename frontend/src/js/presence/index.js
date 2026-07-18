// Path: js/presence/index.js

/**
 * @fileoverview Public barrel for the presence / awareness subsystem
 * (Slice 2 of the multiuser UX).
 *
 * Re-exports the pure state store, the WS<->store bridge lifecycle
 * (startPresence/stopPresence), and the two DOM overlays (online-users roster
 * control + remote-cursors layer). Consumers (map_sig.js) wire presence by
 * importing from here only.
 */

export { PresenceStore, presenceStore } from '@js/presence/presence-store.js';
export { OnlineUsersControl } from '@js/presence/online-users.control.js';
export { RemoteCursorsLayer } from '@js/presence/remote-cursors.layer.js';
export { RemoteSelectionsLayer } from '@js/presence/remote-selections.layer.js';
export { startPresence, stopPresence } from '@js/presence/presence-bridge.js';
