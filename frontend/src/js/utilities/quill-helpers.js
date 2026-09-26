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
import {
    QUILL_PASTE_MIME_TYPES,
    QUILL_IMAGE_ACCEPT,
    pastedHtmlImageVerdict,
    withoutRefusedImages,
    dataUrlToBytes,
} from './quill-image-paste.model.js';
import {
    idDaFigura,
    srcDaFigura,
    marcarFigurasParaDesenho,
    htmlParaGuardar,
    PLACEHOLDER_DA_FIGURA,
    ATRIBUTO_DA_FIGURA,
} from '@js/briefing/figura-de-slide.js';

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
        'class', 'style',
        // Quill 2 writes EVERY list as `<ol>` and tells bullet from ordered by this attribute
        // (`<li data-list="bullet">`). Without it a bullet list came back from the sanitizer as a
        // plain `<ol><li>`: the editor dropped the list from its model on reopening, and the
        // presentation drew it NUMBERED. Listing it is not enough on its own: see below.
        'data-list'
    ],
    // With data attributes off, a listed attribute's VALUE is checked against the URI pattern
    // above, and "bullet" is not a URI, so `data-list` was still removed. It carries a keyword
    // Quill reads, never a URL. The same check removes `width` and `height` of a picture (a number
    // is not a URI), which is why they are here too. `target` and `rel` are NOT: their values would
    // then pass free, and this HTML is written by another user and arrives by sync (`rel="opener"`
    // defeats the implicit noopener, `target="_top"` navigates the app itself). They are removed by
    // the check and set by the house in `forceLinkTarget` below.
    ADD_URI_SAFE_ATTR: ['data-list', 'width', 'height'],
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
 * Sanitizes HTML content using DOMPurify with Quill-safe configuration, READY TO BE DRAWN.
 *
 * A slide figure held by reference (`briefing/figura-de-slide.js`) leaves here as a transparent
 * placeholder plus its id, never as its sentinel `https` src: every caller sets the result as
 * `innerHTML`, and a live sentinel is a request to a host that does not exist, per figure per render.
 * The caller that shows the figure then fills its bytes in (`resolverFiguras`). The output is
 * therefore for DRAWING; what is stored goes through `htmlParaGuardar` (see `cleanQuillContent`).
 *
 * @param {string} html - HTML string to sanitize
 * @param {Object} [config] - Optional custom DOMPurify configuration
 * @returns {string} Sanitized HTML
 */
export function sanitizeQuillHtml(html, config = QUILL_DOMPURIFY_CONFIG) {
    if (!html) return '';
    // DOMPurify hooks are GLOBAL on the instance, so this one lives only for this call: sanitize is
    // synchronous, and the `finally` takes it out even when sanitize throws.
    DOMPurify.addHook('afterSanitizeAttributes', forceLinkTarget);
    try {
        // The id attribute is added AFTER the sanitizer, which does not list it: DOMPurify parses in
        // an inert document, so the sentinel inside it never reaches the network either.
        return marcarFigurasParaDesenho(DOMPurify.sanitize(html, config));
    } finally {
        DOMPurify.removeHook('afterSanitizeAttributes', forceLinkTarget);
    }
}

/**
 * Every link of rich content opens in a NEW tab with no way back to this one, whatever the author
 * wrote. The attributes come from another user through sync; the values the house needs are set
 * here instead of being accepted from the markup. Without `target` the presentation's link took the
 * EBGeo tab itself away (`frontend/tests/e2e-ui/briefing-link-e-figura-no-sanitize.repro.spec.js`);
 * with the author's own `rel` a `rel="opener"` would hand the opened page `window.opener`.
 * @param {Element} node - Node DOMPurify just finished with.
 */
