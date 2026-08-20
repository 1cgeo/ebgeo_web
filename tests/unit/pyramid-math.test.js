// Path: tests/unit/pyramid-math.test.js
/**
 * @fileoverview A escada de tiles 360, medida contra os numeros do piloto.
 *
 * POR QUE ESTE ARQUIVO EXISTE. `pyramid-math.js` acabou de virar a mesma conta
 * em DOIS repositorios: o ebgeo_360 gera a piramide com ela, e o ebgeo_web
 * escolhe o nivel e pede os tiles com ela. Copia nao e paridade. Quando as duas
 * divergirem, o sintoma nao sera erro: sera tile faltando, ou tile pedido no
 * nivel errado, e a tela so fica borrada. Entao a paridade se MEDE aqui, contra
 * os numeros que sairam do navegador no piloto, e nao contra o outro arquivo.
 *
 * Cada teste diz, no comentario, qual implementacao errada ele reprova. Teste
 * que passa dos dois jeitos nao mede nada.
 *
 * A ESCADA MUDOU EM 2026-08-18, e este arquivo mudou junto. Ate aqui ela parava
 * em LARGURA_MINIMA_NIVEL, e o primeiro quadro vinha do `preview_webp`, um
 * segundo dado ao lado da piramide. Agora ela desce ate o nivel caber em UM
 * TILE, entao o nivel 0 E o preview e a piramide basta sozinha. Os testes que
 * fixavam 3 e 4 niveis nao estavam errados: eles registravam a decisao antiga.
 *
 * O QUE ISSO COBRA DESTE REPOSITORIO. Aqui e o CLIENTE: ele le a escada do
 * `tiles.json`, escolhe o nivel e pede o tile. Os niveis novos entram POR BAIXO,
 * entao a numeracao anda: o que era level 0 em 7680 agora e level 3. Quem
 * confundir indice com resolucao passa a servir 458 px onde servia 1875, e nao
 * ha erro nenhum: so borrado. Por isso as asercoes de escolha falam em LARGURA.
 */

import { describe, it, expect } from 'vitest';
import {
    LARGURA_MINIMA_NIVEL,
    RAZAO_PADRAO,
    razaoParaLargura,
    montarEscada,
    custoDaEscada,
    larguraNecessaria,
    escolherNivel,
    tilesVisiveis
} from '@js/street_view_tool/pyramid-math.js';

/** Lado do tile em toda a piramide do acervo. */
const TILE = 512;

/** A escada real de uma foto 7680x3840, o formato de razao 1,6. */
const ESCADA_7680 = montarEscada(7680, 3840, TILE, 1.6);

/** A escada real de uma foto 5760x2880, o formato de razao 2. */
const ESCADA_5760 = montarEscada(5760, 2880, TILE, 2);

/** A escada real de uma foto 2048x1024, o terceiro formato, com 828 fotos. */
const ESCADA_2048 = montarEscada(2048, 1024, TILE, 2);

/** Nivel nativo, que e o ultimo: level 0 e o mais GROSSO. */
const NATIVO_7680 = ESCADA_7680[ESCADA_7680.length - 1];
const NATIVO_5760 = ESCADA_5760[ESCADA_5760.length - 1];

/**
 * A escada que o dado JA GRAVADO tem, com a condicao de parada de antes.
 *
 * Escrita a mao de proposito. O cliente ainda encontra piramides geradas ate
 * 2026-08-18, e precisa saber quantos niveis entraram por baixo depois. Se
 * `montarEscada` a reproduzisse, o teste compararia a funcao com ela mesma.
 *
 * @param {number} width - Largura nativa em pixels.
 * @param {number} height - Altura nativa em pixels.
 * @param {number} tileSize - Lado do tile em pixels.
 * @param {number} [razao=2] - Fator entre um nivel e o proximo.
 * @returns {Array<{level:number,width:number,height:number,cols:number,rows:number}>}
 */
