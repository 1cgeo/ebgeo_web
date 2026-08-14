// Path: tests/unit/calibracao-descricao-alvo.test.js
//
// O QUE A TELA DIZ DE UMA FOTO: distancia, andar e, pela ALTURA, quantos
// andares de degrau.
//
// POR QUE ESTE TESTE EXISTE. Tres telas da calibracao descrevem a MESMA foto: o
// marcador verde sobre a fotografia, a lista de alvos do painel e o rotulo do
// preview. Descricao escrita em tres lugares vira tres descricoes diferentes do
// mesmo objeto, e o operador nao tem como saber qual delas mentiu. A regra
// virou funcao pura (`calibration/descricao.js`), e o que e dado se testa.
//
// Os numeros sao os MEDIDOS no acervo Beira-Rio, citados na mensagem do commit
// de origem (ebgeo_360 229fe9d), nao inventados aqui.

import { test, describe } from 'vitest';
import assert from 'node:assert/strict';

import { descreverAlvo } from '@js/calibration/descricao.js';
import { desenharDescricao, StreetViewRenderer } from '@js/calibration/renderer.js';
import { StreetViewProjector } from '@js/calibration/projector.js';
import { NAV_CONSTANTS } from '@js/calibration/constants.js';
import { projectNearbyPhoto } from '@js/calibration/navigator.js';

// O elevador do 5o para o 6o andar, o caso que da nome a regra: 1,84 m em
// planta e 12,83 m de subida real.
const NO_QUINTO = { floor_level: 5, ele: 17.6 };
const ELEVADOR_6O = {
    floor_level: 6, ele: 30.3, distance: 1.84, floor_label: '6º andar',
};

