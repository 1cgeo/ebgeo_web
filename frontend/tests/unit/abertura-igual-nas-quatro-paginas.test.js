// Path: tests/unit/abertura-igual-nas-quatro-paginas.test.js

/**
 * A tela de abertura é A MESMA nas quatro páginas que a têm: logotipo de 300 px e barra de progresso.
 *
 * Pedido do dono em 2026-09-20. `index.html` desenhava logotipo de 300 px com barra, e `atlas.html`,
 * `admin.html` e `calibracao.html` desenhavam só o logotipo, a 240 px. Entrar no produto passa por
 * duas delas em sequência (seletor de atlas e depois o mapa), então a diferença aparecia como um
 * salto do logotipo e uma barra que surgia do nada.
 *
 * A abertura é `<style>` inline, porque precede o CSS, logo não há folha compartilhada: são quatro
 * cópias escritas à mão, e cópia à mão só anda junto se algo reprovar quando uma fica para trás. As
 * telas de carga dos visualizadores (3D e primeira pessoa) entram aqui pela mesma razão de tela: a
 * pessoa vê o mesmo símbolo e espera a mesma barra.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ler = (rel) => readFileSync(join(FRONT, rel), 'utf8');
const semComentarioHtml = (t) => t.replace(/<!--[\s\S]*?-->/g, '');

const PAGINAS = ['index.html', 'atlas.html', 'admin.html', 'calibracao.html'];

/** O bloco `#initial-loader` inteiro, sem comentário, com o espaço em branco normalizado. */
function blocoDeAbertura(pagina) {
    const html = semComentarioHtml(ler(pagina));
    const inicio = html.indexOf('<div class="loading-background" id="initial-loader">');
    if (inicio < 0) return null;
    // O bloco fecha no terceiro `</div>` aninhado: conteúdo > barra > preenchimento.
    const resto = html.slice(inicio);
    const fim = resto.search(/<\/div>\s*<\/div>\s*<\/div>/);
    return fim < 0 ? resto.slice(0, 400) : resto.slice(0, fim).replace(/\s+/g, ' ').trim();
}

describe('a abertura é igual nas quatro páginas', () => {
    it.each(PAGINAS)('%s desenha logotipo, barra e preenchimento', (pagina) => {
        const bloco = blocoDeAbertura(pagina);
        expect(bloco, `${pagina} perdeu o #initial-loader`).not.toBeNull();
        expect(bloco).toContain('class="loading-content"');
        expect(bloco).toContain('class="progress-bar"');
        expect(bloco).toContain('class="progress-fill"');
        expect(bloco).toContain('/images/logo_ebgeo.webp');
    });

    it.each(PAGINAS)('%s declara o logotipo a 300 px de largura', (pagina) => {
        const img = blocoDeAbertura(pagina).match(/<img[^>]*>/);
        expect(img).not.toBeNull();
        // `index.html` escreve a largura por estilo e as outras por atributo; o número é o contrato.
        expect(img[0]).toMatch(/width(="|:\s*)300/);
    });

    it.each(PAGINAS)('%s traz as regras inline da barra, com a animação que a preenche', (pagina) => {
        const estilo = ler(pagina).match(/<style>[\s\S]*?<\/style>/);
        expect(estilo, `${pagina} não tem <style> inline`).not.toBeNull();
        const css = estilo[0].replace(/\/\*[\s\S]*?\*\//g, '');
        expect(css).toMatch(/\.progress-bar\s*\{[^}]*width:\s*200px/);
        expect(css).toMatch(/\.progress-fill\s*\{[^}]*animation:\s*progressLoad/);
        expect(css).toMatch(/@keyframes progressLoad/);
        expect(css).toMatch(/\.loading-content\s*\{[^}]*flex-direction:\s*column/);
    });

    it('as cargas dos visualizadores também têm barra (3D em JS, primeira pessoa no HTML do mapa)', () => {
        const carga3d = ler('src/js/ui/loading-screen-3d.js');
        expect(carga3d).toContain('loading-3d-bar-fill');
        const mapa = semComentarioHtml(ler('index.html'));
        const fp = mapa.slice(mapa.indexOf('id="first-person-loading"'));
        expect(fp.slice(0, 600)).toContain('loading-3d-bar-fill');
    });
});
