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

// ============================================================================
// CONFIGURATION CONSTANTS
// ============================================================================

/**
 * DOMPurify configuration for Quill HTML content.
 * Allows only safe HTML tags used by Quill editor.
 */
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

/**
 * Default configuration for Quill image compression.
 */
export const QUILL_IMAGE_CONFIG = {
    maxWidth: 800,
    maxHeight: 600,
    quality: 0.8,
    maxSizeMB: 5
};

/**
 * Default Quill toolbar configuration.
 * Provides standard formatting options suitable for most use cases.
 */
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

// ============================================================================
// HTML SANITIZATION
// ============================================================================

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

// ============================================================================
// QUILL CONTENT UTILITIES
// ============================================================================

/**
 * Cleans Quill HTML content to avoid empty paragraphs.
 * Uses DOMParser instead of innerHTML to prevent XSS during parsing.
 *
 * @param {string} html - HTML content from Quill editor
 * @returns {string} Cleaned and sanitized HTML content
 */
export function cleanQuillContent(html) {
    if (!html || html.trim() === '') return '';

    // First sanitize the HTML
    let cleaned = sanitizeQuillHtml(html);

    // Remove empty paragraphs
    cleaned = cleaned.replace(/<p><br><\/p>/g, '');
    cleaned = cleaned.replace(/<p>\s*<\/p>/g, '');

    // Use DOMParser to safely extract text content (no script execution)
    const parser = new DOMParser();
    const doc = parser.parseFromString(cleaned, 'text/html');
    const textContent = doc.body.textContent || '';

    if (textContent.trim() === '') {
        return '';
    }

    return cleaned;
}

/**
 * Strips HTML tags from content for simple text display.
 * Uses DOMParser instead of innerHTML to prevent XSS.
 *
 * @param {string} html - HTML string
 * @returns {string} Plain text
 */
export function stripHtml(html) {
    if (!html) return '';
    // DOMParser does not execute scripts, making it safe for parsing
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    return doc.body.textContent || '';
}

// ============================================================================
// IMAGE COMPRESSION
// ============================================================================

/**
 * Compresses image before embedding in Quill.
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
        if (file.size > maxSizeMB * 1024 * 1024) {
            reject(new Error(`Image too large (max ${maxSizeMB}MB)`));
            return;
        }

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const img = new Image();

        img.onload = () => {
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

            const base64 = canvas.toDataURL('image/jpeg', quality);
            URL.revokeObjectURL(img.src);
            resolve(base64);
        };

        img.onerror = () => {
            URL.revokeObjectURL(img.src);
            reject(new Error('Error loading image'));
        };
        img.src = URL.createObjectURL(file);
    });
}

// ============================================================================
// QUILL IMAGE UPLOAD HANDLER
// ============================================================================

/**
 * Handles image upload for Quill editor with compression.
 *
 * @param {Object} quillInstance - Quill editor instance
 * @param {Object} [options] - Compression options passed to compressQuillImage
 */
export function handleQuillImageUpload(quillInstance, options = {}) {
    const input = document.createElement('input');
    input.setAttribute('type', 'file');
    input.setAttribute('accept', 'image/png, image/gif, image/jpeg, image/webp');
    input.click();

    input.onchange = async () => {
        const file = input.files[0];
        if (file) {
            try {
                const compressedBase64 = await compressQuillImage(file, options);
                const range = quillInstance.getSelection(true);
                quillInstance.insertEmbed(range.index, 'image', compressedBase64);
                quillInstance.setSelection(range.index + 1);
            } catch (error) {
                console.error('Error processing image:', error);
                showError('Erro ao adicionar imagem');
            }
        }
    };
}

// ============================================================================
// QUILL EDITOR FACTORY
// ============================================================================

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

    // Dynamic import Quill and its CSS
    const [{ default: Quill }] = await Promise.all([
        import('quill'),
        import('quill/dist/quill.snow.css')
    ]);

    const quillInstance = new Quill(container, {
        theme,
        placeholder,
        modules: {
            toolbar
        }
    });

    // Setup image handler for compression if enabled
    if (enableImageCompression) {
        const toolbarModule = quillInstance.getModule('toolbar');
        toolbarModule.addHandler('image', () =>
            handleQuillImageUpload(quillInstance, imageCompressionOptions)
        );
    }

    return quillInstance;
}
