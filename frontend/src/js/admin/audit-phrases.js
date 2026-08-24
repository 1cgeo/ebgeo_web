// Path: js/admin/audit-phrases.js

/**
 * @fileoverview O QUE A ABA "AUDITORIA" DIZ sobre uma linha da trilha, como funções puras.
 *
 * A trilha chega em snake_case, com `action` e `target_type` em MAIÚSCULAS e um `details`
 * livre. Despejar isso numa tabela produz um log que ninguém lê: a diferença entre um
 * dump e uma tela é a FRASE. Ela é aritmética de vocabulário e concordância, testável em
 * node puro, e por isso não mora dentro do construtor de DOM — o ambiente de teste do
 * frontend não tem jsdom.
 *
 * A DECISÃO QUE MAIS IMPORTA AQUI É O FALLBACK. Ação sem tradução devolve o PRÓPRIO
 * CÓDIGO (`'ACAO_NOVA'`), nunca "Desconhecido" nem string vazia: um rótulo genérico
 * ESCONDE uma ação nova sem frase, que é a classe de defeito que este repositório mais
 * paga (uma checagem que não checa, um rótulo que não rotula). O código cru é feio na
 * tela e é exatamente por isso que ele é consertado.
 *
 * AS CINCO FAMÍLIAS existem para colorir o chip e para agrupar o filtro, e elas são uma
 * LEITURA do vocabulário, não uma hierarquia: `acesso` (quem alcança o quê), `identidade`
 * (contas e papéis), `acervo` (catálogo e 360), `atlas` (o ciclo de vida dos projetos) e
 * `sistema` (configuração e o resto). Uma ação nova cai em `sistema`, que é o balde
 * honesto para "ainda não classificado".
 *
 * Módulo FOLHA, com zero imports: `admin.html` boota sem a store, e um import daqui
 * arrastaria `@store` pelo caminho transitivo.
 */

/** As famílias, na ordem em que a barra de filtros as agrupa. @type {ReadonlyArray<string>} */
export const FAMILIAS = Object.freeze(['acesso', 'identidade', 'acervo', 'atlas', 'sistema']);

/**
 * Família → rótulo de TELA.
 *
 * A chave é código: ela colore o chip (`admin-audit__chip--acesso`) e agrupa o filtro. Ela
 * saía CRUA no `<optgroup>` do `<select>` de ação, e "acesso"/"identidade"/"acervo" em
 * minúscula é chave interna vazando para a interface, contra a convenção de string de UI
 * em pt-BR. Nada pegava: nem o lint (rótulo não é símbolo) nem o teste (que só conhecia
 * ação e alvo).
 */
const ROTULOS_DE_FAMILIA = Object.freeze({
    acesso: 'Acesso',
    identidade: 'Identidade',
    acervo: 'Acervo',
    atlas: 'Atlas',
    sistema: 'Sistema',
});

/**
 * O rótulo de uma família, ou o próprio código — mesmo fallback honesto de `rotuloDeAcao`.
 * @param {string} familia
 * @returns {string}
 */
export function rotuloDeFamilia(familia) {
    const chave = String(familia ?? '');
    return ROTULOS_DE_FAMILIA[chave] ?? (chave || '—');
}

/**
 * Ação → { rotulo, familia }.
 *
 * O VOCABULÁRIO É O DO CHECK de `audit_trail.action`, e o teste desta tela o lê da
 * MIGRAÇÃO em vez de desta constante: comparar o mapa consigo mesmo seria cobertura
 * vazia. Ação declarada no banco e ausente daqui reprova nomeando a que ficou sem frase.
 *
 * Os rótulos são frases de TELA, em pt-BR e no passado: a linha já aconteceu.
 */
