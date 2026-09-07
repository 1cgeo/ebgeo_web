// Path: tests/unit/exclusao-de-atlas-local-nomeia-a-perda.test.js

/**
 * @fileoverview O diálogo que apaga um atlas local tem de dizer O QUE está sendo apagado, e não só
 * que alguma coisa será.
 *
 * O QUE MOTIVOU. Excluir o slot de sufixo VAZIO derruba os onze bancos sem sufixo, que são
 * literalmente os bancos que a linha `main` do produto usa hoje (`ebgeo_maps`, `ebgeo_images`,
 * `ebgeo_atlas` e os outros oito): o acervo inteiro de quem chegou por uma troca de versão. O botão
 * está certo, é isso que ele faz; o que estava errado era a frase. Ela dizia "Os mapas, feições e
 * imagens deste atlas serão apagados deste navegador", que é a MESMA sentença para um atlas em
 * branco criado há um minuto e para um com 14 mapas e 805 feições. Some a isso o fato de o slot
 * adotado se chamar "Meu Atlas" (o nome de fábrica), e o cartão do acervo fica indistinguível do
 * cartão descartável.
 *
 * O MODELO É O VIZINHO QUE JÁ ACERTAVA: "Limpar tudo" na aba Mapas nomeia o atlas, diz que NÃO pode
 * ser desfeito e marca a perda item a item (`sidebar/tabs/maps.tab.js`). Ele faz MENOS (esvazia sem
 * derrubar os bancos) e perguntava melhor.
 *
 * AS DUAS METADES, e as duas estão aqui:
 *   1. a CONTAGEM, que é leitura de IndexedDB no escopo de um slot que ninguém montou
 *      (`store/atlas-contents.js`), medida contra `fake-indexeddb` com localforage de verdade;
 *   2. a FRASE, pura (`projects/local-atlas-notices.js`), com o controle do slot vazio, que
 *      continua com a frase curta de sempre.
 *
 * O CONTROLE QUE FAZ A RÉGUA VALER é o do atlas VAZIO: uma frase que citasse contagem sempre
 * passaria no caso cheio sem provar nada. Aqui o vazio REPROVA a presença de número.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { deleteConfirmMessage } from '@js/projects/local-atlas-notices.js';
import * as ns from '@store/atlas-namespace.js';
import { countAtlasContents as contar } from '@store/atlas-contents.js';

const PAGE_SRC = readFileSync(
    fileURLToPath(new URL('../../src/js/projects/projects-page.js', import.meta.url)), 'utf8'
);

// ============================================================================
// A FRASE
// ============================================================================

describe('o corpo do diálogo de exclusão: o atlas com conteúdo', () => {
    const CHEIO = { name: 'Meu Atlas', contents: { maps: 14, features: 805, images: 149 } };

    it('nomeia o atlas e conta o que morre com ele', () => {
        const texto = deleteConfirmMessage(CHEIO);
        expect(texto).toContain('"Meu Atlas"');
        expect(texto).toContain('14 mapas');
        expect(texto).toContain('805 feições');
        expect(texto).toContain('149 imagens');
        expect(texto).toMatch(/NÃO pode ser desfeito/);
    });

    it('diz que os OUTROS atlas ficam, que é a pergunta seguinte de quem lê', () => {
        expect(deleteConfirmMessage(CHEIO)).toMatch(/outros atlas não são afetados/);
    });

    it('o singular não sai escrito no plural', () => {
        const texto = deleteConfirmMessage({
            name: 'Rascunho', contents: { maps: 1, features: 1, images: 1 }
        });
        expect(texto).toContain('1 mapa');
        expect(texto).not.toContain('1 mapas');
        expect(texto).toContain('1 feição');
        expect(texto).not.toContain('1 feições');
        expect(texto).toContain('1 imagem');
        expect(texto).not.toContain('1 imagens');
    });

    it('seção que o atlas não tem NÃO vira linha de zero', () => {
        const texto = deleteConfirmMessage({
            name: 'Sem foto', contents: { maps: 3, features: 40, images: 0 }
        });
        expect(texto).toContain('3 mapas');
        expect(texto).toContain('40 feições');
        expect(texto).not.toMatch(/0 imagens/);
    });

    it('a fila de saída continua sendo dita só a quem tem conta', () => {
        expect(deleteConfirmMessage({ ...CHEIO, signedIn: true }))
            .toMatch(/ainda não enviado ao servidor/);
        expect(deleteConfirmMessage(CHEIO)).not.toMatch(/servidor/i);
    });

    it('sem nome no registro, a frase continua verdadeira e não escreve "undefined"', () => {
        const texto = deleteConfirmMessage({ contents: { maps: 2, features: 9, images: 0 } });
        expect(texto).not.toMatch(/undefined|null/);
        expect(texto).toContain('2 mapas');
        expect(texto).toContain('9 feições');
    });
});

describe('CONTROLE: o atlas vazio continua com a frase curta', () => {
    /**
     * O contorno de "vazio" inclui UM mapa sem nada dentro, e não é detalhe: a inicialização do
     * repositório escreve um `Principal` em branco em todo slot recém-criado, então "1 mapa, 0
     * feições, 0 imagens" é a forma de um atlas em que ninguém desenhou.
     */
    const VAZIOS = [
        ['nunca aberto', { maps: 0, features: 0, images: 0 }],
        ['só o Principal em branco', { maps: 1, features: 0, images: 0 }],
        ['contagem desconhecida (leitura falhou)', null],
        ['contagem corrompida', { maps: 'muitos', features: NaN, images: undefined }],
    ];

    it.each(VAZIOS)('%s: sem número na frase', (_nome, contents) => {
        const texto = deleteConfirmMessage({ name: 'Meu Atlas', contents });
        expect(texto).toBe('Os mapas, feições e imagens deste atlas serão apagados deste '
            + 'navegador. Não há como desfazer.');
        expect(texto).not.toMatch(/\d/);
    });

    it('e o vazio de quem tem conta continua citando a fila', () => {
        expect(deleteConfirmMessage({ name: 'Meu Atlas', signedIn: true, contents: null }))
            .toMatch(/ainda não enviado ao servidor/);
    });

    it('sem argumento nenhum, cai no lado do anônimo e vazio', () => {
        expect(deleteConfirmMessage()).toBe(deleteConfirmMessage({ signedIn: false }));
    });
});