function forceLinkTarget(node) {
    if (node.tagName !== 'A' || !node.hasAttribute('href')) return;
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
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

    // STORED, not drawn: an editor's figures go back to their sentinel before the sanitizer (which
    // drops the id attribute) and again after it (which marks them for drawing).
    const cleaned = htmlParaGuardar(sanitizeQuillHtml(htmlParaGuardar(html)))
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
            // JPEG has no alpha, and a fresh canvas is transparent BLACK: a pasted PNG or WebP with
            // transparency (a logo, a cut-out screenshot) came out on a black background. White is
            // the page colour of a slide. The format stays JPEG on purpose, because this picture
            // is base64 inside HTML that travels through sync, and a photo as PNG is several
            // times heavier; the declared loss is transparency, not legibility.
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, width, height);
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
 * Shows the refusal a picture earned, in pt-BR, whatever threw it.
 *
 * Only a FLAGGED refusal is quoted. `canvas.toDataURL`, `getSelection` and `insertEmbed` throw
 * too, and their messages are English engine text ("Failed to execute 'toDataURL'...") that must
 * never reach a toast.
 *
 * @param {*} error - Whatever the compression path rejected with
 */
function reportImageRefusal(error) {
    console.error('Error processing image:', error);
    // THE REASON, not a flat "Erro ao adicionar imagem": every rejection is a pt-BR sentence
    // naming the limit that was hit, and replacing it with a generic one threw away the only
    // thing the person could act on.
    showError(error?.isImageRefusal
        ? error.message
        : imageRefusalNotice(ImageRefusal.ILEGIVEL));
}

/** Said when a picture finishes compressing after its editor has left the page. */
const EDITOR_GONE_NOTICE = 'A imagem não foi inserida: o editor foi fechado ou o slide foi trocado antes de ela ficar pronta.';

/**
 * Whether the editor is still attached to the document.
 * @param {Object} quillInstance - Quill editor instance
 * @returns {boolean} False for a missing instance or a detached root
 */
function isEditorOnPage(quillInstance) {
    return Boolean(quillInstance?.root) && quillInstance.root.isConnected !== false;
}

/**
 * Compresses each picture and embeds it, refusing out loud the ones that do not fit.
 *
 * THE ONE PATH EVERY DOOR ENDS IN. The button, a paste and a drop used to be three different
 * stories: the button compressed and refused with a sentence, while the other two went through
 * Quill's stock uploader, which reads the file with a `FileReader` and inserts the base64 whole —
 * no byte ceiling, no pixel ceiling, no message. Funnelling all three here is the fix, and it is
 * why this is a function and not a body inside the button handler.
 *
 * A SELECTION IS REPLACED, as in any editor: text selected when the picture arrives is deleted.
 * That is what Quill's own uploader does too, and it is NEW for the toolbar button, whose old
 * handler inserted at the start of the selection and left the text alone.
 *
 * ONE REFUSAL DOES NOT CANCEL THE REST: pasting three pictures of which one is too large embeds
 * the other two and says why the third did not land. Dropping the batch would make the person
 * redo work that was never in question.
 *
 * @param {Object} quillInstance - Quill editor instance
 * @param {{index: number, length: number}} range - Where the pictures go
 * @param {File[]} files - Pictures to embed, in the order they arrived
 * @param {Object} [options] - Compression options passed to compressQuillImage
 * @returns {Promise<number>} How many pictures were embedded
 */
export async function insertQuillImages(quillInstance, range, files, options = {}) {
    if (!isEditorOnPage(quillInstance)) {
        showError(EDITOR_GONE_NOTICE);
        return 0;
    }
    // No range (an editor without focus) means the END of the slide, never index 0: a picture
    // dropped at the top of somebody's text is worse than one appended after it.
    let index = Number.isFinite(range?.index)
        ? range.index
        : Math.max(0, quillInstance.getLength() - 1);
    if (range?.length > 0) {
        quillInstance.deleteText(index, range.length, 'user');
    }

    let inseridas = 0;
    for (const file of files) {
        try {
            // Awaited one at a time, not `Promise.all`: the insertion index moves with each
            // embed, and a parallel decode would resolve in whatever order the pictures happen
            // to finish, which is not the order the person pasted them in.
            const compressedBase64 = await compressQuillImage(file, options);
            // A SLIDE FIGURE IS EMBEDDED BY REFERENCE when the host stores figures
            // (`guardarFiguraDeSlide`): the bytes go to the atlas image store and travel once,
            // and the HTML carries only the sentinel. Without the option (map notes) it is inline.
            const src = typeof options.guardarFigura === 'function'
                ? await options.guardarFigura(compressedBase64, file?.name || '')
                : compressedBase64;
            // RE-CHECKED AFTER THE AWAIT, which is the whole point: compression takes a decode and
            // a canvas, long enough for the person to move to another slide. The host empties
            // the container, the editor leaves the page but stays alive, and an insert here
            // would write a picture into a slide nobody is looking at.
            if (!isEditorOnPage(quillInstance)) {
                showError(EDITOR_GONE_NOTICE);
                return inseridas;
            }
            quillInstance.insertEmbed(index, 'image', src, 'user');
            index += 1;
            inseridas += 1;
        } catch (error) {
            reportImageRefusal(error);
        }
    }

    if (inseridas > 0) quillInstance.setSelection(index, 0, 'silent');
    return inseridas;
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
    // The SAME list the paste and drop doors enforce: the picker used to offer four formats while
    // Quill's stock uploader took two, so a WebP arrived by button and vanished by paste.
    input.accept = QUILL_IMAGE_ACCEPT;
    input.click();

    input.onchange = async () => {
        const file = input.files[0];
        if (!file) return;
        await insertQuillImages(quillInstance, quillInstance.getSelection(true), [file], options);
    };
}

