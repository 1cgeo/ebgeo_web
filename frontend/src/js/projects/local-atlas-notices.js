// Path: js/projects/local-atlas-notices.js

/**
 * @module projects/local-atlas-notices
 * @description Turns a `LocalAtlasResult` into the ONE sentence the user hears. Pure: no DOM, no
 * toast, no storage read or write — the page calls it and hands the result to the toast service.
 * (The one import that reaches `@store` is `atlasContentsLines`, itself pure: it renders counts the
 * caller already has. It is imported rather than copied because the drop-a-`.ebgeo` dialog on the
 * map announces the SAME loss, and two renderings of one loss drift into two vocabularies.)
 *
 * WHY IT IS A MODULE AND NOT FOUR `if`s INSIDE THE HANDLERS. The refusals of the local-atlas API
 * (`store/local-atlas.api.js`) are its whole user-facing contract: hitting the ceiling of ten and
 * refusing to delete the last atlas are not errors, they are ANSWERS, and each already carries a
 * pt-BR sentence written next to the code that raises it. What the API cannot guarantee is that the
 * sentence reaches a human: a handler that checks `result.ok` and returns is a silent no-op, and a
 * silent no-op is indistinguishable from a broken button. `projects-page.js` boots on import and
 * lives in the DOM, so nothing in it can be exercised by a test; this can.
 *
 * THE INVARIANT IS "NEVER SILENT": every refusal produces an ERROR notice with a non-empty message,
 * whatever the result looks like — an unknown code, a result with no message, a result that is not
 * even an object. A generic sentence the user can act on beats a button that does nothing.
 *
 * SINCE 2026-08-24 IT ALSO CARRIES THE TWO SENTENCES SAID *BEFORE* THE API IS CALLED, and they are
 * here for the same reason as the ones above: they are the words, they are pure, and the two files
 * that would otherwise hold them (`projects-page.js` and `atlas-drive.js`) are respectively
 * boot-on-import and DOM. See {@link deleteAttempt} (the refusal that must arrive BEFORE the
 * destructive dialog, not after it) and {@link deleteConfirmMessage} (the dialog itself, which used
 * to talk about the server to a visitor who has no account).
 */

// Pelo ARQUIVO, como todo o resto desta pasta: `atlas-contents.js` só alcança `atlas-namespace.js`,
// que `atlas.html` já carrega, e a função usada aqui é pura.
import { atlasContentsLines } from '@store/atlas-contents.js';
// Pelo ARQUIVO, e ele NÃO TEM IMPORTS: é a definição única desta casa para "por que o pedido
// falhou", a mesma que `projects-page.js`, `index.js` e `admin-page.js` consomem. Escrever aqui um
// segundo `if (status === 401)` seria a quarta cópia da mesma regra.
import { classifyRequestFailure, requestStatus, RequestFailure } from '@utils/request-failure.js';

/** Severity of a notice, matching the three toast helpers of `@utils/toast_service.js`. */
export const NoticeKind = Object.freeze({
    SUCCESS: 'success',
    WARNING: 'warning',
    ERROR: 'error'
});

/**
 * Last-resort text for a refusal that carries none. It exists for a code added to `LocalAtlasError`
 * without a message, and for a result mangled on its way here: the point is that neither can turn
 * into silence.
 */
const RECUSA_GENERICA = 'Não foi possível concluir esta operação com o atlas local.';

/**
 * @typedef {Object} Notice
 * @property {'success'|'warning'|'error'} kind
 * @property {string} message - pt-BR, non-empty.
 */

/**
 * @param {*} value
 * @returns {string|null} A trimmed non-empty string, or null.
 */
