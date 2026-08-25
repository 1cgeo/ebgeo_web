// Path: tests/unit/calibracao-sem-catppuccin.test.js

/**
 * @fileoverview A CALIBRAÇÃO 360 NÃO TEM MAIS TEMA PRÓPRIO, e este arquivo é quem cobra.
 *
 * `src/css/calibracao.css` chegou ao repositório vindo do ebgeo_360 com o Catppuccin inteiro
 * embutido, e o próprio cabeçalho do arquivo declarava a divergência: "um tema próprio
 * (Catppuccin) que não compartilha um único token com o resto do EBGeo". Eram 200 literais de
 * cor numa folha só, enquanto o resto da aplicação é claro e verde. O chefe olhou a tela em
 * 2026-08-25 e mandou a página entrar na FAMÍLIA visual do produto.
 *
 * POR QUE UM TESTE, E NÃO UMA LIÇÃO ESCRITA. Uma folha de estilo não quebra: um literal de cor
 * que volte a entrar aqui passa em todo lint, sobe no deploy e só é visto por quem abrir a tela.
 * A regressão é gratuita de cometer e cara de perceber, que é a assinatura da classe que este
 * repositório prende com guarda mecânico.
 *
 * SÃO TRÊS CASOS E CADA UM PEGA UM DESVIO DIFERENTE:
 *
 *   1. os 36 hexes NOMEADOS da paleta antiga não voltam — é a lista que o chefe pediu, e ela
 *      documenta o que existia;
 *   2. NENHUM literal de cor sobra, exceto `#fff` — este é o caso forte, porque ele reprova
 *      também a cor NOVA que ninguém previu, e é o que impede a lista acima de fossilizar;
 *   3. todo `var(--token)` que a folha consome está DECLARADO — sem ele, um nome de token
 *      digitado errado passaria como se fosse cor: `var()` que não resolve simplesmente não
 *      pinta, e a regra fica muda em vez de vermelha.
 *
 * O CONTROLE POSITIVO É PARTE DO CONTRATO. Uma folha vazia, truncada ou renomeada passaria nos
 * três casos acima por ausência, que é exatamente o verde mentiroso que a doutrina proíbe. Por
 * isso o primeiro `expect` de todos cobra que a folha AINDA é a folha da calibração.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const raiz = fileURLToPath(new URL('../..', import.meta.url));
const folha = readFileSync(`${raiz}src/css/calibracao.css`, 'utf8');
const tokens = readFileSync(`${raiz}src/css/design-tokens.css`, 'utf8');

/**
 * A paleta que saiu, hex a hex. As primeiras dezoito são Catppuccin Mocha (as que o chefe
 * citou estão entre elas); as demais são as cores avulsas que a mesma folha carregava sem
 * pertencer a família nenhuma: o amarelo do sol, o azul da IMU, os cinzas de cabeçalho de faixa
 * e os três do seletor de andar da busca.
 */
const PALETA_ANTIGA = [
    // Catppuccin Mocha: base, crust, mantle e as superfícies.
    '#1e1e2e', '#11111b', '#181825', '#313244', '#45475a', '#585b70', '#6c7086',
    // Texto e subtexto.
    '#cdd6f4', '#a6adc8',
    // Lavanda (o azul dos botões), verde, vermelho e pêssego, com seus hovers.
    '#89b4fa', '#b4befe', '#7ba8f0', '#a6e3a1', '#94e291', '#f38ba8', '#f07a9a', '#eba0ac',
    '#fab387',
    // As avulsas: amarelo de sol, azul de IMU, verde de manual, cinza de "nenhuma".
    '#ffd83b', '#6b5300', '#ffd479', '#63c7ff', '#14405c', '#6ee79b', '#1c5230',
    '#33383f', '#8b939c', '#9aa4b0',
    // Os cinzas de cabeçalho de faixa e o chevron.
    '#c9d1d9', '#21262d', '#2b3138', '#2a2f36', '#7d868f',
    // O seletor de andar da busca de vizinhas.
    '#e8e8e8', '#2a2a2a', '#444',
];

/**
 * A folha SEM COMENTÁRIO, que é o que estes casos precisam varrer.
 *
 * ELE LIA A PROSA JUNTO COM O CÓDIGO até 2026-08-25, e isso reprovou um comentário que
 * REGISTRAVA a remoção de um literal: "o vermelho deste botão vivia num `style=` inline, com o
 * literal `#e74c3c`". A frase é a memória da correção, e o guarda a tratava como reincidência.
 * Uma regra que proíbe NOMEAR a cor removida empurra o histórico para fora do arquivo, que é o
 * oposto do que este repositório quer. O guarda cobra o que PINTA, e comentário não pinta.
 */
