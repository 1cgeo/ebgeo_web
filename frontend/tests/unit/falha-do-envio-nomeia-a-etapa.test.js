// Path: tests/unit/falha-do-envio-nomeia-a-etapa.test.js

/**
 * @fileoverview O QUE A TELA DIZ QUANDO O ENVIO AO SERVIDOR FALHA, e por que uma frase só não
 * serve.
 *
 * O ACHADO (B3-6), medido no navegador em 2026-09-07 abortando `**\/images/bulk*`: o
 * `POST /atlas/import` respondeu **201** (atlas criado, 14 mapas, 805 feições, ZERO imagens), o
 * pedido das imagens caiu com `net::ERR_FAILED`, e a tela mostrou um toast de erro com o texto
 * literal do navegador, **"Failed to fetch"**. Nada em português, nada dizendo que o atlas JÁ
 * ESTAVA no servidor, nada dizendo que ele estava sem imagem.
 *
 * AS DUAS FALHAS TÊM CONSEQUÊNCIAS OPOSTAS, e é isso que uma frase só não pode dizer:
 *
 *   - caindo no IMPORT, nada foi criado no servidor. `importAtlas` roda inteiro dentro de uma
 *     transação (medido contra um 500 forjado: nenhum atlas com aquele nome ficou no banco), então
 *     a pessoa pode simplesmente tentar de novo;
 *   - caindo nas IMAGENS, o atlas EXISTE no servidor, incompleto, e vai aparecer na lista dela.
 *     Tentar de novo cria um SEGUNDO atlas (`send-local-to-server.service.js` não sincroniza,
 *     copia), então a decisão é outra e a frase tem de dizer qual.
 *
 * NOS DOIS CASOS O SLOT LOCAL ESTÁ INTACTO, medido em cinco envios e três modos de falha: 251
 * registros antes, 251 depois. A frase diz isso porque é a primeira pergunta de quem lê um erro
 * depois de mandar o próprio acervo para algum lugar.
 *
 * ONDE CADA METADE MORA. A etapa é carimbada no erro pelo SERVIÇO (`error.stage`, mais
 * `error.atlasId` quando o atlas já existe), e a frase é pura, em `local-atlas-notices.js`. A
 * fiação de `projects-page.js` é lida da FONTE, porque aquele arquivo boota no import e nenhum
 * teste de nó pode carregá-lo: leitura de fonte prova que a linha existe, nunca que ela roda.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// Do módulo, e não do global: o `env` desta suíte é o do NAVEGADOR, onde `Buffer` não existe.
import { Buffer } from 'node:buffer';
import { resetIndexedDB } from '../helpers/idb-helpers.js';
import { NoticeKind, sendFailureNotice, sendToServerNotice } from '@js/projects/local-atlas-notices.js';

const PAGE_SRC = readFileSync(
    fileURLToPath(new URL('../../src/js/projects/projects-page.js', import.meta.url)), 'utf8'
);

/** O erro que o navegador produz quando o `fetch` não sai: sem status, com aquela mensagem. */
function erroDeRede(stage, atlasId = null) {
    const e = new Error('Failed to fetch');
    e.stage = stage;
    if (atlasId) e.atlasId = atlasId;
    return e;
}

// ============================================================================
// 1 — A FRASE, por etapa
// ============================================================================

describe('a falha DEPOIS do import: o atlas já está no servidor', () => {
    const notice = () => sendFailureNotice(erroDeRede('images', 'srv-9'), { name: 'Meu Atlas' });

    it('diz que o atlas JÁ EXISTE no servidor e que está sem parte das imagens', () => {
        const n = notice();
        expect(n.kind).toBe(NoticeKind.ERROR);
        expect(n.message).toContain('Meu Atlas');
        expect(n.message).toMatch(/já (foi criado|está) no servidor/i);
        expect(n.message).toMatch(/imagens/i);
    });

    it('diz que o atlas LOCAL continua aqui, que é a primeira pergunta de quem lê', () => {
        expect(notice().message).toMatch(/continua (neste navegador|aqui)/i);
    });

    it('NUNCA mostra o texto cru do `fetch`', () => {
        expect(notice().message).not.toContain('Failed to fetch');
    });
});

