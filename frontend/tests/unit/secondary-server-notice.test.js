// Path: tests/unit/secondary-server-notice.test.js

/**
 * @fileoverview O AVISO DE SERVIDOR SECUNDÁRIO (porte do `main`, commits bc728b10 e ebb6a99b,
 * adaptado ao contrato deste ramo).
 *
 * O PIOR CASO DO `main` continua sendo o primeiro: a implantação cujo config não conhece a chave.
 * Nela a tela NÃO pode abrir, e só o booleano `true` a liga, porque uma chave em falta lida como
 * verdadeira abriria um aviso de "você está no servidor errado" em cima de quem está no certo.
 *
 * O PIOR CASO DAQUI É OUTRO, e é ele que o porte precisou fechar. Neste ramo `src/js/config.js`
 * NÃO carrega dado de implantação: é uma casca que `applyRuntimeConfig` hidrata a partir de
 * `GET /api/config` (`store/sync/runtime-config.js`), e o boot é fail-fast nela. Um módulo que
 * lesse a chave NO IMPORT leria a casca vazia e nunca abriria a tela, dissesse o que dissesse o
 * servidor: o verde do `main` (onde o valor estava no arquivo versionado) não prova nada aqui.
 * Daí a asserção de que a decisão é tomada por CHAMADA, e a asserção de que o config estático
 * segue sem a chave.
 *
 * O TERCEIRO É A URL. `app.urlServidorPrincipal` também é dado de implantação, e nada dela está
 * escrito no módulo. Ausente, vazia ou de esquema que não seja http(s), o botão de ir para o
 * servidor principal NÃO se desenha e a tela continua abrindo com o de continuar.
 *
 * POR QUE A CAMADA ESTRUTURAL (o mesmo argumento de `visita-publica-tem-faixa.test.js`): o
 * ambiente da suíte é `node` puro, sem jsdom, e a tela monta dentro do boot de `index.js`, que só
 * existe num navegador. O que se prende aqui de graça é a decisão PURA mais a CADEIA até o efeito,
 * elo por elo. Um teste que só afirmasse que `montarModelo` devolve o texto certo provaria que a
 * frase existe, nunca que alguém a monta.
 *
 * CONTROLE NEGATIVO (cada bloco foi visto reprovando contra uma implementação errada concreta; as
 * mensagens estão no relatório do porte):
 *   - apagar a chamada de `initSecondaryServerNotice()` em `index.js`: reprova em "o boot chama a
 *     tela".
 *   - mover a chamada para depois de `await handleEmailVerificationFromUrl()`: reprova em "a
 *     chamada vem antes do primeiro await longo".
 *   - tirar o `@import` de `style.css`: reprova em "a folha está ligada ao manifesto".
 *   - fixar a URL no módulo (o `PRIMARY_SERVER_URL` do `main`): reprova em "nenhuma URL de
 *     implantação está escrita no módulo".
 *   - ler o config no escopo do módulo em vez de na chamada: reprova em "a chave chega pela
 *     hidratação".
 */

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../../src/js/config.js';
import {
    deveMostrarAviso,
    urlDoServidorPrincipal,
    montarModelo,
} from '../../src/js/ui/secondary-server-notice.js';

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MODULO = readFileSync(resolve(FRONT, 'src/js/ui/secondary-server-notice.js'), 'utf8');
const CSS = readFileSync(resolve(FRONT, 'src/css/secondary-server-notice.css'), 'utf8');
const TOKENS = readFileSync(resolve(FRONT, 'src/css/design-tokens.css'), 'utf8');
const BASE = readFileSync(resolve(FRONT, 'src/css/base.css'), 'utf8');
const MANIFESTO = readFileSync(resolve(FRONT, 'src/css/style.css'), 'utf8');
const INDEX = readFileSync(resolve(FRONT, 'src/js/index.js'), 'utf8');
const CONFIG_FONTE = readFileSync(resolve(FRONT, 'src/js/config.js'), 'utf8');