const ACOES = Object.freeze({
    // --- acesso: quem alcança o quê -----------------------------------------
    SHARING_CHANGE: { rotulo: 'Compartilhamento alterado', familia: 'acesso' },
    PERMISSION_GRANT: { rotulo: 'Acesso concedido', familia: 'acesso' },
    PERMISSION_REVOKE: { rotulo: 'Acesso revogado', familia: 'acesso' },
    PERMISSION_REPARENT: { rotulo: 'Acesso preservado por outro caminho', familia: 'acesso' },
    PERMISSION_PURGE: { rotulo: 'Vínculos de acesso destruídos', familia: 'acesso' },
    ACCESS_GROUP_CREATE: { rotulo: 'Grupo de acesso criado', familia: 'acesso' },
    ACCESS_GROUP_UPDATE: { rotulo: 'Grupo de acesso alterado', familia: 'acesso' },
    ACCESS_GROUP_DELETE: { rotulo: 'Grupo de acesso apagado', familia: 'acesso' },
    ACCESS_GROUP_MEMBER_ADD: { rotulo: 'Pessoa incluída no grupo', familia: 'acesso' },
    ACCESS_GROUP_MEMBER_REMOVE: { rotulo: 'Pessoa retirada do grupo', familia: 'acesso' },

    // --- identidade: contas, sessões e papéis --------------------------------
    LOGIN: { rotulo: 'Entrada no sistema', familia: 'identidade' },
    LOGOUT: { rotulo: 'Saída do sistema', familia: 'identidade' },
    USER_CREATE: { rotulo: 'Conta criada', familia: 'identidade' },
    USER_UPDATE: { rotulo: 'Conta alterada', familia: 'identidade' },
    USER_DELETE: { rotulo: 'Conta desativada', familia: 'identidade' },
    USER_REACTIVATE: { rotulo: 'Conta reativada', familia: 'identidade' },
    PASSWORD_RESET: { rotulo: 'Senha redefinida', familia: 'identidade' },
    API_KEY_ROTATE: { rotulo: 'Chave de API rotacionada', familia: 'identidade' },
    ROLE_CHANGE: { rotulo: 'Papel global alterado', familia: 'identidade' },
    PRODUCER_SCOPE_CHANGE: { rotulo: 'Escopo de produção alterado', familia: 'identidade' },
    ORG_CREATE: { rotulo: 'Organização criada', familia: 'identidade' },
    ORG_UPDATE: { rotulo: 'Organização alterada', familia: 'identidade' },
    ORG_DELETE: { rotulo: 'Organização desativada', familia: 'identidade' },
    // OS TRÊS DE POSTO nasceram em 2026-08-24, quando o CRUD de postos deixou de ser o único
    // do painel sem trilha nenhuma. Ficam na família 'identidade' com os de organização porque é
    // isso que eles são: a lista controlada que alimenta o cadastro de toda a base, e uma
    // renumeração de hierarquia militar não deixava rastro.
    //
    // "Posto desativado", e não "excluído": `DEACTIVATE_RANK` é `is_active = false`, e o rótulo
    // que dissesse exclusão repetiria na trilha a mentira que a tela acabou de parar de contar.
    RANK_CREATE: { rotulo: 'Posto criado', familia: 'identidade' },
    RANK_UPDATE: { rotulo: 'Posto alterado', familia: 'identidade' },
    RANK_DELETE: { rotulo: 'Posto desativado', familia: 'identidade' },
    // A chave de API é CREDENCIAL, não recurso: ela cai em `identidade` ao lado de sessão e
    // papel, e não em `acesso`, que é sobre quem alcança QUAL recurso. As duas entraram em
    // 2026-08-24, com as três amarras da cláusula 10.7 (prazo, escopo, revogação individual).
    // Repare que não há ação de USO: nenhuma rota de leitura deste servidor emite trilha, e
    // inventar uma para dizer que alguém leu um tile gravaria afirmação que ninguém apurou.
    API_KEY_CREATE: { rotulo: 'Chave de API emitida', familia: 'identidade' },
    API_KEY_REVOKE: { rotulo: 'Chave de API revogada', familia: 'identidade' },

    // --- acervo: catálogo e 360 ---------------------------------------------
    CATALOG_CREATE: { rotulo: 'Item de catálogo criado', familia: 'acervo' },
    CATALOG_UPDATE: { rotulo: 'Item de catálogo alterado', familia: 'acervo' },
    CATALOG_DELETE: { rotulo: 'Item de catálogo removido', familia: 'acervo' },
    SV360_INGEST: { rotulo: 'Projeto 360 ingerido', familia: 'acervo' },
    SV360_DELETE: { rotulo: 'Projeto 360 destruído', familia: 'acervo' },
    SV360_STATUS_CHANGE: { rotulo: 'Projeto 360 ocultado ou reexibido', familia: 'acervo' },

    // --- atlas ---------------------------------------------------------------
    ATLAS_CREATE: { rotulo: 'Atlas criado', familia: 'atlas' },
    ATLAS_DELETE: { rotulo: 'Atlas apagado', familia: 'atlas' },
    ATLAS_RESTORE: { rotulo: 'Atlas restaurado', familia: 'atlas' },
    ATLAS_TRANSFER: { rotulo: 'Atlas transferido', familia: 'atlas' },

    // --- sistema -------------------------------------------------------------
    CONFIG_UPDATE: { rotulo: 'Configuração alterada', familia: 'sistema' },
    CONFIG_CLEAR: { rotulo: 'Configuração restaurada ao padrão', familia: 'sistema' },
});

