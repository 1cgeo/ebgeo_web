// Path: tests/unit/carga-sob-demanda.test.js
//
// A CARGA SOB DEMANDA QUE NÃO CHEGA, e o que o produto faz com ela.
//
// Medido em 2026-09-22 na release 1c3c19c9: seis defeitos de `import()` que não chegou
// (`cesium-integration`, `military-tools` e o CSS do visualizador 3D) e 404 no nginx para chunks de
// hash ANTIGO, pedidos por abas abertas antes de um deploy. O clique não fazia nada, ou deixava a
// ferramenta meio ligada.
//
// O QUE ESTE ARQUIVO PRENDE:
//   1. a classificação: só a falha de CARGA (o arquivo não chegou) ganha nova tentativa e aviso; o
//      erro de um módulo que chegou e lançou ao avaliar volta ao chamador na hora, porque tentar de
//      novo um defeito não conserta nada;
//   2. a decisão: UMA nova tentativa, e depois o aviso, nunca uma terceira;
//   3. o CSS: a única falha em que a nova tentativa é conserto de verdade, e só se a folha de estilo
//      for pedida outra vez (o carregador do Vite a marcou como vista);
//   4. a rede sobre `vite:preloadError`: fala pelas portas NÃO protegidas, e cala pelas que já estão
//      tratando a falha, para que a pessoa não leia o mesmo aviso duas vezes;
//   5. a frase: sem código HTTP e sem jargão, e a versão nova só quando a página publicada mudou.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    FRASES_DE_CARGA,
    decidirAposFalha,
    ehFalhaDeCarga,
    entradasDaPagina,
    fraseDeFalhaDeCarga,
    urlDoCssQueFalhou,
    versaoNovaPublicada,
} from '../../src/js/utilities/carga-sob-demanda.model.js';
import {
    avisarFalhaDeCarga,
    carregarSobDemanda,
    instalarRedeDeCargaSobDemanda,
    resetCargaSobDemanda,
} from '../../src/js/utilities/carga-sob-demanda.js';

/** As mensagens REAIS de cada motor, e a do carregador do Vite. */
const FALHAS = Object.freeze({
    chromium: 'Failed to fetch dynamically imported module: https://h/ebgeo_novo/assets/cesium-integration-Ab12.js',
    firefox: 'error loading dynamically imported module: https://h/ebgeo_novo/assets/military-tools-Cd34.js',
    safari: 'Importing a module script failed.',
    css: 'Unable to preload CSS for https://h/ebgeo_novo/assets/cesium-integration~map_3d-Ef56.css',
});

const falhaDeCarga = (mensagem = FALHAS.chromium) => new TypeError(mensagem);

/** Opções que tiram o relógio e o DOM do caminho: a decisão é o que está sob teste. */
const semEspera = (extra = {}) => ({ esperar: async () => {}, aoAvisar: vi.fn(), ...extra });

beforeEach(() => resetCargaSobDemanda());
afterEach(() => resetCargaSobDemanda());

// ================================================================================================
// 1. A classificação
// ================================================================================================

describe('o que é falha de CARGA', () => {
    it.each(Object.entries(FALHAS))('a mensagem de %s é falha de carga', (_motor, mensagem) => {
        expect(ehFalhaDeCarga(new TypeError(mensagem))).toBe(true);
        expect(ehFalhaDeCarga(mensagem)).toBe(true);
    });

    it.each([
        ['erro de avaliação do módulo', new ReferenceError('turf is not defined')],
        ['erro de sintaxe', new SyntaxError('Unexpected token')],
        ['erro genérico', new Error('Falha ao carregar o modulo')],
        ['null', null],
        ['undefined', undefined],
        ['número', 404],
        ['objeto sem mensagem', {}],
    ])('%s NÃO é falha de carga', (_nome, erro) => {
        expect(ehFalhaDeCarga(erro)).toBe(false);
    });

    it('uma mensagem cujo getter lança não derruba a classificação', () => {
        const hostil = { get message() { throw new Error('boom'); } };
        expect(ehFalhaDeCarga(hostil)).toBe(false);
        expect(urlDoCssQueFalhou(hostil)).toBeNull();
    });

    it('a folha de estilo que falhou é lida da mensagem do Vite, e só dela', () => {
        expect(urlDoCssQueFalhou(new Error(FALHAS.css)))
            .toBe('https://h/ebgeo_novo/assets/cesium-integration~map_3d-Ef56.css');
        expect(urlDoCssQueFalhou(new TypeError(FALHAS.chromium))).toBeNull();
        expect(urlDoCssQueFalhou(null)).toBeNull();
    });
});

// ================================================================================================
// 2. A decisão
// ================================================================================================