/** O valor de um custom property, como número. */
function tokenNumerico(fonte, nome) {
    const casou = fonte.match(new RegExp(`${nome}:\\s*(\\d+)\\s*;`));
    return casou ? Number(casou[1]) : null;
}

/** Um config hidratado de mentira, com o bloco `app` que o servidor teria mandado. */
function hidratado(app) {
    return { app };
}

describe('deveMostrarAviso: só o booleano true liga a tela', () => {
    it('o módulo importa sem DOM: o ambiente node não tem document', () => {
        expect(typeof document).toBe('undefined');
    });

    it('config sem a chave vale false (payload de servidor anterior à chave)', () => {
        const semAChave = hidratado({ title: 'EBGeo', tutorialUrl: './docs/doc.html' });
        expect(deveMostrarAviso(semAChave)).toBe(false);
    });

    it('config sem o bloco app, ou nulo, vale false', () => {
        expect(deveMostrarAviso({})).toBe(false);
        expect(deveMostrarAviso({ app: null })).toBe(false);
        expect(deveMostrarAviso(null)).toBe(false);
        expect(deveMostrarAviso(undefined)).toBe(false);
    });

    it('false explícito vale false', () => {
        expect(deveMostrarAviso(hidratado({ avisoServidorSecundario: false }))).toBe(false);
    });

    it('true liga a tela', () => {
        expect(deveMostrarAviso(hidratado({ avisoServidorSecundario: true }))).toBe(true);
    });

    it('só o booleano true liga: string, número, objeto e lista valem false', () => {
        for (const valor of ['true', 'sim', 1, 0, {}, [], 'false', null, undefined]) {
            expect(deveMostrarAviso(hidratado({ avisoServidorSecundario: valor })), String(valor))
                .toBe(false);
        }
    });
});

describe('a chave chega pela HIDRATAÇÃO, e não pelo config estático deste ramo', () => {
    afterEach(() => {
        delete config.app.avisoServidorSecundario;
        delete config.app.urlServidorPrincipal;
    });

    it('o config versionado não declara nenhuma das duas chaves: ele é casca, não implantação', () => {
        // O `main` guardava o valor no arquivo. Aqui o arquivo é o SHAPE que o servidor hidrata, e
        // escrever a chave nele traria de volta o dado de implantação que este ramo tirou dali.
        expect(CONFIG_FONTE).not.toContain('avisoServidorSecundario');
        expect(CONFIG_FONTE).not.toContain('urlServidorPrincipal');
        expect(CONFIG_FONTE).toContain('app: {}');
    });

    it('antes da hidratação a tela está desligada, com o config real do pacote', () => {
        expect(deveMostrarAviso()).toBe(false);
        expect(montarModelo()).toBeNull();
    });

    it('depois da hidratação a MESMA chamada liga: a decisão é por chamada, nunca por import', () => {
        // É isto que `applyRuntimeConfig` faz: funde o payload do servidor DENTRO deste objeto.
        // Um `const habilitado = config.app.avisoServidorSecundario === true` no escopo do módulo
        // continuaria falso aqui, e é esse o defeito que esta asserção existe para pegar.
        config.app.avisoServidorSecundario = true;
        config.app.urlServidorPrincipal = 'https://ebgeo.dsg.eb.mil.br';

        expect(deveMostrarAviso()).toBe(true);
        const modelo = montarModelo();
        expect(modelo).not.toBeNull();
        expect(modelo.primary.url).toContain('ebgeo.dsg.eb.mil.br');
    });

    it('o módulo lê o config por parâmetro com padrão, e não numa constante de topo', () => {
        // A forma que garante a leitura tardia: o padrão de parâmetro é avaliado a cada chamada.
        expect(MODULO).toContain('export function deveMostrarAviso(cfg = config) {');
        expect(MODULO).toContain('export function montarModelo(cfg = config) {');
        // E nenhuma decisão congelada no topo do módulo.
        expect(MODULO).not.toMatch(/^const \w+ = config\./m);
    });
});