describe('a falha NO import: nada foi criado no servidor', () => {
    const notice = () => sendFailureNotice(erroDeRede('import'), { name: 'Meu Atlas' });

    it('diz que NADA foi criado no servidor', () => {
        const n = notice();
        expect(n.kind).toBe(NoticeKind.ERROR);
        expect(n.message).toMatch(/nada foi criado/i);
        expect(n.message).toContain('Meu Atlas');
    });

    it('NÃO diz que o atlas está no servidor, que é a frase da OUTRA etapa', () => {
        // A METADE QUE FAZ A DISTINÇÃO VALER. Sem esta linha, uma frase única que dissesse
        // sempre "o atlas já está no servidor" passaria nos dois blocos.
        expect(notice().message).not.toMatch(/já (foi criado|está) no servidor/i);
    });

    it('NUNCA mostra o texto cru do `fetch`', () => {
        expect(notice().message).not.toContain('Failed to fetch');
    });
});

describe('o MOTIVO, quando o servidor respondeu e quando não respondeu', () => {
    it('sem status nenhum, a frase fala de rede e não repete o erro do navegador', () => {
        const n = sendFailureNotice(erroDeRede('import'), { name: 'X' });
        expect(n.message).toMatch(/rede|fora do ar|conex/i);
        expect(n.message).not.toContain('Failed to fetch');
    });

    it('com status, a frase diz o que o SERVIDOR respondeu', () => {
        // Aqui o servidor falou, e o que ele disse é informação: o corpo do 500 da bancada era
        // `erro forjado pela bancada`, e escondê-lo cobraria uma ida ao console.
        const e = new Error('erro forjado pela bancada');
        e.stage = 'import';
        e.status = 500;
        const n = sendFailureNotice(e, { name: 'X' });
        expect(n.message).toContain('erro forjado pela bancada');
    });

    it('sessão expirada tem frase própria, porque o gesto que resolve é outro', () => {
        const e = new Error('Unauthorized');
        e.stage = 'import';
        e.status = 401;
        expect(sendFailureNotice(e, { name: 'X' }).message).toMatch(/sess[ãa]o|entrar de novo/i);
    });
});

describe('a recusa de LEITURA fala por si', () => {
    it('a frase da recusa é a que o serviço escreveu, sem moldura de rede', () => {
        // `stage: 'leitura'` é a recusa que acontece ANTES de qualquer pedido (atlas sem mapa,
        // dois mapas no mesmo nome). Ela já vem em português, escrita ao lado da regra que
        // recusou, e envolvê-la em "não foi possível falar com o servidor" seria mentir.
        const e = new Error('Este atlas local não tem nenhum mapa para enviar ao servidor.');
        e.stage = 'leitura';
        const n = sendFailureNotice(e, { name: 'Vazio' });
        expect(n.kind).toBe(NoticeKind.ERROR);
        expect(n.message).toBe('Este atlas local não tem nenhum mapa para enviar ao servidor.');
        expect(n.message).not.toMatch(/rede|servidor fora do ar/i);
    });

    it('a recusa por nome repetido chega inteira à tela', () => {
        const e = new Error('Este atlas local tem mais de um mapa com o mesmo nome: "Alfa". '
            + 'Abra o atlas, renomeie os mapas repetidos e envie de novo. Nada foi enviado.');
        e.stage = 'leitura';
        e.code = 'NOME_DE_MAPA_REPETIDO';
        expect(sendFailureNotice(e, { name: 'X' }).message).toContain('renomeie');
    });
});

describe('NUNCA SILENCIOSO: o pior caso da entrada', () => {
    it.each([
        ['erro sem etapa', new Error('boom')],
        ['erro sem mensagem', new Error('')],
        ['nulo', null],
        ['indefinido', undefined],
        ['string solta', 'quebrou'],
        ['objeto qualquer', { qualquer: 'coisa' }],
    ])('%s produz um ERRO com frase em português não vazia', (_nome, entrada) => {
        const n = sendFailureNotice(entrada, { name: 'Meu Atlas' });
        expect(n.kind).toBe(NoticeKind.ERROR);
        expect(n.message.trim().length).toBeGreaterThan(0);
        expect(n.message).not.toContain('undefined');
        expect(n.message).not.toContain('[object Object]');
    });

    it('sem nome, a frase não escreve "undefined"', () => {
        const n = sendFailureNotice(erroDeRede('images', 'srv-9'));
        expect(n.message).not.toMatch(/undefined|null/);
    });
});

// ============================================================================
// 2 — O SERVIÇO CARIMBA A ETAPA (senão a frase acima não tem como saber)
// ============================================================================

let ns;
let servico;
let originalFileReader;

