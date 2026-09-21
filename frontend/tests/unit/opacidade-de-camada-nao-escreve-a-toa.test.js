// Path: tests/unit/opacidade-de-camada-nao-escreve-a-toa.test.js
//
// `layers/layer-opacity-applier.js` NAO TINHA TESTE NENHUM, e ele escreve direto no estilo vivo
// do MapLibre. Este arquivo cobre as duas coisas que uma medicao de boot mudou ali, e a terceira
// que nao pode cair por causa delas.
//
// O QUE FOI MEDIDO, no pacote de producao servido de `dist/`, boot de visitante com IndexedDB
// vazio: `applyLayerOpacities` fazia 252 chamadas de `getPaintProperty`, das quais 209 LANCAVAM,
// e 43 chamadas de `setPaintProperty` cujo efeito era multiplicar tudo por 1. As duas sao
// desperdicio de naturezas diferentes:
//
//   1. o lance vinha de perguntar `fill-opacity` a uma camada de circulo. A propriedade de tinta
//      pertence ao TIPO da camada, e o tipo esta em `map.getLayer(id).type`, entao a pergunta
//      certa nunca lanca;
//   2. com toda opacidade valendo 1 o multiplicador e a identidade. Escrever `['*', X, 1]` troca a
//      expressao de tinta por outra equivalente, mais cara de avaliar por feicao a cada quadro.
//
// A TERCEIRA COISA E A QUE FAZ O ATALHO SER SEGURO, e e o unico jeito de ele estar errado: depois
// que UMA opacidade saiu de 1, voltar todas para 1 e uma RESTAURACAO, e restaurar exige escrever.
// Um atalho que so olhasse "todas em 1" engoliria essa volta e deixaria o mapa esmaecido para
// sempre. O ultimo caso deste arquivo e exatamente esse, e ele REPROVA a versao ingenua do atalho.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const camadasDaStore = { valor: [] };

vi.mock('../../src/js/store', () => ({
    getLayers: () => camadasDaStore.valor,
}));

const {
    applyLayerOpacities,
    invalidateOpacityCache,
    setRevealDimWindow,
} = await import('../../src/js/layers/layer-opacity-applier.js');
const { FEATURE_LAYER_IDS } = await import('../../src/js/layers/layer.constants.js');
const { buildTemporalOverlapFilter } = await import('../../src/js/layers/visibility-filter.js');

/** As propriedades de tinta que cada tipo REALMENTE aceita, para o dublê lançar como o MapLibre. */
const VALIDAS_POR_TIPO = {
    fill: new Set(['fill-opacity', 'fill-color', 'fill-pattern']),
    line: new Set(['line-opacity', 'line-color', 'line-width']),
    circle: new Set(['circle-opacity', 'circle-stroke-opacity', 'circle-color', 'circle-radius']),
    symbol: new Set(['text-opacity', 'icon-opacity', 'text-color']),
};

/**
 * Um mapa de mentira que se comporta como o MapLibre no ponto que importa: `getPaintProperty`
 * LANCA quando a propriedade nao pertence ao tipo da camada. Um dublê que devolvesse `undefined`
 * ali nao reprovaria a versao antiga, e o teste nao mediria nada.
 */
function mapaDublê(tipoPorId) {
    const chamadas = { getPaint: [], setPaint: [], lancou: 0 };
    return {
        chamadas,
        getLayer(id) {
            const type = tipoPorId[id];
            return type ? { id, type } : undefined;
        },
        getPaintProperty(id, prop) {
            chamadas.getPaint.push(`${id}:${prop}`);
            const type = tipoPorId[id];
            if (!VALIDAS_POR_TIPO[type]?.has(prop)) {
                chamadas.lancou += 1;
                throw new Error(`layer ${id} does not have paint property ${prop}`);
            }
            return prop.endsWith('-opacity') ? ['get', 'opacity'] : '#000';
        },
        setPaintProperty(id, prop, valor) {
            chamadas.setPaint.push({ id, prop, valor });
        },
    };
}

/** Um tipo plausivel para cada id real de `FEATURE_LAYER_IDS`, deduzido do sufixo. */
function tiposReais() {
    const out = {};
    for (const id of FEATURE_LAYER_IDS) {
        if (id.includes('-fill')) out[id] = 'fill';
        else if (id.includes('-label') || id.includes('text-layer') || id.includes('symbols') || id.includes('measures') || id.includes('declinations') || id === 'image-layer') out[id] = 'symbol';
        else if (id === 'point-layer' || id === 'boundary-circles-layer') out[id] = 'circle';
        else out[id] = 'line';
    }
    return out;
}