/**
 * `target_type` → rótulo do tipo de alvo.
 *
 * Os quatro valores reservados sem emissor (`GROUP`, `MODEL`, `SYSTEM`,
 * `STREETVIEW_MARKER`) estão AQUI de propósito, e não como esquecimento: linha de trilha
 * já gravada pode carregá-los, e a tela precisa saber dizer o que eram.
 */
const ALVOS = Object.freeze({
    USER: 'Conta',
    GROUP: 'Grupo de feições',
    MODEL: 'Modelo',
    SYSTEM: 'Sistema',
    ATLAS: 'Atlas',
    ORG: 'Organização',
    BASEMAP: 'Mapa base',
    DATA_LAYER: 'Camada de dados',
    ANALYSIS_LAYER: 'Camada de análise',
    TILESET: 'Modelo 3D',
    STREETVIEW_MARKER: 'Marcador 360',
    SV360_PROJECT: 'Projeto 360',
    CONFIG: 'Configuração',
    ACCESS_GROUP: 'Grupo de acesso',
    RANK: 'Posto',
});

/**
 * Rótulo pt-BR dos campos que o de-para da trilha classifica (`backend/src/utils/audit-diff.js`).
 *
 * ELE COBRE MENOS DO QUE AQUELE ARQUIVO CLASSIFICA, e isso é aceito: um campo sem rótulo
 * aqui aparece com o nome cru, que continua legível ("sourceLayer"), enquanto um rótulo
 * genérico apagaria a informação. A chave é o caminho SEM o prefixo `config.`, porque ele
 * é o mesmo em toda linha de catálogo.
 */
const CAMPOS = Object.freeze({
    // --- conta (família USUÁRIOS) -------------------------------------------
    role: 'Papel global',
    producer_org_id: 'OM produtora',
    organization_id: 'OM de lotação',
    rank_id: 'Posto ou graduação',
    is_active: 'Conta ativa',
    email_verified: 'E-mail confirmado',
    nome: 'Nome',
    username: 'Nome de usuário',
    email: 'E-mail',
    // --- catálogo e 360 ------------------------------------------------------
    name: 'Nome',
    description: 'Descrição',
    sort_order: 'Ordem',
    forma3d: 'Forma do 3D',
    enabled: 'Habilitado',
    priority: 'Prioridade',
    opacity: 'Opacidade',
    minzoom: 'Zoom mínimo',
    maxzoom: 'Zoom máximo',
    heightOffset: 'Deslocamento de altura',
    data_captura: 'Data de captura',
    local: 'Local',
    url: 'Endereço do serviço',
    basePath: 'Caminho base',
    source: 'Fonte de dados',
    style: 'Estilo',
    previewVideo: 'Vídeo de prévia',
    previewThumbnail: 'Miniatura',
    thumbnail: 'Miniatura',
    image: 'Imagem',
    locate: 'Localização',
    bounds: 'Extensão',
    keywords: 'Palavras-chave',
});

/** Um valor literal do de-para, pronto para a tela. */
function valorLegivel(valor) {
    if (valor === null || valor === undefined) return '(vazio)';
    if (typeof valor === 'string') return valor === '' ? '(vazio)' : `“${valor}”`;
    return String(valor);
}

/** Uma impressão do de-para, com reticências para dizer que ela é um resumo. */
function valorDeImpressao(impressao) {
    if (!impressao) return '(vazio)';
    return `${impressao}…`;
}

/**
 * O rótulo de uma ação, ou o PRÓPRIO CÓDIGO quando ela não tem frase.
 * @param {string} acao
 * @returns {string}
 */
export function rotuloDeAcao(acao) {
    const chave = String(acao ?? '');
    return ACOES[chave]?.rotulo ?? (chave || '—');
}

/**
 * A família de uma ação, para colorir o chip e agrupar o filtro. Desconhecida cai em
 * `sistema`, que é o balde honesto para "ainda não classificado".
 * @param {string} acao
 * @returns {string}
 */
export function familiaDeAcao(acao) {
    return ACOES[String(acao ?? '')]?.familia ?? 'sistema';
}

