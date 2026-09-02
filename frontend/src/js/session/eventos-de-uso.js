// Path: js/session/eventos-de-uso.js

/**
 * @fileoverview O VOCABULÁRIO DO USO DO PRODUTO: treze eventos, e nada mais.
 *
 * ZERO IMPORTS por contrato, como os vizinhos de decisão da telemetria (`origens-de-erro.js`,
 * `migalhas.js`, `sessao-id.js`): ele é lido pelas QUATRO páginas, três delas bootam sem a store,
 * e é lido também de dentro de ferramentas que só chegam por `import()`. Um import aqui é peso em
 * todos eles.
 *
 * ── O QUE ELE NÃO É ─────────────────────────────────────────────────────────────────────────
 *
 * NÃO É ANALYTICS DE PESSOA. Nada aqui identifica quem fez o quê: o lote carrega o id da ABA
 * (`sessao-id.js`, que não é identidade) e uma CONTAGEM por evento. Não há alvo, não há id de
 * feição, não há nome, não há coordenada. A prova é estrutural e barata: um evento só pode viajar
 * com a `prop` que {@link PROPS_PERMITIDAS} declara, e onde a lista é vazia NENHUM segundo campo
 * existe. Um dado de usuário só entraria aqui se alguém acrescentasse uma entrada nova a esta
 * tabela, que é o ponto em que a decisão fica visível.
 *
 * NÃO É INSTRUMENTAÇÃO DE DESEMPENHO. As Web Vitals viajam no mesmo lote (`session/vitais.js`) e
 * são um bloco à parte, com nomes próprios: elas não passam por esta tabela.
 *
 * ── AS TRÊS PROPRIEDADES QUE O ESPELHO COBRA ────────────────────────────────────────────────
 *
 *   1. **A ORDEM É CONTRATO.** `EVENTOS_DE_USO` é comparada posição a posição com o espelho do
 *      backend (`backend/src/modules/uso/eventos-de-uso.js`) por
 *      `frontend/tests/unit/eventos-de-uso-espelha-backend.test.js`. Evento novo entra NO FIM,
 *      nunca no meio, pelo mesmo motivo do vocabulário de origem de erro: os dois lados e o CHECK
 *      da coluna saem do mesmo commit.
 *   2. **UM EVENTO QUE O SERVIDOR NÃO CONHECE CUSTA O LOTE INTEIRO.** O Joi da rota recusa o corpo
 *      com 422, e o lote é UM corpo com N contagens: um evento inventado no cliente apaga a
 *      contagem de todos os outros daquele intervalo. Por isso o acumulador
 *      (`session/uso-lote.js`) DESCARTA antes de acumular, em vez de mandar e torcer.
 *   3. **`prop` É FECHADA POR EVENTO, E O ABERTO É UM SÓ.** A esmagadora maioria dos eventos não
 *      tem segundo campo (lista vazia). Três têm lista fechada. `ferramenta.ativada` é o único
 *      LIVRE (`null`), porque a lista de ferramentas do mapa cresce a cada `new-tool` e uma cópia
 *      dela aqui estaria errada na próxima ferramenta; o preço é a forma
 *      ({@link RE_PROP_LIVRE}), que aceita só o que se parece com um id de ferramenta.
 */

/**
 * Os treze eventos de uso, na ordem em que foram declarados.
 *
 * A ORDEM É DE LEITURA, e não de importância: a página, o atlas, as ferramentas do mapa, os quatro
 * visualizadores e modos pesados, as três saídas de arquivo, e por último a tela de
 * indisponibilidade, que é o único evento que fala de uma FALHA.
 * @type {ReadonlyArray<string>}
 */
export const EVENTOS_DE_USO = Object.freeze([
    'pagina.vista',
    'atlas.aberto',
    'ferramenta.ativada',
    'medicao.aberta',
    'visualizador3d.aberto',
    'visualizador360.aberto',
    'primeira-pessoa.aberto',
    'briefing.apresentado',
    'temporal.ativado',
    'pdf.exportado',
    'ebgeo.exportado',
    'ebgeo.importado',
    'indisponivel.visto',
]);

/**
 * Os mesmos treze pelo NOME que o código cita.
 *
 * O CÓDIGO NUNCA ESCREVE A STRING, e isso é cobrado por varredura
 * (`frontend/tests/unit/registro-de-uso-censo.test.js`): é a mesma regra de `EventTypes.XXX`, e
 * pelo mesmo motivo — um literal com erro de digitação não faz nada, não avisa nada, e a métrica
 * simplesmente não existe.
 * @type {Readonly<Object<string, string>>}
 */
