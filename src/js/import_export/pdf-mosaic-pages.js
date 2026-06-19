// Path: js/import_export/pdf-mosaic-pages.js

/**
 * @module import_export/pdf-mosaic-pages
 * @description jsPDF drawing for the non-map pages of a mosaic export:
 * the instructions cover, the face-down assembly overview, and the per-tile
 * "verso" (back) pages. All drawing is vector (crisp + tiny file size).
 *
 * Assembly model (agreed with the user):
 *   - Print double-sided so the duplex flip preserves top/bottom: this means the
 *     LONG edge for portrait but the SHORT edge for landscape (the A4 vertical
 *     edge — the one that keeps the verso "TOPO" over the map's North — is the
 *     297 mm long edge in portrait and the 210 mm short edge in landscape).
 *   - Lay every sheet MAP-DOWN; rotate each so the "↑ TOPO" mark points away.
 *   - Place each sheet by the Linha/Coluna shown on its back — the back grid is
 *     already MIRRORED (columns reversed), because the final step flips the whole
 *     taped block left↔right, which un-mirrors it into the correct map.
 *
 * @see pdf-mosaic-geometry.js#mirrorAssemblyPosition
 */

import { mirrorAssemblyPosition } from './pdf-mosaic-geometry.js';

// Palette (RGB) — mirrors the app's primary green and neutral greys.
const PRIMARY = [80, 141, 78];
const PRIMARY_DARK = [58, 107, 56];
const INK = [40, 40, 40];
const MUTED = [110, 110, 110];
const FAINT_FILL = [244, 246, 244];
const HILITE_FILL = [80, 141, 78];
const BORDER = [150, 150, 150];

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Draws the instructions cover (front of the first sheet).
 * @param {import('jspdf').jsPDF} doc
 * @param {Object} opts
 * @param {number} opts.rows
 * @param {number} opts.cols
 * @param {string} opts.scaleLabel - Human scale, e.g. "1:25.000"
 * @param {number} opts.dpi
 * @param {'landscape'|'portrait'} opts.orientation - Page orientation (sets duplex edge)
 * @param {string} [opts.title] - Optional map title
 * @param {number} opts.pageW - Page width (mm)
 * @param {number} opts.pageH - Page height (mm)
 */
export function drawCoverPage(doc, { rows, cols, scaleLabel, dpi, orientation, title, pageW, pageH }) {
    // The duplex flip must preserve top/bottom so the verso "TOPO" backs the map's
    // North. That requires flipping about the A4 vertical (210 mm) edge — which is
    // the LONG edge in portrait but the SHORT edge in landscape.
    const duplexEdge = orientation === 'landscape' ? 'CURTA' : 'LONGA';
    const margin = 16;
    let y = margin + 6;

    setColor(doc, 'text', PRIMARY_DARK);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text('Mosaico para impressão', margin, y);

    if (title) {
        y += 9;
        doc.setFontSize(13);
        setColor(doc, 'text', INK);
        doc.text(title, margin, y);
    }

    y += 9;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    setColor(doc, 'text', MUTED);
    doc.text(
        `${rows} × ${cols} páginas A4  ·  escala ${scaleLabel}  ·  ${dpi} DPI  ·  ${rows * cols} folhas`,
        margin, y
    );

    // Divider
    y += 6;
    setColor(doc, 'draw', BORDER);
    doc.setLineWidth(0.3);
    doc.line(margin, y, pageW - margin, y);
    y += 9;

    // --- Instruction steps ---
    const steps = [
        `Imprima este PDF em FRENTE E VERSO, virando pela borda ${duplexEdge}, em tamanho real (100% / "Tamanho real" — não use "Ajustar à página").`,
        'Separe as folhas de mapa (a capa e este resumo ficam de fora).',
        'Apare a borda branca não-impressa de cada folha nas emendas internas, para o mapa encostar no limite do papel.',
        'Vire todas as folhas com o MAPA PARA BAIXO. Gire cada folha até a seta "TOPO" do verso apontar para longe de você.',
        'Monte a grade seguindo a Linha/Coluna do verso. O diagrama do verso já está espelhado para esta montagem de costas.',
        'Una as folhas vizinhas com fita adesiva pelo verso.',
        'Vire todo o bloco da ESQUERDA para a DIREITA. O mapa aparece correto e contínuo.',
    ];

    doc.setFontSize(11);
    const textW = pageW - 2 * margin - 8;
    for (let i = 0; i < steps.length; i++) {
        setColor(doc, 'text', PRIMARY_DARK);
        doc.setFont('helvetica', 'bold');
        doc.text(`${i + 1}.`, margin, y);

        setColor(doc, 'text', INK);
        doc.setFont('helvetica', 'normal');
        const lines = doc.splitTextToSize(steps[i], textW);
        doc.text(lines, margin + 7, y);
        y += lines.length * 5.4 + 2.6;
    }

    // Self-check note about duplex orientation.
    y += 2;
    setColor(doc, 'text', MUTED);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9.5);
    const note = doc.splitTextToSize(
        'Verificação: a seta "TOPO" do verso deve cair sobre a mesma borda que o topo do mapa na frente. ' +
        'Se sair invertida na sua impressora, troque a opção de frente-e-verso para a borda oposta (curta / longa).',
        pageW - 2 * margin
    );
    doc.text(note, margin, y);
    y += note.length * 4.6 + 4;

    // --- Small final-layout diagram (non-mirrored: the finished map) ---
    const diagH = Math.min(pageH - y - margin, 46);
    if (diagH > 16) {
        setColor(doc, 'text', MUTED);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.text('Resultado final (mapa montado):', margin, y);
        const box = fitGrid({ rows, cols, pageW, pageH, maxW: pageW - 2 * margin, maxH: diagH - 6 });
        drawGrid(doc, {
            x: margin, y: y + 3, cellW: box.cellW, cellH: box.cellH,
            rows, cols, mirror: false, labelAll: true, highlight: null,
        });
    }
}

