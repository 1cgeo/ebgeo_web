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
 * OS TIPOS DE ALVO QUE O FILTRO OFERECE, na ordem em que a barra os agrupa.
 *
 * MUDOU DE CASA em 2026-08-25, e a mudança é o conserto: a lista morava dentro de
 * `audit-tab.js`, onde nenhum teste a alcançava, e `RANK` ganhou emissor em 2026-08-24
 * (`backend/src/modules/ranks/ranks.controller.js`) sem entrar aqui. O rótulo existia, o
 * CHECK do banco tinha o valor, e o filtro não o oferecia: uma família inteira de atos
 * (renumerar a hierarquia militar) não era interrogável na tela. Aqui a lista é medida
 * contra o DDL por `auditoria-tipos-de-alvo.test.js`, e esquecer o próximo fica vermelho.
 * @type {ReadonlyArray<string>}
 */
export const TIPOS_DE_ALVO = Object.freeze([
    'USER', 'ORG', 'ATLAS', 'ACCESS_GROUP', 'RANK',
    'BASEMAP', 'DATA_LAYER', 'ANALYSIS_LAYER', 'TILESET', 'SV360_PROJECT', 'CONFIG',
]);

/**
 * Os tipos DECLARADOS no CHECK que o filtro NÃO oferece, porque não têm emissor nenhum.
 *
 * `GROUP`, `MODEL`, `SYSTEM` e `STREETVIEW_MARKER` estão no banco para que uma linha JÁ
 * GRAVADA saiba dizer o que era, e é por isso que `rotuloDeAlvo` os conhece. Oferecê-los no
 * filtro seria oferecer quatro opções que só produzem lista vazia.
 *
 * A lista existe SEPARADA em vez de implícita: junto com {@link TIPOS_DE_ALVO} ela é um
 * CENSO do CHECK, e é o censo que reprova quando um tipo novo entra no banco sem ninguém
 * decidir de que lado ele cai.
 * @type {ReadonlyArray<string>}
 */
export const ALVOS_RESERVADOS = Object.freeze(['GROUP', 'MODEL', 'SYSTEM', 'STREETVIEW_MARKER']);

/**
 * Os tipos de alvo que NUNCA devolvem linha para quem não administra o sistema.
 *
 * Não é opinião, é propriedade do servidor: o recorte por OM é `AND ($5::uuid IS NULL OR
 * a.target_org_id = $5)`, e `target_org_id` só é carimbado por três módulos (catálogo, acesso a
 * recurso e 360). Usuários, organizações, configuração, grupos de acesso, POSTOS e
 * compartilhamento não passam OM em auditoria nenhuma, e atlas passa NULO de propósito, com o
 * motivo escrito lá (atlas não tem OM dona). O predicado não alcança `target_org_id IS NULL`,
 * também de propósito.
 *
 * O efeito na tela era um filtro que existia para provar lista vazia: metade das opções nunca
 * devolvia nada, e a mais desconcertante é `ACCESS_GROUP`, porque o produtor administra grupos
 * na aba ao lado e os atos dele sobre grupos não aparecem na trilha dele.
 *
 * DECISÃO DO DONO, 2026-08-24: a TELA diz o recorte, e grupos NÃO passam a carimbar OM. A
 * cláusula 9.2 fala em recursos produzidos, então o comportamento é literal; carimbar OM num
 * grupo obrigaria a escolher QUAL OM, e grupo é entidade de usuário, com dono, não de OM.
 *
 * `RANK` entra aqui pela mesma medida, e a fonte é o emissor: `ranks.controller.js` diz por
 * extenso que não passa `targetOrgId`, porque um posto é lista controlada do sistema inteiro e
 * não acervo de OM nenhuma.
 * @type {ReadonlyArray<string>}
 */
export const ALVOS_SEM_OM = Object.freeze(['USER', 'ORG', 'ATLAS', 'ACCESS_GROUP', 'CONFIG', 'RANK']);

