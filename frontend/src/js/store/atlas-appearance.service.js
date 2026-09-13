// Path: js/store/atlas-appearance.service.js

/**
 * @module store/atlas-appearance
 * @description Como o mapa 2D DESTE projeto se parece: exagero vertical do terreno e projeção
 * globo. Duas preferências, uma casa, e a casa é o atlas — local ou de servidor, sem diferença.
 *
 * POR QUE NÃO PELO `PATCH /atlas/:id/settings`, que é onde moram as outras configurações de
 * projeto: aquela rota é REST, gate `manage`, e um atlas LOCAL não tem rota nenhuma. Estas duas
 * viajam como OPERAÇÃO DE SYNC (`EntityType.SETTING`), que é o caminho que já existia para o
 * exagero e que funciona igual nos dois casos — offline vira no-op, e o backend mescla a chave
 * pela mesma whitelist (`sync.service.js`). É também o gate certo: quem pode desenhar pode
 * escolher o exagero, e escolher o exagero não é redistribuir recurso.
 *
 * A PROJEÇÃO TEM DOIS ESTADOS, globo ou plano, e o padrão é GLOBO. Ela chegou a ter três, com um
 * "padrão do sistema" que herdava `config.map2d.globe_projection` do painel do administrador; o
 * dono cortou a terceira em 2026-08-16, e a razão é boa: uma escolha de duas respostas não precisa
 * de uma terceira que o usuário tem de traduzir mentalmente para saber o que vai ver. A config de
 * deploy continua existindo para outras coisas, mas não decide mais isto.
 */

import { getRepository } from '@store/repositories/index.js';
import { OperationType } from '@store/sync/operation-dispatcher.js';
// Módulo folha (zero imports): o vocabulário, não o barril.
import { EntityType } from '@store/sync/operation-types.js';
import { checkPermission, GuardAction } from '@store/sync/permission-guard.js';
import { emitStoreError, StoreErrorEvents } from '@store/store-errors.js';
import { runTransaction } from '@store/store-transaction.js';
import { resolveAtlasSettingId } from '@store/atlas-setting-target.js';
import { DEFAULT_TERRAIN_EXAGGERATION } from '@store/atlas/atlas.entity.js';

/** Limites do exagero, iguais aos do controle que o desenha. */
export const MIN_EXAGGERATION = 1;
export const MAX_EXAGGERATION = 3;

/**
 * As chaves de `atlas.settings` que este módulo escreve, e a razão de serem uma CONSTANTE e não
 * dois `if`: elas dividem a chave de compactação `<escopo>:setting:<atlas>` com as outras
 * preferências, então o inventário delas é fato de contrato, cobrado por
 * `tests/unit/compactacao-id-nao-unico.test.js`. Aquele extrator lia literais inline nos
 * chamadores; com a escrita centralizada aqui, ele lê ESTA lista, que é a autoridade viva.
 * @type {readonly string[]}
 */
export const APPEARANCE_KEYS = Object.freeze(['terrainExaggeration', 'globeProjection']);

/**
 * Lê as duas preferências do atlas montado.
 *
 * @returns {Promise<{terrainExaggeration: number, globeProjection: boolean|null}>}
 *   `globeProjection` devolve `null` quando o projeto não decidiu — quem quer o valor EFETIVO
 *   chama {@link resolveGlobeProjection}, e a distinção entre os dois é o ponto desta API.
 */
export async function readAtlasAppearance() {
    try {
        const atlas = await getRepository().getAtlas();
        const settings = atlas?.settings || {};
        const exaggeration = Number(settings.terrainExaggeration);
        return {
            terrainExaggeration: Number.isFinite(exaggeration) ? exaggeration : DEFAULT_TERRAIN_EXAGGERATION,
            // `?? null` e não `|| null`: `false` é uma escolha, e um OR a transformaria em herança.
            globeProjection: settings.globeProjection ?? null,
        };
    } catch (error) {
        console.warn('[atlas-appearance] read failed:', error);
        return { terrainExaggeration: DEFAULT_TERRAIN_EXAGGERATION, globeProjection: null };
    }
}

