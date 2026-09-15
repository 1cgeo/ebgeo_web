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

/**
 * ONDE O ITEM ESTÁ, e os três desfechos são três frases diferentes de propósito.
 *
 * O UUID na tela foi o defeito medido em 2026-09-15: com o resolvedor de nomes FRIO (logo depois
 * de um F5 num atlas de servidor ele fica vazio), a linha dizia "no mapa «6a54a5f6-8ffb-...»", que
 * não casa com nada que a pessoa veja no produto. O nome passou a ser lido do disco, e sobraram
 * dois desfechos sem nome, que NÃO podem virar a mesma frase: um mapa que o atlas montado
 * comprovadamente não tem (a leitura respondeu, e respondeu nada) e um mapa sobre o qual a leitura
 * não conseguiu afirmar coisa alguma. O primeiro é dito em palavras; o segundo continua mostrando
 * o id, porque um id feio é pior que um nome e melhor que uma afirmação que ninguém mediu.
 *
 * A frase do ausente NÃO vai entre aspas angulares: «mapa removido» se leria como o NOME do mapa.
 * @param {{id: string, nome: (string|null), ausente: boolean}|null|undefined} mapa - `linha.mapa`.
 * @returns {string} O trecho a colar depois do item, ou vazio quando a linha não cita mapa nenhum.
 */
export function localDoItem(mapa) {
    if (!mapa) return '';
    if (mapa.nome) return `, no mapa «${mapa.nome}»`;
    if (mapa.ausente === true) return ', num mapa removido';
    return `, no mapa «${mapa.id}»`;
}

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

/* =========================================================================
   AS AÇÕES
   ========================================================================= */

/**
 * O que a pessoa pode mandar fazer com uma tentativa.
 * @readonly
 * @enum {string}
 */
export const PendenciaAcao = Object.freeze({
    /** Remove a tentativa e os dependentes dela, e pede ao servidor o estado atual. */
    ACEITAR: 'aceitar',
    /** Cria uma operação NOVA, com a base atual, a partir do conteúdo local guardado. */
    REAPLICAR: 'reaplicar',
    /** Copia o envelope e o motivo, para guardar fora do EBGeo. */
    EXPORTAR: 'exportar',
    /** Esquece a tentativa. Para o que não tem para onde ser reenviado. */
    DESCARTAR: 'descartar',
});

const ACAO_LABEL = Object.freeze({
    [PendenciaAcao.ACEITAR]: 'Aceitar o servidor',
    [PendenciaAcao.REAPLICAR]: 'Reaplicar',
    [PendenciaAcao.EXPORTAR]: 'Exportar',
    [PendenciaAcao.DESCARTAR]: 'Descartar',
});

/** O que cada comando faz, no `title` do botão, porque o rótulo cabe em duas palavras. */
const ACAO_DETALHE = Object.freeze({
    [PendenciaAcao.ACEITAR]:
        'Descarta esta tentativa e o que estiver parado atrás dela, e pede ao servidor o estado '
        + 'atual do item.',
    [PendenciaAcao.REAPLICAR]:
        'Envia de novo o conteúdo que você tinha escrito, agora declarando como base a versão que '
        + 'o servidor informou.',
    [PendenciaAcao.EXPORTAR]:
        'Copia o conteúdo desta tentativa e o motivo da recusa, para guardar fora do EBGeo.',
    [PendenciaAcao.DESCARTAR]:
        'Esquece esta tentativa neste computador. O conteúdo dela não vai para o servidor.',
});

/**
 * Os estados REVERSÍVEIS que recusam o clique. Eles não escondem o comando: o comando é desenhado,
 * o clique é recusado e a frase nomeia o estado, porque o clique é como o motivo chega à pessoa
 * (`.claude/rules/architecture.md`, seção UI Architecture).
 * @readonly
 * @enum {string}
 */
export const PendenciaBloqueio = Object.freeze({
    OFFLINE: 'offline',
    MAPA_TRAVADO: 'mapa-travado',
});

const BLOQUEIO_FRASE = Object.freeze({
    [PendenciaBloqueio.OFFLINE]:
        'Sem conexão com o servidor agora. Aceitar o servidor precisa buscar o estado atual do '
        + 'item, e sem isso a tela ficaria mostrando algo que o servidor não tem.',
    [PendenciaBloqueio.MAPA_TRAVADO]:
        'Este mapa está travado. Destrave o mapa (ou peça ao dono do atlas) para reaplicar a sua '
        + 'alteração.',
});

