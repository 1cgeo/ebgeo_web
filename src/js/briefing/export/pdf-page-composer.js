// Path: js/briefing/export/pdf-page-composer.js

/**
 * @fileoverview PDF page composition for briefing export.
 * Handles layout of each PDF page: map/viewer image on left, text panel on right.
 *
 * A4 landscape (297mm x 210mm) with proportions mirroring the presentation layout.
 *
 * - Map image is center-cropped to fill the PDF area (no black bars, no distortion).
 * - Text panel is rendered via html2canvas to preserve rich text formatting and images.
 *
 * @module briefing/export/pdf-page-composer
 */

import { loadLogoImage } from '@utils/logo-base64.js';

// Lazy-loaded to keep html2canvas out of the core chunk.
// Only loaded when PDF export is actually invoked.
let _html2canvas = null;

async function getHtml2Canvas() {
    if (!_html2canvas) {
        const mod = await import('html2canvas');
        _html2canvas = mod.default;
    }
    return _html2canvas;
}

// ============================================================================
// LOGO LOADER
// ============================================================================

/** Cached PNG data URL for jsPDF embedding */
let _logoPngDataUrl = null;

/**
 * Returns the EBGeo logo as a PNG data URL for embedding in jsPDF.
 * jsPDF does not support WEBP -- transparent areas would render as black.
 * Converts via an off-screen canvas once, then caches the result.
 * @returns {Promise<string|null>}
 */
export async function loadLogoDataUrl() {
    if (_logoPngDataUrl) return _logoPngDataUrl;

    try {
        const img = await loadLogoImage();
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        _logoPngDataUrl = canvas.toDataURL('image/png');
        return _logoPngDataUrl;
    } catch {
        return null;
    }
}

// ============================================================================
// CONSTANTS
// ============================================================================

const PAGE_W = 297;
const PAGE_H = 210;
const MARGIN = 5;
const USABLE_W = PAGE_W - 2 * MARGIN;
const USABLE_H = PAGE_H - 2 * MARGIN;

const TEXT_PANEL_W = 77;
const GAP = 5;
const IMAGE_W = USABLE_W - TEXT_PANEL_W - GAP;

const FOOTER_H = 8;
const CONTENT_H = USABLE_H - FOOTER_H;

/** Target aspect ratio for the image area in the PDF */
const IMAGE_AREA_ASPECT = IMAGE_W / CONTENT_H;

/**
 * Base pixel width for the off-screen text panel element.
 * A wider base produces better text layout before html2canvas captures it.
 */
const TEXT_PANEL_BASE_PX = 420;

/**
 * html2canvas capture scale multiplier applied on top of the base element size.
 * Output resolution = TEXT_PANEL_BASE_PX * HTML2CANVAS_SCALE.
 */
const HTML2CANVAS_SCALE = 3;

// ============================================================================
// PAGE COMPOSITION
// ============================================================================

/**
 * Composes a single PDF page with image and text panel.
 * @param {import('jspdf').jsPDF} doc - jsPDF document instance
 * @param {string} imageDataUrl - Data URL of the captured slide image
 * @param {Object} slide - Slide data (title, content)
 * @param {number} pageIndex - Zero-based page index
 * @param {number} totalSlides - Total number of slides
 * @param {string} briefingName - Name of the briefing
 * @param {string|null} [logoDataUrl] - Pre-loaded logo data URL for footer
 * @returns {Promise<void>}
 */
export async function composePage(doc, imageDataUrl, slide, pageIndex, totalSlides, briefingName, logoDataUrl) {
    // --- Map/viewer image (center-cropped to fill) ---
    if (imageDataUrl) {
        const croppedDataUrl = await cropImageToAspectRatio(imageDataUrl, IMAGE_AREA_ASPECT);
        doc.addImage(
            croppedDataUrl || imageDataUrl,
            'JPEG', MARGIN, MARGIN, IMAGE_W, CONTENT_H
        );
    } else {
        // Error placeholder
        doc.setFillColor(243, 244, 246);
        doc.rect(MARGIN, MARGIN, IMAGE_W, CONTENT_H, 'F');
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(12);
        doc.setTextColor(107, 114, 128);
        doc.text(
            `Erro ao capturar slide ${pageIndex + 1}`,
            MARGIN + IMAGE_W / 2,
            MARGIN + CONTENT_H / 2,
            { align: 'center' }
        );
    }

    // --- Text panel (rendered via html2canvas) ---
    const textX = MARGIN + IMAGE_W + GAP;
    const textY = MARGIN;

    try {
        const textPanelDataUrl = await renderTextPanel(slide);
        if (textPanelDataUrl) {
            doc.addImage(textPanelDataUrl, 'PNG', textX, textY, TEXT_PANEL_W, CONTENT_H);
        } else {
            renderTextPanelFallback(doc, slide, textX, textY);
        }
    } catch (error) {
        console.warn('html2canvas text panel rendering failed, using fallback:', error);
        renderTextPanelFallback(doc, slide, textX, textY);
    }

    // --- Footer ---
    composeFooter(doc, pageIndex, totalSlides, briefingName, logoDataUrl);
}

