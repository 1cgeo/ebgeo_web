// Path: tests/unit/client-id-por-aba.test.js
//
// IDENTIDADE DE CLIENTE POR ABA.
//
// O id de cliente tem duas metades, `<instalacao>_<aba>`, e cada uma responde a uma pergunta
// diferente. A INSTALACAO (localStorage) e o que faz presenca, a graca `away` de 120 s do servidor
// e o de-dup de auto-eco sobreviverem a recarga e a reconexao. A ABA (sessionStorage) e o que
// impede duas abas de colapsarem numa entrada de presenca so.
//
// O composto e o que o servidor VE, e o servidor nao recusa id malformado: ele cunha outro em
// silencio (CLIENT_ID_RE em backend/src/modules/collab/collab.gateway.js), e a aba fica carimbando
// op com um id que a sala nao conhece. Por isso o formato e asserido aqui contra uma copia LITERAL
// do regex do servidor, e nao contra o predicado do proprio modulo.
//
// Uma "carga de pagina" e uma instancia nova do modulo (vi.resetModules + import), porque o id e
// memoizado no modulo. F5 = mesma aba, mesmo sessionStorage. Outra aba = outro sessionStorage.
// Aba DUPLICADA = outro documento com uma COPIA do sessionStorage da original, que e o caso que
// nao se resolve so com sessionStorage.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Copia literal de CLIENT_ID_RE (backend/src/modules/collab/collab.gateway.js). */
const REGEX_DO_SERVIDOR = /^[a-zA-Z0-9_-]{8,64}$/;

const GATEWAY = fileURLToPath(
    new URL('../../../backend/src/modules/collab/collab.gateway.js', import.meta.url)
);

/** Storage falso, com o mapa exposto para inspecao e copia. */
function makeStorage(seed = {}) {
    const data = { ...seed };
    return {
        data,
        getItem: (k) => (k in data ? data[k] : null),
        setItem: (k, v) => { data[k] = String(v); },
        removeItem: (k) => { delete data[k]; },
        clear: () => { for (const k of Object.keys(data)) delete data[k]; },
    };
}

/** Janela falsa: captura os listeners para o teste poder disparar `pagehide`/`pageshow`. */
function makeWindow() {
    const handlers = {};
    return {
        handlers,
        addEventListener: (type, fn) => { (handlers[type] ||= []).push(fn); },
        removeEventListener: (type, fn) => {
            handlers[type] = (handlers[type] || []).filter((h) => h !== fn);
        },
        fire: (type) => { for (const h of handlers[type] || []) h(); },
    };
}

/**
 * Carrega o modulo como um documento novo carregaria: memo zerado, storages dados.
 *
 * `view` e a janela do documento; passar `null` e o caminho degradado sem documento (Node,
 * worker), onde nao ha `pagehide` para soltar a reivindicacao. `session` nulo e o outro caminho
 * degradado, o de storage indisponivel (modo privado, iframe sandbox).
 *
 * Devolve tambem `fechar()`, que dispara o `pagehide` que o navegador dispara ao sair da pagina,
 * inclusive numa recarga. Essa e a unica coisa que separa RECARGA de DUPLICACAO: os dois
 * documentos comecam com uma copia do mesmo sessionStorage.
 */
async function carregarAba({ local, session, view = makeWindow() }) {
    vi.resetModules();
    Object.defineProperty(globalThis, 'localStorage', { value: local, configurable: true });
    Object.defineProperty(globalThis, 'sessionStorage', { value: session || undefined, configurable: true });
    Object.defineProperty(globalThis, 'window', { value: view || undefined, configurable: true });
    const mod = await import('../../src/js/store/sync/operation-factory.js');
    return { ...mod, view, fechar: () => view?.fire('pagehide') };
}

let localStorageFalso;

