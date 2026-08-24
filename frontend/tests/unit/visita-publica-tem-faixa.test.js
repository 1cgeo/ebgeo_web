// Path: tests/unit/visita-publica-tem-faixa.test.js

/**
 * @fileoverview A VISITA POR LINK PÚBLICO GANHOU SINAL PERSISTENTE (achado A2 da auditoria do
 * visitante deslogado, 2026-08-24; decisão do dono: "faixa no público").
 *
 * O defeito: o único anúncio da visita era um toast de três segundos ao fim de
 * `openPublicAtlasFromUrl` (`src/js/index.js`). Passados eles, o que restava era a AUSÊNCIA das
 * barras de ferramenta, indistinguível de "está carregando" e de defeito. Nada dizia de quem é o
 * documento, qual é, nem que o modo é restrito, porque os três controles que poderiam nomear o
 * atlas são gateados por `isAuthenticated()`, falso para o visitante.
 *
 * POR QUE UMA CAMADA ESTRUTURAL, e não um teste de DOM: o ambiente da suíte é `node` puro, sem
 * jsdom, e a faixa monta dentro do boot de `index.js`, que só existe num navegador. O que se pode
 * prender aqui de graça é a CADEIA ATÉ O EFEITO, elo por elo, e é isso que a segunda metade deste
 * arquivo faz. Um teste que só afirmasse que `visitorBannerNotice()` devolve a string certa
 * provaria que a frase existe, nunca que alguém a monta: por isso cada elo abaixo (a chamada no
 * ramo de SUCESSO, o `appendChild`, a classe `--visible`, e a regra de CSS que essa classe
 * aciona) tem asserção própria.
 *
 * CONTROLE NEGATIVO (cada asserção foi escrita contra uma implementação errada concreta):
 *   - apagar a chamada de `showVisitorBanner` em `index.js`: reprova em "o boot monta a faixa".
 *   - construir a faixa e nunca a inserir (`appendChild` fora): reprova em "a faixa chega ao
 *     documento".
 *   - construir e inserir sem `--visible`: reprova em "a faixa é revelada", porque a regra base
 *     do CSS é `opacity: 0; visibility: hidden`.
 *   - apagar `.visitor-banner--visible` do CSS: reprova em "a classe tem regra que a revela".
 *   - tirar o gate de `isVisitor()`: reprova em "a faixa falha fechada".
 *   - trocar `assign` por `replace` na saída: reprova em "a saída não destrói o link".
 *   - nome ausente virando `"undefined"` na tela: reprova nas frases puras.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    visitorAtlasLabel,
    visitorBannerNotice,
} from '../../src/js/session/visitor-banner-phrases.js';

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const INDEX = readFileSync(resolve(FRONT, 'src/js/index.js'), 'utf8');
const BANNER = readFileSync(resolve(FRONT, 'src/js/session/visitor-banner.js'), 'utf8');
const CSS = readFileSync(resolve(FRONT, 'src/css/visitor-banner.css'), 'utf8');
const STYLE_MANIFEST = readFileSync(resolve(FRONT, 'src/css/style.css'), 'utf8');

/** O corpo de uma função de nível superior de `index.js`, do `async function X` à chave que o fecha. */
function corpoDaFuncao(fonte, nome) {
    const inicio = fonte.indexOf(`async function ${nome}(`);
    if (inicio < 0) return null;
    const fim = fonte.indexOf('\n}', inicio);
    return fim < 0 ? fonte.slice(inicio) : fonte.slice(inicio, fim + 2);
}

describe('visitorAtlasLabel: o nome do atlas falha FECHADO', () => {
    it('devolve o nome quando ele é um texto utilizável', () => {
        expect(visitorAtlasLabel('Rio Grande')).toBe('Rio Grande');
    });

    it('não inventa nome quando ele falta, está vazio ou não é texto', () => {
        // Sem nome é melhor que nome errado: a faixa existe para ser a coisa em que se confia
        // quando o resto da tela está mudo.
        for (const entrada of [null, undefined, '', '   ', '\n\t ', 42, {}, [], true]) {
            expect(visitorAtlasLabel(entrada), String(entrada)).toBeNull();
        }
    });

    it('colapsa quebra de linha e tabulação, que rebentariam a faixa em três linhas', () => {
        expect(visitorAtlasLabel('  Rio\n\tGrande  ')).toBe('Rio Grande');
    });

    it('trunca o nome longo, para o botão de saída não sair da tela', () => {
        const longo = 'A'.repeat(300);
        const rotulo = visitorAtlasLabel(longo);
        expect(rotulo.length).toBeLessThanOrEqual(60);
        expect(rotulo.endsWith('…')).toBe(true);
        // O controle do outro lado: um nome de exatamente 60 NÃO é truncado.
        expect(visitorAtlasLabel('B'.repeat(60))).toBe('B'.repeat(60));
        expect(visitorAtlasLabel('B'.repeat(61)).endsWith('…')).toBe(true);
    });
});