describe('urlDoServidorPrincipal: a URL é dado de implantação e falha FECHADA', () => {
    it('devolve href e hostname para http e https', () => {
        const https = urlDoServidorPrincipal(hidratado({ urlServidorPrincipal: 'https://ebgeo.dsg.eb.mil.br' }));
        expect(https.hostname).toBe('ebgeo.dsg.eb.mil.br');
        expect(https.href).toMatch(/^https:\/\/ebgeo\.dsg\.eb\.mil\.br\/?$/);

        const http = urlDoServidorPrincipal(hidratado({ urlServidorPrincipal: 'http://10.0.0.1:8080/ebgeo' }));
        expect(http.hostname).toBe('10.0.0.1');
        expect(http.href).toBe('http://10.0.0.1:8080/ebgeo');
    });

    it('espaço em volta não conta como URL, nem quebra a que existe', () => {
        expect(urlDoServidorPrincipal(hidratado({ urlServidorPrincipal: '   ' }))).toBeNull();
        expect(urlDoServidorPrincipal(hidratado({ urlServidorPrincipal: '\n\t ' }))).toBeNull();
        expect(urlDoServidorPrincipal(hidratado({ urlServidorPrincipal: '  https://x.mil.br  ' })).hostname)
            .toBe('x.mil.br');
    });

    it('ausente, vazia ou de outro tipo vale null', () => {
        expect(urlDoServidorPrincipal(hidratado({}))).toBeNull();
        expect(urlDoServidorPrincipal({})).toBeNull();
        expect(urlDoServidorPrincipal(null)).toBeNull();
        for (const valor of ['', null, undefined, 42, {}, [], true]) {
            expect(urlDoServidorPrincipal(hidratado({ urlServidorPrincipal: valor })), String(valor))
                .toBeNull();
        }
    });

    it('o PIOR CASO: um esquema executável no config não vira botão clicável', () => {
        // O valor vai para um `href`. `javascript:` ou `data:` ali é script à distância de um
        // clique, escrito por quem edita a configuração do servidor, e o descarte é silencioso
        // DE PROPÓSITO: o desfecho de uma URL recusada é o mesmo de uma URL ausente, que a tela
        // já sabe desenhar.
        for (const hostil of [
            'javascript:alert(1)',
            'JavaScript:alert(1)',
            'data:text/html,<script>alert(1)</script>',
            'vbscript:msgbox(1)',
            'file:///etc/passwd',
        ]) {
            expect(urlDoServidorPrincipal(hidratado({ urlServidorPrincipal: hostil })), hostil)
                .toBeNull();
        }
    });

    it('texto que não é URL nenhuma vale null, em vez de lançar', () => {
        for (const lixo of ['ebgeo.dsg.eb.mil.br', '//ebgeo.dsg.eb.mil.br', 'nao é url', '://']) {
            expect(urlDoServidorPrincipal(hidratado({ urlServidorPrincipal: lixo })), lixo).toBeNull();
        }
    });
});

