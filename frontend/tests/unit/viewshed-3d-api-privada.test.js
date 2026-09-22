// Path: tests/unit/viewshed-3d-api-privada.test.js
//
// A REESCRITA DO VIEWSHED 3D TOCA TRES PONTOS DA API PRIVADA DO CESIUM, e este teste e o que os
// mantem honestos. Ele le o FONTE do Cesium instalado e reprova quando um dos tres nomes muda,
// porque a alternativa e o modo de falha que matou o vendor anterior: um campo privado renomeado
// num bump, nenhum erro em lugar nenhum, e a analise de visibilidade simplesmente deixando de
// desenhar (decisao D15 de 2026-09-15; a declaracao esta no cabecalho de
// `frontend/src/js/3d_models_viewer_tool/services/viewshed-3d.js`).
//
// O QUE ELE PROVA E O QUE NAO PROVA. Ele prova que os tres nomes existem hoje no pacote instalado
// e que o nosso arquivo os cita. NAO prova que eles significam o que achamos que significam: um
// `_shadowMapTexture` que passe a guardar outra coisa continua passando aqui, e quem pega isso e a
// captura de pixel (`frontend/tests/e2e-ui/viewshed-3d-pixel.spec.js`). Sao guardas de camadas
// diferentes, e nenhum dos dois substitui o outro.
//
// O TESTE TAMBEM VIGIA A CONTAGEM, e essa e a metade que envelhece sozinha se ninguem a prender:
// uma reescrita futura que precise de um QUARTO campo privado tem de declara-lo aqui, no mesmo
// commit. Superficie privada que cresce em silencio e exatamente o que a declaracao de 2026-09-14
// acusou no arquivo ofuscado, com onze campos.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ_FRONTEND = path.resolve(AQUI, '../..');
const MOTOR = path.join(RAIZ_FRONTEND, 'node_modules/@cesium/engine/Source');
const NOSSO = path.join(RAIZ_FRONTEND, 'src/js/3d_models_viewer_tool/services/viewshed-3d.js');

/**
 * A superficie privada aceita, uma entrada por ponto de contato.
 *
 * `arquivo` e onde o nome NASCE no Cesium, `padrao` e o que tem de continuar existindo la, e
 * `motivo` e por que nao ha substituto publico. Acrescentar uma entrada aqui e uma decisao, nao uma
 * formalidade: cada linha e uma coisa que o proximo bump do Cesium pode levar embora sem aviso.
 */