/**
 * Os tipos que o filtro oferece a ESTA audiência.
 *
 * NÃO OFERECE O QUE NUNCA DEVOLVE. Para quem não administra, os de `ALVOS_SEM_OM` são filtros
 * estruturalmente vazios, e um seletor que só produz lista vazia ensina a pessoa a desconfiar
 * da trilha inteira.
 * @param {boolean} administra
 * @returns {string[]}
 */
export function tiposDeAlvoVisiveis(administra) {
    return administra === true
        ? [...TIPOS_DE_ALVO]
        : TIPOS_DE_ALVO.filter((t) => !ALVOS_SEM_OM.includes(t));
}

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
 * O TAMANHO dos dois lados de um campo gravado por impressão, quando a trilha o traz.
 *
 * `bytesDe`/`bytesPara` existem em `backend/src/utils/audit-diff.js` desde que o regime de
 * impressão nasceu, e o comentário lá diz para que servem: responder "encolheu ou cresceu?"
 * sem carregar um byte do valor. Ninguém no cliente os lia, então a única pergunta que a
 * impressão consegue responder além de "mudou?" ficava sem leitor.
 *
 * SÓ SAI COM OS DOIS LADOS NUMÉRICOS. Linha antiga não tem os campos, e inventar zero diria
 * "encolheu para nada" sobre um dado que ninguém mediu.
 * @param {Object} item - Um item de `details.mudou` com `regime: 'impressao'`.
 * @returns {string} Vazio quando a linha não traz a medida.
 */