describe('decidirAposFalha: uma nova tentativa, e depois o aviso', () => {
    it('falha de carga na primeira tentativa: tenta de novo', () => {
        expect(decidirAposFalha(falhaDeCarga(), 1)).toBe('tentar-de-novo');
    });

    it('falha de carga na segunda: avisa, e nunca uma terceira tentativa', () => {
        expect(decidirAposFalha(falhaDeCarga(), 2)).toBe('avisar');
        expect(decidirAposFalha(falhaDeCarga(), 3)).toBe('avisar');
    });

    it('erro que não é de carga: devolve ao chamador já na primeira', () => {
        expect(decidirAposFalha(new Error('bug'), 1)).toBe('relancar');
        expect(decidirAposFalha(new Error('bug'), 2)).toBe('relancar');
    });
});

describe('carregarSobDemanda', () => {
    it('sucesso na primeira: uma chamada, nenhum aviso', async () => {
        const carregar = vi.fn(async () => ({ pronto: true }));
        const opcoes = semEspera();

        await expect(carregarSobDemanda(carregar, opcoes)).resolves.toEqual({ pronto: true });
        expect(carregar).toHaveBeenCalledTimes(1);
        expect(opcoes.aoAvisar).not.toHaveBeenCalled();
    });

    it('falha transitória: a segunda tentativa entrega o módulo e ninguém é avisado', async () => {
        const carregar = vi.fn()
            .mockRejectedValueOnce(falhaDeCarga())
            .mockResolvedValueOnce({ pronto: true });
        const opcoes = semEspera();

        await expect(carregarSobDemanda(carregar, opcoes)).resolves.toEqual({ pronto: true });
        expect(carregar).toHaveBeenCalledTimes(2);
        expect(opcoes.aoAvisar).not.toHaveBeenCalled();
    });

    it('falha nas DUAS: avisa UMA vez e rejeita, para o chamador desfazer o que começou', async () => {
        const segundo = falhaDeCarga(FALHAS.firefox);
        const carregar = vi.fn()
            .mockRejectedValueOnce(falhaDeCarga())
            .mockRejectedValueOnce(segundo);
        const opcoes = semEspera();

        await expect(carregarSobDemanda(carregar, opcoes)).rejects.toBe(segundo);
        expect(carregar).toHaveBeenCalledTimes(2);
        expect(opcoes.aoAvisar).toHaveBeenCalledTimes(1);
    });

    it('a espera fica ENTRE as duas tentativas, e é uma só', async () => {
        const ordem = [];
        const carregar = vi.fn(async () => { ordem.push('carga'); throw falhaDeCarga(); });
        const esperar = vi.fn(async () => { ordem.push('espera'); });

        await carregarSobDemanda(carregar, { esperar, aoAvisar: () => {} }).catch(() => {});
        expect(ordem).toEqual(['carga', 'espera', 'carga']);
    });

    it('erro de AVALIAÇÃO: volta ao chamador na hora, sem nova tentativa e sem aviso', async () => {
        const bug = new ReferenceError('turf is not defined');
        const carregar = vi.fn().mockRejectedValue(bug);
        const opcoes = semEspera();

        await expect(carregarSobDemanda(carregar, opcoes)).rejects.toBe(bug);
        expect(carregar).toHaveBeenCalledTimes(1);
        expect(opcoes.aoAvisar).not.toHaveBeenCalled();
    });

    it('`avisar: false` tenta de novo mas cala: o chamador tem a sua própria acusação', async () => {
        const carregar = vi.fn().mockRejectedValue(falhaDeCarga());
        const opcoes = semEspera({ avisar: false });

        await expect(carregarSobDemanda(carregar, opcoes)).rejects.toBeInstanceOf(TypeError);
        expect(carregar).toHaveBeenCalledTimes(2);
        expect(opcoes.aoAvisar).not.toHaveBeenCalled();
    });

    it('um carregador que lança SÍNCRONO cai no mesmo caminho', async () => {
        const carregar = vi.fn(() => { throw falhaDeCarga(); });
        const opcoes = semEspera();

        await expect(carregarSobDemanda(carregar, opcoes)).rejects.toBeInstanceOf(TypeError);
        expect(carregar).toHaveBeenCalledTimes(2);
        expect(opcoes.aoAvisar).toHaveBeenCalledTimes(1);
    });
});

// ================================================================================================
// 3. O CSS
// ================================================================================================

