// Path: js/tool_manager/helpers/pending-edit.helpers.js

/**
 * @fileoverview A EDIÇÃO PENDENTE DO PAINEL, reaplicada sobre a versão corrente da fonte.
 *
 * O "Salvar" de todo painel de atributos persiste a cópia que está NA FONTE do MapLibre, e não a
 * do painel (`saveFeatures`, dezoito controles, todos com o mesmo comentário: "it persists the
 * SOURCE's version of each feature rather than the selected one"). Isso é certo enquanto a fonte
 * for o lugar mais atual: ela recebe tanto a prévia do painel (`updateFeaturesProperty` faz
 * `dispatcher.patch`) quanto o arrasto de alça.
 *
 * O QUE QUEBRA A PREMISSA É A OP REMOTA. Qualquer `feature:created|modified|deleted` de um par
 * dispara `wireRemoteFeatureRender` (`layers/remote-feature-render.js`), que 80 ms depois
 * redesenha TODAS as fontes a partir da store, com `setData` cru. O cabeçalho daquele arquivo já
 * declara que o redesenho descarta o que o dispatcher tinha na fila, e o declara BENIGNO "because
 * the store is written before the source in every migrated path". A prévia do painel é justamente
 * o caminho onde isso NÃO vale: ela existe para ser vista antes de ser gravada. Então a cor que o
 * usuário acabou de escolher some da fonte, o "Salvar" grava de volta o valor que já estava na
 * store, `updateFeature` sai cedo por `isFeatureEqual` e NENHUMA operação nasce: a edição evapora
 * sem um erro em lugar nenhum.
 *
 * Medido em 2026-09-15, deterministicamente, uma vez em uma:
 * `tests/e2e-ui/edicao-pendente-sobrevive-a-op-remota.repro.spec.js`. Custava também uma
 * reprovação em quatro de `browser-collab-three-client-flow.spec.js` ("a edição de C virou
 * operação na fila" com a op nula), onde três painéis abertos garantem que alguém receba op
 * remota no meio do gesto.
 *
 * A REGRA AQUI É ESTREITA DE PROPÓSITO: reaplica-se só o que o USUÁRIO mudou nesta sessão de
 * painel, isto é, as chaves em que a cópia do painel DIVERGE do retrato tirado quando o painel
 * abriu (`createInitialPropertiesMap`). O resto fica como a fonte tem. Reaplicar o objeto do
 * painel inteiro seria a perda simétrica: o par que renomeou a feição enquanto eu escolhia a cor
 * veria o nome dele voltar atrás, e aí o conserto teria trocado uma perda de dado por outra.
 *
 * SEM RETRATO, NÃO SE REAPLICA NADA. `initialProperties` ausente significa que não há como saber
 * o que é do usuário e o que é do par, e adivinhar nesse caso é escolher em qual direção perder.
 * O comportamento então é exatamente o anterior a este arquivo.
 *
 * Folha pura, sem imports: roda em node e é testada lá
 * (`tests/unit/pending-edit-helpers.test.js`).
 */

/**
 * @private Comparação de valor que serve tanto ao escalar quanto ao objeto/array das props de
 * feição (`observations`, `baseCoordinates`, `symbol_instances`). `JSON.stringify` basta porque
 * as duas cópias descendem do MESMO objeto: o retrato é um `deepClone` das props, então a ordem
 * de chave é a mesma dos dois lados. `NaN` e `undefined` viram `null`/ausência nos dois lados
 * igualmente, então não produzem diferença falsa.
 */
