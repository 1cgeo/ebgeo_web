// Path: tests/unit/criar-atlas-local-abre.test.js

/**
 * @fileoverview "+ Novo atlas local" CRIA E ABRE, em vez de criar e voltar para a lista.
 *
 * O ESTADO ANTERIOR ERA UM MEIO GESTO. Quem clica em "Novo atlas local" quer trabalhar no atlas
 * novo, e a página devolvia a mesma lista com um cartão a mais. O segundo clique ("Abrir") era
 * obrigatório e não decidia nada.
 *
 * O QUE PODE MENTIR AQUI É A NAVEGAÇÃO, nunca a criação. `createLocalAtlas` RECUSA o décimo
 * primeiro slot (teto de dez, `LocalAtlasError.LIMIT_REACHED`), e uma recusa é um resultado
 * legítimo, não uma exceção. Um "criar e abrir" escrito como duas linhas em sequência navega em
 * cima da recusa: a pessoa pediu um atlas, não recebeu nenhum, e a página a manda para o mapa —
 * que abre o atlas ANTERIOR, com a frase da recusa morta junto com a página que a desenhou. É o
 * mesmo modo de falha que `sendToServerNotice` já paga com `openAtlasId: null`.
 *
 * POR ISSO A DECISÃO É PURA E MORA EM `local-atlas-notices.js`. `createdAtlasToOpen` responde
 * "para qual atlas local ir depois desta criação", e responde `null` para tudo que não seja um
 * sucesso com id utilizável. `projects-page.js` boota no import e não pode ser carregado por um
 * teste de node, então a fiação é lida da fonte — leitura de fonte prova que a linha existe, nunca
 * que ela roda, e é por isso que a metade que decide está fora dela.
 *
 * O TETO É EXERCITADO CONTRA A API DE VERDADE, sobre um disco falso, como faz
 * `atlas-local-recusa-chega-ao-usuario.test.js`: uma recusa dublada seria este arquivo conferindo
 * a própria expectativa.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
    NoticeKind,
    createNotice,
    createdAtlasToOpen,
} from '@js/projects/local-atlas-notices.js';

// ============================================================================
// Disco falso, keyed por nome de banco. Cópia do dublê de
// `atlas-local-recusa-chega-ao-usuario.test.js`, pelo mesmo motivo: a metade 2 deste arquivo roda
// a API DE VERDADE, e é dela que a recusa do teto tem de vir.
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
            clear: vi.fn(async () => { backing.clear(); }),
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
        }),
    },
}));

// O aviso entre abas abriria um BroadcastChannel e esperaria por pares que não existem aqui.
vi.mock('@utils/tab-lock.js', async (importOriginal) => ({
    ...(await importOriginal()),
    announceTabLockTeardown: vi.fn(async () => ({ peers: 0, acked: 0, frozen: 0 })),
}));

const PAGINA = readFileSync(
    fileURLToPath(new URL('../../src/js/projects/projects-page.js', import.meta.url)), 'utf8',
);

let api;

beforeEach(async () => {
    vi.resetModules();
    resetFake();
    api = await import('@store/local-atlas.api.js');
    const errors = await import('@store/store-errors.js');
    errors.setStoreErrorEventBus({ emit: vi.fn() });
    await api.initLocalAtlases();
});

// ============================================================================
// 1 — a decisão pura: para onde ir depois de criar
// ============================================================================

describe('1 — `createdAtlasToOpen`, a decisão de navegar', () => {
    it('sucesso: devolve o id do atlas RECÉM-CRIADO', () => {
        expect(createdAtlasToOpen({ ok: true, atlas: { id: 'abc-123', name: 'Alfa' } }))
            .toBe('abc-123');
    });

    it('recusa: não manda ninguém para lugar nenhum', () => {
        for (const recusa of [
            { ok: false, error: 'limit_reached', message: 'Limite de 10 atlas locais...' },
            { ok: false, error: 'not_found' },
        ]) {
            expect(createdAtlasToOpen(recusa)).toBeNull();
        }
    });

    it('FALHA FECHADO: sucesso sem id utilizável também fica na lista', () => {
        // O modo de errar é barato e silencioso: `setCurrentLocalAtlas(undefined)` recusa com
        // NOT_FOUND, e a pessoa veria "Atlas criado." seguido de "atlas não encontrado".
        for (const meio of [
            { ok: true },
            { ok: true, atlas: {} },
            { ok: true, atlas: { id: '' } },
            { ok: true, atlas: { id: '   ' } },
            { ok: true, atlas: { id: 42 } },
            { ok: true, atlas: { id: null } },
        ]) {
            expect(createdAtlasToOpen(meio), JSON.stringify(meio)).toBeNull();
        }
    });

    it('resultado que nem objeto é vira `null`, nunca exceção', () => {
        for (const entrada of [null, undefined, {}, 'criado', 42, []]) {
            expect(createdAtlasToOpen(entrada), JSON.stringify(entrada)).toBeNull();
        }
    });
});

// ============================================================================
// 2 — o teto de dez, medido contra a API de verdade
// ============================================================================

describe('2 — a recusa do teto não vira navegação', () => {
    it('o décimo primeiro "Criar" recusa, diz por que, e NÃO abre nada', async () => {
        for (let i = 2; i <= api.MAX_LOCAL_ATLASES; i += 1) {
            expect((await api.createLocalAtlas(`Atlas ${i}`)).ok).toBe(true);
        }
        const recusa = await api.createLocalAtlas('Atlas 11');
        expect(recusa.error).toBe(api.LocalAtlasError.LIMIT_REACHED);

        // A frase continua chegando...
        expect(createNotice(recusa).kind).toBe(NoticeKind.ERROR);
        expect(createNotice(recusa).message).toContain('Limite de 10 atlas locais');
        // ...e a página fica onde está para que ela possa ser lida.
        expect(createdAtlasToOpen(recusa)).toBeNull();
    });

    it('CONTROLE POSITIVO: a criação que dá certo abre o atlas que ela criou', async () => {
        // Sem este par, um `createdAtlasToOpen` que devolvesse `null` sempre passaria no caso
        // acima e apagaria o pedido inteiro.
        const criado = await api.createLocalAtlas('Operação Alfa');
        expect(criado.ok).toBe(true);
        expect(createdAtlasToOpen(criado)).toBe(criado.atlas.id);
        // E o alvo é o NOVO, nunca o que estava apontado antes.
        expect(createdAtlasToOpen(criado)).not.toBe(api.listLocalAtlases()[0].id);
    });
});

// ============================================================================
// 3 — a fiação da página (lida da fonte: `projects-page.js` boota no import)
// ============================================================================

describe('3 — "+ Novo atlas local" abre o atlas que acabou de criar', () => {
    /** O corpo de `createLocalAtlasFromPage`, recortado da fonte. */
    const corpo = (() => {
        const inicio = PAGINA.indexOf('async function createLocalAtlasFromPage()');
        expect(inicio, 'a função sumiu ou foi renomeada').toBeGreaterThan(-1);
        return PAGINA.slice(inicio, PAGINA.indexOf('\n}', inicio));
    })();

    it('CONTROLE DO RECORTE: o corpo lido é mesmo o da criação', () => {
        // Sem isto, um `indexOf` que casasse um trecho vazio faria tudo abaixo passar provando
        // nada.
        expect(corpo).toContain('createLocalAtlas(name)');
        expect(corpo).toContain('createNotice(');
    });

    it('a criação bem-sucedida NAVEGA, pelo mesmo caminho do botão "Abrir"', () => {
        expect(corpo).toContain('openLocalAtlas(');
    });

    it('e a navegação está ATRÁS da decisão pura, nunca solta em sequência', () => {
        // A forma que apaga o achado: `tell(...); openLocalAtlas(result.atlas);` — que navega em
        // cima da recusa do teto. A ordem no texto é o que distingue as duas.
        const decide = corpo.indexOf('createdAtlasToOpen(');
        expect(decide, 'a decisão pura não é consultada aqui').toBeGreaterThan(-1);
        expect(corpo.indexOf('openLocalAtlas(')).toBeGreaterThan(decide);
    });

    it('o diálogo cancelado continua não fazendo nada', () => {
        // `askAtlasName` devolve `null` para cancelar E para nome vazio. Perder esta linha faria
        // um cancelamento chamar a API com nome vazio, que ela trata como bug do chamador
        // (lança).
        expect(corpo).toContain('if (name === null) return;');
    });

    it('a página não passa a MONTAR nada por conta própria', () => {
        // O medo legítimo: `loadLocalAtlases` devolve o lock de montagem de propósito
        // (`clearActiveScope`), e um caminho novo que montasse aqui deixaria a página contada
        // como "outro cliente tem este atlas aberto". Criar-e-abrir reusa `openLocalAtlas`, então
        // ele segura exatamente o que "Abrir" já segurava: nada a mais.
        expect(corpo).not.toContain('mountLocalAtlas(');
        expect(corpo).not.toContain('activateScope(');
        expect(PAGINA).not.toContain('mountLocalAtlas');
    });

    it('CONTROLE NEGATIVO DO RECORTE: `openLocalAtlas` já existia no arquivo', () => {
        // "Achei `openLocalAtlas(` no corpo" só vale porque ele é uma função do arquivo, usada
        // por outro caminho (o clique no cartão). O recorte é que prova que ele passou a ser
        // usado AQUI.
        expect(PAGINA).toContain('async function openLocalAtlas(atlas)');
        expect(PAGINA).toContain('onOpen: (atlas) => openLocalAtlas(atlas)');
    });
});
