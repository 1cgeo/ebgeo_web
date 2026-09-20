// Path: js/utilities/quill-helpers.js
/**
 * @fileoverview Quill.js helper utilities for rich text editing.
 * Provides HTML sanitization, content cleaning, and image compression
 * for Quill editors used across the application.
 *
 * @module utilities/quill-helpers
 */

import DOMPurify from 'dompurify';
import { showError } from './toast_service.js';
import { ImageRefusal, imageRefusalNotice } from './image-limit-phrases.js';
import { validateImageDimensions } from './image_utils.js';

/** DOMPurify configuration allowing only Quill-safe HTML tags and attributes. */
export const QUILL_DOMPURIFY_CONFIG = {
    ALLOWED_TAGS: [
        'p', 'br', 'strong', 'em', 'u', 's', 'sub', 'sup',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'ul', 'ol', 'li',
        'blockquote', 'pre', 'code',
        'a', 'img', 'span'
    ],
    ALLOWED_ATTR: [
        'href', 'target', 'rel',
        'src', 'alt', 'width', 'height',
        'class', 'style'
    ],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|data):)/i,
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ['target'],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover']
};

/** Default Quill image compression settings. */
export const QUILL_IMAGE_CONFIG = {
    maxWidth: 800,
    maxHeight: 600,
    quality: 0.8,
    maxSizeMB: 5
};

/** Default Quill toolbar configuration with standard formatting options. */
export const QUILL_TOOLBAR_CONFIG = [
    [{ 'header': [1, 2, 3, false] }],
    ['bold', 'italic', 'underline', 'strike'],
    [{ 'color': [] }, { 'background': [] }],
    [{ 'list': 'ordered' }, { 'list': 'bullet' }],
    [{ 'indent': '-1' }, { 'indent': '+1' }],
    [{ 'align': [] }],
    ['link', 'image'],
    ['clean']
];

/**
 * Extracts plain text from an HTML string using DOMParser (XSS-safe).
 *
 * @param {string} html - HTML string to parse
 * @returns {string} Plain text content
 */
function extractTextContent(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return doc.body.textContent || '';
}

/**
 * Sanitizes HTML content using DOMPurify with Quill-safe configuration.
 *
 * @param {string} html - HTML string to sanitize
 * @param {Object} [config] - Optional custom DOMPurify configuration
 * @returns {string} Sanitized HTML
 */
export function sanitizeQuillHtml(html, config = QUILL_DOMPURIFY_CONFIG) {
    if (!html) return '';
    return DOMPurify.sanitize(html, config);
}

/**
 * Cleans Quill HTML content by sanitizing and removing empty paragraphs.
 * Returns empty string when no meaningful text content remains.
 *
 * @param {string} html - HTML content from Quill editor
 * @returns {string} Cleaned and sanitized HTML content
 */
export function cleanQuillContent(html) {
    if (!html || html.trim() === '') return '';

    const cleaned = sanitizeQuillHtml(html)
        .replace(/<p><br><\/p>/g, '')
        .replace(/<p>\s*<\/p>/g, '');

    if (extractTextContent(cleaned).trim() === '') return '';

    return cleaned;
}

/**
 * An Error that carries a sentence WRITTEN FOR THE PERSON, as opposed to one thrown by the engine.
 *
 * The flag is what the `catch` of the image handler reads: `canvas.toDataURL`, `getSelection` and
 * `insertEmbed` throw too, and their messages are English engine text ("Failed to execute
 * 'toDataURL'...") that must never reach a toast.
 *
 * @param {string} message - pt-BR refusal sentence
 * @returns {Error} Error flagged with `isImageRefusal`
 */
function imageRefusalError(message) {
    const error = new Error(message);
    error.isImageRefusal = true;
    return error;
}

/**
 * Compresses an image file before embedding in Quill.
 *
 * @param {File} file - Image file to compress
 * @param {Object} [options] - Compression options
 * @param {number} [options.maxWidth=800] - Maximum width
 * @param {number} [options.maxHeight=600] - Maximum height
 * @param {number} [options.quality=0.8] - JPEG quality
 * @param {number} [options.maxSizeMB=5] - Maximum file size in MB
 * @returns {Promise<string>} Base64 encoded compressed image
 */
