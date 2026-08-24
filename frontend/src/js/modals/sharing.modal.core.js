// Path: js/modals/sharing.modal.core.js

/**
 * @fileoverview Atlas sharing modal.
 *
 * Lets the atlas OWNER manage who can see/edit a project:
 *   - Public link: a toggle that enables/disables an anonymous read link, with a
 *     copy-to-clipboard affordance.
 *   - Members: the list of users the atlas is shared with, each with a permission
 *     select over the GRANTABLE levels (`projects/permission-levels.js`: every rung below
 *     `owner`) and a destructive remove button. Ownership itself moves only through the
 *     "Tornar dono" button, offered to whoever the server resolves as owner of this atlas
 *     ({@link serverTreatsAsAtlasOwner}: the owner, plus the GLOBAL administrator, whom
 *     `requireAtlasPermission` short-circuits to `owner` on every atlas).
 *   - Add people: a debounced user search; picking a result grants 'read' (Leitura) by default
 *     (DEFAULT_GRANT_PERMISSION — "default lowers, never raises"; elevate via the member dropdown).
 *
 * The modal is standalone — it receives an `atlasId` and talks to the backend via
 * `apiClient` (sharing/searchUsers REST routes). The caller decides whether to show
 * it (the backend independently enforces `manage` on every mutation, NOT owner-only — this
 * JSDoc said owner-only until 2026-07-25 and a caller trusting it would hide the button from
 * the co-Gestor, who is exactly who sharing is for). All mutations re-read the canonical
 * sharing config so the UI never drifts from the server.
 *
 * O QUE ESTE ARQUIVO NÃO TEM, e a ausência é o assunto dele: presença ("Vendo agora"),
 * barramento de eventos e motor de sync. Ele é REST mais DOM, e só isso, porque é essa
 * propriedade que o torna carregável em `atlas.html` (o seletor de atlas), que boota SEM
 * `initServices()`. Enquanto a presença morava aqui, este módulo alcançava 188 módulos contra
 * os 48 de `projects/projects-page.js`, e `render()` chamava `getEventBus()`, que LANÇA
 * `Services not initialized` fora do mapa: o peso era a metade menor do problema.
 *
 * A PRESENÇA VOLTA POR INJEÇÃO EXPLÍCITA, nunca por detecção. Quem passa `options.presence`
 * (o mapa, por `modals/sharing.modal.js`) vê o bloco "Vendo agora" e os pontos de online
 * exatamente como antes; quem não passa (o seletor de atlas) simplesmente NÃO tem o bloco, o
 * que é a verdade do produto: não há presença sem sessão de colaboração. Não existe ramo que
 * "tente" o barramento e engula o erro, porque um modal que silenciosamente parasse de reagir
 * a evento nenhum no mapa seria pior que o estado anterior.
 *
 * DOIS MODOS, e o segundo não é o primeiro com os botões apagados. `readOnly: true` abre a tela
 * PARTICIPANTES: outra rota (`GET /atlas/overview`, que pede só uma conta, contra o
 * `GET /atlas/:atlasId/sharing`, que exige `manage`), outro título, e nenhum controle. Ela
 * existe porque a cláusula 5.7 do estatuto do produto diz que todo participante vê quem mais
 * participa e com que nível, e dentro do mapa não havia porta nenhuma para isso. O raciocínio
 * completo, com as três fontes de participantes que foram medidas, está em
 * {@link participantsFromOverview}.
 *
 * Exports {@link SharingModal} e {@link openSharingModal}. O símbolo do MAPA continua sendo
 * `showSharingModal`, em `modals/sharing.modal.js`.
 */

import { ModalBase } from './modal.base.js';
import {
    addScopedDomListener,
    clearScopedListeners,
    trackTimer,
} from '@utils/event-cleanup.js';
import { escapeHtml } from '@utils/html-escape.js';
// `presence-colors.js` tem ZERO imports (cor determinística e iniciais, funções puras), e é
// por isso que ele fica AQUI enquanto o resto da presença fica de fora: o avatar de um membro
// é desenho, não sessão viva. Os três que saíram são `presence-store.js`, `sync-engine.js` e
// `store/services.js`, e os três serviam o mesmo bloco.
import { getPresenceColor, getInitials } from '@js/presence/presence-colors.js';
import { apiClient } from '@store/sync/api-client.js';
import { showError, showSuccess } from '@utils/toast_service.js';
import { sessionContext } from '@store/sync/session-context.js';
// Import DIRETO de `confirm.modal.js`, e NUNCA pelo barril `@modals`: o barril reexporta
// `batch-points.modal.js`, que importa `@store` e `@utils`, e com isso a store inteira volta
// pelo caminho transitivo. Foi a maior das quatro cadeias medidas.
import { showConfirm } from './confirm.modal.js';
// Import DIRETO, e não pelo barrel `@catalog`: `grant-tree.js` tem ZERO imports (é uma
// folha de funções puras) e é essa propriedade que permite reusá-lo daqui sem arrastar o
// catálogo inteiro para dentro do modal de compartilhar atlas. O rótulo da `<option>` é o
// MESMO nos dois eixos porque o problema é o mesmo: desde que a unicidade de nome de grupo
// passou a ser por dono, dois grupos homônimos de gente diferente são estado legal, e uma
// lista que mostre só o nome faz escolher o coletivo errado sem erro nenhum.
// `accessLossClause` vem do mesmo lugar e pela mesma razão: conjugar "perde"/"perdem" com
// uma contagem, e dizer o CONTRÁRIO quando a contagem é zero, é regra que já foi paga uma
// vez do lado do catálogo. Reescrevê-la aqui daria a terceira cópia de uma frase que os
// dois eixos precisam ter igual.
import { accessLossClause, groupOptionLabel, searchFailureNotice } from '@js/catalog/grant-tree.js';
// A DICA DO SELETOR MANDA A PESSOA PARA UMA PORTA, então ela precisa dizer o nome que ESTA
// pessoa vê escrito naquela porta — "Grupos" para uma sessão comum, "Catálogo" para o
// produtor, "Administração" para o administrador. Escrever "Administração" fixo mandaria o
// usuário comum procurar um botão que não existe para ele. `adminAudience` é a definição
// única desse rótulo (módulo folha, zero imports) e é a MESMA que a barra do mapa e o seletor
// de atlas consultam; `frontend/tests/unit/admin-audiencia.test.js` varre o versionamento e
// reprova quem escreve o rótulo sem consultá-la.
import { adminAudience } from '@js/admin/admin-audience.js';
// A ESCADA DE PERMISSÃO POR ATLAS VEM DE UM LUGAR SÓ. Este arquivo mantinha o próprio array de
// quatro níveis e fazia aritmética de posto com `findIndex` sobre ele, o que é uma segunda
// implementação da hierarquia que a arquitetura declara existir uma vez só. Import DIRETO por
// arquivo (não pelo barrel `@js/projects`, que nem existe): o módulo tem ZERO imports de
// propósito, porque `create-atlas.modal.js`, seu vizinho, é importado por `atlas-drive.js`, o
// corpo de `atlas.html`, que boota sem a store.
import {
    getPermissionLabel,
    grantablePermissionOptions,
    isGrantablePermission,
    isKnownPermission,
    permissionRank,
    serverTreatsAsAtlasOwner,
} from '@js/projects/permission-levels.js';

/**
 * A frase de confirmação de "Tornar dono", que descreve o que acontece com QUEM CLICA.
 *
 * NASCEU DE UMA REGRESSÃO DE UM DIA. O botão passou a ser oferecido por
 * {@link serverTreatsAsAtlasOwner}, que responde por DOIS principais (o dono e o
 * administrador GLOBAL, que `requireAtlasPermission` resolve como dono de qualquer atlas),
 * e a frase ao lado continuou a de antes: "Você deixará de ser o dono e passará a Gestor".
 * Para o administrador global ela é falsa palavra por palavra — ele nunca foi dono daquele
 * atlas, não deixa de ser nada e não vira Gestor. Uma tela que descreve um efeito sobre quem
 * clica quando o efeito é sobre um terceiro, num ato que a mesma tela não desfaz, é a forma
 * cara do defeito.
 *
 * BIFURCA PELO MESMO INSUMO DO BOTÃO, `sessionContext.role`, e pelos predicados NOMEADOS da
 * escada, nunca por uma comparação própria: se a frase e o gate lessem coisas diferentes,
 * eles voltariam a divergir na próxima vez que um deles mudasse, que é exatamente o que
 * acabou de acontecer. O discriminador entre os dois é `isKnownPermission`: quem chega como
 * um degrau do SERVIDOR é o dono de fato, e quem chega com o valor que só existe no cliente
 * é o administrador global dobrado para dentro da escada por `toFrontendRole`.
 *
 * O RAMO DO ADMINISTRADOR NÃO AFIRMA QUE ELE NÃO É O DONO, e a omissão é medida:
 * `toFrontendRole` devolve o papel global ANTES de olhar a posse, então um administrador que
 * por acaso seja o dono daquele atlas chega aqui indistinguível de um que não é. As duas
 * coisas que a frase afirma são verdadeiras nos dois casos: a posse passa para o alvo, e o
 * acesso de quem clica não muda, porque vem do papel e não da posse.
 *
 * O RAMO FECHADO (nem dono nem administrador) não é alcançável pela tela, já que o botão nem
 * é desenhado. Ele existe para que a função não INVENTE um efeito quando alguém a chamar de
 * outro lugar: pergunta e cala.
 *
 * Pura, sem I/O e sem DOM.
 * @param {*} role - `sessionContext.role` (um `UserRole`), ou uma `permission` crua.
 * @param {string} nome - O nome de quem recebe a posse, já como a tela o exibe.
 * @returns {string}
 */
export function ownershipTransferWarning(role, nome) {
    const alvo = String(nome ?? '').trim() || 'este membro';
    const pergunta = `Tornar ${alvo} o novo dono do atlas?`;
    if (!serverTreatsAsAtlasOwner(role)) return pergunta;
    if (isKnownPermission(role)) {
        return `${pergunta} Você deixará de ser o dono e passará a Gestor.`;
    }
    return `${pergunta} A posse sai de quem é dono hoje e passa para ${alvo}. `
        + 'Seu acesso a este atlas não muda: ele vem do seu papel de administrador, não da posse.';
}

