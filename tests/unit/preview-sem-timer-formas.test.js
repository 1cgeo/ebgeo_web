// Path: tests/unit/preview-sem-timer-formas.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A FORMA do codigo das quatro formas (circulo, elipse, retangulo, setor).
 *
 * `tests/unit/preview-um-quadro-formas.test.js` dirige o controle e mede o
 * comportamento. Este arquivo le o FONTE, que e o unico jeito de alcancar um
 * caminho que nenhum teste dirige: um evento de toque, um segundo debounce
 * escondido num metodo que o caso feliz nao passa. As duas reguas se cobrem, e
 * nenhuma substitui a outra.
 *
 * As tres regras, todas medidas no porte de 2026-09-04 nas outras nove:
 *
 * 1. NENHUM TIMER num metodo de preview. O preview ja roda dentro de um quadro
 *    do `requestAnimationFrame`, entao um `setTimeout(..., 8)` em volta do
 *    desenho nao coalesce nada (8 ms cabe dentro dos 16,7 ms do quadro) e so
 *    empurra o desenho um timer para a frente.
 * 2. NENHUM `snapping.resolve` num evento BRUTO de movimento. `resolve` e uma
 *    consulta de feicao renderizada, e o mouse dispara varios `mousemove` dentro
 *    de um quadro enquanto so o ultimo e desenhado.
 * 3. O UTILITARIO no lugar da bancada de rAF feita a mao. Deixar `previewRafId`
 *    ou `pendingPreviewUpdate` para tras e ter dois portoes disputando o mesmo
 *    preview.
 *
 * O arquivo e irmao de `preview-timer-regua.test.js`, que cobre as NOVE
 * ferramentas de linha com as mesmas regras. Estao separados porque as formas
 * chegam uma por lote; quando as quatro estiverem portadas, os dois viram um.
 * O separador e as regras estao COPIADOS de la de proposito: aquele arquivo e
 * compartilhado com outro trabalho e nao se toca no meio do porte.
 */

/**
 * As formas sob a regua, com os membros por onde cada uma e conferida. Um
 * separador que parasse de casar reportaria zero violacoes em todo lugar e
 * pareceria um atestado de saude, entao cada arquivo nomeia o que tem de ter.
 */
const ANCORAS = {
    'src/js/draw_tools/circle_tool/add_circle_control.js':
        ['_onPreClickMouseMove', 'handlePreviewMouseMove', 'performPreviewUpdate', '_onEditPointerMove', 'updateRadiusPreview', 'cancelPendingUpdates'],
    'src/js/draw_tools/ellipse_tool/add_ellipse_control.js':
        ['_onPreClickMouseMove', 'handlePreviewMouseMove', 'performPreviewUpdate', '_onEditPointerMove', 'updateEllipsePreview', 'cancelPendingUpdates'],
    'src/js/draw_tools/sector_tool/add_sector_control.js':
        ['_onPreClickMouseMove', 'handlePreviewMouseMove', 'performPreviewUpdate', '_onEditPointerMove', 'updateHandlePreview', 'cancelPendingUpdates'],
    'src/js/draw_tools/rectangle_tool/add_rectangle_control.js':
        ['_onPreClickMouseMove', 'handlePreviewMouseMove', 'performPreviewUpdate', '_onEditPointerMove', 'updateRectanglePreview', 'cancelPendingUpdates'],
};

