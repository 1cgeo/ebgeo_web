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
// O padrao vizinho em 3d_models_viewer_tool/map_3d.js:48 nao serve aqui, e o
// teste "duas chamadas concorrentes" e exatamente o que o reprova: ele resolve
// assim que existe um <script> com aquele src no DOM, o que e verdade desde o
// appendChild e muito antes de o arquivo ter executado.

import { test, describe, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert/strict';

import { ensureMilsymbol, resetMilsymbolLoader } from '@js/military_tools/military_symbol_tool/milsymbol-loader.js';

/** Scripts criados pelo carregador nesta execucao. */
let criados;
/** Controla se o "carregamento" define o global, e quando. */
let comportamento;

beforeEach(() => {
    criados = [];
    comportamento = { defineGlobal: true, falhar: false };
    delete globalThis.ms;
    resetMilsymbolLoader();

    globalThis.document = {
        head: {
            appendChild(script) {
                criados.push(script);
                // O navegador so dispara onload num tick posterior. Simular isso
                // e o que torna o teste de concorrencia possivel: as duas
                // chamadas acontecem ANTES de o primeiro load completar.
                setTimeout(() => {
                    if (comportamento.falhar) {
                        script.onerror(new Error('rede'));
                        return;
                    }
                    if (comportamento.defineGlobal) globalThis.ms = { Symbol: class {} };
                    script.onload();
                }, 5);
            },
        },
        createElement: () => ({ src: '', async: false, onload: null, onerror: null }),
    };
});

afterEach(() => {
    delete globalThis.document;
    delete globalThis.ms;
    resetMilsymbolLoader();
    vi.useRealTimers();
});

describe('ensureMilsymbol', () => {
    test('carrega o bundle e devolve o global', async () => {
        const ms = await ensureMilsymbol();
        assert.ok(ms);
        assert.equal(criados.length, 1);
        assert.equal(criados[0].src, '/vendors/milsymbol.min.js');
    });

    test('duas chamadas CONCORRENTES compartilham um unico carregamento', async () => {
        // O caso real: o usuario desenha um simbolo enquanto um snapshot remoto
        // chega e manda regenerar outro. Com o padrao do map_3d.js, a segunda
        // resolveria com `ms` ainda indefinido.
        const [a, b] = await Promise.all([ensureMilsymbol(), ensureMilsymbol()]);
        assert.equal(criados.length, 1, 'baixou o bundle duas vezes');
        assert.equal(a, b);
        assert.ok(globalThis.ms, 'resolveu antes de o global existir');
    });

    test('depois de carregado nao cria script nenhum', async () => {
        await ensureMilsymbol();
        await ensureMilsymbol();
        await ensureMilsymbol();
        assert.equal(criados.length, 1);
    });

    test('global ja presente resolve sem tocar no DOM', async () => {
        globalThis.ms = { Symbol: class {} };
        await ensureMilsymbol();
        assert.equal(criados.length, 0);
    });

    test('falha de rede rejeita, e a proxima tentativa REFAZ o carregamento', async () => {
        // A borda que separa um blip de rede de "simbolo militar morto pelo resto
        // da sessao": sem limpar o memo, todos herdariam a promessa rejeitada.
        comportamento.falhar = true;
        await assert.rejects(() => ensureMilsymbol(), /Falha ao carregar/);

        comportamento.falhar = false;
        const ms = await ensureMilsymbol();
        assert.ok(ms);
        assert.equal(criados.length, 2, 'nao tentou de novo depois da falha');
    });

    test('script que carrega SEM definir o global e erro, e nao sucesso silencioso', async () => {
        // Acontece de verdade: caminho errado servido como HTML pelo dev server
        // dispara onload normalmente. Resolver aqui devolveria `undefined` ao
        // gerador, que quebraria com "ms is not defined" longe da causa.
        comportamento.defineGlobal = false;
        await assert.rejects(() => ensureMilsymbol(), /carregou sem definir/);
    });
});
