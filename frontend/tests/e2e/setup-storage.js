// Path: tests/e2e/setup-storage.js
import 'fake-indexeddb/auto';

/**
 * @fileoverview Per-worker setup for the E2E suite (runs inside the test fork,
 * before any test module is imported).
 *
 * Install IndexedDB before LocalForage so the queue journal can exercise native
 * multi-key transactions. The synchronous Web Storage shims below provide the
 * client identity and active atlas namespace; they do not replace the journal.
 *
 * This file MUST run before any module that imports `localforage`; it is therefore
 * the FIRST entry in the e2e config's `setupFiles`.
 */

/** Minimal synchronous Web Storage shim backed by a Map. */
class MemoryStorage {
    constructor() {
        /** @type {Map<string, string>} */
        this._map = new Map();
    }

    get length() {
        return this._map.size;
    }

    key(index) {
        return Array.from(this._map.keys())[index] ?? null;
    }

    getItem(key) {
        const k = String(key);
        return this._map.has(k) ? this._map.get(k) : null;
    }

    setItem(key, value) {
        this._map.set(String(key), String(value));
    }

    removeItem(key) {
        this._map.delete(String(key));
    }

    clear() {
        this._map.clear();
    }
}

if (typeof globalThis.localStorage === 'undefined') {
    globalThis.localStorage = new MemoryStorage();
}
if (typeof globalThis.sessionStorage === 'undefined') {
    globalThis.sessionStorage = new MemoryStorage();
}
