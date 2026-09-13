// Path: js/account/pendencias/pendencias-phrases.js

/**
 * @fileoverview O que o painel de pendências DIZ, como funções puras: sem DOM, sem store, sem
 * imports.
 *
 * ZERO IMPORTS por contrato, pela mesma razão de `denial-phrases.js` e de `sync-phrases.js`: o
 * montador de linhas é testável em node puro e não pode arrastar a store atrás de uma frase.
 *
 * O VOCABULÁRIO AQUI NÃO É O DA FILA, E A DIFERENÇA É DELIBERADA. `IssueClass`
 * (`@store/sync/issue-classes.js`) classifica o que a FILA DE SAÍDA guarda, e tem quatro valores;
 * esta tela mostra três fontes (a fila do atlas montado, a quarentena global preservada no logout
 * e a fila de bytes de figura), e as duas últimas não têm classe de fila nenhuma. Espelhar
 * `IssueClass` aqui obrigaria a inventar um quinto valor lá para dizer "upload recusado", que a
 * fila não conhece e nunca vai conhecer, porque não existe operação incremental de imagem.
 * A ponte entre os dois vocabulários é `classeDeProblema`, num lugar só.
 *
 * A ORIGEM VIAJA SEPARADA DA CLASSE porque as duas respondem perguntas diferentes: a classe diz o
 * que aconteceu (disputa, recusa, dependência), a origem diz onde a tentativa está guardada, e é a
 * origem que decide se ela sobrevive a sair da conta. Uma recusa preservada é uma recusa E é de
 * uma sessão anterior; achatar as duas numa etiqueta só perderia sempre uma das metades.
 *
 * UNIDADE DESCONHECIDA APARECE CRUA, e isso é a decisão que impede a tabela de mentir. O servidor
 * nomeia as unidades em disputa (`conflict.fields`), e uma unidade que este build não conhece
 * significa que o servidor é mais novo que esta tela. Traduzir só o que se conhece e ESCONDER o
 * resto faria a tela dizer "campos em disputa: nenhum" sobre um conflito real; mostrar o token cru
 * é feio e verdadeiro.
 */

/**
 * As classes de pendência que esta tela distingue.
 * @readonly
 * @enum {string}
 */
export const PendenciaClasse = Object.freeze({
    /** O servidor recusou porque a entidade mudou desde a base que a pessoa viu. */
    CONFLITO: 'conflito',
    /** O servidor recusou por política, integridade ou conteúdo: repetir não muda o desfecho. */
    RECUSA: 'recusa',
    /** Não foi recusada: está atrás de outra que está. Sai sozinha quando aquela sair. */
    DEPENDENCIA: 'dependencia',
    /** Intenção de um protocolo anterior, retida para revisão antes de qualquer reenvio. */
    REVISAO: 'revisao',
    /** Os bytes de uma figura estão registrados e o servidor ainda não os confirmou. */
    UPLOAD_PENDENTE: 'upload-pendente',
    /** O servidor recusou os bytes de uma figura por um motivo que nenhuma retentativa muda. */
    UPLOAD_RECUSADO: 'upload-recusado',
});

/**
 * Onde a tentativa está guardada, que é o que decide se ela sobrevive a sair da conta.
 * @readonly
 * @enum {string}
 */
export const PendenciaOrigem = Object.freeze({
    /** Fila de saída do atlas montado. Vai embora com o namespace, se o descarte for confirmado. */
    FILA: 'fila',
    /** Registro global preservado no logout. Sobrevive a sair da conta e a fechar o navegador. */
    QUARENTENA: 'quarentena',
    /** Fila de bytes de figura do atlas montado. */
    UPLOAD: 'upload',
});

/** Rótulo curto de cada classe, para o crachá da linha. */
const CLASSE_LABEL = Object.freeze({
    [PendenciaClasse.CONFLITO]: 'Conflito',
    [PendenciaClasse.RECUSA]: 'Recusa do servidor',
    [PendenciaClasse.DEPENDENCIA]: 'Dependência bloqueada',
    [PendenciaClasse.REVISAO]: 'Quarentena de protocolo',
    [PendenciaClasse.UPLOAD_PENDENTE]: 'Figura à espera de envio',
    [PendenciaClasse.UPLOAD_RECUSADO]: 'Figura recusada',
});