describe('a falha de CSS, a única que a nova tentativa conserta de verdade', () => {
    it('a folha é pedida de novo ANTES da nova tentativa, e com ela de volta o módulo abre', async () => {
        const ordem = [];
        const carregar = vi.fn()
            .mockImplementationOnce(async () => { ordem.push('carga'); throw new Error(FALHAS.css); })
            .mockImplementationOnce(async () => { ordem.push('carga'); return { pronto: true }; });
        const recarregarCss = vi.fn(async (url) => { ordem.push(`css ${url}`); return true; });
        const opcoes = semEspera({ recarregarCss });

        await expect(carregarSobDemanda(carregar, opcoes)).resolves.toEqual({ pronto: true });
        expect(ordem).toEqual([
            'carga', 'css https://h/ebgeo_novo/assets/cesium-integration~map_3d-Ef56.css', 'carga',
        ]);
        expect(opcoes.aoAvisar).not.toHaveBeenCalled();
    });

    it('a folha que falha de novo: nada de abrir sem estilo, e o aviso sai', async () => {
        const primeiro = new Error(FALHAS.css);
        const carregar = vi.fn().mockRejectedValueOnce(primeiro);
        const opcoes = semEspera({ recarregarCss: vi.fn(async () => false) });

        await expect(carregarSobDemanda(carregar, opcoes)).rejects.toBe(primeiro);
        // O módulo NÃO é pedido de novo: ele abriria sem a folha, e é isso que "meio ligado" quer dizer.
        expect(carregar).toHaveBeenCalledTimes(1);
        expect(opcoes.aoAvisar).toHaveBeenCalledTimes(1);
    });

    it('falha de módulo NÃO pede folha de estilo nenhuma', async () => {
        const recarregarCss = vi.fn(async () => true);
        const carregar = vi.fn().mockRejectedValue(falhaDeCarga());

        await carregarSobDemanda(carregar, semEspera({ recarregarCss })).catch(() => {});
        expect(recarregarCss).not.toHaveBeenCalled();
    });
});

// ================================================================================================
// 4. A rede sobre `vite:preloadError`
// ================================================================================================

/**
 * O que o carregador do Vite faz com uma falha (`preload` em `vite/dist/node/chunks/node.js`,
 * contrato preso por `carga-sob-demanda-portas.test.js`): despacha o evento de forma SÍNCRONA com o
 * erro como `payload` e relança O MESMO objeto se ninguém chamou `preventDefault()`.
 * @param {EventTarget} alvo
 * @param {*} erro
 * @returns {() => Promise<never>} Um carregador que falha como o do pacote de produção.
 */
function comoOViteFalha(alvo, erro) {
    return () => Promise.reject(erro).catch((err) => {
        const evento = new Event('vite:preloadError', { cancelable: true });
        evento.payload = err;
        alvo.dispatchEvent(evento);
        if (!evento.defaultPrevented) throw err;
    });
}

/** Um macrotask: é quando a rede decide. */
const umMacrotask = () => new Promise((resolve) => { setTimeout(resolve, 0); });

describe('a rede sobre `vite:preloadError`', () => {
    it('uma carga NÃO protegida que falha: a rede avisa', async () => {
        const alvo = new EventTarget();
        const aoAvisar = vi.fn();
        instalarRedeDeCargaSobDemanda(alvo, { aoAvisar });

        await comoOViteFalha(alvo, falhaDeCarga())().catch(() => {});
        await umMacrotask();

        expect(aoAvisar).toHaveBeenCalledTimes(1);
    });

    it('uma carga PROTEGIDA que falha duas vezes: só a porta avisa, a rede cala', async () => {
        const alvo = new EventTarget();
        const daRede = vi.fn();
        instalarRedeDeCargaSobDemanda(alvo, { aoAvisar: daRede });
        const daPorta = vi.fn();

        await carregarSobDemanda(comoOViteFalha(alvo, falhaDeCarga()), { esperar: async () => {}, aoAvisar: daPorta })
            .catch(() => {});
        await umMacrotask();

        expect(daPorta).toHaveBeenCalledTimes(1);
        expect(daRede).not.toHaveBeenCalled();
    });

    it('uma carga protegida que se recupera na segunda: ninguém avisa', async () => {
        const alvo = new EventTarget();
        const daRede = vi.fn();
        instalarRedeDeCargaSobDemanda(alvo, { aoAvisar: daRede });
        const falhaUmaVez = vi.fn()
            .mockImplementationOnce(comoOViteFalha(alvo, falhaDeCarga()))
            .mockResolvedValueOnce({ pronto: true });

        await expect(carregarSobDemanda(falhaUmaVez, semEspera())).resolves.toEqual({ pronto: true });
        await umMacrotask();

        expect(daRede).not.toHaveBeenCalled();
    });

    it('um módulo que chegou e lançou ao avaliar NÃO é anunciado como carga', async () => {
        const alvo = new EventTarget();
        const aoAvisar = vi.fn();
        instalarRedeDeCargaSobDemanda(alvo, { aoAvisar });

        await comoOViteFalha(alvo, new ReferenceError('x is not defined'))().catch(() => {});
        await umMacrotask();

        expect(aoAvisar).not.toHaveBeenCalled();
    });

    it('a rede NUNCA previne o padrão: prevenido, o Vite resolveria o import com `undefined`', async () => {
        const alvo = new EventTarget();
        instalarRedeDeCargaSobDemanda(alvo, { aoAvisar: () => {} });
        let prevenido = null;
        alvo.addEventListener('vite:preloadError', (evento) => { prevenido = evento.defaultPrevented; });

        const erro = falhaDeCarga();
        await expect(comoOViteFalha(alvo, erro)()).rejects.toBe(erro);
        expect(prevenido).toBe(false);
    });

    it('instalar duas vezes não duplica o aviso, e desinstalar o cala', async () => {
        const alvo = new EventTarget();
        const aoAvisar = vi.fn();
        const desinstalar = instalarRedeDeCargaSobDemanda(alvo, { aoAvisar });
        expect(instalarRedeDeCargaSobDemanda(alvo, { aoAvisar })).toBe(desinstalar);

        await comoOViteFalha(alvo, falhaDeCarga())().catch(() => {});
        await umMacrotask();
        expect(aoAvisar).toHaveBeenCalledTimes(1);

        desinstalar();
        await comoOViteFalha(alvo, falhaDeCarga())().catch(() => {});
        await umMacrotask();
        expect(aoAvisar).toHaveBeenCalledTimes(1);
    });

    it('sem alvo (node, worker) a instalação é inerte e não lança', () => {
        expect(() => instalarRedeDeCargaSobDemanda(null)()).not.toThrow();
    });
});