// ============================================================================
// A CONTAGEM, contra IndexedDB de verdade (fake-indexeddb) num escopo NÃO MONTADO
// ============================================================================

/**
 * O escopo de um slot local qualquer, no formato de `scopeOfLocalAtlas`.
 *
 * CADA CASO USA UM SUFIXO PRÓPRIO, e não é estilo: `fake-indexeddb` é reinstalado por ARQUIVO e
 * não por caso, e `getStoreFor` guarda a instância por (banco, escopo). Dois casos com o mesmo
 * sufixo leriam o banco um do outro, e o caso do banco ilegível (que substitui um método da
 * instância cacheada) contaminaria os seguintes.
 */
function escopo(dbSuffix) {
    return { kind: 'local', atlasId: 'atlas-de-teste', dbSuffix };
}

/**
 * Semeia um slot com `mapas` documentos, cada um com `porMapa` feições espalhadas por dois baldes,
 * e `imagens` blobs.
 */
async function semear(dbSuffix, { mapas, porMapa = 0, imagens = 0 } = {}) {
    const scope = escopo(dbSuffix);
    for (let i = 0; i < mapas; i++) {
        await ns.getStoreFor(ns.StoreName.MAPS, scope).setItem(`mapa-${i}`, {
            name: `Mapa ${i}`,
            features: {
                points: Array.from({ length: porMapa }, (_, k) => ({ id: `p-${i}-${k}` })),
                military_symbols: Array.from({ length: porMapa }, (_, k) => ({ id: `s-${i}-${k}` })),
                polygons: [],
            },
        });
    }
    for (let i = 0; i < imagens; i++) {
        await ns.getStoreFor(ns.StoreName.IMAGES, scope).setItem(`img-${i}`, 'data:,x');
    }
    return scope;
}