/**
 * O rótulo de um tipo de alvo, ou o próprio código.
 * @param {string} tipo
 * @returns {string}
 */
export function rotuloDeAlvo(tipo) {
    const chave = String(tipo ?? '');
    return ALVOS[chave] ?? (chave || '—');
}

/**
 * As ações conhecidas, agrupadas por família, para montar o `<select>` do filtro.
 * @returns {Array<{familia: string, acoes: Array<{valor: string, rotulo: string}>}>}
 */
export function acoesPorFamilia() {
    return FAMILIAS.map((familia) => ({
        familia,
        acoes: Object.keys(ACOES)
            .filter((a) => ACOES[a].familia === familia)
            .map((a) => ({ valor: a, rotulo: ACOES[a].rotulo }))
            .sort((x, y) => x.rotulo.localeCompare(y.rotulo, 'pt-BR')),
    })).filter((g) => g.acoes.length > 0);
}

/**
 * O nome de quem praticou o ato.
 *
 * `actor_id` NÃO TEM FK (decisão de schema: a trilha sobrevive ao delete da conta), então
 * a junta pode vir vazia — e é justamente a linha do ator apagado que mais importa numa
 * investigação. Sem nome, o id truncado é melhor que nada, e "Conta removida" é melhor
 * que um UUID nu quando nem isso existe.
 * @param {{actor_nome?: string|null, actor_username?: string|null, actor_id?: string|null}} linha
 * @returns {string}
 */
export function nomeDoAtor(linha) {
    const nome = (linha?.actor_nome ?? '').trim();
    const login = (linha?.actor_username ?? '').trim();
    if (nome && login) return `${nome} (${login})`;
    if (nome || login) return nome || login;
    const id = String(linha?.actor_id ?? '').trim();
    return id ? `Conta removida (${id.slice(0, 8)})` : 'Sistema';
}

/**
 * O nome do alvo: o snapshot gravado na época, com o id como reserva.
 *
 * `target_name` é FOTOGRAFIA, não referência viva — renomear o recurso depois não
 * reescreve a trilha. É o que ainda diz o que era um id destruído.
 * @param {{target_name?: string|null, target_id?: string|null, target_type?: string|null}} linha
 * @returns {string}
 */
export function nomeDoAlvo(linha) {
    const nome = (linha?.target_name ?? '').trim();
    if (nome) return nome;
    const id = String(linha?.target_id ?? '').trim();
    return id || rotuloDeAlvo(linha?.target_type);
}

/**
 * A OM dona do recurso alvo, para a coluna que só o administrador vê.
 *
 * NULO É UM ESTADO COM NOME, e ele significa duas coisas que a tela não deve fundir com
 * "vazio": alvo sem OM dona (conta, atlas, configuração) e acervo INSTITUCIONAL. A
 * distinção entre as duas não está no dado, e a frase não a inventa.
 * @param {{target_org_sigla?: string|null, target_org_nome?: string|null,
 *   target_org_id?: string|null}} linha
 * @returns {string}
 */
export function nomeDaOm(linha) {
    const sigla = (linha?.target_org_sigla ?? '').trim();
    const nome = (linha?.target_org_nome ?? '').trim();
    if (sigla) return sigla;
    if (nome) return nome;
    return linha?.target_org_id ? String(linha.target_org_id).slice(0, 8) : '—';
}

/**
 * O ATOR E O ALVO, SEM A AÇÃO: o que a LINHA da lista mostra ao lado do chip.
 *
 * `fraseDoEvento` traz a ação embutida, e a linha da tela já carrega um chip com o rótulo
 * dela: usar as duas juntas imprimia "Item de catálogo alterado" DUAS VEZES na mesma
 * linha, uma no chip e outra dentro da frase. Os dois desenhos foram escritos e os dois
 * ficaram. Aqui o chip é o portador da ação e esta função é o portador do resto; a frase
 * inteira sobrevive para o `title` e para a leitura por leitor de tela, onde não existe
 * chip ao lado.
 *
 * O ramo "sem alvo nenhum" é o MESMO de `fraseDoEvento`, e precisa continuar sendo: numa
 * linha de `LOGIN` o chip já diz tudo, e inventar um alvo ("no sistema") diria mais do
 * que a linha sabe.
 * @param {Object} linha - Uma linha de `audit_trail` como a rota a devolve.
 * @returns {string}
 */
