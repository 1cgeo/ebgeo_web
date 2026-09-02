// Path: js/session/migalhas-do-barramento.js

/**
 * @fileoverview O ALIMENTADOR DE MIGALHAS QUE OUVE O BARRAMENTO: UMA assinatura `onAny`, com
 * allowlist, que transforma um punhado de eventos de ciclo de vida em linhas curtas de trilha.
 *
 * A FORMA É A DO `store/sync/diag/bus-tap.js`, e a razão é a mesma: uma assinatura observa o
 * barramento inteiro, e o custo por emissão é uma consulta de tabela. Os eventos quentes (o cursor
 * temporal a cada rAF, o cursor de presença) CHEGAM aqui e são ignorados numa falta de chave, nunca
 * bufferizados.
 *
 * ── O QUE VIAJA, E POR QUE TÃO POUCO ─────────────────────────────────────────────────────────
 *
 * A migalha é o NOME DO EVENTO mais, no máximo, um punhado de campos ENUMERADOS do payload. Nunca o
 * payload, nunca `properties`, nunca `geometry`, nunca nome nem id de feição, nunca `userId`. A
 * razão é a mesma que fez `formaDeValor` substituir um `JSON.stringify` do outro lado: telemetria é
 * o tipo de dado que acaba num log, num relatório e num anexo de e-mail, e o payload de um evento
 * deste produto carrega o `nome` que a pessoa escreveu e as coordenadas decimais de onde ela está.
 *
 * SÃO DUAS PORTEIRAS EM SÉRIE, e a segunda existe porque a primeira é uma lista escrita à mão:
 *
 *   1. A ALLOWLIST DE CAMPOS ({@link REGRAS}): só os campos nomeados ali são lidos do payload. Um
 *      campo novo num evento já observado não passa a viajar sozinho.
 *   2. A FORMA DO VALOR ({@link rotuloSeguro}): o que for lido só viaja se PARECER um símbolo
 *      (letra inicial, sem espaço, curto). Isso é defesa em profundidade, e ela morde de verdade:
 *      o `operation` de `STORE_PERSIST_ERROR` é montado como `persist <rótulo> [<chave>]` e a
 *      chave é o nome de um mapa, ou seja, texto de gente. Ele não passa, e a migalha degrada para
 *      o nome do evento sozinho, que é o desfecho certo.
 *
 * NÃO EXISTE EVENTO DE TROCA DE MAPA neste vocabulário, e a busca por um se perde: `EventTypes` tem
 * `MAP_CREATED`/`MAP_MODIFIED`/`MAP_DELETED` (ciclo de vida da entidade) e `ATLAS_SWITCHED`, que é
 * a troca de ATLAS ao vivo. A trilha registra o segundo, pelo `kind`, que é enumerado.
 *
 * SÓ O MAPA INSTALA ISTO. As outras três páginas (`atlas.html`, `admin.html`, `calibracao.html`)
 * bootam sem `initServices()` e portanto sem barramento; elas ganham as migalhas de API, de console
 * e de navegação, que não dependem dele.
 */

import { EventTypes } from '@events/event_types.js';
// Pelo ARQUIVO, e não pelo barril `@store`: o barril arrasta a store inteira. `store-errors.js` é
// folha de zero imports, e é onde os três eventos de erro do store moram (eles NÃO estão em
// `event_types.js`, de propósito, o que já custou uma busca no arquivo errado).
import { StoreErrorEvents } from '@store/store-errors.js';
import { migalhas, TipoDeMigalha } from './migalhas.js';

/**
 * A FORMA DE UM RÓTULO QUE PODE VIAJAR: começa com letra, não tem espaço, e é curto.
 *
 * Ela recusa por CONSTRUÇÃO o que é texto de gente (tem espaço, começa com maiúscula acentuada ou
 * com pontuação) e o que é coordenada (começa com dígito ou com sinal). Ela NÃO é a proteção
 * principal, que é a lista de campos: um id opaco casaria esta forma sem problema. Ver o
 * `fileoverview`.
 */
const RE_ROTULO = /^[A-Za-z][A-Za-z0-9_.:-]{0,39}$/;

/**
 * O valor, se ele parecer um símbolo. Vazio caso contrário.
 * @param {*} valor
 * @returns {string}
 */
function rotuloSeguro(valor) {
    if (typeof valor !== 'string') return '';
    const limpo = valor.trim();
    return RE_ROTULO.test(limpo) ? limpo : '';
}

/**
 * A ALLOWLIST: evento observado, tipo de migalha e os campos do payload que podem viajar.
 *
 * `Map` e não objeto literal, pelo mesmo motivo que `PAGINAS` usa `Object.hasOwn`: a chave vem de
 * fora (é o nome do evento que alguém emitiu), e um objeto responderia por herança de protótipo a
 * um evento chamado `toString`.
 *
 * A LISTA DE CAMPOS É QUASE SEMPRE VAZIA, e isso é o desenho: o fato útil é que o visualizador 3D
 * abriu, não QUAL modelo; que a apresentação começou, não QUAL briefing. Um id ali não ajudaria a
 * ler a trilha e passaria a viajar para sempre.
 */