/**
 * Composes an error page when slide capture fails entirely.
 * @param {import('jspdf').jsPDF} doc - jsPDF document instance
 * @param {Object} slide - Slide data
 * @param {number} pageIndex - Zero-based page index
 * @param {number} totalSlides - Total number of slides
 * @param {string} briefingName - Name of the briefing
 * @param {string} errorMessage - Error description
 * @param {string|null} [logoDataUrl] - Pre-loaded logo data URL for footer
 * @returns {Promise<void>}
 */
export async function composeErrorPage(doc, slide, pageIndex, totalSlides, briefingName, errorMessage, logoDataUrl) {
    await composePage(doc, null, slide, pageIndex, totalSlides, briefingName, logoDataUrl);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(156, 163, 175);
    doc.text(errorMessage, MARGIN + IMAGE_W / 2, MARGIN + CONTENT_H / 2 + 8, { align: 'center' });
}

// ============================================================================
// IMAGE CENTER-CROP
// ============================================================================

/**
 * Crops an image (center crop) to match a target aspect ratio.
 * This avoids both distortion and black bars — the screenshot fills
 * the entire PDF image area, trimming only the excess edges.
 * @param {string} dataUrl - Source image data URL
 * @param {number} targetAspect - Target width/height ratio
 * @returns {Promise<string|null>} Cropped JPEG data URL, or null on failure
 */
async function cropImageToAspectRatio(dataUrl, targetAspect) {
    const img = await loadImage(dataUrl);
    if (!img) return null;

    const srcW = img.naturalWidth;
    const srcH = img.naturalHeight;
    const srcAspect = srcW / srcH;

    let cropX = 0;
    let cropY = 0;
    let cropW = srcW;
    let cropH = srcH;

    if (srcAspect > targetAspect) {
        // Source is wider than target — trim sides
        cropW = Math.round(srcH * targetAspect);
        cropX = Math.round((srcW - cropW) / 2);
    } else if (srcAspect < targetAspect) {
        // Source is taller than target — trim top/bottom
        cropH = Math.round(srcW / targetAspect);
        cropY = Math.round((srcH - cropH) / 2);
    }

    const canvas = document.createElement('canvas');
    canvas.width = cropW;
    canvas.height = cropH;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    return canvas.toDataURL('image/jpeg', 0.92);
}

/**
 * Loads an image from a data URL.
 * @param {string} dataUrl - Image data URL
 * @returns {Promise<HTMLImageElement|null>}
 */
function loadImage(dataUrl) {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = dataUrl;
    });
}

// ============================================================================
// TEXT PANEL RENDERING (html2canvas)
// ============================================================================

/**
 * Renders the slide's text panel as an image using html2canvas.
 * Creates a temporary off-screen DOM element styled like the presentation panel,
 * captures it at high resolution, and returns a data URL.
 * @param {Object} slide - Slide data (title, content)
 * @returns {Promise<string|null>} PNG data URL or null on failure
 */
async function renderTextPanel(slide) {
    if (!slide.title && !slide.content) return null;

    // Create off-screen container reusing presentation panel BEM classes.
    // The .briefing-pdf-export-capture class (CSS) overrides fixed positioning
    // and sets width/height via CSS custom properties.
    const container = document.createElement('div');
    container.className = 'briefing-text-panel briefing-pdf-export-capture';
    document.body.appendChild(container);

    try {
        // Title section
        if (slide.title) {
            const titleSection = document.createElement('div');
            titleSection.className = 'briefing-text-panel__title';

            const titleText = document.createElement('h2');
            titleText.className = 'briefing-text-panel__title-text';
            titleText.textContent = slide.title;

            titleSection.appendChild(titleText);
            container.appendChild(titleSection);
        }

        // Content section
        if (slide.content) {
            const contentSection = document.createElement('div');
            contentSection.className = 'briefing-text-panel__content';
            contentSection.innerHTML = slide.content;
            container.appendChild(contentSection);
        }

        // Capture with html2canvas at high resolution
        const html2canvas = await getHtml2Canvas();
        const canvas = await html2canvas(container, {
            width: TEXT_PANEL_BASE_PX,
            height: Math.round(TEXT_PANEL_BASE_PX * (CONTENT_H / TEXT_PANEL_W)),
            scale: HTML2CANVAS_SCALE,
            useCORS: true,
            allowTaint: true,
            logging: false,
            backgroundColor: '#f9fafb'
        });

        return canvas.toDataURL('image/png');
    } finally {
        document.body.removeChild(container);
    }
}

// ============================================================================
// TEXT PANEL FALLBACK (jsPDF native text)
// ============================================================================

