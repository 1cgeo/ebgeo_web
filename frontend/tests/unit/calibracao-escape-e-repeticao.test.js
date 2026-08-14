// Path: tests/unit/calibracao-escape-e-repeticao.test.js
//
// Duas regressoes da pagina de calibracao 360 que o ambiente `node` da suite nao
// alcanca por comportamento: as duas vivem em funcoes NAO exportadas de modulos
// que montam DOM (`calibration-panel.js` monta innerHTML, `app.js` escuta
// `keydown` no `document`). O molde adotado e o de `calibracao-pagina.test.js`,
// que ja vigia esta mesma pasta por propriedades do ARQUIVO.
//
// Honestidade sobre o que cada bloco prova:
// - o bloco de escape prova que o SITIO existe e esta envolvido em `escapeHtml`,
//   mais o comportamento REAL do escapador no formato exato em que o painel o
//   usa (dentro de valor de atributo);
// - o bloco de repeticao prova que o `return` por `e.repeat` existe e esta na
//   POSICAO certa, que e a metade sutil do defeito: no topo de `onKeyDown` ele
//   devolveria o Ctrl+S ao navegador.
//
// Controle negativo, conferido caso a caso ao escrever: desfazendo qualquer uma
// das seis interpolacoes escapadas, ou o `if (e.repeat) return;`, ou a trava de
// reentrancia, o `it()` correspondente reprova.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { escapeHtml } from '../../src/js/utilities/html-escape.js';

const PACOTE = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PAINEL = readFileSync(join(PACOTE, 'src/js/calibration/calibration-panel.js'), 'utf8');
const APP = readFileSync(join(PACOTE, 'src/js/calibration/app.js'), 'utf8');

/**
 * Devolve a UNICA linha que contem `ancora`, falhando alto quando a ancora
 * sumiu ou passou a aparecer mais de uma vez.
 *
 * Existe porque a forma ingenua (`texto.includes(...)`) fica verde quando a
 * ancora e renomeada: a verificacao passaria a nao verificar nada, que e
 * exatamente a cobertura vazia que a casa proibe.
 */
function linhaUnica(texto, ancora, arquivo) {
    const casos = texto.split('\n').filter((l) => l.includes(ancora));
    expect(casos.length, `esperada UMA linha com "${ancora}" em ${arquivo}, achadas ${casos.length}`).toBe(1);
    return casos[0];
}

/**
 * Monta o texto de uma interpolacao de template (`${expr}`) por concatenacao.
 *
 * Escrever a sequencia crua numa string literal e o que o `no-template-curly-in-string`
 * do eslint da casa proibe, e ele esta certo em geral: aqui o alvo E o texto do
 * arquivo, entao a excecao se monta em vez de se desligar.
 */
const CIFRAO = '$';
function interp(expr) {
    return `${CIFRAO}{${expr}}`;
}

