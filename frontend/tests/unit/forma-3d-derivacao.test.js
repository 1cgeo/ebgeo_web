// Path: tests/unit/forma-3d-derivacao.test.js
//
// A DERIVACAO DE COMPATIBILIDADE, QUE E A METADE COM PRAZO DE VALIDADE.
//
// `derivarForma3d` responde a mesma pergunta para duas geracoes de linha: a que DECLARA a forma
// (`config.forma3d`, escrita pelo painel e validada pelo Joi) e a que so tem os discriminadores
// improvisados que o eixo aposentou (`config.type = 'glb'`, `config.viewer = 'firstPerson'`).
// Enquanto as duas coexistirem, apagar a metade legada transforma todo GLB antigo numa chamada ao
// carregador de tileset -- que desenha NADA, sem erro nenhum. Este arquivo prende os quatro casos
// que a migracao 010 produz e os que ela nao alcanca.
//
// POR QUE ISTO E TESTE DE FUNCAO PURA E NAO DE TELA: `forma-3d.js` tem ZERO imports de proposito
// (ele e lido pelo mapa, pelo catalogo, pelo visualizador Cesium e pela pagina de administracao,
// que boota sem a store), entao ele roda em node puro sem mock nenhum.

import { describe, it, expect } from 'vitest';
import {
    Forma3D,
    FORMAS_3D,
    CAMPO_FORMA_3D,
    Visualizador3D,
    VIEWER_LEGADO_INDOOR,
    TYPE_LEGADO_GLB,
    derivarForma3d,
    visualizadorDaForma,
    isForma3D,
    ehFormaDoCesium,
    ehEntradaDoCesium,
    ehEntradaIndoor,
} from '@catalog/forma-3d.js';

describe('derivarForma3d: a linha que DECLARA', () => {
    it('o valor declarado vence, para os quatro', () => {
        for (const forma of FORMAS_3D) {
            expect(derivarForma3d({ [CAMPO_FORMA_3D]: forma })).toBe(forma);
        }
    });

    it('o valor declarado vence TAMBEM quando o discriminador legado diz outra coisa', () => {
        // O caso que a migracao 010 nao produz e a tela produz: um item marcado a mao como nuvem
        // de pontos, cujo `config` ainda carrega o `type` antigo. Se o legado vencesse, marcar a
        // nuvem pelo painel nao teria efeito nenhum -- e a marcacao manual e o UNICO caminho ate
        // `pointcloud`, porque no banco ela e indistinguivel de um tileset.
        expect(derivarForma3d({ [CAMPO_FORMA_3D]: Forma3D.POINTCLOUD, type: TYPE_LEGADO_GLB }))
            .toBe(Forma3D.POINTCLOUD);
        expect(derivarForma3d({ [CAMPO_FORMA_3D]: Forma3D.TILES3D, viewer: VIEWER_LEGADO_INDOOR }))
            .toBe(Forma3D.TILES3D);
    });

    it('valor declarado FORA dos quatro nao e propagado: degrada para a derivacao legada', () => {
        // So chega aqui por SQL direto (o Joi da borda recusa), e propagar um valor desconhecido
        // faria `visualizadorDaForma` levantar la na frente, longe da causa.
        expect(derivarForma3d({ [CAMPO_FORMA_3D]: 'holograma' })).toBe(Forma3D.TILES3D);
        expect(derivarForma3d({ [CAMPO_FORMA_3D]: 'holograma', type: TYPE_LEGADO_GLB })).toBe(Forma3D.GLB);
        expect(derivarForma3d({ [CAMPO_FORMA_3D]: 'holograma', viewer: VIEWER_LEGADO_INDOOR }))
            .toBe(Forma3D.INDOOR);
    });
});

describe('derivarForma3d: a linha LEGADA (sem o campo)', () => {
    it('linha comum de tileset vira tiles3d', () => {
        const linha = { id: 'quartel', name: 'Quartel', url: '/3d/quartel/tileset.json', heightOffset: 0 };
        expect(derivarForma3d(linha)).toBe(Forma3D.TILES3D);
    });

    it('linha `type: glb` vira glb', () => {
        const linha = { id: 'torre', name: 'Torre', type: 'glb', url: '/3d/torre/torre.glb' };
        expect(derivarForma3d(linha)).toBe(Forma3D.GLB);
    });

    it('linha `viewer: firstPerson` vira indoor', () => {
        const linha = { id: 'cena', name: 'Cena', viewer: 'firstPerson', basePath: '/3d/cena' };
        expect(derivarForma3d(linha)).toBe(Forma3D.INDOOR);
    });

    it('a cena indoor vence o `type` legado quando os dois estao presentes', () => {
        // A ordem importa e e a mesma da migracao 010: a cena nunca foi um tileset, entao ela e
        // perguntada primeiro. Uma linha com os dois campos e lixo historico, e a ordem decide
        // para qual VISUALIZADOR ela vai -- errar aqui manda a cena para o Cesium.
        expect(derivarForma3d({ viewer: 'firstPerson', type: 'glb' })).toBe(Forma3D.INDOOR);
    });

    it('linha sem NENHUM sinal cai no default historico', () => {
        expect(derivarForma3d({})).toBe(Forma3D.TILES3D);
    });
});

