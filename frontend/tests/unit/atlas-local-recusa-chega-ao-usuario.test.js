// Path: tests/unit/atlas-local-recusa-chega-ao-usuario.test.js

/**
 * @fileoverview As duas recusas que o usuário de "Seus atlas" encontra no uso normal — o teto de
 * dez atlas locais e "este é o seu único atlas local" — têm que virar FRASE, e não botão que não
 * faz nada.
 *
 * O tamanho do buraco que isto fecha: a API já devolve `{ ok: false, error, message }` com o texto
 * em pt-BR escrito ao lado da regra que recusou (`store/local-atlas.api.js`), e
 * `tests/unit/local-atlas-api.test.js` prende esse contrato. O que ninguém prendia é a outra
 * metade: que a tela DIGA. Um handler que faz `if (!result.ok) return;` passa em toda suíte de
 * store que existe, e para o usuário é indistinguível de um botão quebrado.
 *
 * A tela não é testável (`projects-page.js` boota no import e vive no DOM), então a decisão saiu de
 * lá para `projects/local-atlas-notices.js`, que é função pura. Este arquivo mede as duas pontas:
 *
 *   1. as recusas REAIS, produzidas pela API de verdade sobre um disco falso, viram aviso de ERRO
 *      carregando a mensagem que a API escreveu (e não uma paráfrase deste teste);
 *   2. as bordas em que um mapeador ingênuo emudece: recusa sem mensagem, resultado que nem objeto
 *      é, sucesso sem nome de atlas (que produziria `Atlas "undefined" criado.`), e o sucesso PELA
 *      METADE da exclusão com bancos presos por outra aba, que não pode soar como sucesso.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
    NoticeKind,
    createNotice,
    deleteNotice,
    refusalNotice,
    renameNotice
} from '@js/projects/local-atlas-notices.js';

// ============================================================================
// Disco falso, keyed por nome de banco: o mesmo da suíte da API, porque a metade 1 deste arquivo
// roda a API DE VERDADE. Recusa dublada seria este teste conferindo o texto contra si mesmo.
// ============================================================================

const { databases, makeStore, resetFake } = vi.hoisted(() => {
    const databases = new Map();
    function makeStore({ name, storeName = null }) {
        const key = `${name}::${storeName || 'keyvaluepairs'}`;
        const backing = databases.get(key) ?? new Map();
        databases.set(key, backing);
        return {
            setItem: vi.fn(async (k, v) => { backing.set(k, v); return v; }),
            getItem: vi.fn(async (k) => (backing.has(k) ? backing.get(k) : null)),
            removeItem: vi.fn(async (k) => { backing.delete(k); }),
            keys: vi.fn(async () => [...backing.keys()]),
            clear: vi.fn(async () => { backing.clear(); })
        };
    }
    return { databases, makeStore, resetFake: () => databases.clear() };
});

vi.mock('localforage', () => ({
    default: {
        createInstance: vi.fn(makeStore),
        dropInstance: vi.fn(async ({ name }) => {
            for (const key of [...databases.keys()]) {
                if (key.startsWith(`${name}::`)) databases.delete(key);
            }
        })
    }
}));

// O aviso entre abas abriria um BroadcastChannel e esperaria por pares que não existem aqui.
vi.mock('@utils/tab-lock.js', async (importOriginal) => ({
    ...(await importOriginal()),
    announceTabLockTeardown: vi.fn(async () => ({ peers: 0, acked: 0, frozen: 0 }))
}));

let api;

beforeEach(async () => {
    vi.resetModules();
    resetFake();
    api = await import('@store/local-atlas.api.js');
    const errors = await import('@store/store-errors.js');
    errors.setStoreErrorEventBus({ emit: vi.fn() });
    await api.initLocalAtlases();
});

describe('as recusas REAIS da API viram frase para o usuário', () => {
    it('o teto de 10: o décimo primeiro "Criar" diz por que não, com a mensagem da API', async () => {
        for (let i = 2; i <= api.MAX_LOCAL_ATLASES; i += 1) {
            // Controle da borda de baixo: se o teto disparasse cedo, o aviso abaixo seria de outro
            // caso e este arquivo estaria medindo outra coisa.
            expect((await api.createLocalAtlas(`Atlas ${i}`)).ok).toBe(true);
        }
        const recusa = await api.createLocalAtlas('Atlas 11');
        expect(recusa.error).toBe(api.LocalAtlasError.LIMIT_REACHED);

        const aviso = createNotice(recusa);

        expect(aviso.kind).toBe(NoticeKind.ERROR);
        // A mensagem é A DA API, não uma paráfrase escrita aqui: é ela que sabe o que o usuário
        // tem que fazer (excluir um antes de criar outro).
        expect(aviso.message).toBe(recusa.message);
        expect(aviso.message).toContain('Limite de 10 atlas locais');
        expect(aviso.message).toContain('Exclua um atlas antes de criar outro');
    });

    it('o último atlas: a exclusão recusada diz por que não, em vez de não fazer nada', async () => {
        const unico = api.listLocalAtlases()[0];
        const recusa = await api.deleteLocalAtlas(unico.id);
        expect(recusa.error).toBe(api.LocalAtlasError.LAST_ATLAS);

        const aviso = deleteNotice(recusa);

        expect(aviso.kind).toBe(NoticeKind.ERROR);
        expect(aviso.message).toBe(recusa.message);
        expect(aviso.message).toContain('único atlas local');
        expect(aviso.message).toContain('Crie outro');
    });

    it('as TRÊS recusas nomeadas da API viram erro com texto, nenhuma emudece', async () => {
        // Cobertura fechada sobre `LocalAtlasError`: um código novo sem mensagem cai aqui, porque
        // a lista de códigos vem do módulo e não desta linha.
        const recusas = new Map();
        recusas.set(api.LocalAtlasError.NOT_FOUND, await api.setCurrentLocalAtlas('nao-existe'));
        recusas.set(api.LocalAtlasError.LAST_ATLAS,
            await api.deleteLocalAtlas(api.listLocalAtlases()[0].id));
        for (let i = 2; i <= api.MAX_LOCAL_ATLASES; i += 1) await api.createLocalAtlas(`Atlas ${i}`);
        recusas.set(api.LocalAtlasError.LIMIT_REACHED, await api.createLocalAtlas('Atlas 11'));

        expect([...recusas.keys()].sort()).toEqual(Object.values(api.LocalAtlasError).sort());

        for (const [codigo, recusa] of recusas) {
            for (const mapear of [createNotice, renameNotice, deleteNotice, refusalNotice]) {
                const aviso = mapear(recusa);
                expect(aviso, `${codigo} por ${mapear.name} não produziu aviso`).toBeTruthy();
                expect(aviso.kind, `${codigo} por ${mapear.name}`).toBe(NoticeKind.ERROR);
                expect(aviso.message.trim().length, `${codigo} por ${mapear.name}`)
                    .toBeGreaterThan(0);
                expect(aviso.message).toBe(recusa.message);
            }
        }
    });

    it('e o sucesso continua sendo sucesso, com o nome que a API devolveu', async () => {
        // Controle positivo do par: sem ele, um mapeador que respondesse ERRO para tudo passaria
        // em todos os casos acima.
        const criado = await api.createLocalAtlas('Operação Alfa');
        expect(createNotice(criado)).toEqual({
            kind: NoticeKind.SUCCESS, message: 'Atlas "Operação Alfa" criado.'
        });

        const renomeado = await api.renameLocalAtlas(criado.atlas.id, 'Operação Bravo');
        expect(renameNotice(renomeado)).toEqual({
            kind: NoticeKind.SUCCESS, message: 'Atlas renomeado para "Operação Bravo".'
        });

        const excluido = await api.deleteLocalAtlas(criado.atlas.id);
        expect(excluido.blockedDatabases).toEqual([]);
        expect(deleteNotice(excluido)).toEqual({
            kind: NoticeKind.SUCCESS, message: 'Atlas "Operação Bravo" excluído.'
        });
    });
});

describe('as bordas em que um mapeador ingênuo emudece', () => {
    it('recusa SEM mensagem (código novo, mensagem esquecida) ainda fala', () => {
        for (const resultado of [
            { ok: false, error: 'codigo_que_nao_existe' },
            { ok: false, error: 'x', message: '' },
            { ok: false, error: 'x', message: '   ' }
        ]) {
            const aviso = refusalNotice(resultado);
            expect(aviso.kind).toBe(NoticeKind.ERROR);
            expect(aviso.message.trim().length).toBeGreaterThan(10);
        }
    });

    it('resultado ausente ou de outra forma vira erro, nunca silêncio nem exceção', () => {
        for (const entrada of [null, undefined, {}, 'recusado', 42, []]) {
            for (const mapear of [createNotice, renameNotice, deleteNotice, refusalNotice]) {
                const aviso = mapear(entrada);
                expect(aviso.kind, `${mapear.name} com ${JSON.stringify(entrada)}`)
                    .toBe(NoticeKind.ERROR);
                expect(aviso.message.trim().length).toBeGreaterThan(10);
            }
        }
    });

    it('sucesso sem nome de atlas não vira `Atlas "undefined"`', () => {
        // O nome vem do registro, e um resultado sem `atlas` chega aqui na hora em que um caminho
        // novo (ou um deploy anterior) devolve só `{ ok: true }`. Interpolar direto produz uma
        // frase que parece um defeito para o usuário e é um defeito para quem for depurar.
        for (const [mapear, esperado] of [
            [createNotice, 'Atlas local criado.'],
            [renameNotice, 'Atlas local renomeado.'],
            [deleteNotice, 'Atlas local excluído.']
        ]) {
            for (const entrada of [{ ok: true }, { ok: true, atlas: {} }, { ok: true, atlas: { name: '  ' } }]) {
                const aviso = mapear(entrada);
                expect(aviso.kind).toBe(NoticeKind.SUCCESS);
                expect(aviso.message).toBe(esperado);
                expect(aviso.message).not.toContain('undefined');
            }
        }
    });

    it('exclusão com bancos presos por outra aba é AVISO, e não sucesso', () => {
        // Meio caminho: o slot saiu do registro, os arquivos ficaram no disco e a outra aba ainda
        // pode escrever neles. Anunciar isto como "excluído" é como um usuário fica com dado que
        // nenhuma tela alcança.
        const aviso = deleteNotice({
            ok: true,
            atlas: { name: 'Operação Alfa' },
            droppedDatabases: ['ebgeo_maps__x'],
            blockedDatabases: ['ebgeo_layers__x']
        });

        expect(aviso.kind).toBe(NoticeKind.WARNING);
        expect(aviso.message).toContain('Operação Alfa');
        expect(aviso.message).toContain('outra aba');
        expect(aviso.message).toContain('recarregue');
        // E o par: lista vazia é exclusão limpa, senão o aviso apareceria sempre e viraria ruído.
        expect(deleteNotice({ ok: true, atlas: { name: 'A' }, blockedDatabases: [] }).kind)
            .toBe(NoticeKind.SUCCESS);
    });
});

describe('a tela usa o mapeador (senão ele é código morto e a recusa volta a sumir)', () => {
    const PAGINA = readFileSync(
        fileURLToPath(new URL('../../src/js/projects/projects-page.js', import.meta.url)), 'utf8'
    );

    it('cada um dos quatro caminhos passa pelo seu construtor de aviso', () => {
        for (const simbolo of ['createNotice(', 'renameNotice(', 'deleteNotice(', 'refusalNotice(']) {
            expect(PAGINA, `projects-page.js não usa ${simbolo}`).toContain(simbolo);
        }
    });

    it('e nenhum handler volta a reportar a recusa na mão', () => {
        // A FORMA ANTIGA, que é a que apaga: `if (!result.ok) { showError(result.message); }`. Ela
        // parece correta e some no primeiro caminho novo que esquece o `else`.
        // `notice.message` é a saída do mapeador (a função `tell`), e é justamente o que se quer.
        expect(PAGINA).not.toMatch(/show(Error|Warning|Success)\(\s*(?!notice\.message)\w+\.message\s*\)/);
    });
});
