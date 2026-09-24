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
    /**
     * Não foi recusada por ela mesma: saiu na mesma parte de uma ação que outra, e o servidor
     * aplica ou recusa a parte inteira. A culpada vem nomeada no recibo (`batchFailedOperationId`).
     */
    JUNTO: 'recusada-junto',
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
    [PendenciaClasse.JUNTO]: 'Recusada junto',
    [PendenciaClasse.DEPENDENCIA]: 'Aguardando outra',
    [PendenciaClasse.REVISAO]: 'De versão anterior',
    [PendenciaClasse.UPLOAD_PENDENTE]: 'Figura à espera de envio',
    [PendenciaClasse.UPLOAD_RECUSADO]: 'Figura recusada',
});

/** O que cada classe pede da pessoa, em uma frase. */
const CLASSE_EXPLICACAO = Object.freeze({
    [PendenciaClasse.CONFLITO]:
        'O mesmo conteúdo mudou no servidor depois da versão que você viu. Escolha entre ficar '
        + 'com o que está no servidor ou reaplicar a sua alteração por cima do que há lá agora.',
    [PendenciaClasse.RECUSA]:
        'O servidor não aceita esta alteração como ela está, e reenviar não muda isso. Exporte '
        + 'uma cópia se ela importa e aceite o que está no servidor para liberar as próximas.',
    [PendenciaClasse.JUNTO]:
        'O servidor não recusou esta alteração por ela mesma: ela saiu junto com outra que ele '
        + 'não aceitou. O que você decidir sobre aquela vale também para esta.',
    [PendenciaClasse.DEPENDENCIA]:
        'Esta alteração não foi recusada: ela está parada atrás de outra que foi. Resolva a que '
        + 'está na frente e esta sai sozinha.',
    [PendenciaClasse.REVISAO]:
        'Esta alteração foi criada por uma versão anterior do EBGeo e não pode ser reenviada sem '
        + 'revisão. Exporte para guardar o conteúdo, ou descarte.',
    [PendenciaClasse.UPLOAD_PENDENTE]:
        'Esta figura ainda não chegou ao servidor. O envio é retomado sozinho quando a conexão '
        + 'voltar.',
    [PendenciaClasse.UPLOAD_RECUSADO]:
        'O servidor recusou esta figura, e tentar de novo não muda isso. Ela continua só neste '
        + 'computador.',
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
    travado: 'Bloqueio',
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

/**
 * O item de uma linha como a pessoa o reconhece: "Feição «P12», no mapa «Principal»", com o id no
 * lugar do nome que não resolveu. Mora aqui, e não no painel, porque as frases de "recusada junto"
 * e de "parada atrás" nomeiam OUTRA linha, e as duas descrições não podem divergir.
 * @param {{tipoLabel: string, nome: (string|null), id: (string|null)}} entidade - `linha.entidade`.
 * @param {Object|null} mapa - `linha.mapa`.
 * @returns {string}
 */
export function descricaoDoItem(entidade, mapa) {
    const nome = entidade?.nome ?? entidade?.id;
    const alvo = nome ? `${entidade.tipoLabel} «${nome}»` : (entidade?.tipoLabel ?? 'Item');
    return `${alvo}${localDoItem(mapa)}`;
}

/**
 * O MOTIVO DE UMA IRMÃ, que não é o motivo da culpada.
 *
 * O servidor aplica ou recusa uma parte inteira, e devolve TODAS as operações dela com o motivo
 * da que falhou. Mostrado em cada irmã, ele dizia "O item foi excluido no servidor." sobre 199
 * feições que ninguém excluiu (medido em 2026-09-24). A irmã diz o que de fato aconteceu com ela e
 * nomeia a culpada, cujo motivo continua na linha dela.
 * @param {string|null} culpada - `descricaoDoItem` da culpada, ou `null` quando ela não está na lista.
 * @returns {string}
 */
export function recusadaJuntoFrase(culpada) {
    return culpada
        ? `Recusada junto com outra alteração desta ação: ${culpada}.`
        : 'Recusada junto com outra alteração desta ação, que o servidor não aceitou.';
}

/**
 * O que a linha da CULPADA acrescenta: quantas voltaram por causa dela.
 * @param {number} quantas - Irmãs da culpada nesta lista.
 * @returns {string|null}
 */
export function levouJuntoFrase(quantas) {
    if (!Number.isFinite(quantas) || quantas <= 0) return null;
    return quantas === 1
        ? 'Por causa dela, outra alteração voltou recusada.'
        : `Por causa dela, outras ${Math.trunc(quantas)} alterações voltaram recusadas.`;
}

/**
 * A linha de uma dependência: atrás de QUEM ela está, pelo nome, e o id só quando o nome falta.
 * @param {string|null} descricao - `descricaoDoItem` da linha da frente.
 * @param {string|null} id - O id da operação da frente.
 * @returns {string|null}
 */
export function paradaAtrasFrase(descricao, id) {
    if (descricao) return `Parada atrás de ${descricao}.`;
    return id ? `Parada atrás da alteração ${id}.` : null;
}

/**
 * O RESUMO dos grupos recusados: quantas voltaram por causa de quantas, e o que fazer.
 * @param {{recusadas: number, culpadas: number, paradas: number}|null|undefined} juntos - `modelo.juntos`.
 * @returns {string|null} `null` quando nenhuma voltou junto com outra.
 */
export function juntoResumo(juntos) {
    const recusadas = Number.isFinite(juntos?.recusadas) ? Math.trunc(juntos.recusadas) : 0;
    const culpadas = Number.isFinite(juntos?.culpadas) ? Math.trunc(juntos.culpadas) : 0;
    const paradas = Number.isFinite(juntos?.paradas) ? Math.trunc(juntos.paradas) : 0;
    if (recusadas <= 0 || culpadas <= 0) return null;
    const quantas = recusadas === 1
        ? '1 alteração foi recusada só por ir'
        : `${recusadas} alterações foram recusadas só por irem`;
    const atras = paradas > 0
        ? `, e ${paradas} ${paradas === 1 ? 'está parada' : 'estão paradas'} atrás delas`
        : '';
    const decida = culpadas === 1
        ? 'O que você decidir sobre ela vale para o grupo inteiro.'
        : 'O que você decidir sobre cada uma vale para o grupo dela.';
    return `${quantas} junto com ${culpadas} que o servidor não aceitou${atras}. ${decida}`;
}

/** A lista vazia HONESTA: nada guardado, nada a caminho, e a leitura funcionou. */
export const ESTADO_VAZIO_TITULO = 'Nenhuma pendência';

/** @type {string} */
export const ESTADO_VAZIO_DETALHE =
    'Tudo o que você fez neste atlas já foi aceito pelo servidor, e não há figura à espera de '
    + 'envio nem alteração guardada de uma sessão anterior.';

/**
 * A lista vazia onde NÃO EXISTE fila de saída, que é o atlas local: ali só a quarentena global é
 * lida, porque ela é a única fonte que não pertence a um atlas.
 *
 * ELA NÃO PODE DIZER A FRASE ACIMA, e essa é a correção que veio junto: num atlas local a fila de
 * saída e a de figuras nem chegam a ser consultadas, então afirmar que "não há figura à espera de
 * envio" é relatar uma leitura que ninguém fez. Esta frase afirma só o que foi lido.
 * @type {string}
 */
export const ESTADO_VAZIO_LOCAL_DETALHE =
    'Não há alteração guardada de uma sessão anterior à espera de decisão. Este atlas fica só '
    + 'neste computador, então nada dele é enviado.';

/**
 * O QUE ESTÁ A CAMINHO, que é a metade que o painel não listava e o crachá contava.
 *
 * É O MESMO NÚMERO que o crachá de sync chama de "Enviando N…" (`describeSyncWork`, entrada
 * `pending`): `pendentes + preparadas` do censo da fila do escopo montado. Enquanto o painel não o
 * lia, as duas superfícies liam a MESMA fila e diziam coisas opostas, medido em 2026-09-15 nos dois
 * navegadores: "Enviando 2…" no crachá e "Nenhuma pendência" no painel que ele abre.
 *
 * O SUBSTANTIVO É "alteração" E NÃO "operação" de propósito: é a palavra que a frase longa do
 * próprio crachá usa para este mesmo número (`pendingLabel`, `sync-phrases.js`) e a que as ações
 * deste painel já usam. Dois substantivos para a mesma coisa nas duas telas se leem como duas
 * quantidades diferentes, que é exatamente o defeito que esta linha existe para fechar.
 * @param {number} quantas - Quantas alterações estão na fila à espera de confirmação.
 * @returns {string}
 */
export function transitoTitulo(quantas) {
    const n = Number.isFinite(quantas) && quantas > 0 ? Math.trunc(quantas) : 0;
    return n === 1 ? '1 alteração a caminho' : `${n} alterações a caminho`;
}

/**
 * O ESTADO DE LISTA VAZIA, QUE TEM TRÊS FRASES E NÃO UMA.
 *
 * "Nenhuma pendência" é uma AFIRMAÇÃO, e ela só é verdadeira quando não há nada guardado E nada
 * esperando envio. Com trabalho na fila ela contradiz o crachá que abriu esta tela, e a pessoa fica
 * com duas telas do mesmo produto dizendo coisas opostas sobre a mesma fila: a leitura natural é
 * que uma das duas está quebrada, e nenhuma está.
 *
 * O CONTRATO ADOTADO: o painel é o lugar do que EXIGE DECISÃO, e o que está a caminho não exige
 * nenhuma, então ele não vira linha de lista (não há ação a oferecer sobre uma alteração que sai
 * sozinha). Mas ele é DITO, com o mesmo número do crachá, porque a alternativa é a contradição.
 * O QUE NÃO É UMA CONTAGEM CAI NO RAMO DE QUEM NÃO TEM FILA, nunca no ramo do zero, e é a mesma
 * regra do `null` de `toPendingCount` na luz de sync: só o zero MEDIDO autoriza "tudo já foi
 * aceito pelo servidor", que é a frase sobre a qual alguém decide sair da conta.
 * @param {number|null|undefined} aCaminho - Alterações na fila à espera de confirmação; `null`
 *   quando não existe fila de saída neste escopo (atlas local).
 * @returns {{titulo: string, detalhe: string}}
 */
export function estadoVazio(aCaminho) {
    if (!Number.isFinite(aCaminho) || aCaminho < 0) {
        return { titulo: ESTADO_VAZIO_TITULO, detalhe: ESTADO_VAZIO_LOCAL_DETALHE };
    }
    const n = Math.trunc(aCaminho);
    if (n === 0) return { titulo: ESTADO_VAZIO_TITULO, detalhe: ESTADO_VAZIO_DETALHE };
    return {
        titulo: transitoTitulo(n),
        detalhe: 'Nada aqui exige decisão sua: estas alterações estão guardadas neste computador e '
            + 'saem sozinhas assim que o servidor confirmar.',
    };
}

/**
 * A mesma verdade quando a lista NÃO está vazia: o que está a caminho não some da tela só porque
 * há uma recusa para decidir.
 *
 * `null` quando não há o que dizer, e o painel então não desenha nada: uma linha "0 alterações a
 * caminho" ocupa a mesma altura e não informa.
 * @param {number|null|undefined} aCaminho - Alterações na fila à espera de confirmação.
 * @returns {string|null}
 */
export function transitoNota(aCaminho) {
    if (!Number.isFinite(aCaminho) || aCaminho <= 0) return null;
    const n = Math.trunc(aCaminho);
    return `Além do que está nesta lista, ${transitoTitulo(n)}, que ${n === 1 ? 'sai' : 'saem'} `
        + `${n === 1 ? 'sozinha' : 'sozinhas'} e não ${n === 1 ? 'exige' : 'exigem'} decisão.`;
}

/** A falha de leitura, que NUNCA se desenha como lista vazia. */
export const ESTADO_FALHA_TITULO = 'Não foi possível ler as pendências';

/** @type {string} */
export const ESTADO_FALHA_DETALHE =
    'Não foi possível verificar o que ficou por enviar neste computador. Isso não quer dizer que '
    + 'não haja nada guardado.';

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
        'Sem conexão com o servidor. Tente de novo quando a conexão voltar.',
    [PendenciaBloqueio.MAPA_TRAVADO]:
        'Mapa bloqueado. Desbloqueie o mapa para reaplicar a sua alteração.',
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
        ?? 'Esta ação não está disponível agora.';
}

/**
 * A pergunta de "Aceitar o servidor", que NOMEIA quantas tentativas somem.
 *
 * O número é obrigatório e não decorativo: aceitar o servidor sobre uma tentativa leva junto tudo
 * o que estava parado atrás dela, e uma pergunta que diga só "esta alteração" mente sobre o
 * tamanho do que a pessoa está aceitando perder. Numa parte recusada o grupo inclui também as que
 * VOLTARAM JUNTO, e a frase diz as duas origens em vez de chamar todas de "paradas atrás".
 * @param {number} quantas - Total de tentativas que serão descartadas, esta inclusive.
 * @param {Object} [opcoes]
 * @param {boolean} [opcoes.doGrupo=false] - A tentativa pertence a uma parte recusada.
 * @returns {{titulo: string, mensagem: string, confirmar: string}}
 */
export function confirmacaoDeAceitar(quantas, { doGrupo = false } = {}) {
    const total = Number.isFinite(quantas) && quantas > 0 ? Math.trunc(quantas) : 1;
    const origem = doGrupo === true ? 'que voltaram junto com ela ou estão paradas atrás' : 'que estão paradas atrás dela';
    const corpo = total === 1
        ? 'Esta tentativa será descartada e o EBGeo vai buscar do servidor o estado atual do item.'
        : `Esta tentativa e as outras ${total - 1} ${origem} serão descartadas, `
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
        ? 'Alteração reenviada. Se o servidor aceitar, o mapa é atualizado em seguida.'
        : 'Alteração guardada para envio. Ela sai quando a conexão voltar; até lá, o mapa mostra a '
            + 'versão do servidor.';
}

/** Quando a reaplicação não conseguiu ser enfileirada. */
export const REAPLICACAO_FALHOU =
    'Não foi possível reenviar esta alteração. Nada foi mudado.';

/** Quando aceitar o servidor não conseguiu remover a tentativa. */
export const ACEITE_FALHOU =
    'Não foi possível descartar esta tentativa. Nada foi mudado, e ela continua na lista.';