describe('derivarForma3d: bordas', () => {
    it('entrada que nao e objeto devolve o default, nunca lanca', () => {
        // Ela e chamada de dentro de `.filter()` sobre `config.tilesets`, que vem do servidor:
        // uma excecao ali esvaziaria o catalogo 3D inteiro por causa de uma linha malformada.
        for (const lixo of [null, undefined, 0, '', 'tiles3d', NaN, true]) {
            expect(derivarForma3d(lixo)).toBe(Forma3D.TILES3D);
        }
    });

    it('array e tratado como objeto e cai no default (nao tem os campos)', () => {
        expect(derivarForma3d([])).toBe(Forma3D.TILES3D);
    });

    it('campo declarado com o tipo errado nao passa por declarado', () => {
        // `isForma3D` exige string: um `true` ou um numero na chave (JSONB aceita qualquer coisa)
        // nao pode virar forma por coercao.
        expect(derivarForma3d({ [CAMPO_FORMA_3D]: true, type: 'glb' })).toBe(Forma3D.GLB);
        expect(derivarForma3d({ [CAMPO_FORMA_3D]: 0 })).toBe(Forma3D.TILES3D);
        expect(derivarForma3d({ [CAMPO_FORMA_3D]: ['glb'] })).toBe(Forma3D.TILES3D);
    });

    it('a comparacao do valor declarado e exata: sem trim, sem case-insensitive', () => {
        expect(derivarForma3d({ [CAMPO_FORMA_3D]: ' glb' })).toBe(Forma3D.TILES3D);
        expect(derivarForma3d({ [CAMPO_FORMA_3D]: 'GLB' })).toBe(Forma3D.TILES3D);
    });

    it('sempre devolve um dos quatro, qualquer que seja a entrada', () => {
        const entradas = [null, {}, { type: 'glb' }, { viewer: 'firstPerson' }, { forma3d: 'x' }, 42];
        for (const e of entradas) {
            expect(FORMAS_3D).toContain(derivarForma3d(e));
        }
    });
});

describe('isForma3D', () => {
    it('aceita os quatro e recusa o resto', () => {
        for (const forma of FORMAS_3D) expect(isForma3D(forma)).toBe(true);
        for (const lixo of ['holograma', '', ' tiles3d', 'TILES3D', null, undefined, 0, {}, ['glb']]) {
            expect(isForma3D(lixo)).toBe(false);
        }
    });
});

describe('visualizadorDaForma', () => {
    it('roteia as quatro formas para os tres visualizadores', () => {
        expect(visualizadorDaForma(Forma3D.TILES3D)).toBe(Visualizador3D.CESIUM_TILESET);
        expect(visualizadorDaForma(Forma3D.POINTCLOUD)).toBe(Visualizador3D.CESIUM_TILESET);
        expect(visualizadorDaForma(Forma3D.GLB)).toBe(Visualizador3D.CESIUM_MODEL);
        expect(visualizadorDaForma(Forma3D.INDOOR)).toBe(Visualizador3D.FIRST_PERSON);
    });

    it('LANCA para forma desconhecida, em vez de escolher um default', () => {
        // Sem default nao existe "cair no ramo do tileset em silencio", que e a forma exata do
        // defeito que este eixo aposentou.
        expect(() => visualizadorDaForma('holograma')).toThrow(/sem ramo de visualizador/);
        expect(() => visualizadorDaForma(undefined)).toThrow(/sem ramo de visualizador/);
        expect(() => visualizadorDaForma('')).toThrow(/sem ramo de visualizador/);
    });

    it('nao herda ramo do prototipo de Object', () => {
        // `VISUALIZADOR_POR_FORMA['toString']` seria truthy num objeto comum, e a funcao
        // devolveria uma funcao no lugar de um visualizador.
        expect(() => visualizadorDaForma('toString')).toThrow(/sem ramo de visualizador/);
        expect(() => visualizadorDaForma('constructor')).toThrow(/sem ramo de visualizador/);
    });
});

describe('os predicados de particao', () => {
    it('a particao e TOTAL e DISJUNTA sobre as quatro formas', () => {
        // Toda forma esta em exatamente um dos dois lados: o que a versao por exclusao prometia e
        // nao entregava, porque o lado do Cesium era "tudo o que sobra".
        for (const forma of FORMAS_3D) {
            const cesium = ehFormaDoCesium(forma);
            const indoor = visualizadorDaForma(forma) === Visualizador3D.FIRST_PERSON;
            expect(cesium || indoor, `${forma} nao esta em lado nenhum`).toBe(true);
            expect(cesium && indoor, `${forma} esta nos dois lados`).toBe(false);
        }
    });

    it('forma desconhecida NAO entra no lado do Cesium', () => {
        // A diferenca concreta em relacao a `viewer !== 'firstPerson'`, que a incluia.
        expect(ehFormaDoCesium('holograma')).toBe(false);
        expect(ehFormaDoCesium(undefined)).toBe(false);
        expect(ehEntradaDoCesium({ [CAMPO_FORMA_3D]: 'holograma', viewer: VIEWER_LEGADO_INDOOR })).toBe(false);
    });

    it('ehEntradaDoCesium e ehEntradaIndoor concordam com a derivacao', () => {
        const cena = { viewer: 'firstPerson', basePath: '/3d/cena' };
        const nuvem = { [CAMPO_FORMA_3D]: Forma3D.POINTCLOUD, url: '/3d/nuvem/tileset.json' };
        expect(ehEntradaIndoor(cena)).toBe(true);
        expect(ehEntradaDoCesium(cena)).toBe(false);
        expect(ehEntradaDoCesium(nuvem)).toBe(true);
        expect(ehEntradaIndoor(nuvem)).toBe(false);
        // Lixo nao e cena: `null` cai no default, que e do Cesium, e quem o descarta e o
        // `isUsableScene` do servico de cena.
        expect(ehEntradaIndoor(null)).toBe(false);
    });
});