const REGRAS = new Map([
    // A sessão: `mode` (OFFLINE/ONLINE) e `role`. NUNCA `userId`, que também vem no payload: quem
    // é a pessoa é assunto do token que o navegador anexa, e um `userId` no corpo é um `userId`
    // que qualquer um escreve (é a mesma regra que o corpo do relato já aplica).
    [EventTypes.SESSION_CHANGED, { tipo: TipoDeMigalha.SESSAO, campos: ['mode', 'role'] }],
    // A conexão: só o estado de DESTINO. `previousState` também viaja no payload e não acrescenta
    // nada a uma trilha que já é ordenada no tempo.
    [EventTypes.CONNECTION_STATE_CHANGED, { tipo: TipoDeMigalha.CONEXAO, campos: ['currentState'] }],
    // Os dois visualizadores pesados. Eles são a primeira pergunta de todo defeito de memória e de
    // WebGL, e o `tilesetId`/`photoName` do payload fica de fora por ser id e nome.
    [EventTypes.VIEWER_3D_OPENED, { tipo: TipoDeMigalha.EVENTO, campos: [] }],
    [EventTypes.VIEWER_3D_CLOSED, { tipo: TipoDeMigalha.EVENTO, campos: [] }],
    [EventTypes.STREETVIEW_360_OPENED, { tipo: TipoDeMigalha.EVENTO, campos: [] }],
    [EventTypes.STREETVIEW_360_CLOSED, { tipo: TipoDeMigalha.EVENTO, campos: [] }],
    // A apresentação de briefing, que troca o modo da aplicação inteira.
    [EventTypes.BRIEFING_PRESENT_STARTED, { tipo: TipoDeMigalha.EVENTO, campos: [] }],
    [EventTypes.BRIEFING_PRESENT_ENDED, { tipo: TipoDeMigalha.EVENTO, campos: [] }],
    // Qual grupo de ferramentas a pessoa abriu: `draw`, `military`, `analysis`. Enumerado.
    [EventTypes.TOOLBAR_GROUP_OPENED, { tipo: TipoDeMigalha.EVENTO, campos: ['group'] }],
    // A troca de atlas ao vivo: `kind` é `remote` ou `local`. O `atlasId` fica de fora porque o
    // relato já carrega o atlas em foco no campo próprio dele.
    [EventTypes.ATLAS_SWITCHED, { tipo: TipoDeMigalha.EVENTO, campos: ['kind'] }],
    // Os três do store. `operation` quase nunca passa a porteira de forma (ver o `fileoverview`),
    // e `reason` de `STORE_OPERATION_BLOCKED` passa sempre, porque é símbolo (`map_locked`).
    [StoreErrorEvents.STORE_PERSIST_ERROR, { tipo: TipoDeMigalha.EVENTO, campos: ['operation'] }],
    [StoreErrorEvents.STORE_SYNC_ERROR, { tipo: TipoDeMigalha.EVENTO, campos: ['operation'] }],
    [StoreErrorEvents.STORE_OPERATION_BLOCKED, { tipo: TipoDeMigalha.EVENTO, campos: ['reason'] }],
]);

/**
 * Os eventos observados, na ordem em que foram declarados. Exportado para o teste de privacidade,
 * que precisa emitir TODOS eles com um payload hostil: uma lista escrita à mão lá deixaria o
 * evento novo sem cobertura no dia em que ele entrasse aqui.
 * @type {ReadonlyArray<string>}
 */
export const EVENTOS_OBSERVADOS = Object.freeze([...REGRAS.keys()]);

/**
 * O manipulador único. Sai na hora para tudo que não está na allowlist.
 * @param {string} evento
 * @param {Object} payload
 */
function aoEvento(evento, payload) {
    try {
        const regra = REGRAS.get(evento);
        if (!regra) return;
        const partes = [evento];
        for (const campo of regra.campos) {
            let bruto;
            try {
                bruto = payload?.[campo];
            } catch {
                // Getter hostil ou objeto de outro realm: o campo simplesmente não viaja.
                continue;
            }
            const rotulo = rotuloSeguro(bruto);
            if (rotulo) partes.push(rotulo);
        }
        migalhas.registrar(regra.tipo, partes.join(' '));
    } catch {
        // A escuta NUNCA pode quebrar a entrega de evento: ela observa, não participa.
    }
}

/**
 * A assinatura viva, ou `null`. Módulo-global de propósito: um `import()` repetido ou uma recarga
 * parcial de HMR não pode dobrar a trilha, e uma migalha duplicada é contagem falsa.
 * @type {(() => void)|null}
 */
let _remover = null;

/**
 * Instala a escuta no barramento da aplicação. Idempotente e best-effort.
 *
 * CHAMADA UMA VEZ, logo depois de `initServices()` (`js/index.js`), que é o primeiro instante em
 * que `getEventBus()` existe.
 * @param {Object} eventBus - O barramento (`events/event_emitter.js`).
 * @returns {() => void} A função que desfaz a assinatura.
 */
export function instalarMigalhasDoBarramento(eventBus) {
    try {
        if (_remover) return _remover;
        if (typeof eventBus?.onAny !== 'function') return () => {};
        const soltar = eventBus.onAny(aoEvento);
        _remover = () => {
            try {
                soltar();
            } catch {
                // Barramento já destruído: não há o que soltar.
            }
            _remover = null;
        };
        return _remover;
    } catch {
        return () => {};
    }
}
