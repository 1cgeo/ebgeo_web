// Path: js/account/pendencias/comparacao-de-conflito.js

/**
 * @fileoverview O QUE DIFERE entre a feição que a pessoa escreveu e a que o servidor guarda, como
 * aritmética pura. Sem DOM, sem store, sem frase.
 *
 * POR QUE ISTO EXISTE. A linha de conflito de feição nomeia a unidade em disputa e mostra o motivo
 * do servidor, e isso responde "por que perdi" sem responder "o que muda se eu insistir". As duas
 * metades do par existem no cliente desde que o recibo de conflito passou a carregar `serverData`
 * (a linha VIVA, lida pelo servidor: `backend/src/modules/sync/feature-conflicts.js` para a feição,
 * `entity-canonical.js` para o resto), e o envelope guardado carrega a metade local. O que faltava
 * era dizer a diferença em palavras que uma pessoa lê sem abrir o mapa.
 *
 * TEXTO, NUNCA DESENHO, e a decisão é de escopo e não de esforço. Desenhar as duas geometrias
 * exigiria um canvas, uma projeção e uma escala dentro de um modal que hoje é uma lista de texto,
 * e um desenho de duas linhas quase iguais em 300 pixels não distingue o que este resumo distingue
 * em uma frase: tipo, número de vértices e quantos metros o centro andou.
 *
 * ZERO IMPORTS por contrato, como os outros folhas desta pasta: ele é lido pelo montador de linhas
 * (que é puro e testável em node) e não pode arrastar a store atrás de uma conta de distância.
 *
 * O QUE ELE NÃO É: um diff geométrico. Ele não diz QUAIS vértices mudaram nem em que ordem, e não
 * tenta casar vértice com vértice: duas geometrias com o mesmo número de pontos e o mesmo centro
 * podem ser diferentes, e neste resumo aparecem como "mesma geometria". Isso é honesto porque a
 * frase que ele produz é sobre o que MUDOU DE FORMA VISÍVEL, e é declarado aqui para que ninguém
 * leia "mesma geometria" como "idênticas". A comparação exata é o `deepEqual` que o contrato de
 * mutação já faz quando calcula o patch.
 */

/** Raio médio da Terra em metros, o mesmo valor que o resto da casa usa em cálculo esférico. */
const RAIO_DA_TERRA_M = 6371000;

/**
 * Campos que descrevem a CÓPIA de uma feição e não o conteúdo dela, e que por isso nunca contam
 * como diferença de propriedade. `confirmedVersion` é a declaração de base, `version` conta as
 * escritas locais deste cliente, e o resto é contabilidade que o próprio servidor carimba.
 */
const CONTABILIDADE = new Set([
    'id', 'source', 'layerId', 'confirmedVersion', 'version', 'createdAt', 'updatedAt',
    'sync', 'dirty', 'deleted', 'deletedAt', 'ownerId',
]);

/** @param {*} valor @returns {boolean} */
function ehObjeto(valor) {
    return Boolean(valor) && typeof valor === 'object';
}

/**
 * Percorre uma geometria GeoJSON e entrega cada par [lng, lat].
 *
 * ELA ACEITA QUALQUER PROFUNDIDADE DE ANINHAMENTO de propósito, em vez de um `switch` por `type`:
 * Point, LineString, Polygon, MultiPolygon e GeometryCollection diferem só em quantas camadas de
 * array envolvem o mesmo par de números, e um `switch` seria uma segunda lista de tipos para
 * envelhecer ao lado do registro de tipos de feição.
 * @param {*} coordinates - O campo `coordinates` de uma geometria.
 * @param {function(number, number): void} visitar - Recebe (lng, lat).
 */
function percorrerCoordenadas(coordinates, visitar) {
    if (!Array.isArray(coordinates)) return;
    if (typeof coordinates[0] === 'number' && typeof coordinates[1] === 'number') {
        visitar(coordinates[0], coordinates[1]);
        return;
    }
    for (const parte of coordinates) percorrerCoordenadas(parte, visitar);
}

/**
 * Quantos vértices uma geometria tem, e onde fica o centro deles.
 *
 * O CENTRO É A MÉDIA DOS VÉRTICES, e não o centroide de área. Média é o que responde "o item andou
 * quanto" para toda geometria, ponto incluído (um ponto tem um vértice e o centro é ele mesmo),
 * enquanto centroide de área é indefinido para ponto e linha. A pergunta desta tela é deslocamento,
 * não superfície.
 * @param {*} geometry - Geometria GeoJSON.
 * @returns {{vertices: number, lng: number, lat: number}|null} null quando não há vértice nenhum.
 */
export function resumoDaGeometria(geometry) {
    if (!ehObjeto(geometry)) return null;
    let n = 0;
    let somaLng = 0;
    let somaLat = 0;
    const somar = (lng, lat) => {
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
        n += 1;
        somaLng += lng;
        somaLat += lat;
    };
    percorrerCoordenadas(geometry.coordinates, somar);
    for (const filha of Array.isArray(geometry.geometries) ? geometry.geometries : []) {
        const resumo = resumoDaGeometria(filha);
        if (!resumo) continue;
        n += resumo.vertices;
        somaLng += resumo.lng * resumo.vertices;
        somaLat += resumo.lat * resumo.vertices;
    }
    if (n === 0) return null;
    return { vertices: n, lng: somaLng / n, lat: somaLat / n };
}

