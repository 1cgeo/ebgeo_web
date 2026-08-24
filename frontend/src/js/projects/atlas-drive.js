// Path: js/projects/atlas-drive.js

/**
 * @fileoverview Atlas Drive — the project chooser ("Google Drive of maps"). Lists the user's server
 * atlases as a card grid with tabs (Recentes / Meus / Compartilhados / Públicos / Lixeira) and a name
 * search, plus per-card actions. WHICH actions is {@link cardMenuActions}, a pure function, and the
 * list here would be a second copy of it that ages: read that one.
 *
 * SHARING IS ADMINISTERED FROM HERE, since 2026-08-23, and the paragraph that used to sit in this
 * spot said the opposite with a measurement to back it: `modals/sharing.modal.js` reached 188
 * modules against this page's 48, and its `render()` called `getEventBus()`, which THROWS when
 * `initServices()` never ran, which is the definition of this page. Both facts were true. What
 * changed is the screen, not the page: it was cut in two, and the core (`sharing.modal.core.js`,
 * REST plus DOM, 16 modules) carries no store, no event bus and no sync engine. All three
 * store-bound imports served the "Vendo agora" presence block, which has no meaning without a live
 * collaboration session, so out here it simply does not exist.
 *
 * `_showAccess` opens the core by dynamic `import()`, and the header of that method is where the
 * trap is written out: importing `@modals/sharing.modal.js` (the MAP's entry point, which injects
 * the live presence source) drags the store straight back. `compartilhar-sem-a-store.test.js` is
 * the structural guard.
 *
 * The read-only `AtlasAccessModal` that lived here for one day was deleted in the same change. It
 * existed only because the real screen was unreachable, and keeping it beside the real one would be
 * two screens answering "who reaches this atlas".
 *
 * It is the BODY of `atlas.html`, not a modal: it used to be a full-screen overlay stacked on the
 * booted map (`modals/project-picker.modal.js`), which meant choosing a project happened on top of a
 * map you had not chosen yet, and closing it dropped you on a blank local workspace nobody asked for.
 * As a page it has its own URL, its own back/forward, and no map behind it. The `project-picker-*`
 * testids are kept verbatim so the existing e2e specs stay valid.
 *
 * Opening is a NAVIGATION (`./?atlas=<uuid>`), so this component never touches the store or the sync
 * engine — the map page owns those, and its `openRemoteAtlas` already handles wipe/connect plus the
 * unsaved-local-work question. Dynamic text goes through textContent; icons are static SVG.
 *
 * The file also exports {@link LocalAtlasSection}, the "Neste computador" half of the page. It is a
 * SEPARATE component, not a sixth tab of this one: the five tabs (Recentes / Meus / Compartilhados /
 * Públicos / Lixeira) are all server concepts, and a local atlas has no owner, no permission and no
 * trash. It is equally store-free — every local operation arrives as a callback from
 * `projects-page.js`, which is the single file on this page allowed to call the local-atlas API.
 */

import { showCreateAtlasModal } from '@modals/create-atlas.modal.js';
import { showConfirm } from '@modals/confirm.modal.js';
import { showPrompt } from '@modals/prompt.modal.js';
// Import DIRETO do arquivo, NUNCA `@modals` (o barrel): `modal.base.js` alcança dois módulos ao
// todo (ele mesmo e `@utils/event-cleanup.js`), enquanto o barrel arrasta a store para uma página
// que boota sem ela. Medido em 2026-08-23; o mesmo critério que já rege `confirm`/`prompt` acima.
import { apiClient } from '@store/sync/api-client.js';
import { fileToCoverPayload } from './cover-image.js';
import {
    setupCleanup, addDomListener, addScopedDomListener, clearScopedListeners, cleanup, removeElement,
    trackTimer,
} from '@utils/event-cleanup.js';
import { getPresenceColor, getInitials } from '@js/presence/presence-colors.js';
import {
    getPermissionLabel, isKnownPermission, hasAtLeast, permissionRank, serverTreatsAsAtlasOwner,
} from '@js/projects/permission-levels.js';
import { showToast, showSuccess, showWarning, showError } from '@utils/toast_service.js';
// Por ARQUIVO: esta página boota sem a store, e o rótulo de superfície tem uma tabela só, a mesma
// que o aviso de poda de SAÍDA usa. Duas tabelas divergiriam na primeira superfície nova.
import { descreverPerdasDoServidor } from '@js/catalog/resource-reference.resolver.js';
// Import DIRETO, pela mesma razão dos de cima: `session-context.js` é folha desta página, e o
// barrel `@store` arrastaria a store inteira para uma página que boota sem ela.
import { sessionContext } from '@store/sync/session-context.js';
import {
    seenMarkStorageKey, parseSeenMark, serializeSeenMark, resolveSharedBadge,
    badgeText, badgeAccessibleLabel, badgeScopeNotice,
} from './shared-atlas-badge.js';