function mesmoValor(a, b) {
    if (a === b) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * As chaves em que a cópia do painel diverge do retrato de abertura, isto é, o que o usuário
 * mexeu. Inclui a chave que o painel ACRESCENTOU e a que ele REMOVEU (esta com valor `undefined`,
 * para que quem aplica saiba apagá-la).
 *
 * @param {Object} selectedProperties - As props da cópia do painel, agora.
 * @param {Object} initialProperties - As props no instante em que o painel abriu.
 * @returns {Object} Mapa chave → valor novo. Vazio quando nada mudou.
 */
export function pendingPropertyEdits(selectedProperties, initialProperties) {
    const deltas = {};
    if (!selectedProperties || !initialProperties) return deltas;

    for (const chave of Object.keys(selectedProperties)) {
        if (!mesmoValor(selectedProperties[chave], initialProperties[chave])) {
            deltas[chave] = selectedProperties[chave];
        }
    }
    for (const chave of Object.keys(initialProperties)) {
        if (!(chave in selectedProperties)) deltas[chave] = undefined;
    }
    return deltas;
}

/**
 * A feição a PERSISTIR: a versão corrente da fonte com a edição pendente do painel por cima.
 *
 * Devolve `currentFeature` sem cópia nenhuma quando não há nada a reaplicar, que é o caso comum
 * (a fonte já carrega a prévia). Quando há, devolve um objeto NOVO, para não mutar a coleção que
 * o chamador acabou de ler da fonte.
 *
 * A GEOMETRIA ACOMPANHA `baseCoordinates`, e só ela. Todo controle de linha deriva a geometria
 * das coordenadas de base, então uma edição de coordenadas pelo painel que perdeu a prévia perdeu
 * a geometria junto. Fora desse caso a geometria da fonte é a boa: ela carrega o arrasto de alça,
 * que não passa pelo retrato de propriedades.
 *
 * @param {Object} currentFeature - A feição como está na fonte do MapLibre agora.
 * @param {Object} selectedFeature - A cópia que o painel edita.
 * @param {Object} [initialProperties] - Retrato das props na abertura do painel.
 * @returns {Object} A feição a passar para `updateFeature`.
 */
export function mergePendingEdits(currentFeature, selectedFeature, initialProperties) {
    if (!currentFeature || !selectedFeature || !initialProperties) return currentFeature;

    const deltas = pendingPropertyEdits(selectedFeature.properties, initialProperties);
    const chaves = Object.keys(deltas);
    if (chaves.length === 0) return currentFeature;

    const properties = { ...currentFeature.properties };
    for (const chave of chaves) {
        if (deltas[chave] === undefined) delete properties[chave];
        else properties[chave] = deltas[chave];
    }

    const geometry = (chaves.includes('baseCoordinates') && selectedFeature.geometry)
        ? selectedFeature.geometry
        : currentFeature.geometry;

    return { ...currentFeature, properties, geometry };
}

/**
 * A cópia MOSTRADA (seleção, editor de rota) reposta sobre a feição GUARDADA, para um gesto que
 * escreve a feição inteira e não tem edição de painel a reaplicar: o arrasto (`move_handler.js`) e
 * o arrasto da âncora da rota (`trajectory-edit-control.js`).
 *
 * A cópia da seleção é tirada quando a feição é selecionada, e a op do par não chega nela. Mover
 * a partir dela devolvia o nome que o colega trocou e o ponto-chave que ele removeu, com a base
 * já atualizada, então o servidor aceitava (2026-09-24,
 * `tests/e2e-ui/trajetoria-arrasto-copia-velha.repro.spec.js`).
 *
 * As PROPRIEDADES vêm da guardada. Da mostrada ficam a GEOMETRIA, que é de onde o gesto partiu (a
 * posição deslocada pela linha do tempo inclusive), e as chaves de RUNTIME (`_`, que
 * `cleanFeature` descarta ao gravar), porque `_temporalHome` decide se o arrasto reancora a rota.
 * Sem a guardada (o par a excluiu), devolve a mostrada, e a escrita não acha a feição.
 *
 * @param {Object} shown - A cópia de onde o gesto partiu.
 * @param {Object} [stored] - A feição como está guardada agora.
 * @returns {Object} Uma feição NOVA quando há guardada; senão, `shown`.
 */
export function rebaseOnStored(shown, stored) {
    if (!shown?.properties || !stored?.properties) return shown;
    const properties = { ...stored.properties };
    for (const chave of Object.keys(shown.properties)) {
        if (chave.startsWith('_')) properties[chave] = shown.properties[chave];
    }
    if (properties.source === undefined && shown.properties.source !== undefined) {
        properties.source = shown.properties.source;
    }
    return { ...shown, properties };
}