describe('calibracao 360: dado do servidor escapado antes do innerHTML', () => {
    it('os seis sitios de nome/rotulo do painel passam por escapeHtml', () => {
        // REPROVA o estado anterior a esta correcao, em que `display_name` da
        // foto e do alvo, o rotulo da faixa e o nome do grupo entravam crus num
        // innerHTML (e um deles dentro de `title="..."`).

        // (a) Nome do alvo: aparece DUAS vezes, no render completo
        // (`renderTargetItem`) e no caminho rapido de `applyTargetedUpdates`.
        // A segunda e a que se esquece, porque o caminho rapido reescreve o
        // mesmo bloco sem passar pelo render.
        const nomesDeAlvo = PAINEL.split('\n').filter((l) => l.includes('cal-panel__target-name'));
        expect(nomesDeAlvo.length, 'os dois sitios de cal-panel__target-name sumiram').toBe(2);
        for (const linha of nomesDeAlvo) {
            expect(linha).toContain(interp('escapeHtml(displayName)'));
        }
        expect(PAINEL, 'ainda ha interpolacao crua de displayName').not.toMatch(/\$\{displayName\}/);

        // (b) Nome da foto no cabecalho.
        expect(linhaUnica(PAINEL, 'Foto: ', 'calibration-panel.js'))
            .toContain(interp('escapeHtml(camera.display_name || \'Sem nome\')'));

        // (c) e (d) Rotulo da faixa, no atributo title e no conteudo.
        expect(linhaUnica(PAINEL, 'title="Entrar na faixa', 'calibration-panel.js'))
            .toContain(interp('escapeHtml(faixa.label)'));
        expect(linhaUnica(PAINEL, 'cal-panel__run-label', 'calibration-panel.js'))
            .toContain(interp('escapeHtml(faixa.label)'));

        // (e) Nome do grupo na lista de fotos (deriva de `run.label`).
        expect(linhaUnica(PAINEL, 'cal-panel__faixa-nome', 'calibration-panel.js'))
            .toContain(interp('escapeHtml(nome)'));

        // (f) Os dois cartoes do seletor de projeto.
        expect(APP, 'app.js nao importa o escapador').toContain("import { escapeHtml } from '@utils/html-escape.js';");
        expect(linhaUnica(APP, 'project-selector__card-title', 'app.js')).toContain(interp('escapeHtml(p.name)'));
        expect(linhaUnica(APP, 'project-selector__card-location', 'app.js')).toContain(interp('escapeHtml(p.location)'));
    });

    it('nao escapa o que NAO e dado de usuario nem o que nao vai para innerHTML', () => {
        // O lado que a correcao erraria por excesso, e que nenhum teste de
        // "tem escapeHtml" pegaria: contador numerico escapado nao ganha
        // seguranca nenhuma, e texto de toast/confirmacao escapado passa a
        // MOSTRAR `&quot;` para o operador.
        expect(linhaUnica(PAINEL, 'cal-panel__run-count', 'calibration-panel.js')).not.toContain('escapeHtml');
        expect(linhaUnica(APP, 'project-selector__review-text', 'app.js')).not.toContain('escapeHtml');

        // Sem `<` nem `>` na linha: e string de dialogo/toast, nunca marcacao.
        const emTexto = PAINEL.split('\n').filter((l) => l.includes('faixa.label') && !/[<>]/.test(l));
        expect(emTexto.length, 'os usos de faixa.label em texto puro sumiram').toBeGreaterThan(0);
        for (const linha of emTexto) {
            expect(linha, `texto de dialogo/toast nao deve ser escapado: ${linha.trim()}`).not.toContain('escapeHtml');
        }
    });

    it('escapeHtml neutraliza a fuga de atributo no formato exato usado no title da faixa', () => {
        // Comportamento, e nao texto de arquivo: a carga que interessa aqui nao
        // usa `<` nem `>`, so a aspa que fecha o atributo.
        const rotulo = 'a" onmouseover="fetch(0)';
        const html = `<div data-run-id="r1" title="Entrar na faixa ${escapeHtml(rotulo)}">`;
        // Quatro aspas: as duas do data-run-id e as duas do title. Nenhuma a mais.
        expect(html.match(/"/g)).toHaveLength(4);
        expect(html).toContain('&quot;');

        // Bordas: nulo/indefinido viram string vazia, e valor falso-mas-valido
        // NAO pode sumir. `?? ''` nao protegeria o segundo caso.
        expect(escapeHtml(null)).toBe('');
        expect(escapeHtml(undefined)).toBe('');
        expect(escapeHtml(0)).toBe('0');
        expect(escapeHtml(NaN)).toBe('NaN');
        expect(escapeHtml('<img src=x onerror=y>')).not.toContain('<');
    });
});

describe('calibracao 360: tecla segurada nao dispara acao instantanea', () => {
    /** Posicao da primeira ocorrencia, falhando alto se a ancora sumiu. */
    function pos(ancora) {
        const i = APP.indexOf(ancora);
        expect(i, `ancora ausente em app.js: ${ancora}`).toBeGreaterThan(-1);
        return i;
    }

    it('o return por e.repeat fica DEPOIS de Ctrl+S/Escape/M/WASD e ANTES de Q/E/R/G/Z/X', () => {
        // REPROVA duas coisas: a ausencia do guarda (estado anterior, em que
        // segurar `E` marcava uma faixa inteira como revisada sem o operador
        // ver as fotos) e o guarda no lugar errado. Posto no topo de
        // `onKeyDown`, ele passaria por cima do `e.preventDefault()` do Ctrl+S
        // e o segundo keydown de um Ctrl+S segurado abriria o dialogo "Salvar
        // pagina" do navegador.
        const guarda = pos('if (e.repeat) return;');
        const ctrlS = pos("(e.ctrlKey || e.metaKey) && e.key === 's'");
        const escape = pos("if (e.key === 'Escape')");
        const wasd = pos("['w', 'a', 's', 'd'].includes(e.key)");
        const q = pos("if (e.key === 'q')");
        const e = pos("if (e.key === 'e')");

        expect(guarda).toBeGreaterThan(ctrlS);
        expect(guarda).toBeGreaterThan(escape);
        expect(guarda).toBeGreaterThan(wasd);
        expect(guarda).toBeLessThan(q);
        expect(guarda).toBeLessThan(e);
    });

    it('handleMarkReviewedAndNext tem trava de reentrancia liberada em finally', () => {
        // `e.repeat` cobre a tecla SEGURADA; nao cobre dois toques reais dentro
        // da janela dos awaits, em que o segundo roda sobre um
        // `state.currentPhotoId` que ainda nao andou.
        const inicio = pos('async function handleMarkReviewedAndNext()');
        const fim = APP.indexOf('\n}', inicio);
        expect(fim, 'nao achei o fim de handleMarkReviewedAndNext').toBeGreaterThan(inicio);
        const corpo = APP.slice(inicio, fim);

        expect(corpo).toContain('if (isReviewAdvancing) return;');
        expect(corpo).toContain('isReviewAdvancing = true;');
        expect(corpo).toMatch(/finally\s*\{[^}]*isReviewAdvancing = false;/);
        // A trava tem de viver FORA da funcao, senao ela nasce solta a cada chamada.
        expect(APP).toContain('let isReviewAdvancing = false;');
        expect(pos('let isReviewAdvancing = false;')).toBeLessThan(inicio);
    });
});