export function alvoDoEvento(linha) {
    const ator = nomeDoAtor(linha);
    if (!linha?.target_type && !linha?.target_id) return ator;
    return `${ator} · ${rotuloDeAlvo(linha?.target_type)} “${nomeDoAlvo(linha)}”`;
}

/**
 * A LINHA COLAPSADA: uma frase por evento, que é o que separa a tela do dump.
 *
 * "Fulano alterou o item de catálogo Modelo X". O alvo entra entre aspas quando tem nome
 * próprio, e o tipo aparece porque o mesmo verbo vale para coisas diferentes.
 *
 * QUEM A USA NA TELA É O `title` DA LINHA, não o texto visível — ver `alvoDoEvento`.
 * @param {Object} linha - Uma linha de `audit_trail` como a rota a devolve.
 * @returns {string}
 */
export function fraseDoEvento(linha) {
    const acao = rotuloDeAcao(linha?.action);
    const tipo = rotuloDeAlvo(linha?.target_type);
    const alvo = nomeDoAlvo(linha);
    // Sem alvo nenhum a frase para no ato: "Fulano — Entrada no sistema" é honesto, e
    // inventar um alvo ("no sistema") diria mais do que a linha sabe.
    if (!linha?.target_type && !linha?.target_id) return `${nomeDoAtor(linha)} — ${acao}`;
    return `${nomeDoAtor(linha)} — ${acao} · ${tipo} “${alvo}”`;
}

/**
 * O NOME LEGÍVEL de um caminho pontilhado do de-para.
 *
 * A trilha grava o caminho como o servidor o classifica (`config.previewVideo`), que é a
 * forma certa para o registro e a errada para a tela. O prefixo `config.` some porque ele
 * é ruído em toda linha de catálogo, e o que sobra ganha rótulo quando existe.
 *
 * O DESCONHECIDO CAI NO PRÓPRIO CAMINHO, nunca num rótulo genérico — a mesma regra de
 * `rotuloDeAcao`, e pela mesma razão: um "Campo" apagaria a única informação que a linha
 * tem sobre um campo que ninguém traduziu.
 * @param {string} caminho
 * @returns {string}
 */
export function rotuloDeCampo(caminho) {
    const cru = String(caminho ?? '');
    const curto = cru.startsWith('config.') ? cru.slice('config.'.length) : cru;
    return CAMPOS[curto] ?? curto;
}

/**
 * O DE-PARA de uma linha, já em frases, uma por campo mudado.
 *
 * TRÊS REGIMES, e a tela precisa dizer QUAL, senão uma impressão de doze hexadecimais lida
 * como um valor:
 *
 *   - VALOR: `Nome: "antes" → "depois"`.
 *   - IMPRESSÃO: `Endereço do serviço: alterado (impressão a1b2c3… → d4e5f6…)`. O texto diz
 *     "impressão" por extenso porque o leitor precisa saber que aquilo NÃO é o valor e não
 *     serve para reconstruí-lo — só para comparar com outra linha.
 *   - NOME-SÓ: `Chave inventada: alterado (valor não registrado)`. É a garantia antiga da
 *     trilha, e dizer "não registrado" é o que impede a leitura de que o campo não mudou.
 *
 * `truncado` vira uma frase própria, no fim: uma linha que degradou inteira para nome-só é
 * indistinguível de uma linha sem de-para, e essa diferença é justamente o que uma
 * investigação precisa saber.
 * @param {Object} detalhes - O `details` da linha.
 * @returns {{campo: string, texto: string}[]} Vazio quando a linha não tem de-para.
 */
export function linhasDoDePara(detalhes) {
    const saida = [];
    const mudou = Array.isArray(detalhes?.mudou) ? detalhes.mudou : [];
    const outros = Array.isArray(detalhes?.outros) ? detalhes.outros : [];

    for (const item of mudou) {
        const campo = rotuloDeCampo(item?.campo);
        if (item?.regime === 'impressao') {
            saida.push({
                campo,
                texto: `alterado (impressão ${valorDeImpressao(item?.de)} → ${valorDeImpressao(item?.para)})`,
            });
            continue;
        }
        saida.push({ campo, texto: `${valorLegivel(item?.de)} → ${valorLegivel(item?.para)}` });
    }
    for (const caminho of outros) {
        saida.push({ campo: rotuloDeCampo(caminho), texto: 'alterado (valor não registrado)' });
    }
    if (detalhes?.truncado === true) {
        saida.push({
            campo: 'Registro',
            texto: 'a mudança foi grande demais e só os nomes dos campos foram gravados',
        });
    }
    return saida;
}