function escadaAntiga(width, height, tileSize, razao = 2) {
    const niveis = [{ width, height }];
    let w = width;
    let h = height;
    // A UNICA diferenca para a escada de hoje: o piso e a largura minima, e nao
    // o tile. Tudo o mais, inclusive o arredondamento, tem de ser igual.
    while (w > LARGURA_MINIMA_NIVEL) {
        const proximaW = Math.max(1, Math.round(w / razao));
        const proximaH = Math.max(1, Math.round(h / razao));
        if (proximaW >= w) break;
        w = proximaW;
        h = proximaH;
        niveis.push({ width: w, height: h });
    }
    niveis.reverse();
    return niveis.map((nivel, level) => ({
        level,
        width: nivel.width,
        height: nivel.height,
        cols: Math.ceil(nivel.width / tileSize),
        rows: Math.ceil(nivel.height / tileSize)
    }));
}

/**
 * Camera de teste, com fov de 1 grau salvo pedido em contrario.
 *
 * Fov estreita de proposito: o arco visivel fica menor que um tile, entao o
 * conjunto retornado tem UMA coluna so e a asercao aponta um numero, nao um
 * intervalo. Intervalo aceitaria a conta errada junto com a certa.
 * @param {number} lon - Longitude do centro da tela, em graus.
 * @param {number} [fov] - Fov vertical em graus.
 * @param {number} [lat] - Latitude do centro da tela, em graus.
 * @returns {{lon:number,lat:number,fov:number,largura:number,altura:number}}
 */
function camera(lon, fov = 1, lat = 0) {
    return { lon, lat, fov, largura: 1000, altura: 1000 };
}

/**
 * As colunas distintas de um conjunto de tiles, em ordem crescente.
 * @param {Array<{x:number}>} tiles - Saida de tilesVisiveis.
 * @returns {Array<number>} Indices de coluna, sem repetir.
 */
function colunas(tiles) {
    return [...new Set(tiles.map(t => t.x))].sort((a, b) => a - b);
}

