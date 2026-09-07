// Path: js/import_export/drag-drop.handler.js
import { showError, showWarning } from '@utils/toast_service.js';
import { isCurrentMapLockedSync } from '@store';
// O diálogo da CASA para uma pergunta de três respostas. Ver `askImportMode`: o modal artesanal que
// vivia aqui não tinha "Cancelar", não marcava a ação destrutiva e não nomeava o que ela apaga.
import { showChoice } from '@modals/confirm.modal.js';
// Só o RENDERIZADOR das contagens é estático (função pura, sem IndexedDB). Quem LÊ o disco entra
// por `import()` dentro de `describeTarget`, no instante em que alguém solta um `.ebgeo`.
import { atlasContentsLines } from '@store/atlas-contents.js';

/** @type {Record<string, string[]>} */
const FILE_TYPES = {
    EBGEO: ['.ebgeo'],
    GEO_IMPORT: ['.geojson', '.json', '.zip', '.kml', '.kmz', '.gpx', '.csv', '.tsv', '.rar', '.7z'],
    IMAGE: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']
};

/**
 * Returns the file type category for a given filename.
 * @param {string} fileName
 * @returns {'EBGEO'|'GEO_IMPORT'|'IMAGE'|'INVALID'}
 */
function classifyFile(fileName) {
    const ext = fileName.toLowerCase().substring(fileName.lastIndexOf('.'));

    for (const [type, extensions] of Object.entries(FILE_TYPES)) {
        if (extensions.includes(ext)) return type;
    }

    return 'INVALID';
}

/**
 * Truncates a filename for display.
 * @param {string} name
 * @param {number} max
 * @returns {string}
 */
function truncateName(name, max = 30) {
    return name.length > max ? name.substring(0, max) + '...' : name;
}

/** Overlay theme per file type. */
const OVERLAY_THEME = {
    EBGEO:      { bg: 'rgba(40, 167, 69, 0.85)',  border: '#28a745', icon: '', label: 'Importar Atlas' },
    GEO_IMPORT: { bg: 'rgba(0, 123, 255, 0.85)',  border: '#007bff', icon: '', label: 'Importar Geometrias' },
    IMAGE:      { bg: 'rgba(255, 193, 7, 0.85)',   border: '#ffc107', icon: '', label: 'Adicionar Imagem' },
    INVALID:    { bg: 'rgba(220, 53, 69, 0.85)',   border: '#dc3545', icon: '', label: 'Arquivo não suportado' },
};

/**
 * The words of the "how should this `.ebgeo` land?" question, and the three actions.
 *
 * PURE, and exported, because it is the whole finding: the sentence a person reads before wiping
 * their atlas cannot live inside a class that only exists with a map, a DOM and a mounted store.
 *
 * TWO TEXTS, because the same button does two different things. On a LOCAL atlas "Substituir Atual"
 * empties the mounted namespace in place, and the sentence names the atlas and counts what dies. On
 * a SERVER atlas it does NOT: the import leaves the server project for a brand-new local slot
 * (`_prepareNonAdditiveTarget`), the server data is untouched, and announcing destruction there
 * would be a false alarm. Only the local branch marks the action destructive.
 *
 * "ADICIONAR AO ATUAL" IS UNCHANGED, in behaviour and in name: it adds the file's maps beside what
 * is open, and it is the reversible answer.
 *
 * @param {{servidor?: boolean, name?: string|null, contents?: Object|null}|null} [target] - What
 *   `describeTarget` read. Null (the read failed) is treated as a LOCAL atlas with unknown
 *   contents, which is the safe side: it still warns that replacing wipes.
 * @returns {{title: string, message: string, choices: Array<{id: string, label: string, variant: string}>}}
 */
export function importModeDialog(target) {
    const servidor = target?.servidor === true;
    const nome = typeof target?.name === 'string' && target.name.trim().length > 0
        ? target.name.trim()
        : null;

    const acoes = (replaceVariant) => ([
        { id: 'cancel', label: 'Cancelar', variant: 'ghost' },
        { id: 'add', label: 'Adicionar ao Atual', variant: 'primary' },
        { id: 'replace', label: 'Substituir Atual', variant: replaceVariant },
    ]);

    if (servidor) {
        return {
            title: 'Importar atlas deste arquivo',
            message: '"Substituir Atual" abre o arquivo em um atlas local NOVO. O atlas do '
                + 'servidor que está aberto continua intacto em "Seus atlas", e nada dele é '
                + 'apagado.\n\n'
                + '"Adicionar ao Atual" não vale para um atlas do servidor.',
            choices: acoes('primary'),
        };
    }

    const alvo = nome ? `do atlas "${nome}"` : 'do atlas aberto';
    const linhas = atlasContentsLines(target?.contents);
    const perda = linhas.length > 0 ? `:\n${linhas.map((l) => `- ${l}`).join('\n')}` : '.';

    return {
        title: 'Importar atlas deste arquivo',
        message: `"Substituir Atual" apaga TODO o conteúdo ${alvo} deste navegador e NÃO pode ser `
            + `desfeito${perda}\n\n`
            + '"Adicionar ao Atual" mantém o que já está aberto e soma os mapas do arquivo.',
        choices: acoes('danger'),
    };
}

