// Path: js/import_export/kmz/kml-time.js

/**
 * @fileoverview A JANELA DE VALIDADE de uma feição, em KML. Puro, sem DOM e sem store.
 *
 * ================= O DEFEITO QUE ELE FECHA (achado I6) ========================
 *
 * A exportação KMZ não citava tempo em lugar nenhum, enquanto a IMPORTAÇÃO de KML já lia
 * `<TimeSpan>` e `<TimeStamp>` (`temporal/temporal-import.js`, mais o achatamento em
 * `import_export/import.control.js`). O produto sabia ler um tempo que ele mesmo nunca
 * escrevia: exportar e reimportar um mapa devolvia toda feição PERMANENTE, visível em
 * qualquer posição do cursor, sem uma linha dizendo que a janela tinha sido descartada.
 *
 * ================= POR QUE SÓ `<TimeSpan>`, E NUNCA `<TimeStamp>` =============
 *
 * O modelo do EBGeo é um INTERVALO com as duas pontas opcionais (`temporalInicio` sem
 * `temporalFim` é "daqui em diante"; `temporalFim` sem `temporalInicio` é "até então"), e
 * `<TimeSpan>` com `<begin>` e `<end>` opcionais é exatamente essa forma. `<TimeStamp>` é um
 * INSTANTE, que é outra coisa, e o caminho de volta prova a diferença: o `@tmcw/togeojson`
 * colapsa um `<TimeStamp>` numa única chave `timestamp`, que `extractTemporalProperties` lê
 * como INÍCIO (`INSTANT_KEYS`), de modo que qualquer feição exportada assim voltaria sem o
 * fim. Escrever a forma que o nosso próprio leitor não reconstrói é perder dado por
 * elegância. O leitor continua aceitando `<TimeStamp>` porque arquivos de terceiros o usam.
 *
 * Um intervalo de comprimento ZERO (início igual ao fim) sai como `<TimeSpan>` com as duas
 * pontas iguais, e isso é deliberado: é a única forma que volta idêntica.
 *
 * ================= A TRAJETÓRIA NÃO CABE AQUI =================================
 *
 * O ponto móvel (`trajetoria`) NÃO é emitido. KML só o representaria por `gx:Track`, que é
 * extensão do Google fora do núcleo 2.2 e que SUBSTITUI a geometria do Placemark: quem não
 * a implementa deixa de ver a feição inteira, em vez de apenas não animá-la. Trocar a
 * posição que todo leitor desenha pela animação que poucos desenham é perda maior que a que
 * se tenta evitar, então a trajetória vira NOTA DE DEGRADAÇÃO no balão
 * (`kmz-feature-mapper.js`) e a feição sai na posição de origem. O formato sem perda
 * continua sendo o `.ebgeo`.
 *
 * @module import_export/kmz/kml-time
 */

/**
 * Limite do `Date` do ECMAScript, em ms. Fora dele `toISOString` LANÇA, e uma exportação
 * inteira não pode morrer por causa de um campo de data digitado errado.
 */
const MAX_EPOCH_MS = 8.64e15;

/**
 * Converte um instante em epoch ms para o `dateTime` do KML (ISO 8601 em UTC).
 *
 * O `Z` do fim não é decoração: sem fuso a string é ambígua, e cada leitor a interpreta no
 * fuso dele, deslocando a feição no tempo por horas. O sufixo `.000` é removido quando os
 * milissegundos são zero, que é o caso de todo valor vindo dos campos de data do painel,
 * porque `Date.parse` devolve o mesmo número com ou sem ele e a string fica legível.
 *
 * @param {*} epochMs - Instante em milissegundos desde a época
 * @returns {string|null} `2026-09-21T12:00:00Z`, ou null quando não há instante utilizável
 */
export function toKmlDateTime(epochMs) {
    if (typeof epochMs !== 'number' || !Number.isFinite(epochMs)) return null;
    // Truncado, e não arredondado, para que a string emitida seja função determinística do
    // número: `new Date` já trunca por dentro, e deixar isso implícito esconde a diferença.
    const ms = Math.trunc(epochMs);
    if (Math.abs(ms) > MAX_EPOCH_MS) return null;

    return new Date(ms).toISOString().replace(/\.000Z$/, 'Z');
}

/**
 * Monta o elemento de tempo de um Placemark ou GroundOverlay a partir das propriedades da
 * feição.
 *
 * @param {Object} [properties] - Propriedades da feição
 * @returns {string} `<TimeSpan>...</TimeSpan>`, ou string vazia quando a feição é permanente
 */
export function buildTimePrimitive(properties) {
    const begin = toKmlDateTime(properties?.temporalInicio);
    const end = toKmlDateTime(properties?.temporalFim);

    if (!begin && !end) return '';

    const beginXml = begin ? `<begin>${begin}</begin>` : '';
    const endXml = end ? `<end>${end}</end>` : '';

    return `<TimeSpan>${beginXml}${endXml}</TimeSpan>`;
}

/**
 * A feição carrega um ponto móvel, isto é, uma trajetória que de fato desloca alguma coisa?
 *
 * DOIS keypoints é o mínimo, e é o mesmo piso que `temporal/temporal-render.service.js` usa
 * para decidir se interpola: um keypoint só não move nada, e acusar degradação ali seria
 * anunciar uma perda que não existe.
 *
 * @param {Object} [properties] - Propriedades da feição
 * @returns {boolean} True quando há trajetória com dois ou mais keypoints
 */
export function hasMovingTrajectory(properties) {
    return Array.isArray(properties?.trajetoria) && properties.trajetoria.length >= 2;
}