export const EventoDeUso = Object.freeze({
    /** Uma carga de página. Uma por vida da página, em cada uma das quatro. */
    PAGINA_VISTA: 'pagina.vista',
    /** Um atlas foi aberto. `prop` diz de qual natureza. */
    ATLAS_ABERTO: 'atlas.aberto',
    /** Uma ferramenta de desenho ficou ativa. `prop` é o id dela. */
    FERRAMENTA_ATIVADA: 'ferramenta.ativada',
    /** Uma das três medições efêmeras foi acionada. */
    MEDICAO_ABERTA: 'medicao.aberta',
    /** O visualizador 3D (Cesium) abriu. */
    VISUALIZADOR3D_ABERTO: 'visualizador3d.aberto',
    /** O visualizador de foto 360 (Three.js) abriu. */
    VISUALIZADOR360_ABERTO: 'visualizador360.aberto',
    /** O visualizador de primeira pessoa (Gaussian splatting) abriu. */
    PRIMEIRA_PESSOA_ABERTO: 'primeira-pessoa.aberto',
    /** Uma apresentação de briefing começou. */
    BRIEFING_APRESENTADO: 'briefing.apresentado',
    /** A linha do tempo de um mapa foi LIGADA (nunca o desligamento, nunca o cursor). */
    TEMPORAL_ATIVADO: 'temporal.ativado',
    /** Um PDF saiu. `prop` diz por qual dos dois motores. */
    PDF_EXPORTADO: 'pdf.exportado',
    /** Um arquivo `.ebgeo` foi gerado. */
    EBGEO_EXPORTADO: 'ebgeo.exportado',
    /** Um arquivo `.ebgeo` foi carregado. */
    EBGEO_IMPORTADO: 'ebgeo.importado',
    /** A tela "EBGeo indisponível" foi ao ar. Ver o `fileoverview` de `session/uso-lote.js`. */
    INDISPONIVEL_VISTO: 'indisponivel.visto',
});

/**
 * A forma de uma `prop` LIVRE.
 *
 * Ela existe para UM evento (`ferramenta.ativada`) e é a mesma dos dois lados. Minúscula, dígito,
 * `_` e `-`, até 40 caracteres: casa todo `tipoDeUi` de `tool_manager/tool-registry.js` e recusa,
 * por construção, texto de gente (espaço, acento, maiúscula) e número decimal.
 */
export const RE_PROP_LIVRE = /^[a-z0-9_-]{1,40}$/;

/**
 * O que cada evento aceita como segundo campo.
 *
 * TRÊS ESTADOS, e eles não se confundem: um ARRAY VAZIO significa "este evento não tem `prop`
 * nenhuma" (mandar uma é descarte); um array com valores é lista FECHADA; `null` é o único caso
 * LIVRE, validado por {@link RE_PROP_LIVRE}.
 *
 * TODO EVENTO TEM ENTRADA, inclusive os que não têm `prop`. Sem isso, "evento sem entrada" e
 * "evento que não aceita prop" seriam o mesmo `undefined`, e a leitura ingênua (`?? []`) faria um
 * evento novo e não declarado passar calado pela porteira que existe para pegá-lo.
 * @type {Readonly<Object<string, ReadonlyArray<string>|null>>}
 */
export const PROPS_PERMITIDAS = Object.freeze({
    'pagina.vista': Object.freeze([]),
    // As três naturezas de abertura, e elas não são o `kind` do `ATLAS_SWITCHED` do barramento
    // (que tem duas): a visita por link público é um terceiro caso, e é justamente o que se quer
    // contar à parte, porque é o único acesso sem conta.
    'atlas.aberto': Object.freeze(['local', 'servidor', 'publico']),
    // LIVRE: a lista de ferramentas cresce a cada `new-tool`. Ver {@link RE_PROP_LIVRE}.
    'ferramenta.ativada': null,
    'medicao.aberta': Object.freeze([]),
    'visualizador3d.aberto': Object.freeze([]),
    'visualizador360.aberto': Object.freeze([]),
    'primeira-pessoa.aberto': Object.freeze([]),
    'briefing.apresentado': Object.freeze([]),
    'temporal.ativado': Object.freeze([]),
    // Os DOIS motores de PDF do mesmo painel: GDAL na folha única (saída georreferenciada) e
    // jsPDF no mosaico. Separá-los é a única razão de este evento ter `prop`.
    'pdf.exportado': Object.freeze(['folha', 'mosaico']),
    'ebgeo.exportado': Object.freeze([]),
    'ebgeo.importado': Object.freeze([]),
    'indisponivel.visto': Object.freeze([]),
});