/** Fills in the bytes of one figure element; set by the first page that shows slide figures. */
let resolverDaFigura = null;

/**
 * @param {*} node - An `<img>` (or anything).
 * @returns {string|null} The sentinel src of the figure it draws, from its id attribute, or null.
 */
function sentinelaDoElemento(node) {
    const id = typeof node?.getAttribute === 'function' ? node.getAttribute(ATRIBUTO_DA_FIGURA) : null;
    if (!id) return null;
    try {
        return srcDaFigura(id);
    } catch {
        return null;
    }
}

/**
 * The pixels a DRAWN figure element shows, as a JPEG data URL, or null when it has none yet.
 *
 * Synchronous on purpose: Quill's copy handler is. A figure is drawn from this tab's `blob:` URL,
 * which is same-origin, so the canvas is not tainted; the placeholder (1 pixel) and a figure whose
 * bytes never came are null, and the copy keeps the reference.
 *
 * @param {HTMLImageElement} node
 * @returns {string|null}
 */
function pixelsDaFigura(node) {
    try {
        if (!node?.complete || !(node.naturalWidth > 1) || !String(node.getAttribute('src')).startsWith('blob:')) return null;
        const canvas = document.createElement('canvas');
        canvas.width = node.naturalWidth;
        canvas.height = node.naturalHeight;
        canvas.getContext('2d').drawImage(node, 0, 0);
        return canvas.toDataURL('image/jpeg', 0.92);
    } catch {
        return null;
    }
}

/**
 * Teaches Quill the slide figure held by reference, and says who fills its bytes in.
 *
 * WHY THE IMAGE FORMAT IS REPLACED, and not only the HTML around it. Quill rebuilds an `<img>` from
 * its VALUE whenever it recreates the node (undo, redo, a paste, an embed), and the stock value is
 * the `src`: a figure whose element shows the placeholder or this tab's `blob:` URL would come back
 * as THAT, and the reference would be gone from the slide. Here the value of a figure element is its
 * sentinel, read from the id attribute, and creating from a sentinel draws the placeholder with the
 * id and asks for the bytes. As a side effect, filling the bytes in (a `src` change) is no longer a
 * change of the document, so it neither autosaves nor enters the undo history.
 *
 * Registration is GLOBAL to the Quill module and idempotent; a picture that is not a figure keeps
 * the stock behaviour.
 *
 * @param {Function} Quill - The Quill class (`import('quill')`).
 * @param {function(HTMLImageElement): *} [resolver] - Fills in one figure's bytes.
 */
