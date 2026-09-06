// Path: js/utilities/blob-to-data-url.js

/**
 * @fileoverview Reads a Blob (or File) as a base64 data URL.
 *
 * Base64 is only for whoever has to hand a blob to something that takes a URL string
 * (an `<img src>` preview, a stored thumbnail). A blob that is only drawn on the map
 * never needs it: encoding it costs a full copy of the bitmap in memory.
 */

/**
 * Reads a blob as a base64 data URL.
 * @param {Blob} blob - Blob or File to read
 * @returns {Promise<string>} Base64 data URL
 */
export function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        if (!blob) {
            reject(new Error('blobToDataUrl: a blob is required'));
            return;
        }

        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Failed to read blob'));
        reader.readAsDataURL(blob);
    });
}
