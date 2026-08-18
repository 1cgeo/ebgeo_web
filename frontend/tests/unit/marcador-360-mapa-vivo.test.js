// Path: tests/unit/marcador-360-mapa-vivo.test.js
//
// O HOMÔNIMO QUE NÃO PODIA MORRER (fase F9, item 1 — o lado do cliente).
//
// A migração 021 apagou a TABELA de catálogo `streetview_markers` e a rota
// `/api/v1/streetview-markers` que a servia: um clone estrutural de `basemaps` sem
// consumidor nenhum. No MESMO repositório existe
// `src/js/street_view_tool/streetview_markers.js`, que não tem relação com aquilo: é
// a camada de marcadores do 360 no mapa 2D, desenha a partir do módulo `sv360` e é
// produto de verdade.
//
// Os dois se distinguem por CAMINHO, nunca por nome, e é por isso que este arquivo
// existe. Uma remoção conduzida por varredura de nome apaga os dois, e a suíte não
// fica vermelha, porque o que se perde é UI: nenhum teste de node monta um mapa
// MapLibre. O que dá para prender em node é a FIAÇÃO, e ela é o que uma varredura
// quebra primeiro.
//
// O ELO MAIS FRÁGIL, e o que este arquivo prende que nada mais prendia: os ids de
// camada do 360 são criados aqui e REPETIDOS COMO LITERAL em `selection_manager.js`,
// que os usa para não roubar o clique do visualizador. Renomear um deles (ou apagar
// o arquivo e reescrever a camada com outro prefixo) faz o clique num panorama passar
// a selecionar feição, em silêncio, com as duas suítes verdes.
//
// O QUE ESTE ARQUIVO NÃO PRENDE: que a camada DESENHE. Isso é Playwright, e o
// contrato de servidor (o /api/config apontando para o MVT do sv360) é medido do
// outro lado, em `backend/tests/integration/streetview-markers-rota-morta.test.js`.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const URL_JS = new URL('../../src/js/', import.meta.url);
const DIR_JS = fileURLToPath(URL_JS);

const CAMADA = 'street_view_tool/streetview_markers.js';
const CONTROLE = 'street_view_tool/add_street_view_control.js';
const SELECAO = 'tool_manager/selection_manager.js';
const API_CLIENT = 'store/sync/api-client.js';