function fraseDeTamanho(item) {
    const de = item?.bytesDe;
    const para = item?.bytesPara;
    if (!Number.isFinite(de) || !Number.isFinite(para)) return '';
    if (de === para) return `, mesmo tamanho (${para} bytes)`;
    return `, ${para > de ? 'cresceu' : 'encolheu'} de ${de} para ${para} bytes`;
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
 * O ATOR E O ALVO, SEM A AÇÃO: o nome ACESSÍVEL do botão de detalhes de uma linha.
 *
 * `fraseDoEvento` traz a ação embutida, e a linha da tela já carrega um chip com o rótulo
 * dela: usar as duas juntas imprimia "Item de catálogo alterado" DUAS VEZES na mesma
 * linha, uma no chip e outra dentro da frase. Os dois desenhos foram escritos e os dois
 * ficaram. Aqui o chip é o portador da ação e esta função é o portador do resto.
 *
 * DESDE 2026-08-25 A LINHA É UMA `<tr>` COM CÉLULAS, então a separação deixou de ser uma
 * questão de texto e virou estrutura: a ação tem coluna própria e o alvo tem a dele. O que
 * sobrou para esta função é o caso em que a estrutura não ajuda — o botão "Detalhes" de cada
 * linha, que um leitor de tela alcança FORA da linha, numa lista de controles, onde
 * cinquenta botões chamados "Detalhes" são indistinguíveis.
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
 * QUEM A USA NA TELA É O `title` da célula do alvo, não o texto visível: cada pedaço dela já
 * aparece numa coluna, e o que a frase inteira acrescenta é poder copiar o evento em uma
 * linha para dentro de um relatório.
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
 *   - IMPRESSÃO: `Endereço do serviço: alterado (impressão a1b2c3… → d4e5f6…, cresceu de 0
 *     para 61 bytes)`. O texto diz "impressão" por extenso porque o leitor precisa saber que
 *     aquilo NÃO é o valor e não serve para reconstruí-lo — só para comparar com outra linha.
 *     O TAMANHO entra desde 2026-08-25 (ver `fraseDeTamanho`): ele é o único metadado que a
 *     impressão deixa escapar, o servidor o grava desde sempre, e ninguém o lia.
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
                texto: `alterado (impressão ${valorDeImpressao(item?.de)} → ${valorDeImpressao(item?.para)}`
                    + `${fraseDeTamanho(item)})`,
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
    // A palavra IMPRESSÃO é o verbete inteiro: sem ela, doze hexadecimais soltos se leem
    // como um valor, e o valor que esta chave substituiu era o link público literal, que
    // é uma credencial portadora. Um rótulo que não diz que aquilo é impressão convida a
    // tentar usar a string como link, e a tentativa falha em silêncio depois de a pessoa
    // ter tratado a trilha como fonte de acesso.
    publicLinkImpressao: 'Impressão do link público',
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

/**
 * AS LINHAS DE UMA RESPOSTA DA TRILHA. Elas moram em `.data`, e nunca em `.items`.
 *
 * ESTA FUNÇÃO EXISTE POR CAUSA DE UM DEFEITO MEDIDO, e por isso ela é uma função e não uma
 * expressão repetida: `audit-tab.js` lia `resposta.items` num sítio e `resposta.data` no
 * outro. O envelope do servidor é `{ total, page, limit, escopoOrgId, administra, data }`
 * (`backend/src/modules/audit/audit.service.js`), então o sítio do `items` guardava SEMPRE
 * uma lista vazia. O efeito era invisível: a lista desenhava (ela lia `data`), e o que
 * quebrava era o rótulo do filtro de OM, que perdia o nome da OM DESATIVADA e voltava a
 * mostrar o UUID cru — exatamente o estado que dispara investigação.
 *
 * O JSDoc de `apiClient.listAudit` já chamava esse envelope de "o erro de integração mais
 * provável desta rota". Com um leitor só, errar de novo exige errar nos dois sítios de uma
 * vez, e o caso de `auditoria-linhas-da-resposta.test.js` reprova o `items`.
 * @param {Object} resposta - O que `apiClient.listAudit` devolve.
 * @returns {Array<Object>} As linhas, ou vazio. Nunca `undefined`.
 */
export function linhasDaResposta(resposta) {
    return Array.isArray(resposta?.data) ? resposta.data : [];
}

/**
 * O NOME DE UMA OM a partir das linhas que já estão na tela.
 *
 * POR QUE NÃO SAI DE `config.organizacoesMilitares`: aquela lista só traz OM ATIVA, e o caso
 * que este rótulo precisa cobrir é exatamente o oposto — a OM DESATIVADA, que
 * `buildDomainOptions` preserva no seletor de propósito, porque é o estado que dispara
 * investigação. Sem nome, a opção saía como UUID cru seguido de "(atual)".
 *
 * Devolve `undefined` quando não acha, e é o certo: `buildDomainOptions` já cai no id nesse
 * caso, e inventar um nome seria pior que mostrar o id.
 *
 * LÊ A SIGLA E O NOME DIRETO, e NÃO passa por `nomeDaOm`. A diferença é o último degrau
 * daquela função: sem sigla e sem nome, ela devolve o id TRUNCADO em oito caracteres, que é
 * a coisa certa numa célula estreita da lista e a errada aqui — o seletor cairia num pedaço
 * de UUID em vez do UUID inteiro, que é o que `buildDomainOptions` já mostra sozinho. Rótulo
 * pior que o padrão não é rótulo.
 * @param {Array<Object>} linhas - As linhas da página que está na tela.
 * @param {string} orgId
 * @returns {string|undefined}
 */
export function nomeDeOmNasLinhas(linhas, orgId) {
    if (!orgId) return undefined;
    const linha = (Array.isArray(linhas) ? linhas : [])
        .find((l) => String(l?.target_org_id ?? '') === String(orgId));
    const sigla = (linha?.target_org_sigla ?? '').trim();
    const nome = (linha?.target_org_nome ?? '').trim();
    return sigla || nome || undefined;
}

/** @private O início do dia LOCAL de uma data `YYYY-MM-DD`, ou `null`. */
function inicioDoDiaLocal(iso, deslocamentoEmDias = 0) {
    const [a, m, d] = String(iso ?? '').split('-').map(Number);
    if (!a || !m || !d) return null;
    // `new Date(a, m - 1, d + n)` e NÃO uma soma de 86.400.000 ms: a soma erra o dia em
    // qualquer salto de horário de verão, e a trilha é lida por data.
    return new Date(a, m - 1, d + deslocamentoEmDias);
}

/**
 * A JANELA DE TEMPO da consulta, a partir do que a barra de filtros tem escolhido.
 *
 * UM EIXO SÓ, E CADA PONTA VEM DE QUEM A NOMEIA. O atalho ("7 dias") responde "o que andou
 * acontecendo"; a data absoluta responde "o que aconteceu naquele dia". As duas pedem a
 * mesma coisa, então a data absoluta REFINA a ponta que ela nomeia, e a ponta que ela não
 * nomeia continua vindo do atalho.
 *
 * A REGRA MUDOU EM 2026-08-25, E O QUE ELA CONSERTA É UM ALARGAMENTO SILENCIOSO. Até aqui
 * QUALQUER data preenchida descartava o atalho INTEIRO, então preencher só o "Até" com
 * "7 dias" em vigor devolvia `from: undefined`, isto é, a trilha desde o início dos tempos.
 * Não era só feiura: a barra não acendia botão nenhum nesse estado, nem o "Tudo", que era
 * exatamente o recorte em vigor. Quem apertava o eixo de tempo alargava-o, e nada na tela
 * dizia isso. Numa trilha de auditoria, uma janela que ninguém afirma é pior que uma janela
 * feia. Preso por `frontend/tests/unit/auditoria-eixo-de-tempo.test.js`.
 *
 * A BARRA HOJE TORNA O CASO IMPOSSÍVEL por construção (o período é um seletor só, e as duas
 * datas só existem no modo "Datas exatas", em que não há atalho), e mesmo assim a regra fica
 * aqui: esta função é a fonte única da janela, e quem a chamar amanhã não herda o defeito.
 *
 * O `to` ENTROU EM 2026-08-25 e é o que fecha o intervalo. Até aqui a tela só calculava
 * `from`, então não existia jeito de pedir uma janela com fim: toda consulta ia do passado
 * até agora. O schema da rota aceita os dois desde sempre (`audit.schemas.js`).
 *
 * O PERÍODO É MEIO-ABERTO NO SERVIDOR (`>= from`, `< to`), e é por isso que o fim é o começo
 * do dia SEGUINTE ao escolhido: pedir "até 25/08" precisa incluir o dia 25 inteiro, e um
 * `to` no começo do dia 25 devolveria a lista sem ele.
 *
 * @param {{dias?: number|null, de?: string, ate?: string}} escolha - `de`/`ate` em `YYYY-MM-DD`.
 * @param {Date} [agora] - Injetável para o teste; nunca passado pela tela.
 * @returns {{from: (string|undefined), to: (string|undefined)}} Instantes ISO.
 */
export function janelaDoPeriodo({ dias, de, ate } = {}, agora = new Date()) {
    const inicio = inicioDoDiaLocal(de);
    const fim = inicioDoDiaLocal(ate, 1);
    const doAtalho = dias ? new Date(agora.getTime() - dias * 86400000) : null;
    return {
        from: (inicio ?? doAtalho)?.toISOString(),
        to: fim ? fim.toISOString() : undefined,
    };
}

/**
 * AS DUAS DATAS QUE DESENHAM A MESMA JANELA de um atalho, em `YYYY-MM-DD`.
 *
 * ELA EXISTE PARA A TROCA DE MODO SER CONTÍNUA. Quem sai de "Últimos 7 dias" para "Datas
 * exatas" espera continuar vendo a mesma lista, e não uma tela em branco com dois campos
 * vazios: os campos nascem já preenchidos com a janela que estava em vigor, e a pessoa
 * ajusta a ponta que quer. É o que torna as duas formas UM eixo em vez de dois controles
 * que competem.
 *
 * "TUDO" DEVOLVE `de` VAZIO, e é o certo: não há começo para escrever no campo, e inventar
 * um seria afirmar um recorte que não estava em vigor.
 * @param {number|null} dias - O atalho em vigor, em dias. `null` é "tudo".
 * @param {Date} [agora] - Injetável para o teste.
 * @returns {{de: string, ate: string}}
 */
export function datasDoAtalho(dias, agora = new Date()) {
    const local = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        + `-${String(d.getDate()).padStart(2, '0')}`;
    return {
        de: dias ? local(new Date(agora.getTime() - dias * 86400000)) : '',
        ate: local(agora),
    };
}

/**
 * O RODAPÉ DA PAGINAÇÃO, em números e numa frase.
 *
 * ELE DIZ O INTERVALO, e não só a página. "Página 2 de 5" não responde "quantos eventos
 * estou vendo", que é a pergunta de quem pagina uma trilha: "51 a 100 de 213" responde as
 * duas de uma vez e mostra, de graça, quando a última página vem curta.
 *
 * A PÁGINA É PRESA AO INTERVALO VÁLIDO. Um `page` maior que o total de páginas (filtro
 * apertado depois de andar para a página 5) sairia como "página 5 de 1", que se lê como
 * defeito da tela em vez de lista vazia.
 * @param {Object} resposta - O envelope de `apiClient.listAudit`.
 * @param {number} [porPadrao=50] - O limite que a tela pediu, quando a resposta não o diz.
 * @returns {{total:number, limite:number, pagina:number, paginas:number, primeiro:number,
 *   ultimo:number, texto:string}}
 */
export function resumoDaPagina(resposta, porPadrao = 50) {
    const total = Math.max(0, Number(resposta?.total ?? 0) || 0);
    const limite = Number(resposta?.limit ?? porPadrao) || porPadrao;
    const paginas = Math.max(1, Math.ceil(total / limite));
    const pagina = Math.min(Math.max(1, Number(resposta?.page ?? 1) || 1), paginas);
    const primeiro = total === 0 ? 0 : (pagina - 1) * limite + 1;
    const ultimo = Math.min(total, pagina * limite);
    const texto = total === 0
        ? 'Nenhum evento'
        : `${primeiro} a ${ultimo} de ${total} ${total === 1 ? 'evento' : 'eventos'}`
          + ` · página ${pagina} de ${paginas}`;
    return { total, limite, pagina, paginas, primeiro, ultimo, texto };
}

/**
 * O INSTANTE COMPLETO de um evento, para citar num relatório.
 * @param {string|Date} quando
 * @returns {string} Vazio quando não há data legível.
 */
export function instanteCompleto(quando) {
    const d = quando instanceof Date ? quando : new Date(quando);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });
}