describe('descreverAlvo', () => {
    test('sempre diz a distancia', () => {
        const d = descreverAlvo({ distance: 7.8, floor_level: 5 }, NO_QUINTO);
        assert.equal(d.distancia, '7.8m');
    });

    test('a forma CURTA nao tem decimal nem unidade', () => {
        // E a que vai sobre a fotografia, onde o texto disputa espaco com a
        // imagem. Quem le quer saber se sao 2 ou 20 passos.
        assert.equal(descreverAlvo({ distance: 7.8 }, null).distanciaCurta, '8');
        assert.equal(descreverAlvo({ distance: 1.82 }, null).distanciaCurta, '2');
        assert.equal(descreverAlvo({ distance: 28.34 }, null).distanciaCurta, '28');
    });

    test('as duas formas convivem, e a precisa continua na lista', () => {
        const d = descreverAlvo({ distance: 1.84 }, null);
        assert.equal(d.distancia, '1.8m');
        assert.equal(d.distanciaCurta, '2');
    });

    test('distancia ZERO e um numero, e nao um vazio', () => {
        // A borda que o `??` erra: `0 ?? '...'` devolve 0, mas um `if (dist)`
        // trataria a foto colada como foto sem distancia, e a bola sairia muda.
        const d = descreverAlvo({ distance: 0, floor_level: 5 }, NO_QUINTO);
        assert.equal(d.distancia, '0.0m');
        assert.equal(d.distanciaCurta, '0');
    });

    test('sem distancia, nenhuma das duas formas existe', () => {
        const d = descreverAlvo({ floor_level: 5 }, NO_QUINTO);
        assert.equal(d.distancia, null);
        assert.equal(d.distanciaCurta, null);
    });

    test('distancia que nao e numero nao chega na tela como NaN', () => {
        // `x ?? 0` NAO protege contra NaN: sem `Number.isFinite` a bola
        // escreveria "NaNm" sobre a fotografia.
        for (const lixo of [NaN, Infinity, -Infinity, null, undefined, '12', {}]) {
            const d = descreverAlvo({ distance: lixo, floor_level: 5 }, NO_QUINTO);
            assert.equal(d.distancia, null, `distancia ${String(lixo)} vazou`);
            assert.equal(d.distanciaCurta, null, `curta ${String(lixo)} vazou`);
        }
    });

    test('mesmo andar nao ganha marca de andar', () => {
        const d = descreverAlvo(
            { distance: 7.8, floor_level: 5, floor_label: '5º andar' }, NO_QUINTO);
        assert.equal(d.andar, null);
    });

    test('andar ACIMA diz qual andar, pelo rotulo do alvo', () => {
        const d = descreverAlvo(ELEVADOR_6O, NO_QUINTO);
        assert.equal(d.andar, '6º andar');
    });

    test('andar ABAIXO tambem diz, e a marca e a mesma', () => {
        // A marca nao muda de forma com o sentido: quem diz o sentido e a
        // altura do marcador, nao o texto.
        const d = descreverAlvo(
            { distance: 3.2, floor_level: 4, floor_label: '4º andar' }, NO_QUINTO);
        assert.equal(d.andar, '4º andar');
    });

    test('o nivel 0 aparece como Externo, e nao como zero', () => {
        const d = descreverAlvo(
            { distance: 12.0, floor_level: 0, floor_label: 'Externo' },
            { floor_level: 1, ele: 0 });
        assert.equal(d.andar, 'Externo');
    });

    test('sem rotulo, cai no nivel, que ainda diz mais que nada', () => {
        const d = descreverAlvo(
            { distance: 12.0, floor_level: 2, floor_label: null },
            { floor_level: 1, ele: 0 });
        assert.equal(d.andar, 'nível 2');
    });

    test('a distancia sai em PLANTA, sem somar o desnivel', () => {
        // A cota NAO acompanha o andar neste acervo: o 4o andar inteiro em
        // zero, a area externa ate 100 m. Somar 12,7 m de "subida" a este alvo
        // daria um numero preciso e falso. Quem avisa da troca e o rotulo.
        const d = descreverAlvo(ELEVADOR_6O, NO_QUINTO);
        assert.equal(d.distancia, '1.8m');
        assert.equal(d.andar, '6º andar');
        assert.equal(d.distancia3d, undefined);
    });

    test('a cota do alvo nao muda nada, nem a do observador', () => {
        // Duas cotas absurdas, mesma resposta: a descricao nao le `ele`.
        const comCota = descreverAlvo(
            { distance: 9.0, floor_level: 2, ele: 118.3, floor_label: '2º andar' },
            { floor_level: 1, ele: 0 });
        const semCota = descreverAlvo(
            { distance: 9.0, floor_level: 2, floor_label: '2º andar' },
            { floor_level: 1 });

        assert.deepEqual(comCota, semCota);
        assert.equal(comCota.distancia, '9.0m');
    });

    test('projeto SEM andar declarado nao ganha marca nenhuma', () => {
        // Os projetos externos tem floor_level 1 em tudo. A tela deles nao
        // pode mudar por causa desta regra.
        const d = descreverAlvo(
            { distance: 15.2, floor_level: 1 }, { floor_level: 1, ele: 0 });
        assert.equal(d.andar, null);
        assert.equal(d.distancia, '15.2m');
    });

    test('nivel que nao e numero nao inventa troca de andar', () => {
        for (const vazio of [null, undefined, '3']) {
            assert.equal(
                descreverAlvo({ distance: 4, floor_level: vazio }, NO_QUINTO).andar, null,
                `alvo com nivel ${String(vazio)} inventou marca`);
            assert.equal(
                descreverAlvo({ distance: 4, floor_level: 6 }, { floor_level: vazio }).andar, null,
                `camera com nivel ${String(vazio)} inventou marca`);
        }
    });

    test('nao estoura sem alvo nem sem camera', () => {
        assert.equal(descreverAlvo(null, null).distancia, null);
        assert.equal(descreverAlvo(undefined, undefined).andar, null);
        assert.equal(descreverAlvo({ distance: 3 }, null).distancia, '3.0m');
    });
});