/** O que cada classe pede da pessoa, em uma frase. */
const CLASSE_EXPLICACAO = Object.freeze({
    [PendenciaClasse.CONFLITO]:
        'O mesmo conteúdo mudou no servidor depois da versão que você viu. Escolha entre ficar '
        + 'com o que está no servidor ou reaplicar a sua alteração por cima do que há lá agora.',
    [PendenciaClasse.RECUSA]:
        'O servidor não aceita esta alteração como ela está, e reenviar não muda o desfecho. '
        + 'Guarde uma cópia se ela importa e aceite o que está no servidor para desbloquear a fila.',
    [PendenciaClasse.DEPENDENCIA]:
        'Esta alteração não foi recusada: ela está parada atrás de outra que foi. Resolva a que '
        + 'está na frente e esta sai sozinha.',
    [PendenciaClasse.REVISAO]:
        'Esta alteração foi criada por uma versão anterior do EBGeo e não pode ser reenviada sem '
        + 'revisão. Exporte para guardar o conteúdo, ou descarte.',
    [PendenciaClasse.UPLOAD_PENDENTE]:
        'Os bytes desta figura ainda não chegaram ao servidor. Eles são retomados sozinhos quando '
        + 'a conexão volta.',
    [PendenciaClasse.UPLOAD_RECUSADO]:
        'O servidor recusou os bytes desta figura, e nenhuma retentativa muda isso. A figura '
        + 'continua neste computador e não está no servidor.',
});

/** Rótulo da origem. Só a quarentena ganha um, porque só ela muda o que a pessoa pode concluir. */
const ORIGEM_LABEL = Object.freeze({
    [PendenciaOrigem.QUARENTENA]: 'Guardada de uma sessão anterior',
});

/**
 * Tipo de entidade do sync (`EntityType`) → como a pessoa chama aquilo na tela.
 *
 * A tabela é DERIVADA de `@store/sync/operation-types.js` por leitura, não por import, porque este
 * arquivo tem zero imports: um tipo novo lá cai no ramo de fallback e aparece com o nome técnico,
 * que é feio e correto. O guarda é o teste do montador, que exige rótulo para todo tipo do enum.
 */
const TIPO_LABEL = Object.freeze({
    atlas: 'Atlas',
    map: 'Mapa',
    feature: 'Feição',
    layer: 'Camada',
    group: 'Grupo',
    group_feature: 'Feição em grupo',
    marker3d: 'Marcador 3D',
    measurement3d: 'Medição 3D',
    viewshed3d: 'Visibilidade 3D',
    cameraPosition3d: 'Câmera 3D',
    orientation360: 'Orientação 360',
    marker360: 'Marcador 360',
    mapPosition: 'Posição do mapa',
    baseLayer: 'Mapa base',
    mapNotes: 'Notas do mapa',
    gridStyle: 'Grade do mapa',
    mapTemporal: 'Linha do tempo do mapa',
    catalogLayer: 'Camada de catálogo',
    briefing: 'Briefing',
    slide: 'Slide',
    comment: 'Comentário',
    setting: 'Configuração do atlas',
    imagem: 'Figura',
});

/** Unidade de disputa (`DISPUTE_UNITS`, e o que o servidor devolve em `conflict.fields`). */
const UNIDADE_LABEL = Object.freeze({
    nome: 'Nome',
    posicao: 'Posição',
    mapaBase: 'Mapa base',
    notas: 'Notas',
    grade: 'Grade',
    temporal: 'Linha do tempo',
    travado: 'Travamento',
    visivel: 'Visibilidade',
    opacidade: 'Opacidade',
    ordem: 'Ordem',
    estilo: 'Estilo',
    pai: 'Grupo pai',
    descricao: 'Descrição',
    settings: 'Ajustes',
    ordemDosSlides: 'Ordem dos slides',
    titulo: 'Título',
    conteudo: 'Conteúdo',
    alvo: 'Alvo',
    camera: 'Câmera',
    defeito: 'Marca de defeito',
    resolvido: 'Resolução',
    texto: 'Texto',
    geometry: 'Geometria',
    documento: 'O item inteiro',
    '*': 'Todo o conteúdo',
});

