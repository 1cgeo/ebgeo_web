// Path: tests/unit/canvas-do-mapa-ancorado.test.js
//
// A PAGINA DO MAPA TEM DOIS CANVAS DO MAPLIBRE, E O SELETOR NU NAO DIZ QUAL.
//
// `#map-sig` e o mapa 2D (`createMap`, em `js/map_sig.js`) e `#mini-map-street-view` e o
// minimapa do 360, criado por `setupMiniMapWithPMTiles` no `onAdd` do controle de street
// view sempre que `config.features.imagens_panoramicas` esta ligado. Os dois pintam um
// `canvas.maplibregl-canvas`, entao `page.locator('.maplibregl-canvas')` casa DOIS
// elementos e o strict mode do Playwright reprova a chamada.
//
// POR QUE ISSO PRECISOU DE GUARDA, e nao de uma linha de convencao: a criacao do minimapa
// e ASSINCRONA, entao o segundo canvas entra no DOM alguns instantes depois do primeiro. O
// spec rapido consulta antes e passa; o spec lento consulta depois e morre. Em
// 2026-08-22, com a suite inteira em serie, um unico arquivo reprovou
// (`browser-collab-all-types.spec.js`, que gasta ~34 s antes do primeiro clique) enquanto
// outros onze usavam o MESMO seletor e passavam. Corrida, nao regra quebrada: a diferenca
// entre os doze era o relogio. O contorno que existia em seis chamadas (`.first()`) e pior
// que o seletor ancorado, porque troca "qual mapa eu quero" por "quem chegou primeiro no
// DOM", e ordem de DOM nao e contrato.
//
// A REGRA: em `tests/e2e-ui/`, todo seletor CSS de `.maplibregl-canvas` nasce ancorado num
// container. Quem quer o mapa principal escreve `#map-sig .maplibregl-canvas`. Quem quiser
// o minimapa escreve o id dele. Fora de locator CSS o problema nao existe: os helpers de
// colaboracao pegam o elemento por `map.getCanvas()` da instancia, que nunca e ambigua.

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const URL_E2E_UI = new URL('../e2e-ui/', import.meta.url);
const DIR_E2E_UI = fileURLToPath(URL_E2E_UI);

/**
 * O seletor NU: a classe abrindo a string, sem nada antes dela. `'#map-sig .maplibregl-canvas'`
 * nao casa (a classe nao esta colada na aspa) e e exatamente essa a diferenca que se cobra.
 */
const SELETOR_NU = /(['"`])\.maplibregl-canvas\1/;

/**
 * CONTROLE POSITIVO. Enquanto a varredura acusar zero arquivos, e esta amostra que responde
 * "o que este verde estaria provando se o codigo estivesse errado": uma regra que deixasse de
 * reconhecer a forma proibida reprova aqui mesmo com a pasta inteira limpa.
 */
const AMOSTRA_PROIBIDA = "const box = await page.locator('.maplibregl-canvas').boundingBox();";

/** Amostra PERMITIDA: o guarda precisa deixar passar a forma ancorada, ou ele proibiria tudo. */
const AMOSTRA_PERMITIDA = "const box = await page.locator('#map-sig .maplibregl-canvas').boundingBox();";

/**
 * O CODIGO SEM OS COMENTARIOS. Tres `@fileoverview` da pasta CITAM a classe do canvas ao
 * explicar o que o spec dirige, e citar nao e selecionar. Cobrar a prosa junto com o codigo
 * daria falso positivo em documentacao correta, e regra ruidosa e regra que alguem desliga.
 */
function semComentarios(fonte) {
    return fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/** Inventario versionado da pasta (fonte: git, nunca alvos escritos a mao). */
function inventario() {
    let saida;
    try {
        saida = execSync('git ls-files', { cwd: DIR_E2E_UI, encoding: 'utf8' });
    } catch (err) {
        throw new Error(`o inventario precisa de "git ls-files" e ele falhou: ${err.message}`);
    }
    return saida.split(/\r?\n/).filter((f) => f.endsWith('.js'));
}

describe('o canvas do mapa e ancorado no container, nunca buscado pela classe solta', () => {
    it('a regra reconhece a forma proibida e deixa passar a ancorada', () => {
        expect(SELETOR_NU.test(AMOSTRA_PROIBIDA)).toBe(true);
        expect(SELETOR_NU.test(AMOSTRA_PERMITIDA)).toBe(false);
        expect(semComentarios("// cita '.maplibregl-canvas' na prosa\nconst a = 1;")).not.toMatch(SELETOR_NU);
        expect(semComentarios(AMOSTRA_PROIBIDA)).toMatch(SELETOR_NU);
    });

    it('o inventario da pasta nao esta vazio', () => {
        expect(inventario().length).toBeGreaterThan(50);
    });

    it('nenhum arquivo de tests/e2e-ui busca o canvas pela classe solta', () => {
        const achados = inventario()
            .filter((rel) => SELETOR_NU.test(semComentarios(readFileSync(new URL(rel, URL_E2E_UI), 'utf8'))));
        expect(achados, `use '#map-sig .maplibregl-canvas' nestes arquivos: ${achados.join(', ')}`).toEqual([]);
    });
});
