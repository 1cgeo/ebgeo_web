// Path: tests/unit/export-leitura-parcial.repro.test.js
// Exercise the actual export boundary: no download before explicit consent to missing data.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';

vi.mock('@store', () => ({
    getAllMapNamesStore: vi.fn(async () => ['A']),
    getCurrentMapNameSync: vi.fn(() => 'A'),
    isRemoteStoreSync: vi.fn(() => false),
    getImage: vi.fn(async () => null),
}));
vi.mock('@modals/confirm.modal.js', () => ({ showConfirm: vi.fn() }));
vi.mock('@utils/toast_service.js', () => ({
    showToast: vi.fn(), showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn(),
}));

import { ExportImportService } from '../../src/js/import_export/export-import.service.js';
import { readFailuresConfirm } from '../../src/js/import_export/export-optional-sections.js';
import { showConfirm } from '@modals/confirm.modal.js';
import { showWarning, showError } from '@utils/toast_service.js';

let downloaded, click;
beforeEach(() => {
    vi.clearAllMocks();
    downloaded = null;
    click = vi.fn();
    vi.stubGlobal('document', { createElement: () => ({ click }),
        body: { appendChild: vi.fn(), removeChild: vi.fn() } });
    vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { downloaded = blob; return 'blob:test'; });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function service() {
    const instance = new ExportImportService({}, { deactivateCurrentTool: vi.fn() }, {}, null);
    vi.spyOn(instance, 'buildPrunedExportData').mockResolvedValue({
        data: { version: '3.0', currentMap: 'A', mapOrder: ['A'], maps: { A: { features: { points: [] } } } },
        relatorio: {}, readFailures: [{ section: 'groups', mapName: 'A' }],
    });
    vi.spyOn(instance, 'showSaveSuccess');
    return instance;
}

describe('explicit partial export', () => {
    it('cancel leaves the browser without a download or success message', async () => {
        showConfirm.mockResolvedValue(false);
        const instance = service();
        await instance.handleExport(['A']);
        expect(showConfirm).toHaveBeenCalledWith('Não foi possível ler parte do atlas', expect.objectContaining({
            message: expect.stringContaining('grupos no mapa "A"'), confirmText: 'Exportar cópia parcial',
        }));
        expect(click).not.toHaveBeenCalled();
        expect(instance.showSaveSuccess).not.toHaveBeenCalled();
        expect(showError).not.toHaveBeenCalled();
    });

    it('consent downloads a readable partial archive and identifies it as partial', async () => {
        showConfirm.mockResolvedValue(true);
        const instance = service();
        await instance.handleExport(['A']);
        expect(showConfirm).toHaveBeenCalledTimes(1);
        expect(click).toHaveBeenCalledOnce();
        expect(showError).not.toHaveBeenCalled();
        const bytes = new Uint8Array(await downloaded.arrayBuffer());
        const zip = await JSZip.loadAsync(bytes.subarray(6).map(byte => byte ^ 0xAA));
        expect(JSON.parse(await zip.file('data.json').async('string')).maps).toEqual({ A: { features: { points: [] } } });
        expect(showWarning).toHaveBeenCalledWith('Cópia parcial exportada. Alguns dados não puderam ser lidos.');
        expect(instance.showSaveSuccess).not.toHaveBeenCalled();
    });

    it('a complete read needs no warning, and internal errors never enter the message', () => {
        expect(readFailuresConfirm([])).toBeNull();
        const warning = readFailuresConfirm([{ section: 'briefings', mapName: null, error: 'PRIVATE_PATH' }]);
        expect(warning.message).toContain('briefings');
        expect(warning.message).not.toContain('PRIVATE_PATH');
    });
});