describe('montarEscada', () => {
    it('em 7680 com razao 1,6 da os sete niveis medidos', () => {
        // ESTE E O TESTE DE PARIDADE, e os numeros nao saem do outro repositorio:
        // saem do `tiles.json` que o servico SERVE. A cauda de 1875 para cima e
        // a do museu_cms, conferida viva: schemaVersion 1, tileSize 512, com as
        // mesmas cols e rows. Os tres degraus abaixo dela sao a decisao de
        // 2026-08-18. Se esta conta divergir do gerador, o cliente pede tile que
        // nao existe.
        //
        // REPROVA a escada de razao 2 (480/960/1920/3840/7680), e reprova a
        // conta antiga da rota, que dividia a largura nativa por
        // 2**(max_level - level) e nunca produz 1875 nem 4800.
        expect(ESCADA_7680.map(n => n.width)).toEqual([458, 733, 1172, 1875, 3000, 4800, 7680]);
        expect(ESCADA_7680.map(n => [n.cols, n.rows])).toEqual(
            [[1, 1], [2, 1], [3, 2], [4, 2], [6, 3], [10, 5], [15, 8]]);
        expect(ESCADA_7680).toHaveLength(7);
    });

    it('em 5760 com razao 2 da os cinco niveis medidos', () => {
        // REPROVA a parada em LARGURA_MINIMA_NIVEL, que dava [1440, 2880, 5760].
        // Com ela o nivel mais grosso ocupava 3 por 2 tiles, e o primeiro quadro
        // tinha de vir do `preview_webp`. A escada agora chega a 360x180, que
        // entra numa requisicao so.
        expect(ESCADA_5760.map(n => n.width)).toEqual([360, 720, 1440, 2880, 5760]);
        expect(ESCADA_5760).toHaveLength(5);
        expect(ESCADA_5760[0].cols).toBe(1);
        expect(ESCADA_5760[0].rows).toBe(1);
    });

    it('em 2048 com razao 2 da tres niveis, e nao um so', () => {
        // O TERCEIRO FORMATO, com 828 fotos, e o caso extremo da decisao: pela
        // regra antiga ele tinha UM nivel, de 4 por 2 tiles, e o cliente nao
        // tinha nada barato para abrir. REPROVA manter a parada por largura,
        // que aqui parava de saida porque 2048 nao passa de 2048.
        expect(ESCADA_2048.map(n => n.width)).toEqual([512, 1024, 2048]);
        expect(escadaAntiga(2048, 1024, TILE, 2)).toHaveLength(1);
        expect(escadaAntiga(2048, 1024, TILE, 2)[0].cols).toBe(4);
    });

    it('poe o nivel 0 dentro de UM TILE, em todo formato e toda razao', () => {
        // O TESTE QUE FIXA A DECISAO NOVA. A piramide tem de bastar sozinha para
        // o `full_webp` e o `preview_webp` serem apagados, e bastar sozinha quer
        // dizer ter um nivel que entra numa requisicao so. Nivel 0 com cols 1 e
        // rows 1 e a definicao disso, e e o que o cliente pede ao abrir a foto.
        //
        // REPROVA a parada por largura em qualquer formato, porque nenhuma das
        // escadas antigas tem nivel 0 de um tile: sao 4x2 em 7680 e 3x2 em 5760.
        const casos = [
            ['7680 razao 1,6', ESCADA_7680],
            ['5760 razao 2', ESCADA_5760],
            ['2048 razao 2', ESCADA_2048],
            ['5760 razao 1,6', montarEscada(5760, 2880, TILE, 1.6)],
            ['7680 razao 2', montarEscada(7680, 3840, TILE, 2)]
        ];
        for (const [nome, escada] of casos) {
            expect(`${nome}: ${escada[0].cols}x${escada[0].rows}`).toBe(`${nome}: 1x1`);
            expect(escada[0].width).toBeLessThanOrEqual(TILE);
        }

        expect(escadaAntiga(7680, 3840, TILE, 1.6)[0].cols).toBe(4);
        expect(escadaAntiga(5760, 2880, TILE, 2)[0].cols).toBe(3);
    });

    it('a parada acompanha o TILE, e nao um numero solto', () => {
        // POR QUE A CONDICAO E `w > tileSize`. Se fosse uma constante nova, a
        // escada continuaria certa hoje e erraria no dia em que o tile mudasse.
        // REPROVA trocar 2048 por 512 cravado: com tile de 256 a escada tem de
        // descer mais, e com tile de 1024 tem de descer menos.
        expect(montarEscada(5760, 2880, 256, 2).map(n => n.width))
            .toEqual([180, 360, 720, 1440, 2880, 5760]);
        expect(montarEscada(5760, 2880, 1024, 2).map(n => n.width))
            .toEqual([720, 1440, 2880, 5760]);
        expect(montarEscada(7680, 3840, 256, 1.6).map(n => n.width))
            .toEqual([179, 286, 458, 733, 1172, 1875, 3000, 4800, 7680]);
        expect(montarEscada(7680, 3840, 1024, 1.6).map(n => n.width))
            .toEqual([733, 1172, 1875, 3000, 4800, 7680]);

        // A propriedade continua valendo nos tres tamanhos de tile, que e o que
        // uma contagem de niveis sozinha nao prova.
        for (const tile of [256, 512, 1024]) {
            for (const [w, h, r] of [[7680, 3840, 1.6], [5760, 2880, 2], [2048, 1024, 2]]) {
                const escada = montarEscada(w, h, tile, r);
                expect(escada[0].cols).toBe(1);
                expect(escada[0].rows).toBe(1);
                expect(escada[0].width).toBeLessThanOrEqual(tile);
            }
        }
    });

    it('desce a altura junto com a largura, a 2:1 menos o arredondamento', () => {
        // REPROVA reduzir so a largura, que produziria uma grade de linhas
        // certa e uma de colunas errada, e nenhum erro em lugar nenhum.
        expect(ESCADA_7680.map(n => n.height)).toEqual([229, 366, 586, 938, 1500, 2400, 3840]);
        // A tolerancia de 1 px NAO e folga: largura e altura arredondam
        // separadamente, e em 1875x938 isso da um pixel acima do 2:1 exato.
        // Exigir 2:1 cravado aqui reprovaria o codigo certo.
        for (const nivel of ESCADA_7680) {
            expect(Math.abs(nivel.width - nivel.height * 2)).toBeLessThanOrEqual(1);
        }
    });

    it('numera do mais GROSSO para o nativo, sem buraco', () => {
        // REPROVA a numeracao invertida. Ela nao levanta erro: escolherNivel
        // devolveria o nivel oposto ao pedido, e a tela ficaria borrada no
        // monitor grande e lenta no notebook, os dois casos ao contrario.
        //
        // Os niveis novos entraram POR BAIXO, entao a lista vai a 6. O contrato
        // nao mudou: level 0 continua sendo o mais grosso.
        expect(ESCADA_7680.map(n => n.level)).toEqual([0, 1, 2, 3, 4, 5, 6]);
        expect(ESCADA_7680[0].width).toBeLessThan(NATIVO_7680.width);
    });

    it('conta a coluna PARCIAL, arredondando para cima', () => {
        // REPROVA Math.floor na conta de cols/rows. Em 5760 o floor daria 11
        // colunas, e os 128 px da ultima ficariam sem tile: uma faixa vertical
        // preta na emenda, exatamente onde o olho passa ao girar 360 graus.
        expect(NATIVO_5760.cols).toBe(12);
        expect(NATIVO_5760.rows).toBe(6);
        // Em 7680 a divisao fecha exata, com 15 colunas cheias. E por isso que
        // o defeito da coluna parcial ficou escondido: metade do acervo o esconde.
        expect(NATIVO_7680.cols).toBe(15);
        expect(NATIVO_7680.rows).toBe(8);
    });

    it('trata razao invalida como a escada classica, sem travar', () => {
        // REPROVA a implementacao sem guarda: razao 1 divide por 1 para
        // sempre, e o laco nunca desce de 5760. O teste trava em vez de falhar,
        // que e o pior modo, entao a guarda tem de estar la.
        expect(montarEscada(5760, 2880, TILE, 1).map(n => n.width))
            .toEqual([360, 720, 1440, 2880, 5760]);
        expect(montarEscada(5760, 2880, TILE, NaN).map(n => n.width))
            .toEqual([360, 720, 1440, 2880, 5760]);
        expect(RAZAO_PADRAO).toBe(2);
    });
});