/**
 * Contexto de canvas falso, que so ANOTA o que foi pedido. O marcador verde
 * desenha sobre a fotografia, e sem espiao a unica prova seria o olho de quem
 * usa.
 *
 * Nao tem `measureText` de proposito: o contexto de verdade tem, e o codigo
 * precisa funcionar nos dois. Uma placa medida com NaN nao desenha.
 *
 * @returns {Object} Contexto falso com os registros de texto, placa e circulo
 */
function ctxFalso() {
    const textos = [];
    const placas = [];
    const circulos = [];
    return {
        textos, placas, circulos,
        save() {}, restore() {}, translate() {}, beginPath() {}, stroke() {},
        arc(x, y, r) { circulos.push({ x, y, r, cor: this.fillStyle }); },
        fill() {},
        fillRect(x, y, w, h) { placas.push({ x, y, w, h, cor: this.fillStyle }); },
        strokeRect() {},
        strokeText(t, x, y) { textos.push({ t, x, y, tipo: 'contorno' }); },
        fillText(t, x, y) { textos.push({ t, x, y, tipo: 'corpo', cor: this.fillStyle }); },
    };
}

/**
 * Um renderizador com canvas falso, para exercitar o marcador inteiro.
 * @returns {{renderer: StreetViewRenderer, ctx: Object}} O renderizador e o espiao
 */
function rendererFalso() {
    const ctx = ctxFalso();
    const canvas = { width: 1200, height: 800, getContext: () => ctx };
    return { renderer: new StreetViewRenderer(canvas), ctx };
}

describe('desenharDescricao, o texto sob o marcador verde', () => {
    test('escreve a distancia CURTA, e ela vai ABAIXO do marcador', () => {
        const ctx = ctxFalso();
        desenharDescricao(ctx, 10, { distanciaCurta: '8' });

        const corpos = ctx.textos.filter(d => d.tipo === 'corpo');
        assert.deepEqual(corpos.map(d => d.t), ['8']);
        assert.ok(corpos[0].y > 10, 'o texto invadiu o marcador');
    });

    test('a forma precisa NAO vai para o canvas', () => {
        // A regua que separa as duas formas. Sem ela o marcador voltaria a
        // escrever "7.8m" no dia em que alguem trocasse o campo lido.
        const ctx = ctxFalso();
        desenharDescricao(ctx, 10, { distancia: '7.8m' });

        assert.equal(ctx.textos.length, 0,
            `escreveu a forma precisa sobre a foto: ${JSON.stringify(ctx.textos)}`);
    });

    test('o andar NAO vai escrito por extenso aqui, ele vai na bola', () => {
        const ctx = ctxFalso();
        desenharDescricao(ctx, 10, { distanciaCurta: '2', andar: '6º andar' });

        const corpos = ctx.textos.filter(d => d.tipo === 'corpo');
        assert.deepEqual(corpos.map(d => d.t), ['2']);
    });

    test('a placa e OPACA, e cobre o numero por inteiro', () => {
        // A razao de existir: com dois marcadores sobrepostos, contorno de
        // texto deixa os dois numeros legiveis um sobre o outro. A placa sem
        // transparencia esconde o de tras.
        const ctx = ctxFalso();
        desenharDescricao(ctx, 10, { distanciaCurta: '28' });

        assert.equal(ctx.placas.length, 1, 'nenhuma placa desenhada');
        const placa = ctx.placas[0];
        assert.ok(!/rgba|transparent/i.test(placa.cor),
            `a placa saiu translucida: ${placa.cor}`);
        assert.ok(placa.w > 0 && placa.h > 0, 'placa com medida invalida');
        assert.ok(Number.isFinite(placa.w),
            'largura NaN: sem measureText a placa nao desenha');

        // O numero cai DENTRO da placa, e nao ao lado dela.
        const texto = ctx.textos.find(d => d.tipo === 'corpo');
        assert.ok(texto.y > placa.y && texto.y < placa.y + placa.h,
            'o numero saiu fora da propria placa');
    });

    test('a placa vem ANTES do numero, senao tapa o que devia realcar', () => {
        const ctx = ctxFalso();
        const ordem = [];
        const original = { fillRect: ctx.fillRect, fillText: ctx.fillText };
        ctx.fillRect = function (...a) { ordem.push('placa'); original.fillRect.apply(this, a); };
        ctx.fillText = function (...a) { ordem.push('texto'); original.fillText.apply(this, a); };

        desenharDescricao(ctx, 10, { distanciaCurta: '8' });

        assert.deepEqual(ordem, ['placa', 'texto']);
    });

    test('sem descricao nao escreve nada, e nao estoura', () => {
        for (const vazio of [null, undefined, {}, { distanciaCurta: null }]) {
            const ctx = ctxFalso();
            desenharDescricao(ctx, 10, vazio);
            assert.equal(ctx.textos.length, 0);
            assert.equal(ctx.placas.length, 0);
        }
    });
});

