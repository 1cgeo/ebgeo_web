// Path: tests/unit/um-verde-so.test.js

/**
 * UM VERDE SÓ: `--primary` é o verde do produto, e todo verde SÓLIDO de marca é ele.
 *
 * Decisão do dono em 2026-09-20, depois de contar quatro verdes convivendo na tela: o primário, o
 * cromo da barra lateral e dos cabeçalhos (um degrau mais escuro), a faixa superior de `atlas.html`
 * e `admin.html` (gradiente de dois degraus ainda mais escuros) e um verde-oliva antigo (#508D4E)
 * que era o fundo de toda tela de carregamento dos HTML, a `theme-color` do navegador e os
 * marcadores e ilustrações escritos em JS.
 *
 * POR QUE UM TESTE E NÃO SÓ O TOKEN. Três desses verdes NÃO PODEM ler o token: a tela de abertura é
 * desenhada por um `<style>` inline que precede o CSS, a `<meta name="theme-color">` é um atributo,
 * e o JS que pinta marcador no mapa e ilustração em SVG escreve hexadecimal. São cópias à mão do
 * valor de `--primary`, e cópia à mão só anda junto se algo reprovar quando ela fica para trás: foi
 * assim que o oliva sobreviveu a uma troca inteira de paleta.
 *
 * O que fica DE FORA, de propósito: estados (`--primary-hover`, o pressionado), que são mais escuros
 * por definição; tintas translúcidas; a cor de FEIÇÃO do mapa, que é dado do usuário; e o logotipo,
 * que é imagem.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ler = (rel) => readFileSync(join(FRONT, rel), 'utf8');

const TOKENS = ler('src/css/design-tokens.css');

/** Resolve um custom property de `design-tokens.css` até o hexadecimal, seguindo `var()`. */
function resolverToken(nome, profundidade = 0) {
    if (profundidade > 5) throw new Error(`ciclo ao resolver ${nome}`);
    const m = TOKENS.match(new RegExp(`^\\s*${nome}:\\s*([^;]+);`, 'm'));
    if (!m) throw new Error(`token ${nome} não existe em design-tokens.css`);
    const valor = m[1].trim();
    const ref = valor.match(/^var\((--[a-z0-9-]+)\)$/i);
    return ref ? resolverToken(ref[1], profundidade + 1) : valor.toLowerCase();
}

const PRIMARIO = resolverToken('--primary');
const OLIVA = '#508d4e';

