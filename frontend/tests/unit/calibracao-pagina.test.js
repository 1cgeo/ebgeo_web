// Path: tests/unit/calibracao-pagina.test.js
//
// Trava a ESTRUTURA e o VOCABULARIO do porte da app de calibracao 360.
//
// Por que existe: a app veio do repositorio `ebgeo_360`, onde ela era um estatico
// solto servido pelo proprio Fastify. La ela carregava MapLibre e Three de
// `cdn.jsdelivr.net`, resolvia `import * as THREE from 'three'` por um
// `<script type="importmap">`, falava com o prefixo `/api/v1` e carregava todo o
// seu CSS num `<style>` gigante dentro do HTML. Aqui ela e a QUARTA entrada do
// Vite: vendor local, prefixo `/api/v1/sv360` vindo do config em tempo de
// execucao, e folha de estilo propria.
//
// Nada disso e verificavel pelos testes de comportamento: sao propriedades do
// ARQUIVO, e um porte pela metade compila, sobe e roda em modo dev (onde o Vite
// resolve bare specifier por node_modules) para so quebrar no `build`. O objetivo
// aqui e que a metade que sobrou da origem falhe no `npm test`.
//
// Cada `it()` abaixo REPROVA o estado anterior ao porte: rodado contra a versao
// da origem, ou contra a versao de tres entradas deste `vite.config.js`, falha.
//
// O que este arquivo NAO cobre, de proposito: o contrato de rede do cliente, que
// e assunto de `tests/unit/calibracao-api.test.js`.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Raiz do PACOTE (frontend/), dois niveis acima: tudo o que este arquivo vigia
// (calibracao.html, vite.config.js, src/, public/) e do pacote, nao do monorepo.
const PACOTE = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const DIR_CALIBRACAO = join(PACOTE, 'src/js/calibration');
const HTML = readFileSync(join(PACOTE, 'calibracao.html'), 'utf8');
const VITE = readFileSync(join(PACOTE, 'vite.config.js'), 'utf8');

/** Os modulos de `src/js/calibration/`, lidos uma vez: nome relativo -> texto. */
const MODULOS = readdirSync(DIR_CALIBRACAO)
    .filter((f) => f.endsWith('.js'))
    .map((f) => ({ nome: `src/js/calibration/${f}`, texto: readFileSync(join(DIR_CALIBRACAO, f), 'utf8') }));

/**
 * Resolve uma URL absoluta do HTML para o arquivo real no disco.
 *
 * O Vite serve `/src/...` da raiz do pacote e `/vendors/...` de `publicDir`
 * (`public/`), entao o mesmo prefixo de URL sai de dois lugares diferentes do
 * disco. Sem isto o teste checaria a string e nunca o arquivo, que e a classe de
 * verificacao que nao pode reprovar.
 */
function noDisco(url) {
    const limpa = url.replace(/^\//, '');
    return [join(PACOTE, limpa), join(PACOTE, 'public', limpa)].find(existsSync) ?? null;
}

/**
 * Apaga o conteudo dos comentarios PRESERVANDO a contagem de linhas, para o
 * numero relatado continuar batendo com o do editor.
 *
 * Existe porque a primeira versao do caso do prefixo reprovou o codigo CERTO: os
 * dois unicos `/api/v1` crus do diretorio estao em comentario, e os dois estao la
 * justamente para dizer que aquele prefixo e o da ORIGEM e responde 404 aqui.
 * Proibir a documentacao de nomear o que ela descarta e o inverso do que se quer.
 *
 * O `//` so conta quando nao vem colado num `:`, para poupar `https://` dentro de
 * string. E o proibido aqui e o prefixo de rota, nunca uma URL absoluta.
 */
function semComentarios(texto) {
    return texto
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/(^|[^:])\/\/[^\n]*/g, (m, antes) => antes + ' '.repeat(m.length - antes.length));
}