class DragDropHandler {
    constructor(mapElement, toolManager, importControl, exportImportService, imageControl) {
        this.mapElement = mapElement;
        this.toolManager = toolManager;
        this.importControl = importControl;
        this.exportImportService = exportImportService;
        this.imageControl = imageControl;

        this.dragCounter = 0;
        this.overlay = null;

        this.handleDragEnter = this.handleDragEnter.bind(this);
        this.handleDragOver = this.handleDragOver.bind(this);
        this.handleDragLeave = this.handleDragLeave.bind(this);
        this.handleDrop = this.handleDrop.bind(this);
    }

    enable() {
        this.mapElement.addEventListener('dragenter', this.handleDragEnter);
        this.mapElement.addEventListener('dragover', this.handleDragOver);
        this.mapElement.addEventListener('dragleave', this.handleDragLeave);
        this.mapElement.addEventListener('drop', this.handleDrop);
    }

    disable() {
        this.mapElement.removeEventListener('dragenter', this.handleDragEnter);
        this.mapElement.removeEventListener('dragover', this.handleDragOver);
        this.mapElement.removeEventListener('dragleave', this.handleDragLeave);
        this.mapElement.removeEventListener('drop', this.handleDrop);

        this.hideDropOverlay();
    }

    // ===== EVENT HANDLERS =====

    handleDragEnter(event) {
        event.preventDefault();
        this.dragCounter++;

        if (this.dragCounter === 1) {
            const file = this.getFirstFile(event);
            if (file) {
                this.showDropOverlay(classifyFile(file.name), file.name);
            }
        }
    }