/**
 * Draws the face-down assembly overview (back of the first sheet): the full grid
 * MIRRORED, every cell labelled, so the operator can see the whole layout at once.
 * @param {import('jspdf').jsPDF} doc
 * @param {Object} opts
 * @param {number} opts.rows
 * @param {number} opts.cols
 * @param {number} opts.pageW
 * @param {number} opts.pageH
 */
export function drawOverviewPage(doc, { rows, cols, pageW, pageH }) {
    const margin = 16;
    let y = margin + 6;

    setColor(doc, 'text', PRIMARY_DARK);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(17);
    doc.text('Disposição na bancada', margin, y);

    y += 8;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    setColor(doc, 'text', MUTED);
    doc.text('Com o MAPA PARA BAIXO, distribua as folhas exatamente assim (já espelhado):', margin, y);

    drawTopMark(doc, pageW, margin);

    y += 8;
    const box = fitGrid({
        rows, cols, pageW, pageH,
        maxW: pageW - 2 * margin,
        maxH: pageH - y - margin - 6,
    });
    const gridX = (pageW - box.cellW * cols) / 2;
    drawGrid(doc, {
        x: gridX, y, cellW: box.cellW, cellH: box.cellH,
        rows, cols, mirror: true, labelAll: true, highlight: null,
    });
}

/**
 * Draws the back (verso) of a single map tile.
 * @param {import('jspdf').jsPDF} doc
 * @param {Object} opts
 * @param {number} opts.row - 0-based final row
 * @param {number} opts.col - 0-based final column
 * @param {number} opts.rows
 * @param {number} opts.cols
 * @param {number} opts.pageW
 * @param {number} opts.pageH
 */
export function drawVersoPage(doc, { row, col, rows, cols, pageW, pageH }) {
    const margin = 14;

    const { assemblyCol } = mirrorAssemblyPosition({ row, col, cols });

    // "↑ TOPO" mark near the top edge.
    drawTopMark(doc, pageW, margin);

    // Heading.
    let y = margin + 20;
    setColor(doc, 'text', MUTED);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('MONTAGEM — VERSO PARA CIMA', pageW / 2, y, { align: 'center' });

    // Dominant guidance describes the BENCH position the operator must use, never
    // the final column (which is mirrored on the bench and would invite the exact
    // wrong placement). Row is never mirrored, so it can be shown large directly.
    y += 12;
    setColor(doc, 'text', PRIMARY_DARK);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(26);
    doc.text(`LINHA ${row + 1}`, pageW / 2, y, { align: 'center' });

    y += 8;
    setColor(doc, 'text', INK);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(12);
    doc.text(
        `Coloque na ${assemblyCol + 1}ª coluna da esquerda — veja a célula destacada`,
        pageW / 2, y, { align: 'center' }
    );

    // Mirrored grid with this tile highlighted (the primary, unambiguous guide).
    const top = y + 6;
    const bottom = pageH - margin - 12;
    const box = fitGrid({
        rows, cols, pageW, pageH,
        maxW: pageW - 2 * margin - 20,
        maxH: bottom - top,
    });
    const gridX = (pageW - box.cellW * cols) / 2;
    drawGrid(doc, {
        x: gridX, y: top, cellW: box.cellW, cellH: box.cellH,
        rows, cols, mirror: true, labelAll: false, highlight: { row, col },
    });

    // Footer: the tile's identity in the FINISHED map, plus the final action.
    setColor(doc, 'text', MUTED);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9.5);
    doc.text(
        `Folha L${row + 1}C${col + 1} do mapa final · cole e vire o bloco da esquerda para a direita.`,
        pageW / 2, pageH - margin - 4, { align: 'center' }
    );
}

