// Path: tests/unit/portas-de-imagem-censo.test.js

/**
 * @fileoverview QUEM aceita GIF e BMP, e QUEM mede pixels, é uma propriedade do CONJUNTO das
 * portas de imagem, e nenhum teste de comportamento a alcança.
 *
 * As duas afirmações deste arquivo são do mesmo tipo e falham do mesmo jeito: em silêncio.
 *
 *   1. `allowReencodable` só pode ser pedido por uma porta que jogue fora os bytes originais. Uma
 *      porta que GUARDA o arquivo (galeria de fotos, capa de atlas, ícone de ponto, miniatura do
 *      catálogo) e pedisse a opção passaria verde aqui e seria recusada pelo SERVIDOR, depois da
 *      subida, que é o momento em que a recusa não ensina mais nada.
 *   2. Uma porta que re-encoda por canvas sem medir PIXELS antes aloca o bitmap inteiro. O teto de
 *      bytes não vê bomba de descompressão, e o sintoma é a aba morrer, não um erro.
 *
 * O INVENTÁRIO VEM DO `git ls-files`, nunca de uma lista escrita à mão: porta nova entra na
 * varredura sozinha e reprova até ser classificada. É o mesmo desenho dos censos de recurso e de
 * permissão, e pela mesma razão: a lista à mão envelhece no commit seguinte e o verde passa a ser
 * sobre outra coisa.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Todo `.js` versionado sob `src/js/`, pelo índice do git. */
function arquivosDoFonte() {
    return execFileSync('git', ['ls-files', 'src/js'], { cwd: FRONT, encoding: 'utf8' })
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.endsWith('.js'));
}

/**
 * AS DUAS ÚNICAS PORTAS QUE RE-ENCODAM POR CANVAS E DESCARTAM O ORIGINAL.
 *
 * As duas entregam a figura a `AddImageControl.resizeImage`, que desenha num canvas e emite
 * PNG ou JPEG (`reencodedImageType`), então o servidor nunca vê o GIF nem o BMP. Porta nova nesta
 * lista precisa da mesma propriedade, e a prova dela é o `resizeImage` no caminho.
 */
const PORTAS_QUE_REENCODAM = Object.freeze([
    'src/js/draw_tools/image_tool/add_image_control.js',
    'src/js/import_export/drag-drop.handler.js',
]);

describe('só as portas que re-encodam pedem GIF e BMP', () => {
    const fontes = arquivosDoFonte().map((rel) => ({
        rel,
        texto: readFileSync(join(FRONT, rel), 'utf8'),
    }));

    it('a varredura achou fonte, senão este arquivo inteiro é cobertura vazia', () => {
        expect(fontes.length).toBeGreaterThan(400);
    });

    it('o conjunto que pede `allowReencodable` é EXATAMENTE as duas portas declaradas', () => {
        // A opção só aparece no gate (`image_utils.js`), nos dois chamadores e neste censo.
        const pedintes = fontes
            .filter(({ rel, texto }) => rel !== 'src/js/utilities/image_utils.js'
                && texto.includes('allowReencodable'))
            .map(({ rel }) => rel)
            .sort();

        expect(pedintes).toEqual([...PORTAS_QUE_REENCODAM].sort());
    });

    it('as duas portas declaradas de fato pedem a opção (a afirmação não é vazia)', () => {
        for (const rel of PORTAS_QUE_REENCODAM) {
            const texto = readFileSync(join(FRONT, rel), 'utf8');
            expect(texto, `${rel} parou de pedir allowReencodable`)
                .toMatch(/allowReencodable:\s*true/);
        }
    });

    it('o seletor de arquivo da ferramenta deriva o `accept` do MESMO gate', () => {
        // Um `accept` escrito à mão é como a lista do seletor e a lista do gate divergem: a pessoa
        // escolhe um formato que o diálogo ofereceu e leva uma recusa.
        const texto = readFileSync(join(FRONT, PORTAS_QUE_REENCODAM[0]), 'utf8');
        expect(texto).toMatch(/input\.accept\s*=\s*acceptedImageTypes\(\{\s*allowReencodable:\s*true\s*\}\)/);
    });

    it('nenhuma porta pede ao canvas um formato que o servidor recusa', () => {
        // O ramo que morreu aqui pedia `toDataURL("image/gif")`. Nenhum navegador CODIFICA GIF, e
        // a especificação manda cair em PNG sem avisar: os bytes certos com o nome errado.
        for (const { rel, texto } of fontes) {
            const pedidos = [...texto.matchAll(/toDataURL\(\s*['"]([^'"]+)['"]/g)]
                .map((m) => m[1]);
            for (const tipo of pedidos) {
                expect(['image/png', 'image/jpeg', 'image/webp'], `${rel} pede ${tipo}`)
                    .toContain(tipo);
            }
        }
    });
});

describe('toda porta que re-encoda por canvas mede PIXELS antes de desenhar', () => {
    /**
     * As portas que decodificam e desenham, com o validador que cada uma usa.
     *
     * A miniatura do catálogo do administrador estava FORA desta lista até 2026-09-20: ela media
     * bytes e tipo e chamava `compressImage` logo em seguida, que é um `drawImage`. Um PNG de cor
     * sólida de 300 kB decodifica a 30000x30000 e aloca gigabytes na aba de onde o administrador
     * faz todo o resto.
     */
    const COM_TETO_DE_PIXEL = Object.freeze({
        'src/js/admin/catalog-tab.js': 'validateImagePayload',
        'src/js/draw_tools/image_tool/add_image_control.js': 'validateImageDimensions',
        'src/js/import_export/drag-drop.handler.js': null, // mede em `resizeImage`, do controle
        'src/js/utilities/quill-helpers.js': 'validateImageDimensions',
        'src/js/draw_tools/point_tool/point-custom-icons.js': 'iconDimensionVerdict',
    });

    it('a miniatura do catálogo usa o par completo e NÃO só o gate de bytes', () => {
        const rel = 'src/js/admin/catalog-tab.js';
        const texto = readFileSync(join(FRONT, rel), 'utf8');

        // As DUAS portas daquele arquivo (item de catálogo e projeto 360), contadas, porque
        // consertar uma e deixar a outra é exatamente o que aconteceu com as galerias.
        const comPixel = texto.match(/await validateImagePayload\(/g) ?? [];
        expect(comPixel.length, 'as duas portas de miniatura do admin').toBe(2);

        // E o gate de bytes sozinho não pode ter sobrado em lugar nenhum daquele arquivo.
        expect(texto).not.toMatch(/validateImageFile\(/);
    });

    it('cada porta declarada cita o validador que o censo diz que ela usa', () => {
        for (const [rel, simbolo] of Object.entries(COM_TETO_DE_PIXEL)) {
            if (!simbolo) continue;
            const texto = readFileSync(join(FRONT, rel), 'utf8');
            expect(texto, `${rel} não cita mais ${simbolo}`).toContain(simbolo);
        }
    });

    it('`admin/` alcança o gate POR ARQUIVO, nunca pelo barril `@utils`', () => {
        // `admin.html` boota sem a store, e `@utils` chega a `feature_navigation_utils`, que
        // arrasta a store inteira pelo caminho transitivo. A guarda larga disso é
        // `paginas-sem-mapa-nao-arrastam-a-store.test.js`; esta é a linha específica da mudança.
        const texto = readFileSync(join(FRONT, 'src/js/admin/catalog-tab.js'), 'utf8');
        expect(texto).toContain("from '@utils/image_utils.js'");
        expect(texto).not.toMatch(/from\s+['"]@utils['"]/);
    });
});