/**
 * Distância em metros entre dois pontos geográficos, pela lei dos cossenos esférica.
 *
 * A APROXIMAÇÃO É DECLARADA: esta tela arredonda para metro e a maior distância que ela precisa
 * descrever é a de um item que alguém arrastou, então o erro do modelo esférico (uns 0,3% contra o
 * elipsoide) fica muito abaixo da resolução do que é mostrado. Não reuse isto para medição.
 * @param {{lng: number, lat: number}} a
 * @param {{lng: number, lat: number}} b
 * @returns {number|null} Metros, ou null quando alguma coordenada não é finita.
 */
export function distanciaEmMetros(a, b) {
    const valores = [a?.lng, a?.lat, b?.lng, b?.lat];
    if (!valores.every((v) => Number.isFinite(v))) return null;
    const rad = Math.PI / 180;
    const lat1 = a.lat * rad;
    const lat2 = b.lat * rad;
    const cos = Math.sin(lat1) * Math.sin(lat2)
        + Math.cos(lat1) * Math.cos(lat2) * Math.cos((b.lng - a.lng) * rad);
    // O `clamp` não é zelo: erro de ponto flutuante põe o cosseno em 1.0000000000000002 para dois
    // pontos idênticos, e `Math.acos` disso é NaN, que apareceria na tela como distância ausente
    // justamente no caso mais comum, o de nada ter mudado.
    return Math.acos(Math.min(1, Math.max(-1, cos))) * RAIO_DA_TERRA_M;
}

/**
 * Os nomes das propriedades que diferem entre as duas cópias, em ordem alfabética.
 *
 * A COMPARAÇÃO É POR VALOR SERIALIZADO, e é suficiente aqui porque ela responde uma pergunta
 * binária ("este campo difere?") sobre dados que já viajaram como JSON dos dois lados: o que sai do
 * `JSON.stringify` de um payload que veio da rede e de um payload guardado no IndexedDB tem a mesma
 * forma. Uma diferença só de ORDEM de chaves dentro de um objeto aninhado seria reportada como
 * diferença, e esse é o erro que ela pode cometer: para o lado de mostrar campo a mais, nunca a
 * menos.
 * @param {Object|null|undefined} locais - `properties` da cópia local.
 * @param {Object|null|undefined} remotas - `properties` da cópia do servidor.
 * @returns {string[]}
 */
export function propriedadesQueDiferem(locais, remotas) {
    const a = ehObjeto(locais) ? locais : {};
    const b = ehObjeto(remotas) ? remotas : {};
    const chaves = new Set([...Object.keys(a), ...Object.keys(b)]);
    const diferentes = [];
    for (const chave of chaves) {
        if (CONTABILIDADE.has(chave)) continue;
        let iguais;
        try {
            iguais = JSON.stringify(a[chave]) === JSON.stringify(b[chave]);
        } catch {
            // Referência cíclica: nada que este resumo produza vale arriscar um throw dentro do
            // desenho de uma lista, e "difere" é a resposta que não esconde nada.
            iguais = false;
        }
        if (!iguais) diferentes.push(chave);
    }
    return diferentes.sort();
}

/**
 * O modelo da comparação entre a cópia local e a do servidor.
 *
 * DEVOLVE `null` QUANDO NÃO HÁ PAR A COMPARAR, e essa é a metade que o painel precisa: sem
 * `serverData` (alvo sem serializador canônico, servidor mais antigo que esta tela, soma que
 * falhou) não existe o outro lado, e inventar um seria mostrar a cópia local duas vezes com cara de
 * comparação.
 *
 * @param {Object|null|undefined} local - A feição como o autor a escreveu (GeoJSON).
 * @param {Object|null|undefined} servidor - A feição como o servidor a guarda (GeoJSON).
 * @returns {{
 *   geometria: {igual: boolean, tipoLocal: string|null, tipoServidor: string|null,
 *     verticesLocal: number|null, verticesServidor: number|null, deslocamentoM: number|null},
 *   propriedades: string[]
 * }|null}
 */
export function compararFeicao(local, servidor) {
    if (!ehObjeto(local) || !ehObjeto(servidor)) return null;

    const aqui = resumoDaGeometria(local.geometry);
    const la = resumoDaGeometria(servidor.geometry);
    const tipoLocal = typeof local.geometry?.type === 'string' ? local.geometry.type : null;
    const tipoServidor = typeof servidor.geometry?.type === 'string' ? servidor.geometry.type : null;
    const deslocamento = aqui && la ? distanciaEmMetros(aqui, la) : null;

    return {
        geometria: {
            // "IGUAL" AQUI SIGNIFICA "sem diferença visível", e o cabeçalho diz por quê: mesmo
            // tipo, mesmo número de vértices e centros a menos de meio metro. Não é identidade.
            igual: tipoLocal === tipoServidor
                && aqui?.vertices === la?.vertices
                && deslocamento !== null && deslocamento < 0.5,
            tipoLocal,
            tipoServidor,
            verticesLocal: aqui?.vertices ?? null,
            verticesServidor: la?.vertices ?? null,
            deslocamentoM: deslocamento,
        },
        propriedades: propriedadesQueDiferem(local.properties, servidor.properties),
    };
}