describe('applyLayerOpacities', () => {
    beforeEach(() => {
        invalidateOpacityCache();
        camadasDaStore.valor = [];
    });

    it('nunca pergunta uma propriedade de tinta que o tipo da camada nao tem', () => {
        camadasDaStore.valor = [{ id: 'a', opacity: 0.5 }];
        const mapa = mapaDublê(tiposReais());

        applyLayerOpacities(mapa);

        expect(mapa.chamadas.lancou).toBe(0);
        // CONTROLE DE VACUO: um caminhador que nao perguntasse nada tambem daria zero lances.
        expect(mapa.chamadas.getPaint.length).toBeGreaterThan(FEATURE_LAYER_IDS.length / 2);
        expect(mapa.chamadas.setPaint.length).toBeGreaterThan(FEATURE_LAYER_IDS.length / 2);
    });

    it('nao escreve tinta nenhuma quando toda opacidade vale 1', () => {
        camadasDaStore.valor = [{ id: 'a', opacity: 1 }, { id: 'b' }];
        const mapa = mapaDublê(tiposReais());

        applyLayerOpacities(mapa);

        expect(mapa.chamadas.setPaint).toEqual([]);
    });

    it('multiplica pelo match quando alguma opacidade sai de 1', () => {
        camadasDaStore.valor = [{ id: 'a', opacity: 0.25 }, { id: 'b', opacity: 1 }];
        const mapa = mapaDublê(tiposReais());

        applyLayerOpacities(mapa);

        const escrita = mapa.chamadas.setPaint.find((c) => c.prop === 'fill-opacity');
        expect(escrita).toBeDefined();
        expect(escrita.valor[0]).toBe('*');
        expect(escrita.valor[1]).toEqual(['get', 'opacity']);
        expect(escrita.valor[2]).toContain('a');
        expect(escrita.valor[2]).toContain(0.25);
    });

    it('RESTAURA quando a opacidade volta de 0.25 para 1, em vez de pular a escrita', () => {
        const mapa = mapaDublê(tiposReais());

        camadasDaStore.valor = [{ id: 'a', opacity: 0.25 }];
        applyLayerOpacities(mapa);
        const depoisDoPrimeiro = mapa.chamadas.setPaint.length;
        expect(depoisDoPrimeiro).toBeGreaterThan(0);

        camadasDaStore.valor = [{ id: 'a', opacity: 1 }];
        applyLayerOpacities(mapa);

        // A verificacao REPROVA o estado anterior: se o atalho de identidade nao olhasse a
        // bandeira, esta segunda passada nao escreveria nada e o mapa ficaria em 0.25.
        expect(mapa.chamadas.setPaint.length).toBeGreaterThan(depoisDoPrimeiro);
        const ultima = mapa.chamadas.setPaint[mapa.chamadas.setPaint.length - 1];
        expect(ultima.valor[2]).toContain(1);
    });

    it('nao repete trabalho quando a assinatura de opacidades nao mudou', () => {
        camadasDaStore.valor = [{ id: 'a', opacity: 0.5 }];
        const mapa = mapaDublê(tiposReais());

        applyLayerOpacities(mapa);
        const n = mapa.chamadas.setPaint.length;
        applyLayerOpacities(mapa);

        expect(mapa.chamadas.setPaint.length).toBe(n);
    });
});

// ============================================================================
// O ESCURECIMENTO DO "REVELAR OCULTAS" COMO FATOR DAQUI (achados M2 e M3)
// ============================================================================
//
// O DEFEITO, MEDIDO NO NAVEGADOR EM 2026-09-21. `temporal/temporal-render.service.js` escrevia as
// MESMAS propriedades de tinta que este modulo, por `applyRevealDim`, e cada um guardava a sua
// "original" num cache proprio:
//
//   - sem o revelar, opacidade de camada 50% virava `['*', ['get','opacity'], ['match', ... 0.5, 1]]`;
//   - COM o revelar ligado, ajustar a opacidade nao tinha efeito NENHUM, porque o revelar
//     reescrevia a tinta por cima a partir do retrato DELE;
//   - ao desligar o revelar, a tinta voltava a `['get','opacity']` com 0,5 gravado na camada: a
//     camada desenhava a 100% e a barra lateral dizia 50%;
//   - e o cache do revelar nunca era zerado, entao depois de trocar o mapa base a restauracao
//     escrevia uma expressao do estilo ANTERIOR.
//
// O conserto e' de posse, nao de ordem de chamada: o escurecimento virou mais um fator DENTRO da
// expressao deste modulo, que ja tem um retrato so, invalidacao em troca de estilo e assinatura.
//
// O SEGUNDO ACHADO no mesmo lugar (M3): o teste de "esta escondida" era montado com o CURSOR CRU
// enquanto o filtro usa a CELULA quantizada, de modo que o revelar escurecia feicao que o mapa
// mostrava, e a expressao mudava a cada quadro, repintando todas as camadas de feicao por quadro
// de reproducao. Agora ela recebe a janela, e e' a MESMA expressao do filtro.