    handleDragOver(event) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
    }

    handleDragLeave(event) {
        event.preventDefault();
        this.dragCounter--;

        if (this.dragCounter === 0) {
            this.hideDropOverlay();
        }
    }

    async handleDrop(event) {
        event.preventDefault();
        this.dragCounter = 0;
        this.hideDropOverlay();

        if (isCurrentMapLockedSync()) {
            showWarning('Mapa bloqueado');
            return;
        }

        const files = Array.from(event.dataTransfer.files);

        if (files.length === 0) return;

        if (files.length > 1) {
            showError('Por favor, arraste apenas um arquivo por vez.');
            return;
        }

        const file = files[0];
        const fileType = classifyFile(file.name);

        if (fileType === 'INVALID') {
            showError(`Tipo de arquivo não suportado: ${file.name}. Formatos aceitos: .ebgeo, .geojson, .json, .zip, .kml, .kmz, .gpx`);
            return;
        }

        let dropCoordinates = null;
        if (fileType === 'IMAGE') {
            const rect = this.mapElement.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;
            dropCoordinates = this.imageControl.map.unproject([x, y]);
        }

        this.toolManager.deactivateCurrentTool();

        try {
            await this.processFile(file, fileType, dropCoordinates);
        } catch (error) {
            console.error('Error processing file via drag & drop:', error);
            showError(`Erro ao processar arquivo: ${error.message}`);
        }
    }

    // ===== UTILITY METHODS =====

    getFirstFile(event) {
        const items = event.dataTransfer.items;
        if (items && items.length > 0 && items[0].kind === 'file') {
            return items[0].getAsFile();
        }

        const files = event.dataTransfer.files;
        if (files && files.length > 0) {
            return files[0];
        }

        return null;
    }

    async processFile(file, fileType, dropCoordinates = null) {
        const ext = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));

        switch (fileType) {
            case 'EBGEO': {
                const result = await this.askImportMode();
                if (result.cancelled) return;
                await this.exportImportService.processFileDirectly(file, result.additive);
                break;
            }

            case 'GEO_IMPORT': {
                if (ext === '.csv' || ext === '.tsv') {
                    showWarning('Para importar CSV, use a aba Importar na barra lateral');
                    return;
                }
                await this.importControl.processFileDirectly(file);
                break;
            }

            case 'IMAGE':
                await this.processImageFile(file, dropCoordinates);
                break;

            default:
                throw new Error(`Tipo de arquivo não suportado: ${fileType}`);
        }
    }

    async processImageFile(file, lngLat) {
        if (!lngLat || isNaN(lngLat.lng) || isNaN(lngLat.lat)) {
            throw new Error('Coordenadas inválidas para posicionamento da imagem');
        }

        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = async () => {
                try {
                    await this.imageControl.addImageFeature(lngLat, reader.result);
                    resolve();
                } catch (error) {
                    reject(error);
                }
            };

            reader.onerror = () => reject(new Error('Erro ao ler arquivo de imagem'));

            reader.readAsDataURL(file);
        });
    }

    /**
     * Asks how the dropped `.ebgeo` should land, and says what each answer costs.
     *
     * WHAT "SUBSTITUIR ATUAL" DOES, said out loud since 2026-09-07. The non-additive import calls
     * `clearAllDataStore()` on the MOUNTED scope, i.e. it empties the ten data databases of the
     * atlas the person has open. On an installation carried over from the previous line of the
     * product that atlas is the whole acquis. The dialog used to be two sentences ("Importar Atlas"
     * / "Como deseja importar este atlas?") and two buttons, with no Cancel (only clicking outside),
     * no destructive styling and no mention of the atlas or of the wipe. "Limpar tudo" in the Maps
     * tab does the SAME wipe and already asked properly; this is now the same shape of question.
     *
     * IT IS THE HOUSE DIALOG, not a modal of its own. `showChoice` already owns the destructive
     * variant, the inert focus, the deliberately dead Enter in N-way mode, the dismissal that
     * resolves `null`, and the per-choice `data-testid`. Keeping a second modal here meant keeping
     * a second copy of every one of those decisions, and the copy was the one missing Cancel.
     *
     * @returns {Promise<{cancelled: boolean, additive?: boolean}>}
     */
    async askImportMode() {
        // A LEITURA VEM ANTES DA PERGUNTA, e falha para o lado seguro: sem o alvo, o diálogo ainda
        // avisa que substituir apaga o atlas aberto, apenas sem números.
        let target = null;
        try {
            target = await this.describeTarget();
        } catch (error) {
            console.warn('[drag-drop] could not describe the mounted atlas:', error);
        }

        const { title, message, choices } = importModeDialog(target);
        const choice = await showChoice(title, { message, choices });

        if (choice === 'replace') return { cancelled: false, additive: false };
        if (choice === 'add') return { cancelled: false, additive: true };
        // Cancelar E dispensar (Esc, clique fora, que resolve `null`) caem aqui: dispensar nunca
        // pode escolher por ninguém, e menos ainda a ação destrutiva.
        return { cancelled: true };
    }

    /**
     * Who the mounted atlas is, and how much it holds.
     *
     * BY `import()`, NOT BY STATIC IMPORT, and the reason is the one this file already lives by: it
     * is loaded with the map, and the three modules it needs here (the namespace, the local-atlas
     * registry, the scope reader) are only needed the moment somebody drops a `.ebgeo` on the map.
     *
     * THE SERVER QUESTION IS ASKED WITH THE SAME TWO HALVES `writingIntoServerAtlas` asks in
     * `export-import.service.js`, because it must produce the same answer: that function is the one
     * that DECIDES (wipe in place, or open a brand-new local atlas), and this one only picks the
     * words. A disagreement here would be a dialog describing an outcome the import will not
     * produce, which is worse than no dialog.
     *
     * @returns {Promise<{servidor: boolean, name: string|null, contents: Object|null}>}
     */
    async describeTarget() {
        const [{ getActiveScope, StoreScopeKind }, { isRemoteStoreSync }] = await Promise.all([
            import('@store/atlas-namespace.js'),
            import('@store/store-origin.js'),
        ]);

        const scope = getActiveScope();
        const servidor = scope?.kind === StoreScopeKind.REMOTE || isRemoteStoreSync();
        // Num atlas de servidor nada do que está montado é apagado, então não há perda a contar, e
        // o nome que importa é o do atlas aberto, que a barra do mapa já mostra.
        if (servidor) return { servidor: true, name: null, contents: null };

        const [{ getCurrentLocalAtlasId, getLocalAtlas }, { countAtlasContents }] = await Promise.all([
            import('@store/local-atlas.api.js'),
            import('@store/atlas-contents.js'),
        ]);

        let name = null;
        try {
            const id = getCurrentLocalAtlasId();
            name = id ? (getLocalAtlas(id)?.name ?? null) : null;
        } catch (_error) {
            // Registro não carregado: diálogo sem nome, nunca diálogo quebrado.
            name = null;
        }

        return { servidor: false, name, contents: await countAtlasContents(scope) };
    }

    // ===== VISUAL FEEDBACK =====

    showDropOverlay(fileType, fileName) {
        this.hideDropOverlay();

        const theme = OVERLAY_THEME[fileType] || OVERLAY_THEME.INVALID;

        this.overlay = document.createElement('div');
        this.overlay.className = 'drag-drop-overlay';
        // Dynamic colors must be inline (runtime-computed values)
        this.overlay.style.setProperty('--drag-drop-bg-color', theme.bg);
        this.overlay.style.setProperty('--drag-drop-border-color', theme.border);

        const iconEl = document.createElement('div');
        iconEl.className = 'drag-drop-overlay__icon';
        iconEl.textContent = theme.icon;

        const messageEl = document.createElement('div');
        messageEl.className = 'drag-drop-overlay__message';

        const labelText = document.createTextNode(theme.label);
        const br = document.createElement('br');
        const fileNameEl = document.createElement('em');
        fileNameEl.className = 'drag-drop-overlay__filename';
        fileNameEl.textContent = truncateName(fileName);

        messageEl.appendChild(labelText);
        messageEl.appendChild(br);
        messageEl.appendChild(fileNameEl);

        this.overlay.appendChild(iconEl);
        this.overlay.appendChild(messageEl);

        this.mapElement.style.position = 'relative';
        this.mapElement.appendChild(this.overlay);
    }

    hideDropOverlay() {
        if (this.overlay) {
            this.overlay.remove();
            this.overlay = null;
        }
    }
}

export default DragDropHandler;
