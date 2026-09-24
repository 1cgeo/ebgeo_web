// Path: tests/unit/carga-sob-demanda-portas.test.js
//
// AS PORTAS DE CARGA SOB DEMANDA PASSAM PELA PROTEÇÃO, e a rede cobre o resto. Censo estrutural.
//
// `utilities/carga-sob-demanda.js` tem DUAS camadas (ver o `fileoverview` dele), e cada uma tem um
// modo de falha silencioso que este arquivo fecha:
//
//   1. A REDE depende de um contrato com o BUNDLER: o carregador do Vite despacha
//      `vite:preloadError` para toda carga que falha, a do módulo e a de cada CSS, e relança o erro
//      se ninguém prevenir o padrão. Um Vite que deixasse de despachar o evento para a falha do
//      MÓDULO (só para a do CSS, como já foi em versões antigas) deixaria a rede muda, com todos os
//      testes verdes. Por isso o contrato é lido na fonte INSTALADA do Vite, e não suposto.
//   2. A rede só vale se estiver instalada ANTES da primeira carga do boot do mapa.
//   3. As PORTAS (a tabela de ferramentas, os carregadores de Turf, milsymbol e GDAL, os
//      visualizadores 3D, primeira pessoa e 360, e a importação e exportação) passam pela proteção
//      em TODO `import()` que fazem. Um `import()` cru numa porta é o clique que volta a não fazer
//      nada, e é o que um arquivo novo copiando o vizinho antigo reintroduz.
//
// O QUE ESTE ARQUIVO NÃO COBRE, dito para não parecer que cobre: os cerca de cem `import()` que não
// são porta. Eles são alcançados pela rede (camada 1), que avisa mas não tenta de novo.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ehFalhaDeCarga } from '../../src/js/utilities/carga-sob-demanda.model.js';

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const fonte = (rel) => readFileSync(join(FRONT, rel), 'utf8');

/**
 * Apaga o conteúdo dos comentários, para que prosa citando `import('...')` (JSDoc de tipo
 * inclusive) não conte como carga. Mesma técnica de `teto-de-peso-da-pagina-do-mapa.test.js`.
 * @param {string} texto
 * @returns {string}
 */
function semComentarios(texto) {
    return texto
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/(^|[^:])\/\/[^\n]*/g, (m, antes) => antes + ' '.repeat(m.length - antes.length));
}

