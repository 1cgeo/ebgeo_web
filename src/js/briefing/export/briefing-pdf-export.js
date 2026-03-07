// Path: js/briefing/export/briefing-pdf-export.js

/**
 * @fileoverview Main orchestrator for briefing PDF export.
 * Exports a briefing as a multi-page PDF (one slide per A4 landscape page).
 * Each page mirrors the presentation layout: map/3D/360 image + text panel.
 *
 * Pipeline:
 * 1. Load and validate briefing
 * 2. Show progress modal
 * 3. Save current application state
 * 4. For each slide: navigate → capture → compose PDF page
 * 5. Download PDF
 * 6. Restore application state
 *
 * Uses jsPDF for multi-page PDF composition.
 * Reuses TransitionService for navigating between slides.
 * Reuses existing screenshot tools for canvas capture.
 *
 * @module briefing/export/briefing-pdf-export
 */

import { getBriefingById, getCurrentMapNameSync, setCurrentMap, getAllMapNamesStore } from '../../store/index.js';
import { getControl } from '../../store/control.registry.js';
import { showError, showSuccess, showWarning } from '../../utilities/index.js';
import { createTransitionService } from '../presentation/transition.service.js';
import { validateBriefing } from '../validation/reference-validator.js';
import { captureSlide } from './slide-capture.service.js';
import { composePage, composeErrorPage, loadLogoDataUrl } from './pdf-page-composer.js';
import { createExportProgressModal } from '../../import_export/export-utils.js';

// ============================================================================
// STATE
// ============================================================================

let _isExporting = false;

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Exports a briefing as a multi-page PDF.
 * @param {string} briefingId - ID of the briefing to export
 * @param {Object} map - MapLibre map instance
 * @returns {Promise<void>}
 */