/**
 * Grava um patch parcial, no disco e na fila de saída.
 *
 * A ORDEM MUDOU EM 2026-09-13, E A ANTIGA ERA O DEFEITO. Ela era "persistência primeiro, op
 * depois", com o argumento de que uma falha de disco não deveria deixar o servidor com um valor
 * que esta máquina não tem. O custo era o inverso e maior: gravado o disco, uma falha ao
 * registrar a op (ou o fechamento da aba um instante depois) perdia a intenção sem rastro
 * nenhum, e a pessoa via a própria escolha valer nesta máquina e em nenhuma outra, para sempre.
 * Agora a intenção é registrada ANTES, dentro de `runTransaction`, e o diário é que segura a
 * outra ponta: op preparada cuja projeção local não foi materializada não é enviável
 * (`operation-queue.js`), então o servidor não recebe valor que o disco não tem.
 *
 * O `TRY/CATCH` QUE ENGOLIA TUDO SAIU, e essa é a outra metade. Ele devolvia `false` para
 * qualquer falha, então quota de IndexedDB e escrita cancelada por descarte de sessão eram
 * relatadas ao chamador como "não gravei" e ao usuário como nada: `_handleSave`
 * (`modals/atlas-settings.modal.js`) nem lê o retorno, mostra "Configurações salvas." e fecha o
 * modal. Falha de persistência agora PROPAGA, com `STORE_PERSIST_ERROR` emitido por
 * `runTransaction`, e o `false` ficou com o único sentido que tem dono: não havia o que gravar
 * (patch vazio) ou a permissão recusou.
 *
 * @param {{terrainExaggeration?: number, globeProjection?: boolean|null}} patch - Só as chaves
 *   presentes são tocadas; `globeProjection: null` é uma escrita legítima ("volte a herdar").
 * @returns {Promise<boolean>} True quando gravou; false num patch vazio ou sem permissão.
 * @throws {Error} Quando a persistência falha (quota, escopo trocado, sessão descartada).
 */
export async function saveAtlasAppearance(patch) {
    // This function journals a `setting` op, which the server refuses from a reader, and a
    // refused op stalls the whole outbound queue. Permissive offline and on a local store, so
    // the anonymous user keeps full control of their own workspace.
    const perm = checkPermission(GuardAction.UPDATE_ATLAS_SETTINGS);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, {
            operation: 'saveAtlasAppearance',
            reason: perm.reason,
            required: perm.required
        });
        return false;
    }

    const changes = {};
    for (const key of APPEARANCE_KEYS) {
        if (patch[key] !== undefined) changes[key] = patch[key];
    }
    if (Object.keys(changes).length === 0) return false;

    await runTransaction(async tx => {
        const repo = getRepository();
        // `ensureAtlas`, NUNCA `getAtlas`. Um atlas sem registro é o caso comum, não a exceção: o
        // slot local nasce com mapas e sem linha de Atlas, e `getAtlas()` devolve null ali. O modal
        // anterior desistia em silêncio nesse ramo (`if (!atlas) return`), e o efeito era exatamente
        // o que o usuário relatou — escolher, ver o mapa mudar, dar F5 e encontrar tudo como antes.
        // O exagero vertical sofria do mesmo mal desde sempre, pelo mesmo `if`.
        const atlas = await repo.ensureAtlas();
        const previous = {};
        for (const key of APPEARANCE_KEYS) {
            if (changes[key] !== undefined) previous[key] = atlas.settings?.[key] ?? null;
        }
        if (!atlas.settings) atlas.settings = {};
        Object.assign(atlas.settings, changes);
        tx.recordOperation(EntityType.SETTING, OperationType.UPDATE,
            await resolveAtlasSettingId(tx.scope, atlas), null, changes, previous);
        return () => repo.saveAtlas(atlas);
    });
    return true;
}

/**
 * Aplica uma mudança de aparência que veio DE OUTRO CLIENTE: persiste, atualiza o cache e mexe no
 * mapa vivo.
 *
 * SEM LOGAR OPERAÇÃO, e é a única diferença em relação a {@link saveAtlasAppearance} — registrar
 * uma op aqui devolveria ao servidor o que dele veio, e dois clientes ficariam ecoando um ao outro
 * indefinidamente.
 *
 * @param {{terrainExaggeration?: number, globeProjection?: boolean|null}} patch
 * @param {{setExaggeration?: Function}} [terrainControl] - O controle de terreno, quando existe.
 * @param {{setProjection?: Function, setSky?: Function}} [map] - O mapa vivo, quando existe.
 * @returns {Promise<void>}
 */