/**
 * `FileReader` mínimo, o suficiente para o `readAsDataURL` de um `Blob` real, copiado de
 * `enviar-atlas-local-ao-servidor.test.js`. Sem ele `blobToBase64` falha, a imagem entra em
 * `skipped` e o ramo que este arquivo mede (o transporte caindo com a imagem já pronta para
 * subir) nunca é alcançado.
 */
class FileReaderDublê {
    constructor() {
        this.result = null;
        this.error = null;
        this.onloadend = null;
        this.onerror = null;
    }

    readAsDataURL(blob) {
        Promise.resolve()
            .then(() => blob.arrayBuffer())
            .then((buf) => {
                this.result = `data:${blob.type || 'application/octet-stream'};base64,`
                    + Buffer.from(buf).toString('base64');
                this.onloadend?.();
            })
            .catch((e) => { this.error = e; this.onerror?.(); });
    }
}

beforeEach(async () => {
    await resetIndexedDB();
    vi.resetModules();
    originalFileReader = globalThis.FileReader;
    globalThis.FileReader = FileReaderDublê;
    ns = await import('../../src/js/store/atlas-namespace.js');
    servico = await import('../../src/js/projects/send-local-to-server.service.js');
});

afterEach(() => {
    globalThis.FileReader = originalFileReader;
});

const escopo = () => ns.localScope('atlas-falho', 'falho');
const gravar = (banco, scope, key, value) =>
    ns.getStoreFor(ns.StoreName[banco], scope).setItem(key, value);

/** Um slot mínimo com UMA feição de imagem, que é o que faz a subida de blobs acontecer. */
async function semear(scope) {
    const idImagem = 'e0000000-0000-4000-8000-00000000000e';
    await gravar('MAPS', scope, 'Alfa', {
        name: 'Alfa',
        features: {
            images: [{
                geometry: { type: 'Point', coordinates: [0, 0] },
                properties: { id: idImagem, source: 'image', layerId: 'default' },
            }],
        },
    });
    await gravar('IMAGES', scope, idImagem, new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }));
}

const enviar = (scope, apiClient) => servico.sendLocalAtlasToServer(
    { id: 'atlas-falho', name: 'Falho', dbSuffix: 'falho' },
    { apiClient, scopeOf: () => scope },
);