describe('a contagem do escopo de um slot que ninguém montou', () => {
    it('conta mapas, feições de TODOS os baldes e imagens', async () => {
        const scope = await semear('slot-a', { mapas: 3, porMapa: 4, imagens: 5 });
        expect(await contar(scope)).toEqual({ maps: 3, features: 24, images: 5 });
    });

    it('lê o slot pelo ESCOPO passado, sem escopo ativo nenhum', async () => {
        // A propriedade que separa esta leitura de um mount: `getActiveScope()` continua nulo, e
        // uma implementação que caísse no escopo ativo estouraria em vez de contar.
        const scope = await semear('slot-b', { mapas: 2, porMapa: 1 });
        expect(ns.getActiveScope()).toBeNull();
        expect(await contar(scope)).toEqual({ maps: 2, features: 4, images: 0 });
    });

    it('dois slots não se misturam', async () => {
        await semear('slot-c', { mapas: 5, porMapa: 2, imagens: 1 });
        await semear('slot-d', { mapas: 1, porMapa: 0, imagens: 0 });
        expect(await contar(escopo('slot-c'))).toEqual({ maps: 5, features: 20, images: 1 });
        expect(await contar(escopo('slot-d'))).toEqual({ maps: 1, features: 0, images: 0 });
    });

    it('slot vazio conta zero, e é o insumo do controle da frase', async () => {
        expect(await contar(escopo('slot-vazio'))).toEqual({ maps: 0, features: 0, images: 0 });
    });

    it('PIOR CASO: documento sem `features`, balde que não é lista, valor nulo', async () => {
        const scope = escopo('slot-torto');
        const maps = ns.getStoreFor(ns.StoreName.MAPS, scope);
        await maps.setItem('sem-features', { name: 'A' });
        await maps.setItem('balde-torto', { name: 'B', features: { points: 'nao-e-lista', lines: null } });
        await maps.setItem('nulo', null);
        await maps.setItem('bom', { name: 'C', features: { points: [{ id: 'x' }] } });
        // Três documentos legíveis (o nulo não conta como mapa) e UMA feição: nada estoura e nada
        // é inventado.
        expect(await contar(scope)).toEqual({ maps: 3, features: 1, images: 0 });
    });

    it('PIOR CASO: banco de mapas ilegível devolve contagem DESCONHECIDA, nunca zero', async () => {
        // Zero e "não sei" são a mesma frase curta na tela, mas não são o mesmo fato, e o zero
        // inventado é o que autorizaria dizer "este atlas está vazio" sobre um acervo cheio.
        const scope = escopo('slot-morto');
        const maps = ns.getStoreFor(ns.StoreName.MAPS, scope);
        maps.iterate = async () => { throw new Error('idb morreu'); };
        expect(await contar(scope)).toBeNull();
    });

    it('PIOR CASO: só o banco de imagens ilegível não derruba a contagem dos mapas', async () => {
        const scope = await semear('slot-meio', { mapas: 2, porMapa: 3 });
        ns.getStoreFor(ns.StoreName.IMAGES, scope).keys = async () => { throw new Error('idb morreu'); };
        expect(await contar(scope)).toEqual({ maps: 2, features: 12, images: 0 });
    });

    it('escopo ausente não estoura: devolve desconhecido', async () => {
        expect(await contar(null)).toBeNull();
    });
});

// ============================================================================
// A FIAÇÃO: a página conta ANTES de perguntar, e passa nome e contagem
// ============================================================================

describe('a página de atlas usa a contagem no diálogo', () => {
    it('conta o escopo do cartão e entrega nome + contagem à frase', () => {
        expect(PAGE_SRC).toContain('countAtlasContents(scopeOfLocalAtlas(atlas))');
        expect(PAGE_SRC).toContain('deleteConfirmMessage({');
        expect(PAGE_SRC).toContain('contents');
    });

    it('contar não pode custar o botão: a leitura é guardada', () => {
        // `scopeOfLocalAtlas` estoura num registro malformado. Sem a guarda, a exclusão morreria
        // ANTES do diálogo e o clique viraria nada, que é um defeito pior do que a frase genérica
        // que este lote saiu para consertar.
        const trecho = PAGE_SRC.slice(
            PAGE_SRC.indexOf('async function deleteLocalAtlasFromPage'),
            PAGE_SRC.indexOf('async function deleteLocalAtlasFromPage') + 900
        );
        expect(trecho).toContain('try {');
        expect(trecho.indexOf('try {')).toBeLessThan(trecho.indexOf('countAtlasContents('));
        expect(trecho).toContain('} catch');
    });

    it('CONTROLE: o texto não voltou para dentro da página', () => {
        expect(PAGE_SRC).not.toContain('ainda não enviado ao servidor. Não há como desfazer');
        expect(PAGE_SRC).not.toContain('NÃO pode ser desfeito');
    });
});