/** As chaves que o de-para CONSOME: elas viram frase e nunca devem sair como JSON cru. */
const CHAVES_DO_DEPARA = Object.freeze(['mudou', 'outros', 'truncado']);

/**
 * As chaves de `details` que a segunda seção da gaveta NÃO deve redesenhar.
 *
 * `mudou`/`outros`/`truncado` são a matéria-prima do de-para e saem sempre. `fields` é o
 * caso interessante e é por ele que esta função existe em vez de uma constante: ele é a
 * lista CRUA de nomes de campo, aditiva, e sai **só quando há frases** — numa linha com
 * de-para ele é o mesmo conjunto dito duas vezes (`["config","name"]` embaixo de
 * `Nome: … → …`), e numa linha ANTIGA, sem de-para, ele é a única informação de campo que a
 * trilha tem, então apagá-lo incondicionalmente perderia dado.
 *
 * Mora aqui, e não no construtor de DOM, pelo mesmo motivo do resto do arquivo: é decisão de
 * vocabulário, e o ambiente de teste do frontend não tem jsdom.
 * @param {Object} detalhes - O `details` da linha.
 * @returns {Set<string>}
 */
export function chavesJaDitasPeloDePara(detalhes) {
    const base = new Set(CHAVES_DO_DEPARA);
    if (linhasDoDePara(detalhes).length > 0) base.add('fields');
    return base;
}

/**
 * `details.origem` → por que a concessão caiu, em pt-BR.
 *
 * ELA EXISTE PORQUE A GAVETA DESPEJAVA `origem: USER_DEMOTION` CRU, num painel em
 * português, exatamente onde o leitor precisava entender por que uma concessão que
 * ninguém revogou deliberadamente aparece revogada.
 *
 * O VOCABULÁRIO É O DOS CHAMADORES de `podarPorRaizes` (`backend/src/modules/`), e são
 * QUATRO carimbos mais um quinto estado que não carimba nada: a revogação deliberada não
 * põe `origem` nenhuma, e é por isso que ela não aparece aqui — ausência de origem já
 * significa "alguém revogou de propósito", e inventar um verbete para ela transformaria
 * um silêncio informativo numa frase.
 *
 * O FALLBACK É O DO RESTO DO ARQUIVO: origem sem verbete devolve o PRÓPRIO CÓDIGO, e
 * quem a desenha marca o texto como CÓDIGO (ver {@link linhasDeDetalhe}), para que ele
 * não se leia como uma frase em português mal escrita.
 */
const ORIGENS = Object.freeze({
    USER_DEMOTION: 'quem concedeu perdeu o papel global ou a OM produtora',
    USER_DELETE: 'a conta de quem concedeu foi desativada',
    ACCESS_GROUP_DELETE: 'o grupo de acesso foi apagado',
    ACCESS_GROUP_MEMBER_REMOVE: 'a pessoa saiu do grupo de acesso',
});

/** Os quatro papéis GLOBAIS, que não formam escada. Eles saem crus em `details.role`. */
const PAPEIS_GLOBAIS = Object.freeze({
    user: 'Usuário',
    producer: 'Produtor',
    credenciado: 'Credenciado',
    admin: 'Administrador',
});

/**
 * `details.<chave>` → rótulo pt-BR da SEGUNDA seção da gaveta.
 *
 * DELIBERADAMENTE PARCIAL. `details` é um documento livre, escrito por uma dúzia de
 * emissores, e um dicionário que tentasse cobrir tudo estaria errado na semana seguinte.
 * Aqui entra só o que foi lido no emissor; o resto cai no nome cru, marcado como código.
 */
const CHAVES_DE_DETALHE = Object.freeze({
    origem: 'Motivo da queda',
    self: 'Ato do próprio titular',
    fields: 'Campos tocados',
    table: 'Tabela',
    from: 'De',
    to: 'Para',
    role: 'Papel global',
    organization_id: 'OM de lotação',
    producer_org_id: 'OM produtora',
    resourceType: 'Tipo de recurso',
    atlasTransferred: 'Atlas transferidos',
    grantsRevoked: 'Concessões derrubadas',
    grantsAffected: 'Concessões derrubadas',
    grantsReparented: 'Concessões preservadas por outro caminho',
    sessionsRevoked: 'Sessões encerradas',
});