beforeEach(() => {
    // Sem relogio falso cada aba carregada deixa um setInterval real de heartbeat para tras:
    // `vi.resetModules()` cria uma instancia nova do modulo e a antiga nao tem mais quem a limpe.
    vi.useFakeTimers();
    localStorageFalso = makeStorage();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('formato: o composto tem de passar pelo regex do servidor', () => {
    it('a copia do regex nao saiu de sincronia com o servidor', () => {
        // O servidor nao recusa id malformado, cunha outro em silencio. Se o regex de la mudar
        // e este arquivo continuar afirmando o antigo, o resto desta suite passa a provar nada.
        const fonte = readFileSync(GATEWAY, 'utf8');
        const declarado = fonte.match(/const CLIENT_ID_RE = (\/.*\/);/)?.[1];
        expect(declarado).toBe(String(REGEX_DO_SERVIDOR));
    });

    it('o id vale para o servidor, e as duas metades sao recuperaveis', async () => {
        const mod = await carregarAba({ local: localStorageFalso, session: makeStorage() });
        const id = mod.getClientId();

        expect(id).toMatch(REGEX_DO_SERVIDOR);
        expect(id.length).toBeGreaterThanOrEqual(8);
        expect(id.length).toBeLessThanOrEqual(64);
        // A instalacao e o UUID persistido, e o separador e recuperavel.
        expect(mod.clientIdInstallation(id)).toBe(localStorageFalso.getItem('ebgeo_client_id'));
        expect(id.startsWith(`${mod.clientIdInstallation(id)}_`)).toBe(true);
    });

    it('borda de comprimento: UUID de 36 + sufixo cabe nos 64 com folga, e o teto e respeitado', async () => {
        const mod = await carregarAba({ local: localStorageFalso, session: makeStorage() });
        const id = mod.getClientId();
        const instalacao = mod.clientIdInstallation(id);

        expect(instalacao).toHaveLength(36); // generateUUID
        expect(id.length).toBe(36 + 1 + 12);
        expect(id.length).toBeLessThan(64);
    });

    it('borda de comprimento: instalacao herdada LONGA demais e trocada, nunca emitida invalida', async () => {
        // 60 chars: valido sozinho, mas 60 + 1 + 12 = 73 estoura os 64 do servidor, que descartaria
        // o id em silencio e usaria outro.
        const longa = 'a'.repeat(60);
        localStorageFalso.setItem('ebgeo_client_id', longa);

        const mod = await carregarAba({ local: localStorageFalso, session: makeStorage() });
        const id = mod.getClientId();

        expect(id).toMatch(REGEX_DO_SERVIDOR);
        expect(id.startsWith(longa)).toBe(false);
        expect(localStorageFalso.getItem('ebgeo_client_id')).not.toBe(longa);
    });

    it('instalacao herdada curta, mas valida, e MANTIDA (nada gira sem motivo)', async () => {
        // Girar a instalacao a toa quebraria justamente o que ela existe para segurar: a
        // continuidade de presenca e o de-dup de auto-eco entre recargas.
        const local = makeStorage({ ebgeo_client_id: 'curto' });
        const mod = await carregarAba({ local, session: makeStorage() });
        const id = mod.getClientId();

        expect(mod.clientIdInstallation(id)).toBe('curto');
        expect(id).toMatch(REGEX_DO_SERVIDOR);
    });

    it('instalacao herdada com caractere fora do alfabeto, ou com o separador, e trocada', async () => {
        for (const ruim of ['tem.ponto', 'tem+mais', 'tem_separador', 'tem espaco']) {
            const local = makeStorage({ ebgeo_client_id: ruim });
            const mod = await carregarAba({ local, session: makeStorage() });
            const id = mod.getClientId();

            expect(id).toMatch(REGEX_DO_SERVIDOR);
            expect(mod.clientIdInstallation(id)).not.toBe(ruim);
            expect(mod.isValidClientId(id)).toBe(true);
        }
    });

    it('isValidClientId recusa o que o servidor recusa', async () => {
        const mod = await carregarAba({ local: localStorageFalso, session: makeStorage() });
        expect(mod.isValidClientId('a'.repeat(8))).toBe(true);
        expect(mod.isValidClientId('a'.repeat(64))).toBe(true);
        expect(mod.isValidClientId('a'.repeat(7))).toBe(false);
        expect(mod.isValidClientId('a'.repeat(65))).toBe(false);
        expect(mod.isValidClientId('com.ponto.aqui')).toBe(false);
        expect(mod.isValidClientId('com espaco aqui')).toBe(false);
        expect(mod.isValidClientId(null)).toBe(false);
    });
});

describe('estabilidade sob F5 e distincao entre abas', () => {
    it('F5 na MESMA aba devolve o MESMO id (as duas metades sobrevivem)', async () => {
        const session = makeStorage();
        const primeira = await carregarAba({ local: localStorageFalso, session });
        const antes = primeira.getClientId();

        // Recarga: o documento antigo sai (pagehide) e o novo entra com os mesmos storages.
        primeira.fechar();
        const depois = await carregarAba({ local: localStorageFalso, session });

        expect(depois.getClientId()).toBe(antes);
    });

    it('F5 seguido de F5: o id nao anda a cada recarga', async () => {
        const session = makeStorage();
        let aba = await carregarAba({ local: localStorageFalso, session });
        const id = aba.getClientId();

        for (let i = 0; i < 4; i += 1) {
            aba.fechar();
            aba = await carregarAba({ local: localStorageFalso, session });
            expect(aba.getClientId()).toBe(id);
        }
    });

    it('duas ABAS dividem a instalacao e diferem no sufixo', async () => {
        const abaA = await carregarAba({ local: localStorageFalso, session: makeStorage() });
        const idA = abaA.getClientId();
        const abaB = await carregarAba({ local: localStorageFalso, session: makeStorage() });
        const idB = abaB.getClientId();

        expect(idB).not.toBe(idA);
        expect(abaB.clientIdInstallation(idB)).toBe(abaA.clientIdInstallation(idA));
        expect(idB).toMatch(REGEX_DO_SERVIDOR);
    });

    it('a instalacao NAO gira: e a mesma depois de abrir outra aba e recarregar', async () => {
        const session = makeStorage();
        const a = await carregarAba({ local: localStorageFalso, session });
        const instalacao = a.clientIdInstallation(a.getClientId());

        await carregarAba({ local: localStorageFalso, session: makeStorage() });
        a.fechar();
        const volta = await carregarAba({ local: localStorageFalso, session });

        expect(volta.clientIdInstallation(volta.getClientId())).toBe(instalacao);
    });
});

describe('aba DUPLICADA (herda o sessionStorage da original)', () => {
    it('a copia cunha outro sufixo, porque a reivindicacao da original esta viva', async () => {
        const sessionOriginal = makeStorage();
        const original = await carregarAba({ local: localStorageFalso, session: sessionOriginal });
        const idOriginal = original.getClientId();

        // "Duplicar aba" copia o sessionStorage inteiro; a original continua aberta.
        const sessionCopiado = makeStorage({ ...sessionOriginal.data });
        expect(sessionCopiado.getItem('ebgeo_tab_id')).toBe(sessionOriginal.getItem('ebgeo_tab_id'));

        const copia = await carregarAba({ local: localStorageFalso, session: sessionCopiado });
        const idCopia = copia.getClientId();

        expect(idCopia).not.toBe(idOriginal);
        expect(idCopia).toMatch(REGEX_DO_SERVIDOR);
        // E a copia grava o sufixo novo, entao o F5 DELA tambem e estavel.
        expect(sessionCopiado.getItem('ebgeo_tab_id')).not.toBe(sessionOriginal.getItem('ebgeo_tab_id'));
        copia.fechar();
        const recarga = await carregarAba({ local: localStorageFalso, session: sessionCopiado });
        expect(recarga.getClientId()).toBe(idCopia);
    });

    it('a original continua com o SEU id depois de ser duplicada', async () => {
        const sessionOriginal = makeStorage();
        const original = await carregarAba({ local: localStorageFalso, session: sessionOriginal });
        const idOriginal = original.getClientId();

        await carregarAba({ local: localStorageFalso, session: makeStorage({ ...sessionOriginal.data }) });

        expect(original.getClientId()).toBe(idOriginal);
        expect(sessionOriginal.getItem('ebgeo_tab_id')).toBe(idOriginal.split('_')[1]);
    });

    it('o heartbeat da original mantem a reivindicacao viva enquanto ela existir', async () => {
        const sessionOriginal = makeStorage();
        const original = await carregarAba({ local: localStorageFalso, session: sessionOriginal });
        const idOriginal = original.getClientId();
        const sufixo = sessionOriginal.getItem('ebgeo_tab_id');

        // Muito depois da janela de frescor, mas com a original viva e batendo.
        await vi.advanceTimersByTimeAsync(20 * 60 * 1000);
        expect(JSON.parse(localStorageFalso.getItem('ebgeo_tab_claims'))[sufixo]).toBe(Date.now());

        const copia = await carregarAba({
            local: localStorageFalso,
            session: makeStorage({ ...sessionOriginal.data }),
        });
        expect(copia.getClientId()).not.toBe(idOriginal);
    });

    it('reivindicacao ANTIGA (aba morta sem pagehide) nao rouba o sufixo de volta pra sempre', async () => {
        const session = makeStorage({ ebgeo_tab_id: 'sufixoconhecido' });
        // Uma reivindicacao velha demais para pertencer a um documento vivo.
        localStorageFalso.setItem(
            'ebgeo_tab_claims',
            JSON.stringify({ sufixoconhecido: Date.now() - 6 * 60 * 1000 })
        );

        const mod = await carregarAba({ local: localStorageFalso, session });

        expect(mod.getClientId().endsWith('_sufixoconhecido')).toBe(true);
    });

    it('a reivindicacao e escrita ja na resolucao do id, mesmo sem documento (Node)', async () => {
        const session = makeStorage();
        const mod = await carregarAba({ local: localStorageFalso, session, view: null });
        mod.getClientId();
        const sufixo = session.getItem('ebgeo_tab_id');

        const claims = JSON.parse(localStorageFalso.getItem('ebgeo_tab_claims'));
        expect(Object.keys(claims)).toEqual([sufixo]);
        expect(claims[sufixo]).toBe(Date.now());
    });

    it('QUEDA sem pagehide custa o sufixo, e so ele: a instalacao segue', async () => {
        // O preco documentado do desenho. Sem `pagehide` a reivindicacao fica para tras e a aba
        // volta como cliente novo. A metade que o de-dup de auto-eco usa nao se mexe.
        const session = makeStorage();
        const antes = await carregarAba({ local: localStorageFalso, session });
        const idAntes = antes.getClientId();

        const depois = await carregarAba({ local: localStorageFalso, session }); // sem fechar()
        const idDepois = depois.getClientId();

        expect(idDepois).not.toBe(idAntes);
        expect(depois.clientIdInstallation(idDepois)).toBe(depois.clientIdInstallation(idAntes));
    });
});

describe('caminho degradado: sem sessionStorage', () => {
    it('ainda produz id valido, e cada carga e um cliente NOVO (documentado, nao fingido)', async () => {
        const a = await carregarAba({ local: localStorageFalso, session: null });
        const idA = a.getClientId();
        const b = await carregarAba({ local: localStorageFalso, session: null });
        const idB = b.getClientId();

        expect(idA).toMatch(REGEX_DO_SERVIDOR);
        expect(idB).toMatch(REGEX_DO_SERVIDOR);
        expect(idB).not.toBe(idA);
        // A instalacao continua estavel, que e o que segura o de-dup de auto-eco.
        expect(b.clientIdInstallation(idB)).toBe(a.clientIdInstallation(idA));
    });
});

describe('clientIdInstallation: o que o filtro de auto-eco pergunta', () => {
    it('id sem separador (build antiga, op enfileirada antes) e a propria instalacao', async () => {
        const mod = await carregarAba({ local: localStorageFalso, session: makeStorage() });
        expect(mod.clientIdInstallation('uuid-de-antigamente')).toBe('uuid-de-antigamente');
        expect(mod.clientIdInstallation('inst_aba')).toBe('inst');
        expect(mod.clientIdInstallation('')).toBeNull();
        expect(mod.clientIdInstallation(null)).toBeNull();
        expect(mod.clientIdInstallation(undefined)).toBeNull();
    });

    it('op de OUTRA instalacao nao e confundida com a propria', async () => {
        const mod = await carregarAba({ local: localStorageFalso, session: makeStorage() });
        const meu = mod.getClientId();
        expect(mod.clientIdInstallation('outra-instalacao_aba1'))
            .not.toBe(mod.clientIdInstallation(meu));
    });
});

describe('resetClientId', () => {
    it('zera memo, metades e reivindicacoes', async () => {
        const session = makeStorage();
        const mod = await carregarAba({ local: localStorageFalso, session });
        const id = mod.getClientId();

        mod.resetClientId();

        expect(localStorageFalso.getItem('ebgeo_client_id')).toBeNull();
        expect(localStorageFalso.getItem('ebgeo_tab_claims')).toBeNull();
        expect(session.getItem('ebgeo_tab_id')).toBeNull();
        expect(mod.getClientId()).not.toBe(id);
    });
});
