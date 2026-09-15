// Path: tests/unit/milsymbol-loader.test.js
//
// O CARREGADOR SOB DEMANDA DO MILSYMBOL.
//
// Os 855 kB do milsymbol sairam do boot da pagina do mapa e passaram a ser
// carregados na primeira geracao de simbolo. A medicao que autorizou a troca foi
// feita com um Proxy sobre window.ms num navegador real: nada o le durante o
// boot, nem em F5 com simbolo ja na tela.
//
// O QUE ESTE ARQUIVO PRENDE, e por que nao e obvio. O risco da mudanca nao e o
// caminho feliz, e a CONCORRENCIA: `window.ms` tambem e lido por um caminho que
// nao e gesto de usuario (layers/layer_setup.js regenera o PNG do simbolo quando
// chega um snapshot de atlas remoto). Se duas chamadas dispararem juntas, as
// duas precisam esperar o MESMO carregamento.
//
// O MECANISMO MUDOU EM 2026-09-14, e este arquivo mudou com ele. Ate ali o
// carregador injetava uma tag <script> apontando `vendors/milsymbol.min.js`, e
// estes casos dirigiam um `document` falso contando `appendChild`. Agora a
// biblioteca vem do npm por `import('@js/vendor/milsymbol.js')`, entao o que se
// conta e a AVALIACAO do modulo, e o duplo de teste e um `vi.doMock` sobre o
// ponto unico. As propriedades cobradas sao as mesmas cinco; o que as produz e
// outro.
//
// POR QUE UM CARREGADOR NOVO EM CADA CASO (`montar`): tanto o memo do modulo
// quanto o registro do motor sobrevivem entre casos, entao sem `vi.resetModules()`
// o segundo caso nunca reavaliaria nada e o contador ficaria parado em 1. Um
// contador parado passa VERDE em "nao carrega duas vezes" sem ter carregado
// nenhuma.
//
// A BORDA QUE ESTE ARQUIVO MEDE EM VEZ DE AFIRMAR e a ultima: com tag <script>,
// limpar o memo na falha bastava para a tentativa seguinte refazer o download.
// Com `import()`, o registro do motor guarda o modulo que falhou ao AVALIAR, e a
// segunda tentativa pode receber o mesmo erro sem refazer nada. O caso final
// afirma o que de fato acontece, com o porque escrito nele.

import { test, describe, beforeEach, afterEach, expect, vi } from 'vitest';
import assert from 'node:assert/strict';

const CAMINHO_CARREGADOR = '@js/military_tools/military_symbol_tool/milsymbol-loader.js';

/**
 * Monta um carregador NOVO com um duplo NOVO do ponto unico.
 *
 * O duplo e do PONTO UNICO, e nao do pacote: e ele que o carregador importa, e e ele que publica
 * o global no produto. Mockar `milsymbol` deixaria o ponto unico real no meio e mediria duas
 * coisas de uma vez.
 *
 * `vi.doMock` e nao `vi.mock`, e a diferenca nao e estilo: a fabrica de `vi.mock` e icada e
 * MEMOIZADA para o arquivo inteiro, entao ela roda uma vez so e o contador de avaliacoes fica
 * parado em 1 para sempre. Um contador parado passa VERDE em "nao carrega duas vezes" sem ter
 * carregado nenhuma, que e a cobertura vazia que a constituicao nomeia. Foi assim que a primeira
 * versao deste arquivo reprovou tres casos de uma vez.
 *
 * @param {{falhar?: boolean, definirGlobal?: boolean}} [inicial]
 * @returns {Promise<Object>} o modulo do carregador mais o objeto de controle
 */
async function montar(inicial = {}) {
    const ctl = { avaliacoes: 0, falhar: false, definirGlobal: true, ...inicial };
    vi.resetModules();
    vi.doMock('@js/vendor/milsymbol.js', () => {
        ctl.avaliacoes += 1;
        if (ctl.falhar) throw new Error('Falha ao carregar o modulo');
        if (ctl.definirGlobal) globalThis.ms = { Symbol: class {} };
        return { default: globalThis.ms, ms: globalThis.ms };
    });
    const mod = await import(CAMINHO_CARREGADOR);
    return { ...mod, ctl };
}