export async function exportBriefingToPdf(briefingId, map) {
    if (_isExporting) {
        showError('Exportação já em andamento');
        return;
    }

    _isExporting = true;

    let progress = null;
    let cancelled = false;
    let transitionService = null;
    let savedPosition = null;
    let originalMapName = null;

    try {
        // ===== Step 1: Load and validate =====
        const briefing = await getBriefingById(briefingId);

        if (!briefing) {
            showError('Briefing não encontrado');
            return;
        }

        if (!briefing.slides || briefing.slides.length === 0) {
            showError('Briefing não possui slides');
            return;
        }

        const validation = await validateBriefing(briefing);
        if (!validation.canPresent()) {
            const errorLines = validation.errors.map(e =>
                `\u2022 Slide ${e.slideIndex + 1} "${e.slideTitle}": ${e.message}`
            );
            showError(`Não é possível exportar:\n${errorLines.join('\n')}`);
            return;
        }

        if (validation.warnings.length > 0) {
            showWarning(`${validation.warnings.length} aviso(s) encontrado(s). O PDF pode ter problemas.`);
        }

        // Validate that all referenced maps still exist
        const availableMapNames = await getAllMapNamesStore();
        const availableMapSet = new Set(availableMapNames);
        const slidesWithMissingMaps = briefing.slides.filter(
            s => s.mapId && !availableMapSet.has(s.mapId)
        );
        if (slidesWithMissingMaps.length > 0) {
            const mapLines = slidesWithMissingMaps.map(s =>
                `\u2022 Slide "${s.title || 'Sem título'}": mapa "${s.mapId}" não encontrado`
            );
            showError(`Não é possível exportar:\n${mapLines.join('\n')}`);
            return;
        }

        // Block export if any slide lacks a saved position
        const slidesWithoutPosition = briefing.slides.filter(
            s => !s.position || s.position.longitude === null
        );
        if (slidesWithoutPosition.length > 0) {
            showWarning(`${slidesWithoutPosition.length} slide(s) sem posição definida. Salve a posição de todos os slides antes de exportar.`);
            return;
        }

        const slides = [...briefing.slides].sort((a, b) => a.order - b.order);
        const totalSlides = slides.length;

        // ===== Step 2: Show progress modal =====
        progress = createExportProgressModal({
            title: 'Exportando Briefing...',
            onCancel: () => { cancelled = true; },
        });

        // ===== Step 3: Save current state =====
        savedPosition = {
            center: map.getCenter(),
            zoom: map.getZoom(),
            bearing: map.getBearing(),
            pitch: map.getPitch()
        };
        originalMapName = getCurrentMapNameSync();

        // ===== Step 4: Create transition service =====
        transitionService = createTransitionService(map);

        progress.updateProgress(5, 'Preparando exportação...');

        // ===== Step 5: Import jsPDF lazily + pre-load logo =====
        const [{ jsPDF }, logoDataUrl] = await Promise.all([
            import('jspdf'),
            loadLogoDataUrl(),
        ]);
        const doc = new jsPDF({
            orientation: 'landscape',
            unit: 'mm',
            format: 'a4'
        });

        // ===== Step 6: Process each slide =====
        for (let i = 0; i < totalSlides; i++) {
            if (cancelled) {
                showError('Exportação cancelada');
                return;
            }

            const slide = slides[i];
            const progressPercent = 5 + ((i / totalSlides) * 80);
            progress.updateProgress(
                progressPercent,
                `Capturando slide ${i + 1} de ${totalSlides}...`
            );

            // Add new page for slides after the first
            if (i > 0) {
                doc.addPage('a4', 'landscape');
            }

            try {
                // Navigate to slide
                await transitionService.transitionToSlide(slide, { instant: true });

                // Wait for rendering to settle after transition
                await delay(800);

                // Capture slide
                const imageDataUrl = await captureSlide(slide, map);

                // Compose PDF page (async: html2canvas renders text panel)
                await composePage(doc, imageDataUrl, slide, i, totalSlides, briefing.name, logoDataUrl);

            } catch (slideError) {
                console.error(`Error processing slide ${i + 1}:`, slideError);
                await composeErrorPage(
                    doc, slide, i, totalSlides, briefing.name,
                    slideError.message || 'Erro desconhecido',
                    logoDataUrl
                );
            }
        }

        if (cancelled) {
            showError('Exportação cancelada');
            return;
        }

        // ===== Step 7: Download PDF =====
        progress.updateProgress(90, 'Gerando PDF...');

        const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        const safeFileName = briefing.name.replace(/[^a-zA-Z0-9\u00C0-\u024F _-]/g, '').trim() || 'briefing';
        doc.save(`briefing-${safeFileName}-${timestamp}.pdf`);

        progress.updateProgress(100, 'Download concluído!');
        showSuccess('Briefing exportado com sucesso');

        // Brief delay for progress to show 100%
        await delay(600);

    } catch (error) {
        console.error('Error exporting briefing PDF:', error);
        showError('Erro ao exportar briefing: ' + error.message);
    } finally {
        // ===== Step 8: Cleanup and restore =====
        _isExporting = false;

        if (transitionService) {
            try {
                await transitionService.resetTo2D();
            } catch (e) {
                console.warn('Error resetting to 2D:', e);
            }
            transitionService.destroy();
        }

        // Restore original map if changed
        if (originalMapName && originalMapName !== getCurrentMapNameSync()) {
            try {
                await setCurrentMap(originalMapName);
                const baseLayerControl = getControl('BaseLayerControl');
                if (baseLayerControl) {
                    await baseLayerControl.switchMap(false);
                }
            } catch (e) {
                console.warn('Error restoring original map:', e);
            }
        }

        // Restore map position
        if (savedPosition && map) {
            map.jumpTo({
                center: savedPosition.center,
                zoom: savedPosition.zoom,
                bearing: savedPosition.bearing,
                pitch: savedPosition.pitch
            });
        }

        // Remove progress modal
        progress?.remove();
    }
}


// ============================================================================
// UTILITIES
// ============================================================================

/**
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