/**
 * Varre os modulos e devolve `arquivo:linha` de cada linha que casa.
 *
 * `ignorarComentarios` decide se a prosa conta. Para o prefixo de rota ela NAO
 * conta (comentario nao monta URL); para o PMTiles ela conta de proposito, porque
 * la o que se vigia e o que os arquivos AFIRMAM.
 */
function linhasQueCasam(regex, { ignorarComentarios = false } = {}) {
    const teste = new RegExp(regex.source, regex.flags.replace('g', ''));
    const achados = [];
    for (const { nome, texto } of MODULOS) {
        const alvo = ignorarComentarios ? semComentarios(texto) : texto;
        alvo.split('\n').forEach((linha, i) => {
            if (teste.test(linha)) achados.push(`${nome}:${i + 1}: ${linha.trim()}`);
        });
    }
    return achados;
}

describe('pagina de calibracao 360 (porte do ebgeo_360)', () => {
    it('coleta os modulos de src/js/calibration (guarda contra a lista esvaziar em silencio)', () => {
        // REPROVA: uma renomeacao da pasta que zeraria a coleta e faria todos os
        // casos de vocabulario abaixo passarem verdes sem olhar arquivo nenhum.
        expect(MODULOS.length).toBeGreaterThanOrEqual(10);
        expect(MODULOS.map((m) => m.nome)).toContain('src/js/calibration/calibracao-page.js');
    });

    it('vite.config.js declara as QUATRO entradas do multi-pagina', () => {
        // REPROVA a versao anterior do bundler, de TRES entradas: sem
        // `calibracao.html` no `input`, a pagina nao entra no build e o `dist/`
        // sai sem ela, ainda que o `npm run dev` a sirva normalmente.
        const bloco = VITE.match(/input:\s*\{([\s\S]*?)\}/);
        expect(bloco, 'bloco `input:` nao encontrado em vite.config.js').not.toBeNull();

        const paginas = [...bloco[1].matchAll(/resolve\(__dirname,\s*'([^']+\.html)'\)/g)].map((m) => m[1]);
        expect(paginas.sort()).toEqual(['admin.html', 'calibracao.html', 'index.html', 'projetos.html']);

        for (const pagina of paginas) {
            expect(existsSync(join(PACOTE, pagina)), `entrada declarada e inexistente: ${pagina}`).toBe(true);
        }

        // A regra de chunk propria da pagina: sem ela os 14 modulos caem no bundle
        // da entrada e se misturam com o que `entriesAware` separa por outro criterio.
        expect(VITE).toContain('src/js/calibration/');
        expect(VITE).toContain("return 'calibration';");
    });

    it('calibracao.html aponta para o modulo, o CSS e o vendor local, e os tres existem', () => {
        // REPROVA o HTML da origem, que nao tinha nem `calibracao-page.js` (o boot
        // era inline), nem folha de estilo externa, nem vendor local.
        const referencias = [
            '/src/js/calibration/calibracao-page.js',
            '/src/css/calibracao.css',
            '/vendors/maplibre-gl.js',
        ];
        for (const url of referencias) {
            expect(HTML, `calibracao.html nao referencia ${url}`).toContain(url);
            expect(noDisco(url), `referencia sem arquivo no disco: ${url}`).not.toBeNull();
        }

        // O modulo entra como `type="module"`; o MapLibre entra como script CLASSIC,
        // porque `window.maplibregl` precisa existir antes do primeiro mapa montar.
        expect(HTML).toMatch(/<script\s+type="module"\s+src="\/src\/js\/calibration\/calibracao-page\.js"/);
        expect(HTML).toMatch(/<script\s+src="\/vendors\/maplibre-gl\.js"><\/script>/);
    });

    it('calibracao.html nao carrega nada de CDN externo nem usa importmap', () => {
        // REPROVA o HTML da origem, que trazia MapLibre e Three de
        // `cdn.jsdelivr.net` e resolvia o bare specifier `three` por
        // `<script type="importmap">`. Vendor remoto quebra a app quando a rede
        // da caserna nao alcanca a internet, que e o caso normal aqui.
        for (const proibido of ['cdn.jsdelivr.net', 'unpkg', 'importmap', 'esm.sh', 'cdnjs']) {
            expect(HTML.toLowerCase(), `calibracao.html ainda cita ${proibido}`).not.toContain(proibido);
        }

        // A regra generica, que pega o CDN que ainda nao tem nome nesta lista:
        // nenhum `src=`/`href=` pode ser absoluto para outra origem.
        const externos = [...HTML.matchAll(/(?:src|href)\s*=\s*"([^"]+)"/g)]
            .map((m) => m[1])
            .filter((u) => /^(?:https?:)?\/\//i.test(u));
        expect(externos, `atributo apontando para origem externa:\n${externos.join('\n')}`).toEqual([]);
    });

    it('nenhum modulo importa three como bare specifier, e o vendor apontado existe', () => {
        // REPROVA a origem, que fazia `import * as THREE from 'three'` e dependia
        // do importmap do HTML para resolver. Sem importmap isso so funciona em
        // modo dev (o Vite acha em node_modules) e o build quebra ou embute uma
        // copia diferente da que o street_view do mapa ja usa.
        const bare = linhasQueCasam(/^\s*import\s[^'"]*['"]three(?:\/[^'"]*)?['"]/);
        expect(bare, `import de 'three' como bare specifier:\n${bare.join('\n')}`).toEqual([]);

        // E o outro lado da mesma assercao: o caminho relativo apontado tem de
        // existir no disco. Um caminho errado tambem nao e bare specifier.
        const apontados = [];
        for (const { nome, texto } of MODULOS) {
            for (const m of texto.matchAll(/from\s+['"](\.[^'"]*three[^'"]*\.js)['"]/g)) {
                const alvo = resolve(dirname(join(PACOTE, nome)), m[1]);
                apontados.push({ nome, especificador: m[1], alvo });
            }
        }
        expect(apontados.length, 'nenhum modulo importa o Three local: a coleta quebrou').toBeGreaterThan(0);
        for (const { nome, especificador, alvo } of apontados) {
            expect(especificador).toContain('three.module.js');
            expect(existsSync(alvo), `${nome} importa ${especificador}, que nao existe no disco`).toBe(true);
        }
    });

    it('nenhum modulo LE os campos displayName/sequenceNumber da API da origem', () => {
        // REPROVA o cliente da origem, cujo JSON trazia `displayName` e
        // `sequenceNumber` em camelCase. Este backend devolve `display_name`, e
        // `sequenceNumber` nao existe: ler o nome antigo nao quebra nada em
        // runtime, so entrega `undefined` e uma tela que mente.
        //
        // A assercao e precisa de proposito: proibe a LEITURA com ponto
        // (`x.displayName`), nao o identificador. `displayName` como VARIAVEL
        // LOCAL, como PARAMETRO (`showPreview(targetId, displayName, ...)` em
        // preview-viewer.js) e como CHAVE de objeto que o proprio cliente monta
        // (`displayName: t.display_name` em minimap.js) sao legitimos e ficam.
        // Medido antes de escrever: 17 ocorrencias do identificador nos modulos
        // de hoje, ZERO delas com ponto.
        const leituras = linhasQueCasam(/\.(displayName|sequenceNumber)\b/);
        expect(
            leituras,
            'leitura de campo em camelCase da API da origem. Este backend fala snake_case'
                + ` (display_name); use uma variavel local se o que voce quer e o nome de exibicao:\n${leituras.join('\n')}`
        ).toEqual([]);
    });

    it('nenhum modulo monta URL com o prefixo /api/v1 da origem', () => {
        // REPROVA o `api.js` da origem, que abria com `const BASE = '/api/v1'` e
        // concatenava `/photos`, `/projects`, `/targets` e `/runs`. Aqui o prefixo
        // e `/api/v1/sv360` e vem de `config.streetView360.serviceUrl`, ou seja,
        // do `GET /api/config` em tempo de execucao. Os caminhos antigos respondem
        // 404 neste backend.
        const antigos = linhasQueCasam(/\/api\/v1\/(photos|projects|targets|runs)\b/, { ignorarComentarios: true });
        expect(
            antigos,
            `caminho do servico 360 da origem, que responde 404 aqui:\n${antigos.join('\n')}`
        ).toEqual([]);

        // E o prefixo cru numa string, que e a forma exata do `const BASE` de la.
        const baseCrua = linhasQueCasam(/['"`]\/api\/v1['"`]/, { ignorarComentarios: true });
        expect(
            baseCrua,
            `prefixo '/api/v1' embutido; o desta app e serviceUrl, do config:\n${baseCrua.join('\n')}`
        ).toEqual([]);
    });

    it('nenhum modulo trata PMTiles ou tippecanoe como coisa a gerar', () => {
        // REPROVA a origem, que servia o mapa do projeto de um PMTiles gerado por
        // tippecanoe. Este backend declara o PMTiles DESCONTINUADO e serve MVT do
        // PostGIS, e o modo mapa daqui nem consome tile vetorial: desenha uma
        // fonte geojson montada do payload de `/projects/:slug/map`.
        //
        // A forma da assercao foi decidida depois do grep, nao antes. Existem hoje
        // DUAS mencoes ao termo, e as duas sao negacoes: o cabecalho de
        // project-map.js ("Nada de PMTiles: este backend declara o PMTiles
        // descontinuado") e o texto do dialogo de exclusao em app.js ("e nao um
        // PMTiles a regenerar"). A segunda esta numa STRING de interface, nao num
        // comentario, entao "so em comentario" reprovaria o codigo certo. A regra
        // que passa pelo motivo certo e esta: qualquer mencao tem de NEGAR o uso.
        const CODIGO_PMTILES = /\bnew\s+PMTiles\b|\baddProtocol\b|pmtiles:\/\/|\.pmtiles\b|from\s+['"][^'"]*pmtiles|\btippecanoe\b/i;
        const comoCodigo = linhasQueCasam(CODIGO_PMTILES);
        expect(
            comoCodigo,
            `PMTiles/tippecanoe usado como codigo; aqui o mapa e MVT do PostGIS:\n${comoCodigo.join('\n')}`
        ).toEqual([]);

        const NEGACAO = /\bn[aã]o\b|\bnada de\b|descontinuad/i;
        const semNegar = linhasQueCasam(/pmtiles/i).filter((l) => !NEGACAO.test(l));
        expect(
            semNegar,
            'mencao a PMTiles que nao diz que ele NAO e usado. Se a linha afirma o'
                + ` PMTiles, ela contradiz o backend; se apenas o descarta, diga isso na linha:\n${semNegar.join('\n')}`
        ).toEqual([]);
    });

    it('o CSS saiu do HTML: existe calibracao.css e o <style> que sobrou e so o splash', () => {
        // REPROVA o HTML da origem, que carregava toda a folha de estilo num
        // `<style>` inline de centenas de linhas. Estilo dentro do HTML nao passa
        // pelo Stylelint da casa, nao entra no manifesto de CSS do Vite e nao e
        // cacheavel a parte da pagina.
        const css = join(PACOTE, 'src/css/calibracao.css');
        expect(existsSync(css), 'src/css/calibracao.css nao existe').toBe(true);
        expect(
            readFileSync(css, 'utf8').length,
            'calibracao.css e pequeno demais para conter o estilo da pagina: o inline provavelmente ficou no HTML'
        ).toBeGreaterThan(5000);

        const blocos = HTML.match(/<style[^>]*>[\s\S]*?<\/style>/g) ?? [];
        expect(blocos.length, 'esperado UM <style> no HTML, o splash de boot').toBe(1);

        const linhas = blocos[0].split('\n').length;
        expect(
            linhas,
            `o <style> de calibracao.html tem ${linhas} linhas; acima de 40 ele deixou de ser o splash de boot`
        ).toBeLessThan(40);
    });
});