// ============================================================================
// PRIVATE DRAWING HELPERS
// ============================================================================

/**
 * Draws the "↑ TOPO" orientation mark centred near the top edge.
 * @param {import('jspdf').jsPDF} doc
 * @param {number} pageW
 * @param {number} margin
 */
function drawTopMark(doc, pageW, margin) {
    const cx = pageW / 2;
    const tipY = margin;
    const baseY = margin + 7;
    const half = 5;

    setColor(doc, 'fill', PRIMARY);
    doc.triangle(cx, tipY, cx - half, baseY, cx + half, baseY, 'F');
    doc.setLineWidth(1);
    setColor(doc, 'draw', PRIMARY);
    doc.line(cx, baseY, cx, baseY + 5);

    setColor(doc, 'text', PRIMARY_DARK);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('TOPO', cx + half + 3, baseY + 1);
}

/**
 * Computes a cell size so an R×C grid of page-shaped cells fits a box.
 * @returns {{ cellW: number, cellH: number }}
 */
function fitGrid({ rows, cols, pageW, pageH, maxW, maxH }) {
    const aspect = pageW / pageH; // cell width / height
    // Width-limited and height-limited candidate cell widths; take the smaller.
    const byWidth = maxW / cols;
    const byHeight = (maxH / rows) * aspect;
    const cellW = Math.max(4, Math.min(byWidth, byHeight));
    return { cellW, cellH: cellW / aspect };
}

/**
 * Draws a grid diagram of page cells.
 * @param {import('jspdf').jsPDF} doc
 * @param {Object} o
 * @param {number} o.x - Top-left x (mm)
 * @param {number} o.y - Top-left y (mm)
 * @param {number} o.cellW
 * @param {number} o.cellH
 * @param {number} o.rows
 * @param {number} o.cols
 * @param {boolean} o.mirror - Reverse columns left→right (face-down view)
 * @param {boolean} o.labelAll - Label every cell (vs only the highlighted one)
 * @param {{row:number,col:number}|null} o.highlight - Logical cell to highlight
 */
function drawGrid(doc, { x, y, cellW, cellH, rows, cols, mirror, labelAll, highlight }) {
    doc.setLineWidth(0.3);
    const fontSize = Math.max(6, Math.min(13, cellH * 0.42));

    for (let vr = 0; vr < rows; vr++) {
        for (let vc = 0; vc < cols; vc++) {
            const logicalRow = vr;
            const logicalCol = mirror ? cols - 1 - vc : vc;
            const isHi = highlight && highlight.row === logicalRow && highlight.col === logicalCol;

            const cx = x + vc * cellW;
            const cy = y + vr * cellH;

            setColor(doc, 'fill', isHi ? HILITE_FILL : FAINT_FILL);
            setColor(doc, 'draw', isHi ? PRIMARY_DARK : BORDER);
            doc.rect(cx, cy, cellW, cellH, 'FD');

            if (isHi || labelAll) {
                setColor(doc, 'text', isHi ? [255, 255, 255] : MUTED);
                doc.setFont('helvetica', isHi ? 'bold' : 'normal');
                doc.setFontSize(isHi ? Math.min(15, fontSize + 2) : fontSize);
                doc.text(
                    `L${logicalRow + 1}C${logicalCol + 1}`,
                    cx + cellW / 2, cy + cellH / 2 + fontSize * 0.18,
                    { align: 'center' }
                );
            }
        }
    }
}

/**
 * Applies an RGB colour to the given jsPDF channel.
 * @param {import('jspdf').jsPDF} doc
 * @param {'text'|'draw'|'fill'} channel
 * @param {number[]} rgb - [r, g, b]
 */
function setColor(doc, channel, [r, g, b]) {
    if (channel === 'text') doc.setTextColor(r, g, b);
    else if (channel === 'draw') doc.setDrawColor(r, g, b);
    else doc.setFillColor(r, g, b);
}