describe('montarModelo: o que a tela diz e quais ações ela oferece', () => {
    const LIGADO = { avisoServidorSecundario: true, urlServidorPrincipal: 'https://ebgeo.dsg.eb.mil.br' };

    it('desligado não tem modelo: quem decide é uma função só', () => {
        expect(montarModelo(hidratado({ urlServidorPrincipal: 'https://ebgeo.dsg.eb.mil.br' }))).toBeNull();
        expect(montarModelo(hidratado({ avisoServidorSecundario: 'true' }))).toBeNull();
        expect(montarModelo(null)).toBeNull();
    });

    it('nomeia onde este servidor está e qual é o recomendado', () => {
        const modelo = montarModelo(hidratado(LIGADO));
        const texto = [modelo.title, ...modelo.paragraphs].join(' ');
        expect(texto).toContain('servidor secundário');
        expect(texto).toContain('1° Centro de Geoinformação');
        expect(texto).toContain('Porto Alegre');
        expect(texto).toContain('ebgeo.dsg.eb.mil.br');
        expect(texto).toContain('Brasília');
        expect(texto).toContain('7° Centro de Telemática de Área');
    });

    it('o botão principal aponta para a URL da implantação e é rotulado pelo host dela', () => {
        const modelo = montarModelo(hidratado(LIGADO));
        expect(modelo.primary.url).toMatch(/^https:\/\/ebgeo\.dsg\.eb\.mil\.br\/?$/);
        expect(modelo.primary.label).toContain('ebgeo.dsg.eb.mil.br');
    });

    it('outra implantação troca o destino e o rótulo, sem tocar no código', () => {
        const modelo = montarModelo(hidratado({
            avisoServidorSecundario: true,
            urlServidorPrincipal: 'https://geoportal.exemplo.mil.br/app',
        }));
        expect(modelo.primary.url).toBe('https://geoportal.exemplo.mil.br/app');
        expect(modelo.primary.label).toBe('Ir para geoportal.exemplo.mil.br');
        expect(modelo.paragraphs.join(' ')).toContain('geoportal.exemplo.mil.br');
    });

    it('SEM URL a tela continua abrindo, só que sem o botão de ir', () => {
        for (const app of [
            { avisoServidorSecundario: true },
            { avisoServidorSecundario: true, urlServidorPrincipal: '' },
            { avisoServidorSecundario: true, urlServidorPrincipal: '   ' },
            { avisoServidorSecundario: true, urlServidorPrincipal: 'javascript:alert(1)' },
        ]) {
            const modelo = montarModelo(hidratado(app));
            expect(modelo, JSON.stringify(app)).not.toBeNull();
            expect(modelo.primary, JSON.stringify(app)).toBeNull();
            expect(modelo.stayLabel).toBe('Continuar neste servidor');
        }
    });

    it('sem URL o texto não promete um endereço que a tela não sabe apontar', () => {
        const modelo = montarModelo(hidratado({ avisoServidorSecundario: true }));
        const texto = modelo.paragraphs.join(' ');
        expect(texto).toContain('o servidor principal,');
        expect(texto).not.toMatch(/undefined|null|\[object|,\s*,/);
        // E continua sendo uma frase completa, não um buraco.
        expect(texto).toContain('7° Centro de Telemática de Área');
    });

    it('o modelo é congelado, para nenhuma tela editar a frase da outra', () => {
        const modelo = montarModelo(hidratado(LIGADO));
        expect(Object.isFrozen(modelo)).toBe(true);
        expect(Object.isFrozen(modelo.paragraphs)).toBe(true);
        expect(Object.isFrozen(modelo.primary)).toBe(true);
    });

    it('o modelo não constrói marcação: nenhum sinal de HTML no texto', () => {
        const modelo = montarModelo(hidratado(LIGADO));
        for (const texto of [modelo.title, ...modelo.paragraphs, modelo.stayLabel, modelo.primary.label]) {
            expect(texto).not.toMatch(/[<>]/);
        }
    });
});

describe('estrutura: nenhuma URL de implantação está escrita no módulo', () => {
    it('o módulo não cita servidor nenhum, nem o do 7° CTA', () => {
        // O `main` tinha `PRIMARY_SERVER_URL = 'https://ebgeo.dsg.eb.mil.br'`. Aqui isso seria
        // dado de implantação dentro do pacote, que é exatamente o que este ramo tirou do
        // `config.js`.
        expect(MODULO).not.toContain('ebgeo.dsg.eb.mil.br');
        expect(MODULO).not.toContain('PRIMARY_SERVER_URL');
        // O único absoluto tolerado é o namespace do SVG, que não é um servidor.
        const absolutas = MODULO.match(/https?:\/\/[^\s'"]+/g) || [];
        expect(absolutas).toEqual(['http://www.w3.org/2000/svg']);
    });

    it('a chave lida é a do contrato com o backend, escrita uma vez em cada função', () => {
        expect(MODULO).toContain('cfg?.app?.avisoServidorSecundario === true');
        expect(MODULO).toContain('cfg?.app?.urlServidorPrincipal');
    });
});

describe('estrutura: o boot chama a tela, no lugar certo da ordem', () => {
    it('`index.js` importa a tela pelo alias da casa', () => {
        expect(INDEX).toContain("import { initSecondaryServerNotice } from '@ui/secondary-server-notice.js';");
    });

    it('o boot chama a tela', () => {
        expect(INDEX).toContain('initSecondaryServerNotice();');
    });

    it('a chamada vem DEPOIS da hidratação do config', () => {
        // Antes dela `config.app` é a casca vazia e a tela nunca abriria.
        const hidratacao = INDEX.indexOf('runtimeConfig = await applyRuntimeConfig({ apiClient });');
        const guarda = INDEX.indexOf('vitais.marcar(MARCA_CONFIG);');
        const chamada = INDEX.indexOf('initSecondaryServerNotice();');
        expect(hidratacao).toBeGreaterThan(-1);
        expect(guarda).toBeGreaterThan(-1);
        expect(chamada).toBeGreaterThan(hidratacao);
        // Depois da marca, que só se alcança quando `runtimeConfig.applied` é verdadeiro: a tela
        // não aparece por cima da tela de indisponibilidade.
        expect(chamada).toBeGreaterThan(guarda);
    });

    it('a chamada vem ANTES do primeiro await longo, e antes dos serviços e do mapa', () => {
        // O ponto da tela é ser lida ENQUANTO o mapa carrega, e continuar de pé se a carga nunca
        // terminar. Amarrá-la a qualquer await posterior mata exatamente esse caso.
        const chamada = INDEX.indexOf('initSecondaryServerNotice();');
        const verify = INDEX.indexOf('await handleEmailVerificationFromUrl();');
        const servicos = INDEX.indexOf('\n    initServices();');
        const mapa = INDEX.indexOf('const { map, analysisLayersManager, dataLayersManager } = createMap();');
        // Sem esta linha o teste passa VAZIO quando a chamada some: `-1` é menor que tudo.
        expect(chamada, 'a chamada sumiu de index.js').toBeGreaterThan(-1);
        for (const [nome, pos] of [['verify', verify], ['initServices', servicos], ['createMap', mapa]]) {
            expect(pos, `a âncora ${nome} sumiu de index.js: o guarda perdeu o alvo`).toBeGreaterThan(-1);
            expect(chamada, `a tela ficou depois de ${nome}`).toBeLessThan(pos);
        }
    });

    it('a chamada não é aguardada: a tela não segura o boot', () => {
        expect(INDEX).not.toContain('await initSecondaryServerNotice');
    });

    it('SÓ O MAPA mostra o aviso: as outras três páginas não o importam', () => {
        // Decisão herdada do `main`, que só o montou em `index.js`. As quatro páginas hidratam o
        // config, então a chave chegaria às três sem mapa também; o que as separa é a chamada.
        for (const pagina of [
            'src/js/projects/projects-page.js',
            'src/js/admin/admin-page.js',
            'src/js/calibration/calibracao-page.js',
        ]) {
            const fonte = readFileSync(resolve(FRONT, pagina), 'utf8');
            expect(fonte, pagina).not.toContain('secondary-server-notice');
        }
    });
});

describe('estrutura: a tela chega ao documento, é revelada e solta o que pegou', () => {
    it('a tela é inserida no documento e revelada pela classe `--visible`', () => {
        expect(MODULO).toContain('document.body.appendChild(el)');
        expect(MODULO).toContain("classList.add('server-notice--visible')");
        expect(MODULO).toContain("classList.remove('server-notice--visible')");
    });

    it('a folha está ligada ao manifesto, e a classe tem regra que de fato revela', () => {
        expect(MANIFESTO).toMatch(/@import url\('\.\/secondary-server-notice\.css'\);/);
        const regra = CSS.slice(CSS.indexOf('.server-notice--visible'));
        const corpo = regra.slice(0, regra.indexOf('}'));
        expect(corpo).toMatch(/visibility:\s*visible/);
        expect(corpo).toMatch(/opacity:\s*1/);
        // E a regra base esconde, senão a classe não provaria nada.
        const base = CSS.slice(CSS.indexOf('\n.server-notice {'));
        const corpoBase = base.slice(0, base.indexOf('}'));
        expect(corpoBase).toMatch(/visibility:\s*hidden/);
        expect(corpoBase).toMatch(/opacity:\s*0/);
        expect(corpoBase).toMatch(/position:\s*fixed/);
    });

    it('a tela fica ACIMA da tela de carregamento e do tab-lock', () => {
        // É o que a faz legível enquanto o mapa carrega, e visível se a carga nunca terminar.
        const inicio = tokenNumerico(TOKENS, '--z-startup-notice');
        const tabLock = tokenNumerico(TOKENS, '--z-tab-lock');
        expect(inicio, 'o token `--z-startup-notice` não existe em design-tokens.css').not.toBeNull();
        expect(tabLock).not.toBeNull();
        expect(inicio).toBeGreaterThan(tabLock);
        // A tela de carregamento tem o número cravado em `base.css` (e repetido em `index.html`).
        const carregamento = Number(BASE.match(/\.loading-background\s*\{[^}]*z-index:\s*(\d+)/s)[1]);
        expect(inicio).toBeGreaterThan(carregamento);
        // E a folha usa o token, nunca um número solto.
        expect(CSS).toContain('z-index: var(--z-startup-notice);');
    });

    it('o teclado é capturado na JANELA, antes dos handlers do app no document', () => {
        // Sem `capture` na janela, um atalho de `keyboard-shortcuts.js` dispararia por trás da
        // tela: o mapa mudaria de ferramenta enquanto a pessoa lê o aviso.
        expect(MODULO).toMatch(/addDomListener\(this, window, 'keydown', .*\{ capture: true \}\);/);
        expect(MODULO).toContain('event.stopImmediatePropagation();');
    });

    it('Escape fecha e Tab circula só entre os botões', () => {
        expect(MODULO).toMatch(/if \(event\.key === 'Escape'\) \{\s*\n\s*event\.preventDefault\(\);\s*\n\s*this\.dismiss\(\);/);
        expect(MODULO).toMatch(/if \(event\.key === 'Tab'\) \{\s*\n\s*this\._trapFocus\(event\);/);
        expect(MODULO).toContain('_trapFocus(event) {');
    });

    it('NADA é persistido: estar no secundário é fato da implantação, não preferência', () => {
        expect(MODULO).not.toMatch(/localStorage|sessionStorage|localforage|indexedDB|document\.cookie/);
    });

    it('a URL entra por `setAttribute` e o texto por `textContent`', () => {
        expect(MODULO).toContain("goToPrimary.setAttribute('href', modelo.primary.url)");
        expect(MODULO).toContain('goToPrimary.textContent = modelo.primary.label;');
        expect(MODULO).toContain('title.textContent = modelo.title;');
        expect(MODULO).toContain('paragraph.textContent = text;');
    });

    it('o único `innerHTML` é o ícone estático', () => {
        const atribuicoes = MODULO.match(/\.innerHTML\s*=\s*([^;]+);/g) || [];
        expect(atribuicoes.length).toBe(1);
        expect(atribuicoes[0]).toContain('WARNING_ICON');
    });

    it('o botão só nasce quando há URL, e o modelo é quem decide', () => {
        expect(MODULO).toContain('if (modelo.primary) {');
        expect(MODULO).toContain('this._actions = [stayHere];');
        expect(MODULO).toContain('this._actions.push(goToPrimary);');
    });

    it('os recursos são soltos pelo utilitário da casa', () => {
        expect(MODULO).toMatch(/from '@utils\/event-cleanup\.js'/);
        expect(MODULO).toContain('setupCleanup(this)');
        // Ancorado DENTRO de `dismiss()`: a chamada movida para outro método manteria o verde.
        const inicioDismiss = MODULO.indexOf('    dismiss() {');
        const corpoDismiss = MODULO.slice(inicioDismiss, MODULO.indexOf('\n    }', inicioDismiss));
        expect(inicioDismiss).toBeGreaterThan(-1);
        expect(corpoDismiss).toContain('cleanup(this);');
        expect(MODULO).toContain('trackTimer(this, setTimeout(');
        expect(MODULO).toContain('removeElement(el)');
    });
});