describe('o marcador verde da vizinha', () => {
    const base = { screenX: 100, screenY: 200, radius: 10, distance: 3, rank: 1 };

    test('o andar vai no CENTRO da bola, como glifo', () => {
        const { renderer, ctx } = rendererFalso();
        renderer.renderNearbyMarker({
            ...base, floorDelta: 1, floorLevel: 6, floorLabel: '6º andar',
            descricao: { distanciaCurta: '3' },
        });

        const centro = ctx.textos.find(d => d.x === 0 && d.y === 0);
        assert.ok(centro, 'nada escrito no centro da bola');
        assert.equal(centro.t, '6');
    });

    test('o glifo segue a mesma regra da esfera: Externo vira E', () => {
        const { renderer, ctx } = rendererFalso();
        renderer.renderNearbyMarker({
            ...base, floorDelta: -1, floorLevel: 0, floorLabel: 'Externo',
            descricao: { distanciaCurta: '9' },
        });

        assert.equal(ctx.textos.find(d => d.x === 0 && d.y === 0).t, 'E');
    });

    test('mesmo andar nao ganha glifo nenhum', () => {
        const { renderer, ctx } = rendererFalso();
        renderer.renderNearbyMarker({
            ...base, floorDelta: 0, floorLevel: 5, floorLabel: '5º andar',
            descricao: { distanciaCurta: '3' },
        });

        assert.equal(ctx.textos.find(d => d.x === 0 && d.y === 0), undefined);
    });

    test('a distancia sai sob a bola, mesmo sem troca de andar', () => {
        const { renderer, ctx } = rendererFalso();
        renderer.renderNearbyMarker({
            ...base, floorDelta: 0, descricao: { distanciaCurta: '3' },
        });

        assert.ok(ctx.textos.some(d => d.t === '3' && d.y > base.radius),
            'a bola voltou a ser muda');
    });

    test('o disco e OPACO, senao dois marcadores viram uma mancha', () => {
        const { renderer, ctx } = rendererFalso();
        renderer.renderNearbyMarker({ ...base, floorDelta: 0, descricao: null });

        const disco = ctx.circulos.find(c => c.r === base.radius);
        assert.ok(disco, 'o disco nao foi desenhado');
        assert.ok(!/rgba|transparent/i.test(disco.cor),
            `o disco saiu translucido: ${disco.cor}`);
    });
});