const SUPERFICIE_PRIVADA = [
    {
        nome: 'scene.context',
        arquivo: 'Scene/Scene.js',
        padrao: /^\s{2}context:\s*\{/m,
        motivo:
            'o construtor de ShadowMap exige `options.context`, e ele e `@internalConstructor` ' +
            'com `@privateParam`: as tipagens publicadas declaram `constructor()` sem argumento ' +
            'nenhum, entao nao existe caminho suportado para construir um.',
    },
    {
        nome: '_shadowMapTexture',
        arquivo: 'Scene/ShadowMap.js',
        padrao: /this\._shadowMapTexture\s*=/,
        motivo:
            'e a textura de profundidade renderizada a partir do observador, ou seja, a analise ' +
            'inteira. Nada em ShadowMap a expoe, e sem ela o shader nao tem o que consultar.',
    },
    {
        nome: 'frameState.shadowMaps',
        arquivo: 'Scene/FrameState.js',
        padrao: /this\.shadowMaps\s*=\s*\[\]/,
        motivo:
            'e como uma primitiva oferece um shadow map analitico ao quadro corrente; nao ha ' +
            'ponto de registro publico para isso.',
    },
];

/** Os campos privados que a PROPRIA classe declara (ver o construtor de `Viewshed3D`). */
const NOSSOS_CAMPOS = new Set([
    '_horizontalAngle',
    '_verticalAngle',
    '_visibleAreaColor',
    '_hiddenAreaColor',
    '_alpha',
    '_distance',
    '_destroyed',
    '_observerCamera',
    // A vertical local no observador, guardada antes de o Cesium ortogonalizar o "para cima" da
    // camera contra a direcao de cada pedaco. E campo NOSSO, e existe desde 2026-09-16 porque
    // medir azimute em torno do eixo de cada pedaco abria uma fenda na costura acima do horizonte.
    '_azimuthAxis',
    '_shadowMap',
    '_postProcess',
    '_outline',
    '_handler',
    '_addToScene',
    '_bindPickingEvents',
    '_unbindPickingEvents',
    '_createObserverCamera',
    '_createShadowMap',
    '_createPostProcess',
    '_rebuildOutline',
    '_shadowMatrix',
    '_axisToEyeCoordinates',
    '_wasSaved',
    // O PREVIEW ENTRE OS DOIS CLIQUES, desde 2026-09-22: o vendor o desenhava e a reescrita de
    // 2026-09-15 o perdeu. Todos sao estado e metodos da propria classe (as colecoes que o preview
    // desenha, a ultima posicao do ponteiro e o quadro de animacao que coalesce os movimentos), e
    // nenhum toca campo privado do Cesium: a API que eles usam e toda publica.
    '_previewEyeHeight',
    '_preview',
    '_hoverPosition',
    '_hoverFrame',
    '_previewHover',
    '_drawPreview',
    '_clearPreview',
]);

describe('viewshed 3D: a superficie privada do Cesium que a reescrita usa', () => {
    it('o pacote instalado do Cesium ainda publica os tres nomes', () => {
        // Controle: se o proprio fonte do motor nao estiver no disco, este teste nao estaria
        // verificando nada e passaria verde calado. Ele reprova nomeando o caminho.
        expect(
            fs.existsSync(MOTOR),
            `o fonte de @cesium/engine nao esta em ${MOTOR}: sem ele este guarda nao verifica nada`,
        ).toBe(true);

        for (const item of SUPERFICIE_PRIVADA) {
            const alvo = path.join(MOTOR, item.arquivo);
            expect(fs.existsSync(alvo), `${item.arquivo} nao existe no pacote instalado`).toBe(true);
            const fonte = fs.readFileSync(alvo, 'utf8');
            expect(
                item.padrao.test(fonte),
                `"${item.nome}" nao foi achado em ${item.arquivo}. O Cesium renomeou ou removeu, e ` +
                    `a analise de visibilidade 3D vai parar de desenhar em silencio. Motivo pelo qual ` +
                    `dependemos dele: ${item.motivo}`,
            ).toBe(true);
        }
    });

    it('o vendor ofuscado NAO voltou, nem o arquivo nem a referencia a ele', () => {
        // ESTE CASO E O PAR DA ISENCAO. `frontend/tests/unit/docs-integridade.test.js` isenta os
        // dois caminhos apagados por D15 (o vendor e o `cesium-compat.js`), porque quatro
        // documentos DATADOS os citam como o estado que se decidiu trocar. Isencao sem guarda e
        // como um caminho apagado volta sem ninguem notar, e o padrao ja esta estabelecido nesta
        // arvore pelo MapLibre e pelo Three.js.
        const pasta = path.join(RAIZ_FRONTEND, 'public/vendors/cesium');
        expect(
            fs.existsSync(pasta),
            `${pasta} voltou a existir: o vendor ofuscado do viewshed foi apagado em 2026-09-15 e ` +
                'nao tem por que estar de volta',
        ).toBe(false);

        const compat = path.join(RAIZ_FRONTEND, 'src/js/3d_models_viewer_tool/services/cesium-compat.js');
        expect(fs.existsSync(compat), 'cesium-compat.js voltou; os tres remendos sairam com o vendor').toBe(false);

        // E a referencia, que e o que de fato reviveria o arquivo. A varredura e sobre `src/` e
        // sobre as quatro paginas HTML, que sao os dois lugares de onde um `<script>` pode nascer.
        const alvos = [];
        const caminhar = (dir) => {
            for (const nome of fs.readdirSync(dir)) {
                const cheio = path.join(dir, nome);
                if (fs.statSync(cheio).isDirectory()) caminhar(cheio);
                else if (/\.(js|html)$/.test(nome)) alvos.push(cheio);
            }
        };
        caminhar(path.join(RAIZ_FRONTEND, 'src'));
        for (const pagina of ['index.html', 'atlas.html', 'admin.html', 'calibracao.html']) {
            alvos.push(path.join(RAIZ_FRONTEND, pagina));
        }
        expect(alvos.length, 'a varredura nao achou arquivo nenhum: ela quebrou').toBeGreaterThan(100);

        // A VARREDURA OLHA CODIGO, NAO COMENTARIO, e a distincao e o que a mantem util: sete
        // arquivos de `src/` NOMEIAM o vendor em prosa, para dizer o que saiu e por que, e isso e
        // registro, nao referencia. O que revive o arquivo e um `src=` ou um import.
        const semComentario = (texto) => texto
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/.*/g, '')
            .replace(/<!--[\s\S]*?-->/g, '');
        const citam = alvos
            .filter((f) => semComentario(fs.readFileSync(f, 'utf8')).includes('cesium-viewshed'))
            .map((f) => path.relative(RAIZ_FRONTEND, f));
        expect(citam, 'alguem voltou a referenciar o vendor do viewshed em CODIGO').toEqual([]);
    });

    it('o controle negativo: um nome inventado NAO e achado', () => {
        // Cobertura vazia passa verde. Se o casamento acima fosse frouxo (um `includes` de string
        // curta, digamos), ele acharia qualquer coisa; este caso prova que ele discrimina.
        const fonte = fs.readFileSync(path.join(MOTOR, 'Scene/ShadowMap.js'), 'utf8');
        expect(/this\._shadowMapTextureQueNuncaExistiu\s*=/.test(fonte)).toBe(false);
    });

    it('o nosso arquivo usa exatamente esses tres, e nenhum campo privado a mais', () => {
        const nosso = fs.readFileSync(NOSSO, 'utf8');

        expect(nosso).toContain('scene.context');
        expect(nosso).toContain('_shadowMapTexture');
        expect(nosso).toContain('frameState.shadowMaps');

        // A VARREDURA QUE IMPEDE A SUPERFICIE DE CRESCER CALADA. Ela olha so o CODIGO, porque o
        // cabecalho do arquivo cita por extenso os oito campos privados de que a reescrita se
        // livrou (`_shadowMapMatrix`, `_lightPositionEC` e os outros) e conta-los seria acusar a
        // documentacao de ser o defeito.
        const codigo = nosso
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/.*/g, '');
        const acessosPrivados = new Set(
            [...codigo.matchAll(/\??\.\s*(_[A-Za-z][A-Za-z0-9_]*)/g)]
                .map((m) => m[1])
                // Os campos privados DESTA classe, que sao nossos e nao do Cesium.
                .filter((nome) => !NOSSOS_CAMPOS.has(nome)),
        );

        expect(
            [...acessosPrivados].sort(),
            'campo privado de terceiro novo em viewshed-3d.js: declare-o em SUPERFICIE_PRIVADA ' +
                'com o motivo, no mesmo commit, ou troque-o por API publica',
        ).toEqual(['_shadowMapTexture']);
    });
});