describe('LARGURA_MINIMA_NIVEL: ler a piramide ja gravada', () => {
    // POR QUE A CONSTANTE SOBREVIVE A DECISAO QUE A APOSENTOU. O acervo tem
    // piramides geradas com a parada antiga, e o cliente ainda as encontra. Sem
    // este numero nao ha como saber quantos niveis entraram por baixo, e
    // adivinhar errado nao da erro: da tile pedido no nivel errado.

    it('continua exportado, com o valor que o dado antigo usou', () => {
        expect(LARGURA_MINIMA_NIVEL).toBe(2048);
    });

    it('reproduz a escada velha: 4 niveis em 7680, 3 em 5760, 1 em 2048', () => {
        // As tres escadas do dado ja gravado, escritas inteiras. Elas sao o ALVO
        // da migracao, e nao um historico decorativo.
        expect(escadaAntiga(7680, 3840, TILE, 1.6).map(n => n.width))
            .toEqual([1875, 3000, 4800, 7680]);
        expect(escadaAntiga(5760, 2880, TILE, 2).map(n => n.width))
            .toEqual([1440, 2880, 5760]);
        expect(escadaAntiga(2048, 1024, TILE, 2).map(n => n.width)).toEqual([2048]);
        expect(escadaAntiga(7680, 3840, TILE, 2).map(n => n.width))
            .toEqual([1920, 3840, 7680]);
    });

    it('a escada velha e SUFIXO da nova, entao a migracao e so um deslocamento', () => {
        // O FATO QUE O CLIENTE USA. Os niveis novos entram por baixo, e nenhum
        // nivel antigo muda de largura, de cols ou de rows: so muda o NUMERO.
        // Entao `level novo = level antigo + deslocamento`.
        //
        // REPROVA gerar de novo por cima com outra grade. Se a escada nova
        // deixasse de conter a velha, o dado gravado viraria lixo, e o sintoma
        // seria 404 no tile, nunca um erro de migracao.
        const casos = [
            ['7680 razao 1,6', 7680, 3840, 1.6, 3],
            ['5760 razao 2', 5760, 2880, 2, 2],
            ['2048 razao 2', 2048, 1024, 2, 2],
            ['7680 razao 2', 7680, 3840, 2, 2]
        ];

        for (const [nome, w, h, razao, esperado] of casos) {
            const velha = escadaAntiga(w, h, TILE, razao);
            const nova = montarEscada(w, h, TILE, razao);
            const deslocamento = nova.length - velha.length;
            expect(`${nome}: ${deslocamento}`).toBe(`${nome}: ${esperado}`);

            for (const antigo of velha) {
                const novo = nova[antigo.level + deslocamento];
                expect(novo.level).toBe(antigo.level + deslocamento);
                expect(novo.width).toBe(antigo.width);
                expect(novo.height).toBe(antigo.height);
                expect(novo.cols).toBe(antigo.cols);
                expect(novo.rows).toBe(antigo.rows);
            }
        }
    });

    it('o nativo continua sendo o ULTIMO nivel nas duas escadas', () => {
        // O contrato nao mudou: level 0 e o mais grosso e o ultimo e o nativo. O
        // que mudou foi quantos degraus existem antes do nativo.
        for (const [w, h, razao] of [[7680, 3840, 1.6], [5760, 2880, 2], [2048, 1024, 2]]) {
            const velha = escadaAntiga(w, h, TILE, razao);
            const nova = montarEscada(w, h, TILE, razao);
            expect(velha[velha.length - 1].width).toBe(w);
            expect(nova[nova.length - 1].width).toBe(w);
            expect(nova[0].level).toBe(0);
        }
    });
});