describe('elevacaoDeVizinha, a ALTURA que diz quantos andares', () => {
    // O que substitui uma frase "2 andares acima" sobre a fotografia: a
    // resposta e o lugar onde a bola e desenhada, e nao texto repetido em cada
    // marcador. Por isso o QUANTOS se mede aqui, e nao em `descreverAlvo`.
    function proj() {
        const p = new StreetViewProjector(1200, 800);
        p.setCameraConfig({ lon: 0, lat: 0 });
        return p;
    }

    test('mesmo andar fica na faixa dos alvos, como sempre', () => {
        const p = proj();
        assert.ok(Math.abs(p.elevacaoDeVizinha(0) - p.elevationDeg(0)) < 1e-12);
        assert.ok(Math.abs(p.elevacaoDeVizinha(null) - p.elevationDeg(0)) < 1e-12);
        assert.ok(Math.abs(p.elevacaoDeVizinha(NaN) - p.elevationDeg(0)) < 1e-12);
        assert.ok(Math.abs(p.elevacaoDeVizinha(undefined) - p.elevationDeg(0)) < 1e-12);
    });

    test('cada andar de diferenca fica numa altura DIFERENTE', () => {
        // A razao da regra: com a busca em todos os andares aparecem sete
        // niveis de uma vez, e duas alturas so viram uma pilha. E o que separa
        // "1 andar acima" de "2 andares acima" sem escrever nenhum dos dois.
        const p = proj();
        const alturas = [1, 2, 3, 4, 5, 6].map(d => p.elevacaoDeVizinha(d));

        for (let i = 1; i < alturas.length; i++) {
            assert.ok(alturas[i] > alturas[i - 1],
                `andar ${i + 1} nao subiu em relacao ao ${i}`);
        }
        assert.equal(new Set(alturas).size, alturas.length);
        // Asercao absoluta: o passo medido, em graus, entre dois degraus.
        assert.ok(Math.abs((alturas[1] - alturas[0]) - NAV_CONSTANTS.ANDAR_PASSO_DEG) < 1e-12);
    });

    test('subir e descer sao espelhos', () => {
        const p = proj();
        for (const d of [1, 2, 3, 6]) {
            assert.ok(Math.abs(p.elevacaoDeVizinha(d) + p.elevacaoDeVizinha(-d)) < 1e-12);
        }
    });

    test('quem sobe fica acima do horizonte, quem desce abaixo', () => {
        const p = proj();
        for (const d of [1, 2, 3, 6, 12]) {
            assert.ok(p.elevacaoDeVizinha(d) > 0, `subir ${d} nao ficou acima`);
            assert.ok(p.elevacaoDeVizinha(-d) < 0, `descer ${d} nao ficou abaixo`);
        }
    });

    test('o primeiro degrau bate com o do alvo que troca de andar', () => {
        // Vizinha de um andar acima e alvo de um andar acima nascem na mesma
        // altura: sao a mesma informacao, e alturas diferentes mentiriam.
        const p = proj();
        assert.ok(Math.abs(p.elevacaoDeVizinha(1) - p.elevacaoComAndar(0, 1)) < 1e-12);
        // E o numero de controle do commit de origem: +4,20 graus.
        assert.ok(Math.abs(p.elevacaoDeVizinha(1) - 4.20) < 0.005,
            `esperado +4,20 graus, veio ${p.elevacaoDeVizinha(1)}`);
    });

    test('a altura para de crescer no teto de degraus', () => {
        // Sem teto, a vizinha do outro extremo do predio sairia da tela.
        const p = proj();
        const teto = NAV_CONSTANTS.ANDAR_DEGRAUS_MAX;
        assert.ok(Math.abs(p.elevacaoDeVizinha(teto) - p.elevacaoDeVizinha(teto + 5)) < 1e-12);
        assert.ok(Math.abs(p.elevacaoDeVizinha(-teto) - p.elevacaoDeVizinha(-teto - 99)) < 1e-12);
    });
});