export function registrarFiguraNoQuill(Quill, resolver) {
    if (typeof resolver === 'function') resolverDaFigura = resolver;
    const Imagem = Quill.import('formats/image');
    if (Imagem?.figuraPorReferencia) return;
    class FiguraPorReferencia extends Imagem {
        static figuraPorReferencia = true;

        static create(value) {
            const id = idDaFigura(value);
            if (!id) return super.create(value);
            const node = super.create(PLACEHOLDER_DA_FIGURA);
            node.setAttribute(ATRIBUTO_DA_FIGURA, id);
            // Asked after the node exists and outside Quill's own work: the resolver is async.
            Promise.resolve().then(() => resolverDaFigura?.(node)).catch(() => {});
            return node;
        }

        static value(node) {
            return sentinelaDoElemento(node) ?? super.value(node);
        }

        /**
         * What a COPY of the figure carries: its PIXELS inline and no reference (owner's decision
         * of 2026-09-26). Quill calls this only from its copy handler (`getSemanticHTML`); the
         * editors store `root.innerHTML`, so nothing saved goes through here. The reference named
         * bytes of the atlas it was born in, and a paste in ANOTHER atlas kept it and drew an empty
         * picture forever; an inline picture is what the paste already turns into a new figure of
         * the atlas that receives it. The price, inside the same atlas: a copied figure is stored
         * again under a new id. A figure not drawn yet keeps the reference.
         */
        html() {
            const pixels = sentinelaDoElemento(this.domNode) ? pixelsDaFigura(this.domNode) : null;
            if (!pixels) return this.domNode.outerHTML;
            const copia = this.domNode.cloneNode(false);
            copia.removeAttribute(ATRIBUTO_DA_FIGURA);
            copia.setAttribute('src', pixels);
            return copia.outerHTML;
        }
    }
    Quill.register(FiguraPorReferencia, true);
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
 * @param {Object} [options.imageCompressionOptions] - Image compression options; `guardarFigura`
 *   (dataUrl, name) → sentinel src makes the editor embed figures by reference
 * @param {function(HTMLImageElement): *} [options.resolverFigura] - Fills in a figure's bytes
 * @returns {Promise<Object>} Quill editor instance
 */
export async function createQuillEditor(container, options = {}) {
    const {
        theme = 'snow',
        placeholder = 'Digite aqui...',
        toolbar = QUILL_TOOLBAR_CONFIG,
        enableImageCompression = true,
        imageCompressionOptions = {},
        resolverFigura = null,
    } = options;

    const [{ default: Quill }] = await Promise.all([
        import('quill'),
        import('quill/dist/quill.snow.css')
    ]);
    registrarFiguraNoQuill(Quill, resolverFigura);

    // The handler runs long after construction, but the uploader's options are read DURING it, so
    // the instance cannot be named in them. A box filled in on the next line is the whole trick.
    const editor = {};

    const quillInstance = new Quill(container, {
        theme,
        placeholder,
        modules: {
            toolbar,
            // THE TWO DOORS QUILL WIRES BY ITSELF. `modules/uploader.js` owns both the `drop` on
            // the editor root and the pasted FILES that `modules/clipboard.js` forwards to it,
            // and its stock handler reads each file with a `FileReader` and inserts the base64
            // whole — no byte ceiling, no pixel ceiling, no message. Until this option existed,
            // the button was gated and Ctrl+V was not, which is backwards: a pasted screenshot is
            // the biggest picture most people will ever put in a slide, and a slide's HTML
            // travels through sync on every edit.
            uploader: {
                // The EMPTY string is on the list on purpose. `Uploader.upload` drops, without a
                // word, every file whose `type` is not listed, and a drag from Windows Explorer
                // can hand over `type: ''` for a perfectly good .jpg. Letting it through costs
                // nothing: `compressQuillImage` decodes it or refuses it WITH the sentence.
                mimetypes: [...QUILL_PASTE_MIME_TYPES, ''],
                handler: (range, files) => {
                    insertQuillImages(editor.quill, range, files, imageCompressionOptions);
                },
            },
            // THE THIRD DOOR, and it never reaches the uploader. Pasted HTML that already carries
            // `<img src="data:...">` (a picture copied out of a web page) is routed through
            // `convert` instead, which is synchronous, so there is no decode to measure and no
            // canvas to compress with. The matcher therefore never LEAVES an inline picture in
            // that Delta: it refuses the ones over the byte ceiling on the spot, and hands the
            // rest to `insertQuillImages` one tick later, so this door ends in the same path as
            // the other four (see `createPastedImageMatcher`).
            clipboard: {
                matchers: [['img', createPastedImageMatcher(editor, imageCompressionOptions)]],
            },
        }
    });
    editor.quill = quillInstance;

    if (enableImageCompression) {
        const toolbarModule = quillInstance.getModule('toolbar');
        toolbarModule.addHandler('image', () =>
            handleQuillImageUpload(quillInstance, imageCompressionOptions)
        );
    }

    return quillInstance;
}

/**
 * Clipboard matcher for an `<img>` arriving inside pasted HTML.
 *
 * It rewrites the Delta the earlier matchers built rather than touching the DOM: by the time a
 * selector matcher runs, `matchBlot` has already turned the node into an `{ insert: { image } }`
 * op, and that op is what would end up in the document.
 *
 * KEEPING THE SANITIZER INTACT: nothing here loosens `sanitizeQuillHtml`. This only TAKES
 * pictures OUT of the pasted Delta, and whatever is embedded afterwards is a JPEG this module
 * re-encoded itself, sanitized exactly as before at every point that renders slide content. An SVG
 * `data:` URL, the one inline type that can carry script, is refused by MIME before any decode.
 *
 * A FACTORY, because the matcher needs the editor it serves: Quill reads `modules.clipboard`
 * during construction, before the instance exists, so it receives the same late-filled `editor`
 * box the uploader handler uses.
 *
 * @param {{quill: ?Object}} editor - Box that holds the Quill instance once it is built
 * @param {Object} [options] - Compression options passed on to `insertQuillImages`
 * @returns {function(Element, Object): Object} Matcher returning the Delta minus inline pictures
 */
function createPastedImageMatcher(editor, options) {
    /** @type {File[]} Pictures taken out of the current paste, waiting for the async path. */
    let pendentes = [];
    let agendado = false;

    const despachar = () => {
        agendado = false;
        const files = pendentes;
        pendentes = [];
        const quill = editor.quill;
        if (!quill || files.length === 0) return;
        // `getSelection(true)` focuses the editor and can throw on a detached root, and the
        // promise below has no awaiter: both are caught here, or a lost picture would be silent.
        let range = null;
        try {
            range = isEditorOnPage(quill) ? quill.getSelection(true) : null;
        } catch {
            range = null;
        }
        insertQuillImages(quill, range, files, options).catch(reportImageRefusal);
    };

    return function matchPastedImage(node, delta) {
        // A FIGURE HELD BY REFERENCE (copied from a slide) is read by its id, not by what its element
        // showed: the placeholder is a `data:` GIF this path would refuse by type, and a `blob:` URL
        // is this tab's. Its sentinel embeds nothing, so it stays like any `https` picture.
        const src = sentinelaDoElemento(node)
            ?? (typeof node?.getAttribute === 'function' ? node.getAttribute('src') : null);
        const verdict = pastedHtmlImageVerdict(src, QUILL_IMAGE_CONFIG.maxSizeMB * 1024 * 1024);

        // No inline bytes (`https://`, `blob:`): nothing is being embedded, so it stays.
        if (verdict.keep && verdict.bytes === undefined) return delta;

        const semEsta = () => withoutRefusedImages(delta, (candidate) => candidate === src);
        if (!verdict.keep) {
            showError(verdict.reason);
            return semEsta();
        }

        // INLINE BYTES NEVER STAY IN THE SYNCHRONOUS DELTA, even under the byte ceiling. `convert`
        // cannot decode, so a picture left here entered whole: up to 5 MB of base64 in a slide's
        // HTML, with no compression and no pixel ceiling, on the one door that bypassed both. It
        // is taken out and sent down the same path a pasted FILE takes, one tick later, after
        // Quill has applied the rest of the paste. The price is position: the pictures land at the
        // caret that the paste leaves, not where they sat inside the pasted text.
        const decoded = dataUrlToBytes(src);
        if (!decoded || !QUILL_PASTE_MIME_TYPES.includes(decoded.type)) {
            showError(decoded
                ? imageRefusalNotice(ImageRefusal.TIPO, { tipos: [...QUILL_PASTE_MIME_TYPES] })
                : imageRefusalNotice(ImageRefusal.ILEGIVEL));
            return semEsta();
        }
        pendentes.push(new File([decoded.bytes], 'imagem-colada', { type: decoded.type }));
        if (!agendado) {
            agendado = true;
            setTimeout(despachar, 0);
        }
        return semEsta();
    };
}