function texto(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

/**
 * @param {Object} [result] - A `LocalAtlasResult`.
 * @returns {string|null} The affected atlas name, or null when there is none to quote.
 */
function nomeDoAtlas(result) {
    return texto(result?.atlas?.name);
}

/**
 * The notice for a refused operation. The API's own message wins, always: it is written next to the
 * rule that refused and knows what the user has to do about it.
 * @param {Object} [result] - A refused `LocalAtlasResult`.
 * @returns {Notice}
 */
export function refusalNotice(result) {
    return { kind: NoticeKind.ERROR, message: texto(result?.message) ?? RECUSA_GENERICA };
}

/**
 * @param {Object} [result] - Result of `createLocalAtlas`.
 * @returns {Notice}
 */
export function createNotice(result) {
    if (!result?.ok) return refusalNotice(result);
    const nome = nomeDoAtlas(result);
    return {
        kind: NoticeKind.SUCCESS,
        message: nome ? `Atlas "${nome}" criado.` : 'Atlas local criado.'
    };
}

/**
 * PARA QUAL ATLAS LOCAL IR depois de uma criação, ou `null` para ficar na lista.
 *
 * "+ Novo atlas local" passou a CRIAR E ABRIR em 2026-08-25: quem pede um atlas novo quer
 * trabalhar nele, e a lista com um cartão a mais cobrava um segundo clique que não decidia nada.
 *
 * O DESTINO SAI DA FIAÇÃO E VEM PARA CÁ, pela mesma razão de {@link sendToServerNotice}: ele é a
 * metade que pode mentir. `createLocalAtlas` RECUSA o décimo primeiro slot (o teto de dez), e a
 * recusa é um resultado legítimo, não uma exceção. Um "criar e abrir" escrito como duas linhas em
 * sequência navega POR CIMA dela: a pessoa não recebeu atlas nenhum, vai para o mapa, encontra o
 * atlas ANTERIOR, e a frase da recusa morre junto com a página que a desenhou.
 *
 * POR ISSO ELE FALHA FECHADO. Sem um id que seja string não vazia, a resposta é `null` e a página
 * fica onde está. Um sucesso sem id utilizável levaria a `setCurrentLocalAtlas(undefined)`, que
 * recusa com NOT_FOUND: a pessoa leria "Atlas criado." e, em seguida, "atlas não encontrado".
 *
 * Pura, como as vizinhas. `projects-page.js` boota no import e nada nele pode ser exercitado por
 * um teste; isto pode.
 *
 * @param {Object} [result] - O retorno de `createLocalAtlas`.
 * @returns {string|null} O id do atlas local a abrir, ou null.
 */
export function createdAtlasToOpen(result) {
    if (result?.ok !== true) return null;
    return texto(result?.atlas?.id);
}

/**
 * @param {Object} [result] - Result of `renameLocalAtlas`.
 * @returns {Notice}
 */
export function renameNotice(result) {
    if (!result?.ok) return refusalNotice(result);
    const nome = nomeDoAtlas(result);
    return {
        kind: NoticeKind.SUCCESS,
        message: nome ? `Atlas renomeado para "${nome}".` : 'Atlas local renomeado.'
    };
}

/**
 * The notice for a deletion, including the half-done case.
 *
 * `blockedDatabases` is a SUCCESS that must not sound like one: the slot left the registry, but
 * another tab was holding its databases open, so the files stayed on disk and that tab can still
 * write into them. Reporting it as a plain success is how a user ends up with data nothing can
 * reach (`atlas-namespace.js`, Decision 4).
 * @param {Object} [result] - Result of `deleteLocalAtlas`.
 * @returns {Notice}
 */
export function deleteNotice(result) {
    if (!result?.ok) return refusalNotice(result);
    const nome = nomeDoAtlas(result);
    if (result.blockedDatabases?.length > 0) {
        return {
            kind: NoticeKind.WARNING,
            message: `${nome ? `"${nome}"` : 'O atlas'} saiu da lista, mas outra aba ainda segurava `
                + 'os dados dele neste navegador. Feche as outras abas do EBGeo e recarregue esta '
                + 'página para concluir a exclusão.'
        };
    }
    return {
        kind: NoticeKind.SUCCESS,
        message: nome ? `Atlas "${nome}" excluído.` : 'Atlas local excluído.'
    };
}

/**
 * A recusa do ÚLTIMO atlas local, palavra por palavra a de `LocalAtlasError.LAST_ATLAS`.
 *
 * COPIADA, E NÃO IMPORTADA, de propósito: a mensagem mora num `const` privado de
 * `store/local-atlas.api.js`, que não a exporta, e importar aquele módulo aqui arrastaria o store
 * para dentro de um módulo folha que existe justamente para não ter imports. A duplicação é
 * declarada aqui e cobrada pelo teste, que compara as duas por leitura de arquivo.
 */
const ULTIMO_ATLAS =
    'Este é o seu único atlas local e não pode ser excluído. Crie outro antes de excluí-lo.';

/**
 * A RECUSA CHEGA ANTES DA PERGUNTA DESTRUTIVA, e essa é a correção inteira.
 *
 * O menu oferecia "Excluir" sem olhar o tamanho da lista, o diálogo encenava o texto vermelho de
 * irreversível, e só DEPOIS do "sim" a API devolvia `LAST_ATLAS`. Quem chega de primeira viagem tem
 * exatamente um atlas, então esse era o caminho comum: um susto encenado para uma recusa que já se
 * sabia.
 *
 * O ITEM CONTINUA SENDO DESENHADO, e isso não é descuido. "Ser o único" é ESTADO, reversível pela
 * própria pessoa (crie outro e ele deixa de sê-lo), e o contrato de afordância da casa manda o
 * comando de estado bloqueado ser desenhado e RECUSAR O CLIQUE nomeando o estado, porque o clique é
 * como o motivo chega. Só o bloqueio por POSTO some da tela.
 *
 * FALHA ABERTO em contagem que não é número: a autoridade continua sendo a API, que refaz a mesma
 * checagem e devolve a mesma frase. Um gate de tela que travasse por não saber contar tiraria da
 * pessoa uma operação legítima para proteger uma que a API já protege.
 *
 * @param {number} count - Quantos atlas locais a lista tem AGORA.
 * @returns {{allowed: boolean, notice: Notice|null}}
 */
export function deleteAttempt(count) {
    if (Number.isFinite(count) && count <= 1) {
        return { allowed: false, notice: { kind: NoticeKind.WARNING, message: ULTIMO_ATLAS } };
    }
    return { allowed: true, notice: null };
}

/**
 * O QUE O SLOT DE SUFIXO VAZIO É, dito antes de tudo o mais no diálogo que o apaga.
 *
 * MEDIDO EM 2026-09-07: excluir aquele cartão apagou 198 registros e os ONZE bancos sem sufixo,
 * que são 14 mapas, 807 feições e 149 imagens — o acervo inteiro de quem chegou de uma versão
 * anterior do produto. O botão faz o que promete; o que faltava era a frase saber QUAL cartão é
 * aquele. O slot adotado chama-se "Meu Atlas", que é também o nome de fábrica de um atlas em
 * branco, e a cópia dele chama-se "Meu Atlas (cópia)": a tela fica com dois cartões que começam
 * pelas mesmas duas palavras, e nada distinguindo o descartável do acervo.
 *
 * A RECOMENDAÇÃO É EXPORTAR, e não "não exclua". Excluir pode ser exatamente o que a pessoa quer
 * (ela já mandou o atlas ao servidor, por exemplo), e um diálogo que discute a decisão dela em vez
 * de informar vira um obstáculo que se aprende a atravessar sem ler. O que ela não tem como saber
 * sozinha é que este cartão é o acervo, e que existe um jeito de guardá-lo antes.
 *
 * SEM CRASE E SEM MARCAÇÃO: `ConfirmModal` desenha a mensagem como texto puro.
 */
const ACERVO_HERDADO =
    'ATENÇÃO: este é o acervo que veio da versão anterior do EBGeo, o único atlas que existia '
    + 'antes de o produto ter vários. Se quiser guardá-lo, abra o atlas e exporte um arquivo '
    + '.ebgeo ANTES de excluir.';

/**
 * O CORPO DO DIÁLOGO DE EXCLUSÃO, que muda com a existência de conta E com o que o atlas contém.
 *
 * A CONTA. A frase única falava de "trabalho ainda não enviado ao servidor", que é um fato real e
 * importante para quem tem sessão (a fila de saída de um atlas morre junto com os bancos dele) e é
 * a descrição de um caminho que o visitante anônimo NUNCA teve. Para ele a menção não assusta à
 * toa, faz pior: insinua que alguma coisa dali já foi ou seria enviada, contra o que a própria
 * seção promete logo acima ("Nada aqui vai para o servidor").
 *
 * O CONTEÚDO, desde 2026-09-07, e é a metade que faltava. Excluir um slot derruba os bancos dele,
 * e o slot de sufixo vazio é o que carrega o acervo de quem chegou de uma versão anterior do
 * produto: onze bancos com nome sem sufixo, o mesmo endereço que a linha `main` usa. A frase antiga
 * ("Os mapas, feições e imagens deste atlas serão apagados") era literalmente a MESMA para esse
 * atlas e para um em branco criado há um minuto, e o slot adotado se chama "Meu Atlas", que é
 * também o nome de fábrica. Nomear o atlas e contar o que ele tem é o que separa os dois cartões.
 *
 * O MODELO É "LIMPAR TUDO" da aba Mapas, que faz MENOS (esvazia sem derrubar banco) e já
 * perguntava melhor: nomeia o atlas, diz que NÃO pode ser desfeito e marca a perda item a item.
 *
 * O ATLAS VAZIO CONTINUA COM A FRASE CURTA, e a contagem DESCONHECIDA (`null`, quando a leitura do
 * escopo falhou) cai nela também. É a degradação certa: "não sei quanto tem" não autoriza afirmar
 * quanto tem, e a frase curta continua verdadeira em qualquer atlas.
 *
 * @param {Object} [options]
 * @param {string} [options.name] - Nome do atlas no registro. Ausente, a frase evita nomeá-lo em
 *   vez de escrever "undefined".
 * @param {boolean} [options.signedIn] - Se há sessão, para a cláusula da fila de saída.
 * @param {{maps?: number, features?: number, images?: number}|null} [options.contents] - O que o
 *   escopo do slot contém (`countAtlasContents`), ou `null` para desconhecido.
 * @param {boolean} [options.legacySlot] - Se este é o slot de sufixo VAZIO, o acervo herdado. Ver
 *   {@link ACERVO_HERDADO}.
 * @returns {string} pt-BR, nunca vazia.
 */
export function deleteConfirmMessage({
    name = null, signedIn = false, contents = null, legacySlot = false,
} = {}) {
    const linhas = atlasContentsLines(contents);
    // A IDENTIDADE VEM PRIMEIRO, e ela não depende da contagem: o que este cartão É decide se a
    // pessoa continua lendo, e vale igual num acervo de 807 feições e num que a leitura não
    // conseguiu contar.
    const herdado = legacySlot === true ? `${ACERVO_HERDADO}\n\n` : '';

    if (linhas.length === 0) {
        const base = 'Os mapas, feições e imagens deste atlas serão apagados deste navegador';
        return herdado + (signedIn
            ? `${base}, junto com qualquer trabalho ainda não enviado ao servidor. Não há como desfazer.`
            : `${base}. Não há como desfazer.`);
    }

    const alvo = texto(name) ? `do atlas "${texto(name)}"` : 'deste atlas';
    const fila = signedIn
        ? ' Vai junto qualquer trabalho ainda não enviado ao servidor.'
        : '';
    return herdado
        + `Isso apaga TODO o conteúdo ${alvo} deste navegador e NÃO pode ser desfeito:\n`
        + linhas.map((linha) => `- ${linha}`).join('\n')
        + `\n\nOs seus outros atlas não são afetados.${fila}`;
}

/**
 * The pt-BR name of every surface the server's pruner reports, so the sentence says what the user
 * lost instead of echoing a key.
 *
 * The keys are the server's (`backend/src/modules/atlas/atlas-resource-prune.js`), and the four
 * 3D collectors are kept apart on purpose: they are four different things in the product, and
 * folding them into "3D" would tell somebody who lost two camera positions that they lost
 * "markers". A key that is NOT in this table is printed verbatim — see {@link frasePoda}.
 */
const ROTULO_DE_PODA = Object.freeze({
    'cesium3d.cameraPositions': ['posição de câmera 3D', 'posições de câmera 3D'],
    'cesium3d.markers': ['marcador 3D', 'marcadores 3D'],
    'cesium3d.measurements': ['medição 3D', 'medições 3D'],
    'cesium3d.viewsheds': ['bacia de visada 3D', 'bacias de visada 3D'],
    'sv360.markers': ['marcador 360', 'marcadores 360'],
    'sv360.orientations': ['orientação 360', 'orientações 360'],
    'briefing.slide.modelId': ['slide com modelo 3D', 'slides com modelo 3D'],
    'briefing.slide.photoId': ['slide com foto 360', 'slides com foto 360'],
    'mapa.baseLayer': ['camada de base de mapa', 'camadas de base de mapa'],
    'mapa.catalogLayers': ['camada de catálogo', 'camadas de catálogo'],
    'settings.basemaps': ['camada de base do catálogo', 'camadas de base do catálogo'],
    'settings.available_data_layers': ['camada de dados do catálogo', 'camadas de dados do catálogo'],
    'settings.available_analysis_layers': ['camada de análise do catálogo', 'camadas de análise do catálogo'],
    'settings.available_3d_models': ['modelo 3D do catálogo', 'modelos 3D do catálogo'],
    'settings.available_360_views': ['projeto 360 do catálogo', 'projetos 360 do catálogo'],
    'settings.default_basemap': ['camada de base padrão', 'camadas de base padrão'],
});

/**
 * `n` mais o substantivo na forma que `n` pede.
 * @param {number} n
 * @param {string} singular
 * @param {string} [plural] - Sem ele, o singular mais `s`.
 * @returns {string}
 */
function contado(n, singular, plural = `${singular}s`) {
    return `${n} ${n === 1 ? singular : plural}`;
}

/**
 * Une uma lista em português: `a`, `a e b`, `a, b e c`.
 * @param {string[]} itens
 * @returns {string}
 */
function comEs(itens) {
    if (itens.length <= 1) return itens[0] ?? '';
    return `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`;
}

/**
 * Um inteiro positivo de um campo que pode chegar como qualquer coisa.
 * @param {*} value
 * @returns {number}
 */
function numero(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

/**
 * O QUE SUBIU, seção a seção, para dentro dos parênteses da frase.
 *
 * MAPAS E FEIÇÕES SÃO SEMPRE DITOS, e o resto só quando existe. É a regra de
 * `atlasContentsLines`, pelo mesmo motivo: "0 briefings" ocupa o mesmo espaço que "2 briefings" e
 * não ajuda ninguém a decidir nada. Os dois primeiros ficam mesmo em zero porque um envio de zero
 * feições É a informação.
 *
 * O `sent` DEGRADA PARA O `stats` ANTIGO quando não vem: um chamador que ainda não o preenche
 * continua produzindo uma frase verdadeira, em vez de anunciar "0 mapa(s)" sobre um atlas cheio.
 *
 * @param {Object} [result] - O retorno de `sendLocalAtlasToServer`.
 * @returns {string}
 */
function fraseDeContagem(result) {
    const sent = result?.sent ?? null;
    const partes = [
        contado(numero(sent?.maps ?? result?.stats?.maps), 'mapa'),
        contado(numero(sent?.features ?? result?.stats?.features), 'feição', 'feições'),
    ];
    const opcionais = [
        [numero(sent?.layers ?? result?.stats?.layers), 'camada', 'camadas'],
        [numero(sent?.groups ?? result?.stats?.groups), 'grupo', 'grupos'],
        [numero(sent?.briefings), 'briefing', 'briefings'],
        [numero(sent?.slides), 'slide', 'slides'],
        [numero(sent?.cesium3d), 'item 3D', 'itens 3D'],
        [numero(sent?.streetview360), 'item 360', 'itens 360'],
        [numero(sent?.images), 'imagem citada', 'imagens citadas'],
    ];
    for (const [n, singular, plural] of opcionais) {
        if (n > 0) partes.push(contado(n, singular, plural));
    }
    return partes.join(', ');
}

/**
 * O AVISO DE QUE SUBIU MENOS DO QUE O SLOT TEM, com os dois números de cada eixo.
 *
 * O ACHADO, medido no navegador em 2026-09-07: do acervo herdado subiam 2 mapas de 14 e 33
 * feições de 805, e a tela dizia isso em tom de SUCESSO, porque a frase só conhecia o numerador.
 * A causa daquele caso foi fechada no leitor; esta comparação fica como o guarda que faz a
 * próxima perda entre o disco e o payload ter uma frase em vez de um toast verde.
 *
 * SÓ MENOR CONTA. Enviado MAIOR não é perda: o payload sintetiza a camada padrão que o disco
 * nunca gravou, e um "aviso" ali seria ruído sobre um envio correto.
 *
 * @param {Object} [result]
 * @returns {string|null}
 */
function fraseDeFalta(result) {
    if (!result?.sent || !result?.local) return null;
    const eixos = [
        ['mapa', 'mapas', numero(result.sent.maps), numero(result.local.maps)],
        ['feição', 'feições', numero(result.sent.features), numero(result.local.features)],
    ].filter(([, , subiu, tem]) => subiu < tem);
    if (eixos.length === 0) return null;

    const clausulas = eixos.map(([singular, plural, subiu, tem]) =>
        `${contado(subiu, singular, plural)} de ${tem}`);
    return `Subiram só ${comEs(clausulas)}: parte deste atlas NÃO chegou ao servidor.`;
}

/**
 * O AVISO DE QUE O SERVIDOR GRAVOU MENOS DO QUE SUBIU.
 *
 * DUAS MEDIDAS DO MESMO NÚMERO, POR CAMINHOS INDEPENDENTES: a contagem do payload é do cliente, e
 * `summary.mapsImported`/`featuresImported` é o que o servidor diz ter gravado. Duas medidas do
 * mesmo parâmetro que discordam indicam DEFEITO, e a resposta é dizer, nunca escolher uma das
 * duas. Descartar a do servidor porque a do cliente já existe é literalmente o gesto que jogou
 * fora o `prunedResourceRefs` durante toda a fase.
 *
 * SÓ COMPARA O QUE VEIO. Campo ausente é "o servidor não disse", e não zero: um `summary` sem
 * contagem (uma versão anterior do backend, uma resposta truncada) não pode virar um aviso de que
 * nada foi gravado sobre um envio que deu certo. `remappedIds` NÃO entra aqui: recunhar um id já
 * ocupado é o servidor fazendo o certo, não uma perda.
 *
 * @param {Object} [result]
 * @returns {string|null}
 */
function fraseDoServidor(result) {
    const summary = result?.summary;
    const sent = result?.sent;
    if (!summary || typeof summary !== 'object' || !sent) return null;

    const eixos = [
        ['mapa', 'mapas', summary.mapsImported, numero(sent.maps)],
        ['feição', 'feições', summary.featuresImported, numero(sent.features)],
    ].filter(([, , gravou, subiu]) => Number.isFinite(Number(gravou)) && Number(gravou) < subiu);
    if (eixos.length === 0) return null;

    const clausulas = eixos.map(([singular, plural, gravou, subiu]) =>
        `${contado(Math.trunc(Number(gravou)), singular, plural)} dos ${subiu} que subiram`);
    return `O servidor gravou só ${comEs(clausulas)}.`;
}

/**
 * O AVISO DA PODA DO SERVIDOR (`summary.prunedResourceRefs`), com o motivo dela.
 *
 * O ACHADO: com o catálogo do servidor no estado de fábrica (0 tilesets, 0 projetos 360), os 10
 * itens 3D e os 6 itens 360 do atlas medido foram descartados no import, e a frase da tela saiu
 * IDÊNTICA à do caso em que eles entraram. O servidor sempre relatou; o cliente é que jogava a
 * resposta fora.
 *
 * FALHA ABERTO EM SUPERFÍCIE DESCONHECIDA: uma superfície que o servidor passe a relatar e que
 * esta tabela não conheça sai com a chave crua. Uma perda dita com nome feio continua sendo uma
 * perda dita; calá-la por falta de rótulo seria o defeito de volta.
 *
 * @param {Object} [prunedResourceRefs] - `{superfície: contagem}`.
 * @returns {string|null}
 */
function frasePoda(prunedResourceRefs) {
    if (!prunedResourceRefs || typeof prunedResourceRefs !== 'object') return null;
    const itens = Object.entries(prunedResourceRefs)
        .map(([superficie, bruto]) => [superficie, numero(bruto)])
        .filter(([, n]) => n > 0)
        .map(([superficie, n]) => {
            const rotulo = ROTULO_DE_PODA[superficie];
            return rotulo ? contado(n, rotulo[0], rotulo[1]) : `${n} ${superficie}`;
        });
    if (itens.length === 0) return null;

    return `O servidor descartou ${comEs(itens)}, porque o modelo 3D ou o projeto 360 a que `
        + 'eles apontam não está no catálogo deste servidor. Peça ao administrador para cadastrar '
        + 'esses recursos e envie de novo.';
}

/**
 * O QUE A TELA DIZ DEPOIS DE "ENVIAR AO SERVIDOR", e PARA ONDE ela vai em seguida.
 *
 * O DESTINO SAI DAQUI, e não da fiação, porque ele é a metade do achado que pode mentir. Terminado
 * o envio, o produto tem de apontar para o atlas NOVO do servidor: continuar no local deixaria a
 * pessoa editando uma cópia que ninguém mais vê, e cada edição a partir dali é trabalho que o envio
 * já não alcança. Um `openAtlasId` construído na fiação seria uma decisão sem teste, e o modo de
 * errar é barato: `./?atlas=undefined` é uma tela de erro, não um desfecho.
 *
 * POR ISSO ELE FALHA FECHADO. Sem um id de servidor que seja string não vazia, `openAtlasId` é
 * `null` e a página fica onde está, com a frase na tela. Um envio que subiu e não soube dizer para
 * onde ir é um estado ruim; mandar a pessoa para um endereço inventado é pior.
 *
 * SÃO DOIS MOTIVOS PARA `openAtlasId` SER NULO, e o segundo não é falha nenhuma: o ramo de AVISO
 * também fica. Navegar destrói a frase, porque o toast morre com a página que o desenhou, e essa
 * frase é a única que nomeia as imagens que ficaram para trás. Ver o comentário do ramo.
 *
 * O TOM VEM DO QUE FALTOU CHEGAR, e desde 2026-09-07 são TRÊS as coisas que podem faltar, não
 * uma. `skipped` e `failed` (imagem que o servidor recusa, upload que não completou) eram a única
 * que a frase enxergava. As outras duas foram medidas no navegador no mesmo dia: o servidor
 * DESCARTA item 3D e 360 cujo recurso não está no catálogo dele, e relata a poda num campo que o
 * cliente jogava fora; e a contagem que sobe pode ser menor que a do slot local, que foi como o
 * acervo herdado entregou 2 mapas de 14 e 33 feições de 805 com toast VERDE.
 *
 * A REGRA QUE ISSO PRODUZ: o ramo de SUCESSO é o ramo em que NADA se perdeu, e só ele navega.
 * Qualquer uma das três perdas vira AVISO, e o aviso fica na tela.
 *
 * OS AVISOS SE SOMAM NUMA FRASE SÓ, na ordem em que importam para a decisão de quem lê: primeiro
 * o que não chegou do atlas, depois o que o servidor recusou, depois as imagens. Três toasts
 * empilhados seriam três coisas para ler e uma para lembrar.
 *
 * Pura, como as vizinhas.
 *
 * @param {{atlasId?: *, name?: *, stats?: Object, imageStats?: Object, sent?: Object,
 *   local?: Object, summary?: Object}|null|undefined} result - O retorno de
 *   `sendLocalAtlasToServer`.
 * @returns {{kind: string, message: string, openAtlasId: string|null}}
 */
export function sendToServerNotice(result) {
    const atlasId = typeof result?.atlasId === 'string' && result.atlasId.trim().length > 0
        ? result.atlasId
        : null;
    const nome = String(result?.name ?? '').trim();
    const alvo = nome ? `"${nome}"` : 'O atlas';
    const perdidas = numero(result?.imageStats?.skipped) + numero(result?.imageStats?.failed);

    const base = `${alvo} foi enviado ao servidor (${fraseDeContagem(result)}).`;

    const avisos = [];
    const faltou = fraseDeFalta(result);
    if (faltou) avisos.push(faltou);
    const doServidor = fraseDoServidor(result);
    if (doServidor) avisos.push(doServidor);
    const podado = frasePoda(result?.summary?.prunedResourceRefs);
    if (podado) avisos.push(podado);
    if (perdidas > 0) {
        // O QUE SOBROU AQUI É DITO JUNTO, porque é o que muda a decisão de quem lê: o atlas do
        // servidor está incompleto, e o original continua neste navegador com as imagens.
        avisos.push(perdidas === 1
            ? '1 imagem não subiu ao servidor, e o atlas de lá está sem ela.'
            : `${perdidas} imagens não subiram ao servidor, e o atlas de lá está sem elas.`);
    }

    if (avisos.length === 0) return { kind: NoticeKind.SUCCESS, message: base, openAtlasId: atlasId };

    // O AVISO FICA, E POR ISSO A PÁGINA NÃO NAVEGA. Medido no navegador em 2026-08-25: a navegação
    // partia 543 ms depois do clique, e o toast morre com a página que o desenhou. Amostrando a
    // tela a cada 20 ms por 5 s, NENHUM toast chegou a aparecer. Medido de novo em 2026-09-07,
    // agora do lado do ramo de sucesso: 400 amostras a 20 ms, 0 leituras da frase no DOM.
    //
    // NO SUCESSO ISSO NÃO CUSTA NADA: o desfecho é o atlas novo na tela, que diz o mesmo que a
    // frase diria. AQUI CUSTA A FRASE INTEIRA, e ela é a única que nomeia o que ficou para trás.
    // Uma perda parcial anunciada a ninguém é perda silenciosa, que é o que o tom de aviso existe
    // para impedir.
    //
    // O preço está escrito: quem cai neste ramo fica na lista e abre o atlas com um clique a mais.
    return {
        kind: NoticeKind.WARNING,
        message: `${base} ${avisos.join(' ')} O atlas local continua aqui, inteiro, e o novo já `
            + 'está no servidor, na lista de cima.',
        openAtlasId: null,
    };
}

/**
 * POR QUE O PEDIDO FALHOU, numa cláusula que uma pessoa lê.
 *
 * A LINHA QUE SEPARA "ECOAR" DE "TRADUZIR" É O STATUS. Com status, o SERVIDOR falou, e o que ele
 * disse é informação que a pessoa (ou quem ela chamar) pode usar: o corpo do 500 da bancada dizia
 * `erro forjado pela bancada`, e escondê-lo cobraria uma ida ao console. Sem status nenhum, quem
 * "falou" foi o navegador, e o que ele diz é `Failed to fetch` — a frase que chegou crua à tela no
 * pior momento possível, que é o achado que esta função existe para fechar.
 *
 * @param {*} error
 * @returns {string} Uma cláusula pt-BR, sempre não vazia.
 */
function motivoDaFalha(error) {
    const classe = classifyRequestFailure(error);
    const status = requestStatus(error);
    const doServidor = texto(error?.message);

    if (classe === RequestFailure.NETWORK) {
        return 'não foi possível falar com o servidor. Confira a conexão e tente de novo.';
    }
    if (classe === RequestFailure.CREDENTIAL) {
        return 'a sua sessão não vale mais. Entre de novo e repita o envio.';
    }

    const cabeca = {
        [RequestFailure.MISSING]: 'o servidor não encontrou o endereço do envio',
        [RequestFailure.RATE_LIMITED]: 'o servidor pediu para esperar (pedidos demais em sequência)',
        [RequestFailure.SERVER]: 'o servidor falhou ao processar o envio',
    }[classe] ?? `o servidor respondeu com um erro inesperado (HTTP ${status})`;

    return doServidor ? `${cabeca}: ${doServidor}.` : `${cabeca}.`;
}

/**
 * O QUE A TELA DIZ QUANDO "ENVIAR AO SERVIDOR" FALHA, e a etapa é a frase inteira.
 *
 * O ACHADO, medido no navegador em 2026-09-07 cortando a rede na subida das imagens:
 * `POST /atlas/import` respondeu **201** (atlas com 14 mapas e 805 feições, ZERO imagens), o
 * pedido das imagens caiu, e a tela mostrou o literal **"Failed to fetch"**. A pessoa ficava com
 * um atlas mudo e incompleto na lista do servidor e nenhuma frase que o explicasse.
 *
 * AS DUAS ETAPAS PEDEM DECISÕES DIFERENTES, e é por isso que uma frase só não serve:
 *
 *   - `'import'`: NADA foi criado no servidor. `importAtlas` roda inteiro dentro de uma transação,
 *     medido contra um 500 forjado, então o gesto que resolve é tentar de novo;
 *   - `'images'`: o atlas EXISTE lá, sem parte das fotos, e vai aparecer na lista. Reenviar cria
 *     um SEGUNDO atlas, porque este caminho COPIA e não sincroniza, então a decisão é outra;
 *   - `'leitura'`: nada saiu deste navegador, e a mensagem do erro já é a frase certa, escrita ao
 *     lado da regra que recusou (atlas sem mapa, dois mapas no mesmo nome). Envolvê-la numa
 *     moldura de rede seria inventar uma causa.
 *
 * O SLOT LOCAL É DITO NOS TRÊS, porque é a primeira pergunta de quem acabou de mandar o próprio
 * acervo para algum lugar e leu um erro. Medido: 251 registros antes, 251 depois, em cinco envios
 * e três modos de falha.
 *
 * NUNCA SILENCIOSA, pela mesma regra do resto deste módulo: entrada que não é erro nenhum, erro
 * sem etapa e erro sem mensagem produzem frase mesmo assim.
 *
 * Pura, como as vizinhas.
 *
 * @param {*} error - O erro de `sendLocalAtlasToServer`, com `stage` e às vezes `atlasId`.
 * @param {{name?: string}} [options] - O nome que a pessoa deu ao atlas no diálogo.
 * @returns {Notice}
 */
export function sendFailureNotice(error, { name = null } = {}) {
    const nome = texto(name);
    const alvo = nome ? `"${nome}"` : 'o atlas';
    const stage = error?.stage;

    if (stage === 'leitura') {
        return { kind: NoticeKind.ERROR, message: texto(error?.message) ?? RECUSA_GENERICA };
    }

    const local = 'O atlas local continua neste navegador, inteiro.';
    if (stage === 'images') {
        return {
            kind: NoticeKind.ERROR,
            message: `O envio de ${alvo} parou no meio: o atlas JÁ FOI criado no servidor e `
                + 'aparece na lista de cima, mas parte das imagens não subiu, e lá elas vão '
                + `faltar. ${local} Abra o atlas do servidor para conferir, ou exclua-o e envie de `
                + `novo. Motivo: ${motivoDaFalha(error)}`,
        };
    }

    // O RAMO DE `'import'` É TAMBÉM O DO ERRO SEM ETAPA, e a escolha é a que preserva a verdade:
    // "nada foi criado" descreve tudo o que acontece ANTES da criação, e uma falha que este código
    // não previu está, por construção, fora do trecho carimbado. Dizer o contrário mandaria a
    // pessoa procurar na lista do servidor um atlas que não existe.
    return {
        kind: NoticeKind.ERROR,
        message: `Não foi possível enviar ${alvo} ao servidor, e NADA foi criado lá. `
            + `${local} Motivo: ${motivoDaFalha(error)}`,
    };
}