describe('custoDaEscada', () => {
    it('mede o custo em area contra o nivel nativo', () => {
        // REPROVA dividir pelo total, ou somar so os niveis grossos. O numero
        // orca a razao ANTES de gerar 100 GB, entao errar o denominador aqui
        // decide o acervo inteiro pelo motivo errado.
        //
        // OS DOIS SUBIRAM com a escada descendo ate um tile, e SUBIRAM JUNTOS:
        // antes eram 1,3125 e 1,6028. A comparacao que decide a razao continua
        // valendo, porque os degraus novos entram nas duas escadas.
        expect(custoDaEscada(ESCADA_5760)).toBeCloseTo(1.33203125, 6);
        expect(custoDaEscada(ESCADA_7680)).toBeCloseTo(1.63879, 5);
        expect(custoDaEscada(ESCADA_2048)).toBeCloseTo(1.3125, 6);
    });

    it('cobra o orcamento que autorizou a descida: +2,2%, +1,5% e +31,3%', () => {
        // O NUMERO QUE O CHEFE APROVOU, medido antes de gerar. Descer ate um
        // tile custa area a mais, e o orcamento e por formato porque cada um
        // ganha um numero diferente de degraus. Em 2048 sao 31,3% porque aquele
        // formato tinha UM nivel so, e o denominador e pequeno; sao 828 fotos.
        const acrescimo = (w, h, razao) =>
            custoDaEscada(montarEscada(w, h, TILE, razao))
            / custoDaEscada(escadaAntiga(w, h, TILE, razao)) - 1;

        expect(acrescimo(7680, 3840, 1.6)).toBeCloseTo(0.0224, 3);
        expect(acrescimo(5760, 2880, 2)).toBeCloseTo(0.0149, 3);
        expect(acrescimo(2048, 1024, 2)).toBeCloseTo(0.3125, 6);
    });
});

describe('razaoParaLargura', () => {
    it('da 1,6 em 7680 e 2 em 5760', () => {
        // REPROVA a razao unica. Ela e o motivo do porte: com 2 em 7680 a
        // escada pula de 3840 para 7680, e toda tela satura no nativo.
        expect(razaoParaLargura(7680)).toBe(1.6);
        expect(razaoParaLargura(5760)).toBe(2);
        // O terceiro formato do acervo cai na mesma faixa que 5760: nao ha vao a
        // fechar em 2048, porque a foto inteira e menor que qualquer tela util.
        expect(razaoParaLargura(2048)).toBe(2);
    });

    it('a explicita vence os DOIS formatos', () => {
        // REPROVA a politica por formato aplicada por cima do pedido. Quem
        // passa --razao esta orcando uma escada; ser sobrescrito em silencio
        // geraria um acervo com outra grade, descoberto semanas depois.
        expect(razaoParaLargura(7680, 1.4)).toBe(1.4);
        expect(razaoParaLargura(5760, 1.4)).toBe(1.4);
    });

    it('so null e undefined dizem que o operador nao pediu nada', () => {
        // REPROVA `explicita || padrao`, que engole o zero e devolve 1,6.
        // Zero e pedido invalido, e quem trata isso e o guard do montarEscada:
        // esta funcao so responde QUEM mandou, e o operador mandou.
        expect(razaoParaLargura(7680, 0)).toBe(0);
        expect(razaoParaLargura(7680, null)).toBe(1.6);
        expect(razaoParaLargura(7680, undefined)).toBe(1.6);
    });
});