const ICONS = {
    plus: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    dots: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>`,
    globe: `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
    search: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    upload: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/></svg>`,
    lock: `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`,
    // Serve ao cabeçalho do painel de acesso E ao avatar de uma linha de GRUPO. O coletivo nunca
    // usa o avatar de iniciais coloridas: aquele deriva cor e letras de uma identidade de PESSOA,
    // e um grupo com cara de pessoa é a confusão que a linha separada existe para impedir (mesma
    // escolha de `modals/sharing.modal.js`). O tamanho vem do CSS, por isso não há segunda cópia.
    people: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
};

/** Avatars drawn on a card before the rest collapses into "+N". */
const MAX_CARD_AVATARS = 4;

const FILTERS = [
    { key: 'recentes', label: 'Recentes' },
    { key: 'meus', label: 'Meus' },
    { key: 'compartilhados', label: 'Compartilhados comigo' },
    { key: 'publicos', label: 'Públicos' },
    { key: 'lixeira', label: 'Lixeira' },
    // SÓ PARA QUEM ADMINISTRA O SISTEMA, e o gate está em `_buildTabs`.
    //
    // POR QUE ESTA ABA EXISTE. O administrador tem posse em TODO atlas
    // (`requireAtlasPermission` faz curto-circuito por papel global) e não conseguia LISTAR nenhum
    // atlas alheio: `LIST_USER_ATLAS` filtra por posse ou share, sem ramo de administrador. A
    // posse universal só se exercia por URL conhecida, o que na prática significa que ele não a
    // exercia. A metade da LIXEIRA já resolvia isso corretamente desde antes, e é o vizinho.
    //
    // POR QUE É BUSCA E NÃO LISTA. Decisão do dono, 2026-08-24: a enumeração nasce sob controle
    // explícito. O servidor RECUSA (422) um termo com menos de dois caracteres, então não existe
    // "abrir a aba e ver tudo" nem por acidente nem por curinga (`%` e `_` são escapados antes do
    // ILIKE, senão `%%` passaria no piso e devolveria o acervo).
    { key: 'sistema', label: 'Busca do sistema', somenteAdmin: true },
];

const RELATIVE_TIME_FORMAT = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });

/** Formats a timestamp as a pt-BR relative phrase, falling back to an absolute date past a week. */
function formatRelativeTime(value) {
    if (value == null || value === '') return '';
    const then = new Date(value).getTime();
    if (!Number.isFinite(then)) return '';
    const diffSec = Math.round((then - Date.now()) / 1000);
    const abs = Math.abs(diffSec);
    if (abs < 60) return RELATIVE_TIME_FORMAT.format(diffSec, 'second');
    if (abs < 3600) return RELATIVE_TIME_FORMAT.format(Math.round(diffSec / 60), 'minute');
    if (abs < 86400) return RELATIVE_TIME_FORMAT.format(Math.round(diffSec / 3600), 'hour');
    if (abs < 86400 * 7) return RELATIVE_TIME_FORMAT.format(Math.round(diffSec / 86400), 'day');
    return new Date(then).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * COMO UMA PESSOA É NOMEADA nesta página, com o posto na frente quando o servidor mandou um.
 *
 * O posto vem no payload de `GET /atlas/overview` (`posto_graduacao`, por membro) e era jogado
 * fora: o rodapé montava a lista só com `nome`. Num app do Exército "Cap Silva" e "Sd Silva" são
 * duas pessoas, e a lista que mostra só o sobrenome não distingue as duas.
 *
 * O ÚLTIMO RECURSO NÃO É STRING VAZIA. Uma entrada sem nome nenhum ainda é uma pessoa com acesso,
 * e apagá-la da frase encurtaria a lista sem baixar a contagem ao lado, que é a forma de erro em
 * que a tela se contradiz sozinha.
 *
 * Pura, e exportada por isso: é a parte desta tela que se verifica em node.
 * @param {{nome?: string, posto_graduacao?: string, username?: string}} person
 * @returns {string} Nunca vazia.
 */
export function accessPersonLabel(person) {
    const nome = String(person?.nome ?? '').trim();
    const posto = String(person?.posto_graduacao ?? '').trim();
    if (nome && posto) return `${posto} ${nome}`;
    if (nome) return nome;
    const username = String(person?.username ?? '').trim();
    if (username) return `@${username}`;
    return 'Alguém';
}

/**
 * OS PARTICIPANTES AGRUPADOS PELO NÍVEL DELES, do topo da escada para baixo.
 *
 * É ASSIM QUE O NÍVEL CABE NUM CARTÃO. Escrever o nível ao lado de cada nome ("Cap Silva
 * (Edição), Ten Souza (Edição), Lima (Leitura)") repete a palavra mais longa da frase uma vez por
 * pessoa e estoura o cartão com dez participantes; fatorar o nível para fora do grupo escreve cada
 * um UMA vez, e o número de linhas passa a ser limitado pela ESCADA (cinco), não pela lista de
 * gente. Nenhum nome é cortado por isso.
 *
 * O NÍVEL AUSENTE É UM GRUPO SEM RÓTULO, e ele fica por último. Um servidor que ainda não mande
 * `permission` por membro (o campo nasceu em 2026-08-23) cai inteiro nesse grupo, e o rodapé
 * degrada exatamente para a lista corrida de nomes que ele desenhava antes. Nível DESCONHECIDO é
 * outra coisa: ele mantém o valor cru como rótulo, pela mesma razão que o selo do cartão o mantém.
 *
 * Pura. Interna porque {@link describeCardAccess} é a superfície que a tela consome.
 * @param {Array<{nome?: string, posto_graduacao?: string, permission?: *}>} members
 * @returns {Array<{permission: string, label: string, names: string[], count: number}>}
 */
function groupMembersByLevel(members) {
    const buckets = new Map();
    for (const member of members) {
        const raw = typeof member?.permission === 'string' ? member.permission.trim() : '';
        if (!buckets.has(raw)) buckets.set(raw, []);
        buckets.get(raw).push(accessPersonLabel(member));
    }
    const groups = [...buckets.entries()].map(([permission, names]) => ({
        permission,
        label: getPermissionLabel(permission),
        names,
        count: names.length,
    }));
    return groups.sort((a, b) => {
        // `permissionRank` devolve -1 para tudo o que não é degrau, então o desconhecido e o
        // ausente empatam aqui e são desempatados abaixo: o SEM RÓTULO por último de todos.
        const rank = permissionRank(b.permission) - permissionRank(a.permission);
        if (rank !== 0) return rank;
        if (Boolean(a.label) !== Boolean(b.label)) return a.label ? -1 : 1;
        return a.label.localeCompare(b.label, 'pt-BR');
    });
}

/**
 * Quantas pessoas o servidor NÃO nomeou, por extenso, ou string vazia quando nomeou todas.
 * @param {number} overflow
 * @returns {string}
 */
function accessOverflowLabel(overflow) {
    if (!Number.isFinite(overflow) || overflow <= 0) return '';
    return overflow === 1 ? 'e mais 1 pessoa' : `e mais ${overflow} pessoas`;
}

/**
 * O QUE O RODAPÉ DO CARTÃO DIZ sobre quem tem acesso, em texto VISÍVEL.
 *
 * Até 2026-08-23 os nomes moravam só no atributo `title`: invisíveis no toque, invisíveis para
 * quem não para o mouse em cima, e ausentes de qualquer captura. O cartão mostrava quatro
 * bolinhas e um número, e a única pergunta que o rodapé existe para responder ("quem?") ficava
 * atrás de um hover. Agora `detail` é desenhado como texto e o `title` é REFORÇO, nunca o único
 * portador.
 *
 * DESDE 2026-08-23 O PAYLOAD TRAZ O NÍVEL de cada membro, e é isso que `levels` reparte
 * (`GET /atlas/overview` devolve `{id, nome, posto_graduacao, permission}` por membro, mais o
 * `member_count`; ver `LIST_USER_ATLAS_MEMBERS` em `backend/src/modules/atlas/atlas.queries.js`).
 * O nível é o EFETIVO, o máximo entre o share direto e os dos grupos vivos, com `owner`
 * sintetizado para o dono. Nenhum Leitor precisa mais chegar a `manage` para saber com que posto
 * cada um está ali, que era o dado que evitava o pedido errado à pessoa errada (cláusula 5.7).
 *
 * O QUE O PAYLOAD DELIBERADAMENTE NÃO TRAZ É O CAMINHO. Ele não diz por qual porta cada pessoa
 * entrou, e a tela não pode inferir: dizer "por grupo" entregaria a adesão dela a um coletivo
 * alheio, e é pela mesma razão que nenhum grupo aparece como participante aqui. Não escreva
 * origem de acesso a partir deste objeto.
 *
 * `detail` E `title` CONTINUAM SENDO A LISTA CORRIDA de nomes, sem nível: eles alimentam o
 * atributo `title`, que é REFORÇO da informação desenhada e não pode virar a única portadora dela.
 * O que a tela DESENHA é `levels`.
 *
 * A AUSÊNCIA DE LINHA CONTINUA DESENHANDO NADA (devolve `null`): quando o pedido de overview
 * falhou não há linha para este atlas, e um rodapé que dissesse "Só você" leria como "este
 * projeto é privado", que é um fato errado dito em silêncio. Já a solidão CONHECIDA é dita em voz
 * alta.
 *
 * Pura — sem DOM, sem rede.
 * @param {{member_count?: *, members?: Array}|null|undefined} row - a linha de `getAtlasOverview`.
 * @param {{is_public?: boolean}} [project]
 * @returns {{count: number, summary: string, detail: string, title: string,
 *   levels: Array<{permission: string, label: string, names: string[], count: number}>,
 *   overflowLabel: string}|null}
 */
export function describeCardAccess(row, project = {}) {
    if (!row) return null;
    const members = Array.isArray(row.members) ? row.members : [];
    const declared = Number(row.member_count);
    const count = Number.isFinite(declared) && declared > 0 ? Math.trunc(declared) : members.length;

    if (count <= 1) {
        // `is_public` muda o FATO, não o tom: um atlas solitário com link público não é privado.
        const summary = project?.is_public ? 'Só você e o link público' : 'Só você';
        return { count, summary, detail: '', title: summary, levels: [], overflowLabel: '' };
    }

    const summary = `${count} pessoas`;
    const names = members.map(accessPersonLabel);
    if (names.length === 0) {
        // Contagem sem lista é estado real (o `json_agg` do servidor corta em 10, e um payload
        // truncado por outro motivo cairia aqui): dizer o número sozinho é honesto, inventar
        // nomes não seria.
        return { count, summary, detail: '', title: summary, levels: [], overflowLabel: '' };
    }
    const overflow = Math.max(0, count - names.length);
    const detail = overflow > 0 ? `${names.join(', ')} e mais ${overflow}` : names.join(', ');
    return {
        count,
        summary,
        detail,
        title: `Com acesso: ${detail}`,
        levels: groupMembersByLevel(members),
        // O EXCEDENTE FICA FORA DOS GRUPOS, e não pendurado no último deles: o servidor corta a
        // lista em 10 e não manda o nível de quem ficou de fora, então somá-lo a um nível
        // qualquer seria afirmar um posto que ninguém mediu.
        overflowLabel: accessOverflowLabel(overflow),
    };
}

/**
 * AS AÇÕES QUE O MENU DO CARTÃO OFERECE, para um nível de permissão.
 *
 * EXTRAÍDA PARA SER TESTÁVEL. O gate morava dentro de `_openCardMenu`, entre `document.createElement`
 * e `getBoundingClientRect`, então a única propriedade que importa aqui (quem vê o quê) não tinha
 * como ser verificada num ambiente sem DOM, que é o desta casa.
 *
 * GATE POR POSTO NA ESCADA, NUNCA POR LISTA FECHADA. `read < comment < write < manage < owner`:
 * um `perm === 'write' || perm === 'owner'` exclui o co-Gestor (`manage`), que está ACIMA de
 * write, e essa exata armadilha já embarcou duas vezes nos dois pacotes. Quem responde é
 * `hasAtLeast`, a única implementação sancionada da hierarquia.
 *
 * OS PISOS ESPELHAM O SERVIDOR, rota a rota (`backend/src/modules/atlas/atlas.routes.js` e
 * `backend/src/modules/sharing/sharing.routes.js`):
 *   - renomear → `PUT /atlas/:atlasId`, `write`;
 *   - capa → `PUT|DELETE /atlas/:atlasId/cover`, `write` (o mesmo de renomear: capa e nome são a
 *     identidade visível do projeto; `manage` é a régua do compartilhamento, que é outra coisa);
 *   - quem tem acesso → `GET /atlas/:atlasId/sharing`, `manage`;
 *   - fazer uma cópia → `POST /atlas/:atlasId/clone`, que só exige alcançar o atlas;
 *   - lixeira → `DELETE /atlas/:atlasId`, `owner`;
 *   - sair → `DELETE /atlas/:atlasId/sharing/me`, que não tem piso nenhum (o gate é `auth` e mais
 *     nada, porque a autoridade exercida é sobre si mesmo), mas RECUSA o dono com 409.
 *
 * POR ISSO "SAIR" É O ÚNICO ITEM ESCONDIDO DE CIMA PARA BAIXO, e o predicado é
 * `serverTreatsAsAtlasOwner`, nunca uma comparação com o literal do topo: quem o servidor trata
 * como dono (o dono da coluna `owner_id` e o administrador GLOBAL, que `toFrontendRole` dobra para
 * o mesmo degrau) levaria o 409, e oferecer o que o servidor recusa é o defeito que este lote já
 * corrigiu em outra tela. O nível DESCONHECIDO também não vê o item, por `isKnownPermission`: ele
 * não é dono, mas também não é participante que este build saiba descrever, e falhar fechado num
 * item destrutivo custa um clique a menos, não um acesso a mais.
 *
 * O `testid` VAI ESCRITO POR EXTENSO, e a repetição aparente é obrigatória: montá-lo como
 * `project-picker-${id}` deixava `frontend/tests/unit/e2e-testids-existem.test.js` reprovar três
 * locators de `browser-atlas-drive.spec.js`, porque aquele guarda procura o literal ENTRE ASPAS em
 * `src/`, e um testid montado em runtime não é literal nenhum. O guarda está certo: um alvo que
 * some do texto some do alcance de quem o procura.
 *
 * Pura, e devolve array NOVO a cada chamada, para que quem ordene ou filtre não envenene o próximo.
 * @param {{permission?: *, hasCover?: boolean}} [options]
 * @returns {Array<{id: string, testid: string, label: string, danger: boolean}>} na ordem em que
 *   aparecem.
 */
export function cardMenuActions({ permission, hasCover = false } = {}) {
    const canWrite = hasAtLeast(permission, 'write');
    const canManage = hasAtLeast(permission, 'manage');
    const canOwn = hasAtLeast(permission, 'owner');
    const actions = [];
    if (canWrite) {
        actions.push({ id: 'rename', testid: 'project-picker-rename', label: 'Renomear', danger: false });
        actions.push({
            id: 'cover',
            testid: 'project-picker-cover',
            label: hasCover ? 'Trocar imagem' : 'Escolher imagem',
            danger: false,
        });
        if (hasCover) {
            actions.push({
                id: 'cover-remove',
                testid: 'project-picker-cover-remove',
                label: 'Remover imagem',
                danger: false,
            });
        }
    }
    if (canManage) {
        actions.push({ id: 'access', testid: 'project-picker-access', label: 'Compartilhar', danger: false });
    }
    // O RÓTULO DIZ A ORIGEM. 'Fazer uma cópia' era a MESMA string nos dois menus (aqui, para o
    // atlas de SERVIDOR, e em `LocalAtlasSection._openMenu`, para o local), e as duas ações fazem
    // coisas diferentes: esta cria um atlas NO SERVIDOR, em posse de quem clicou e podado por
    // destinatário; a outra copia banco a banco neste computador e não perde nada.
    actions.push({ id: 'duplicate', testid: 'project-picker-duplicate', label: 'Copiar no servidor', danger: false });
    if (canOwn) {
        actions.push({ id: 'trash', testid: 'project-picker-trash', label: 'Mover para lixeira', danger: true });
    }
    if (isKnownPermission(permission) && !serverTreatsAsAtlasOwner(permission)) {
        actions.push({ id: 'leave', testid: 'project-picker-leave', label: 'Sair do atlas', danger: true });
    }
    return actions;
}

/**
 * O QUE A TELA DIZ DEPOIS DE SAIR, a partir do que o servidor MEDIU.
 *
 * `DELETE /atlas/:atlasId/sharing/me` não responde sim ou não: ele responde o nível EFETIVO
 * DEPOIS do ato, e ele pode continuar preenchido, porque um grupo de acesso vivo ou o link público
 * mantêm o acesso por outro caminho. A pessoa clicou em sair e continua vendo o atlas; um
 * "Você saiu" incondicional seria a tela mentindo sobre o que acabou de acontecer, e o usuário
 * descobriria a mentira na própria lista, um segundo depois.
 *
 * SÃO QUATRO DESFECHOS, não dois, porque `removed` e `effectivePermission` são independentes:
 *   - removeu e não sobrou nada → saiu de vez;
 *   - não removeu e não sobrou nada → já não participava (é também a resposta a atlas inexistente,
 *     que o servidor faz idêntica de propósito, para a rota não virar oráculo de existência);
 *   - removeu e sobrou nível → o convite direto caiu, o acesso continua por outra porta;
 *   - não removeu e sobrou nível → nunca houve convite direto; o acesso sempre veio de fora.
 *
 * NENHUMA DAS FRASES NOMEIA A PORTA que sobrou, e a omissão é a mesma da cláusula 5.7: o servidor
 * não diz qual é, e adivinhar "por grupo" entregaria adesão a coletivo alheio. Ela diz que existe
 * outra porta e de que tamanho ela é, que é o que muda a decisão de quem lê.
 *
 * Pura — sem DOM, sem rede, sem toast.
 * @param {{removed?: boolean, effectivePermission?: *}|null|undefined} result
 * @param {string} [atlasName]
 * @returns {{gone: boolean, tone: 'success'|'info'|'warning', message: string}}
 */
export function describeLeaveOutcome(result, atlasName = '') {
    const nome = String(atlasName ?? '').trim();
    // As DUAS preposições vêm montadas com o alvo, e não concatenadas depois: sem nome, "de este
    // atlas" e "a este atlas" são as contrações erradas, e o atlas sem nome é estado real (o
    // servidor responde igual a atlas inexistente, para a rota não virar oráculo).
    const deAlvo = nome ? `de "${nome}"` : 'deste atlas';
    const aAlvo = nome ? `a "${nome}"` : 'a este atlas';
    const removed = result?.removed === true;
    // `getPermissionLabel` devolve o valor CRU para um nível que este build não conhece, e '' só
    // para a ausência real: um nível novo do servidor continua sendo lido como acesso remanescente.
    const nivel = getPermissionLabel(result?.effectivePermission);

    if (!nivel) {
        return {
            gone: true,
            tone: removed ? 'success' : 'info',
            message: removed
                ? `Você saiu ${deAlvo}. Ele não aparece mais na sua lista.`
                : `Você já não participava ${deAlvo}. Nada mudou.`,
        };
    }
    return {
        gone: false,
        tone: 'warning',
        message: removed
            ? `Seu convite direto ${aAlvo} foi retirado, mas você continua com acesso de ${nivel} `
                + 'por outro caminho, e o atlas segue na sua lista. Para sair de vez, fale com quem '
                + 'administra o atlas.'
            : `Você não tinha convite direto ${aAlvo}: o acesso de ${nivel} vem de outro caminho, `
                + 'e só quem administra o atlas pode retirá-lo.',
    };
}

/**
 * The project chooser, as a mountable page section.
 */
export class AtlasDrive {
    /**
     * @param {Object} options
     * @param {Array<Object>} [options.projects] - Atlas records from `apiClient.listAtlas()`.
     * @param {Function} options.onPick - Called with the picked atlas id.
     * @param {Function} [options.onCreate] - Called with (name, sharing) for "Novo atlas".
     * @param {Function} [options.onImport] - Called with the chosen `.ebgeo` File.
     * @param {{atlases: Object[], covers: Object, presence: Object}} [options.overview] - The card
     *   extras from `apiClient.getAtlasOverview()`. Omitted, cards draw name and permission alone,
     *   which is what they did before this existed — the page must stay usable when the extra
     *   request fails.
     */
    constructor(options = {}) {
        this._projects = Array.isArray(options.projects) ? options.projects : [];
        // A LISTA NAO CHEGOU e a lista VEIO VAZIA sao estados diferentes, e colapsa-los era o
        // defeito: `projects: null` significa que a consulta falhou, e a grade precisa dizer
        // isso em vez de afirmar que a pessoa nao tem atlas nenhum.
        this._loadFailed = options.projects === null;
        this._onPick = options.onPick || (() => Promise.resolve());
        this._onCreate = typeof options.onCreate === 'function' ? options.onCreate : null;
        this._onImport = typeof options.onImport === 'function' ? options.onImport : null;
        this._importBtn = null;
        this._busy = false;
        this._filter = 'recentes';
        this._query = '';
        this._trashed = [];
        this._trashedLoaded = false;
        this._root = null;
        this._gridEl = null;
        this._tabButtons = new Map();
        /** atlasId → `{member_count, members, has_cover}`; atlasId → data URI; atlasId → users. */
        this._members = new Map();
        this._covers = new Map();
        this._presence = new Map();
        /** atlasId → the node that shows who is connected, so a refresh can redraw ONLY it. */
        this._presenceNodes = new Map();
        this._coverInput = null;
        this._coverTarget = null;
        /** The "novos" counter on the Compartilhados tab, and the mark it is measured against. */
        this._sharedBadgeEl = null;
        this._sharedBadgeCountEl = null;
        this._sharedBadgeLabelEl = null;
        // `undefined` means NOT READ YET, and it is a third state on purpose: `null` is the
        // measured absence of a mark (first visit), which triggers adoption exactly once.
        this._seenMark = undefined;
        this.setOverview(options.overview);
        setupCleanup(this);
    }

    /**
     * Replaces the card extras (members, covers, presence) and redraws if already mounted.
     * @param {{atlases: Object[], covers: Object, presence: Object}} [overview]
     */
    setOverview(overview) {
        this._members = new Map(
            (Array.isArray(overview?.atlases) ? overview.atlases : []).map((row) => [String(row.id), row])
        );
        this._covers = new Map(Object.entries(overview?.covers || {}));
        this._presence = new Map(Object.entries(overview?.presence || {}));
        if (this._gridEl) this._renderGrid();
    }

    /**
     * Refreshes ONLY who is connected — the one fact that changes without the user doing anything.
     *
     * It patches the existing nodes instead of redrawing the grid, and that is not an optimisation:
     * this runs on a timer, and a rebuild would close an open ⋯ menu, drop hover, and reset the
     * scroll position of somebody who was reading the list.
     *
     * @param {Object<string, Array<Object>>} presence - Atlas id → connected users.
     */
    setPresence(presence) {
        this._presence = new Map(Object.entries(presence || {}));
        for (const [atlasId, node] of this._presenceNodes) {
            this._fillPresence(node, this._presence.get(atlasId) || []);
        }
    }

    /**
     * Builds the Drive into `host` and focuses the search box.
     * @param {HTMLElement} [host]
     */
    mount(host = document.body) {
        if (this._root) return;
        this._build();
        host.appendChild(this._root);
        const search = this._root.querySelector('.atlas-drive__search-input');
        if (search) requestAnimationFrame(() => search.focus());
    }

    /** Removes the Drive + its listeners. */
    destroy() {
        if (!this._root) return;
        this._closeCardMenu();
        clearScopedListeners(this, 'grid');
        cleanup(this);
        removeElement(this._root);
        this._root = null;
        this._gridEl = null;
        this._coverInput = null;
        this._coverTarget = null;
        this._sharedBadgeEl = null;
        this._sharedBadgeCountEl = null;
        this._sharedBadgeLabelEl = null;
        this._presenceNodes.clear();
        this._tabButtons.clear();
    }

    /** @private */
    _build() {
        const root = document.createElement('div');
        root.className = 'atlas-drive';
        // Kept from the modal era so every existing e2e locator still resolves.
        root.dataset.testid = 'project-picker-modal';

        root.appendChild(this._buildTopbar());
        root.appendChild(this._buildTabs());

        const grid = document.createElement('div');
        grid.className = 'atlas-drive__grid';
        grid.dataset.testid = 'project-picker-list';
        grid.setAttribute('role', 'listbox');
        grid.setAttribute('aria-label', 'Atlas do servidor');
        root.appendChild(grid);

        this._root = root;
        this._gridEl = grid;
        this._renderGrid();
    }

    /** @private Content toolbar: title + search + "Novo atlas" (no close — this is a page). */
    _buildTopbar() {
        const bar = document.createElement('header');
        bar.className = 'atlas-drive__topbar';

        const title = document.createElement('div');
        const h = document.createElement('h2');
        h.className = 'atlas-drive__title';
        // Section heading, not the page heading: the page is "Seus atlas" and this is its server
        // half, sitting under the local one.
        h.textContent = 'No servidor';
        const sub = document.createElement('p');
        sub.className = 'atlas-drive__subtitle';
        sub.textContent = 'Atlas sincronizados, abertos por você e por quem você convidar';
        title.append(h, sub);
        bar.appendChild(title);

        const tools = document.createElement('div');
        tools.className = 'atlas-drive__tools';

        const searchWrap = document.createElement('div');
        searchWrap.className = 'atlas-drive__search';
        const sIcon = document.createElement('span');
        sIcon.className = 'atlas-drive__search-icon';
        sIcon.innerHTML = ICONS.search; // static icon
        const search = document.createElement('input');
        search.type = 'search';
        search.className = 'atlas-drive__search-input';
        search.placeholder = 'Buscar atlas…';
        search.dataset.testid = 'project-picker-search';
        addDomListener(this, search, 'input', () => {
            this._query = search.value;
            // NA ABA DE BUSCA DO SISTEMA o termo vai ao SERVIDOR, com espera, porque a lista não
            // está no cliente. Nas outras cinco ele filtra o que já está carregado, como sempre.
            if (this._filter === 'sistema') {
                clearTimeout(this._sistemaTimer);
                this._sistemaTimer = setTimeout(() => this._buscarNoSistema(), 350);
                trackTimer(this, this._sistemaTimer, 'timeout');
                this._renderGrid();
                return;
            }
            this._renderGrid();
        });
        searchWrap.append(sIcon, search);
        tools.appendChild(searchWrap);

        if (this._onImport) {
            // A hidden file input, driven by a real button — the native control cannot be styled
            // and would be the only unstyled thing on the page.
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = '.ebgeo';
            fileInput.hidden = true;
            fileInput.dataset.testid = 'project-picker-import-input';
            addDomListener(this, fileInput, 'change', () => {
                const file = fileInput.files?.[0];
                // Reset first: picking the SAME file twice must fire `change` again (it would not
                // if the value stayed), which is exactly what a retry after a failure needs.
                fileInput.value = '';
                if (file) this._handleImport(file);
            });

            const importBtn = document.createElement('button');
            importBtn.type = 'button';
            importBtn.className = 'atlas-drive__btn atlas-drive__btn--ghost';
            importBtn.dataset.testid = 'project-picker-import';
            importBtn.title = 'Criar um atlas a partir de um arquivo .ebgeo';
            importBtn.innerHTML = ICONS.upload; // static icon
            const importLabel = document.createElement('span');
            importLabel.textContent = 'Importar .ebgeo';
            importBtn.appendChild(importLabel);
            addDomListener(this, importBtn, 'click', () => fileInput.click());

            this._importBtn = importBtn;
            tools.append(importBtn, fileInput);
        }

        if (this._onCreate) {
            const newBtn = document.createElement('button');
            newBtn.type = 'button';
            newBtn.className = 'atlas-drive__btn atlas-drive__btn--primary';
            newBtn.dataset.testid = 'project-picker-create';
            newBtn.innerHTML = ICONS.plus; // static icon
            const t = document.createElement('span');
            t.textContent = 'Novo atlas';
            newBtn.appendChild(t);
            addDomListener(this, newBtn, 'click', () => this._handleCreate());
            tools.appendChild(newBtn);
        }

        bar.appendChild(tools);
        return bar;
    }

    /**
     * @private Runs the caller's import with the chosen file, showing progress on the button —
     * unzipping + uploading a real project takes seconds, and a dead-looking button invites a
     * second click that would import twice.
     * @param {File} file
     */
    async _handleImport(file) {
        if (this._busy) return;
        this._busy = true;
        const label = this._importBtn?.querySelector('span');
        const original = label?.textContent;
        if (label) label.textContent = 'Importando…';
        if (this._importBtn) this._importBtn.disabled = true;
        try {
            await this._onImport(file);
        } finally {
            // On success the page navigates away and this never matters; on failure the button
            // must come back, or the only way to retry is a reload.
            this._busy = false;
            if (label && original) label.textContent = original;
            if (this._importBtn) this._importBtn.disabled = false;
        }
    }

    /** @private Filter tabs. */
    _buildTabs() {
        const tabs = document.createElement('nav');
        tabs.className = 'atlas-drive__tabs';
        tabs.setAttribute('role', 'tablist');
        for (const f of FILTERS) {
            if (f.somenteAdmin && !sessionContext.isAdmin()) continue;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'atlas-drive__tab';
            btn.dataset.testid = `project-picker-tab-${f.key}`;
            btn.setAttribute('role', 'tab');
            btn.textContent = f.label;
            if (f.key === 'compartilhados') btn.appendChild(this._buildSharedBadge());
            if (f.key === this._filter) btn.classList.add('atlas-drive__tab--active');
            addDomListener(this, btn, 'click', () => this._switchFilter(f.key));
            this._tabButtons.set(f.key, btn);
            tabs.appendChild(btn);
        }
        return tabs;
    }

    /**
     * @private The "novos" counter, built once and then only repainted.
     *
     * TWO NODES INSIDE, and it is not decoration. The digit alone is meaningless to a screen
     * reader ("3" beside a tab name), and per the house contract important information never
     * lives in `title`. So the digit is hidden from assistive tech and a full sentence sits
     * beside it, visually hidden. `role="status"` is deliberately ABSENT: the badge is silent by
     * decision, and a live region would announce itself over whatever the person was doing.
     */
    _buildSharedBadge() {
        const badge = document.createElement('span');
        badge.className = 'atlas-drive__tab-badge';
        badge.dataset.testid = 'project-picker-tab-compartilhados-badge';
        badge.hidden = true;

        const count = document.createElement('span');
        count.className = 'atlas-drive__tab-badge-count';
        count.setAttribute('aria-hidden', 'true');

        const label = document.createElement('span');
        label.className = 'atlas-drive__tab-badge-label';

        badge.append(count, label);
        this._sharedBadgeEl = badge;
        this._sharedBadgeCountEl = count;
        this._sharedBadgeLabelEl = label;
        return badge;
    }

    /**
     * @private Reads the seen-mark out of `localStorage`, once per mount.
     *
     * EVERY failure is the SAME answer, `null`, and that is the safe direction: a private window,
     * a browser with site data blocked and a hand-mangled value all carry zero evidence about what
     * this person has already looked at, so all three adopt the current list instead of announcing
     * it as new. See the header of `shared-atlas-badge.js`.
     * @param {string} key
     * @returns {{ids: string[]}|null}
     */
    _readSeenMark(key) {
        try {
            return parseSeenMark(window.localStorage.getItem(key));
        } catch {
            return null;
        }
    }

    /**
     * @private Writes the seen-mark. Silent on failure, on purpose: a person whose browser refuses
     * storage still gets a working page, and the only thing they lose is a counter.
     * @param {string} key
     * @param {string[]} ids
     */
    _writeSeenMark(key, ids) {
        try {
            window.localStorage.setItem(key, serializeSeenMark(ids));
        } catch { /* no storage: the badge degrades to always-zero, and nothing else breaks */ }
    }

    /**
     * @private Recomputes the badge from the current list and the stored mark.
     *
     * Called from `_renderGrid`, so it rides every path that can change the list (build, refresh,
     * restore, tab switch, and every keystroke in the search box). It costs a filter plus a Set,
     * and it does NOT touch storage on each call: the mark is read once and kept in memory.
     */
    _updateSharedBadge() {
        if (!this._sharedBadgeEl) return;
        // An anonymous visitor has no account, so no share can point at them: no key, no badge.
        const key = seenMarkStorageKey(sessionContext.userId);
        if (!key) {
            this._paintSharedBadge(0);
            return;
        }
        if (this._seenMark === undefined) this._seenMark = this._readSeenMark(key);
        const state = resolveSharedBadge({ projects: this._projects, storedMark: this._seenMark });
        // Two ways the number is zero AND the mark advances: the first visit (adoption), and the
        // person having the tab open right now. Looking at the list IS the act the badge tracks,
        // which is why it clears here and not when an atlas is opened.
        if (state.adopt || this._filter === 'compartilhados') {
            this._seenMark = { ids: state.seenIds };
            this._writeSeenMark(key, state.seenIds);
            this._paintSharedBadge(0);
            return;
        }
        this._paintSharedBadge(state.count);
    }

    /**
     * @private Paints the counter. Zero hides the whole badge rather than drawing "0", because a
     * zero beside a tab reads as a broken counter, not as good news.
     * @param {number} count
     */
    _paintSharedBadge(count) {
        const text = badgeText(count);
        this._sharedBadgeCountEl.textContent = text;
        this._sharedBadgeLabelEl.textContent = badgeAccessibleLabel(count);
        this._sharedBadgeEl.hidden = text === '';
    }

    /** @private The atlases matching the active tab + search. */
    _visible() {
        const q = this._query.trim().toLowerCase();
        const list = q ? this._projects.filter((p) => (p?.name ?? '').toLowerCase().includes(q)) : this._projects;
        switch (this._filter) {
            case 'meus':
                return list.filter((p) => p?.user_permission === 'owner');
            case 'compartilhados':
                return list.filter((p) => p?.user_permission && p.user_permission !== 'owner');
            case 'publicos':
                return list.filter((p) => p?.is_public);
            case 'recentes':
            default:
                return [...list].sort((a, b) => new Date(b?.updated_at ?? 0) - new Date(a?.updated_at ?? 0));
        }
    }

    /**
     * @private Switches the active tab. The Trash tab lazy-loads the caller's soft-deleted atlases
     * (a separate endpoint from listAtlas) on first open.
     * @param {string} key
     */
    async _switchFilter(key) {
        this._filter = key;
        for (const [k, b] of this._tabButtons) b.classList.toggle('atlas-drive__tab--active', k === key);
        // A BUSCA DO SISTEMA NÃO CARREGA NADA AO ENTRAR, ao contrário da lixeira: ela existe para
        // não despejar o acervo, então a aba abre vazia e só o termo digitado produz resultado.
        if (key === 'sistema') {
            this._sistema = [];
            this._sistemaTermo = '';
            this._sistemaTruncado = false;
        }
        if (key === 'lixeira' && !this._trashedLoaded) {
            try {
                const list = await apiClient.listTrashedAtlas();
                this._trashed = Array.isArray(list) ? list : [];
                this._trashedLoaded = true;
            } catch (error) {
                showError(error?.message || 'Não foi possível carregar a lixeira.');
            }
        }
        this._renderGrid();
    }

    /**
     * Busca atlas no sistema inteiro, para o administrador.
     *
     * O PISO DE DOIS CARACTERES É DO SERVIDOR e está repetido aqui de propósito: repetir evita uma
     * requisição que já se sabe recusada a cada tecla, e não substitui a do servidor, que é a que
     * impede o despejo do acervo por um chamador que não seja esta tela.
     * @private
     * @returns {Promise<void>}
     */
    async _buscarNoSistema() {
        const termo = this._query.trim();
        if (termo.length < 2) {
            this._sistema = [];
            this._sistemaTermo = '';
            this._renderGrid();
            return;
        }
        try {
            const r = await apiClient.searchAllAtlas(termo);
            this._sistema = Array.isArray(r?.results) ? r.results : [];
            this._sistemaTermo = termo;
            this._sistemaTruncado = r?.truncated === true;
        } catch (error) {
            this._sistema = [];
            showError(error?.message || 'Não foi possível buscar no acervo do sistema.');
        }
        this._renderGrid();
    }

    /** @private Rebuilds the card grid from the current filter/search. */
    _renderGrid() {
        if (!this._gridEl) return;
        // Release the previous cards' listeners before detaching them — _renderGrid runs on every
        // keystroke/tab-switch/refresh, so without this the tracked-listener bucket grows unbounded.
        clearScopedListeners(this, 'grid');
        // The presence nodes belong to cards that are about to be dropped; keeping them would make
        // the next poll write into detached DOM and leak a node per atlas per redraw.
        this._presenceNodes.clear();
        this._gridEl.replaceChildren();
        // Rides here rather than on its own call sites: every path that can change the list ends
        // in a redraw, and a badge updated only where somebody remembered to update it goes stale
        // on the path nobody thought of.
        this._updateSharedBadge();
        // TERCEIRO ESTADO: a lista NÃO CHEGOU. Sem ele, uma falha de rede na primeira carga
        // entregava `[]` ao Drive, que escrevia "Nenhum atlas nesta categoria": passado o toast,
        // a tela afirmava um fato FALSO e PERMANENTE, sem nada para tentar de novo. Lista vazia é
        // uma resposta bem-formada, e é por isso que nenhuma suíte ficava vermelha.
        //
        // O irmão `_refresh` já fazia o certo (mantinha a lista anterior), o que mostra que a
        // assimetria era acidente e não desenho.
        if (this._loadFailed) {
            const falha = document.createElement('div');
            falha.className = 'atlas-drive__empty';
            falha.dataset.testid = 'project-picker-load-error';
            falha.textContent = 'Não foi possível carregar seus atlas do servidor. Eles continuam '
                + 'lá; o que falhou foi esta consulta.';
            const retry = document.createElement('button');
            retry.type = 'button';
            retry.className = 'atlas-drive__empty-retry';
            retry.dataset.testid = 'project-picker-retry';
            retry.textContent = 'Tentar de novo';
            addScopedDomListener(this, 'grid', retry, 'click', () => this._refresh());
            falha.appendChild(retry);
            this._gridEl.appendChild(falha);
            return;
        }

        const isTrash = this._filter === 'lixeira';
        const isSistema = this._filter === 'sistema';
        const q = this._query.trim().toLowerCase();
        const matches = (p) => !q || (p?.name ?? '').toLowerCase().includes(q);
        // The search box applies on every tab, including Lixeira.
        //
        // A ABA DO SISTEMA NÃO FILTRA no cliente: a lista dela JÁ é o resultado do termo, e
        // filtrá-la de novo aqui esconderia linhas que casaram por NOME DO DONO ou por id exato,
        // que são dois dos quatro campos que o servidor procura e que o nome do atlas não contém.
        const list = isSistema ? this._sistema : (isTrash ? this._trashed.filter(matches) : this._visible());
        if (list.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'atlas-drive__empty';
            empty.dataset.testid = 'project-picker-empty';
            // A ABA DO SISTEMA TEM TRÊS VAZIOS, e colapsá-los mentiria em dois deles: sem termo
            // ela está vazia POR DESENHO (a busca não despeja o acervo), com termo curto o
            // servidor recusaria, e só com termo válido "nada encontrado" é um fato sobre o
            // acervo. Um "Nenhum atlas" nos três casos faria o administrador concluir que o
            // sistema não tem atlas nenhum.
            if (isSistema) {
                const termo = this._query.trim();
                empty.textContent = termo.length === 0
                    ? 'Digite para buscar no acervo do sistema inteiro: nome do atlas, nome ou '
                    : (termo.length < 2
                        ? 'Digite pelo menos dois caracteres.'
                        : `Nenhum atlas do sistema corresponde a "${termo}".`);
                if (termo.length === 0) {
                    empty.textContent += 'login do dono, ou o id exato. Esta aba não lista tudo de propósito.';
                }
            } else {
                empty.textContent = isTrash
                    ? (this._query ? 'Nenhum atlas na lixeira corresponde à busca.' : 'A lixeira está vazia.')
                    : (this._query ? 'Nenhum atlas corresponde à busca.' : 'Nenhum atlas nesta categoria.');
            }
            // O alcance da marca só se diz onde a marca age, e só quando não há busca por trás do
            // vazio: sem esta linha, a ausência de número se lê como "ninguém nunca compartilhou
            // nada comigo", que é uma conclusão que a tela não afirmou.
            if (!isTrash && !this._query && this._filter === 'compartilhados') {
                const scope = document.createElement('p');
                scope.className = 'atlas-drive__empty-note';
                scope.dataset.testid = 'project-picker-shared-scope-note';
                scope.textContent = badgeScopeNotice();
                empty.appendChild(scope);
            }
            this._gridEl.appendChild(empty);
            return;
        }
        for (const project of list) {
            this._gridEl.appendChild(isTrash ? this._trashCard(project) : this._card(project));
        }
    }

    /**
     * @private The cover of an atlas: the picture somebody chose, or the coloured initials.
     *
     * The initials are NOT a placeholder waiting to be replaced — they are the deterministic
     * identity this app gives every atlas and every person (`presence-colors.js`), so the same
     * project is the same colour on every machine. The cover only takes their place.
     */
    _thumb(project, id) {
        const cover = this._covers.get(id);
        const thumb = document.createElement('div');
        thumb.className = 'atlas-drive__thumb';
        if (cover) {
            thumb.classList.add('atlas-drive__thumb--cover');
            const img = document.createElement('img');
            img.className = 'atlas-drive__thumb-img';
            img.src = cover;
            img.alt = '';
            img.setAttribute('aria-hidden', 'true');
            thumb.appendChild(img);
        } else {
            // Runtime-computed colour, so it belongs in JS; everything else is a class.
            thumb.style.backgroundColor = getPresenceColor(id);
            thumb.textContent = getInitials(project?.name ?? '');
        }
        return thumb;
    }

    /**
     * @private Writes "who is on this map right now" into `node`, avatars and all.
     *
     * Called on every draw AND on every presence poll, which is why it is a fill rather than a
     * build: {@link setPresence} reuses the same node.
     * @param {HTMLElement} node
     * @param {Array<{id: string, nome: string}>} users
     */
    _fillPresence(node, users) {
        node.replaceChildren();
        const list = Array.isArray(users) ? users : [];
        node.hidden = list.length === 0;
        if (list.length === 0) return;

        const dot = document.createElement('span');
        dot.className = 'atlas-drive__live-dot';
        dot.setAttribute('aria-hidden', 'true');
        node.appendChild(dot);

        node.appendChild(this._avatars(list, 'atlas-drive__live-avatar'));

        const label = document.createElement('span');
        label.className = 'atlas-drive__live-label';
        // "no mapa" and not "online": these are people INSIDE this project right now, which is a
        // different fact from being signed in, and the card sits next to projects nobody is in.
        label.textContent = list.length === 1 ? '1 no mapa' : `${list.length} no mapa`;
        node.appendChild(label);
        node.title = `Agora no atlas: ${list.map((u) => u?.nome || 'Alguém').join(', ')}`;
    }

    /**
     * @private A stack of initial-avatars, capped, with a "+N" for the rest.
     * @param {Array<{id: string, nome: string}>} people
     * @param {string} className - BEM element class of each avatar.
     * @returns {HTMLElement}
     */
    _avatars(people, className) {
        const stack = document.createElement('span');
        stack.className = 'atlas-drive__avatars';
        stack.setAttribute('aria-hidden', 'true'); // the sentence next to it carries the meaning
        for (const person of people.slice(0, MAX_CARD_AVATARS)) {
            const avatar = document.createElement('span');
            avatar.className = className;
            avatar.textContent = getInitials(person?.nome || '?');
            avatar.style.backgroundColor = getPresenceColor(String(person?.id || person?.nome || ''));
            stack.appendChild(avatar);
        }
        if (people.length > MAX_CARD_AVATARS) {
            const more = document.createElement('span');
            more.className = `${className} ${className}--more`;
            more.textContent = `+${people.length - MAX_CARD_AVATARS}`;
            stack.appendChild(more);
        }
        return stack;
    }

    /**
     * @private The sharing footer: who takes part, in words and in avatars.
     *
     * IT SAYS SOMETHING EVEN WITH NO DATA. When the overview request failed there is no row for
     * this atlas, and a footer that simply vanished would read as "this project is private" —
     * a wrong fact, silently. So the absent case draws nothing at all and the caller keeps the
     * old card, while the KNOWN solitary case says so out loud.
     *
     * THE NAMES ARE DRAWN, NOT HOVERED. They used to live only in `foot.title`, which is invisible
     * on touch, invisible to anyone who does not park the pointer, and absent from every capture:
     * the card showed four circles and a number, and the one question the footer exists to answer
     * stayed behind a hover. The `title` is still set, as REINFORCEMENT of the same sentence.
     *
     * SINCE 2026-08-23 EACH PERSON'S LEVEL IS DRAWN TOO, and the layout is what makes it fit: one
     * ROW PER LEVEL, the level written once as a chip and the names of that level beside it. A
     * level repeated next to every name would write the longest word of the sentence ten times on
     * a card 320 px wide; factored out, the row count is bounded by the LADDER (five), not by the
     * roster. Nobody is truncated to make room, and nothing moves into `title`.
     *
     * The wording (and every edge of it) is {@link describeCardAccess}, which is where it is
     * verified; this method is the DOM around it.
     */
    _sharingFooter(project, id) {
        const row = this._members.get(id);
        const access = describeCardAccess(row, project);
        if (!access) return null;

        const foot = document.createElement('div');
        foot.className = 'atlas-drive__share';
        foot.dataset.testid = 'project-card-sharing';

        const head = document.createElement('div');
        head.className = 'atlas-drive__share-head';

        if (access.count <= 1) {
            const solo = document.createElement('span');
            solo.className = 'atlas-drive__share-label';
            solo.innerHTML = ICONS.lock; // static icon
            const text = document.createElement('span');
            text.textContent = access.summary;
            solo.appendChild(text);
            head.appendChild(solo);
            foot.appendChild(head);
            foot.title = access.title;
            return foot;
        }

        head.appendChild(this._avatars(Array.isArray(row.members) ? row.members : [], 'atlas-drive__member-avatar'));
        const label = document.createElement('span');
        label.className = 'atlas-drive__share-label';
        label.textContent = access.summary;
        head.appendChild(label);
        foot.appendChild(head);

        const levels = this._shareLevels(access);
        if (levels) foot.appendChild(levels);
        foot.title = access.title;
        return foot;
    }

    /**
     * @private The "who, at what level" block: one row per level, plus the uncounted tail.
     *
     * A ROW WITHOUT A CHIP IS A LEGITIMATE STATE, not a half-drawn one: a server that does not
     * send `permission` per member (the field was born on 2026-08-23) collapses into a single
     * unlabelled row, which is exactly the plain name list this footer drew before. An UNKNOWN
     * level keeps its raw value as the chip's text and loses only the colour, the same degradation
     * the card's own permission chip already does.
     *
     * DIV E SPAN, não `ul`/`li`, e a razão é o contêiner: este rodapé é montado DENTRO do
     * `<button>` que é o cartão, cujo modelo de conteúdo não admite lista. O `<p>` que estava aqui
     * antes já era desse tipo, e a página inteira segue a mesma convenção (`atlas-drive__card-body`
     * é um `div` no mesmo lugar).
     *
     * @param {{levels: Array<Object>, overflowLabel: string}} access - from `describeCardAccess`.
     * @returns {HTMLElement|null}
     */
    _shareLevels(access) {
        const rows = Array.isArray(access?.levels) ? access.levels : [];
        if (rows.length === 0 && !access?.overflowLabel) return null;

        const list = document.createElement('div');
        list.className = 'atlas-drive__share-levels';
        list.dataset.testid = 'project-card-sharing-names';

        for (const group of rows) {
            const item = document.createElement('div');
            item.className = 'atlas-drive__share-level';
            if (group.label) {
                const chip = document.createElement('span');
                chip.className = isKnownPermission(group.permission)
                    ? `atlas-drive__level-chip atlas-drive__level-chip--${group.permission}`
                    : 'atlas-drive__level-chip';
                chip.textContent = group.label;
                item.appendChild(chip);
            }
            const names = document.createElement('span');
            names.className = 'atlas-drive__share-names';
            names.textContent = group.names.join(', ');
            item.appendChild(names);
            list.appendChild(item);
        }

        if (access.overflowLabel) {
            // Sem chip de propósito: o servidor corta a lista em 10 e não manda o nível de quem
            // ficou de fora, então esta linha diz quantos são e cala sobre o posto deles.
            const tail = document.createElement('div');
            tail.className = 'atlas-drive__share-level atlas-drive__share-level--more';
            const names = document.createElement('span');
            names.className = 'atlas-drive__share-names';
            names.textContent = access.overflowLabel;
            tail.appendChild(names);
            list.appendChild(tail);
        }
        return list;
    }

    /** @private A single atlas card (the `project-picker-item`) wrapped with its actions menu button. */
    _card(project) {
        const id = String(project?.id ?? '');
        const wrap = document.createElement('div');
        wrap.className = 'atlas-drive__card-wrap';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'atlas-drive__card';
        btn.dataset.testid = 'project-picker-item';
        btn.dataset.atlasId = id;
        btn.setAttribute('role', 'option');
        const sub = this._subtitle(project);
        btn.setAttribute('aria-label', sub ? `${project?.name ?? ''} — ${sub}` : (project?.name ?? ''));

        const thumbWrap = document.createElement('div');
        thumbWrap.className = 'atlas-drive__thumb-wrap';
        thumbWrap.appendChild(this._thumb(project, id));

        // Presence rides ON the thumbnail: it is the most perishable fact on the card, and the
        // corner of the picture is where the eye lands before it reads anything.
        const live = document.createElement('span');
        live.className = 'atlas-drive__live';
        live.dataset.testid = 'project-card-live';
        this._fillPresence(live, this._presence.get(id) || []);
        thumbWrap.appendChild(live);
        this._presenceNodes.set(id, live);
        btn.appendChild(thumbWrap);

        const body = document.createElement('div');
        body.className = 'atlas-drive__card-body';

        const name = document.createElement('div');
        name.className = 'atlas-drive__card-name';
        name.textContent = project?.name ?? '';
        body.appendChild(name);

        const meta = document.createElement('div');
        meta.className = 'atlas-drive__card-meta';
        meta.textContent = this._subtitle(project);
        body.appendChild(meta);

        const tags = document.createElement('div');
        tags.className = 'atlas-drive__card-tags';
        // The chip is drawn for ANY level the server reports, not only the ones this file
        // knows a label for: the local table used to list owner/write/read alone, so an atlas
        // shared as Gestor (`manage`) or Comentarista (`comment`) rendered NO badge at all —
        // indistinguishable from an atlas with no permission. An unknown level now degrades to
        // its raw value on the base chip (no `--<level>` modifier, since no rule would match).
        const permission = project?.user_permission;
        const permissionLabel = getPermissionLabel(permission);
        if (permissionLabel) {
            const chip = document.createElement('span');
            chip.className = isKnownPermission(permission)
                ? `atlas-drive__chip atlas-drive__chip--${permission}`
                : 'atlas-drive__chip';
            chip.textContent = permissionLabel;
            chip.dataset.permission = String(permission);
            tags.appendChild(chip);
        }
        if (project?.is_public) {
            const pub = document.createElement('span');
            pub.className = 'atlas-drive__public';
            pub.innerHTML = ICONS.globe; // static icon
            const t = document.createElement('span');
            t.textContent = 'Público';
            pub.appendChild(t);
            tags.appendChild(pub);
        }
        body.appendChild(tags);

        const sharing = this._sharingFooter(project, id);
        if (sharing) body.appendChild(sharing);

        btn.appendChild(body);
        addScopedDomListener(this, 'grid', btn, 'click', () => this._handlePick(id));
        wrap.appendChild(btn);

        // Actions menu (⋯) — a sibling button (a card is a <button>, so it cannot be nested).
        const menuBtn = document.createElement('button');
        menuBtn.type = 'button';
        menuBtn.className = 'atlas-drive__menu-btn';
        menuBtn.dataset.testid = 'project-picker-menu';
        menuBtn.setAttribute('aria-label', 'Mais ações');
        menuBtn.innerHTML = ICONS.dots; // static icon
        addScopedDomListener(this, 'grid', menuBtn, 'click', (e) => {
            e.stopPropagation();
            this._openCardMenu(project, menuBtn);
        });
        wrap.appendChild(menuBtn);

        return wrap;
    }

    /**
     * @private Opens the card actions menu near the ⋯ button.
     *
     * WHICH actions appear is {@link cardMenuActions}, a pure function verified in node; this
     * method only turns its answer into buttons and wires each one. The split exists because the
     * gate is the part that has been wrong before (a closed list that silently excluded `manage`),
     * and while it lived between `createElement` and `getBoundingClientRect` there was no way to
     * assert it in an environment without a DOM, which is the one this repo tests in.
     *
     * Each item's `data-testid` comes from the action itself, spelled out there, which reproduces
     * every existing locator verbatim.
     */
    _openCardMenu(project, anchorBtn) {
        // Re-clicking the same ⋯ button toggles its menu shut.
        if (this._cardMenu && this._cardMenuAnchor === anchorBtn) {
            this._closeCardMenu();
            return;
        }
        this._closeCardMenu();

        const menu = document.createElement('div');
        menu.className = 'atlas-drive__menu';
        menu.dataset.testid = 'project-picker-menu-popup';
        const rect = anchorBtn.getBoundingClientRect();
        menu.style.top = `${Math.round(rect.bottom + 4)}px`;
        menu.style.left = `${Math.round(rect.right - 200)}px`;

        const handlers = {
            rename: () => this._rename(project),
            cover: () => this._pickCover(project),
            'cover-remove': () => this._removeCover(project),
            access: () => this._showAccess(project),
            duplicate: () => this._duplicate(project),
            trash: () => this._trash(project),
            leave: () => this._leave(project),
        };

        const actions = cardMenuActions({
            permission: project?.user_permission,
            hasCover: this._covers.has(String(project?.id ?? '')),
        });
        for (const action of actions) {
            const run = handlers[action.id];
            if (!run) continue;
            const item = document.createElement('button');
            item.type = 'button';
            item.className = `atlas-drive__menu-item${action.danger ? ' atlas-drive__menu-item--danger' : ''}`;
            item.dataset.testid = action.testid;
            item.textContent = action.label;
            item.addEventListener('click', () => { this._closeCardMenu(); run(); });
            menu.appendChild(item);
        }

        this._root.appendChild(menu);
        this._cardMenu = menu;
        this._cardMenuAnchor = anchorBtn;
        this._menuOutside = (e) => {
            // anchorBtn.contains(target) — the click may land on the button's inner <svg>, which is
            // NOT === anchorBtn; without contains() the button's own click reads as "outside".
            if (!menu.contains(e.target) && !anchorBtn.contains(e.target)) this._closeCardMenu();
        };
        // Defer so the opening click doesn't immediately close the menu. Handle stored for teardown.
        this._menuTimer = setTimeout(() => {
            this._menuTimer = null;
            document.addEventListener('mousedown', this._menuOutside);
        }, 0);
    }

    /** @private */
    _closeCardMenu() {
        if (this._menuTimer != null) { clearTimeout(this._menuTimer); this._menuTimer = null; }
        if (this._cardMenu) { this._cardMenu.remove(); this._cardMenu = null; }
        this._cardMenuAnchor = null;
        if (this._menuOutside) { document.removeEventListener('mousedown', this._menuOutside); this._menuOutside = null; }
    }

    /**
     * @private "Compartilhar" — the FULL sharing screen, opened for one card.
     *
     * Only reached from a menu item that {@link cardMenuActions} draws at `manage` or above, which
     * is EXACTLY the gate the server puts on the four `/atlas/:atlasId/sharing` routes. The modal
     * re-checks nothing: the server decides on every request, and a 403 arriving there is drawn as
     * the server's own sentence.
     *
     * THIS PAGE COULD NOT OPEN IT UNTIL 2026-08-23, and the reason was measured, not assumed:
     * `@modals/sharing.modal.js` reached 188 modules against this page's 48, and, worse than the
     * payload, its `render()` called `getEventBus()`, which THROWS when `initServices()` never ran,
     * which is the definition of this page. What unlocked it was cutting the screen in two: the
     * core (REST plus DOM, 16 modules) and the live presence source, which is where all three
     * store-bound imports went. This page costs 2 extra modules to open it.
     *
     * SO IMPORT THE CORE, NEVER THE WRAPPER. `@modals/sharing.modal.js` is the map's entry point:
     * it injects `livePresenceSource` and drags the store back in. There is a structural test for
     * exactly this (`frontend/tests/unit/compartilhar-sem-a-store.test.js`), and it fails loudly.
     *
     * Omitting `presence` is what removes the "Vendo agora" block, and that is the truth of the
     * product rather than a degradation: there is no presence without a live collaboration session,
     * and this page has none.
     *
     * The `import()` is dynamic so the core stays out of this page's eager payload; it is also why
     * the failure has to be handled here, since a chunk that fails to load must not leave the click
     * silent.
     *
     * (This method used to open `AtlasAccessModal`, a READ-ONLY roll written the day before, which
     * existed only because the real screen was unreachable. It was deleted with this change rather
     * than kept beside it: two screens answering "who reaches this atlas" is the drift this
     * codebase already pays for elsewhere, and the one that reads and writes strictly contains the
     * one that only reads.)
     * @param {Object} project
     */
    async _showAccess(project) {
        try {
            const { openSharingModal } = await import('@modals/sharing.modal.core.js');
            openSharingModal(project.id, { atlasName: project.name });
        } catch (error) {
            console.error('[atlas-drive] falha ao abrir o compartilhamento:', error);
            showToast('Não foi possível abrir o compartilhamento. Tente de novo.', 'error');
        }
    }

    /**
     * @private Re-fetches the atlas list AND the card extras, then redraws.
     *
     * Both, because the actions that call this create and destroy atlases: a copy made from a card
     * arrives with no cover and one member, and a list refreshed without the overview would draw it
     * with the previous atlas's footer for as long as the page stayed open.
     */
    async _refresh() {
        const [list, overview] = await Promise.all([
            apiClient.listAtlas().catch((error) => {
                showError(error?.message || 'Não foi possível atualizar a lista.');
                return null;
            }),
            // Silent on failure, deliberately: the extras are an enrichment, and a second red
            // toast about a detail nobody asked for would bury the first one, which is the real news.
            apiClient.getAtlasOverview().catch(() => null),
        ]);
        // A NOVA TENTATIVA E O UNICO CAMINHO QUE LIMPA A MARCA, e ela so limpa quando a lista de
        // fato chegou: um retry que falhe de novo tem de continuar mostrando o estado de erro,
        // nao cair no "nenhum atlas" que a marca existe para impedir.
        if (Array.isArray(list)) {
            this._projects = list;
            this._loadFailed = false;
        } else {
            this._loadFailed = true;
        }
        if (overview) this.setOverview(overview);
        else this._renderGrid();
    }

    /**
     * @private The hidden file input the cover actions drive.
     *
     * ONE input for the whole grid, living in the Drive's root rather than in a card: the ⋯ menu is
     * destroyed the moment an item is clicked, so an input owned by the menu would be gone before
     * the file picker returned, and its `change` would fire into nothing.
     */
    _ensureCoverInput() {
        if (this._coverInput) return this._coverInput;
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/png,image/jpeg,image/webp';
        input.hidden = true;
        input.dataset.testid = 'project-picker-cover-input';
        addDomListener(this, input, 'change', () => {
            const file = input.files?.[0];
            const target = this._coverTarget;
            // Reset BEFORE the await: picking the same file twice must fire `change` again, which
            // is exactly what a retry after a failed upload needs.
            input.value = '';
            this._coverTarget = null;
            if (file && target) this._applyCover(target, file);
        });
        this._root.appendChild(input);
        this._coverInput = input;
        return input;
    }

    /** @private Opens the file picker for this project's cover. */
    _pickCover(project) {
        const input = this._ensureCoverInput();
        this._coverTarget = project;
        input.value = '';
        input.click();
    }

    /**
     * @private Shrinks the picture in the browser and stores it.
     *
     * The resize is NOT an optimisation to skip when in doubt: a phone photo is megabytes, the card
     * draws it 320 px wide, and every visit to this page would download all of them.
     */
    async _applyCover(project, file) {
        const id = String(project?.id ?? '');
        try {
            const payload = await fileToCoverPayload(file);
            await apiClient.setAtlasCover(id, payload);
            this._covers.set(id, payload.image);
            const row = this._members.get(id);
            if (row) row.has_cover = true;
            this._renderGrid();
            showSuccess('Imagem do atlas atualizada.');
        } catch (error) {
            console.error('[projects] cover upload failed:', error);
            showError(error?.message || 'Não foi possível usar esta imagem.');
        }
    }

    /** @private Drops the cover, putting the coloured initials back. */
    async _removeCover(project) {
        const id = String(project?.id ?? '');
        try {
            await apiClient.deleteAtlasCover(id);
            this._covers.delete(id);
            const row = this._members.get(id);
            if (row) row.has_cover = false;
            this._renderGrid();
            showSuccess('Imagem removida.');
        } catch (error) {
            showError(error?.message || 'Não foi possível remover a imagem.');
        }
    }

    /** @private Rename via a prompt → PUT /atlas/:id. */
    async _rename(project) {
        const name = await showPrompt('Renomear atlas', project?.name ?? '');
        if (name == null) return;
        const trimmed = name.trim();
        if (!trimmed || trimmed === project?.name) return;
        try {
            await apiClient.updateAtlas(project.id, { name: trimmed });
            showSuccess('Atlas renomeado.');
            await this._refresh();
        } catch (error) {
            showError(error?.message || 'Falha ao renomear o atlas.');
        }
    }

    /**
     * @private Make a copy → POST /atlas/:id/clone.
     *
     * O RELATO DE PODA JÁ VINHA DO SERVIDOR E ERA JOGADO FORA. `cloneAtlas`
     * (`backend/src/modules/atlas/atlas.service.js`) monta o podador sobre `classifyResourceRefs`
     * e devolve `pruneReport` com a contagem por superfície; esta função descartava a resposta
     * inteira e dizia "Cópia criada", ponto. A pessoa ficava com um atlas silenciosamente menor
     * que o original, e descobria a diferença abrindo um mapa e não achando a camada.
     *
     * A frase de posse também faltava: a cópia nasce em posse de quem clonou, e é essa a razão de
     * a poda existir (o que o novo dono não enxerga não viaja).
     */
    async _duplicate(project) {
        try {
            const copia = await apiClient.cloneAtlas(project.id, {
                name: `${project?.name ?? 'Atlas'} (cópia)`,
            });
            const perdas = descreverPerdasDoServidor(copia?.pruneReport);
            if (perdas) {
                // `showWarning` e não `showSuccess`: a cópia saiu, mas saiu incompleta, e o tom é
                // a primeira coisa que a pessoa lê.
                showWarning('A cópia é sua e ficou sem o que você não tem acesso:\n' + perdas);
            } else {
                showSuccess('Cópia criada, e ela é sua.');
            }
            await this._refresh();
        } catch (error) {
            showError(error?.message || 'Falha ao duplicar o atlas.');
        }
    }

    /**
     * @private Move to trash (soft-delete) → DELETE /atlas/:id.
     * No "is this the connected atlas?" special case: this page holds no connection. A peer with the
     * atlas open receives the server's `atlas_deleted` broadcast and tears itself down.
     */
    async _trash(project) {
        const ok = await showConfirm(
            `Mover "${project?.name ?? ''}" para a lixeira? Você poderá restaurá-lo depois.`,
            { destructive: true, confirmText: 'Mover para lixeira' },
        );
        if (!ok) return;
        try {
            await apiClient.deleteAtlas(project.id);
            showSuccess('Atlas movido para a lixeira.');
            this._trashedLoaded = false; // re-fetch the trash next time it is opened
            await this._refresh();
        } catch (error) {
            showError(error?.message || 'Falha ao mover o atlas para a lixeira.');
        }
    }

    /**
     * @private Leave a shared atlas on one's own authority → `DELETE /atlas/:id/sharing/me`.
     *
     * THE CONFIRMATION NAMES THE TWO CONSEQUENCES, and neither of them is guessable from the word
     * "sair". First, the atlas LENT things: private layers, 3D models and 360 projects that were
     * visible only because this atlas borrowed them from its owner (clause 6.1), and they go with
     * it. Second, and this is the irreversible half, the way back is not the user's to take: only
     * whoever administers the atlas can invite again. "Tem certeza?" would have said neither.
     *
     * WHAT IS REPORTED AFTERWARDS IS WHAT THE SERVER MEASURED, never the intention: the wording
     * is {@link describeLeaveOutcome}, because a live access group or the public link can keep the
     * access alive down another path, and the card would still be there to contradict a
     * premature "você saiu". The refusal for the OWNER (409) is shown in the server's own words:
     * it names transferring ownership or trashing the atlas, and the menu already hides the item
     * from him, so reaching it means the level changed under this page.
     *
     * The grid refreshes rather than reloading the page: `_refresh` re-fetches the list and the
     * card either disappears or moves tab on its own, according to what is left.
     */
    async _leave(project) {
        const nome = String(project?.name ?? '').trim();
        const ok = await showConfirm(nome ? `Sair de "${nome}"?` : 'Sair deste atlas?', {
            message: 'Você perde o acesso a este atlas e ao que ele emprestava: as camadas, os '
                + 'modelos 3D e os projetos 360 privados que só apareciam por causa dele.\n'
                + 'E você não pode voltar sozinho: só quem administra o atlas pode convidar você '
                + 'de novo.',
            confirmText: 'Sair do atlas',
            cancelText: 'Continuar no atlas',
            destructive: true,
        });
        if (!ok) return;
        try {
            const outcome = describeLeaveOutcome(await apiClient.leaveAtlas(project?.id), nome);
            if (outcome.tone === 'success') showSuccess(outcome.message);
            else if (outcome.tone === 'warning') showWarning(outcome.message);
            else showToast(outcome.message);
            await this._refresh();
        } catch (error) {
            showError(error?.message || 'Não foi possível sair do atlas.');
        }
    }

    /** @private A trashed-atlas card: not openable; offers a Restaurar action. */
    _trashCard(project) {
        const id = String(project?.id ?? '');
        const card = document.createElement('div');
        card.className = 'atlas-drive__card atlas-drive__card--trash';
        card.dataset.testid = 'project-picker-trash-item';
        card.dataset.atlasId = id;
        // The same face it had before being trashed — recognising it is the whole job of this card.
        card.appendChild(this._thumb(project, id));

        const body = document.createElement('div');
        body.className = 'atlas-drive__card-body';
        const name = document.createElement('div');
        name.className = 'atlas-drive__card-name';
        name.textContent = project?.name ?? '';
        const meta = document.createElement('div');
        meta.className = 'atlas-drive__card-meta';
        const when = formatRelativeTime(project?.deleted_at);
        // DE QUEM É, e não só quando foi excluído. O dado SEMPRE chegou:
        // `LIST_ALL_DELETED_ATLAS` projeta `owner_nome` e `owner_username`, e o comentário acima
        // daquela consulta diz por extenso que são eles que tornam o atlas de outra pessoa
        // identificável na lista. O cartão os descartava, então a lixeira do SISTEMA (que o
        // administrador vê inteira) era uma parede de nomes de atlas sem dono, na qual restaurar o
        // alheio era indistinguível de restaurar o próprio.
        //
        // Não dá para reusar `_subtitle` aqui: as DUAS consultas de lixeira projetam o literal
        // `'owner' as user_permission`, então ele diria "por Você" em todo cartão.
        const dono = (project?.owner_nome ?? project?.owner_username ?? '').trim();
        const quando = when ? `excluído ${when}` : 'na lixeira';
        meta.textContent = dono ? `${quando} · de ${dono}` : quando;
        const restoreBtn = document.createElement('button');
        restoreBtn.type = 'button';
        restoreBtn.className = 'atlas-drive__btn atlas-drive__btn--ghost atlas-drive__restore';
        restoreBtn.dataset.testid = 'project-picker-restore';
        restoreBtn.textContent = 'Restaurar';
        addScopedDomListener(this, 'grid', restoreBtn, 'click', () => this._restore(project));
        body.append(name, meta, restoreBtn);

        card.appendChild(body);
        return card;
    }

    /** @private Restore a trashed atlas → POST /atlas/:id/restore. */
    async _restore(project) {
        // PERGUNTA QUANDO O ATLAS É DE OUTRA PESSOA, e só nesse caso. Restaurar o próprio é
        // desfazer o próprio gesto e não merece um passo a mais; restaurar o alheio devolve à
        // vista um atlas que outra pessoa jogou fora, e ela não é avisada. A distinção existe
        // porque a lixeira do SISTEMA só é visível para o administrador.
        const dono = (project?.owner_nome ?? project?.owner_username ?? '').trim();
        if (dono) {
            const ok = await showConfirm(`Restaurar "${project?.name ?? ''}"?`, {
                message: `Este atlas é de ${dono}, e foi essa pessoa que o mandou para a lixeira. `
                    + 'Restaurá-lo o devolve à lista dela, e ela não recebe aviso nenhum disso.',
                confirmText: 'Restaurar',
            });
            if (!ok) return;
        }
        try {
            await apiClient.restoreAtlas(project.id);
            showSuccess('Atlas restaurado.');
            this._trashed = (this._trashed || []).filter((p) => p.id !== project.id);
            try {
                const list = await apiClient.listAtlas();
                if (Array.isArray(list)) this._projects = list;
            } catch { /* keep the cached list */ }
            this._renderGrid();
        } catch (error) {
            showError(error?.message || 'Falha ao restaurar o atlas.');
        }
    }

    /** @private "por Você · modificado há 2 dias". */
    _subtitle(project) {
        const author = project?.user_permission === 'owner' ? 'Você' : (project?.owner_nome ?? '').trim();
        const parts = [];
        if (author) parts.push(`por ${author}`);
        const relative = formatRelativeTime(project?.updated_at);
        if (relative) parts.push(`modificado ${relative}`);
        return parts.join(' · ');
    }

    /** @private */
    async _handlePick(atlasId) {
        if (this._busy || !atlasId) return;
        this._busy = true;
        try {
            await this._onPick(atlasId);
        } catch {
            this._busy = false;
        }
    }

    /** @private Opens the create-atlas dialog; forwards name + sharing to onCreate. */
    _handleCreate() {
        if (!this._onCreate) return;
        const onCreate = this._onCreate;
        showCreateAtlasModal({ onCreate: (name, sharing) => onCreate(name, sharing) });
    }
}

/**
 * "Neste computador" — the named LOCAL atlases, as a card grid with a create tile.
 *
 * It renders what it is GIVEN and calls back for everything else: the local-atlas API lives one
 * import away, but keeping it out of here means the page has exactly one file that talks to the
 * store's local registry (`projects-page.js`), which is the file the mount gate names.
 *
 * The local/remote distinction is NEVER carried by colour alone: each card states in words that
 * the atlas stays in this browser, the way a server card states owner and permission.
 */
export class LocalAtlasSection {
    /**
     * @param {Object} options
     * @param {Array<{id: string, name: string, updatedAt: number, createdAt: number}>} [options.atlases]
     * @param {string|null} [options.currentId] - The slot the map will open by default.
     * @param {number} [options.max] - Ceiling of local atlases (`MAX_LOCAL_ATLASES`).
     * @param {Function} options.onOpen - Called with the id to open.
     * @param {Function} options.onCreate - Called with no arguments; owns the name dialog.
     * @param {Function} options.onRename - Called with the entry to rename.
     * @param {Function} [options.onDuplicate] - Called with the entry to copy.
     * @param {Function} options.onDelete - Called with the entry to delete.
     * @param {Function} [options.onOpenFile] - Called with the chosen `.ebgeo` `File`. Omitted
     *   leaves the button out entirely, rather than showing one that does nothing.
     */
    constructor(options = {}) {
        this._atlases = Array.isArray(options.atlases) ? options.atlases : [];
        this._currentId = options.currentId ?? null;
        this._max = Number.isFinite(options.max) ? options.max : null;
        this._onOpen = options.onOpen || (() => {});
        this._onCreate = options.onCreate || (() => {});
        this._onRename = options.onRename || (() => {});
        this._onDuplicate = options.onDuplicate || (() => {});
        this._onDelete = options.onDelete || (() => {});
        this._onOpenFile = options.onOpenFile || null;
        this._root = null;
        this._gridEl = null;
        this._countEl = null;
        this._fileInput = null;
        this._busy = false;
        this._menu = null;
        this._menuAnchor = null;
        this._menuOutside = null;
        this._menuTimer = null;
        setupCleanup(this);
    }

    /**
     * Builds the section into `host`.
     * @param {HTMLElement} [host]
     */
    mount(host = document.body) {
        if (this._root) return;
        this._build();
        host.appendChild(this._root);
    }

    /** Removes the section + its listeners. */
    destroy() {
        if (!this._root) return;
        this._closeMenu();
        clearScopedListeners(this, 'local-cards');
        cleanup(this);
        removeElement(this._root);
        this._root = null;
        this._gridEl = null;
        this._countEl = null;
        this._fileInput = null;
    }

    /**
     * Replaces the list after a create/rename/delete and redraws.
     * @param {Array<Object>} atlases
     * @param {string|null} currentId
     */
    setAtlases(atlases, currentId) {
        this._atlases = Array.isArray(atlases) ? atlases : [];
        this._currentId = currentId ?? null;
        this._busy = false;
        this._render();
    }

    /** @private */
    _build() {
        const root = document.createElement('section');
        root.className = 'local-atlas';
        root.dataset.testid = 'local-atlas-section';

        const header = document.createElement('header');
        header.className = 'local-atlas__header';

        const heading = document.createElement('div');
        const h = document.createElement('h2');
        h.className = 'local-atlas__title';
        h.textContent = 'Neste computador';
        const sub = document.createElement('p');
        sub.className = 'local-atlas__subtitle';
        sub.textContent = 'Atlas guardados neste navegador. Nada aqui vai para o servidor nem é visto por outras pessoas.';
        heading.append(h, sub);
        header.appendChild(heading);

        const actions = document.createElement('div');
        actions.className = 'local-atlas__actions';

        if (this._onOpenFile) actions.appendChild(this._fileButton());

        const count = document.createElement('span');
        count.className = 'local-atlas__count';
        count.dataset.testid = 'local-atlas-count';
        actions.appendChild(count);
        this._countEl = count;

        header.appendChild(actions);
        root.appendChild(header);

        const grid = document.createElement('div');
        grid.className = 'local-atlas__grid';
        grid.dataset.testid = 'local-atlas-list';
        grid.setAttribute('role', 'list');
        grid.setAttribute('aria-label', 'Atlas neste computador');
        root.appendChild(grid);

        this._root = root;
        this._gridEl = grid;
        this._render();
    }

    /**
     * @private "Abrir arquivo .ebgeo", plus the hidden input it drives.
     *
     * Both live in the HEADER and not in the grid, so `_render` (which runs on every create,
     * rename and delete) never rebuilds them: an `<input type="file">` replaced while its picker
     * is open loses the `change` that was about to arrive. The input is reset before every open,
     * or picking the same file twice in a row fires no event at all.
     */
    _fileButton() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.ebgeo';
        input.hidden = true;
        input.dataset.testid = 'local-atlas-file-input';
        addDomListener(this, input, 'change', () => {
            const file = input.files?.[0];
            input.value = '';
            if (file) this._onOpenFile(file);
        });
        this._fileInput = input;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'local-atlas__btn';
        btn.dataset.testid = 'local-atlas-open-file';
        btn.title = 'Abrir um arquivo .ebgeo como um atlas novo neste computador';
        btn.textContent = 'Abrir arquivo .ebgeo';
        addDomListener(this, btn, 'click', () => {
            this._fileInput.value = '';
            this._fileInput.click();
        });

        const wrap = document.createElement('span');
        wrap.className = 'local-atlas__action';
        wrap.append(btn, input);
        return wrap;
    }

    /** @private Rebuilds the cards + the create tile. */
    _render() {
        if (!this._gridEl) return;
        // Same reason as the server grid: this runs again on every create/rename/delete, so the
        // previous cards' listeners are released before their nodes are dropped.
        clearScopedListeners(this, 'local-cards');
        this._closeMenu();
        this._gridEl.replaceChildren();

        for (const atlas of this._atlases) {
            this._gridEl.appendChild(this._card(atlas));
        }
        this._gridEl.appendChild(this._createTile());

        if (this._countEl) {
            this._countEl.textContent = this._max
                ? `${this._atlases.length} de ${this._max}`
                : String(this._atlases.length);
        }
    }

    /** @private One local atlas. */
    _card(atlas) {
        const id = String(atlas?.id ?? '');
        const isCurrent = id !== '' && id === this._currentId;

        const wrap = document.createElement('div');
        wrap.className = 'local-atlas__card-wrap';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `local-atlas__card${isCurrent ? ' local-atlas__card--current' : ''}`;
        btn.dataset.testid = 'local-atlas-item';
        btn.dataset.localAtlasId = id;
        btn.setAttribute('role', 'listitem');
        if (isCurrent) btn.setAttribute('aria-current', 'true');

        const name = document.createElement('div');
        name.className = 'local-atlas__name';
        name.textContent = atlas?.name ?? '';
        btn.appendChild(name);

        const meta = document.createElement('div');
        meta.className = 'local-atlas__meta';
        const when = formatRelativeTime(atlas?.updatedAt);
        meta.textContent = when ? `aberto ${when}` : '';
        btn.appendChild(meta);

        const tags = document.createElement('div');
        tags.className = 'local-atlas__tags';
        const chip = document.createElement('span');
        chip.className = 'local-atlas__chip';
        chip.textContent = 'Local';
        tags.appendChild(chip);
        if (isCurrent) {
            const currentChip = document.createElement('span');
            currentChip.className = 'local-atlas__chip local-atlas__chip--current';
            currentChip.dataset.testid = 'local-atlas-current';
            currentChip.textContent = 'Atual';
            tags.appendChild(currentChip);
        }
        btn.appendChild(tags);

        // The written half of the distinction: the chip's colour says nothing to a colour-blind
        // reader, and nothing at all to a screen reader used to server cards.
        const note = document.createElement('p');
        note.className = 'local-atlas__note';
        note.textContent = 'Fica só neste navegador';
        btn.appendChild(note);

        addScopedDomListener(this, 'local-cards', btn, 'click', () => this._open(atlas));
        wrap.appendChild(btn);

        const menuBtn = document.createElement('button');
        menuBtn.type = 'button';
        menuBtn.className = 'local-atlas__menu-btn';
        menuBtn.dataset.testid = 'local-atlas-menu';
        menuBtn.setAttribute('aria-label', `Mais ações de ${atlas?.name ?? 'atlas local'}`);
        menuBtn.innerHTML = ICONS.dots; // static icon
        addScopedDomListener(this, 'local-cards', menuBtn, 'click', (e) => {
            e.stopPropagation();
            this._openMenu(atlas, menuBtn);
        });
        wrap.appendChild(menuBtn);

        return wrap;
    }

    /** @private The dashed "+ Novo atlas local" tile, always last. */
    _createTile() {
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'local-atlas__add';
        tile.dataset.testid = 'local-atlas-create';
        tile.innerHTML = ICONS.plus; // static icon
        const label = document.createElement('span');
        label.textContent = 'Novo atlas local';
        tile.appendChild(label);
        // NOT disabled at the ceiling: the refusal carries a pt-BR message that explains what to
        // do, and a dead button explains nothing.
        addScopedDomListener(this, 'local-cards', tile, 'click', () => this._onCreate());
        return tile;
    }

    /** @private */
    _open(atlas) {
        if (this._busy) return;
        this._busy = true;
        // Opening navigates away, so nothing resets `_busy` on success; a caller that stays on
        // the page (a refusal) calls `setAtlases`, which clears it.
        this._onOpen(atlas);
    }

    /** @private Card actions, anchored to the ⋯ button. */
    _openMenu(atlas, anchorBtn) {
        if (this._menu && this._menuAnchor === anchorBtn) {
            this._closeMenu();
            return;
        }
        this._closeMenu();

        const menu = document.createElement('div');
        menu.className = 'local-atlas__menu';
        menu.dataset.testid = 'local-atlas-menu-popup';
        const rect = anchorBtn.getBoundingClientRect();
        menu.style.top = `${Math.round(rect.bottom + 4)}px`;
        menu.style.left = `${Math.round(rect.right - 200)}px`;

        const addItem = (label, testid, danger, fn) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = `local-atlas__menu-item${danger ? ' local-atlas__menu-item--danger' : ''}`;
            item.dataset.testid = testid;
            item.textContent = label;
            item.addEventListener('click', () => { this._closeMenu(); fn(); });
            menu.appendChild(item);
        };

        addItem('Abrir', 'local-atlas-open', false, () => this._open(atlas));
        addItem('Renomear', 'local-atlas-rename', false, () => this._onRename(atlas));
        // Mesmo rótulo do cartão de servidor: é a mesma ação para o usuário, ainda que por baixo
        // uma seja uma rota do backend e a outra uma cópia banco a banco entre dois namespaces de
        // IndexedDB (`copyAtlasDatabases`).
        // Ver a nota do irmão de servidor em `cardMenuActions`: o rótulo diz ONDE a cópia nasce.
        addItem('Copiar neste computador', 'local-atlas-duplicate', false, () => this._onDuplicate(atlas));
        addItem('Excluir', 'local-atlas-delete', true, () => this._onDelete(atlas));

        this._root.appendChild(menu);
        this._menu = menu;
        this._menuAnchor = anchorBtn;
        this._menuOutside = (e) => {
            // contains(): the click may land on the button's inner <svg>, which is not the button.
            if (!menu.contains(e.target) && !anchorBtn.contains(e.target)) this._closeMenu();
        };
        this._menuTimer = setTimeout(() => {
            this._menuTimer = null;
            document.addEventListener('mousedown', this._menuOutside);
        }, 0);
    }

    /** @private */
    _closeMenu() {
        if (this._menuTimer != null) { clearTimeout(this._menuTimer); this._menuTimer = null; }
        if (this._menu) { this._menu.remove(); this._menu = null; }
        this._menuAnchor = null;
        if (this._menuOutside) {
            document.removeEventListener('mousedown', this._menuOutside);
            this._menuOutside = null;
        }
    }
}

/**
 * The signed-out invitation that stands where the server section goes.
 *
 * Its own component so the page never has to render a half-alive Drive: with no session there is
 * no list to filter, no trash to open and no create to offer, and a disabled copy of all of that
 * would be a promise the page cannot keep.
 *
 * @param {Object} options
 * @param {Function} options.onLogin - Called when the visitor asks to sign in.
 * @returns {HTMLElement}
 */
export function createServerInvite({ onLogin }) {
    const section = document.createElement('section');
    section.className = 'server-invite';
    section.dataset.testid = 'server-invite';

    const h = document.createElement('h2');
    h.className = 'server-invite__title';
    h.textContent = 'No servidor';
    section.appendChild(h);

    const text = document.createElement('p');
    text.className = 'server-invite__text';
    text.textContent = 'Entre para abrir os atlas do servidor, colaborar em tempo real e compartilhar '
        + 'com sua equipe. Os atlas deste computador continuam funcionando sem conta.';
    section.appendChild(text);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'atlas-drive__btn atlas-drive__btn--primary';
    btn.dataset.testid = 'projects-login';
    btn.textContent = 'Entrar';
    btn.addEventListener('click', () => onLogin());
    section.appendChild(btn);

    return section;
}