const RE_IMPORT_DINAMICO = /\bimport\s*\(/g;
const RE_PROTEGIDO = /carregarSobDemanda\(\s*\(\)\s*=>\s*import\s*\(/g;
const contar = (texto, re) => (texto.match(re) ?? []).length;

/** As portas cujo `import()` inteiro passa pela proteção. */
const PORTAS = Object.freeze([
    'src/js/admin/index.js',
    'src/js/utilities/turf-loader.js',
    'src/js/military_tools/military_symbol_tool/milsymbol-loader.js',
    'src/js/vendor/gdal.js',
    'src/js/3d_models_viewer_tool/add_3d_models_viewer_control.js',
    'src/js/street_view_tool/add_street_view_control.js',
    'src/js/street_view_tool/streetview_markers.js',
    'src/js/import_export/pdf-export.tab.js',
    'src/js/sidebar/tabs/import.tab.js',
    'src/js/sidebar/tabs/export.tab.js',
    'src/js/sidebar/tabs/kmz-export.section.js',
    'src/js/utilities/luminosidade/carregador.js',
    'src/js/utilities/meteorologia/carregador.js',
    'src/js/catalog/resource-share-launcher.js',
]);

// ================================================================================================
// 1. O contrato com o bundler
// ================================================================================================

describe('o contrato do carregador do Vite', () => {
    /** O arquivo do Vite instalado que carrega o `preload`, achado por conteúdo e não por nome. */
    const helper = (() => {
        const base = join(FRONT, 'node_modules/vite/dist/node');
        const pilha = [base];
        while (pilha.length > 0) {
            const atual = pilha.pop();
            for (const nome of readdirSync(atual)) {
                const caminho = join(atual, nome);
                if (statSync(caminho).isDirectory()) { pilha.push(caminho); continue; }
                if (!nome.endsWith('.js')) continue;
                const texto = readFileSync(caminho, 'utf8');
                if (texto.includes('vite:preloadError')) return texto;
            }
        }
        return null;
    })();

    it('o Vite instalado despacha `vite:preloadError`', () => {
        expect(helper, 'nenhum arquivo do Vite instalado cita vite:preloadError').not.toBeNull();
    });

    it('a falha do MÓDULO passa pelo evento, e não só a do CSS', () => {
        // É a linha que faz a rede ouvir `cesium-integration-<hash>.js` que não chegou.
        expect(helper).toMatch(/baseModule\(\)\.catch\(handlePreloadError\)/);
    });

    it('sem `preventDefault` o erro continua subindo ao chamador', () => {
        // E é por isso que a rede NUNCA previne: prevenido, o import resolve com `undefined`.
        expect(helper).toMatch(/if \(!e\.defaultPrevented\) throw err/);
        expect(semComentarios(fonte('src/js/utilities/carga-sob-demanda.js'))).not.toMatch(/preventDefault/);
    });

    it('a mensagem de CSS que o Vite escreve é a que o modelo reconhece', () => {
        const achado = helper.match(/new Error\(`(Unable to preload CSS for) \$\{dep\}`\)/);
        expect(achado, 'o texto da falha de CSS mudou no Vite').not.toBeNull();
        expect(ehFalhaDeCarga(new Error(`${achado[1]} https://h/a.css`))).toBe(true);
    });
});

// ================================================================================================
// 2. A rede é instalada antes da primeira carga do mapa
// ================================================================================================

describe('a rede no boot do mapa', () => {
    const entrada = semComentarios(fonte('src/js/index.js'));

    it('`index.js` instala a rede', () => {
        expect(entrada).toMatch(/instalarRedeDeCargaSobDemanda\(\);/);
    });

    it('e a instala ANTES do portão de migração e dos serviços, que já carregam sob demanda', () => {
        const rede = entrada.indexOf('instalarRedeDeCargaSobDemanda();');
        const portao = entrada.indexOf('await runLegacyUpgradeGate(');
        const servicos = entrada.indexOf('initServices();');
        expect(portao, 'o portão de migração saiu do boot: reveja esta âncora').toBeGreaterThan(-1);
        expect(servicos, 'initServices saiu do boot: reveja esta âncora').toBeGreaterThan(-1);
        expect(rede).toBeLessThan(portao);
        expect(rede).toBeLessThan(servicos);
    });

    it('pelo ARQUIVO, nunca pelo barril `@utils`, que arrasta a store', () => {
        expect(entrada).toMatch(/from '@utils\/carga-sob-demanda\.js'/);
    });
});

// ================================================================================================
// 3. As portas
// ================================================================================================

describe('as portas de carga sob demanda', () => {
    it.each(PORTAS)('%s: todo `import()` passa por `carregarSobDemanda`', (rel) => {
        expect(existsSync(join(FRONT, rel)), `${rel} não existe mais: tire-o da lista ou siga-o`).toBe(true);
        const texto = semComentarios(fonte(rel));
        const todos = contar(texto, RE_IMPORT_DINAMICO);
        // Controle de vácuo: uma porta sem carga nenhuma passaria em "todos protegidos" com 0 = 0.
        expect(todos, `${rel} não tem import() nenhum: a porta mudou de lugar`).toBeGreaterThan(0);
        expect(contar(texto, RE_PROTEGIDO), `${rel} tem import() cru`).toBe(todos);
    });

    it('a tabela de ferramentas carrega pela porta, nunca chamando `carregar()` cru', () => {
        const registro = semComentarios(fonte('src/js/tool_manager/tool-registry.js'));
        expect(registro).toMatch(/carregarSobDemanda\(ferramenta\.carregar\)/);
        expect(registro).not.toMatch(/ferramenta\.carregar\(\)/);
        // Todo `import()` do arquivo é o de uma linha da tabela, e só é chamado pela linha acima.
        const linhas = contar(registro, /\bcarregar:\s*\(\)\s*=>\s*import\s*\(/g);
        expect(linhas, 'a tabela de ferramentas ficou vazia').toBeGreaterThan(10);
        expect(contar(registro, RE_IMPORT_DINAMICO)).toBe(linhas);
    });

    it('o modelo das regras é folha de ZERO imports, legível por qualquer página', () => {
        const modelo = semComentarios(fonte('src/js/utilities/carga-sob-demanda.model.js'));
        expect(modelo).not.toMatch(/^\s*import\s/m);
        expect(contar(modelo, RE_IMPORT_DINAMICO)).toBe(0);
    });
});