export async function applyRemoteAppearance(patch, terrainControl, map, { repository, assertActive = () => {}, present = fn => fn() } = {}) {
    const changes = {};
    for (const key of APPEARANCE_KEYS) {
        if (patch?.[key] !== undefined) changes[key] = patch[key];
    }
    if (Object.keys(changes).length === 0) return;

    const repo = repository ?? getRepository();
    assertActive();
    const atlas = await repo.ensureAtlas();
    assertActive();
    if (!atlas.settings) atlas.settings = {};
    Object.assign(atlas.settings, changes);
    await repo.saveAtlas(atlas);
    assertActive();

    await present(() => {
        assertActive();
        if (changes.terrainExaggeration !== undefined) {
            terrainControl?.setExaggeration?.(changes.terrainExaggeration);
        }
        if (changes.globeProjection !== undefined) {
            setGlobeChoice(changes.globeProjection);
            // Terrain owns projection while active; its control restores the saved choice.
            if (map?.setProjection && !terrainControl?._wasTerrainActive) {
                map.setProjection({ type: currentGlobeProjection() ? 'globe' : 'mercator' });
                map.setSky?.(undefined);
            }
        }
    });
}

/**
 * A projeção que o mapa deve usar AGORA: a escolha do projeto quando existe, o padrão do deploy
 * quando não.
 *
 * Síncrona de propósito, e alimentada por quem já leu o atlas: os pontos que aplicam projeção
 * (`map_sig.js` no boot, `base-layer.control.js` a cada troca de estilo, `terrain.control.js` ao
 * ligar/desligar o relevo) rodam em caminhos quentes onde uma leitura de IndexedDB seria um await
 * no meio de um `styledata`.
 *
 * @param {boolean|null|undefined} atlasChoice - O que {@link readAtlasAppearance} devolveu.
 * @returns {boolean} True quando o mapa deve ser um globo.
 */
export function resolveGlobeProjection(atlasChoice) {
    // SÓ `false` tira o globo. Qualquer outra coisa — ausência, `null`, ou lixo de um `settings`
    // antigo — é o padrão, e o padrão é globo. A comparação estrita importa: um `!atlasChoice`
    // leria `0` e `''` como "plano", e nenhum dos dois significa isso.
    return atlasChoice !== false;
}

/**
 * A escolha do atlas montado, em memória.
 *
 * EXISTE PORQUE OS CONSUMIDORES SÃO SÍNCRONOS. Três pontos aplicam projeção, e nenhum deles pode
 * esperar o disco: o boot (antes do primeiro quadro), a troca de estilo de mapa base (dentro do
 * `styledata`, que reseta a projeção) e o liga/desliga do relevo (globo e terreno são
 * incompatíveis, MapLibre #4792). Um `await` em qualquer um dos três aparece como piscada.
 * @type {boolean|null}
 */
let _globeChoice = null;

/**
 * Recarrega o cache a partir do atlas montado. Chamada no boot e sempre que o atlas TROCA — sem
 * isso, abrir outro projeto herdaria a projeção do anterior, que é o defeito clássico de estado
 * em módulo sobrevivendo a uma troca de escopo.
 * @returns {Promise<{terrainExaggeration: number, globeProjection: boolean|null}>}
 */
export async function refreshAtlasAppearance() {
    const appearance = await readAtlasAppearance();
    _globeChoice = appearance.globeProjection;
    return appearance;
}

/**
 * Relê a aparência do atlas MONTADO AGORA e a aplica no mapa e no terreno.
 *
 * CHAMADA DEPOIS DE TROCAR DE ATLAS, e é o que impede o vazamento entre projetos: o cache vive no
 * módulo, então um atlas local marcado como "plano" deixava o mapa plano dentro de um atlas de
 * servidor que nunca escolheu nada. O boot sozinho não resolve, porque ele lê ANTES de o namespace
 * do atlas aberto estar montado e antes de o snapshot chegar.
 *
 * @param {{setExaggeration?: Function, _wasTerrainActive?: boolean}} [terrainControl]
 * @param {{setProjection?: Function, setSky?: Function}} [map]
 * @returns {Promise<void>}
 */
export async function reapplyAtlasAppearance(terrainControl, map) {
    const { terrainExaggeration } = await refreshAtlasAppearance();
    terrainControl?.setExaggeration?.(terrainExaggeration);
    if (map?.setProjection && !terrainControl?._wasTerrainActive) {
        map.setProjection({ type: currentGlobeProjection() ? 'globe' : 'mercator' });
        map.setSky?.(undefined);
    }
}

/**
 * Atualiza o cache sem ir ao disco (o modal já sabe o que gravou).
 * @param {boolean|null} choice
 */
export function setGlobeChoice(choice) {
    _globeChoice = choice === true || choice === false ? choice : null;
}

/** @returns {boolean} A projeção efetiva do atlas montado, agora. */
export function currentGlobeProjection() {
    return resolveGlobeProjection(_globeChoice);
}