describe('visitorBannerNotice: os três fatos da visita', () => {
    it('o título NOMEIA o atlas quando há nome', () => {
        expect(visitorBannerNotice('Rio Grande').title).toBe('Visita pública: "Rio Grande"');
    });

    it('o título sem nome não diz "undefined", "null" nem aspas vazias', () => {
        for (const entrada of [null, undefined, '', '   ', 42]) {
            const { title } = visitorBannerNotice(entrada);
            expect(title, String(entrada)).not.toMatch(/undefined|null|\[object|NaN/i);
            expect(title, String(entrada)).not.toMatch(/""/);
            expect(title, String(entrada)).toMatch(/[Vv]isita pública/);
        }
        // E o desfecho sem nome é UM SÓ, seja qual for a forma da ausência.
        expect(visitorBannerNotice(null).title).toBe(visitorBannerNotice(undefined).title);
    });

    it('a mensagem diz "Somente leitura" e de quem é o documento', () => {
        const { message } = visitorBannerNotice('Rio Grande');
        expect(message).toMatch(/Somente leitura/);
        expect(message).toMatch(/de outra pessoa/);
        expect(message).toMatch(/link compartilhado/);
    });

    it('a saída se chama de saída DA VISITA, e não repete o vocabulário de conta', () => {
        const { exitLabel, exitHint } = visitorBannerNotice(null);
        expect(exitLabel).toMatch(/visita/i);
        // "Sair" seco é o rótulo de logout do produto ("Você saiu da conta."), e o visitante não
        // tem conta de que sair.
        expect(exitLabel).not.toBe('Sair');
        // A dica responde a única pergunta cara da saída.
        expect(exitHint).toMatch(/não é apagado|não apaga/i);
        expect(exitHint).toMatch(/Voltar/);
    });

    it('o módulo não constrói HTML: o nome volta VERBATIM, sem escape e sem marcação própria', () => {
        // A defesa contra XSS é o `textContent` de quem desenha (asserido na camada estrutural),
        // não um escape aqui. O que se prende aqui é que este módulo não é uma segunda defesa
        // meia-boca: se ele começasse a montar HTML, o `textContent` lá viraria texto com tags.
        const hostil = '<img src=x onerror=alert(1)>';
        expect(visitorBannerNotice(hostil).title).toContain(hostil);
        const semNome = visitorBannerNotice(null);
        for (const texto of [semNome.title, semNome.message, semNome.exitLabel, semNome.exitHint]) {
            expect(texto).not.toMatch(/[<>]/);
        }
    });

    it('o resultado é congelado, para nenhuma tela editar a frase da outra', () => {
        expect(Object.isFrozen(visitorBannerNotice('X'))).toBe(true);
    });
});

describe('estrutura: o boot MONTA a faixa no ramo de sucesso da visita pública', () => {
    it('`index.js` importa a faixa', () => {
        expect(INDEX).toMatch(/import \{ showVisitorBanner[^}]*\} from '\.\/session\/visitor-banner\.js'/);
        // E ela é desfeita onde os vizinhos do mesmo tipo são desfeitos.
        expect(INDEX).toContain('destroyVisitorBanner();');
    });

    it('o boot monta a faixa, passando o nome do atlas que o servidor devolveu', () => {
        const corpo = corpoDaFuncao(INDEX, 'openPublicAtlasFromUrl');
        expect(corpo, 'a função `openPublicAtlasFromUrl` sumiu de index.js — o guarda perdeu o alvo')
            .not.toBeNull();
        expect(corpo).toContain('showVisitorBanner(atlas.name)');
    });

    it('a montagem está no ramo de SUCESSO, depois do mapa inicial e antes do `catch`', () => {
        const corpo = corpoDaFuncao(INDEX, 'openPublicAtlasFromUrl');
        const mapaInicial = corpo.indexOf('await activateAtlasInitialMap();');
        const faixa = corpo.indexOf('showVisitorBanner(atlas.name)');
        const falhaLocal = corpo.indexOf('[boot] public atlas open failed');
        expect(mapaInicial).toBeGreaterThan(-1);
        expect(falhaLocal).toBeGreaterThan(-1);
        expect(faixa).toBeGreaterThan(mapaInicial);
        expect(faixa).toBeLessThan(falhaLocal);
    });

    it('a visita continua falando mesmo se a faixa recusar montar', () => {
        // Perder a faixa é regressão; perder a fala é o defeito original de volta.
        const corpo = corpoDaFuncao(INDEX, 'openPublicAtlasFromUrl');
        expect(corpo).toMatch(/if \(!showVisitorBanner\(atlas\.name\)\) \{\s*\n\s*showToast\(/);
    });

    it('o extrator realmente recorta (controle: não devolve o arquivo inteiro)', () => {
        const corpo = corpoDaFuncao(INDEX, 'openPublicAtlasFromUrl');
        expect(corpo.length).toBeLessThan(INDEX.length / 2);
        expect(corpo).not.toContain('async function initApp(');
    });
});

describe('estrutura: a faixa chega ao documento e é revelada', () => {
    it('a faixa é inserida no documento', () => {
        // Construir o elemento não é mostrá-lo: sem esta linha a faixa existe só na memória.
        expect(BANNER).toContain('document.body.appendChild(el)');
    });

    it('a faixa é revelada pela classe `--visible`', () => {
        // A regra base do CSS é `opacity: 0; visibility: hidden`, então inserir sem esta classe
        // é inserir um elemento invisível.
        expect(BANNER).toContain("classList.add('visitor-banner--visible')");
        expect(BANNER).toContain("classList.remove('visitor-banner--visible')");
    });

    it('a classe tem regra de CSS que de fato a revela, e o CSS está ligado ao módulo', () => {
        // A CADEIA DE CSS DA CASA E O `@import` DE `style.css`, nao um import dentro do JS.
        // `index.html` liga um arquivo so, e os 40+ arquivos do mapa entram por ali; a
        // primeira versao desta faixa importava o proprio CSS do modulo, que funciona no
        // Vite e diverge da casa. O alvo desta assercao e o manifesto, porque e ele que
        // decide se a regra chega ao navegador.
        expect(STYLE_MANIFEST).toMatch(/@import url\('\.\/visitor-banner\.css'\);/);
        expect(CSS).toContain('.visitor-banner--visible');
        const regra = CSS.slice(CSS.indexOf('.visitor-banner--visible'));
        const corpoRegra = regra.slice(0, regra.indexOf('}'));
        expect(corpoRegra).toMatch(/visibility:\s*visible/);
        expect(corpoRegra).toMatch(/opacity:\s*1/);
        // E a regra base esconde, senão a classe não estaria provando nada.
        const base = CSS.slice(CSS.indexOf('\n.visitor-banner {'));
        expect(base.slice(0, base.indexOf('}'))).toMatch(/visibility:\s*hidden/);
    });

    it('a faixa SOBREPÕE, nunca ocupa altura no fluxo', () => {
        // `#map-sig` tem 100% de altura num flex de coluna: um elemento em fluxo encolheria o
        // canvas do MapLibre sem que nada disparasse um `resize`.
        const base = CSS.slice(CSS.indexOf('\n.visitor-banner {'));
        expect(base.slice(0, base.indexOf('}'))).toMatch(/position:\s*fixed/);
    });
});

describe('estrutura: a faixa falha fechada e a saída não destrói o link', () => {
    it('só o VISITANTE a vê, e o predicado é o do contexto de sessão', () => {
        // Primeiro consumidor de interface de `isVisitor()`: até aqui os dois únicos usos em
        // `src/js/` estavam ambos em `store/sync/tab-lock-sync-brake.js`.
        // DOIS sítios de código, e são dois de propósito: o portão da montagem (quem NUNCA vê a
        // faixa) e a derivação por `SESSION_CHANGED` (quando ela deixa de valer). Asserido pela
        // FORMA de cada um, e não por contagem de ocorrências do nome, senão a menção em prosa
        // do cabeçalho pagaria pelo código apagado.
        expect(BANNER).toContain('if (!sessionContext.isVisitor()) return false;');
        expect(BANNER).toContain('if (!sessionContext.isVisitor()) {');
        expect(BANNER).toContain('EventTypes.SESSION_CHANGED');
    });

    it('a saída NAVEGA para a tela de atlas, e não a substitui no histórico', () => {
        // `replace` queimaria a entrada atual e destruiria o `?atlasPublico=`, que é a única coisa
        // que este visitante tem.
        expect(BANNER).toContain("window.location.assign(EXIT_HREF)");
        expect(BANNER).toContain("const EXIT_HREF = './atlas.html'");
        expect(BANNER).not.toMatch(/location\.replace/);
    });

    it('a saída não reescreve a barra de endereços de forma nenhuma', () => {
        // A faixa não tem uma linha capaz de mexer na URL: nem apagar parâmetro, nem
        // `replaceState`. É a forma mais forte de "não destrói o link", porque não depende de
        // ninguém acertar QUAL parâmetro preservar.
        expect(BANNER).not.toMatch(/params\.delete|replaceState|pushState|URLSearchParams/);
        // E `index.js` continua com UMA só remoção do parâmetro, a de `forgetPublicAtlasUrl`.
        expect((INDEX.match(/params\.delete\('atlasPublico'\)/g) || []).length).toBe(1);
    });

    it('o nome do atlas entra por `textContent`, e o único `innerHTML` é o ícone estático', () => {
        expect(BANNER).toContain('title.textContent = notice.title');
        const atribuicoes = BANNER.match(/\.innerHTML\s*=\s*([^;]+);/g) || [];
        expect(atribuicoes.length).toBe(1);
        expect(atribuicoes[0]).toContain('EYE_ICON');
    });

    it('os recursos são soltos pelo utilitário da casa', () => {
        expect(BANNER).toMatch(/from '@utils\/event-cleanup\.js'/);
        expect(BANNER).toContain('setupCleanup(this)');
        expect(BANNER).toContain('addDomListener(this, exit,');
        expect(BANNER).toContain('cleanup(this)');
    });
});
