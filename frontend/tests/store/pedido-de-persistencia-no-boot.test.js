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
// Três estados e não dois, e a diferença importa para o suporte: `sim` (a origem é persistente),
// `nao` (o navegador recusou, que é um estado NORMAL, porque a permissão é concedida por
// heurística e não por diálogo) e `indisponivel` (a API não existe ou lançou, e nada se sabe).
// Confundir `nao` com `indisponivel` faria o suporte ler recusa onde há motor sem a API.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/** Um grafo de módulos NOVO: o desfecho é estado de módulo. */
async function carregarModulos() {
    vi.resetModules();
    const [persistencia, adocao] = await Promise.all([
        import('@store/storage-persistence.js'),
        import('@store/migration/boot-legacy-adoption.js')
    ]);
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