/**
 * The message to show for a failed sharing mutation: the SERVER's explanation when it sent one,
 * the generic sentence otherwise.
 *
 * These handlers used to `catch { showError('...') }` without binding the error, throwing away
 * exactly the part that says WHY — and the backend distinguishes real cases on these routes
 * (removing the owner answers 404; a co-Gestor demoted mid-operation gets 403 from
 * `requireAtlasPermission('manage')`). Same shape the admin panel and the project drive already
 * use (`error?.message || 'fallback'`), plus one guard they lack: `_request` invents
 * `HTTP <status>` when the response carries no message, and that string is a placeholder for the
 * console, never user copy.
 *
 * Pure — no I/O, no DOM.
 * @param {*} error - The caught error (an ApiError carries the server `message`).
 * @param {string} fallback - Generic pt-BR sentence for when there is nothing better.
 * @returns {string}
 */
export function sharingErrorMessage(error, fallback) {
    const message = typeof error?.message === 'string' ? error.message.trim() : '';
    if (!message) return fallback;
    if (/^HTTP \d{3}$/.test(message)) return fallback;
    return message;
}

/**
 * Reparte o payload de `GET /sharing` na forma que a tela desenha.
 *
 * POR QUE ELE É PURO E EXPORTADO: `_load()` fazia parse e render juntos, então nada da
 * FORMA do payload tinha cobertura em node — e o payload acabou de ganhar um segundo array.
 * Extraí-lo é o que torna a parte verificável desta tela verificável.
 *
 * `groups: []` QUANDO A CHAVE FALTA, e isso é compatibilidade real, não paranoia: o cliente
 * novo pode falar com um servidor que ainda não conhece o eixo de grupo (implantação em duas
 * etapas), e o custo de tratar ausência como lista vazia é uma linha.
 *
 * `shares` é repassado VERBATIM — sem filtrar, sem reordenar. Quem decide quem aparece é o
 * servidor, e reordenar aqui criaria uma segunda ordem que a próxima tela teria de repetir.
 *
 * @param {Object|null} cfg - O corpo de `apiClient.getSharing`.
 * @returns {{isPublic: boolean, publicLink: string|null, owner: Object|null, shares: Array, groups: Array}}
 */
export function partitionSharingConfig(cfg) {
    return {
        isPublic: Boolean(cfg?.isPublic),
        publicLink: cfg?.publicLink ?? null,
        owner: cfg?.owner ?? null,
        shares: Array.isArray(cfg?.shares) ? cfg.shares : [],
        groups: Array.isArray(cfg?.groups) ? cfg.groups : [],
    };
}

/**
 * DE QUEM É ESTE GRUPO, na linha de quem tem acesso ao atlas.
 *
 * É A MITIGAÇÃO (ii) DA DECISÃO DO DONO, e sem ela o eixo de grupo não deveria ter chegado a
 * `manage`: um share coletivo entrega ao DONO daquele grupo o poder de pôr mais gente dentro
 * do atlas — inclusive como co-Gestor — sem passar por quem compartilhou, sem linha nova em
 * `atlas_shares` e sem tocar em gate nenhum. Esta lista é a ÚNICA superfície onde a
 * delegação é visível; enquanto ela mostrasse só o nome do grupo, a parte delegada do
 * mecanismo não apareceria em tela alguma.
 *
 * Espelha `granteeGroupOwnerLabel` (`js/catalog/grant-tree.js`) na frase e no ramo do órfão,
 * e NÃO o importa: aquele arquivo é do eixo de RECURSO e este é do eixo de ATLAS. Mesmo
 * vocabulário, dois eixos — a constituição é explícita em que eles não compartilham palavra.
 *
 * Grupo SEM dono é estado real (o backfill da migração adota `created_by`, que pode ser nulo
 * em linha antiga) e dizê-lo por extenso importa: um grupo órfão não entrega acesso a
 * ninguém, porque a resolução exige dono vivo.
 *
 * @param {{ownerNome?: string, ownerUsername?: string}} group
 * @returns {string} A frase pronta. Nunca vazia: a ausência de dono também é um fato.
 */
export function sharingGroupOwnerLabel(group) {
    const nome = (group?.ownerNome || '').trim();
    const username = (group?.ownerUsername || '').trim();
    if (nome && username) return `Dono: ${nome} (@${username})`;
    if (nome) return `Dono: ${nome}`;
    if (username) return `Dono: @${username}`;
    return 'Sem dono definido';
}

/**
 * Quantas pessoas o grupo carrega, por extenso.
 *
 * O NÚMERO É O TAMANHO DO QUE SE ESTÁ ACEITANDO. "Equipe Alfa" não diz se são três pessoas
 * ou quarenta, e a diferença é a única coisa que separa um convite de uma abertura.
 * @param {{memberCount?: number}} group
 * @returns {string}
 */
export function sharingGroupSizeLabel(group) {
    const n = sharingGroupMemberCount(group);
    if (n === 0) return 'sem membros';
    return `${n} ${n === 1 ? 'pessoa' : 'pessoas'}`;
}

/**
 * O tamanho do grupo como inteiro não negativo.
 *
 * `memberCount` atravessa a rede vindo de um `COUNT` do SQL, e ausente, string, `NaN` e
 * negativo colapsam todos em 0 de propósito: nenhum deles descreve gente perdendo acesso,
 * e todos conjugariam no plural por acidente se fossem adiante como número. É o mesmo
 * colapso de `groupMemberCount` (`js/catalog/grant-tree.js`), no eixo de recurso.
 *
 * Módulo-privado porque a tela nunca mostra o número cru: quem mostra é
 * {@link sharingGroupSizeLabel}, e quem decide o verbo é `accessLossClause`.
 * @param {{memberCount?: *}} group
 * @returns {number}
 */
