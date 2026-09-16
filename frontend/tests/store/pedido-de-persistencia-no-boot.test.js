// Path: tests/store/pedido-de-persistencia-no-boot.test.js
//
// O BOOT PEDE ARMAZENAMENTO PERSISTENTE, E O DESFECHO SAI NA LINHA DE BOOT DO ATLAS.
//
// Sem `navigator.storage.persist()` o grupo de origem do EBGeo é *best-effort*: sob pressão de
// disco o navegador despeja a origem INTEIRA, não o banco menos usado, e para quem acabou de
// atravessar isso é o acervo de 14 mapas e 149 imagens mais os slots com sufixo indo embora de
// uma vez, sem gesto do usuário, sem linha no console e sem nada na tela. Medido em 2026-09-07:
// `grep` por `navigator.storage`, `persist(`, `persisted()` e `estimate()` devolvia ZERO nas duas
// linhas do produto.
//
// QUATRO estados e não dois, e a diferença importa para o suporte: `sim` (a origem é
// persistente), `nao` (o navegador recusou, que é um estado NORMAL no Chromium, onde a permissão
// é concedida por heurística), `indisponivel` (a API não existe ou lançou, e nada se sabe) e
// `pendente` (o navegador abriu DIÁLOGO e ninguém respondeu dentro do prazo). Confundir `nao`
// com `indisponivel` faria o suporte ler recusa onde há motor sem a API.
//
// O QUARTO NASCEU DE UM DEFEITO MEDIDO NO FIREFOX (2026-09-15). "Concedida por heurística e não
// por diálogo" é verdade no Chromium e FALSA no Firefox, onde `persist()` abre a tarja de
// permissão e a promessa fica pendente até alguém responder. Com o boot AGUARDANDO este pedido,
// o mapa nunca montava: sem erro, sem console, sem tela de indisponível. O `try/catch` do módulo
// cobria a promessa que REJEITA e não a que NUNCA SE RESOLVE, e as duas custam coisas
// diferentes: a primeira custa um estado, a segunda custa a página.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/** Um grafo de módulos NOVO: o desfecho é estado de módulo. */
async function carregarModulos() {
    vi.resetModules();
    // IMPORTAÇÕES SEQUENCIAIS, E ISSO NÃO É ESTILO. Com `Promise.all` logo depois de
    // `vi.resetModules()`, as resoluções correm contra o re-registro do mock de
    // `localforage` no grafo novo, e de vez em quando um módulo pega o localforage REAL.
    // Como o setup global instala `fake-indexeddb`, esse caminho não falha: ele funciona
    // contra um banco de verdade que SOBREVIVE entre os testes do arquivo, e o teste passa
    // a medir o que um teste anterior deixou. Diagnosticado em 2026-09-11 no
    // `store-schema-migration-v3.0.test.js`, que reprovava em 2 de 3 rodadas da suíte e
    // passava sempre isolado; a prova foi a loja em uso não ter o `__backing` do duplo.
    const persistencia = await import('@store/storage-persistence.js');
    const adocao = await import('@store/migration/boot-legacy-adoption.js');
    return { persistencia, adocao };
}

/**
 * Um `navigator.storage` de mentira nos estados que o teste precisa.
 * @param {{persisted?: *, persist?: *}} respostas - Valores ou funções que lançam.
 * @returns {{persisted: Function, persist: Function}}
 */
function storageDublado(respostas) {
    return {
        persisted: vi.fn(async () => {
            if (typeof respostas.persisted === 'function') return respostas.persisted();
            return respostas.persisted;
        }),
        persist: vi.fn(async () => {
            if (typeof respostas.persist === 'function') return respostas.persist();
            return respostas.persist;
        })
    };
}