/** O motivo que se mostra quando o resultado guardado não traz nenhum. */
export const MOTIVO_DESCONHECIDO = 'O servidor não disse por quê.';

/** A lista vazia HONESTA: nada guardado, e a leitura funcionou. */
export const ESTADO_VAZIO_TITULO = 'Nenhuma pendência';

/** @type {string} */
export const ESTADO_VAZIO_DETALHE =
    'Tudo o que você fez neste atlas já foi aceito pelo servidor, e não há figura à espera de '
    + 'envio nem alteração guardada de uma sessão anterior.';

/** A falha de leitura, que NUNCA se desenha como lista vazia. */
export const ESTADO_FALHA_TITULO = 'Não foi possível ler as pendências';

/** @type {string} */
export const ESTADO_FALHA_DETALHE =
    'Esta tela não conseguiu ler a fila deste computador, então não sabe dizer o que ficou para '
    + 'trás. Não tome esta tela como prova de que não há nada guardado.';

/**
 * @param {string} classe - Um valor de {@link PendenciaClasse}.
 * @returns {string} O rótulo curto, ou o próprio valor quando ele não é conhecido.
 */
export function classeLabel(classe) {
    return CLASSE_LABEL[classe] ?? String(classe ?? '');
}

/**
 * @param {string} classe - Um valor de {@link PendenciaClasse}.
 * @returns {string} A frase que diz o que fazer, ou vazio quando a classe não é conhecida.
 */
export function classeExplicacao(classe) {
    return CLASSE_EXPLICACAO[classe] ?? '';
}

/**
 * @param {string} origem - Um valor de {@link PendenciaOrigem}.
 * @returns {string|null} O rótulo, ou `null` quando a origem não muda nada para quem lê.
 */
export function origemLabel(origem) {
    return ORIGEM_LABEL[origem] ?? null;
}

/**
 * @param {string} entityType - Tipo de entidade do sync.
 * @returns {string} O nome na tela, ou o tipo cru quando este build não o conhece.
 */
export function tipoDeEntidadeLabel(entityType) {
    return TIPO_LABEL[entityType] ?? String(entityType ?? 'Item');
}

/**
 * @param {string} unidade - Nome da unidade em disputa, como o servidor a nomeia.
 * @returns {string} O nome na tela, ou o token cru (ver o `fileoverview`).
 */
export function unidadeLabel(unidade) {
    return UNIDADE_LABEL[unidade] ?? String(unidade ?? '');
}

/**
 * A data de uma tentativa, em pt-BR, ou `null` quando não há data confiável.
 *
 * `null` e não "data desconhecida": a linha inteira omite o campo, porque uma etiqueta de campo
 * vazio ocupa a mesma largura de uma data e não informa nada.
 * @param {number|null|undefined} ms - Epoch em ms.
 * @returns {string|null}
 */
export function dataLabel(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return null;
    const data = new Date(ms);
    if (Number.isNaN(data.getTime())) return null;
    const dois = (n) => String(n).padStart(2, '0');
    return `${dois(data.getDate())}/${dois(data.getMonth() + 1)}/${data.getFullYear()}`
        + ` ${dois(data.getHours())}:${dois(data.getMinutes())}`;
}

/**
 * O cabeçalho de contagem, montado a partir do que de fato existe.
 *
 * Ele NÃO lista as classes com zero: um painel que sempre mostra seis contadores, cinco deles em
 * zero, ensina a não ler nenhum.
 * @param {Object<string, number>} contadores - Classe → quantidade.
 * @returns {Array<{classe: string, label: string, quantidade: number}>}
 */
export function contadoresVisiveis(contadores) {
    return Object.values(PendenciaClasse)
        .filter((classe) => (contadores?.[classe] ?? 0) > 0)
        .map((classe) => ({
            classe,
            label: classeLabel(classe),
            quantidade: contadores[classe],
        }));
}

/**
 * @param {number} total - Quantas pendências a lista tem.
 * @returns {string} O título do painel, com a contagem.
 */
export function tituloDoPainel(total) {
    if (!Number.isFinite(total) || total <= 0) return 'Pendências';
    return total === 1 ? 'Pendências (1)' : `Pendências (${total})`;
}