describe('larguraNecessaria', () => {
    it('da 6119 px no monitor 1904x985 com fov 75', () => {
        // REPROVA a conta pela fov VERTICAL, que na mesma tela da 4728 px e
        // escolheria um nivel abaixo do necessario. A demanda sai da fov
        // horizontal, porque e a largura da tela que consome a panoramica.
        expect(larguraNecessaria(1904, 985, 75)).toBeCloseTo(6118.67, 1);
    });

    it('da 4264 px no notebook 1350x673 com fov 75', () => {
        // REPROVA usar a largura da tela como se fosse a da panoramica: 1350
        // px de tela pedem 4264 px de equirretangular, tres vezes mais.
        expect(larguraNecessaria(1350, 673, 75)).toBeCloseTo(4263.98, 1);
    });

    it('devolve 0, e nunca NaN, com tela ou fov sem area', () => {
        // REPROVA a versao sem guarda. NaN nao explode: toda comparacao com
        // NaN e falsa, entao escolherNivel percorria a escada inteira e caia no
        // NATIVO, o nivel mais caro, para quem nao esta vendo nada. O container
        // oculto e o caso real, e o custo ia todo para a rede do usuario.
        expect(larguraNecessaria(0, 985, 75)).toBe(0);
        expect(larguraNecessaria(1904, 0, 75)).toBe(0);
        expect(larguraNecessaria(1904, 985, 0)).toBe(0);
    });
});

describe('escolherNivel', () => {
    it('sem largura pedida fica no nivel 0, e nao no nativo', () => {
        // REPROVA o laco sem a guarda de entrada. Este e o par do teste acima:
        // e aqui que o NaN virava fatura de rede. O nivel 0 e o barato, e e o
        // certo para a tela que ninguem esta olhando.
        expect(escolherNivel(ESCADA_7680, 0)).toBe(0);
        expect(escolherNivel(ESCADA_7680, NaN)).toBe(0);
        expect(escolherNivel(ESCADA_7680, -5)).toBe(0);
        expect(escolherNivel(ESCADA_7680, 0)).not.toBe(NATIVO_7680.level);
    });

    it('pega o menor nivel que COBRE a largura pedida', () => {
        // REPROVA o nivel mais proximo. 4264 px esta mais perto de 3000 do que
        // de 4800, e escolher 3000 entrega menos pixel do que a tela resolve:
        // borrado de proposito para economizar 40% de bytes que ninguem pediu.
        const nivel = escolherNivel(ESCADA_7680, larguraNecessaria(1350, 673, 75));
        expect(ESCADA_7680[nivel].width).toBe(4800);
    });

    it('satura no nativo quando a tela pede mais que ele', () => {
        // REPROVA devolver um nivel que nao existe, ou undefined, no monitor
        // grande: 6119 px de demanda contra 4800 px do maior nivel intermediario.
        const nivel = escolherNivel(ESCADA_7680, larguraNecessaria(1904, 985, 75));
        expect(ESCADA_7680[nivel].width).toBe(7680);
        expect(nivel).toBe(NATIVO_7680.level);
    });

    it('e a razao 1,6 que salva o notebook, medida contra a razao 2', () => {
        // O TESTE DA DECISAO. Com razao 2 a escada e 1920/3840/7680, e os 4264
        // px do notebook caem no vao: ele satura no nativo e paga 80% de
        // largura a toa. REPROVA voltar a razao 2 em 7680 por engano, que nao
        // quebra nada visivel e apaga a economia inteira do porte.
        const escadaRazao2 = montarEscada(7680, 3840, TILE, 2);
        const pedido = larguraNecessaria(1350, 673, 75);
        expect(escadaRazao2[escolherNivel(escadaRazao2, pedido)].width).toBe(7680);
        expect(ESCADA_7680[escolherNivel(ESCADA_7680, pedido)].width).toBe(4800);
    });

    it('a numeracao andou, a LARGURA escolhida nao', () => {
        // O TESTE QUE PROTEGE O CLIENTE DA DECISAO DE 2026-08-18. Os degraus
        // novos empurraram o indice: o notebook escolhia o level 2 e agora
        // escolhe o level 5. A resolucao entregue continua sendo 4800 px.
        //
        // REPROVA um cliente que tenha decorado o numero do nivel, em vez de o
        // procurar pela largura. Servir o level 2 da escada nova seria mandar
        // 1172 px onde a tela resolve 4264: nao ha erro, so borrado.
        const pedido = larguraNecessaria(1350, 673, 75);
        const velha = escadaAntiga(7680, 3840, TILE, 1.6);

        expect(escolherNivel(velha, pedido)).toBe(2);
        expect(escolherNivel(ESCADA_7680, pedido)).toBe(5);
        expect(ESCADA_7680[escolherNivel(ESCADA_7680, pedido)].width)
            .toBe(velha[escolherNivel(velha, pedido)].width);

        // E vale em todo o alcance que a escada VELHA cobria, nos tres formatos:
        // o indice pode andar, a largura nunca. Abaixo do nivel 0 antigo o
        // filtro corta de proposito, porque ali a escada nova entrega MENOS
        // pixel, e essa e a economia que a decisao comprou.
        const telas = [larguraNecessaria(1350, 673, 75), larguraNecessaria(1904, 985, 75), 900, 42];
        for (const [w, h, razao] of [[7680, 3840, 1.6], [5760, 2880, 2], [7680, 3840, 2]]) {
            const antiga = escadaAntiga(w, h, TILE, razao);
            const nova = montarEscada(w, h, TILE, razao);
            for (const tela of telas.filter(t => t >= antiga[0].width)) {
                expect(nova[escolherNivel(nova, tela)].width)
                    .toBe(antiga[escolherNivel(antiga, tela)].width);
            }
        }
    });

    it('a tela minuscula recebe UM tile, que era o papel do preview', () => {
        // O GANHO DA DECISAO, do lado do cliente. O primeiro quadro, antes de a
        // camera assentar, pede pouco e recebe o nivel 0, de um tile so. Era
        // isso que o `preview_webp` fazia, e e por isso que ele pode ser apagado.
        //
        // REPROVA a escada antiga, cujo nivel 0 em 7680 media 1875 px e 8 tiles:
        // com ela, uma tela de 400 px pagava 8 requisicoes para o primeiro quadro.
        for (const escada of [ESCADA_7680, ESCADA_5760, ESCADA_2048]) {
            const nivel = escolherNivel(escada, 100);
            expect(nivel).toBe(0);
            expect(escada[nivel].cols * escada[nivel].rows).toBe(1);
        }
        expect(escadaAntiga(7680, 3840, TILE, 1.6)[0].cols
            * escadaAntiga(7680, 3840, TILE, 1.6)[0].rows).toBe(8);
    });
});