/** As DUAS formas que morreram com a 021, escritas separadas porque casam coisas diferentes. */
// O tipo de recurso / alvo de auditoria: UNDERSCORE e singular (`resource_type =
// 'streetview_marker'`, `STREETVIEW_MARKER` na auditoria). As duas restrições são
// necessárias, e a primeira versão deste arquivo, sem elas, acusou TRÊS arquivos vivos —
// motivo pelo qual ela está escrita aqui em vez de descoberta de novo:
//
//   - `streetview_markers.js` e `streetview-markers-pins` terminam em `s` (daí `(?!s)`);
//   - `'streetview-marker'` COM HÍFEN é um TERCEIRO homônimo, e vivo em dois papéis
//     independentes: é o `type` do resultado de busca (`search-bar.search-providers.js` o
//     produz, `search-bar.component.js` faz `case` nele) e é o nome da imagem de ícone
//     registrada no MapLibre (`map.addImage('streetview-marker', …)`). Nenhum dos dois tem
//     relação com o tipo de recurso do backend, e uma varredura que os apagasse tiraria o
//     panorama da busca e o pino do mapa (daí exigir `_`).
const TIPO_MORTO = /streetview_marker(?!s)/i;
// O segmento de rota, exatamente como `_catalogEndpoint` o escrevia: uma string inteira.
const ROTA_MORTA = /(['"`])streetview-markers\1/;

const versionados = execFileSync('git', ['ls-files', '*.js'], { cwd: DIR_JS, encoding: 'utf8' })
    .split('\n').map((l) => l.trim().replace(/\\/g, '/')).filter(Boolean);

const ler = (rel) => readFileSync(new URL(rel, URL_JS), 'utf8');

/** Remove comentário de linha e de bloco: a varredura mede fiação, não prosa. */
const semComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('a camada de marcadores 360 do mapa sobreviveu à remoção da tabela homônima', () => {
    it('piso: a varredura enxerga o repositório (git vivo)', () => {
        // Cobertura vazia passa verde: sem este piso, um `git ls-files` que falhasse
        // tornaria trivialmente satisfeito todo caso que consulta a lista.
        expect(versionados.length, 'git ls-files não devolveu arquivo nenhum').toBeGreaterThan(200);
    });

    it('o arquivo continua versionado e FIADO no controle 360 do mapa', () => {
        expect(versionados).toContain(CAMADA);
        expect(versionados).toContain(CONTROLE);
        // Arquivo órfão é o meio-caminho de uma remoção: ele fica no disco e some da
        // tela. O controle é o `IControl` que o mapa registra, então este import é o
        // ponto exato em que a camada entra no produto.
        expect(semComentarios(ler(CONTROLE)))
            .toMatch(/import\s+StreetviewMarkers\s+from\s+'\.\/streetview_markers\.js'/);
    });

    it('ele lê o acervo pelo MÓDULO 360, e não por rota de catálogo', () => {
        const texto = semComentarios(ler(CAMADA));
        // `loadMarkers` → `fetchProjects()` → `GET /sv360/projects`, que é a tabela
        // `sv360.projects`. Era essa a confusão que a remoção podia produzir: tratar a
        // camada como consumidora do catálogo apagado.
        expect(texto).toMatch(/import\('\.\/streetview-api\.service\.js'\)/);
        expect(texto).toMatch(/fetchProjects\(\)/);
        expect(texto, 'a camada não fala com rota de catálogo').not.toMatch(/api\/v1\/(basemaps|tilesets|data-layers|analysis-layers)/);
    });

    it('os ids de camada que a seleção repete como literal são os que esta camada cria', () => {
        // O contrato cruzado, e o único elo que uma renomeação quebra sem erro nenhum.
        const criados = [...ler(CAMADA).matchAll(/this\.\w+\s*=\s*'(streetview-markers-[a-z-]+)'/g)]
            .map((m) => m[1]);
        expect(criados.length, 'a camada precisa declarar seus ids no construtor').toBe(5);

        const usados = [...ler(SELECAO).matchAll(/'(streetview-markers-[a-z-]+)'/g)].map((m) => m[1]);
        expect(usados.length, 'selection_manager precisa nomear as camadas clicáveis do 360').toBe(2);

        const orfaos = usados.filter((id) => !criados.includes(id));
        expect(orfaos, 'selection_manager aponta para id de camada que ninguém cria: '
            + 'o clique no panorama volta a selecionar feição').toEqual([]);
        // Discriminação: são as duas camadas CLICÁVEIS (cluster e pino), não o rótulo
        // nem a fonte — apontar a seleção para a fonte não protegeria clique nenhum.
        expect(usados.sort()).toEqual(['streetview-markers-clusters', 'streetview-markers-pins']);
    });

    it('o cliente inteiro está limpo das duas formas MORTAS, e a camada viva junto', () => {
        const sujosTipo = versionados.filter((rel) => TIPO_MORTO.test(semComentarios(ler(rel))));
        expect(sujosTipo, 'o tipo de recurso `streetview_marker` voltou ao cliente').toEqual([]);

        const sujosRota = versionados.filter((rel) => ROTA_MORTA.test(semComentarios(ler(rel))));
        expect(sujosRota, 'a rota de catálogo `streetview-markers` voltou ao cliente').toEqual([]);

        // E O PONTO INTEIRO DESTE ARQUIVO: a camada viva contém o nome e NÃO casa
        // nenhuma das duas formas. Se casasse, a varredura acima estaria pedindo a morte
        // dela — que é exatamente o acidente contra o qual este teste foi escrito.
        const camada = semComentarios(ler(CAMADA));
        expect(camada).toMatch(/streetview-markers-pins/);
        expect(camada).toMatch(/addImage\('streetview-marker'/);
        expect(TIPO_MORTO.test(camada), 'a varredura de tipo morto morde a camada viva').toBe(false);
        expect(ROTA_MORTA.test(camada), 'a varredura de rota morta morde a camada viva').toBe(false);
    });

    it('o terceiro homônimo (o `type` do resultado de busca) casa entre quem produz e quem consome', () => {
        // Mesma classe do contrato de ids de camada, noutro par de arquivos: a busca por
        // panorama devolve `type: 'streetview-marker'` e a barra de busca decide o ícone e
        // o que fazer no clique por `case 'streetview-marker'`. São dois literais em
        // arquivos diferentes, e quem os separasse deixaria o resultado de busca aparecer
        // sem ícone e sem ação, com toda a suíte verde.
        const provedor = semComentarios(ler('search/search-bar.search-providers.js'));
        const componente = semComentarios(ler('search/search-bar.component.js'));

        const produzidos = [...provedor.matchAll(/type:\s*'(streetview-marker)'/g)].map((m) => m[1]);
        expect(produzidos.length, 'o provedor precisa carimbar o tipo no resultado').toBe(1);

        const consumidos = [...componente.matchAll(/'(streetview-marker)'/g)].map((m) => m[1]);
        expect(consumidos.length, 'a barra de busca precisa reconhecer o tipo').toBeGreaterThanOrEqual(2);
        expect(new Set(consumidos)).toEqual(new Set(produzidos));
    });

    it('ANTI-COBERTURA-VAZIA: o mesmo método acha os quatro tipos de catálogo que SOBRARAM', () => {
        // Se `git ls-files`, a leitura ou a forma do regex tivessem parado de funcionar,
        // os dois casos acima ficariam verdes sem verificar nada. Aqui o mesmo método é
        // apontado para o que TEM de estar lá.
        const cliente = semComentarios(ler(API_CLIENT));
        for (const rota of ['basemaps', 'data-layers', 'analysis-layers', 'tilesets']) {
            expect(new RegExp(`(['"\`])${rota}\\1`).test(cliente), `${rota} sumiu do api-client`).toBe(true);
        }
        // O mapa de categorias existe e tem QUATRO entradas: é dele que o quinto valor
        // saiu. (Que o morto não voltou é o caso acima, e a asserção não se repete aqui
        // de propósito — dois casos ancorados no mesmo ponto contam duas vezes o mesmo
        // controle negativo.)
        expect(cliente).toMatch(/_catalogEndpoint/);
        const mapa = cliente.match(/_catalogEndpoint\(category\)\s*\{[\s\S]*?\}\[category\]/);
        expect(mapa, 'o mapa de categoria → rota mudou de forma').not.toBeNull();
        expect(mapa[0].match(/:\s*'[a-z-]+'/g)).toHaveLength(4);
    });
});