/**
 * OS QUALIFICADORES DE LISTA FECHADA, pelo nome que o código cita.
 *
 * ELE É O IRMÃO DE {@link EventoDeUso} PARA O SEGUNDO ARGUMENTO, e existe pelo mesmo motivo: um
 * literal com erro de digitação (`'publicо'` com um cirílico no meio, `'mosaíco'`) é DESCARTADO
 * em silêncio pela porteira, e o desfecho é indistinguível do produto funcionando. O primeiro
 * argumento já era cobrado assim; o segundo passou a ser depois da revisão do lote.
 *
 * DERIVADO DE {@link PROPS_PERMITIDAS}, e não escrito à mão: duas listas dos mesmos cinco valores
 * divergem no primeiro qualificador novo, e a que ficaria errada é justamente a que o código cita.
 * O prefixo da chave é o evento, porque `local` e `folha` só significam alguma coisa dentro dele.
 *
 * `ferramenta.ativada` FICA DE FORA por construção: ela é a única LIVRE, o id vem do registro de
 * ferramentas em tempo de execução, e uma constante por ferramenta seria a cópia daquele registro.
 * @type {Readonly<Object<string, string>>}
 */
export const PropDeUso = Object.freeze({
    /** `atlas.aberto`: um slot local, deste navegador. */
    ATLAS_LOCAL: 'local',
    /** `atlas.aberto`: um atlas do servidor, com conta. */
    ATLAS_SERVIDOR: 'servidor',
    /** `atlas.aberto`: uma visita por link público, sem conta nenhuma. */
    ATLAS_PUBLICO: 'publico',
    /** `pdf.exportado`: folha única, georreferenciada por GDAL. */
    PDF_FOLHA: 'folha',
    /** `pdf.exportado`: mosaico R×C, por jsPDF, sem georreferência. */
    PDF_MOSAICO: 'mosaico',
});

/**
 * As quatro páginas, na ordem dos entries de `vite.config.js`.
 *
 * ELAS SÃO O EIXO DE CORTE DO RELATÓRIO, e por isso são vocabulário fechado como os eventos: o
 * lote carrega a página em que ele nasceu, e o servidor agrupa por ela. O nome é o do PRODUTO
 * (`mapa`, `atlas`, `admin`, `calibracao`), nunca o do arquivo, porque `index.html` não diz nada
 * a quem lê o relatório.
 * @type {ReadonlyArray<string>}
 */
export const PAGINAS = Object.freeze(['mapa', 'atlas', 'admin', 'calibracao']);

/**
 * Se `evento` é um dos treze.
 * @param {*} evento
 * @returns {boolean}
 */
export function eventoDeUsoValido(evento) {
    return typeof evento === 'string' && EVENTOS_DE_USO.includes(evento);
}

/**
 * Se `pagina` é uma das quatro.
 * @param {*} pagina
 * @returns {boolean}
 */
export function paginaDeUsoValida(pagina) {
    return typeof pagina === 'string' && PAGINAS.includes(pagina);
}

/**
 * Se `prop` pode viajar com `evento`.
 *
 * `Object.hasOwn` E NÃO `PROPS_PERMITIDAS[evento]`: a chave vem de quem chamou `registrarUso`, e
 * um objeto literal responderia por herança de protótipo a um evento chamado `toString`, que é a
 * mesma armadilha já paga em `PAGINAS` (do relato) e em `ARRIVAL_NOTICES`.
 *
 * AUSÊNCIA DE `prop` É SEMPRE VÁLIDA, inclusive no evento livre: contar quantas vezes uma
 * ferramenta foi ativada sem saber qual continua sendo uma contagem honesta, e recusá-la
 * transformaria um chamador desatento em métrica perdida.
 * @param {*} evento
 * @param {*} prop - `undefined` ou `null` significa "sem prop".
 * @returns {boolean}
 */
export function propDeUsoValida(evento, prop) {
    if (!eventoDeUsoValido(evento)) return false;
    if (prop === undefined || prop === null || prop === '') return true;
    if (typeof prop !== 'string') return false;
    const permitidas = Object.hasOwn(PROPS_PERMITIDAS, evento) ? PROPS_PERMITIDAS[evento] : [];
    if (permitidas === null) return RE_PROP_LIVRE.test(prop);
    return permitidas.includes(prop);
}