describe('tilesVisiveis e a ultima coluna parcial', () => {
    it('conta a coluna em PIXEL, nao em indice de tile', () => {
        // O TESTE QUE REPROVA A CONTA INGENUA. Em 5760 com tile 512 sao 12
        // colunas, e a ultima tem 128 px, entao coluna e pixel nao andam
        // juntos. Em lon 351 o centro cai no pixel 5616, dentro da coluna 10.
        // A conta ingenua floor((lon/360)*cols) da floor(11,7) = 11: pede um
        // tile a mais, deixa o certo de fora, e a tela mostra o preview
        // esticado onde o olho esta olhando.
        expect(Math.floor((351 / 360) * NATIVO_5760.cols)).toBe(11);
        expect(colunas(tilesVisiveis(NATIVO_5760, TILE, camera(351), 0))).toEqual([10]);
    });

    it('alcanca a coluna parcial quando o centro cai DENTRO dela', () => {
        // Par do teste acima: a coluna 11 existe e e pedida, mas so a partir do
        // pixel 5632, ou seja lon 352. REPROVA um conserto preguicoso que
        // subtraisse 1 da conta ingenua, que erraria aqui para o outro lado.
        expect(colunas(tilesVisiveis(NATIVO_5760, TILE, camera(356), 0))).toEqual([11]);
    });

    it('gasta so os 128 px da coluna parcial ao atravessa-la', () => {
        // O arco de 16 graus em lon 356 cobre 256 px: 64 px da coluna 10, os
        // 128 px da coluna 11, e volta para a coluna 0. REPROVA a caminhada que
        // avanca um tileSize cheio na ultima coluna: ela consumiria 512 px onde
        // so ha 128, pararia antes da volta e deixaria a coluna 0 de fora,
        // abrindo buraco na emenda dos 360 graus.
        expect(colunas(tilesVisiveis(NATIVO_5760, TILE, camera(356, 16), 0))).toEqual([0, 10, 11]);
    });

    it('em 7680 a conta ingenua coincide, e e por isso que o defeito se escondeu', () => {
        // 15 colunas de 512 px fecham exatos os 7680, entao coluna e pixel
        // andam juntos e as duas contas concordam. REPROVA "consertar" a conta
        // de pixel de um jeito que estrague o formato que ja estava certo.
        expect(NATIVO_7680.cols * TILE).toBe(NATIVO_7680.width);
        expect(Math.floor((351 / 360) * NATIVO_7680.cols)).toBe(14);
        expect(colunas(tilesVisiveis(NATIVO_7680, TILE, camera(351), 0))).toEqual([14]);
    });
});

