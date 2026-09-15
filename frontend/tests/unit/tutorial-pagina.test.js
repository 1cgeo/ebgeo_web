// Path: tests/unit/tutorial-pagina.test.js

/**
 * @fileoverview A QUINTA PÁGINA (`tutorial.html`, decisão D16 de 2026-09-15), nas duas metades que
 * um teste de node alcança.
 *
 * O QUE MUDOU: o tutorial era `frontend/public/docs/doc.html`, um HTML estático que o `publicDir`
 * copiava verbatim e que carregava o docsify 4.13.1 de `frontend/public/vendors/` por tag. Aqueles
 * dois arquivos eram os últimos vendors COM CONSUMIDOR da pasta, e nenhum `npm audit` os alcançava.
 * A página virou entrada do bundler e a biblioteca passou a vir do npm em versão exata.
 *
 * A METADE PURA é `reescreverMidiaRelativa`, e ela é a razão de este arquivo existir em vez de o
 * assunto morrer numa captura. O docsify só reescreve caminho relativo de imagem em SINTAXE
 * MARKDOWN; as 42 mídias do tutorial são HTML cru, e o endereço da página mudou de `/docs/doc.html`
 * para `/tutorial.html`, o que transforma todo `./images/...` em 404. O sintoma é a pior classe
 * possível: a página desenha, com barra lateral e texto, e só as figuras somem. Uma função pura com
 * bordas presas é o que impede isso de voltar em silêncio.
 *
 * A METADE ESTRUTURAL olha para o texto-fonte, pela mesma razão das guardas irmãs: o módulo de
 * entrada boota no import e monta o docsify sobre o DOM, então não há como carregá-lo em node e
 * perguntar o que ele fez. Ela prova a fiação e a ORDEM, nunca que a página desenhe bonito: isso é
 * captura, e foi lida.
 *
 * O QUE ESTE ARQUIVO NÃO COBRE, porque já tem dono: que a página não arraste a store
 * (`paginas-sem-mapa-nao-arrastam-a-store.test.js`, que a vigia como quarta pasta), que ela não
 * toque o acervo local (`portao-de-migracao-nas-quatro-paginas.test.js`), que ela entre no `input`
 * do Vite (`calibracao-pagina.test.js`, que conta as cinco entradas) e quanto ela pesa construída
 * (`teto-de-peso-da-pagina-do-mapa.test.js`).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { reescreverMidiaRelativa } from '@js/tutorial/caminhos-de-midia.js';

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ler = (rel) => readFileSync(join(FRONT, rel), 'utf8');

/** Apaga o CONTEÚDO dos comentários preservando as linhas: prosa que cita um import não é import. */
function semComentarios(texto) {
    return texto
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/(^|[^:])\/\/[^\n]*/g, (m, antes) => antes + ' '.repeat(m.length - antes.length));
}