// ================================================================================================
// 5. A versão publicada e a frase
// ================================================================================================

describe('uma versão nova foi publicada?', () => {
    const PAGINA = (hash) => `<!doctype html><html><head>
        <script type="module" crossorigin src="/ebgeo_novo/assets/index-${hash}.js"></script>
        <link rel="modulepreload" crossorigin href="/ebgeo_novo/assets/core-${hash}.js">
        <script src="/ebgeo_novo/legado.js"></script>
        </head><body></body></html>`;

    it('lê só os scripts de MÓDULO, nas duas ordens de atributo', () => {
        expect(entradasDaPagina(PAGINA('aaa'))).toEqual(['/ebgeo_novo/assets/index-aaa.js']);
        expect(entradasDaPagina('<script src="/a.js" type="module"></script>')).toEqual(['/a.js']);
        expect(entradasDaPagina(null)).toEqual([]);
    });

    it('a mesma entrada: não há versão nova', () => {
        expect(versaoNovaPublicada(PAGINA('aaa'), ['/ebgeo_novo/assets/index-aaa.js'])).toBe(false);
    });

    it('a entrada desta aba sumiu da página publicada: há versão nova', () => {
        expect(versaoNovaPublicada(PAGINA('bbb'), ['/ebgeo_novo/assets/index-aaa.js'])).toBe(true);
    });

    it('nada a comparar NÃO é "mesma versão": a resposta é "não sei"', () => {
        expect(versaoNovaPublicada('<html></html>', ['/ebgeo_novo/assets/index-aaa.js'])).toBeNull();
        expect(versaoNovaPublicada(PAGINA('aaa'), [])).toBeNull();
        expect(versaoNovaPublicada(PAGINA('aaa'), null)).toBeNull();
    });
});

describe('a frase do aviso', () => {
    it('sem rede, a frase é a da rede, com ou sem versão nova', () => {
        expect(fraseDeFalhaDeCarga({ online: false })).toBe(FRASES_DE_CARGA.semRede);
        expect(fraseDeFalhaDeCarga({ online: false, versaoNova: true })).toBe(FRASES_DE_CARGA.semRede);
    });

    it('com versão nova, a frase diz isso', () => {
        expect(fraseDeFalhaDeCarga({ versaoNova: true })).toBe(FRASES_DE_CARGA.versaoNova);
    });

    it('sem saber, a frase é a genérica, e um `onLine` desconhecido não vira "sem rede"', () => {
        expect(fraseDeFalhaDeCarga()).toBe(FRASES_DE_CARGA.generica);
        expect(fraseDeFalhaDeCarga({ versaoNova: null, online: undefined })).toBe(FRASES_DE_CARGA.generica);
        expect(fraseDeFalhaDeCarga({ versaoNova: false, online: true })).toBe(FRASES_DE_CARGA.generica);
    });

    it.each(Object.entries(FRASES_DE_CARGA))('a frase %s não tem código nem jargão', (_nome, frase) => {
        expect(frase).not.toMatch(/\d/);
        expect(frase.toLowerCase()).not.toMatch(/m[óo]dulo|chunk|import|script|http|erro/);
        expect(frase).toMatch(/recarregue a página/i);
    });

    it('sem documento (node) o aviso é inerte e não lança', () => {
        expect(() => avisarFalhaDeCarga()).not.toThrow();
    });
});