/**
 * @param {string} acao - Valor de {@link PendenciaAcao}.
 * @returns {string} O rótulo do botão.
 */
export function acaoLabel(acao) {
    return ACAO_LABEL[acao] ?? String(acao ?? '');
}

/**
 * @param {string} acao - Valor de {@link PendenciaAcao}.
 * @returns {string} A frase de apoio do botão.
 */
export function acaoDetalhe(acao) {
    return ACAO_DETALHE[acao] ?? '';
}

/**
 * A frase que o clique recusado devolve, nomeando o ESTADO.
 * @param {string} bloqueio - Valor de {@link PendenciaBloqueio}.
 * @returns {string}
 */
export function bloqueioFrase(bloqueio) {
    return BLOQUEIO_FRASE[bloqueio]
        ?? 'Esta ação não pode ser feita agora, e esta tela não soube dizer por quê.';
}

/**
 * A pergunta de "Aceitar o servidor", que NOMEIA quantas tentativas somem.
 *
 * O número é obrigatório e não decorativo: aceitar o servidor sobre uma tentativa leva junto tudo
 * o que estava parado atrás dela, e uma pergunta que diga só "esta alteração" mente sobre o
 * tamanho do que a pessoa está aceitando perder.
 * @param {number} quantas - Total de tentativas que serão descartadas, esta inclusive.
 * @returns {{titulo: string, mensagem: string, confirmar: string}}
 */
export function confirmacaoDeAceitar(quantas) {
    const total = Number.isFinite(quantas) && quantas > 0 ? Math.trunc(quantas) : 1;
    const corpo = total === 1
        ? 'Esta tentativa será descartada e o EBGeo vai buscar do servidor o estado atual do item.'
        : `Esta tentativa e as outras ${total - 1} que estão paradas atrás dela serão descartadas, `
            + 'e o EBGeo vai buscar do servidor o estado atual dos itens.';
    return {
        titulo: 'Ficar com o que está no servidor?',
        mensagem: `${corpo} O conteúdo que você tinha escrito não será enviado. Exporte antes se `
            + 'quiser guardá-lo.',
        confirmar: total === 1 ? 'Descartar 1 alteração' : `Descartar ${total} alterações`,
    };
}

/**
 * A pergunta de "Descartar", para o que não tem para onde ser reenviado.
 * @param {number} quantas - Total de tentativas que somem.
 * @returns {{titulo: string, mensagem: string, confirmar: string}}
 */
export function confirmacaoDeDescartar(quantas) {
    const total = Number.isFinite(quantas) && quantas > 0 ? Math.trunc(quantas) : 1;
    return {
        titulo: 'Esquecer esta alteração?',
        mensagem: total === 1
            ? 'Ela sai deste computador e não vai para o servidor. Não há como recuperá-la depois. '
                + 'Exporte antes se quiser guardar o conteúdo.'
            : `Elas (${total}) saem deste computador e não vão para o servidor. Não há como `
                + 'recuperá-las depois. Exporte antes se quiser guardar o conteúdo.',
        confirmar: 'Descartar',
    };
}

/** O que o toast diz quando a exportação foi para a área de transferência. */
export const EXPORTACAO_COPIADA =
    'Conteúdo copiado para a área de transferência. Cole num arquivo para guardar.';

/** E quando não foi. */
export const EXPORTACAO_FALHOU =
    'Não foi possível copiar. O navegador recusou o acesso à área de transferência.';

/**
 * O que aconteceu depois de reaplicar, e a frase muda com a conexão porque o desfecho muda.
 * @param {boolean} online - Se havia conexão no momento.
 * @returns {string}
 */
export function reaplicacaoFeita(online) {
    return online === true
        ? 'Alteração reenviada com a versão que o servidor informou. Se ela for aceita, a tela é '
            + 'atualizada em seguida.'
        : 'Alteração recolocada na fila. Ela sai quando a conexão voltar, e até lá a tela continua '
            + 'mostrando o que veio do servidor.';
}

/** Quando a reaplicação não conseguiu ser enfileirada. */
export const REAPLICACAO_FALHOU =
    'Não foi possível recolocar esta alteração na fila. Nada foi mudado.';

/** Quando aceitar o servidor não conseguiu remover a tentativa. */
export const ACEITE_FALHOU =
    'Não foi possível descartar esta tentativa. Nada foi mudado, e ela continua na lista.';
