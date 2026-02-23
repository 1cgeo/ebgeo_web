// Path: js/briefing/export/pdf-page-composer.js

/**
 * @fileoverview PDF page composition for briefing export.
 * Handles layout of each PDF page: map/viewer image on left, text panel on right.
 *
 * A4 landscape (297mm x 210mm) with proportions mirroring the presentation layout.
 *
 * @module briefing/export/pdf-page-composer
 */

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

const TEXT_PADDING = 4;

// ============================================================================
// HTML-TO-TEXT CONVERSION
// ============================================================================

/**
 * Converts sanitized HTML (Quill output) to structured plain text.
 * Handles lists, headings, line breaks, and block elements.
 * @param {string} html - HTML string from slide content
 * @returns {string} Plain text with basic formatting preserved
 */
export function stripHtmlToPlainText(html) {
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

        switch (tag) {
            case 'br':
                result += '\n';
                break;

            case 'p':
            case 'div':
                result += walkNode(child) + '\n';
                break;

            case 'h1':
            case 'h2':
            case 'h3':
            case 'h4':
                result += walkNode(child).toUpperCase() + '\n\n';
                break;

            case 'ul':
            case 'ol':
                result += walkList(child, tag === 'ol') + '\n';
                break;

            case 'li':
                result += walkNode(child);
                break;

            case 'blockquote':
                result += '  ' + walkNode(child).replace(/\n/g, '\n  ') + '\n';
                break;

            case 'strong':
            case 'b':
                result += walkNode(child);
                break;

            case 'em':
            case 'i':
                result += walkNode(child);
                break;

            case 'a':
                result += walkNode(child);
                break;

            default:
                result += walkNode(child);
                break;
        }
    }

    return result;
}

/**
 * Processes a list element (ul/ol) into formatted text.
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
 */
export function composePage(doc, imageDataUrl, slide, pageIndex, totalSlides, briefingName) {
    // --- Image ---
    if (imageDataUrl) {
        doc.addImage(imageDataUrl, 'JPEG', MARGIN, MARGIN, IMAGE_W, CONTENT_H);
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

    // --- Text Panel Background ---
    const textX = MARGIN + IMAGE_W + GAP;
    const textY = MARGIN;

    doc.setFillColor(249, 250, 251);
    doc.rect(textX, textY, TEXT_PANEL_W, CONTENT_H, 'F');

    doc.setDrawColor(229, 231, 235);
    doc.setLineWidth(0.3);
    doc.rect(textX, textY, TEXT_PANEL_W, CONTENT_H, 'S');

    // --- Title ---
    const textContentW = TEXT_PANEL_W - 2 * TEXT_PADDING;
    let currentY = textY + 8;

    if (slide.title) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.setTextColor(17, 24, 39);
        const titleLines = doc.splitTextToSize(slide.title, textContentW);
        doc.text(titleLines, textX + TEXT_PADDING, currentY);
        currentY += titleLines.length * 6 + 4;
    }

    // --- Separator line ---
    if (slide.title && slide.content) {
        doc.setDrawColor(229, 231, 235);
        doc.setLineWidth(0.2);
        doc.line(textX + TEXT_PADDING, currentY, textX + TEXT_PANEL_W - TEXT_PADDING, currentY);
        currentY += 4;
    }

    // --- Content ---
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

    // --- Footer ---
    const footerY = PAGE_H - MARGIN - 2;
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(107, 114, 128);
    doc.text(`${pageIndex + 1} / ${totalSlides}`, PAGE_W / 2, footerY, { align: 'center' });
    doc.text(briefingName, MARGIN, footerY);
    doc.text(new Date().toLocaleDateString('pt-BR'), PAGE_W - MARGIN, footerY, { align: 'right' });
}

/**
 * Composes an error page when slide capture fails entirely.
 * @param {import('jspdf').jsPDF} doc - jsPDF document instance
 * @param {Object} slide - Slide data
 * @param {number} pageIndex - Zero-based page index
 * @param {number} totalSlides - Total number of slides
 * @param {string} briefingName - Name of the briefing
 * @param {string} errorMessage - Error description
 */
export function composeErrorPage(doc, slide, pageIndex, totalSlides, briefingName, errorMessage) {
    composePage(doc, null, slide, pageIndex, totalSlides, briefingName);

    // Overlay error text on image area
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(156, 163, 175);
    doc.text(errorMessage, MARGIN + IMAGE_W / 2, MARGIN + CONTENT_H / 2 + 8, { align: 'center' });
}