/**
 * A TERCEIRA SEÇÃO DA GAVETA: o que a linha carrega e a tela nunca mostrava.
 *
 * QUATRO CAMPOS CHEGAVAM DO SERVIDOR E MORRIAM NO CLIENTE (`id`, `ip`, `user_agent` e o
 * carimbo completo), e outros dois viviam só no atributo `title` (`target_id` e o nome longo
 * da OM). `title` não existe no toque, não existe no teclado e o leitor de tela o anuncia de
 * forma que ninguém controla: dado que só mora ali é dado que metade das pessoas não tem.
 *
 * POR QUE NA GAVETA E NÃO NA LINHA: um endereço de rede e um agente de navegador por linha
 * transformam a lista de volta num log, que é o que esta tela existe para não ser. Na gaveta
 * eles ficam a um clique de quem está investigando UMA linha.
 *
 * SAI COMO CÓDIGO o que é código (id, endereço, agente): a mesma regra de
 * {@link linhasDeDetalhe}, e pelo mesmo motivo — um UUID com cara de frase engana.
 *
 * O CARIMBO SAI DUAS VEZES, de propósito: a forma local é a que se lê, e a gravada (ISO, em
 * UTC) é a que se cita, porque é ela que aparece igual em qualquer máquina.
 * @param {Object} linha - Uma linha de `audit_trail` como a rota a devolve.
 * @returns {Array<{chave: string, texto: string, ehCodigo: boolean}>}
 */