const CONTROLES = Object.keys(ANCORAS);

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Uma chamada de timer, qualquer que seja o atraso. */
const TIMER = /\b(?:setTimeout|clearTimeout)\s*\(/;

/** `snapping.resolve(this.map, ...)`, a consulta de feicao renderizada. */
const RESOLVE_BRUTO = /\.resolve\(\s*this\.map\b/;

/** Um metodo que constroi ou limpa um preview. */
const METODO_DE_PREVIEW = /Preview/;

/** Um tratador alimentado direto por `mousemove` / `pointermove` / `touchmove`. */
const TRATADOR_DE_MOVIMENTO = /(MouseMove|PointerMove|TouchMove)$/;

/**
 * Membros de classe neste codigo ficam a quatro espacos, como campo de funcao
 * seta (`nome = (e) => {`) ou como metodo comum (`nome(e) {`).
 */
const CABECALHO = /^ {4}(?:static\s+)?(?:async\s+)?(#?[A-Za-z_$][\w$]*)\s*(?:=\s*(?:async\s*)?\([^)]*\)\s*=>|\([^)]*\)\s*\{)/;

function lerFonte(caminho) {
    return fs.readFileSync(path.join(RAIZ, caminho), 'utf8');
}

/** Comentario e prosa, nao comportamento: regra que le prosa reporta o passado. */
function semComentarios(fonte) {
    return fonte
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter(linha => !/^\s*\/\//.test(linha))
        .join('\n');
}

/**
 * Parte o controle em blocos `{ nome, corpo }`, um por membro da classe.
 * @param {string} fonte - O texto do arquivo
 * @returns {Array<{nome: string, corpo: string}>} Os membros, na ordem do arquivo
 */
function membros(fonte) {
    const linhas = fonte.split('\n');
    const blocos = [];
    let atual = { nome: '<escopo do arquivo>', linhas: [] };

    for (const linha of linhas) {
        const cabecalho = CABECALHO.exec(linha);
        if (cabecalho) {
            blocos.push(atual);
            atual = { nome: cabecalho[1], linhas: [] };
        }
        atual.linhas.push(linha);
    }
    blocos.push(atual);

    return blocos.map(bloco => ({ nome: bloco.nome, corpo: semComentarios(bloco.linhas.join('\n')) }));
}

/** `arquivo#metodo` para cada membro que quebra uma regra. */
function violacoes(caminho, fonte, regraDoNome, regraDoCorpo) {
    return membros(fonte)
        .filter(metodo => regraDoNome.test(metodo.nome) && regraDoCorpo.test(metodo.corpo))
        .map(metodo => `${caminho}#${metodo.nome}`);
}

const violacoesDeTimer = (caminho, fonte) => violacoes(caminho, fonte, METODO_DE_PREVIEW, TIMER);
const violacoesDeResolve = (caminho, fonte) => violacoes(caminho, fonte, TRATADOR_DE_MOVIMENTO, RESOLVE_BRUTO);

describe('nenhum timer dentro de um metodo de preview', () => {
    it.each(CONTROLES)('%s', (caminho) => {
        expect(violacoesDeTimer(caminho, lerFonte(caminho))).toEqual([]);
    });
});

describe('nenhum snapping.resolve num evento bruto de movimento', () => {
    it.each(CONTROLES)('%s', (caminho) => {
        expect(violacoesDeResolve(caminho, lerFonte(caminho))).toEqual([]);
    });
});

describe('o preview passa pelo utilitario compartilhado', () => {
    it.each(CONTROLES)('%s', (caminho) => {
        const fonte = lerFonte(caminho);
        expect(fonte).toMatch(/import \{ createPreviewScheduler \} from/);
        expect(fonte).toMatch(/createPreviewScheduler\(\{/);
        expect(fonte).toMatch(/_previewScheduler\.request\(/);
        expect(fonte).toMatch(/_previewScheduler\.cancel\(\)/);
    });

    it.each(CONTROLES)('%s nao guarda mais o portao feito a mao', (caminho) => {
        // O trio do bloco antigo. Deixar um para tras e ter um segundo portao
        // correndo com o utilitario sobre o mesmo preview.
        const fonte = semComentarios(lerFonte(caminho));
        expect(fonte, `${caminho} previewRafId`).not.toMatch(/\bpreviewRafId\b/);
        expect(fonte, `${caminho} pendingPreviewUpdate`).not.toMatch(/\bpendingPreviewUpdate\b/);
        expect(fonte, `${caminho} geometryDebounceTimer`).not.toMatch(/\bgeometryDebounceTimer\b/);
    });
});

describe('a regua le arquivos de verdade, e acha os membros que diz ler', () => {
    it('cada controle esta no disco e e grande o bastante para ser o real', () => {
        expect(CONTROLES.length).toBeGreaterThanOrEqual(1);
        for (const caminho of CONTROLES) {
            expect(lerFonte(caminho).length).toBeGreaterThan(20000);
        }
    });

    it('o separador acha os metodos de preview e os tratadores de movimento', () => {
        for (const caminho of CONTROLES) {
            const nomes = membros(lerFonte(caminho)).map(metodo => metodo.nome);
            expect(nomes.filter(nome => METODO_DE_PREVIEW.test(nome)).length, caminho).toBeGreaterThanOrEqual(2);
            expect(nomes.filter(nome => TRATADOR_DE_MOVIMENTO.test(nome)).length, caminho).toBeGreaterThanOrEqual(1);
            for (const ancora of ANCORAS[caminho]) {
                expect(nomes, `${caminho}#${ancora}`).toContain(ancora);
            }
        }
    });
});

/**
 * Os fontes degenerados que as regras existem para rejeitar.
 *
 * Cada eixo tem o seu pior caso, e cada pior caso passa TAMBEM pelo outro eixo,
 * para nenhuma das duas ser vista passar por omissao.
 */
describe('as regras rejeitam o estado que existem para pegar', () => {
    it('reprova o debounce de 8 ms que o circulo tinha no preview do raio', () => {
        // Copiado do `performPreviewUpdate` do circulo em c5eb5046.
        const antigo = [
            'class C {',
            '    performPreviewUpdate = () => {',
            '        const radius = this.geometry.calculateDistance(center, this.lastPreviewPosition);',
            '        if (radius >= 10) {',
            '            clearTimeout(this.geometryDebounceTimer);',
            '            this.geometryDebounceTimer = setTimeout(() => {',
            '                this.showPreview(this.geometry.generate(center, radius));',
            '            }, 8);',
            '        }',
            '    }',
            '}',
        ].join('\n');
        expect(violacoesDeTimer('velho.js', antigo)).toEqual(['velho.js#performPreviewUpdate']);
        // ...e o outro eixo fica calado nele, que e por que os dois existem.
        expect(violacoesDeResolve('velho.js', antigo)).toEqual([]);
    });

    it('reprova o debounce que o circulo tinha no arrasto da alca', () => {
        const antigo = [
            'class C {',
            '    updateRadiusPreview = (newPosition) => {',
            '        clearTimeout(this.geometryDebounceTimer);',
            '        this.geometryDebounceTimer = setTimeout(() => {',
            '            this.map.getSource("circle-feedback").setData({});',
            '        }, 8);',
            '    }',
            '}',
        ].join('\n');
        expect(violacoesDeTimer('velho.js', antigo)).toEqual(['velho.js#updateRadiusPreview']);
    });

    it('reprova o resolve no mousemove de antes do primeiro clique', () => {
        // Copiado do `_onPreClickMouseMove` do circulo em c5eb5046.
        const antigo = [
            'class C {',
            '    _onPreClickMouseMove = (e) => {',
            '        const snapping = getSnappingService();',
            '        const snap = snapping?.resolve(this.map, e.point, e.lngLat) ?? e.lngLat;',
            '        if (snap.snapped) {',
            '            snapping.showIndicator(this.map, snap, snap.snapType);',
            '        }',
            '    }',
            '}',
        ].join('\n');
        expect(violacoesDeResolve('velho.js', antigo)).toEqual(['velho.js#_onPreClickMouseMove']);
        expect(violacoesDeTimer('velho.js', antigo)).toEqual([]);
    });

    it('reprova o resolve no mousemove do preview do raio', () => {
        const antigo = [
            'class C {',
            '    handlePreviewMouseMove = (e) => {',
            '        const snap = snapping?.resolve(this.map, e.point, e.lngLat) ?? e.lngLat;',
            '        this.lastPreviewPosition = [snap.lng, snap.lat];',
            '        if (!this.pendingPreviewUpdate) {',
            '            this.pendingPreviewUpdate = true;',
            '            this.previewRafId = requestAnimationFrame(this.performPreviewUpdate);',
            '        }',
            '    }',
            '}',
        ].join('\n');
        expect(violacoesDeResolve('velho.js', antigo)).toEqual(['velho.js#handlePreviewMouseMove']);
    });

    it('reprova o resolve no pointermove do arrasto, que e metodo comum e nao campo', () => {
        const antigo = [
            'class C {',
            '    _onEditPointerMove(e) {',
            '        const snap = snapping?.resolve(this.map, point, lngLat, excludeId) ?? lngLat;',
            '    }',
            '}',
        ].join('\n');
        expect(violacoesDeResolve('velho.js', antigo)).toEqual(['velho.js#_onEditPointerMove']);
    });

    it('reprova um timer de qualquer atraso, nao so o de 8 ms', () => {
        for (const atraso of [1, 8, 12, 16, 250]) {
            const fonte = `class C {\n    updateSectorPreview = () => {\n        setTimeout(() => this.draw(), ${atraso});\n    }\n}`;
            expect(violacoesDeTimer('velho.js', fonte)).toEqual(['velho.js#updateSectorPreview']);
        }
    });

    it('reprova o clearTimeout sozinho, que e a outra metade do debounce', () => {
        const fonte = 'class C {\n    clearPreview = () => {\n        clearTimeout(this.geometryDebounceTimer);\n    }\n}';
        expect(violacoesDeTimer('velho.js', fonte)).toEqual(['velho.js#clearPreview']);
    });

    it('reprova um tratador de TOQUE, que nenhum teste dirigido exercita', () => {
        // O motivo de existir uma regua que le o fonte: um caminho que so um
        // aparelho de toque percorre sai aprovado por omissao no teste dirigido.
        const fonte = 'class C {\n    _onTouchMove(e) {\n        const snap = snapping?.resolve(this.map, p, l) ?? l;\n    }\n}';
        expect(violacoesDeResolve('velho.js', fonte)).toEqual(['velho.js#_onTouchMove']);
    });

    it('nao dispara no que e CERTO, entao nao e uma proibicao cega', () => {
        // Timer fora de metodo de preview: o aviso que some sozinho. E real.
        const timerLaFora = 'class Ok {\n    showWarning() {\n        setTimeout(() => aviso.remove(), 2000);\n    }\n}';
        expect(violacoesDeTimer('ok.js', timerLaFora)).toEqual([]);

        // Resolve num CLIQUE: um por clique, e o clique decide o vertice, entao
        // nao pode esperar quadro nenhum. E resolve dentro do quadro tambem.
        const resolveCerto = [
            'class Ok {',
            '    handleMapClick = async (e) => {',
            '        const snap = snapping?.resolve(this.map, e.point, e.lngLat) ?? e.lngLat;',
            '    }',
            '    handleRightClick = async (e) => {',
            '        const snap = snapping?.resolve(this.map, screenPoint, coordinates) ?? coordinates;',
            '    }',
            '    performPreviewUpdate = (pointer) => {',
            '        const snap = snapping?.resolve(this.map, pointer.point, pointer.lngLat) ?? pointer.lngLat;',
            '    }',
            '}',
        ].join('\n');
        expect(violacoesDeResolve('ok.js', resolveCerto)).toEqual([]);
    });

    it('le codigo, nao comentario: regra que lesse prosa reportaria o passado', () => {
        const soComentario = [
            'class Ok {',
            '    updateRadiusPreview = () => {',
            '        /* o setTimeout(..., 8) que morava aqui nao coalescia nada */',
            '        // clearTimeout(this.geometryDebounceTimer);',
            '        this.showPreview(this.geometry.generate(center, radius));',
            '    }',
            '}',
        ].join('\n');
        expect(violacoesDeTimer('ok.js', soComentario)).toEqual([]);

        // E o limpador nao come o codigo em volta do comentario.
        const comentarioMaisCodigo = soComentario.replace(
            '        this.showPreview(this.geometry.generate(center, radius));',
            '        setTimeout(() => this.showPreview(1), 8);',
        );
        expect(violacoesDeTimer('velho.js', comentarioMaisCodigo)).toEqual(['velho.js#updateRadiusPreview']);
    });
});