/**
 * Fallback text panel rendering using jsPDF native text APIs.
 * Used when html2canvas fails. Strips HTML to plain text.
 * @param {import('jspdf').jsPDF} doc - jsPDF document instance
 * @param {Object} slide - Slide data
 * @param {number} textX - Panel X position in mm
 * @param {number} textY - Panel Y position in mm
 */
function renderTextPanelFallback(doc, slide, textX, textY) {
    const TEXT_PADDING = 4;
    const textContentW = TEXT_PANEL_W - 2 * TEXT_PADDING;

    // Background
    doc.setFillColor(249, 250, 251);
    doc.rect(textX, textY, TEXT_PANEL_W, CONTENT_H, 'F');

    doc.setDrawColor(229, 231, 235);
    doc.setLineWidth(0.3);
    doc.rect(textX, textY, TEXT_PANEL_W, CONTENT_H, 'S');

    let currentY = textY + 8;

    // Title
    if (slide.title) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.setTextColor(17, 24, 39);
        const titleLines = doc.splitTextToSize(slide.title, textContentW);
        doc.text(titleLines, textX + TEXT_PADDING, currentY);
        currentY += titleLines.length * 6 + 4;
    }

    // Separator
    if (slide.title && slide.content) {
        doc.setDrawColor(229, 231, 235);
        doc.setLineWidth(0.2);
        doc.line(textX + TEXT_PADDING, currentY, textX + TEXT_PANEL_W - TEXT_PADDING, currentY);
        currentY += 4;
    }

    // Content (stripped to plain text)
    if (slide.content) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(55, 65, 81);

        const plainContent = stripHtmlToPlainText(slide.content);
        const contentLines = doc.splitTextToSize(plainContent, textContentW);
        const maxContentLines = Math.floor((CONTENT_H - (currentY - textY) - TEXT_PADDING) / 4.2);
        const visibleLines = contentLines.slice(0, maxContentLines);
        doc.text(visibleLines, textX + TEXT_PADDING, currentY);
    }
}

/**
 * Converts sanitized HTML (Quill output) to structured plain text.
 * Used as fallback when html2canvas is unavailable.
 * @param {string} html - HTML string from slide content
 * @returns {string} Plain text with basic formatting preserved
 */
function stripHtmlToPlainText(html) {
    if (!html) return '';
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    return walkNode(doc.body).trim();
}

/**
 * Recursively walks DOM nodes to extract text.
 * @param {Node} node - DOM node to process
 * @returns {string} Extracted text
 */
function walkNode(node) {
    let result = '';

    for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
            result += child.textContent;
            continue;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) continue;

        const tag = child.tagName.toLowerCase();

        if (tag === 'br') { result += '\n'; continue; }
        if (tag === 'p' || tag === 'div') { result += walkNode(child) + '\n'; continue; }
        if (['h1', 'h2', 'h3', 'h4'].includes(tag)) { result += walkNode(child).toUpperCase() + '\n\n'; continue; }
        if (tag === 'ul' || tag === 'ol') { result += walkList(child, tag === 'ol') + '\n'; continue; }
        if (tag === 'blockquote') { result += '  ' + walkNode(child).replace(/\n/g, '\n  ') + '\n'; continue; }

        result += walkNode(child);
    }

    return result;
}

/**
 * Processes a list element into formatted text.
 * @param {Element} listEl - UL or OL element
 * @param {boolean} ordered - Whether the list is ordered
 * @returns {string} Formatted list text
 */
function walkList(listEl, ordered) {
    let result = '';
    let index = 1;

    for (const child of listEl.children) {
        if (child.tagName.toLowerCase() === 'li') {
            const prefix = ordered ? `${index}. ` : '- ';
            result += prefix + walkNode(child).trim() + '\n';
            index++;
        }
    }

    return result;
}

// ============================================================================
// FOOTER
// ============================================================================

/**
 * Renders the page footer with logo, slide count, briefing name, and date.
 * @param {import('jspdf').jsPDF} doc - jsPDF document instance
 * @param {number} pageIndex - Zero-based page index
 * @param {number} totalSlides - Total number of slides
 * @param {string} briefingName - Name of the briefing
 * @param {string|null} [logoDataUrl] - Pre-loaded logo data URL
 */
function composeFooter(doc, pageIndex, totalSlides, briefingName, logoDataUrl) {
    const footerY = PAGE_H - MARGIN - 2;
    const LOGO_H = 5;

    // EBGeo logo (small, left-aligned in footer)
    let textLeftX = MARGIN;
    if (logoDataUrl) {
        doc.addImage(logoDataUrl, 'PNG', MARGIN, footerY - LOGO_H, LOGO_H, LOGO_H);
        textLeftX = MARGIN + LOGO_H + 2;
    }

    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(107, 114, 128);
    doc.text(`${pageIndex + 1} / ${totalSlides}`, PAGE_W / 2, footerY, { align: 'center' });
    doc.text(briefingName, textLeftX, footerY);
    doc.text(new Date().toLocaleDateString('pt-BR'), PAGE_W - MARGIN, footerY, { align: 'right' });
}