function semComentarios(css) {
    return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Todo literal de cor da folha: hex, `rgb()` e `rgba()` que NÃO sejam composição de token. */
function literaisDeCor(css) {
    const achados = [];
    for (const m of semComentarios(css).matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g)) {
        // `rgb(var(--surface-dark-rgb) / 92%)` é token, não literal: o canal vem de `:root`.
        if (!m[0].includes('var(')) achados.push(m[0]);
    }
    return achados;
}

describe('calibracao.css entrou na família visual do EBGeo', () => {
    it('CONTROLE POSITIVO: a folha lida é mesmo a da calibração, e ela usa os tokens', () => {
        // Sem isto, um arquivo vazio ou renomeado passaria nos três casos abaixo por ausência.
        expect(folha.length).toBeGreaterThan(10000);
        expect(folha).toContain('#calibration-panel');
        expect(folha).toContain('.cal-panel__btn--save');
        // As cores de ação são as da casa: verde para confirmar, vermelho semântico para destruir.
        //
        // O VERDE É O 700, E NÃO O 600, e o degrau foi medido: `#fff` sobre `--primary-600` dá
        // 3,3:1, abaixo do piso de 4,5 da WCAG AA para texto miúdo. Sobre o 700 dá 4,9:1. Vale
        // para todo botão desta folha que carregue texto branco; o 600 segue pintando borda,
        // barra de progresso e realce, onde não há texto por cima.
        expect(folha).toMatch(/\.cal-panel__btn--save\s*\{[^}]*background:\s*var\(--primary-700\)/);
        expect(folha).toMatch(/\.cal-panel__btn--discard\s*\{[^}]*background:\s*var\(--color-error\)/);
        // E a superfície escura vem de token, não de hex.
        expect(folha).toContain('var(--surface-dark)');
        expect(folha).toContain('var(--on-dark)');
    });

    it('nenhum hex da paleta antiga sobrou', () => {
        const minuscula = folha.toLowerCase();
        const sobreviventes = PALETA_ANTIGA.filter((hex) => minuscula.includes(hex));
        expect(sobreviventes).toEqual([]);
        // A lista é grande de propósito: ela é o inventário do que foi trocado.
        expect(PALETA_ANTIGA).toHaveLength(36);
    });

    it('nenhum literal de cor sobrou, exceto o branco', () => {
        // O CASO FORTE. A lista acima envelhece; este não: ele reprova a cor NOVA também.
        // `#fff` fica de fora porque é o que a casa já escreve assim em `app-bar.css` e em
        // `admin.css` (`.admin-btn--primary { color: #fff }`), e não é cor de tema nenhum.
        const foraDoBranco = literaisDeCor(folha).filter((c) => c.toLowerCase() !== '#fff');
        expect(foraDoBranco).toEqual([]);
    });

    it('CONTROLE DO VARREDOR: ele apaga comentário, e só comentário', () => {
        // Sem isto, `semComentarios` poderia apagar a folha inteira e os dois casos acima
        // ficariam verdes varrendo string vazia, que é a cobertura vazia de sempre.
        const amostra = '/* diz #123456 */ a { color: #abcdef; } /* e #654321 */';
        expect(literaisDeCor(amostra)).toEqual(['#abcdef']);
        // E a folha real continua tendo corpo depois da poda.
        expect(semComentarios(folha).length).toBeGreaterThan(10000);
    });

    it('todo token que a folha consome está declarado', () => {
        // Um `var(--surface-dark-borderr)` não levanta erro em lugar nenhum: a declaração
        // simplesmente não pinta, e a regra fica muda. Aqui ela fica vermelha.
        const declarados = new Set(
            [...`${tokens}\n${folha}`.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]),
        );
        const consumidos = new Set([...folha.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
        expect(consumidos.size).toBeGreaterThan(20);
        const orfaos = [...consumidos].filter((t) => !declarados.has(t));
        expect(orfaos).toEqual([]);
    });

    it('a altura da barra é token, e não número mágico repetido', () => {
        // O afastamento do topo de cada painel de UI sai daqui. Um literal repetido mentiria
        // em todos os painéis de uma vez no dia em que a barra mudasse de altura.
        expect(tokens).toMatch(/--app-bar-height:\s*\d+px/);
        const usos = folha.match(/var\(--app-bar-height\)/g) || [];
        expect(usos.length).toBeGreaterThanOrEqual(6);
    });
});