export function linhasTecnicas(linha) {
    const saida = [];
    const local = instanteCompleto(linha?.created_at);
    if (local) {
        saida.push({ chave: 'Instante', texto: local, ehCodigo: false });
        saida.push({ chave: 'Carimbo gravado', texto: String(linha.created_at), ehCodigo: true });
    }
    if (linha?.target_id) {
        saida.push({ chave: 'Identificador do alvo', texto: String(linha.target_id), ehCodigo: true });
    }
    const omNome = (linha?.target_org_nome ?? '').trim();
    if (omNome) {
        saida.push({ chave: 'OM do acervo', texto: omNome, ehCodigo: false });
    } else if (linha?.target_org_id) {
        saida.push({ chave: 'OM do acervo', texto: String(linha.target_org_id), ehCodigo: true });
    }
    const ip = String(linha?.ip ?? '').trim();
    // `ip` é NOT NULL na tabela e vale `system` quando o ato não veio de requisição nenhuma
    // (ver `createAudit`), então a palavra não é um endereço e não sai marcada como código.
    if (ip) saida.push({ chave: 'Origem da requisição', texto: ip, ehCodigo: ip !== 'system' });
    const agente = String(linha?.user_agent ?? '').trim();
    // "DECLARADO" está no rótulo porque é o que ele é: o cabeçalho que o cliente mandou, e
    // qualquer cliente manda o que quiser. Chamá-lo de "navegador" afirmaria uma apuração.
    if (agente) saida.push({ chave: 'Cliente declarado', texto: agente, ehCodigo: true });
    if (linha?.id) {
        saida.push({ chave: 'Identificador da linha', texto: String(linha.id), ehCodigo: true });
    }
    return saida;
}