/**
 * As chaves cujo VALOR é um código de vocabulário fechado, e o dicionário de cada uma.
 *
 * É esta tabela que separa "campo sem verbete" (o nome sai cru) de "valor sem verbete"
 * (o valor sai cru): as duas coisas acontecem em lugares diferentes da linha, e fundi-las
 * esconderia qual das duas metades ninguém traduziu.
 *
 * `from`/`to` SÃO AMBÍGUOS DE PROPÓSITO, e vale saber por quê antes de "consertar": as
 * duas chaves servem `ROLE_CHANGE` (papel global) e `PRODUCER_SCOPE_CHANGE` (id de OM), e
 * a chave sozinha não diz qual. Com o dicionário de papéis os dois casos saem certos: o
 * papel vira frase e o id de OM, que não casa com nada, sai marcado como CÓDIGO, que é
 * exatamente o que ele é.
 */
const VALORES_DE_DETALHE = Object.freeze({
    origem: ORIGENS,
    role: PAPEIS_GLOBAIS,
    from: PAPEIS_GLOBAIS,
    to: PAPEIS_GLOBAIS,
});

/**
 * O motivo pelo qual uma concessão caiu, ou o PRÓPRIO CÓDIGO quando ninguém o traduziu.
 * @param {string} origem
 * @returns {string}
 */
export function rotuloDeOrigem(origem) {
    const chave = String(origem ?? '');
    return ORIGENS[chave] ?? (chave || '—');
}

/**
 * A SEGUNDA SEÇÃO DA GAVETA: o resto do `details`, já em pt-BR onde há verbete.
 *
 * Devolve, por entrada, o par (chave, texto) mais DUAS bandeiras que dizem qual das duas
 * metades saiu sem tradução. Quem desenha usa as bandeiras para pintar aquele pedaço como
 * CÓDIGO, e essa é a regra que a cláusula 9.3 pede: esconder o não traduzido é pior que
 * mostrá-lo, e mostrá-lo com cara de frase em português é pior que mostrá-lo como código.
 *
 * As chaves que o de-para já disse saem daqui (`chavesJaDitasPeloDePara`), senão a gaveta
 * imprimiria duas vezes a mesma mudança, uma em frase e outra em JSON.
 * @param {Object} detalhes - O `details` da linha.
 * @returns {Array<{chave: string, chaveEhCodigo: boolean, texto: string, textoEhCodigo: boolean}>}
 */
export function linhasDeDetalhe(detalhes) {
    if (detalhes === null || typeof detalhes !== 'object') return [];
    const pular = chavesJaDitasPeloDePara(detalhes);
    const saida = [];

    // `Object.hasOwn` E NÃO O ACESSO DIRETO, nos dois lados: as tabelas são literais e
    // herdam de `Object.prototype`, então uma chave de `details` chamada `constructor` ou
    // `toString` acharia um verbete que ninguém escreveu e a gaveta imprimiria
    // "[object Object]" no lugar do dado. As chaves vêm do servidor, o que torna isso
    // improvável e não impossível, e o custo de fechar é uma chamada.
    for (const [chave, valor] of Object.entries(detalhes)) {
        if (pular.has(chave)) continue;
        const temRotulo = Object.hasOwn(CHAVES_DE_DETALHE, chave);
        const dicionario = Object.hasOwn(VALORES_DE_DETALHE, chave) ? VALORES_DE_DETALHE[chave] : null;

        let texto;
        let textoEhCodigo = false;
        if (valor === null || valor === undefined) {
            texto = '—';
        } else if (typeof valor === 'boolean') {
            texto = valor ? 'sim' : 'não';
        } else if (dicionario && typeof valor === 'string') {
            const traduzido = Object.hasOwn(dicionario, valor);
            texto = traduzido ? dicionario[valor] : valor;
            textoEhCodigo = !traduzido;
        } else if (typeof valor === 'object') {
            // Estrutura livre (lista de campos, objeto aninhado): ela É dado cru, e sai
            // marcada como tal em vez de fingir ser uma frase.
            texto = JSON.stringify(valor);
            textoEhCodigo = true;
        } else {
            texto = String(valor);
        }

        saida.push({
            chave: temRotulo ? CHAVES_DE_DETALHE[chave] : chave,
            chaveEhCodigo: !temRotulo,
            texto,
            textoEhCodigo,
        });
    }
    return saida;
}

/**
 * A hora local de um `created_at`, no formato curto que a lista mostra.
 * @param {string|Date} quando
 * @returns {string}
 */