describe('o serviço diz EM QUE ETAPA caiu', () => {
    it('falha do import carimba `stage: import` e NÃO carrega `atlasId`', async () => {
        const scope = escopo();
        await semear(scope);
        const apiClient = {
            async importAtlas() { throw new Error('Failed to fetch'); },
            async bulkUploadImages() { throw new Error('não deveria chegar aqui'); },
        };

        const erro = await enviar(scope, apiClient).catch((e) => e);

        expect(erro.stage).toBe('import');
        expect(erro.atlasId ?? null).toBeNull();
        expect(sendFailureNotice(erro, { name: 'Falho' }).message).toMatch(/nada foi criado/i);
    });

    it('rede caída na subida NÃO derruba o envio: vira `imageStats.failed`, e a frase diz onde o atlas está', async () => {
        // O CAMINHO REAL DESTE ACHADO MUDOU DE RAMO NA MESMA ONDA. A subida por lotes ganhou
        // `try/catch` POR LOTE (`atlas-image-upload.js`), então o transporte que cai deixa de
        // propagar e passa a contar como imagem que não subiu. O que a pessoa vê deixa de ser um
        // toast de ERRO com texto cru e passa a ser o AVISO que nomeia o que faltou e diz que o
        // atlas está no servidor. Esta é a régua desse ramo, e ela é a que a população encontra.
        const scope = escopo();
        await semear(scope);
        const apiClient = {
            async importAtlas() { return { id: 'srv-criado', summary: {} }; },
            async bulkUploadImages() { throw new Error('Failed to fetch'); },
        };

        const result = await enviar(scope, apiClient);
        const notice = sendToServerNotice(result);

        expect(result.atlasId).toBe('srv-criado');
        expect(result.imageStats.failed).toBe(1);
        expect(notice.kind).toBe(NoticeKind.WARNING);
        expect(notice.message).toMatch(/1 imagem não subiu/i);
        expect(notice.message).toMatch(/já está no servidor/i);
        expect(notice.message).not.toContain('Failed to fetch');
        // E NÃO NAVEGA: a frase é a única que nomeia a imagem que ficou para trás.
        expect(notice.openAtlasId).toBeNull();
    });

    it('BELT: o que ainda assim estourar DEPOIS do import carimba `images` e o `atlasId`', async () => {
        // A subida por lotes não propaga mais, então este ramo não tem gatilho pelas juntas
        // públicas — e é justamente por isso que ele existe: uma falha que ninguém previu depois
        // do import deixaria a pessoa com um atlas no servidor e uma frase dizendo que nada foi
        // criado. O dublê é do MÓDULO VIZINHO, declarado, e mede o carimbo, não o vizinho.
        vi.resetModules();
        vi.doMock('@js/import_export/atlas-image-upload.js', () => ({
            buildImageUploads: async () => ({ uploads: [{ localId: 'x' }], skipped: [] }),
            uploadImagesInChunks: async () => { throw new Error('Failed to fetch'); },
        }));
        const nsDublê = await import('../../src/js/store/atlas-namespace.js');
        const servicoDublê = await import('../../src/js/projects/send-local-to-server.service.js');
        const scope = nsDublê.localScope('atlas-belt', 'belt');
        await nsDublê.getStoreFor(nsDublê.StoreName.MAPS, scope)
            .setItem('Alfa', { name: 'Alfa', features: {} });

        const erro = await servicoDublê.sendLocalAtlasToServer(
            { id: 'atlas-belt', name: 'Belt', dbSuffix: 'belt' },
            {
                scopeOf: () => scope,
                apiClient: {
                    async importAtlas() { return { id: 'srv-criado', summary: {} }; },
                    async bulkUploadImages() { return { mapping: {}, failed: [] }; },
                },
            },
        ).catch((e) => e);
        vi.doUnmock('@js/import_export/atlas-image-upload.js');

        expect(erro.stage).toBe('images');
        expect(erro.atlasId).toBe('srv-criado');
        expect(sendFailureNotice(erro, { name: 'Belt' }).message)
            .toMatch(/já (foi criado|está) no servidor/i);
    });

    it('a recusa por atlas sem mapa carimba `stage: leitura`', async () => {
        const erro = await enviar(ns.localScope('vazio', 'vazio'), {
            async importAtlas() { throw new Error('não deveria chegar aqui'); },
            async bulkUploadImages() { throw new Error('não deveria chegar aqui'); },
        }).catch((e) => e);

        expect(erro.stage).toBe('leitura');
    });

    it('o erro original ATRAVESSA: `status` e mensagem do servidor sobrevivem ao carimbo', async () => {
        // Embrulhar o erro num `new Error(texto)` perderia o `status`, que é o que distingue
        // "o servidor falou" de "o navegador não conseguiu falar" — a distinção inteira do motivo.
        const scope = escopo();
        await semear(scope);
        const original = new Error('erro forjado pela bancada');
        original.status = 500;
        const apiClient = {
            async importAtlas() { throw original; },
            async bulkUploadImages() { return { mapping: {}, failed: [] }; },
        };

        const erro = await enviar(scope, apiClient).catch((e) => e);

        expect(erro).toBe(original);
        expect(erro.status).toBe(500);
        expect(sendFailureNotice(erro, { name: 'Falho' }).message)
            .toContain('erro forjado pela bancada');
    });

    it('CONTROLE: o envio que dá certo não carimba etapa nenhuma', async () => {
        const scope = escopo();
        await semear(scope);
        const result = await enviar(scope, {
            async importAtlas() { return { id: 'srv-ok', summary: {} }; },
            async bulkUploadImages(_id, itens) {
                return { mapping: Object.fromEntries(itens.map((i) => [i.localId, i.localId])), failed: [] };
            },
        });
        expect(result.atlasId).toBe('srv-ok');
    });
});

// ============================================================================
// 3 — A FIAÇÃO: a página usa a frase, e não o `error.message`
// ============================================================================

describe('a página mostra a frase da etapa, não o erro cru', () => {
    const CORPO = PAGE_SRC.slice(
        PAGE_SRC.indexOf('async function sendLocalAtlasToServerFromPage(atlas)'),
        PAGE_SRC.indexOf('/** Card click / "Abrir"'),
    );

    it('o `catch` chama `sendFailureNotice`', () => {
        expect(CORPO).toContain('sendFailureNotice(');
    });

    it('e NÃO mostra mais o `error.message` cru, que é como "Failed to fetch" chegava à tela', () => {
        expect(CORPO).not.toContain('error?.message');
        expect(CORPO).not.toContain('error.message');
    });

    it('a página importa a função do módulo dos avisos', () => {
        expect(PAGE_SRC).toContain('sendFailureNotice,');
    });
});
