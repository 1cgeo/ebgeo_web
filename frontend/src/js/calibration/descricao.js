// Path: js/calibration/descricao.js

/**
 * @fileoverview O que a tela diz de uma foto vizinha: onde ela fica e em que
 * andar.
 *
 * Modulo proprio, e nao um trecho dentro do painel, porque TRES telas descrevem
 * a mesma foto: o marcador verde no canvas, a lista de alvos e o rotulo do
 * preview. Descricao escrita em tres lugares vira tres descricoes diferentes do
 * mesmo objeto, e o operador nao tem como saber qual delas mentiu.
 *
 * Porte de `ebgeo_360` `public/calibration/js/descricao.js` (commit 229fe9d).
 * Funcao pura de proposito: e o unico pedaco desta tela que roda em node, e por
 * isso o unico que um teste prende.
 */

/**
 * A descricao de um alvo ou de uma foto proxima, vista de uma foto.
 *
 * A distancia sai em PLANTA, e sozinha. A 3D foi tentada e descartada: ela
 * depende de `ele`, e a cota nao acompanha o andar neste acervo (o 4o andar
 * inteiro em zero, a area externa ate 100 m, medido nas 350 fotos do
 * Beira-Rio). Somar um desnivel de ruido daria um numero preciso e falso na
 * tela. Quem separa os andares aqui e o ROTULO, nao a cota.
 *
 * Sao DUAS formas da mesma distancia. `distancia` e a da lista do painel, que
 * tem largura de sobra e ganha em precisao. `distanciaCurta` e a do marcador
 * sobre a fotografia, onde o texto disputa espaco com a imagem: ali o decimal
 * e a unidade nao decidem nada, porque quem le quer saber se sao 2 ou 20
 * passos, e nao se sao 7,8 ou 7,9.
 *
 * QUANTOS andares nao entra no texto, e sim na ALTURA em que o marcador e
 * desenhado (`projector.elevacaoDeVizinha`). Escrever "2 andares acima" ao lado
 * de cada bola encheria a tela de texto repetido, e o olho le altura antes de
 * ler frase.
 *
 * @param {Object} alvo - Alvo ou foto proxima, com `distance`, `floor_level` e
 *   `floor_label`
 * @param {Object} camera - A foto de onde se olha, com `floor_level`
 * @returns {{distancia: string|null, distanciaCurta: string|null, andar: string|null}}
 */
export function descreverAlvo(alvo, camera) {
    // `?? 0` NAO serviria: `NaN ?? 0` continua NaN, e a tela escreveria "NaNm".
    const plana = Number.isFinite(alvo?.distance) ? alvo.distance : null;

    const aqui = camera?.floor_level;
    const la = alvo?.floor_level;
    const outroAndar = typeof aqui === 'number' && typeof la === 'number' && aqui !== la;

    return {
        distancia: plana === null ? null : `${plana.toFixed(1)}m`,
        distanciaCurta: plana === null ? null : `${Math.round(plana)}`,
        // Mesmo andar nao ganha marca: ela so existe para avisar que o clique
        // atravessa o predio, e etiqueta em tudo nao avisa de nada.
        andar: outroAndar ? (alvo.floor_label || `nível ${la}`) : null,
    };
}