describe('tilesVisiveis, o resto do frustum', () => {
    it('a margem da a volta pelo zero', () => {
        // REPROVA a margem por intervalo simples. Em torno da coluna 11, um
        // `for (c-1; c<=c+1)` sem modulo pediria a coluna 12, que nao existe:
        // 404 no tile, e nada na emenda. A margem existe justamente para nao
        // abrir buraco ao arrastar.
        expect(colunas(tilesVisiveis(NATIVO_5760, TILE, camera(351), 1))).toEqual([9, 10, 11]);
        expect(colunas(tilesVisiveis(NATIVO_5760, TILE, camera(356), 1))).toEqual([0, 10, 11]);
    });

    it('a faixa de longitude ALARGA perto do zenite', () => {
        // REPROVA a conta que ignora o cosseno da latitude. Um grau de
        // longitude encurta ao subir, entao a mesma fov de 30 graus cobre 2
        // colunas no horizonte e a panoramica INTEIRA a 75 graus. Sem isso, o
        // usuario que olha para cima ve tile faltando em volta.
        const horizonte = tilesVisiveis(NATIVO_5760, TILE, camera(180, 30, 0), 0);
        const zenite = tilesVisiveis(NATIVO_5760, TILE, camera(180, 30, 75), 0);
        expect(colunas(horizonte)).toHaveLength(2);
        expect(colunas(zenite)).toHaveLength(NATIVO_5760.cols);
    });

    it('cobre a volta inteira sem repetir coluna quando a fov abraca tudo', () => {
        // REPROVA a caminhada em pixel sem teto: um arco de 360 graus ou mais
        // daria a volta para sempre, ou repetiria colunas e dobraria os
        // pedidos de rede. O caminho de meiaLon >= 180 tem de ser o atalho.
        const tudo = tilesVisiveis(NATIVO_5760, TILE, { lon: 0, lat: 0, fov: 180, largura: 2000, altura: 500 }, 0);
        expect(colunas(tudo)).toHaveLength(NATIVO_5760.cols);
        expect(tudo.every(t => t.x >= 0 && t.x < NATIVO_5760.cols)).toBe(true);
    });

    it('entrega do centro da tela para a borda', () => {
        // REPROVA a lista em ordem de indice. Os tiles chegam um a um, e o
        // primeiro a chegar tem de ser o que o olho esta olhando. Em ordem de
        // indice o centro chegaria por ultimo em metade dos casos.
        const lista = tilesVisiveis(NATIVO_5760, TILE, camera(351), 1);
        expect(lista[0].x).toBe(10);
        for (let i = 1; i < lista.length; i++) {
            expect(lista[i].d).toBeGreaterThanOrEqual(lista[i - 1].d);
        }
    });

    it('nunca pede linha fora da grade', () => {
        // REPROVA a conta de linha sem corte nas bordas. No polo a margem
        // empurra y para -1 e para rows, e os dois viram 404 no tile: mancha
        // preta exatamente no zenite e no nadir, onde a emenda ja e frageil.
        for (const lat of [90, 89, 0, -89, -90]) {
            const lista = tilesVisiveis(NATIVO_5760, TILE, camera(0, 90, lat), 2);
            expect(lista.length).toBeGreaterThan(0);
            expect(lista.every(t => t.y >= 0 && t.y < NATIVO_5760.rows)).toBe(true);
        }
    });
});
