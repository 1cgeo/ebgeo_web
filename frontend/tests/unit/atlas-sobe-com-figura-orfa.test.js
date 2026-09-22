// Path: tests/unit/atlas-sobe-com-figura-orfa.test.js

/**
 * UMA FIGURA SEM ARQUIVO NÃO IMPEDE UM ATLAS DE SUBIR AO SERVIDOR, E A PERDA NUNCA É MUDA.
 *
 * Defeito (2026-09-19 a 2026-09-21): as TRÊS portas por onde um atlas sobe (o atlas local montado,
 * pelo menu de conta; o cartão local, pela página de atlas; o `.ebgeo` importado direto para o
 * servidor) RECUSAVAM na primeira imagem original sem arquivo: "Uma imagem original está ausente.
 * Nenhum atlas foi publicado." É a mesma armadilha que o exportador teve e perdeu horas antes, no mesmo dia
 * (`tests/unit/ebgeo-exporta-com-imagem-orfa.test.js`): uma figura cujo arquivo não existe mais em
 * lugar nenhum tornava o atlas impossível de publicar, para sempre, sem dizer QUAL figura. Quem
 * acusava era `tests/e2e-ui/cadeia-completa-atlas.spec.js`, vermelho na perna de envio, porque a
 * fixture 2.2 traz quatro feições de imagem e o blob de três.
 *
 * A recusa protegia uma coisa real (ninguém publica um buraco sem saber), e a PERGUNTA a guarda: a
 * perda é contada, nomeada, e a pessoa decide ANTES de qualquer escrita na rede. O servidor é
 * AVISADO de quais originais faltam (`missingImageIds`) e registra a contagem na trilha de
 * auditoria; a metade dele está em `backend/tests/integration/atomic-atlas-import.test.js`.
 *
 * Aqui ficam a parte PURA, o TRANSPORTE e a FIAÇÃO das três portas por leitura do texto. O
 * comportamento de uma porta inteira está em `tests/unit/enviar-blob-com-id-novo.test.js`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const disk = vi.hoisted(() => new Map());
vi.mock('@store/atlas-namespace.js', () => ({ getGlobalStore: () => ({
    getItem: async (key) => disk.get(key),
    setItem: async (key, value) => { disk.set(key, value); },
    removeItem: async (key) => disk.delete(key),
}) }));

import {
    classifyMissingImages,
    missingImagesUploadConfirm,
    uploadCancelledError,
} from '../../src/js/import_export/ebgeo-missing-images.js';
import { atomicServerImport } from '@js/import_export/atomic-server-import.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ler = (relativo) => readFileSync(path.join(RAIZ, relativo), 'utf8').replace(/\r\n/g, '\n');

const DADOS = {
    customIcons: [{ id: 'icone-1' }],
    maps: {
        Principal: { features: { images: [{ properties: { id: 'img-orfa' } }] } },
        '04 Imagens': { features: { images: [{ properties: { id: 'img-a' } }] } },
    },
};

describe('classifyMissingImages: toda ausente entra na conta, com o nome que der para dar', () => {
    it('feição de imagem ganha o mapa, ícone ganha o tipo, e o resto é ANEXO, nunca descartado', () => {
        expect(classifyMissingImages(['img-orfa', 'icone-1', 'foto-de-item-3d'], DADOS)).toEqual([
            { id: 'img-orfa', kind: 'imagem', mapName: 'Principal' },
            { id: 'icone-1', kind: 'icone', mapName: null },
            { id: 'foto-de-item-3d', kind: 'anexo', mapName: null },
        ]);
    });

    it('BORDA: id repetido entra uma vez; vazio, não textual e lista que não é lista não entram', () => {
        expect(classifyMissingImages(['img-a', 'img-a', '', null, 7], DADOS)).toEqual([
            { id: 'img-a', kind: 'imagem', mapName: '04 Imagens' },
        ]);
        for (const ids of [null, undefined, 'img-a', {}]) expect(classifyMissingImages(ids, DADOS)).toEqual([]);
        expect(classifyMissingImages(['x'], null)).toEqual([{ id: 'x', kind: 'anexo', mapName: null }]);
    });
});

describe('missingImagesUploadConfirm: a pergunta de quem SOBE', () => {
    it('nada faltando devolve null, e a porta então não pergunta nada', () => {
        expect(missingImagesUploadConfirm([])).toBeNull();
        expect(missingImagesUploadConfirm(null)).toBeNull();
    });

    it('do DISCO: nomeia contagem e mapa, diz que não há de onde recuperar, e o que os colegas verão', () => {
        const p = missingImagesUploadConfirm([{ id: 'img-orfa', kind: 'imagem', mapName: 'Principal' }], { from: 'disco' });
        expect(p.title).toBe('Este atlas sobe sem 1 figura');
        expect(p.message).toContain('não está guardado neste computador para: 1 imagem (no mapa "Principal").');
        expect(p.message).toContain('Não há de onde recuperá-lo');
        expect(p.message).toContain('quem abrir o atlas verá um marcador de erro no lugar');
        expect(p.message).toContain('Todo o resto sobe inteiro.');
        expect(p.confirmText).toBe('Enviar assim');
        expect(p.cancelText).toBe('Cancelar');
    });

    it('do ARQUIVO: a saída real (uma cópia mais completa) é dita, e o verbo do botão é o da tela', () => {
        const p = missingImagesUploadConfirm([{ id: 'a', kind: 'imagem', mapName: 'M' }], { from: 'arquivo' });
        expect(p.message).toContain('O arquivo .ebgeo não traz a figura de: 1 imagem (no mapa "M").');
        expect(p.message).toContain('cancele e importe a partir dela');
        expect(p.message).not.toContain('neste computador');
        expect(p.confirmText).toBe('Importar assim');
    });

    it('três tipos numa frase só, com vírgula e "e", e o plural concorda', () => {
        const p = missingImagesUploadConfirm([
            { id: 'a', kind: 'imagem', mapName: 'Alfa' },
            { id: 'b', kind: 'imagem', mapName: 'Bravo' },
            { id: 'i', kind: 'icone', mapName: null },
            { id: 'x', kind: 'anexo', mapName: null },
            { id: 'y', kind: 'anexo', mapName: null },
        ]);
        expect(p.title).toBe('Este atlas sobe sem 5 figuras');
        expect(p.message).toContain('2 imagens (nos mapas "Alfa", "Bravo"), 1 ícone personalizado e 2 figuras anexadas.');
        expect(p.message).toContain('o que usa essas figuras vai para o servidor sem elas');
    });

    it('cancelar é DECISÃO: o erro vem marcado, para o chamador calar em vez de acusar falha', () => {
        const erro = uploadCancelledError();
        expect(erro).toBeInstanceOf(Error);
        expect(erro.cancelled).toBe(true);
        expect(erro.stage).toBe('leitura');
    });
});

describe('o transporte DECLARA as ausentes ao servidor, e só quando há o que declarar', () => {
    const token = `header.${btoa(JSON.stringify({ sub: 'dono' }))}.signature`;
    let inicio;
    const cliente = () => ({
        baseUrl: '/api/v1',
        getAccessToken: () => token,
        _request: vi.fn(async (method, caminho, { body }) => {
            if (caminho === '/atlas/imports') { inicio = body; return { id: body.id, imageIds: body.imageIds, result: null }; }
            if (caminho.endsWith('/commit')) return { id: 'atlas-1' };
            return {};
        }),
    });
    const imagem = [{ localId: 'subiu', mimeType: 'image/png', data: 'bytes', filename: 'f.png' }];

    beforeEach(() => { disk.clear(); inicio = null; });

    it('com ausentes, o pedido de início leva `missingImageIds` ao lado do manifesto', async () => {
        await atomicServerImport(cliente(), {}, imagem, { a: 1 }, ['orfa-1', 'orfa-2']);
        expect(inicio.imageIds).toEqual(['subiu']);
        expect(inicio.missingImageIds).toEqual(['orfa-1', 'orfa-2']);
    });

    it('sem ausentes, a chave NÃO vai: o pedido comum continua byte a byte o de antes', async () => {
        await atomicServerImport(cliente(), {}, imagem, { a: 2 });
        expect(inicio.imageIds).toEqual(['subiu']);
        expect(Object.hasOwn(inicio, 'missingImageIds')).toBe(false);
    });

    it('BORDA: TODAS ausentes ainda é import atômico, com manifesto vazio e nenhuma subida', async () => {
        const c = cliente();
        expect(await atomicServerImport(c, {}, [], { a: 3 }, ['unica'])).toEqual({ id: 'atlas-1' });
        expect(inicio.imageIds).toEqual([]);
        expect(inicio.missingImageIds).toEqual(['unica']);
        expect(c._request.mock.calls.filter(([, caminho]) => caminho.endsWith('/images'))).toHaveLength(0);
    });
});

describe('as TRÊS portas perguntam antes da rede, e nenhuma recusa mais por figura ausente', () => {
    const PORTAS = [
        ['src/js/import_export/save-local-atlas.service.js', "{ from: 'disco' }", 'missing.map((id) => imageIdMap[id] || id)'],
        ['src/js/projects/send-local-to-server.service.js', "{ from: 'disco' }", 'missing.map((id) => imageIdMap[id])'],
        ['src/js/projects/import-ebgeo.service.js', "{ from: 'arquivo' }", 'missing.map(id => imageIdMap[id])'],
    ];

    it('PISO: são três portas, e as três ainda publicam por `importAtlas`', () => {
        expect(PORTAS).toHaveLength(3);
        for (const [arquivo] of PORTAS) expect(ler(arquivo)).toContain('apiClient.importAtlas(built.payload, {');
    });

    it.each(PORTAS)('%s: a forma exata da recusa não volta', (arquivo) => {
        const texto = ler(arquivo);
        expect(texto).not.toContain('Uma imagem original está ausente');
        expect(texto).not.toMatch(/original\(is\) ausente\(s\) no arquivo/);
    });

    it.each(PORTAS)('%s: pergunta com a origem certa, ANTES de publicar, e cancelar lança o erro marcado', (arquivo, origem) => {
        const texto = ler(arquivo);
        const pergunta = texto.indexOf(`missingImagesUploadConfirm(classifyMissingImages(missing, exportData), ${origem})`);
        const recusa = texto.indexOf('if (question && !(await confirmMissingImages?.(question))) throw uploadCancelledError();');
        const publica = texto.indexOf('apiClient.importAtlas(built.payload, {');
        expect(pergunta).toBeGreaterThan(-1);
        expect(recusa).toBeGreaterThan(pergunta);
        expect(publica).toBeGreaterThan(recusa);
    });

    it.each(PORTAS)('%s: declara ao servidor o id NOVO das ausentes, o mesmo que o payload cita', (arquivo, _origem, declaracao) => {
        expect(ler(arquivo)).toContain(`missingImageIds: ${declaracao}`);
    });

    it('os chamadores mostram o diálogo e CALAM no cancelamento, em vez de acusar falha', () => {
        const conta = ler('src/js/account/account.control.js');
        expect(conta).toContain('confirmMissingImages: (question) => showConfirm(question.title, {');
        expect(conta).toContain("if (!error?.cancelled) showError('Não foi possível salvar o atlas no servidor. Tente de novo.');");
        const pagina = ler('src/js/projects/projects-page.js');
        expect(pagina.match(/confirmMissingImages: askAboutMissingImages,/g)).toHaveLength(2);
        expect(pagina.match(/if \(error\?\.cancelled\) return;/g)).toHaveLength(2);
    });
});