export function horaDoEvento(quando) {
    const d = quando instanceof Date ? quando : new Date(quando);
    if (Number.isNaN(d.getTime())) return '--:--';
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/**
 * O cabeçalho de um DIA, que é como a lista se agrupa: "hoje", "ontem" ou a data por
 * extenso. Agrupar por dia é o principal remédio anti-dump — uma lista de 50 carimbos de
 * tempo idênticos não se lê.
 * @param {string} chaveDoDia - `YYYY-MM-DD` local.
 * @param {Date} [hoje] - Injetável para o teste; nunca passado pela tela.
 * @returns {string}
 */
export function rotuloDoDia(chaveDoDia, hoje = new Date()) {
    const [a, m, d] = String(chaveDoDia ?? '').split('-').map(Number);
    if (!a || !m || !d) return String(chaveDoDia ?? '');
    const data = new Date(a, m - 1, d);
    const base = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
    const dias = Math.round((base - data) / 86400000);
    if (dias === 0) return 'Hoje';
    if (dias === 1) return 'Ontem';
    return data.toLocaleDateString('pt-BR', {
        weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
    });
}

/**
 * A chave de dia LOCAL de um instante (`YYYY-MM-DD`).
 *
 * Local e não UTC de propósito: o operador agrupa pelo dia dele. Usar `toISOString()`
 * jogaria um evento das 22h de Brasília para o dia seguinte.
 * @param {string|Date} quando
 * @returns {string}
 */
export function chaveDoDia(quando) {
    const d = quando instanceof Date ? quando : new Date(quando);
    if (Number.isNaN(d.getTime())) return '';
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * Agrupa as linhas por dia, preservando a ordem em que chegaram (mais recente primeiro).
 * @param {Array<Object>} linhas
 * @returns {Array<{dia: string, linhas: Array<Object>}>}
 */
export function agruparPorDia(linhas) {
    const grupos = [];
    for (const linha of Array.isArray(linhas) ? linhas : []) {
        const dia = chaveDoDia(linha?.created_at);
        const ultimo = grupos[grupos.length - 1];
        if (ultimo && ultimo.dia === dia) ultimo.linhas.push(linha);
        else grupos.push({ dia, linhas: [linha] });
    }
    return grupos;
}

/**
 * A ressalva que diz de QUAL recorte é a trilha, para quem não administra o sistema.
 *
 * O SERVIDOR JÁ MANDAVA E NINGUÉM LIA. `listAudit` devolve `escopoOrgId` (nulo para quem
 * administra, a OM do ator para os demais) desde que o eixo nasceu, e o comentário no próprio
 * serviço já admitia que o campo não tinha leitor na tela. A varredura em `frontend/src/` achava
 * uma única ocorrência do nome: a linha `@returns` do JSDoc do cliente HTTP.
 *
 * O efeito era duplo e os dois lados enganam: o produtor não sabia que a lista era recortada (então
 * lia ausência como "não aconteceu"), e não sabia de qual OM era o recorte (então não sabia o que a
 * ausência cobria). A frase fecha os dois numa linha.
 *
 * NÃO NOMEIA A OM, e a omissão é medida: o cliente não tem como resolver o id em nome sem a lista
 * de OMs, que só traz as ATIVAS. Prometer o nome faria a frase cair no UUID cru exatamente no caso
 * em que a OM foi desativada, que é justamente quando a pessoa mais precisa entender o que houve.
 *
 * O PARÂMETRO DECIDE, e não é enfeite: o `escopoOrgId` presente é o SERVIDOR afirmando que cortou
 * a lista, e é só nesse caso que se pode dizer "apenas os atos da sua OM". Ausente, a única coisa
 * honesta é dizer que a trilha cobre recursos e não contas, sem afirmar um corte que o servidor
 * não declarou.
 *
 * @param {string|null} [escopoOrgId] - O `escopoOrgId` da resposta do servidor.
 * @returns {string} A ressalva. Nunca vazia.
 */
export function escopoDaTrilhaNotice(escopoOrgId) {
    const semOm = 'Atos sobre contas, organizações, grupos de acesso, atlas e configuração do '
        + 'sistema não aparecem nesta trilha, mesmo os seus.';
    if (!escopoOrgId) return semOm;
    return 'Esta trilha mostra apenas os atos sobre recursos da OM para a qual você produz: '
        + `catálogo, acesso a recurso e projetos 360. ${semOm}`;
}