describe('reescreverMidiaRelativa: o caminho relativo do HTML cru', () => {
    it('prefixa `./x` e `x`, e corta o `./` no caminho', () => {
        expect(reescreverMidiaRelativa('<img src="./images/a.png">', '/docs/'))
            .toBe('<img src="/docs/images/a.png">');
        expect(reescreverMidiaRelativa('<img src="images/a.png">', '/docs/'))
            .toBe('<img src="/docs/images/a.png">');
    });

    it('NÃO toca no que já é absoluto, em nenhuma das cinco formas', () => {
        // Cada uma destas já resolve sozinha, e prefixá-la seria quebrar um endereço que funciona.
        // O `#` está aqui porque uma âncora com `href` passa pelo mesmo atributo.
        for (const valor of [
            '/docs/images/a.png',
            'https://exemplo.mil.br/a.png',
            '//exemplo.mil.br/a.png',
            'data:image/png;base64,iVBOR',
            '#modulo-1'
        ]) {
            const entrada = `<img src="${valor}">`;
            expect(reescreverMidiaRelativa(entrada, '/docs/'), valor).toBe(entrada);
        }
    });

    it('aceita aspas simples e preserva a aspa que encontrou', () => {
        expect(reescreverMidiaRelativa("<img src='./images/a.png'>", '/docs/'))
            .toBe("<img src='/docs/images/a.png'>");
    });

    it('vale para `href` também, que é o outro atributo de endereço', () => {
        expect(reescreverMidiaRelativa('<a href="./exemplos/x.ebgeo">', '/docs/'))
            .toBe('<a href="/docs/exemplos/x.ebgeo">');
    });

    it('acrescenta a barra final que faltar na base', () => {
        // Sem isto, `/docs` produziria `/docsimages/a.png`, que é 404 sem nenhum sinal de erro.
        expect(reescreverMidiaRelativa('<img src="./images/a.png">', '/docs'))
            .toBe('<img src="/docs/images/a.png">');
    });

    it('entrada degenerada não lança e não inventa conteúdo', () => {
        expect(reescreverMidiaRelativa('', '/docs/')).toBe('');
        expect(reescreverMidiaRelativa(null, '/docs/')).toBe('');
        expect(reescreverMidiaRelativa(undefined, '/docs/')).toBe('');
        expect(reescreverMidiaRelativa(42, '/docs/')).toBe('');
        // Base vazia devolve o texto intacto: prefixar com nada seria trabalho e risco por nada.
        expect(reescreverMidiaRelativa('<img src="./a.png">', '')).toBe('<img src="./a.png">');
        expect(reescreverMidiaRelativa('<img src="./a.png">', null)).toBe('<img src="./a.png">');
        // `src` vazio é marcação inválida do autor, e reescrevê-la apontaria o navegador para o
        // diretório, o que dispara um pedido em vez de não disparar nenhum.
        expect(reescreverMidiaRelativa('<img src="">', '/docs/')).toBe('<img src="">');
    });

    it('sobre o README real: as 42 mídias são reescritas e nenhuma sobra relativa', () => {
        // O caso que amarra a função ao conteúdo que ela serve. Se o tutorial ganhar uma figura, a
        // contagem sobe aqui e ninguém precisa lembrar de nada; se alguém trocar o HTML cru por
        // sintaxe markdown, este caso cai e a decisão volta à mesa.
        const md = ler('public/docs/README.md');
        const antes = [...md.matchAll(/src="\.\/images\//g)].length;
        expect(antes, 'o README deixou de trazer mídia relativa: a função perdeu o sujeito')
            .toBe(42);

        const depois = reescreverMidiaRelativa(md, '/docs/');
        expect([...depois.matchAll(/src="\/docs\/images\//g)]).toHaveLength(42);
        expect(depois.includes('src="./'), 'sobrou caminho relativo no texto reescrito').toBe(false);
    });
});

describe('a fiação da quinta página', () => {
    const HTML = ler('tutorial.html');
    const ENTRY = semComentarios(ler('src/js/tutorial/tutorial-page.js'));
    const PONTO = semComentarios(ler('src/js/vendor/docsify.js'));

    it('`tutorial.html` declara o módulo de entrada, e ele existe', () => {
        expect(HTML).toMatch(/<script\s+type="module"\s+src="\/src\/js\/tutorial\/tutorial-page\.js"/);
        expect(existsSync(join(FRONT, 'src/js/tutorial/tutorial-page.js'))).toBe(true);
        // O container que o docsify monta (`el: '#app'`, o padrão): sem ele a página sobe e não
        // desenha, sem erro nenhum.
        expect(HTML).toContain('id="app"');
    });

    it('não carrega nada de origem externa, nem por CDN nem por importmap', () => {
        // Mesma régua de `calibracao-pagina.test.js`, e pela mesma razão: vendor remoto quebra a
        // aplicação na rede da caserna, que é o ambiente normal aqui.
        for (const proibido of ['cdn.jsdelivr.net', 'unpkg', 'importmap', 'esm.sh', 'cdnjs']) {
            expect(HTML.toLowerCase(), `tutorial.html cita ${proibido}`).not.toContain(proibido);
        }
        const externos = [...HTML.matchAll(/(?:src|href)\s*=\s*"([^"]+)"/g)]
            .map((m) => m[1])
            .filter((u) => /^(?:https?:)?\/\//i.test(u));
        expect(externos, `atributo apontando para origem externa:\n${externos.join('\n')}`).toEqual([]);
    });

    it('a ORDEM dos imports do entry é contrato: o ponto único antes da folha da casa', () => {
        // O ponto único traz `dist/themes/core.css` no corpo dele e esta folha traz a paleta. Como
        // módulos são avaliados na ordem textual, inverter faria o tema do pacote sobrescrever a
        // paleta, e nada ficaria vermelho: só a cor erraria.
        const imports = [...ENTRY.matchAll(/^import\s+(?:[^;'"]*?\s+from\s+)?'([^']+)'/gm)]
            .map((m) => m[1]);
        expect(imports[0], 'o ponto único do docsify não é o primeiro import do entry')
            .toBe('@js/vendor/docsify.js');
        expect(imports.indexOf('@css/tutorial.css')).toBeGreaterThan(0);
    });

    it('o entry monta o docsify e aponta o `basePath` para onde o markdown mora', () => {
        expect(ENTRY).toContain('montarDocsify(');
        // `docs/` resolvido contra a URL da página, e não `/docs/` escrito à mão: é o que mantém a
        // página viva num deploy sob subcaminho.
        expect(ENTRY).toMatch(/new URL\('docs\/', window\.location\.href\)/);
        expect(ENTRY).toContain('basePath');
        // E o gancho que reescreve as mídias está ligado: sem ele a página desenha sem figura
        // nenhuma, que é o defeito silencioso que a metade pura acima existe para prender.
        expect(ENTRY).toContain('beforeEach');
        expect(ENTRY).toContain('reescreverMidiaRelativa');
    });

    it('o ponto único importa a 5 e NUNCA a 4, que o pacote ainda publica', () => {
        // A armadilha desta migração: `docsify/lib/` continua dentro do tarball da 5.0.0 e contém
        // o build da v4 com um `console.warn` de depreciação anexado. O caminho velho resolve, roda
        // e o único sinal é uma linha no console.
        expect(PONTO).toContain("from 'docsify'");
        expect(PONTO).toContain("import 'docsify/dist/themes/core.css'");
        expect(PONTO, 'o ponto único voltou a apontar para `docsify/lib/`, que é a v4')
            .not.toContain('docsify/lib');
        // O add-on `vue` fica FORA de propósito: a primeira linha dele é um `@import` de fontes do
        // Google, que o Vite não inlina e que a rede de destino não alcança.
        expect(PONTO).not.toContain('themes/addons');
        expect(ler('src/css/tutorial.css')).not.toContain('fonts.googleapis.com');
    });

    it('a versão do docsify é EXATA no package.json, como os outros pontos únicos', () => {
        // Intervalo (`^5.0.0`) devolveria o problema que esta migração fechou: a pergunta "há aviso
        // publicado sobre a versão que roda?" precisa de uma versão para ser feita.
        const pkg = JSON.parse(ler('package.json'));
        const versao = pkg.dependencies?.docsify ?? pkg.devDependencies?.docsify;
        expect(versao, 'docsify saiu do package.json').toBeTruthy();
        expect(versao, `docsify pinado com intervalo: ${versao}`).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('os dois vendors do tutorial continuam apagados, e a página antiga também', () => {
        // O outro lado da migração, e ele não é decorativo: um `doc.html` sobrevivente continuaria
        // sendo servido pelo `publicDir`, apontando para dois arquivos que não existem mais, e o
        // botão Tutorial de um `/api/config` antigo ainda o alcançaria.
        for (const morto of [
            'public/vendors/docsify.min.js',
            'public/vendors/vue.css',
            'public/docs/doc.html'
        ]) {
            expect(existsSync(join(FRONT, morto)), `${morto} voltou a existir`).toBe(false);
        }
        // E o conteúdo, que NÃO saiu de `public/`: ele é conteúdo, não código.
        expect(existsSync(join(FRONT, 'public/docs/README.md'))).toBe(true);
    });

    it('o destino do botão Tutorial é a página nova nos TRÊS sítios, e eles cruzam os pacotes', () => {
        // O padrão que o servidor publica e as duas cópias que o cliente carrega como último
        // recurso. Enquanto os três não dizem a mesma coisa, um deles manda a pessoa para uma
        // página que não existe mais, e só o caminho que passa por aquele sítio percebe.
        const backend = readFileSync(
            join(FRONT, '../backend/src/modules/config/config.static.js'), 'utf8');
        expect(backend).toContain("tutorialUrl: './tutorial.html'");
        for (const rel of [
            'src/js/sidebar/components/chips.component.js',
            'src/js/phone/phone-layout.js'
        ]) {
            const codigo = semComentarios(ler(rel));
            expect(codigo, `${rel} ainda cai no endereço antigo`).toContain("'./tutorial.html'");
            expect(codigo, `${rel} ainda cita a página estática`).not.toContain('docs/doc.html');
        }
    });
});
