// Path: tests/unit/drag-drop-classificacao.test.js

/**
 * @fileoverview Pins the ROUTING of `js/import_export/drag-drop.handler.js`: how a
 * dropped file name is classified into EBGEO / GEO_IMPORT / IMAGE / INVALID, and
 * which collaborator each class reaches.
 *
 * `classifyFile` and `truncateName` are module-private, so the suite drives them
 * through the two public paths that consume them - `handleDrop` and `processFile`
 * - with the store and the toast service mocked. That is the closest a node test
 * gets to them without editing `src/`.
 *
 * WHAT THIS SUITE PINS
 * - the ORDER of the drop guards: locked map first (before `dataTransfer` is even
 *   read), then the multi-file refusal, then the classification;
 * - the extension table, case-insensitively, including the two shapes that look
 *   broken and are not: a name with NO dot, and a dotfile whose whole name is the
 *   extension;
 * - that `.csv` / `.tsv` classify as GEO_IMPORT and are then refused by
 *   `processFile` with a message naming the sidebar tab, so the import control
 *   never sees them;
 * - the EBGEO branch asking for the import mode and forwarding `additive`;
 * - the IMAGE branch converting the drop point through the map element's own rect;
 * - the drag counter, so nested dragenter/dragleave pairs do not flicker the
 *   overlay;
 * - `enable`/`disable` symmetry on the bound handler references.
 *
 * WHAT IT DOES NOT REACH
 * - `showDropOverlay` and `createImportModeModal`, which build real DOM (and are
 *   the only readers of `truncateName`), and `processImageFile`'s `FileReader`
 *   path. The environment here is node, with no DOM.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@utils/toast_service.js', () => ({
    showError: vi.fn(),
    showWarning: vi.fn(),
    showSuccess: vi.fn(),
    showInfo: vi.fn(),
}));

vi.mock('@store', () => ({
    isCurrentMapLockedSync: vi.fn(() => false),
}));

const { showError, showWarning } = await import('@utils/toast_service.js');
const { isCurrentMapLockedSync } = await import('@store');
const { default: DragDropHandler } = await import('../../src/js/import_export/drag-drop.handler.js');

// ============================================================================
// Fixtures
// ============================================================================

function makeHandler(over = {}) {
    const mapElement = {
        style: {},
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        appendChild: vi.fn(),
        getBoundingClientRect: () => ({ left: 10, top: 20 }),
    };
    const toolManager = { deactivateCurrentTool: vi.fn() };
    const importControl = { processFileDirectly: vi.fn().mockResolvedValue(undefined) };
    const exportImportService = { processFileDirectly: vi.fn().mockResolvedValue(undefined) };
    const imageControl = {
        map: { unproject: vi.fn(() => ({ lng: -43.2, lat: -22.9 })) },
        addImageFeature: vi.fn().mockResolvedValue(undefined),
    };
    const handler = new DragDropHandler(
        mapElement, toolManager, importControl, exportImportService, imageControl,
    );
    // The EBGEO branch opens a real modal; the decision itself is the contract.
    handler.askImportMode = vi.fn().mockResolvedValue({ cancelled: false, additive: true });
    Object.assign(handler, over);
    return { handler, mapElement, toolManager, importControl, exportImportService, imageControl };
}

const dropOf = (names, extra = {}) => ({
    preventDefault: vi.fn(),
    clientX: 110,
    clientY: 220,
    dataTransfer: { files: names.map((name) => ({ name })) },
    ...extra,
});

beforeEach(() => {
    vi.clearAllMocks();
    isCurrentMapLockedSync.mockReturnValue(false);
});

// ============================================================================
// Guard order
// ============================================================================

describe('handleDrop - ordem dos portoes', () => {
    it('mapa bloqueado recusa ANTES de ler o dataTransfer', () => {
        isCurrentMapLockedSync.mockReturnValue(true);
        const { handler, importControl } = makeHandler();
        const event = {
            preventDefault: vi.fn(),
            get dataTransfer() { throw new Error('dataTransfer nao deveria ser lido'); },
        };
        return handler.handleDrop(event).then(() => {
            expect(showWarning).toHaveBeenCalledWith('Mapa bloqueado');
            expect(importControl.processFileDirectly).not.toHaveBeenCalled();
            expect(event.preventDefault).toHaveBeenCalledTimes(1);
        });
    });

    it('nenhum arquivo: sai calado, sem toast', async () => {
        const { handler, toolManager } = makeHandler();
        await handler.handleDrop(dropOf([]));
        expect(showError).not.toHaveBeenCalled();
        expect(showWarning).not.toHaveBeenCalled();
        expect(toolManager.deactivateCurrentTool).not.toHaveBeenCalled();
    });

    it('mais de um arquivo: recusa nomeando a regra de um por vez', async () => {
        const { handler, importControl } = makeHandler();
        await handler.handleDrop(dropOf(['a.kml', 'b.kml']));
        expect(showError).toHaveBeenCalledWith('Por favor, arraste apenas um arquivo por vez.');
        expect(importControl.processFileDirectly).not.toHaveBeenCalled();
    });

    it('o contador de arrasto zera em todo drop', async () => {
        const { handler } = makeHandler();
        handler.dragCounter = 3;
        await handler.handleDrop(dropOf([]));
        expect(handler.dragCounter).toBe(0);
    });
});

// ============================================================================
// classifyFile through the INVALID refusal
// ============================================================================

describe('classificacao por extensao', () => {
    const rejected = async (name) => {
        const { handler, toolManager } = makeHandler();
        await handler.handleDrop(dropOf([name]));
        expect(toolManager.deactivateCurrentTool).not.toHaveBeenCalled();
        return showError.mock.calls.at(-1)?.[0] ?? '';
    };

    const accepted = async (name) => {
        const { handler, toolManager, importControl, exportImportService } = makeHandler();
        await handler.handleDrop(dropOf([name]));
        expect(showError).not.toHaveBeenCalled();
        expect(toolManager.deactivateCurrentTool).toHaveBeenCalledTimes(1);
        return { importControl, exportImportService };
    };

    it('extensao desconhecida e recusada NOMEANDO o arquivo', async () => {
        const msg = await rejected('notas.txt');
        expect(msg).toContain('Tipo de arquivo não suportado: notas.txt');
        expect(msg).toContain('.ebgeo');
    });

    it('nome SEM ponto e recusado (o substring(-1) devolve o nome inteiro)', async () => {
        // `lastIndexOf('.')` is -1 and `substring(-1)` clamps to 0, so `ext` becomes
        // the whole lowercased name. Not garbage, and the classification is still
        // INVALID because no table entry lacks the leading dot.
        expect(await rejected('semextensao')).toContain('semextensao');
        expect(await rejected('ebgeo')).toContain('ebgeo');
        expect(await rejected('kml')).toContain('kml');
    });

    it('dupla extensao usa a ULTIMA', async () => {
        expect(await rejected('mapa.kml.txt')).toContain('mapa.kml.txt');
    });

    it('CONTROLE: a mesma raiz com a extensao boa passa', async () => {
        const { importControl } = await accepted('mapa.kml');
        expect(importControl.processFileDirectly).toHaveBeenCalledTimes(1);
    });

    it('arquivo de ponto inicial: o nome inteiro E a extensao', async () => {
        const { importControl } = await accepted('.json');
        expect(importControl.processFileDirectly).toHaveBeenCalledTimes(1);
        const { exportImportService } = await accepted('.ebgeo');
        expect(exportImportService.processFileDirectly).toHaveBeenCalledTimes(1);
    });

    it('a comparacao e insensivel a caixa', async () => {
        for (const name of ['MAPA.KML', 'Mapa.GeoJson', 'x.ZIP', 'y.GPX']) {
            const { importControl } = await accepted(name);
            expect(importControl.processFileDirectly).toHaveBeenCalledTimes(1);
            vi.clearAllMocks();
        }
    });

    it('as tres familias de extensao roteiam para tres destinos distintos', async () => {
        const geo = await accepted('a.geojson');
        expect(geo.importControl.processFileDirectly).toHaveBeenCalledTimes(1);
        expect(geo.exportImportService.processFileDirectly).not.toHaveBeenCalled();
        vi.clearAllMocks();

        const atlas = await accepted('a.ebgeo');
        expect(atlas.exportImportService.processFileDirectly).toHaveBeenCalledTimes(1);
        expect(atlas.importControl.processFileDirectly).not.toHaveBeenCalled();
    });

    it('as dez extensoes de importacao geometrica sao aceitas', async () => {
        const exts = ['.geojson', '.json', '.zip', '.kml', '.kmz', '.gpx', '.csv', '.tsv', '.rar', '.7z'];
        expect(exts).toHaveLength(10);
        for (const ext of exts) {
            const { handler } = makeHandler();
            await handler.handleDrop(dropOf([`arquivo${ext}`]));
            expect(showError).not.toHaveBeenCalled();
            vi.clearAllMocks();
        }
    });
});

// ============================================================================
// The CSV/TSV second refusal
// ============================================================================

describe('CSV e TSV: classificam como geometria e sao recusados depois', () => {
    it('sao recusados por processFile, e o controle de import nao e chamado', async () => {
        for (const name of ['pontos.csv', 'pontos.TSV']) {
            const { handler, importControl, toolManager } = makeHandler();
            await handler.handleDrop(dropOf([name]));
            expect(showError).not.toHaveBeenCalled();
            expect(showWarning).toHaveBeenCalledWith(
                'Para importar CSV, use a aba Importar na barra lateral',
            );
            // The tool was already deactivated: the refusal happens INSIDE processFile.
            expect(toolManager.deactivateCurrentTool).toHaveBeenCalledTimes(1);
            expect(importControl.processFileDirectly).not.toHaveBeenCalled();
            vi.clearAllMocks();
        }
    });
});

// ============================================================================
// EBGEO branch
// ============================================================================

describe('ramo EBGEO', () => {
    it('cancelar no modal nao chama o servico', async () => {
        const { handler, exportImportService } = makeHandler();
        handler.askImportMode = vi.fn().mockResolvedValue({ cancelled: true });
        await handler.handleDrop(dropOf(['atlas.ebgeo']));
        expect(exportImportService.processFileDirectly).not.toHaveBeenCalled();
    });

    it('a escolha aditiva chega ao servico junto com o arquivo', async () => {
        for (const additive of [true, false]) {
            const { handler, exportImportService } = makeHandler();
            handler.askImportMode = vi.fn().mockResolvedValue({ cancelled: false, additive });
            const event = dropOf(['atlas.ebgeo']);
            await handler.handleDrop(event);
            expect(exportImportService.processFileDirectly).toHaveBeenCalledTimes(1);
            expect(exportImportService.processFileDirectly)
                .toHaveBeenCalledWith(event.dataTransfer.files[0], additive);
            vi.clearAllMocks();
        }
    });
});

// ============================================================================
// IMAGE branch
// ============================================================================

describe('ramo IMAGE', () => {
    it('o ponto de solta e convertido pelo retangulo do elemento do mapa', async () => {
        const { handler, imageControl } = makeHandler();
        // FileReader is a DOM API; stub just enough to let the promise settle.
        globalThis.FileReader = class {
            readAsDataURL() { this.onload(); }
            get result() { return 'data:image/png;base64,AA'; }
        };
        await handler.handleDrop(dropOf(['foto.png']));
        // clientX 110 - rect.left 10 = 100; clientY 220 - rect.top 20 = 200.
        expect(imageControl.map.unproject).toHaveBeenCalledWith([100, 200]);
        expect(imageControl.addImageFeature).toHaveBeenCalledTimes(1);
        expect(imageControl.addImageFeature.mock.calls[0][0]).toEqual({ lng: -43.2, lat: -22.9 });
        delete globalThis.FileReader;
    });

    it('coordenada NaN recusa nomeando o problema, sem chamar addImageFeature', async () => {
        const { handler, imageControl } = makeHandler();
        imageControl.map.unproject.mockReturnValue({ lng: NaN, lat: -22.9 });
        await handler.handleDrop(dropOf(['foto.jpeg']));
        expect(imageControl.addImageFeature).not.toHaveBeenCalled();
        expect(showError).toHaveBeenCalledTimes(1);
        expect(showError.mock.calls[0][0])
            .toContain('Coordenadas inválidas para posicionamento da imagem');
    });

    it('so o ramo IMAGE consulta o retangulo; os outros nao projetam nada', async () => {
        const { handler, imageControl } = makeHandler();
        await handler.handleDrop(dropOf(['mapa.kml']));
        expect(imageControl.map.unproject).not.toHaveBeenCalled();
    });
});

// ============================================================================
// processFile directly
// ============================================================================

describe('processFile - ramo default', () => {
    it('um tipo desconhecido lanca nomeando o tipo', async () => {
        const { handler } = makeHandler();
        await expect(handler.processFile({ name: 'x.kml' }, 'ALGO_NOVO'))
            .rejects.toThrow('Tipo de arquivo não suportado: ALGO_NOVO');
    });

    it('a falha vira toast, nao excecao, quando vem por handleDrop', async () => {
        const { handler, importControl } = makeHandler();
        importControl.processFileDirectly.mockRejectedValue(new Error('disco cheio'));
        await expect(handler.handleDrop(dropOf(['a.kml']))).resolves.toBeUndefined();
        expect(showError).toHaveBeenCalledWith('Erro ao processar arquivo: disco cheio');
    });
});

// ============================================================================
// getFirstFile
// ============================================================================

describe('getFirstFile', () => {
    it('prefere dataTransfer.items quando o primeiro item e arquivo', () => {
        const { handler } = makeHandler();
        const fromItems = { name: 'de-items.kml' };
        const file = handler.getFirstFile({
            dataTransfer: {
                items: [{ kind: 'file', getAsFile: () => fromItems }],
                files: [{ name: 'de-files.kml' }],
            },
        });
        expect(file).toBe(fromItems);
    });

    it('cai para dataTransfer.files quando o item nao e arquivo', () => {
        const { handler } = makeHandler();
        const file = handler.getFirstFile({
            dataTransfer: {
                items: [{ kind: 'string', getAsFile: () => null }],
                files: [{ name: 'de-files.kml' }],
            },
        });
        expect(file).toEqual({ name: 'de-files.kml' });
    });

    it('sem items e sem files devolve null', () => {
        const { handler } = makeHandler();
        expect(handler.getFirstFile({ dataTransfer: { items: [], files: [] } })).toBeNull();
        expect(handler.getFirstFile({ dataTransfer: {} })).toBeNull();
    });
});

// ============================================================================
// Drag counter and listener symmetry
// ============================================================================

describe('contador de arrasto', () => {
    const bare = () => ({ preventDefault: vi.fn(), dataTransfer: { items: [], files: [] } });

    it('entradas aninhadas somam e so a ultima saida esconde a sobreposicao', () => {
        const { handler } = makeHandler();
        const hide = vi.spyOn(handler, 'hideDropOverlay');
        handler.handleDragEnter(bare());
        handler.handleDragEnter(bare());
        expect(handler.dragCounter).toBe(2);
        handler.handleDragLeave(bare());
        expect(handler.dragCounter).toBe(1);
        expect(hide).not.toHaveBeenCalled();
        handler.handleDragLeave(bare());
        expect(handler.dragCounter).toBe(0);
        expect(hide).toHaveBeenCalledTimes(1);
    });

    it('dragover marca a copia como efeito', () => {
        const { handler } = makeHandler();
        const event = { preventDefault: vi.fn(), dataTransfer: {} };
        handler.handleDragOver(event);
        expect(event.dataTransfer.dropEffect).toBe('copy');
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
    });

    it('enable e disable usam as MESMAS referencias ligadas', () => {
        const { handler, mapElement } = makeHandler();
        handler.enable();
        handler.disable();
        const added = mapElement.addEventListener.mock.calls;
        const removed = mapElement.removeEventListener.mock.calls;
        expect(added).toHaveLength(4);
        expect(removed).toHaveLength(4);
        for (let i = 0; i < 4; i++) {
            expect(removed[i][0]).toBe(added[i][0]);
            expect(removed[i][1]).toBe(added[i][1]);
        }
    });
});
