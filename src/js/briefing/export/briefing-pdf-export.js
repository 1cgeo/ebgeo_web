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

import { getBriefingById, getCurrentMapNameSync, setCurrentMap } from '../../store/index.js';
import { getControl } from '../../store/control.registry.js';
import { showError, showSuccess } from '../../utilities/index.js';
import { createTransitionService } from '../presentation/transition.service.js';
import { validateBriefing } from '../validation/reference-validator.js';
import { captureSlide } from './slide-capture.service.js';
import { composePage, composeErrorPage } from './pdf-page-composer.js';

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

    let modal = null;
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
            showError('Briefing possui erros que impedem a exportação');
            return;
        }

        const slides = [...briefing.slides].sort((a, b) => a.order - b.order);
        const totalSlides = slides.length;

        // ===== Step 2: Show progress modal =====
        modal = createProgressModal();

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

        updateProgress(modal, 5, 'Preparando exportação...');

        // ===== Step 5: Import jsPDF lazily =====
        const { jsPDF } = await import('jspdf');
        const doc = new jsPDF({
            orientation: 'landscape',
            unit: 'mm',
            format: 'a4'
        });

        // ===== Step 6: Process each slide =====
        for (let i = 0; i < totalSlides; i++) {
            if (modal._cancelled) {
                showError('Exportação cancelada');
                return;
            }

            const slide = slides[i];
            const progressPercent = 5 + ((i / totalSlides) * 80);
            updateProgress(
                modal,
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

                // Compose PDF page
                composePage(doc, imageDataUrl, slide, i, totalSlides, briefing.name);

            } catch (slideError) {
                console.error(`Error processing slide ${i + 1}:`, slideError);
                composeErrorPage(
                    doc, slide, i, totalSlides, briefing.name,
                    slideError.message || 'Erro desconhecido'
                );
            }
        }

        if (modal._cancelled) {
            showError('Exportação cancelada');
            return;
        }

        // ===== Step 7: Download PDF =====
        updateProgress(modal, 90, 'Gerando PDF...');

        const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        const safeFileName = briefing.name.replace(/[^a-zA-Z0-9\u00C0-\u024F _-]/g, '').trim() || 'briefing';
        doc.save(`briefing-${safeFileName}-${timestamp}.pdf`);

        updateProgress(modal, 100, 'Download concluído!');
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
        if (modal?.parentNode) {
            document.body.removeChild(modal);
        }
    }
}

// ============================================================================
// PROGRESS MODAL
// ============================================================================

/**
 * Creates a full-screen progress modal.
 * Reuses the same BEM classes as pdf-export.css for visual consistency.
 * @returns {HTMLElement} Modal element with _cancelled flag
 */
function createProgressModal() {
    const modal = document.createElement('div');
    modal.className = 'pdf-export-modal';
    modal._cancelled = false;

    const content = document.createElement('div');
    content.className = 'pdf-export-modal__content';

    const title = document.createElement('div');
    title.className = 'pdf-export-modal__title';
    title.textContent = 'Exportando Briefing...';

    const progressText = document.createElement('div');
    progressText.className = 'pdf-export-modal__progress-text briefing-pdf-progress-text';
    progressText.textContent = 'Preparando...';

    const barContainer = document.createElement('div');
    barContainer.className = 'pdf-export-modal__bar-container';

    const bar = document.createElement('div');
    bar.className = 'pdf-export-modal__bar briefing-pdf-progress-bar';
    barContainer.appendChild(bar);

    const hint = document.createElement('div');
    hint.className = 'pdf-export-modal__hint';
    hint.textContent = 'Isso pode levar alguns segundos...';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'pdf-export-modal__cancel-btn';
    cancelBtn.textContent = 'Cancelar';
    cancelBtn.addEventListener('click', () => {
        modal._cancelled = true;
        if (modal.parentNode) {
            document.body.removeChild(modal);
        }
    });

    content.appendChild(title);
    content.appendChild(progressText);
    content.appendChild(barContainer);
    content.appendChild(hint);
    content.appendChild(cancelBtn);
    modal.appendChild(content);

    document.body.appendChild(modal);
    return modal;
}

/**
 * Updates the progress modal bar and text.
 * @param {HTMLElement} modal - Modal element
 * @param {number} percent - Progress percentage (0-100)
 * @param {string} text - Progress description text
 */
function updateProgress(modal, percent, text) {
    if (!modal || modal._cancelled) return;

    const bar = modal.querySelector('.briefing-pdf-progress-bar');
    const progressText = modal.querySelector('.briefing-pdf-progress-text');

    if (bar) {
        bar.style.width = percent + '%';
    }
    if (progressText) {
        progressText.textContent = text;
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