/**
 * Há algum filtro de conteúdo aplicado?
 *
 * O PERÍODO FICA DE FORA, e não por esquecimento: ele NUNCA está vazio (a tela abre em 7
 * dias, de propósito), então contá-lo faria esta função devolver `true` sempre e o botão
 * "Limpar filtros" apareceria numa tela sem filtro nenhum.
 * @param {Object} filtros - O estado de filtros da aba.
 * @returns {boolean}
 */
export function temFiltroAtivo(filtros) {
    return Object.values(filtros ?? {}).some((v) => String(v ?? '').trim() !== '');
}

/**
 * OS FILTROS DE APURAÇÃO, os que a barra guarda atrás de um recolhimento.
 *
 * O CORTE É POR FREQUÊNCIA DE USO, e não por tipo de dado: período e ação são a consulta do
 * dia a dia, e alvo por id, ator por id e OM do acervo são a apuração de um caso. Os três
 * saem da primeira linha da barra porque uma barra que mostra tudo de uma vez não hierarquiza
 * nada, e a trilha é o assunto da tela, não os filtros dela.
 * @type {ReadonlyArray<string>}
 */
export const FILTROS_DE_APURACAO = Object.freeze(['targetId', 'actorId', 'targetOrgId']);

/**
 * QUANTOS filtros de apuração estão preenchidos.
 *
 * ELA É O QUE IMPEDE O RECOLHIMENTO DE VIRAR FILTRO INVISÍVEL, que é pior que filtro feio:
 * uma lista recortada por um id que ninguém vê lê-se como "não aconteceu". Quem chama usa o
 * número em dois lugares, e os dois importam: o selo no botão do recolhimento, e a decisão
 * de já abri-lo quando há algum.
 * @param {Object} filtros - O estado de filtros da aba.
 * @returns {number}
 */
export function contarFiltrosDeApuracao(filtros) {
    return FILTROS_DE_APURACAO
        .filter((chave) => String(filtros?.[chave] ?? '').trim() !== '')
        .length;
}