beforeEach(() => {
    vi.restoreAllMocks();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

// ============================================================================
// O módulo folha, nos três estados
// ============================================================================

describe('B4-7: pedirPersistencia nos três estados', () => {
    it('já concedido responde sim e NÃO repede', async () => {
        // `persisted()` antes de `persist()`: o que já está concedido não se repede, e uma
        // segunda chamada seria trabalho por nada em todo boot de todo usuário.
        const storage = storageDublado({ persisted: true, persist: true });
        vi.stubGlobal('navigator', { storage });
        const { persistencia } = await carregarModulos();

        const desfecho = await persistencia.pedirPersistencia();

        expect({ desfecho, pediu: storage.persist.mock.calls.length }).toEqual({
            desfecho: 'sim', pediu: 0
        });
    });

    it('não concedido e concedido no pedido responde sim', async () => {
        const storage = storageDublado({ persisted: false, persist: true });
        vi.stubGlobal('navigator', { storage });
        const { persistencia } = await carregarModulos();

        const desfecho = await persistencia.pedirPersistencia();

        expect({ desfecho, pediu: storage.persist.mock.calls.length }).toEqual({
            desfecho: 'sim', pediu: 1
        });
    });

    it('recusado responde nao, que é um estado normal e não um erro', async () => {
        const storage = storageDublado({ persisted: false, persist: false });
        vi.stubGlobal('navigator', { storage });
        const { persistencia } = await carregarModulos();

        expect(await persistencia.pedirPersistencia()).toBe('nao');
    });

    it('motor sem a API responde indisponivel, sem lançar', async () => {
        vi.stubGlobal('navigator', {});
        const { persistencia } = await carregarModulos();

        expect(await persistencia.pedirPersistencia()).toBe('indisponivel');
    });

    it('uma promessa que NUNCA se resolve vira pendente e devolve dentro do prazo', async () => {
        // O REPRO DO FIREFOX, em node: `persist()` que fica pendente para sempre é a tarja de
        // permissão que ninguém respondeu. O que se afirma aqui é o que o boot precisa: a função
        // VOLTA, e volta dizendo que não sabe, em vez de segurar a página para sempre.
        vi.stubGlobal('navigator', {
            storage: {
                persisted: vi.fn(async () => false),
                persist: vi.fn(() => new Promise(() => {}))
            }
        });
        const { persistencia } = await carregarModulos();

        const inicio = Date.now();
        const desfecho = await persistencia.pedirPersistencia({ prazoMs: 30 });

        expect(desfecho).toBe('pendente');
        expect(Date.now() - inicio, 'voltou dentro do prazo, e não ficou pendurada').toBeLessThan(2000);
        expect(persistencia.desfechoDaPersistencia()).toBe('pendente');
    });

    it('a resposta TARDIA corrige o desfecho guardado, em vez de se perder', async () => {
        // Quem concede é o navegador, não esta função: se a pessoa responder depois do prazo, a
        // origem VIRA persistente e a linha de boot não pode continuar dizendo `pendente`.
        let responder = null;
        vi.stubGlobal('navigator', {
            storage: {
                persisted: vi.fn(async () => false),
                persist: vi.fn(() => new Promise((r) => { responder = r; }))
            }
        });
        const { persistencia } = await carregarModulos();

        expect(await persistencia.pedirPersistencia({ prazoMs: 20 })).toBe('pendente');
        responder(true);
        await new Promise((r) => setTimeout(r, 10));

        expect(persistencia.desfechoDaPersistencia()).toBe('sim');
    });

    it('CONTROLE: o prazo não trunca quem responde a tempo', async () => {
        // Sem este caso, um prazo de zero passaria os dois casos acima e transformaria TODO boot
        // em `pendente`, isto é, o conserto viraria a perda da medição que ele deveria preservar.
        vi.stubGlobal('navigator', { storage: storageDublado({ persisted: false, persist: true }) });
        const { persistencia } = await carregarModulos();

        expect(await persistencia.pedirPersistencia({ prazoMs: 5000 })).toBe('sim');
    });

    it('uma promessa que REJEITA vira indisponivel e não custa o boot', async () => {
        // O insumo degenerado do módulo: sem ele o `try/catch` não estaria provado, e uma
        // rejeição aqui derrubaria a carga da página por causa de um pedido opcional.
        vi.stubGlobal('navigator', {
            storage: storageDublado({
                persisted: () => { throw new Error('SecurityError'); },
                persist: true
            })
        });
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { persistencia } = await carregarModulos();

        expect(await persistencia.pedirPersistencia()).toBe('indisponivel');
    });
});

// ============================================================================
// A linha de boot
// ============================================================================

describe('B4-7: o desfecho na linha de boot do atlas', () => {
    it('a linha diz persistente: nao quando o navegador recusou', async () => {
        // A linha do boot é a ÚNICA que o suporte tem para confirmar a travessia. Saber que o
        // esquema andou e não saber se o navegador pode despejar o acervo amanhã é meia resposta.
        vi.stubGlobal('navigator', { storage: storageDublado({ persisted: false, persist: false }) });
        const linhas = [];
        vi.spyOn(console, 'info').mockImplementation((...args) => {
            if (typeof args[0] === 'string') linhas.push(args[0]);
        });
        const { persistencia, adocao } = await carregarModulos();

        await persistencia.pedirPersistencia();
        const linha = await adocao.reportBootAtlasScope();

        expect(linha).toContain('persistente: nao');
        expect(linhas).toContain(linha);
    });

    it('e diz persistente: sim quando a origem é persistente', async () => {
        vi.stubGlobal('navigator', { storage: storageDublado({ persisted: true, persist: true }) });
        vi.spyOn(console, 'info').mockImplementation(() => {});
        const { persistencia, adocao } = await carregarModulos();

        await persistencia.pedirPersistencia();

        expect(await adocao.reportBootAtlasScope()).toContain('persistente: sim');
    });

    it('CONTROLE: a página que nunca pediu não ganha o campo, que é diferente de recusado', async () => {
        // `atlas.html`, um script ou um teste não pedem persistência. A linha omite o campo em
        // vez de afirmar um estado que ninguém mediu, que é a mesma regra do resto dela.
        vi.stubGlobal('navigator', { storage: storageDublado({ persisted: false, persist: false }) });
        vi.spyOn(console, 'info').mockImplementation(() => {});
        const { adocao } = await carregarModulos();

        expect(await adocao.reportBootAtlasScope()).not.toContain('persistente');
    });
});