describe('um verde só', () => {
    it('`--primary` resolve para um hexadecimal, e é dele que o resto deste arquivo fala', () => {
        // Controle do instrumento: um resolvedor que devolvesse `undefined` faria toda igualdade
        // abaixo passar comparando nada com nada.
        expect(PRIMARIO).toMatch(/^#[0-9a-f]{6}$/);
    });

    it('o cromo (barra lateral, cabeçalho de painel e de modal) É o primário, não um degrau próprio', () => {
        expect(resolverToken('--sidebar-bg')).toBe(PRIMARIO);
    });

    it('a faixa superior das páginas sem mapa é o primário CHAPADO, não um gradiente de outros degraus', () => {
        // Sem comentário: o da própria regra CONTA que ela já foi um gradiente, e a palavra casava.
        const semComentario = ler('src/css/app-bar.css').replace(/\/\*[\s\S]*?\*\//g, '');
        const regra = semComentario.match(/\.app-bar\s*\{[^}]*\}/);
        expect(regra, 'a regra `.app-bar` sumiu').not.toBeNull();
        expect(regra[0]).toMatch(/background:\s*var\(--primary\);/);
        expect(regra[0]).not.toMatch(/gradient/);
    });

    it('a tela de abertura dos QUATRO HTML que a têm usa o valor de `--primary`, escrito à mão', () => {
        const paginas = ['index.html', 'atlas.html', 'admin.html', 'calibracao.html'];
        for (const pagina of paginas) {
            const bloco = ler(pagina).match(/\.loading-background\s*\{[^}]*\}/);
            expect(bloco, `${pagina} não tem mais a regra inline da tela de abertura`).not.toBeNull();
            const cor = bloco[0].match(/background-color:\s*(#[0-9a-fA-F]{6})/);
            expect(cor, `${pagina}: a abertura não declara cor de fundo em hexadecimal`).not.toBeNull();
            expect(cor[1].toLowerCase(), pagina).toBe(PRIMARIO);
        }
    });

    it('a `theme-color` das CINCO páginas é o valor de `--primary`', () => {
        const paginas = ['index.html', 'atlas.html', 'admin.html', 'calibracao.html', 'tutorial.html'];
        for (const pagina of paginas) {
            const meta = ler(pagina).match(/<meta name="theme-color" content="(#[0-9a-fA-F]{6})">/);
            expect(meta, `${pagina} não declara theme-color`).not.toBeNull();
            expect(meta[1].toLowerCase(), pagina).toBe(PRIMARIO);
        }
    });

    it('as telas de carga dos visualizadores pintam o fundo com `var(--primary)`', () => {
        const alvos = [
            ['src/css/panels-3d.css', /#loading-screen-3d\s*\{[^}]*\}/],
            ['src/css/first-person-3d.css', /\.fp3d-loading\s*\{[^}]*\}/],
            ['src/css/base.css', /\.loading-background\s*\{[^}]*\}/],
        ];
        for (const [arquivo, re] of alvos) {
            const regra = ler(arquivo).match(re);
            expect(regra, `${arquivo}: a regra da tela de carga sumiu`).not.toBeNull();
            expect(regra[0], arquivo).toMatch(/background(-color)?:\s*var\(--primary\)/);
        }
    });

    it('o verde-oliva antigo não volta: fora de comentário, zero ocorrências em `src/` e nos HTML', () => {
        const rastreados = execSync('git ls-files src index.html atlas.html admin.html calibracao.html tutorial.html', {
            cwd: FRONT, encoding: 'utf8',
        }).split(/\r?\n/).filter((f) => /\.(js|css|html)$/.test(f));
        // Piso do inventário: um `git ls-files` que devolvesse pouco faria o laço verificar nada.
        expect(rastreados.length).toBeGreaterThan(400);

        // O HEXADECIMAL É SÓ UMA GRAFIA. Até 2026-09-24 este caso procurava só `#508d4e`, e o oliva
        // sobreviveu como `rgba(80, 141, 78, …)` em 42 declarações de CSS (anel de foco, tinta, o
        // fundo da exportação de PDF) e como `[80, 141, 78]` na paleta do mosaico do PDF: a mesma
        // cor escrita em canais, que a busca pelo hexadecimal não enxerga.
        const CANAIS = /\b80\s*,\s*141\s*,\s*78\b|\b80\s+141\s+78\b/;
        const achados = [];
        for (const arquivo of rastreados) {
            let texto = ler(arquivo);
            // Os comentários de CSS CONTAM a história do oliva, e é para contarem. O que não pode é
            // ele pintar alguma coisa.
            if (arquivo.endsWith('.css')) texto = texto.replace(/\/\*[\s\S]*?\*\//g, '');
            if (texto.toLowerCase().includes(OLIVA) || CANAIS.test(texto)) achados.push(arquivo);
        }
        expect(achados).toEqual([]);
    });

    it('nenhum gradiente mistura degraus SÓLIDOS do verde: gradiente é dois verdes lado a lado', () => {
        // O cabeçalho do painel de feição e o selo do cartão de briefing eram os dois que sobravam,
        // e o primeiro tinha sido escrito NO MESMO DIA da decisão, sem nada acusar. Os degraus
        // claros (50, 100, 200) ficam de fora: são fundo de estado, não verde de marca.
        const folhas = execSync('git ls-files src/css', { cwd: FRONT, encoding: 'utf8' })
            .split(/\r?\n/).filter((f) => f.endsWith('.css'));
        expect(folhas.length).toBeGreaterThan(40);

        const SOLIDO = /gradient\([^;]*var\(--(primary(-(500|600|700|800|900|hover|dark))?|sidebar-bg)\)/;
        const achados = [];
        for (const folha of folhas) {
            const texto = ler(folha).replace(/\/\*[\s\S]*?\*\//g, '');
            if (SOLIDO.test(texto)) achados.push(folha);
        }
        expect(achados).toEqual([]);
    });

    it('o JS que não pode ler token escreve o valor de `--primary`', () => {
        const controle3d = ler('src/js/3d_models_viewer_tool/add_3d_models_viewer_control.js');
        const cor = controle3d.match(/const PRIMARY_COLOR = '(#[0-9a-fA-F]{6})';/);
        expect(cor, 'a constante do marcador de modelo 3D sumiu').not.toBeNull();
        expect(cor[1].toLowerCase()).toBe(PRIMARIO);
        // As ilustrações do catálogo e as camadas do PDF exportado usavam o oliva em 23 pontos.
        expect(ler('src/js/catalog/catalog.constants.js').toLowerCase()).toContain(PRIMARIO);
        expect(ler('src/js/import_export/pdf-export.tab.js').toLowerCase()).toContain(PRIMARIO);
        // O mosaico do PDF escreve a paleta em canais RGB para o jsPDF, e não em hexadecimal.
        const mosaico = ler('src/js/import_export/pdf-mosaic-pages.js')
            .match(/const PRIMARY = \[(\d+),\s*(\d+),\s*(\d+)\];/);
        expect(mosaico, 'a constante PRIMARY do mosaico do PDF sumiu').not.toBeNull();
        const hexDoMosaico = `#${mosaico.slice(1, 4).map((c) => Number(c).toString(16).padStart(2, '0')).join('')}`;
        expect(hexDoMosaico).toBe(PRIMARIO);
    });
});