beforeEach(() => {
    delete globalThis.ms;
});

afterEach(() => {
    delete globalThis.ms;
});

describe('ensureMilsymbol', () => {
    test('carrega a biblioteca e devolve o global', async () => {
        const { ensureMilsymbol, ctl } = await montar();
        const ms = await ensureMilsymbol();
        assert.ok(ms);
        assert.equal(ctl.avaliacoes, 1);
        assert.equal(ms, globalThis.ms);
    });

    test('duas chamadas CONCORRENTES compartilham um unico carregamento', async () => {
        // O caso real: o usuario desenha um simbolo enquanto um snapshot remoto
        // chega e manda regenerar outro. As duas precisam esperar a MESMA carga, e
        // nenhuma pode resolver antes de o global existir.
        const { ensureMilsymbol, ctl } = await montar();
        const [a, b] = await Promise.all([ensureMilsymbol(), ensureMilsymbol()]);
        assert.equal(ctl.avaliacoes, 1, 'avaliou o modulo duas vezes');
        assert.equal(a, b);
        assert.ok(globalThis.ms, 'resolveu antes de o global existir');
    });

    test('depois de carregado nao avalia o modulo de novo', async () => {
        const { ensureMilsymbol, ctl } = await montar();
        await ensureMilsymbol();
        await ensureMilsymbol();
        await ensureMilsymbol();
        assert.equal(ctl.avaliacoes, 1);
    });

    test('global ja presente resolve sem importar nada', async () => {
        const { ensureMilsymbol, ctl } = await montar();
        globalThis.ms = { Symbol: class {} };
        await ensureMilsymbol();
        assert.equal(ctl.avaliacoes, 0);
    });

    test('modulo que carrega SEM definir o global e erro, e nao sucesso silencioso', async () => {
        // Resolver aqui devolveria `undefined` ao gerador, que quebraria com
        // "ms is not defined" longe da causa.
        const { ensureMilsymbol } = await montar({ definirGlobal: false });
        await assert.rejects(() => ensureMilsymbol(), /carregou sem definir/);
    });

    test('falha rejeita e LIMPA o memo, para que a tentativa seguinte exista', async () => {
        // A borda que separa um blip de rede de "simbolo militar morto pelo resto
        // da sessao". O que esta linha garante e que a SEGUNDA CHAMADA acontece:
        // sem limpar o memo, ela herdaria a promessa rejeitada e nem tentaria.
        //
        // O QUE ELA NAO GARANTE, e por isso o caso nao afirma sucesso: com
        // `import()` o registro de modulos do motor guarda o modulo que falhou ao
        // AVALIAR, entao a reavaliacao pode nao acontecer e o mesmo erro pode
        // voltar. E uma diferenca real em relacao a tag <script>, que refazia o
        // download sempre, e ela esta declarada no `@fileoverview` do carregador.
        const { ensureMilsymbol, ctl } = await montar({ falhar: true });

        // A mensagem e conferida na CADEIA e nao so no topo: o vitest embrulha um
        // erro lancado dentro da fabrica do mock num erro proprio e pendura o
        // original em `cause`. Procurar so no topo reprovaria por artefato do
        // arreio, e afrouxar para "rejeitou" aceitaria qualquer erro, inclusive um
        // `TypeError` nosso.
        const erro = await ensureMilsymbol().then(() => null, (e) => e);
        assert.ok(erro, 'a carga que falha tem de rejeitar');
        const cadeia = [];
        for (let e = erro; e; e = e.cause) cadeia.push(String(e.message));
        assert.match(cadeia.join(' | '), /Falha ao carregar/);
        const apos1 = ctl.avaliacoes;

        ctl.falhar = false;
        await ensureMilsymbol().catch(() => {});

        // O memo limpo e o que faz a segunda chamada CHEGAR ao import; se ela
        // tivesse herdado a promessa rejeitada, nada seria reavaliado e este
        // numero ficaria igual ao anterior.
        expect(ctl.avaliacoes).toBeGreaterThan(apos1);
    });
});
