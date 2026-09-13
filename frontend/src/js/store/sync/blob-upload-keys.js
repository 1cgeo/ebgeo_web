// Path: js/store/sync/blob-upload-keys.js

/**
 * @fileoverview The key prefix of a blob-upload pendency, in a leaf with ZERO imports.
 *
 * The pendency records of `blob-upload-queue.js` live inside the atlas IMAGES store, so every
 * reader that COUNTS keys in that database has to know how to tell a pendency from a picture. One
 * of those readers is `store/atlas-contents.js`, which is reached by `atlas.html` — a page that
 * boots with no store and no services. Importing the queue from there would drag the outbound
 * queue, its journal and the HTTP client onto that page for the sake of one string.
 *
 * A COPIED STRING WAS THE OTHER OPTION and it is the one that rots: the day the prefix changes,
 * the counter goes on filtering the old one and starts counting pendencies as images, with nothing
 * red anywhere. One definition, two importers, no graph.
 */

/** Prefix of every pendency key inside the atlas IMAGES store. */
export const BLOB_UPLOAD_KEY_PREFIX = 'upload_pendente__';
