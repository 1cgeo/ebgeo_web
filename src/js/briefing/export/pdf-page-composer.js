// Path: js/briefing/export/pdf-page-composer.js

/**
 * @fileoverview PDF page composition for briefing export.
 * Handles layout of each PDF page: map/viewer image on left, text panel on right.
 *
 * A4 landscape (297mm x 210mm) with proportions mirroring the presentation layout.
 *
 * - Map image is rendered with aspect-fit (no distortion, centered with background fill).
 * - Text panel is rendered via html2canvas to preserve rich text formatting and images.
 *
 * @module briefing/export/pdf-page-composer
 */

import html2canvas from 'html2canvas';

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

/** Pixels per mm for off-screen text panel rendering */
const TEXT_RENDER_SCALE = 3;

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
 * @returns {Promise<void>}
 */
export async function composePage(doc, imageDataUrl, slide, pageIndex, totalSlides, briefingName) {
    // --- Background fill for image area (dark fill behind letterbox) ---
    doc.setFillColor(24, 24, 27);
    doc.rect(MARGIN, MARGIN, IMAGE_W, CONTENT_H, 'F');

    // --- Map/viewer image (aspect-fit) ---
    if (imageDataUrl) {
        await addImageAspectFit(doc, imageDataUrl, MARGIN, MARGIN, IMAGE_W, CONTENT_H);
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
        const textPanelDataUrl = await renderTextPanel(slide, TEXT_PANEL_W, CONTENT_H);
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
    composeFooter(doc, pageIndex, totalSlides, briefingName);
}

/**
 * Composes an error page when slide capture fails entirely.
 * @param {import('jspdf').jsPDF} doc - jsPDF document instance
 * @param {Object} slide - Slide data
 * @param {number} pageIndex - Zero-based page index
 * @param {number} totalSlides - Total number of slides
 * @param {string} briefingName - Name of the briefing
 * @param {string} errorMessage - Error description
 * @returns {Promise<void>}
 */
export async function composeErrorPage(doc, slide, pageIndex, totalSlides, briefingName, errorMessage) {
    await composePage(doc, null, slide, pageIndex, totalSlides, briefingName);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(156, 163, 175);
    doc.text(errorMessage, MARGIN + IMAGE_W / 2, MARGIN + CONTENT_H / 2 + 8, { align: 'center' });
}

// ============================================================================
// IMAGE ASPECT-FIT
// ============================================================================

/**
 * Adds an image to the PDF preserving its aspect ratio (aspect-fit).
 * Centers the image within the available area; remaining space is left
 * to the pre-filled background.
 * @param {import('jspdf').jsPDF} doc - jsPDF document instance
 * @param {string} dataUrl - Image data URL
 * @param {number} areaX - Area X position in mm
 * @param {number} areaY - Area Y position in mm
 * @param {number} areaW - Area width in mm
 * @param {number} areaH - Area height in mm
 * @returns {Promise<void>}
 */
async function addImageAspectFit(doc, dataUrl, areaX, areaY, areaW, areaH) {
    const dims = await getImageDimensions(dataUrl);
    if (!dims) {
        doc.addImage(dataUrl, 'JPEG', areaX, areaY, areaW, areaH);
        return;
    }

    const imgAspect = dims.width / dims.height;
    const areaAspect = areaW / areaH;

    let drawW, drawH, drawX, drawY;

    if (imgAspect > areaAspect) {
        // Image is wider — fit to width
        drawW = areaW;
        drawH = areaW / imgAspect;
        drawX = areaX;
        drawY = areaY + (areaH - drawH) / 2;
    } else {
        // Image is taller — fit to height
        drawH = areaH;
        drawW = areaH * imgAspect;
        drawX = areaX + (areaW - drawW) / 2;
        drawY = areaY;
    }

    doc.addImage(dataUrl, 'JPEG', drawX, drawY, drawW, drawH);
}

/**
 * Gets the natural dimensions of an image from its data URL.
 * @param {string} dataUrl - Image data URL
 * @returns {Promise<{width: number, height: number}|null>}
 */
function getImageDimensions(dataUrl) {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
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
 * captures it, and returns a data URL.
 * @param {Object} slide - Slide data (title, content)
 * @param {number} widthMm - Panel width in mm
 * @param {number} heightMm - Panel height in mm
 * @returns {Promise<string|null>} PNG data URL or null on failure
 */
async function renderTextPanel(slide, widthMm, heightMm) {
    if (!slide.title && !slide.content) return null;

    const widthPx = Math.round(widthMm * TEXT_RENDER_SCALE);
    const heightPx = Math.round(heightMm * TEXT_RENDER_SCALE);

    // Create off-screen container reusing presentation panel BEM classes
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

        // Capture with html2canvas
        const canvas = await html2canvas(container, {
            width: widthPx,
            height: heightPx,
            scale: 1,
            useCORS: true,
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
 * Renders the page footer with slide count, briefing name, and date.
 * @param {import('jspdf').jsPDF} doc - jsPDF document instance
 * @param {number} pageIndex - Zero-based page index
 * @param {number} totalSlides - Total number of slides
 * @param {string} briefingName - Name of the briefing
 */
function composeFooter(doc, pageIndex, totalSlides, briefingName) {
    const footerY = PAGE_H - MARGIN - 2;
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(107, 114, 128);
    doc.text(`${pageIndex + 1} / ${totalSlides}`, PAGE_W / 2, footerY, { align: 'center' });
    doc.text(briefingName, MARGIN, footerY);
    doc.text(new Date().toLocaleDateString('pt-BR'), PAGE_W - MARGIN, footerY, { align: 'right' });
}