describe('setRevealDimWindow', () => {
    const JANELA = { start: 1000, end: 4600 };

    beforeEach(() => {
        setRevealDimWindow(null, null); // estado de modulo: desliga o revelar entre casos
        invalidateOpacityCache();
        camadasDaStore.valor = [];
    });

    /** A ultima expressao escrita para `fill-opacity`. */
    function ultimaTintaDePoligono(mapa) {
        const escritas = mapa.chamadas.setPaint.filter((c) => c.prop === 'fill-opacity');
        return escritas.length ? escritas[escritas.length - 1].valor : null;
    }

    it('escurece pela MESMA expressao do filtro de visibilidade, nao por uma copia a mao', () => {
        camadasDaStore.valor = [{ id: 'a', opacity: 1 }];
        const mapa = mapaDublê(tiposReais());

        setRevealDimWindow(mapa, JANELA);

        const tinta = ultimaTintaDePoligono(mapa);
        expect(tinta[0]).toBe('*');
        const caso = tinta[tinta.length - 1];
        expect(caso[0]).toBe('case');
        // O predicado e' identico ao do filtro: quem e' escurecido e' exatamente quem o filtro
        // esconderia naquela celula. Isto e' o M1/M6 valendo tambem para a tinta.
        expect(caso[1]).toEqual(buildTemporalOverlapFilter(JANELA.start, JANELA.end));
        expect(caso[2]).toBe(1);
        expect(caso[3]).toBeGreaterThan(0);
        expect(caso[3]).toBeLessThan(1);
    });

    it('REGRESSAO (M2): com o revelar ligado, o ajuste de opacidade CONTINUA valendo', () => {
        camadasDaStore.valor = [{ id: 'a', opacity: 0.5 }];
        const mapa = mapaDublê(tiposReais());

        setRevealDimWindow(mapa, JANELA);

        const tinta = ultimaTintaDePoligono(mapa);
        // Os TRES fatores na MESMA expressao: original, multiplicador de camada, escurecimento.
        // Era aqui que o valor 0,5 sumia, porque o revelar escrevia `['*', original, dim]`.
        expect(tinta[0]).toBe('*');
        expect(tinta[1]).toEqual(['get', 'opacity']);
        expect(tinta[2]).toContain('a');
        expect(tinta[2]).toContain(0.5);
        expect(tinta[3][0]).toBe('case');
    });

    it('REGRESSAO (M2): mudar a opacidade COM o revelar ligado repinta, em vez de nao ter efeito', () => {
        camadasDaStore.valor = [{ id: 'a', opacity: 1 }];
        const mapa = mapaDublê(tiposReais());
        setRevealDimWindow(mapa, JANELA);

        camadasDaStore.valor = [{ id: 'a', opacity: 0.25 }];
        applyLayerOpacities(mapa);

        const tinta = ultimaTintaDePoligono(mapa);
        expect(tinta[2]).toContain(0.25);
        expect(tinta[3][0]).toBe('case'); // e o escurecimento nao se perdeu no caminho
    });

    it('REGRESSAO (M2): desligar o revelar devolve a tinta COM a opacidade ajustada', () => {
        camadasDaStore.valor = [{ id: 'a', opacity: 0.5 }];
        const mapa = mapaDublê(tiposReais());
        setRevealDimWindow(mapa, JANELA);

        setRevealDimWindow(mapa, null);

        const tinta = ultimaTintaDePoligono(mapa);
        // O defeito medido: a camada voltava a 100% com 0,5 gravado nela.
        expect(tinta).toEqual(['*', ['get', 'opacity'], expect.arrayContaining(['match'])]);
        expect(tinta[2]).toContain(0.5);
    });

    it('o retrato do "original" e tirado UMA vez, antes de qualquer multiplicador', () => {
        camadasDaStore.valor = [{ id: 'a', opacity: 0.5 }];
        const mapa = mapaDublê(tiposReais());

        setRevealDimWindow(mapa, JANELA);
        const perguntasDepoisDoPrimeiro = mapa.chamadas.getPaint.length;
        setRevealDimWindow(mapa, { start: 9000, end: 12600 });

        // Nenhuma pergunta NOVA: o segundo retrato seria tirado JA com o multiplicador por cima,
        // que e' a mecanica exata do defeito de dois donos.
        expect(mapa.chamadas.getPaint.length).toBe(perguntasDepoisDoPrimeiro);
        const tinta = ultimaTintaDePoligono(mapa);
        expect(tinta[1]).toEqual(['get', 'opacity']);
    });

    it('REGRESSAO (M3): a MESMA janela nao reescreve tinta nenhuma', () => {
        camadasDaStore.valor = [{ id: 'a', opacity: 1 }];
        const mapa = mapaDublê(tiposReais());

        setRevealDimWindow(mapa, JANELA);
        const n = mapa.chamadas.setPaint.length;
        expect(n).toBeGreaterThan(0); // controle de vacuo: houve escrita na primeira vez
        setRevealDimWindow(mapa, { start: 1000, end: 4600 });

        // Com o CURSOR cru na expressao, cada quadro de reproducao trazia um numero diferente e
        // repintava todas as camadas de feicao. Com a celula, so a fronteira do passo repinta.
        expect(mapa.chamadas.setPaint.length).toBe(n);
    });

    it('a janela SEGUINTE reescreve (a fronteira do passo ainda repinta)', () => {
        camadasDaStore.valor = [{ id: 'a', opacity: 1 }];
        const mapa = mapaDublê(tiposReais());

        setRevealDimWindow(mapa, JANELA);
        const n = mapa.chamadas.setPaint.length;
        setRevealDimWindow(mapa, { start: 4600, end: 8200 });

        expect(mapa.chamadas.setPaint.length).toBeGreaterThan(n);
    });

    it('o atalho de identidade NAO engole o revelar com toda opacidade em 1', () => {
        camadasDaStore.valor = [{ id: 'a', opacity: 1 }, { id: 'b' }];
        const mapa = mapaDublê(tiposReais());

        applyLayerOpacities(mapa);
        expect(mapa.chamadas.setPaint).toEqual([]); // o atalho vale enquanto nao ha o que aplicar

        setRevealDimWindow(mapa, JANELA);
        expect(mapa.chamadas.setPaint.length).toBeGreaterThan(0);
    });

    it('REGRESSAO (M2): a troca de mapa base repoe o escurecimento sobre o estilo NOVO', () => {
        camadasDaStore.valor = [{ id: 'a', opacity: 1 }];
        const antigo = mapaDublê(tiposReais());
        setRevealDimWindow(antigo, JANELA);

        // O estilo foi remontado: cache zerado e outra instancia de camadas.
        invalidateOpacityCache();
        const novo = mapaDublê(tiposReais());
        applyLayerOpacities(novo);

        const tinta = ultimaTintaDePoligono(novo);
        // O cache do revelar, que nunca era zerado, restaurava aqui uma expressao do estilo
        // anterior; e o botao "revelar" continua apertado, entao o escurecimento tem de voltar.
        expect(tinta).not.toBeNull();
        expect(tinta[tinta.length - 1][0]).toBe('case');
    });

    it('BORDA: janela com limite nao finito desliga o escurecimento em vez de escrever NaN', () => {
        camadasDaStore.valor = [{ id: 'a', opacity: 0.5 }];
        const mapa = mapaDublê(tiposReais());

        setRevealDimWindow(mapa, { start: NaN, end: NaN });

        const tinta = ultimaTintaDePoligono(mapa);
        expect(tinta).toEqual(['*', ['get', 'opacity'], expect.arrayContaining(['match'])]);
        expect(JSON.stringify(tinta)).not.toContain('case');
    });

    it('BORDA: sem mapa nenhum entregue ainda, nao lanca', () => {
        expect(() => setRevealDimWindow(null, JANELA)).not.toThrow();
    });

    it('CENSO: o servico de render do temporal nao escreve tinta de opacidade', async () => {
        // O conserto e' de POSSE. Um segundo escritor com o seu proprio retrato do "original" e'
        // a causa inteira do M2, entao a assercao que sobrevive a uma reescrita e' esta: so um
        // modulo chama `setPaintProperty` para opacidade.
        const { readFileSync } = await import('node:fs');
        const { fileURLToPath } = await import('node:url');
        const codigo = readFileSync(
            fileURLToPath(new URL('../../src/js/temporal/temporal-render.service.js', import.meta.url)),
            'utf8',
        );
        expect(codigo.length).toBeGreaterThan(1000); // controle de vacuo: o arquivo foi lido
        expect(codigo).not.toMatch(/setPaintProperty/);
        expect(codigo).not.toMatch(/getPaintProperty/);
        // E ele delega, em vez de simplesmente ter perdido a funcionalidade.
        expect(codigo).toContain('setRevealDimWindow');
    });
});