describe('a LIGACAO: projectNearbyPhoto usa a altura de degrau, e nao a fixa', () => {
    // As duas pontas ja tinham teste: `elevacaoDeVizinha` como funcao pura e o
    // desenho do marcador a partir de um objeto montado a mao. O FIO entre elas
    // nao tinha nenhum, e e ele que se desfaz num refactor: bastava a chamada
    // voltar a `elevationDeg(0)` para os sete niveis do Beira-Rio empilharem
    // numa faixa so, com toda a suite verde.
    const CAMERA = { lon: -51.2350, lat: -30.0650, floor_level: 5, ele: 17.6 };

    // Projetor espiao: registra com que elevacao a projecao foi pedida, e
    // devolve sempre visivel para o teste nao depender do enquadramento.
    function projetorEspiao() {
        const real = new StreetViewProjector(1200, 800);
        const pedidas = [];
        return {
            pedidas,
            lonLatToMeters: (...a) => real.lonLatToMeters(...a),
            angularMarkerRadius: (...a) => real.angularMarkerRadius(...a),
            elevacaoDeVizinha: (d) => real.elevacaoDeVizinha(d),
            elevationDeg: (r) => real.elevationDeg(r),
            projectOnHorizon: (bearing, yaw, pitch, fov, elev) => {
                pedidas.push(elev);
                return { visible: true, screenX: 600, screenY: 400 };
            },
        };
    }

    function projeta(floorLevel) {
        const p = projetorEspiao();
        const marcador = projectNearbyPhoto(
            { id: 'foto-1', lon: -51.2349, lat: -30.0651, floor_level: floorLevel },
            0, 0, 75, p, CAMERA
        );
        return { marcador, elevacaoPedida: p.pedidas.at(-1), p };
    }

    test('foto de outro andar sobe pelo degrau, e nao fica na altura do mesmo nivel', () => {
        const mesmo = projeta(5);
        const acima = projeta(6);
        const abaixo = projeta(4);

        const real = new StreetViewProjector(1200, 800);
        assert.ok(Math.abs(mesmo.elevacaoPedida - real.elevacaoDeVizinha(0)) < 1e-12);
        assert.ok(Math.abs(acima.elevacaoPedida - real.elevacaoDeVizinha(1)) < 1e-12);
        assert.ok(Math.abs(abaixo.elevacaoPedida - real.elevacaoDeVizinha(-1)) < 1e-12);

        // O que a ligacao quebrada produziria: as tres iguais. E o controle
        // negativo do teste, e nao uma repeticao das asercoes acima.
        assert.notEqual(acima.elevacaoPedida, mesmo.elevacaoPedida);
        assert.notEqual(abaixo.elevacaoPedida, mesmo.elevacaoPedida);
        assert.ok(acima.elevacaoPedida > mesmo.elevacaoPedida);
        assert.ok(abaixo.elevacaoPedida < mesmo.elevacaoPedida);
    });

    test('o marcador sai com descricao e com o degrau que a altura usou', () => {
        const { marcador } = projeta(6);
        assert.equal(marcador.floorDelta, 1);
        assert.equal(marcador.type, 'nearby');
        assert.ok(marcador.descricao, 'a bola saiu muda, sem descricao');
        assert.ok(marcador.descricao.distancia, 'a distancia nao foi descrita');
    });

    test('andar ausente nao inventa degrau, e a bola fica na faixa do mesmo nivel', () => {
        const semAndar = projeta(undefined);
        const real = new StreetViewProjector(1200, 800);
        assert.equal(semAndar.marcador.floorDelta, 0);
        assert.ok(Math.abs(semAndar.elevacaoPedida - real.elevacaoDeVizinha(0)) < 1e-12);
        assert.equal(semAndar.marcador.descricao.andar, null);
    });

    test('sem camera configurada, nao projeta nada em vez de projetar errado', () => {
        const p = projetorEspiao();
        const marcador = projectNearbyPhoto(
            { id: 'foto-1', lon: -51.2349, lat: -30.0651, floor_level: 6 },
            0, 0, 75, p, null
        );
        assert.equal(marcador, null);
        assert.equal(p.pedidas.length, 0);
    });
});