export function compressQuillImage(file, options = {}) {
    const {
        maxWidth = QUILL_IMAGE_CONFIG.maxWidth,
        maxHeight = QUILL_IMAGE_CONFIG.maxHeight,
        quality = QUILL_IMAGE_CONFIG.quality,
        maxSizeMB = QUILL_IMAGE_CONFIG.maxSizeMB
    } = options;

    return new Promise((resolve, reject) => {
        // The rejection message is now the SENTENCE THE PERSON READS, in pt-BR and naming both
        // numbers. It used to be English prose that the caller swallowed into a flat "Erro ao
        // adicionar imagem", so the one fact worth knowing (which limit, by how much) was lost
        // at the only point that had it.
        //
        // This ceiling is deliberately STRICTER than `IMAGE_CONFIG.maxSizeBytes`: a Quill picture
        // is embedded as base64 inside the slide's HTML and travels through sync on every edit,
        // so it is not the same budget as a blob stored once.
        if (file.size > maxSizeMB * 1024 * 1024) {
            reject(imageRefusalError(imageRefusalNotice(ImageRefusal.PESO, {
                bytes: file.size,
                maxBytes: maxSizeMB * 1024 * 1024,
            })));
            return;
        }

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);

        img.onload = () => {
            // The PIXEL ceiling, which the byte ceiling above cannot stand in for: a small
            // solid-colour PNG decodes to tens of thousands of pixels a side and the canvas
            // below would allocate all of them. Refused between `load` and `drawImage`, which
            // is the window where refusing still saves the bitmap.
            const dimensions = validateImageDimensions(img.naturalWidth, img.naturalHeight);
            if (!dimensions.valid) {
                URL.revokeObjectURL(objectUrl);
                reject(imageRefusalError(dimensions.reason));
                return;
            }

            let { width, height } = img;

            if (width > maxWidth) {
                height = (height * maxWidth) / width;
                width = maxWidth;
            }

            if (height > maxHeight) {
                width = (width * maxHeight) / height;
                height = maxHeight;
            }

            canvas.width = width;
            canvas.height = height;
            ctx.drawImage(img, 0, 0, width, height);

            URL.revokeObjectURL(objectUrl);
            resolve(canvas.toDataURL('image/jpeg', quality));
        };

        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(imageRefusalError(imageRefusalNotice(ImageRefusal.ILEGIVEL)));
        };

        img.src = objectUrl;
    });
}

/**
 * Handles image upload for Quill editor with compression.
 *
 * @param {Object} quillInstance - Quill editor instance
 * @param {Object} [options] - Compression options passed to compressQuillImage
 */
export function handleQuillImageUpload(quillInstance, options = {}) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png, image/gif, image/jpeg, image/webp';
    input.click();

    input.onchange = async () => {
        const file = input.files[0];
        if (!file) return;

        try {
            const compressedBase64 = await compressQuillImage(file, options);
            const range = quillInstance.getSelection(true);
            quillInstance.insertEmbed(range.index, 'image', compressedBase64);
            quillInstance.setSelection(range.index + 1);
        } catch (error) {
            console.error('Error processing image:', error);
            // THE REASON, not a flat "Erro ao adicionar imagem": every rejection above is now a
            // pt-BR sentence naming the limit that was hit, and replacing it with a generic one
            // threw away the only thing the person could act on.
            // Only a flagged refusal is quoted; anything else is an engine exception in English.
            showError(error?.isImageRefusal
                ? error.message
                : imageRefusalNotice(ImageRefusal.ILEGIVEL));
        }
    };
}

/**
 * Creates a Quill editor instance with default configuration.
 * Dynamically imports Quill and its CSS.
 *
 * @param {HTMLElement} container - DOM element to mount the editor
 * @param {Object} [options] - Quill configuration options
 * @param {string} [options.theme='snow'] - Quill theme
 * @param {string} [options.placeholder='Digite aqui...'] - Editor placeholder
 * @param {Array} [options.toolbar] - Custom toolbar configuration
 * @param {boolean} [options.enableImageCompression=true] - Enable image compression handler
 * @param {Object} [options.imageCompressionOptions] - Image compression options
 * @returns {Promise<Object>} Quill editor instance
 */
export async function createQuillEditor(container, options = {}) {
    const {
        theme = 'snow',
        placeholder = 'Digite aqui...',
        toolbar = QUILL_TOOLBAR_CONFIG,
        enableImageCompression = true,
        imageCompressionOptions = {}
    } = options;

    const [{ default: Quill }] = await Promise.all([
        import('quill'),
        import('quill/dist/quill.snow.css')
    ]);

    const quillInstance = new Quill(container, {
        theme,
        placeholder,
        modules: { toolbar }
    });

    if (enableImageCompression) {
        const toolbarModule = quillInstance.getModule('toolbar');
        toolbarModule.addHandler('image', () =>
            handleQuillImageUpload(quillInstance, imageCompressionOptions)
        );
    }

    return quillInstance;
}