function sharingGroupMemberCount(group) {
    const n = Number(group?.memberCount);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

/**
 * O QUE O DIÁLOGO DESTRUTIVO DIZ ANTES DE TIRAR UM GRUPO DO ATLAS.
 *
 * A frase anterior era `${sharingGroupSizeLabel(grupo)} perdem o acesso`, e o verbo fixo
 * no plural fazia dois dos três ramos mentirem: "1 pessoa perdem o acesso" e, o caso caro,
 * "sem membros perdem o acesso" — um `destructive: true` afirmando uma perda que não vai
 * acontecer. Quem conjuga agora é `accessLossClause`, do eixo de recurso, onde essa mesma
 * classe já tinha sido paga.
 *
 * O RAMO ZERO DIZ O CONTRÁRIO, não a mesma coisa mais curta: um grupo sem membros não
 * entrega acesso a ninguém, então tirá-lo não tira nada de ninguém, e prometer uma queda
 * impossível gasta a credibilidade da frase alta no caso em que ela É alta (é a mesma
 * escolha de `groupDeletionWarning`, em `js/admin/group-phrases.js`).
 *
 * Pura, e exportada por isso: é a parte desta tela que se verifica em node.
 * @param {{name?: string, memberCount?: *}} group
 * @returns {string}
 */
export function sharingGroupRemovalWarning(group) {
    // `?? 'este grupo'`: a linha some da lista entre o clique e a busca por `groupId` se o
    // servidor for relido no meio, e um diálogo destrutivo sem sujeito é pior que genérico.
    const nome = group?.name ?? 'este grupo';
    const membros = sharingGroupMemberCount(group);
    if (membros === 0) {
        return `Tirar ${nome} deste atlas? Ele não tem membros hoje: ${accessLossClause(0)}.`;
    }
    return `Tirar ${nome} deste atlas? `
        + `${accessLossClause(membros, sharingGroupSizeLabel(group))} que vinha por ele.`;
}

/**
 * Os grupos que ainda PODEM ser oferecidos no seletor: os que o chamador administra menos os
 * que já estão no atlas.
 *
 * O SERVIDOR JÁ RECORTA `listAccessGroups()` POR POSSE (só administrados), então este filtro
 * não é o gate — o gate é `assertCanAdministerGroup`, e ele responde 404. O que este filtro
 * evita é oferecer o que já está lá, que responderia 201 e não mudaria nada.
 * @param {Array<{id?: string}>} administrados
 * @param {Array<{groupId?: string}>} jaNoAtlas
 * @returns {Array}
 */
export function selectableGroups(administrados, jaNoAtlas) {
    const dentro = new Set((jaNoAtlas ?? []).map((g) => String(g?.groupId)));
    return (administrados ?? []).filter((g) => !dentro.has(String(g?.id)));
}

/**
 * A DICA DO SELETOR quando não há grupo nenhum a oferecer, e ela nunca pode ser silêncio: uma
 * seção sem controle nenhum lê como "esta função não existe".
 *
 * SÃO DOIS MOTIVOS DIFERENTES para a mesma ausência, e a frase precisa distingui-los: quem
 * administra grupos e já pôs todos neste atlas não tem nada a fazer, e quem não administra
 * nenhum tem uma ação, criar um.
 *
 * O DESTINO É O RÓTULO CALCULADO, nunca uma palavra fixa: a porta se chama "Administração"
 * para o administrador, "Catálogo" para o produtor e "Acessos" para o resto de quem entrou
 * (`adminAudience`, `js/admin/admin-audience.js`). Escrever o rótulo fixo mandaria três das
 * quatro audiências procurar um botão com outro nome. Sem porta (visitante anônimo, ou de link
 * público) a frase simplesmente não indica destino, em vez de indicar um inexistente.
 *
 * Pura, e exportada por isso: é a parte desta dica que se verifica em node.
 * @param {number} administrados - quantos grupos o chamador administra.
 * @param {string|null} porta - o rótulo de `adminAudience`, ou `null` para quem não abre a página.
 * @returns {string}
 */
export function sharingGroupPickerHint(administrados, porta) {
    const quantos = Number(administrados);
    if (Number.isFinite(quantos) && quantos > 0) {
        return 'Todos os seus grupos já estão neste atlas.';
    }
    const destino = typeof porta === 'string' && porta.trim() ? porta.trim() : null;
    const onde = destino ? ` Crie um em ${destino}.` : '';
    return `Só é possível compartilhar com grupos que você administra.${onde}`;
}

/**
 * As `<option>` do seletor de nível de UMA linha de grupo, já com o que está SELECIONADO e o
 * que está DESABILITADO.
 *
 * O SERVIDOR APLICA DUAS REGRAS DIFERENTES NA MESMA ROTA, e é por isso que esta função
 * existe em vez de um `disabled` no `<select>` inteiro: SUBIR o nível de um grupo exige
 * administrá-lo (responde 404 quando não), REBAIXAR e REMOVER não exigem nada além de
 * `manage` no atlas. Um seletor totalmente aberto oferecia a subida e devolvia um erro
 * cru do servidor sobre um grupo desenhado na tela; um seletor totalmente fechado tiraria
 * do gestor do atlas a única ferramenta NÃO destrutiva que ele tem sobre uma composição
 * alheia. As duas metades erram, e cada uma erra para um lado.
 *
 * NÍVEL DESCONHECIDO NORMALIZA PARA O MENOR (`read`), que é falha fechada: uma linha vinda
 * com `permission` ausente ou fora dos quatro não pode desenhar um `<select>` sem seleção
 * nenhuma (o navegador escolheria a primeira opção e o próximo `change` a enviaria como se
 * fosse intenção do usuário).
 *
 * Pura — sem DOM, sem I/O, sem `sessionContext`: quem responde "eu administro este grupo?"
 * é o chamador, porque a resposta envolve o papel GLOBAL de administrador, que é outro eixo.
 *
 * A ARITMÉTICA DE POSTO É `permissionRank`, e não um `findIndex` sobre uma lista local: a
 * hierarquia por atlas tem UMA implementação neste repositório (`projects/permission-levels.js`),
 * e um índice de array é uma segunda, que diverge no dia em que a escada ganhar um degrau.
 *
 * @param {{permission?: string, ownerId?: string}} group - a linha de grupo do payload.
 * @param {{userId?: string|null, isAdmin?: boolean}} sessao
 * @returns {Array<{value: string, label: string, selected: boolean, disabled: boolean}>}
 */
export function groupLevelOptions(group, sessao = {}) {
    // NÍVEL DESCONHECIDO (ou `owner`, que não é concedível) normaliza para o menor: falha
    // fechada, e evita um `<select>` sem seleção nenhuma.
    const atual = isGrantablePermission(group?.permission) ? group.permission : 'read';
    const posto = permissionRank(atual);
    const administra = podeAdministrarGrupo(group, sessao);
    return PERMISSION_LEVELS.map((p) => ({
        value: p.value,
        label: p.label,
        selected: p.value === atual,
        disabled: !administra && permissionRank(p.value) > posto,
    }));
}

/**
 * "ESTA SESSÃO ADMINISTRA ESTE GRUPO?", DA FORMA OTIMISTA QUE O CLIENTE CONSEGUE RESPONDER.
 *
 * A autoridade é do servidor e mora em `fn_can_administer_group` (função SQL declarada na
 * baseline de acesso a recurso), que exige TRÊS coisas: o grupo vivo, e então ou o papel global
 * de administrador, ou ser dono do grupo E `fn_principal_vivo` desse dono (conta ativa e
 * organização ativa).
 *
 * ESTA CÓPIA OMITE A LIVENESS, e a omissão é declarada em vez de disfarçada: o payload de
 * `GET /sharing` traz `ownerId`, `ownerNome` e `ownerUsername`, e NENHUM campo que diga se
 * aquele principal continua vivo (a consulta que monta a linha de grupo não o seleciona). Não
 * há como espelhar o predicado inteiro daqui; inventar um campo seria pior.
 *
 * A CONSEQUÊNCIA É DE UM LADO SÓ, e é a tolerável: quem tiver a conta ou a OM desativada entre
 * dois carregamentos vê o `<select>` oferecer uma subida que o servidor recusa com 404, e a
 * recusa chega como frase do servidor por `sharingErrorMessage`. O erro na direção contrária
 * (esconder uma ação que o servidor aceitaria) não acontece, porque a condição que falta só
 * pode ESTREITAR a resposta do servidor. Nada aqui é fronteira de segurança.
 *
 * @param {{ownerId?: string}} group
 * @param {{userId?: string|null, isAdmin?: boolean}} sessao - `isAdmin` é o papel GLOBAL.
 * @returns {boolean}
 */
export function podeAdministrarGrupo(group, sessao = {}) {
    if (sessao?.isAdmin === true) return true;
    const dono = group?.ownerId != null && group.ownerId !== '' ? String(group.ownerId) : null;
    // Os dois nulos NÃO se encontram: sessão sem identidade num grupo sem dono não administra.
    if (dono === null || sessao?.userId == null) return false;
    // Comparação por String: o id vem do JSON da rede e pode chegar como número.
    return dono === String(sessao.userId);
}

/** Debounce (ms) for the user-search input. */
const SEARCH_DEBOUNCE_MS = 300;
/** Minimum query length the backend accepts for user search. */
const SEARCH_MIN_CHARS = 2;
/** How long the "Copiado" feedback stays on the copy button. */
const COPY_FEEDBACK_MS = 1800;
/**
 * Default permission granted when a searched user is picked. Deliberately the LOWEST level
 * ('read') — "a permissão padrão abaixa, nunca eleva" (Felt): granting more than view is an
 * explicit, deliberate raise via the member dropdown, never an accident of inviting someone.
 */
const DEFAULT_GRANT_PERMISSION = 'read';
/**
 * Permission levels offered in the member dropdown (pt-BR labels, ascending access).
 *
 * DERIVED from the canonical ladder, never written out here: it used to be a literal array of
 * four `{value, label}` pairs, and an identical one lived in `create-atlas.modal.js` plus two
 * more copies of the same value list in `applyAtlasSharing`. A rung added to the ladder now
 * reaches this dropdown by itself.
 */
const PERMISSION_LEVELS = grantablePermissionOptions();

/**
 * O QUE O SERVIDOR DE FATO APLICA, quando isso é MAIOR que a linha desta pessoa.
 *
 * O acesso ao atlas resolve pelo MAIOR nível entre o compartilhamento nominal e o de grupo
 * (`fn_user_atlas_shares`, no servidor), que é o princípio de caminhos independentes. A
 * consequência mordia aqui: o gestor rebaixava alguém para leitura, o `<select>` passava a
 * exibir "Leitura", e a pessoa continuava editando por um grupo. A tela afirmava um
 * rebaixamento que não aconteceu, que é a forma mais cara de erro de permissão -- o
 * operador tem prova de que fez o certo.
 *
 * O `<select>` continua sendo a LINHA (é ela que ele edita); o selo mostra o EFEITO.
 *
 * NÃO NOMEIA O GRUPO, de propósito: o gestor do atlas vê o dono de cada grupo, nunca a
 * composição (cláusula 5.3 da constituição), e dizer "por causa do grupo X" revelaria que
 * aquela pessoa é membro de X. Para não se enganar, basta ele saber que o rebaixamento não
 * teve efeito.
 *
 * @param {{permission?: string, effectivePermission?: string}} share
 * @returns {{label: string}|null} o rótulo do nível efetivo, ou null quando não há excedente
 */
export function excedenteDeGrupo(share) {
    const linha = share?.permission;
    const efetiva = share?.effectivePermission;
    // Os DOIS precisam ser níveis concedíveis. `owner` não é (não se concede posse por caminho
    // nenhum), e um payload velho chega sem `effectivePermission`: nos dois casos, sem selo.
    if (!isGrantablePermission(linha) || !isGrantablePermission(efetiva)) return null;
    if (permissionRank(efetiva) <= permissionRank(linha)) return null;
    return { label: getPermissionLabel(efetiva) };
}

// ============================================================================
// MODO SOMENTE LEITURA: quem participa e com que nível (cláusula 5.7)
// ============================================================================

/**
 * WHY THIS MODE EXISTS AND WHY IT READS ANOTHER ROUTE.
 *
 * Clause 5.7 of the product statute says every participant sees who else takes part and at
 * which level. The atlas card in `atlas.html` already obeys it; inside the MAP there was no
 * equivalent, and once "Compartilhar" started disappearing for whoever does not manage
 * (2026-08-23), there was no door at all.
 *
 * THE OBVIOUS SOURCE DOES NOT WORK, and it was measured before this was written:
 * `GET /atlas/:atlasId/sharing` is gated on `requireAtlasPermission('manage')` for all four
 * verbs, so a read-only screen calling it answers 403 to exactly the audience it is for. Three
 * candidates were weighed:
 *
 *   - the SYNC SNAPSHOT: it carries `owner_id` and nothing else about people (see
 *     `GET_ATLAS_METADATA` in `backend/src/modules/sync/sync.queries.js`). An id, no name, no
 *     level, no list. Rejected: it cannot answer the question at all.
 *   - PRESENCE (`presence/presence-store.js`): live names, but only of whoever is CONNECTED
 *     right now, and it carries no permission. It answers "quem está aqui", not "quem
 *     participa e com que nível". Rejected as the source; kept as the "Vendo agora" garnish.
 *   - `GET /atlas/overview`: `auth` and nothing more, and since 2026-08-23 it carries
 *     `permission` per member (`LIST_USER_ATLAS_MEMBERS`), which is what feeds the Drive card.
 *     CHOSEN. No server change was needed.
 *
 * THE ONE PRINCIPAL IT CANNOT SERVE is the public-link visitor: their token is confined to
 * their atlas by `confineVisitorPrincipal` (`backend/src/middleware/auth.js`) and this route
 * names no atlas, so it answers 403. That is why the caller
 * (`sidebar/tabs/atlas-actions.js`) never offers this door to an anonymous visitor.
 *
 * TWO PROPERTIES OF THE PAYLOAD THAT THE SCREEN MUST NOT LIE ABOUT:
 *   - the member list is CUT AT TEN by the server's `json_agg` (plus the owner), while
 *     `member_count` is the true total. The difference is stated out loud
 *     ({@link hiddenParticipantsLabel}) instead of being silently dropped, because a list
 *     shorter than the count next to it is a screen contradicting itself.
 *   - it deliberately does NOT say by WHICH DOOR each person came in, and no group appears as
 *     a participant. Naming the door would hand out somebody's membership of a collective that
 *     is not yours. Do not infer origin of access from this object.
 *
 * Pure, and exported so the parsing has a test that does not need a browser.
 * @param {{atlases?: Array}|null|undefined} overview - the `getAtlasOverview()` payload.
 * @param {string} atlasId
 * @returns {{participants: Array<{userId: string, label: string, permission: string,
 *   levelLabel: string}>, total: number, hidden: number}|null} `null` when this atlas has no
 *   row at all, which is a different fact from "nobody else participates".
 */
export function participantsFromOverview(overview, atlasId) {
    const atlases = Array.isArray(overview?.atlases) ? overview.atlases : [];
    const alvo = String(atlasId ?? '');
    if (!alvo) return null;
    const row = atlases.find((a) => a && String(a.id) === alvo) ?? null;
    if (!row) return null;

    const members = Array.isArray(row.members) ? row.members : [];
    const participants = members.map((m) => {
        const permission = typeof m?.permission === 'string' ? m.permission.trim() : '';
        return {
            userId: String(m?.id ?? ''),
            label: participantLabel(m),
            permission,
            levelLabel: getPermissionLabel(permission),
        };
    });
    // A ORDEM É A DA ESCADA, do topo para baixo, com o desconhecido no fim: `permissionRank`
    // devolve -1 para o que não é degrau, então ele cai sozinho para o final. Empate desempata
    // pelo rótulo, para que duas aberturas seguidas desenhem a mesma lista.
    participants.sort((a, b) => {
        const rank = permissionRank(b.permission) - permissionRank(a.permission);
        return rank !== 0 ? rank : a.label.localeCompare(b.label, 'pt-BR');
    });

    const declared = Number(row.member_count);
    const total = Number.isFinite(declared) && declared > 0
        ? Math.trunc(declared)
        : participants.length;
    return { participants, total, hidden: Math.max(0, total - participants.length) };
}

/**
 * How ONE participant is named: rank plus name, because in an Army app "Cap Silva" and
 * "Sd Silva" are two people and a list showing the surname alone does not tell them apart.
 *
 * A DELIBERATE TWIN of `accessPersonLabel` (`projects/atlas-drive.js`), not an import: that
 * file is the body of `atlas.html` and pulls the whole Drive with it, while this module is
 * held to a closed import list by `frontend/tests/unit/compartilhar-sem-a-store.test.js`. The
 * duplication is one short function; the import would be a page.
 *
 * NEVER EMPTY. An entry with no name is still a person with access, and dropping it from the
 * list would shorten the list without lowering the count beside it.
 * @param {{nome?: string, posto_graduacao?: string}} person
 * @returns {string}
 */
function participantLabel(person) {
    const nome = String(person?.nome ?? '').trim();
    const posto = String(person?.posto_graduacao ?? '').trim();
    if (nome && posto) return `${posto} ${nome}`;
    if (nome) return nome;
    return 'Alguém';
}

/**
 * WHY NOTHING HERE CAN BE CHANGED, said out loud.
 *
 * A screen full of names and levels with no control anywhere reads as broken, and the reader's
 * first theory is that the app failed to load the buttons. The sentence names the level that
 * would be needed, so the reader knows what to ask for and whom to ask (the list right below
 * says who holds it).
 *
 * It does NOT say "você não tem permissão" and stop there: a refusal without a remedy is the
 * shape of message this repository has paid for before.
 * @returns {string}
 */
export function readOnlySharingNotice() {
    return 'Você está vendo quem participa deste atlas. Para convidar, remover ou mudar o '
        + 'nível de alguém é preciso ter Gestão neste atlas: peça a quem já a tem na lista abaixo.';
}

/**
 * The sentence for the participants the server did not list.
 *
 * The `json_agg` of `LIST_USER_ATLAS_MEMBERS` cuts at ten, so a busy atlas arrives with a count
 * larger than its list. Saying the remainder is honest; inventing names would not be, and
 * hanging the remainder on the last level would assert a rung nobody measured.
 * @param {number} hidden
 * @returns {string} '' when nothing was cut.
 */
export function hiddenParticipantsLabel(hidden) {
    const n = Number(hidden);
    if (!Number.isFinite(n) || n <= 0) return '';
    return n === 1
        ? 'E mais 1 participante que esta lista não detalha.'
        : `E mais ${Math.trunc(n)} participantes que esta lista não detalha.`;
}

/**
 * Icons used by the modal (inline SVG, currentColor).
 */
const ICONS = {
    share: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>`,
    link: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
    </svg>`,
    copy: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>`,
    check: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"/>
    </svg>`,
    remove: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>`,
    search: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8"/>
        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>`,
    // O ícone do COLETIVO. Ele existe para que a linha de grupo NÃO use o avatar de
    // iniciais coloridas: aquele deriva cor e letras de uma identidade de pessoa, e um
    // coletivo com cara de pessoa é a confusão que a seção separada existe para impedir.
    group: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>`,
};

/**
 * Sharing modal class.
 * @extends ModalBase
 */
export class SharingModal extends ModalBase {
    /**
     * @param {string} atlasId - Atlas to manage sharing for.
     * @param {Object} [options]
     * @param {string} [options.atlasName] - Display name for the header title.
     * @param {SharingPresenceSource|null} [options.presence] - Live-collaboration presence source.
     *   Omiti-la (o default) é um MODO, não uma degradação: sem ela o modal não desenha "Vendo
     *   agora", não desenha ponto de online e não assina evento nenhum. É o modo do seletor de
     *   atlas, onde não há atlas conectado e portanto não há o que mostrar.
     * @param {boolean} [options.readOnly] - Abre no modo PARTICIPANTES: a lista de quem alcança
     *   o atlas e com que nível, sem controle nenhum. Ele não é uma degradação do modo de
     *   gestão, é outra tela: outra rota (`/atlas/overview`, que não exige `manage`), outro
     *   título e nenhum `<select>`, botão de remover, "Tornar dono", seletor de grupo ou toggle
     *   de link público. Ver {@link participantsFromOverview}.
     */
    constructor(atlasId, { atlasName, presence = null, readOnly = false } = {}) {
        const name = atlasName ? String(atlasName) : '';
        const somenteLeitura = readOnly === true;
        super({
            id: 'sharing-modal',
            // O TÍTULO DIZ O MODO. Chamar a tela de "Compartilhar" e não oferecer nada para
            // compartilhar é a leitura de "quebrado" que a nota do corpo existe para desfazer;
            // começar pelo nome certo resolve metade dela antes de qualquer frase.
            title: somenteLeitura
                ? (name ? `Participantes de ${name}` : 'Participantes')
                : (name ? `Compartilhar ${name}` : 'Compartilhar'),
            icon: ICONS.share,
            destroyOnHide: true,
        });

        this._atlasId = atlasId;
        /** @type {boolean} Modo PARTICIPANTES (ver o construtor). */
        this._readOnly = somenteLeitura;
        /** @type {{participants: Array, total: number, hidden: number}|null} */
        this._participants = null;
        /** @type {boolean} */
        this._isPublic = false;
        /** @type {string|null} */
        this._publicLink = null;
        /** @type {Array<{userId:string, username:string, nome:string, permission:string}>} */
        this._shares = [];
        /** @type {Array<{groupId:string, name:string, permission:string, memberCount:number, ownerNome:string|null}>} */
        this._groups = [];
        /** @type {Array<{id:string, name:string, member_count:number}>|null} Grupos que EU administro (lazy). */
        this._myGroups = null;
        /** @type {{userId:string, username:string, nome:string}|null} The atlas owner (badge + transfer). */
        this._owner = null;
        /** @type {boolean} Network-in-flight guard (one mutation at a time). */
        this._busy = false;
        /** @type {number|null} Pending debounced-search timer id. */
        this._searchTimer = null;
        /** @type {number} Monotonic token so out-of-order search responses are dropped. */
        this._searchSeq = 0;
        /** @type {boolean} Whether the sharing config finished loading (gates presence re-renders). */
        this._loaded = false;
        /** @type {Set<string>} userIds online in this atlas (recomputed on each body render). */
        this._onlineIds = new Set();
        /** @type {SharingPresenceSource|null} Injected; null means "this modal has no presence". */
        this._presence = presence ?? null;
        /** @type {(() => void)|null} Undo of the presence subscription, or null when there is none. */
        this._presenceOff = null;
    }

    /**
     * Renders the modal shell and kicks off the initial load.
     * @returns {HTMLElement}
     */
    render() {
        const overlay = super.render();
        this._overlay.dataset.testid = 'sharing-modal';
        this.getContainer().classList.add('sharing-modal-container');

        // O CACHE DE GRUPOS MORRE A CADA ABERTURA, e é aqui que ele morre. `render()` é o
        // ponto de entrada de UMA abertura (`showSharingModal` chama render + show; uma
        // instância reusada via `toggle()` volta por aqui também, porque `destroyOnHide`
        // desmontou o corpo), então zerar aqui é o que torna a releitura uma propriedade e
        // não um acidente de o chamador construir uma instância nova. DENTRO da abertura o
        // cache continua de pé de propósito: ver `_loadMyGroups`.
        this._myGroups = null;

        const body = this.getBody();
        body.innerHTML = this._renderLoading();

        document.body.appendChild(overlay);

        // Fire-and-forget initial fetch (loading state already shown).
        this._load();

        // Live "Vendo agora": refresh on presence membership changes (join/leave/away). Membership
        // changes are infrequent (not per cursor move), so re-rendering the body is cheap. Sem fonte
        // de presença não há assinatura nenhuma — ver `_subscribePresence`.
        this._subscribePresence();

        return overlay;
    }

    /**
     * @private (Re)assina a fonte de presença, quando existe uma.
     *
     * O DESLIGAMENTO É EXPLÍCITO, e não mais o `setupCleanup` do `ModalBase`: a assinatura não passa
     * pelo `subscribe()` de `event-cleanup.js`, porque quem a mantém agora é um objeto injetado, cujo
     * `onChange` devolve o próprio desfazer. Quem chama o desfazer é `hide()`.
     *
     * Desassina ANTES de assinar porque `render()` roda de novo numa instância reusada (`toggle()`
     * sobre um modal com `destroyOnHide`), e duas assinaturas vivas re-renderizariam o corpo duas
     * vezes por evento.
     */
    _subscribePresence() {
        this._unsubscribePresence();
        if (!this._presence) return;
        const off = this._presence.onChange(() => this._onPresenceChanged());
        this._presenceOff = typeof off === 'function' ? off : null;
    }

    /** @private Desfaz a assinatura de presença, quando existe uma. Idempotente. */
    _unsubscribePresence() {
        if (!this._presenceOff) return;
        const off = this._presenceOff;
        this._presenceOff = null;
        off();
    }

    /**
     * @private Re-renders the body when presence membership changes, so "Vendo agora" and the online
     * dots stay live — unless the user is mid-search (don't yank the field out from under them).
     */
    _onPresenceChanged() {
        if (!this._loaded) return;
        const body = this.getBody();
        if (!body) return;
        // Don't re-render out from under an in-progress interaction: a focused search/permission field,
        // or an open results dropdown (the user is mid-pick).
        const active = document.activeElement;
        if (active && body.contains(active) && (active.tagName === 'INPUT' || active.tagName === 'SELECT')) return;
        const results = body.querySelector('[data-results]');
        if (results && !results.hidden) return;
        this._renderBody();
    }

    // ===== DATA =====

    /**
     * @private Fetches the sharing config and (re)renders the body.
     *
     * `destroyOnHide` means Escape (or an overlay click) during the in-flight fetch tears the DOM
     * down and `getBody()` starts returning undefined — so both the success and the failure path
     * bail out when the body is gone. Do NOT guard on `this._isOpen` instead: `_load()` is fired by
     * `render()`, BEFORE `show()`, so `_isOpen` is legitimately false at that moment.
     */
    async _load() {
        if (this._readOnly) return this._loadParticipants();
        try {
            const cfg = await apiClient.getSharing(this._atlasId);
            if (!this.getBody()) return; // modal closed while the request was in flight
            const { isPublic, publicLink, owner, shares, groups } = partitionSharingConfig(cfg);
            this._isPublic = isPublic;
            this._publicLink = publicLink;
            this._owner = owner;
            this._shares = shares;
            this._groups = groups;
            this._loaded = true;
            this._renderBody();
            // Os grupos que EU administro chegam por OUTRA rota, e por isso não bloqueiam o
            // corpo: a lista de quem já tem acesso é o que a pessoa veio ver, e o seletor é o
            // que ela usa depois. Falhar aqui deixa a seção sem seletor, com a dica dizendo
            // por quê, em vez de derrubar a tela inteira.
            this._loadMyGroups();
        } catch {
            if (!this.getBody()) return;
            this._renderError();
        }
    }

    /**
     * @private O `_load()` do modo PARTICIPANTES.
     *
     * NÃO CHAMA `getSharing`, e essa é a decisão inteira: aquela rota exige `manage` nos quatro
     * verbos, então este modo tomaria 403 de exatamente quem ele serve. A fonte é
     * `GET /atlas/overview`, que pede só uma conta e traz o nível por membro. Ver o cabeçalho de
     * {@link participantsFromOverview} para as três fontes medidas e por que as outras duas não
     * servem.
     *
     * A carga é UMA e não repete: aqui não há mutação para re-ler depois.
     * @returns {Promise<void>}
     */
    async _loadParticipants() {
        try {
            const overview = await apiClient.getAtlasOverview();
            if (!this.getBody()) return; // modal closed while the request was in flight
            this._participants = participantsFromOverview(overview, this._atlasId);
            this._loaded = true;
            this._renderBody();
        } catch {
            if (!this.getBody()) return;
            this._renderError();
        }
    }

    /**
     * @private Lê os grupos que o chamador ADMINISTRA, para o seletor.
     *
     * UMA VEZ POR ABERTURA, e não a cada `_load()`, e as duas metades dessa frase são regras
     * separadas: quem garante o "por abertura" é o `this._myGroups = null` de `render()`, sem o
     * qual a releitura dependia de o chamador construir uma instância nova; quem garante o "não
     * a cada `_load()`" é o early-return abaixo. Um grupo criado em outra aba entre duas
     * aberturas aparece; criado no meio de UMA abertura, não, e o preço de buscá-lo seria uma
     * requisição por mutação mais o re-render fora de ordem descrito a seguir.
     *
     * `_load()` roda depois de toda mutação, e
     * esta função re-renderiza o corpo quando termina: refazê-la a cada vez traria um
     * `_renderBody()` fora de ordem, capaz de aterrissar enquanto a pessoa digita na busca de
     * pessoas e arrancar o campo debaixo dela. O que muda entre duas mutações é QUAIS grupos
     * já estão no atlas, e isso vem de `this._groups`, que `selectableGroups` subtrai — não da
     * lista de grupos administrados, que só muda em outra página.
     *
     * `listAccessGroups()` já vem recortada por posse pelo servidor, então não há filtro de
     * autoridade a aplicar aqui. Erro vira lista vazia de propósito: o seletor some e a dica
     * explica, o que é melhor que oferecer opções que o servidor recusaria com 404.
     */
    async _loadMyGroups() {
        if (this._myGroups !== null) return;
        try {
            const grupos = await apiClient.listAccessGroups();
            if (!this.getBody()) return;
            this._myGroups = Array.isArray(grupos) ? grupos : [];
        } catch {
            if (!this.getBody()) return;
            this._myGroups = [];
        }
        if (this._loaded) this._renderBody();
    }

    // ===== RENDER =====

    /** @private */
    _renderLoading() {
        return `
            <div class="sharing__state" data-testid="sharing-loading">
                <span class="sharing__spinner" aria-hidden="true"></span>
                <span>Carregando…</span>
            </div>
        `;
    }

    /** @private Renders the error state (with a retry button) into the body. */
    _renderError() {
        const body = this.getBody();
        if (!body) return; // modal already destroyed — nothing to render into, no state to clear
        clearScopedListeners(this, 'body');
        // A frase nomeia O QUE falhou, e o modo decide qual é: quem abriu "Participantes" e lê
        // "não foi possível carregar o compartilhamento" procura um botão de compartilhar que
        // esta tela nunca teve.
        const oQueFalhou = this._readOnly ? 'os participantes' : 'o compartilhamento';
        body.innerHTML = `
            <div class="sharing__state sharing__state--error" data-testid="sharing-error">
                <p>Não foi possível carregar ${oQueFalhou}.</p>
                <button type="button" class="prompt-modal-btn prompt-modal-btn-confirm" data-action="retry">
                    Tentar novamente
                </button>
            </div>
        `;
        const retry = body.querySelector('[data-action="retry"]');
        if (retry) {
            addScopedDomListener(this, 'body', retry, 'click', () => {
                if (!this.getBody()) return;
                body.innerHTML = this._renderLoading();
                this._load();
            });
        }
    }

    /** @private Renders the full body (public + presence + members + add) and wires listeners. */
    _renderBody() {
        const body = this.getBody();
        if (!body) return; // modal already destroyed — nothing to render into, no state to clear
        clearScopedListeners(this, 'body');
        this._onlineIds = this._computeOnlineIds();
        if (this._readOnly) {
            // SEM `_setupBodyListeners()`: o modo participantes não desenha controle nenhum, e
            // chamá-lo aqui deixaria uma fiação procurando seletores que não existem, pronta
            // para ligar-se ao primeiro controle que alguém acrescentasse por engano.
            body.innerHTML = this._renderReadOnlyBody();
            return;
        }
        body.innerHTML = `
            <div class="sharing">
                ${this._renderPublicSection()}
                ${this._renderPresenceSection()}
                ${this._renderMembersSection()}
                ${this._renderGroupsSection()}
                ${this._renderAddSection()}
            </div>
        `;
        this._setupBodyListeners();
    }

    /**
     * @private O corpo do modo PARTICIPANTES.
     *
     * O QUE ELE NÃO TEM, e a lista é o contrato desta tela: nenhum `<select>` de nível, nenhum
     * botão de remover, nenhum "Tornar dono", nenhum seletor de grupo e nenhum toggle de link
     * público. Ele mostra, e a nota do topo DIZ que só mostra.
     *
     * "Vendo agora" fica, porque presença é desenho e não autoridade: o Leitor já vê o mesmo
     * grupo de avatares no mapa. Ela vem antes da lista de propósito (quem está aqui agora é o
     * dado perecível).
     *
     * NENHUM GRUPO APARECE COMO PARTICIPANTE, e isso não é omissão: a cláusula 5.7 reserva o
     * CAMINHO de acesso, e nomear o coletivo entregaria adesão de terceiro.
     * @returns {string}
     */
    _renderReadOnlyBody() {
        const dados = this._participants;
        const linhas = dados?.participants?.length
            ? dados.participants.map((p) => this._renderParticipantItem(p)).join('')
            : `<div class="sharing__empty" data-testid="sharing-participants-empty">
                   Não foi possível listar os participantes deste atlas.
               </div>`;
        const excedente = hiddenParticipantsLabel(dados?.hidden ?? 0);
        const rodape = excedente
            ? `<p class="sharing-readonly__overflow" data-testid="sharing-participants-overflow">${escapeHtml(excedente)}</p>`
            : '';

        return `
            <div class="sharing sharing--readonly">
                <p class="sharing-readonly__note" data-testid="sharing-readonly-note">
                    ${escapeHtml(readOnlySharingNotice())}
                </p>
                ${this._renderPresenceSection()}
                <section class="sharing-section" data-testid="sharing-participants">
                    <h3 class="sharing-section__title">Participantes</h3>
                    <div class="sharing-members">${linhas}</div>
                    ${rodape}
                </section>
            </div>
        `;
    }

    /**
     * @private Uma linha de participante: avatar, nome com posto, e o nível como TEXTO.
     *
     * O nível é um selo e nunca um `<select>` desabilitado: um controle apagado ainda parece um
     * controle, e convida ao clique que não faz nada.
     * @param {{userId: string, label: string, levelLabel: string}} participant
     * @returns {string}
     */
    _renderParticipantItem(participant) {
        const userId = String(participant?.userId ?? '');
        const nome = participant?.label ?? '';
        const nivel = participant?.levelLabel ?? '';
        const selo = nivel
            ? `<span class="sharing-member__level" data-testid="sharing-participant-level"
                     title="Nível de ${escapeHtml(nome)} neste atlas">${escapeHtml(nivel)}</span>`
            : '';
        return `
            <div class="sharing-member" data-testid="sharing-participant-item" data-user-id="${escapeHtml(userId)}">
                ${this._avatar(userId, nome, { online: this._onlineIds?.has(userId) })}
                <div class="sharing-member__info">
                    <span class="sharing-member__name">${escapeHtml(nome)}</span>
                </div>
                ${selo}
            </div>
        `;
    }

    /**
     * @private Users currently connected to THIS atlas, EXCLUDING self — vazio quando não há fonte de
     * presença, e vazio quando o atlas conectado é outro (presence is per-connected-atlas; sharing can
     * be opened for others). Single source of truth for both "Vendo agora" and the per-member online
     * dots. Quem filtra por atlas, por `away` e por "eu" é a FONTE ({@link SharingPresenceSource}),
     * porque as duas perguntas que isso exige ("qual atlas está conectado?" e "quem sou eu?")
     * pertencem à sessão viva, não a esta tela.
     * @returns {Array<Object>}
     */
    _onlineUsers() {
        if (!this._presence) return [];
        const users = this._presence.usersIn(this._atlasId);
        return Array.isArray(users) ? users : [];
    }

    /** @private Set of online userIds (drives the per-member online dot). @returns {Set<string>} */
    _computeOnlineIds() {
        return new Set(this._onlineUsers().map((u) => String(u.userId)));
    }

    /**
     * @private "Vendo agora" — avatars of the OTHER users currently connected to this atlas. Live via
     * the PRESENCE_CHANGED subscription; hidden when nobody else is connected.
     */
    _renderPresenceSection() {
        const users = this._onlineUsers();
        if (!users.length) return '';
        const avatars = users
            .map((u) => this._avatar(u.userId ?? u.clientId, u.userName ?? 'Usuário', {
                online: true,
                title: u.userName ?? 'Usuário',
            }))
            .join('');
        return `
            <section class="sharing-section sharing-presence" data-testid="sharing-presence">
                <h3 class="sharing-section__title">Vendo agora</h3>
                <div class="sharing-presence__avatars">${avatars}</div>
            </section>
        `;
    }

    /**
     * @private The one place that builds a presence-colored initials avatar (was copy-pasted across the
     * owner/member/presence rows). The inline background-color is a runtime-computed value (allowed).
     * @param {string} userId - identity for the deterministic color.
     * @param {string} name - display name for the initials.
     * @param {{online?: boolean, title?: string|null}} [opts]
     */
    _avatar(userId, name, { online = false, title = null } = {}) {
        const color = escapeHtml(getPresenceColor(userId));
        const initials = escapeHtml(getInitials(name));
        const onlineCls = online ? ' sharing-avatar--online' : '';
        const attr = title ? `title="${escapeHtml(title)}"` : 'aria-hidden="true"';
        return `<span class="sharing-avatar${onlineCls}" ${attr} style="background-color: ${color};">${initials}</span>`;
    }

    /** @private */
    _renderPublicSection() {
        const linkRow = this._isPublic
            ? `
                <div class="sharing-link" data-testid="sharing-public-link-row">
                    <span class="sharing-link__icon" aria-hidden="true">${ICONS.link}</span>
                    <input type="text" class="sharing-link__input" data-testid="sharing-public-link"
                           value="${escapeHtml(this._publicLink ?? '')}" readonly aria-label="Link público">
                    <button type="button" class="prompt-modal-btn prompt-modal-btn-confirm sharing-link__copy"
                            data-action="copy" data-testid="sharing-copy-link">
                        ${ICONS.copy}<span>Copiar</span>
                    </button>
                </div>
            `
            : '';

        return `
            <section class="sharing-section">
                <div class="settings-field">
                    <div class="sharing-toggle-row">
                        <div class="sharing-toggle-row__text">
                            <span class="settings-field__label">Link público</span>
                            <span class="settings-field__description">
                                Qualquer pessoa com o link pode visualizar este atlas, sem precisar entrar.
                            </span>
                        </div>
                        <button type="button" role="switch"
                                class="sharing-switch${this._isPublic ? ' sharing-switch--on' : ''}"
                                aria-checked="${this._isPublic ? 'true' : 'false'}"
                                aria-label="Ativar link público"
                                data-action="toggle-public" data-testid="sharing-public-toggle">
                            <span class="sharing-switch__thumb" aria-hidden="true"></span>
                        </button>
                    </div>
                    ${linkRow}
                </div>
            </section>
        `;
    }

    /** @private */
    _renderMembersSection() {
        const ownerRow = this._owner ? this._renderOwnerItem(this._owner) : '';
        const shareRows = this._shares.length
            ? this._shares.map((s) => this._renderMemberItem(s)).join('')
            : (this._owner ? '' : this._renderEmptyMembers());
        return `
            <section class="sharing-section">
                <h3 class="sharing-section__title">Membros</h3>
                <div class="sharing-members">
                    ${ownerRow}
                    ${shareRows}
                </div>
            </section>
        `;
    }

    /**
     * @private Renders the atlas owner row (read-only — a "(dono)" badge, no controls).
     * @param {{userId:string, username:string, nome:string}} owner
     */
    /**
     * O sufixo "(você)" da linha de uma pessoa, quando ela é quem está olhando.
     *
     * POR QUE ELE FALTAVA E POR QUE IMPORTA. Nenhum dos três renderizadores desta lista comparava
     * a linha com `sessionContext.userId`, então numa lista de participantes com nomes parecidos
     * (e numa base militar eles são parecidos: mesmo posto, sobrenomes repetidos) a pessoa não
     * distinguia a própria linha. O caso que dói é o do ADMINISTRADOR, que enxerga atlas alheio e
     * pode aparecer ali como membro comum: ele estava prestes a rebaixar o próprio acesso sem
     * saber que era o dele.
     *
     * UM helper para os três, e não a comparação repetida em cada um: três cópias da mesma
     * pergunta divergem, e é assim que um deles fica sem a marca.
     * @private
     * @param {string} userId
     * @returns {string} O sufixo já escapado, ou string vazia.
     */
    _marcaDeSiMesmo(userId) {
        const eu = sessionContext.userId;
        if (!eu || !userId || String(eu) !== String(userId)) return '';
        return ' <span class="sharing-member__self" data-testid="sharing-member-self">(você)</span>';
    }

    _renderOwnerItem(owner) {
        const userId = String(owner?.userId ?? '');
        const nome = owner?.nome ?? owner?.username ?? '';
        const username = owner?.username ?? '';
        return `
            <div class="sharing-member" data-testid="sharing-owner-item">
                ${this._avatar(userId, nome, { online: this._onlineIds?.has(userId) })}
                <div class="sharing-member__info">
                    <span class="sharing-member__name">${escapeHtml(nome)}${this._marcaDeSiMesmo(userId)}</span>
                    <span class="sharing-member__username">@${escapeHtml(username)}</span>
                </div>
                <span class="sharing-member__owner-badge">Gestor (dono)</span>
            </div>
        `;
    }

    /** @private */
    _renderEmptyMembers() {
        return `
            <div class="sharing__empty" data-testid="sharing-empty">
                Ninguém ainda
            </div>
        `;
    }

    /**
     * @private
     * @param {{userId:string, username:string, nome:string, permission:string}} share
     */
    _renderMemberItem(share) {
        const userId = String(share?.userId ?? '');
        const nome = share?.nome ?? share?.username ?? '';
        const username = share?.username ?? '';
        const current = isGrantablePermission(share?.permission) ? share.permission : 'read';
        const excedente = excedenteDeGrupo(share);
        const options = PERMISSION_LEVELS.map((p) =>
            `<option value="${p.value}"${current === p.value ? ' selected' : ''}>${p.label}</option>`
        ).join('');
        // Quem pode passar a posse adiante é quem o SERVIDOR trata como dono deste atlas, e são
        // dois casos, não um: o dono e o administrador GLOBAL, que `toFrontendRole` dobra para
        // dentro da mesma escada. `POST /atlas/:atlasId/transfer` é gateado em
        // `requireAtlasPermission('owner')`, e aquele middleware resolve o administrador global
        // como `owner` em qualquer atlas — ou seja, a rota já aceitava a transferência que esta
        // tela não oferecia. O predicado é NOMEADO e mora em `permission-levels.js` de propósito:
        // `account.control.js` respondia a mesma pergunta com uma lista fechada própria, e duas
        // listas fechadas para um gate só é como elas divergem.
        const transferBtn = serverTreatsAsAtlasOwner(sessionContext.role)
            ? `<button type="button" class="sharing-member__transfer" data-action="transfer"
                        data-testid="sharing-member-transfer" aria-label="Tornar ${escapeHtml(nome)} o dono">Tornar dono</button>`
            : '';

        return `
            <div class="sharing-member" data-testid="sharing-member-item" data-user-id="${escapeHtml(userId)}">
                ${this._avatar(userId, nome, { online: this._onlineIds?.has(userId) })}
                <div class="sharing-member__info">
                    <span class="sharing-member__name">${escapeHtml(nome)}${this._marcaDeSiMesmo(userId)}</span>
                    <span class="sharing-member__username">@${escapeHtml(username)}</span>
                    ${excedente
        ? `<span class="sharing-member__efetiva" data-testid="sharing-member-efetiva"
                             title="Um grupo deste atlas dá a esta pessoa ${escapeHtml(excedente.label)}. Mudar a permissão ao lado não retira o que vem pelo grupo.">
                            ${escapeHtml(excedente.label)} por grupo
                       </span>`
        : ''}
                </div>
                ${transferBtn}
                <select class="sharing-member__permission" data-action="permission"
                        data-testid="sharing-member-permission" aria-label="Permissão de ${escapeHtml(nome)}">
                    ${options}
                </select>
                <button type="button" class="sharing-member__remove" data-action="remove"
                        data-testid="sharing-member-remove" aria-label="Remover ${escapeHtml(nome)}">
                    ${ICONS.remove}
                </button>
            </div>
        `;
    }

    /**
     * @private A seção "Grupos": quem alcança este atlas por COLETIVO, e o seletor para
     * acrescentar um.
     *
     * Ela fica ENTRE "Membros" e "Adicionar pessoas" porque é a mesma pergunta que "Membros"
     * responde (quem alcança o atlas) por outro caminho — separá-la do bloco de adicionar
     * pessoas é o que impede a leitura de que grupo é um tipo de pessoa.
     */
    _renderGroupsSection() {
        const linhas = this._groups.length
            ? this._groups.map((g) => this._renderGroupItem(g)).join('')
            : `<div class="sharing__empty" data-testid="sharing-groups-empty">Nenhum grupo</div>`;
        return `
            <section class="sharing-section" data-testid="sharing-groups">
                <h3 class="sharing-section__title">Grupos</h3>
                <div class="sharing-members">${linhas}</div>
                ${this._renderGroupPicker()}
            </section>
        `;
    }

    /**
     * @private Uma linha de grupo.
     *
     * O AVATAR É UM ÍCONE, NUNCA `getPresenceColor`/`getInitials`: aqueles derivam cor e
     * iniciais de uma IDENTIDADE DE PESSOA, e um coletivo com cara de pessoa é exatamente a
     * confusão que a seção separada existe para impedir.
     *
     * NÃO HÁ "Tornar dono" aqui, e a ausência é regra: posse é nominal por construção
     * (`atlas.owner_id` é uma coluna), e o servidor recusa transferir para quem só alcança o
     * atlas por grupo.
     *
     * O `<select>` NÃO OFERECE O QUE O SERVIDOR RECUSA: as opções ACIMA do nível vigente
     * ficam desabilitadas quando o chamador não administra o grupo, porque subir exige posse
     * e as outras três ações não (ver `groupLevelOptions`).
     *
     * A META LEVA `title` COM O TEXTO INTEIRO porque `.sharing-group__meta` a corta com
     * reticências (`css/sharing.css`), e o que fica de fora é justamente o nome do dono, que
     * é a mitigação da delegação. Alargar o modal para caber o nome mais longo possível
     * resolveria um caso e quebraria o layout; o `title` é o padrão da casa para isto (mesmo
     * par de `.catalog-layer-name` em `js/features_tab/catalog-layers.component.js`).
     * @param {{groupId:string, name:string, permission:string, memberCount:number}} group
     */
    _renderGroupItem(group) {
        const groupId = String(group?.groupId ?? '');
        const nome = group?.name ?? 'Grupo';
        const options = groupLevelOptions(group, {
            userId: sessionContext.userId,
            isAdmin: sessionContext.isAdmin(),
        }).map((p) =>
            `<option value="${p.value}"${p.selected ? ' selected' : ''}${p.disabled ? ' disabled' : ''}>${p.label}</option>`
        ).join('');
        const meta = `${sharingGroupSizeLabel(group)} · ${sharingGroupOwnerLabel(group)}`;

        return `
            <div class="sharing-member sharing-group" data-testid="sharing-group-item" data-group-id="${escapeHtml(groupId)}">
                <span class="sharing-group__icon" aria-hidden="true">${ICONS.group}</span>
                <div class="sharing-member__info">
                    <span class="sharing-member__name">${escapeHtml(nome)}</span>
                    <span class="sharing-group__meta" data-testid="sharing-group-owner"
                          title="${escapeHtml(meta)}">${escapeHtml(meta)}</span>
                </div>
                <select class="sharing-member__permission" data-action="group-permission"
                        data-testid="sharing-group-permission" aria-label="Permissão do grupo ${escapeHtml(nome)}">
                    ${options}
                </select>
                <button type="button" class="sharing-member__remove" data-action="group-remove"
                        data-testid="sharing-group-remove" aria-label="Remover o grupo ${escapeHtml(nome)}">
                    ${ICONS.remove}
                </button>
            </div>
        `;
    }

    /**
     * @private O seletor de grupo, e a dica que ele carrega quando não há o que oferecer.
     *
     * A DICA NÃO PODE SER SILÊNCIO. Só se compartilha com grupo PRÓPRIO, e quem não tem
     * nenhum veria uma seção sem controle nenhum e concluiria que a função não existe. A
     * frase diz a regra E onde criar um, que é a única ação que destrava a tela.
     */
    _renderGroupPicker() {
        if (this._myGroups === null) {
            return `<p class="sharing-group__hint" data-testid="sharing-group-hint">Carregando seus grupos…</p>`;
        }
        const disponiveis = selectableGroups(this._myGroups, this._groups);
        if (!disponiveis.length) {
            const { label: porta } = adminAudience({
                isAuthenticated: sessionContext.isAuthenticated(),
                isAdmin: sessionContext.isAdmin(),
                isProducer: sessionContext.isProducer(),
            });
            const frase = sharingGroupPickerHint(this._myGroups.length, porta);
            return `<p class="sharing-group__hint" data-testid="sharing-group-hint">${escapeHtml(frase)}</p>`;
        }
        const options = disponiveis.map((g) =>
            `<option value="${escapeHtml(String(g?.id ?? ''))}">${escapeHtml(groupOptionLabel(g, sessionContext.userId))}</option>`
        ).join('');
        return `
            <div class="sharing-group__add">
                <select class="sharing-group__select" data-action="group-pick"
                        data-testid="sharing-group-select" aria-label="Escolher um grupo">
                    <option value="">Adicionar um grupo…</option>
                    ${options}
                </select>
            </div>
            <p class="sharing-group__hint" data-testid="sharing-group-hint">
                Só aparecem aqui os grupos que você administra.
            </p>
        `;
    }

    /** @private */
    _renderAddSection() {
        return `
            <section class="sharing-section">
                <h3 class="sharing-section__title">Adicionar pessoas</h3>
                <div class="sharing-search">
                    <span class="sharing-search__icon" aria-hidden="true">${ICONS.search}</span>
                    <input type="text" class="sharing-search__input" data-action="search"
                           data-testid="sharing-user-search" placeholder="Buscar por nome, usuário ou posto…"
                           autocomplete="off" aria-label="Buscar pessoas">
                </div>
                <div class="sharing-results" data-results hidden></div>
            </section>
        `;
    }

    /**
     * @private
     * @param {Array<{id:string, username:string, nome:string, posto_graduacao?:string, organizacao_militar?:string}>} results
     */
    _renderResults(results) {
        const memberIds = new Set(this._shares.map((s) => String(s.userId)));
        const pickable = results.filter((u) => !memberIds.has(String(u?.id)));

        if (!results.length) {
            return '<div class="sharing-results__empty">Nenhum usuário encontrado</div>';
        }
        if (!pickable.length) {
            return '<div class="sharing-results__empty">Todos já são membros</div>';
        }

        return pickable.map((u) => {
            const id = String(u?.id ?? '');
            const nome = u?.nome ?? u?.username ?? '';
            const username = u?.username ?? '';
            const color = escapeHtml(getPresenceColor(id));
            const initials = escapeHtml(getInitials(nome));
            // Posto/Graduação · Organização Militar — helps disambiguate homonyms.
            const meta = [u?.posto_graduacao, u?.organizacao_militar].filter(Boolean).join(' · ');
            const metaRow = meta
                ? `<span class="sharing-result__meta">${escapeHtml(meta)}</span>`
                : '';
            return `
                <button type="button" class="sharing-result" data-action="add"
                        data-testid="sharing-search-result" data-user-id="${escapeHtml(id)}">
                    <span class="sharing-avatar" aria-hidden="true" style="background-color: ${color};">${initials}</span>
                    <span class="sharing-result__info">
                        <span class="sharing-member__name">${escapeHtml(nome)}</span>
                        <span class="sharing-member__username">@${escapeHtml(username)}</span>
                        ${metaRow}
                    </span>
                </button>
            `;
        }).join('');
    }

    // ===== LISTENERS =====

    /** @private Wires the (re-rendered) body's controls via the clearable 'body' scope. */
    _setupBodyListeners() {
        const body = this.getBody();

        const toggle = body.querySelector('[data-action="toggle-public"]');
        if (toggle) {
            addScopedDomListener(this, 'body', toggle, 'click', () => this._handleTogglePublic());
        }

        const copy = body.querySelector('[data-action="copy"]');
        if (copy) {
            addScopedDomListener(this, 'body', copy, 'click', () => this._handleCopyLink(copy));
        }

        body.querySelectorAll('.sharing-member').forEach((row) => {
            const userId = row.dataset.userId;
            const select = row.querySelector('[data-action="permission"]');
            if (select) {
                addScopedDomListener(this, 'body', select, 'change', () =>
                    this._handleChangePermission(userId, select.value));
            }
            const remove = row.querySelector('[data-action="remove"]');
            if (remove) {
                addScopedDomListener(this, 'body', remove, 'click', () =>
                    this._handleRemove(userId));
            }
            const transfer = row.querySelector('[data-action="transfer"]');
            if (transfer) {
                const nome = row.querySelector('.sharing-member__name')?.textContent ?? '';
                addScopedDomListener(this, 'body', transfer, 'click', () =>
                    this._handleTransfer(userId, nome));
            }
        });

        body.querySelectorAll('.sharing-group[data-group-id]').forEach((row) => {
            const groupId = row.dataset.groupId;
            const select = row.querySelector('[data-action="group-permission"]');
            if (select) {
                addScopedDomListener(this, 'body', select, 'change', () =>
                    this._handleChangeGroupPermission(groupId, select.value));
            }
            const remove = row.querySelector('[data-action="group-remove"]');
            if (remove) {
                addScopedDomListener(this, 'body', remove, 'click', () => this._handleRemoveGroup(groupId));
            }
        });

        const groupPick = body.querySelector('[data-action="group-pick"]');
        if (groupPick) {
            addScopedDomListener(this, 'body', groupPick, 'change', () =>
                this._handleAddGroup(groupPick.value));
        }

        const searchInput = body.querySelector('[data-action="search"]');
        if (searchInput) {
            addScopedDomListener(this, 'body', searchInput, 'input', () =>
                this._handleSearchInput(searchInput.value));
        }
    }

    // ===== HANDLERS =====

    /** @private Enables/disables public sharing, then re-reads the config. */
    async _handleTogglePublic() {
        if (this._busy) return;
        this._busy = true;
        const next = !this._isPublic;
        try {
            if (next) {
                await apiClient.enablePublicSharing(this._atlasId);
            } else {
                await apiClient.disablePublicSharing(this._atlasId);
            }
            await this._load();
        } catch (error) {
            showError(sharingErrorMessage(error, 'Não foi possível atualizar o link público.'));
        } finally {
            this._busy = false;
        }
    }

    /**
     * @private Copies the public link to the clipboard with inline feedback.
     * @param {HTMLElement} btn - The copy button (for the transient label swap).
     */
    async _handleCopyLink(btn) {
        const link = this._publicLink;
        if (!link) return;
        try {
            await navigator.clipboard.writeText(link);
            this._flashCopied(btn);
        } catch {
            showError('Não foi possível copiar o link.');
        }
    }

    /**
     * @private Briefly shows a "Copiado" confirmation on the copy button.
     * @param {HTMLElement} btn
     */
    _flashCopied(btn) {
        btn.classList.add('copied');
        btn.innerHTML = `${ICONS.check}<span>Copiado</span>`;
        const timer = setTimeout(() => {
            if (!btn.isConnected) return;
            btn.classList.remove('copied');
            btn.innerHTML = `${ICONS.copy}<span>Copiar</span>`;
        }, COPY_FEEDBACK_MS);
        trackTimer(this, timer, 'timeout');
    }

    /**
     * @private Updates a member's permission, then re-reads the config.
     * @param {string} userId
     * @param {'read'|'write'} permission
     */
    async _handleChangePermission(userId, permission) {
        if (this._busy || !userId) return;
        this._busy = true;
        try {
            await apiClient.updateShare(this._atlasId, userId, permission);
            await this._load();
        } catch (error) {
            showError(sharingErrorMessage(error, 'Não foi possível alterar a permissão.'));
            await this._load(); // resync the select to the server's truth
        } finally {
            this._busy = false;
        }
    }

    /**
     * @private Revokes a member's access, then re-reads the config.
     * @param {string} userId
     */
    async _handleRemove(userId) {
        if (this._busy || !userId) return;
        this._busy = true;
        try {
            await apiClient.removeShare(this._atlasId, userId);
            await this._load();
        } catch (error) {
            showError(sharingErrorMessage(error, 'Não foi possível remover o membro.'));
        } finally {
            this._busy = false;
        }
    }

    /**
     * @private Compartilha o atlas com um grupo PRÓPRIO, escolhido no seletor.
     *
     * O nível inicial é o mesmo `DEFAULT_GRANT_PERMISSION` das pessoas ("a permissão padrão
     * abaixa, nunca eleva"), e vale mais aqui do que lá: um grupo entra com N pessoas de uma
     * vez, então errar para cima erra N vezes.
     * @param {string} groupId
     */
    async _handleAddGroup(groupId) {
        if (this._busy || !groupId) return;
        this._busy = true;
        try {
            await apiClient.addAtlasGroupShare(this._atlasId, groupId, DEFAULT_GRANT_PERMISSION);
            await this._load();
        } catch (error) {
            // O 404 do servidor ("Access group not found") é a recusa por POSSE, e ele chega
            // aqui como frase do servidor por `sharingErrorMessage`. Não a traduza para
            // "grupo inexistente": a mensagem do servidor é deliberadamente indistinguível
            // entre "não existe" e "não é seu".
            showError(sharingErrorMessage(error, 'Não foi possível adicionar o grupo.'));
            await this._load();
        } finally {
            this._busy = false;
        }
    }

    /**
     * @private Troca o nível de um grupo já compartilhado.
     * @param {string} groupId
     * @param {'read'|'comment'|'write'|'manage'} permission
     */
    async _handleChangeGroupPermission(groupId, permission) {
        if (this._busy || !groupId) return;
        this._busy = true;
        try {
            await apiClient.updateAtlasGroupShare(this._atlasId, groupId, permission);
            await this._load();
        } catch (error) {
            showError(sharingErrorMessage(error, 'Não foi possível alterar a permissão do grupo.'));
            await this._load(); // resync do select com a verdade do servidor
        } finally {
            this._busy = false;
        }
    }

    /**
     * @private Tira um grupo do atlas.
     *
     * PEDE CONFIRMAÇÃO, ao contrário da remoção de uma pessoa, e a assimetria é de ALCANCE:
     * tirar um grupo tira N acessos de uma vez, e o botão fica a um clique de distância numa
     * lista onde as linhas se parecem.
     * @param {string} groupId
     */
    async _handleRemoveGroup(groupId) {
        if (this._busy || !groupId) return;
        const grupo = this._groups.find((g) => String(g.groupId) === String(groupId));
        const ok = await showConfirm(
            sharingGroupRemovalWarning(grupo),
            { destructive: true, confirmText: 'Remover' }
        );
        if (!ok) return;
        this._busy = true;
        try {
            await apiClient.removeAtlasGroupShare(this._atlasId, groupId);
            await this._load();
        } catch (error) {
            showError(sharingErrorMessage(error, 'Não foi possível remover o grupo.'));
        } finally {
            this._busy = false;
        }
    }

    /**
     * @private Transfers ownership to a member. Offered to whoever the server resolves as owner
     * of this atlas (the owner, and the global administrator by short-circuit — see
     * `serverTreatsAsAtlasOwner`). After a confirmation, calls the API
     * and re-reads the config; the WS `atlas_owner_changed` broadcast re-gates the rest of the UI.
     *
     * THE CONFIRMATION COPY DESCRIBES TWO DIFFERENT EFFECTS, one per principal, and it is
     * {@link ownershipTransferWarning} that decides which. A single literal sentence here is
     * what made the screen tell the global administrator he was about to lose an ownership he
     * never had.
     * @param {string} userId
     * @param {string} nome - Display name for the confirmation copy.
     */
    async _handleTransfer(userId, nome) {
        if (this._busy || !userId) return;
        const ok = await showConfirm(
            ownershipTransferWarning(sessionContext.role, nome),
            { destructive: true, confirmText: 'Transferir' }
        );
        if (!ok) return;
        this._busy = true;
        try {
            await apiClient.transferOwnership(this._atlasId, userId);
            showSuccess('Propriedade transferida.');
            await this._load();
        } catch (error) {
            showError(sharingErrorMessage(error, 'Não foi possível transferir a propriedade.'));
        } finally {
            this._busy = false;
        }
    }

    /**
     * @private Debounces the user-search query; short queries clear the results.
     * @param {string} value
     */
    _handleSearchInput(value) {
        if (this._searchTimer) {
            clearTimeout(this._searchTimer);
            this._searchTimer = null;
        }
        const q = value.trim();
        if (q.length < SEARCH_MIN_CHARS) {
            this._renderResultsInto([]);
            this._setResultsHidden(true);
            return;
        }
        const timer = setTimeout(() => this._runSearch(q), SEARCH_DEBOUNCE_MS);
        this._searchTimer = timer;
        trackTimer(this, timer, 'timeout');
    }

    /**
     * @private Performs the search and renders results, dropping stale responses.
     * @param {string} q
     */
    async _runSearch(q) {
        const seq = ++this._searchSeq;
        try {
            const results = await apiClient.searchUsers(q);
            if (seq !== this._searchSeq) return; // a newer query superseded this one
            const list = Array.isArray(results) ? results : [];
            this._renderResultsInto(list);
            this._setResultsHidden(false);
        } catch {
            if (seq !== this._searchSeq) return;
            this._renderSearchFailure(q);
            this._setResultsHidden(false);
        }
    }

    /**
     * @private Renders results HTML into the container and wires the add buttons.
     * @param {Array} results
     */
    _renderResultsInto(results) {
        const container = this.getBody()?.querySelector('[data-results]');
        if (!container) return;
        clearScopedListeners(this, 'results');
        // SEM O TERNÁRIO, e a razão é que ele tornava um ramo INALCANÇÁVEL: o painel era
        // revelado com string vazia, então o "Nenhum usuário encontrado" que
        // `_renderResults` já sabia devolver nunca chegava à tela. Somado ao `catch` de
        // `_runSearch`, que chamava este mesmo par, "ninguém encontrado" e "a rede caiu"
        // eram a MESMA caixa em branco.
        container.innerHTML = this._renderResults(results);
        container.querySelectorAll('[data-action="add"]').forEach((btn) => {
            addScopedDomListener(this, 'results', btn, 'click', () =>
                this._handleAdd(btn.dataset.userId));
        });
    }

    /**
     * @private Renders the search FAILURE, which is a different thing from an empty result.
     *
     * The retry is what makes this a state and not a dead end: the query is still in hand,
     * so the person does not have to retype it to find out whether the network came back.
     * @param {string} q - The query to run again.
     */
    _renderSearchFailure(q) {
        const container = this.getBody()?.querySelector('[data-results]');
        if (!container) return;
        clearScopedListeners(this, 'results');
        // A FRASE VEM DE `grant-tree.js` e não é reescrita aqui. As TRÊS buscas de pessoa do
        // produto (este modal, o de criar atlas e o de conceder recurso) tinham o mesmo
        // defeito, então elas precisam da mesma frase: uma cópia por modal diverge na
        // primeira revisão, e a divergência aparece justamente quando alguém compara duas
        // telas tentando entender se o erro é o mesmo. Aquele arquivo tem ZERO imports, de
        // modo que importá-lo daqui não arrasta nada para `atlas.html`.
        container.innerHTML = `
            <div class="sharing-results__failed" data-testid="sharing-search-failed" role="alert">
                <p class="sharing-section__hint">${escapeHtml(searchFailureNotice())}</p>
                <button type="button" class="prompt-modal-btn" data-action="search-retry"
                        data-testid="sharing-search-retry">Tentar de novo</button>
            </div>`;
        const retry = container.querySelector('[data-action="search-retry"]');
        if (retry) {
            addScopedDomListener(this, 'results', retry, 'click', () => this._runSearch(q));
        }
    }

    /** @private */
    _setResultsHidden(hidden) {
        const container = this.getBody()?.querySelector('[data-results]');
        if (!container) return;
        container.hidden = hidden;
    }

    /**
     * @private Grants a searched user the default permission (Leitura — DEFAULT_GRANT_PERMISSION),
     * clears the search, re-reads config.
     * @param {string} userId
     */
    async _handleAdd(userId) {
        if (this._busy || !userId) return;
        // Guard against double-adding someone already a member.
        if (this._shares.some((s) => String(s.userId) === String(userId))) return;
        this._busy = true;
        try {
            await apiClient.addShare(this._atlasId, userId, DEFAULT_GRANT_PERMISSION);
            this._searchSeq++; // invalidate any in-flight search
            await this._load();
            // Reset the search UI after a successful add.
            const input = this.getBody()?.querySelector('[data-action="search"]');
            if (input) input.value = '';
            this._renderResultsInto([]);
            this._setResultsHidden(true);
        } catch (error) {
            showError(sharingErrorMessage(error, 'Não foi possível adicionar a pessoa.'));
        } finally {
            this._busy = false;
        }
    }

    /**
     * Hides the modal, clearing scoped listeners first.
     */
    hide() {
        // A assinatura de presença é desfeita AQUI, e não pelo `setupCleanup` do `ModalBase`: ela é
        // de um objeto injetado, não do barramento da casa.
        this._unsubscribePresence();
        clearScopedListeners(this, 'body');
        clearScopedListeners(this, 'results');
        if (this._searchTimer) {
            clearTimeout(this._searchTimer);
            this._searchTimer = null;
        }
        super.hide();
    }
}

/**
 * A FONTE DE PRESENÇA que este modal aceita, e o único contrato entre ele e a sessão viva de
 * colaboração.
 *
 * São dois métodos porque são duas perguntas, e nenhuma das duas pertence a esta tela: QUEM está
 * vendo este atlas agora (já sem mim e já sem quem está `away`), e QUANDO essa resposta muda. A
 * implementação viva é `presence/sharing-presence.source.js`, e é ela que sabe de
 * `syncEngine.atlasId`, de `presenceStore` e do barramento.
 *
 * @typedef {Object} SharingPresenceSource
 * @property {(atlasId: string) => Array<{userId?: string, clientId?: string, userName?: string}>} usersIn
 *   Os OUTROS usuários conectados ÀQUELE atlas. Lista vazia quando o atlas conectado é outro.
 * @property {(onChange: () => void) => (() => void)} onChange
 *   Assina a mudança de composição e devolve o desfazer.
 */

/**
 * Shows the atlas sharing modal, com ou sem presença.
 *
 * ESTE É O SÍMBOLO QUE `atlas.html` IMPORTA. O mapa usa `showSharingModal`
 * (`modals/sharing.modal.js`), que é este mesmo com a fonte de presença viva já ligada.
 *
 * The caller is responsible for deciding whether to offer sharing; the backend independently
 * enforces `manage` (co-Gestor) on every mutation, never owner-only. Gate por hierarquia,
 * nunca por igualdade a `owner`.
 *
 * @param {string} atlasId - Atlas to manage sharing for.
 * @param {Object} [options]
 * @param {string} [options.atlasName] - Display name shown in the header title.
 * @param {SharingPresenceSource|null} [options.presence] - Ver o construtor. Ausente = sem presença.
 * @param {boolean} [options.readOnly] - Abre o modo PARTICIPANTES. Ver o construtor.
 * @returns {SharingModal} The modal instance.
 */
export function openSharingModal(atlasId, options = {}) {
    const modal = new SharingModal(atlasId, options);
    modal.render();
    modal.show();
    return modal;
}
