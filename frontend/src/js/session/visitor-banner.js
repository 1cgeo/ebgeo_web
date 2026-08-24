// Path: js/session/visitor-banner.js

/**
 * @fileoverview A FAIXA PERSISTENTE DA VISITA PÚBLICA (achado A2, decisão do dono de 2026-08-24:
 * "faixa no público"). Quem chega por `?atlasPublico=` passa a ter, enquanto durar a visita, o
 * nome do atlas, a palavra "somente leitura" e uma saída com nome.
 *
 * FAMÍLIA VISUAL DO `DEGRADED_NOTICE` DO TAB-LOCK, e a escolha é a mesma que aquele fez, pelo
 * mesmo motivo: FAIXA, não overlay. O visitante está usando o produto, não sendo interrompido por
 * ele; um cartão modal transformaria "você está numa visita" em "o app parou". A faixa é visível,
 * não engole o mapa, e termina num botão.
 *
 * ELA SOBREPÕE, NUNCA OCUPA ALTURA. `index.html` monta o `<body>` como flex de coluna com
 * `#map-sig` a 100% de altura: um elemento em fluxo acima do mapa ENCOLHERIA o canvas, e o
 * MapLibre só descobriria isso num `resize` que ninguém dispara. É a mesma razão pela qual o
 * cabeçalho da calibração sobrepõe em vez de empurrar (ver o comentário de layout de
 * `src/css/calibracao.css`, onde a razão de aspecto do viewport é contrato); aqui o preço da
 * sobreposição é uma tira do topo do mapa que deixa de arrastar a câmera, e o preço da altura
 * seria um canvas de tamanho errado.
 *
 * A VISIBILIDADE É DERIVADA, nunca ligada e desligada por quem lembrou. A única fonte é
 * `sessionContext.isVisitor()`, reavaliada a cada `SESSION_CHANGED`. Um par de `show()`/`hide()`
 * espalhado pelos caminhos de sessão é a forma que termina com uma faixa dizendo "visita pública"
 * por cima de um atlas que já não é o visitado.
 *
 * E ESTE É O PRIMEIRO CONSUMIDOR DE INTERFACE DE `isVisitor()`. Até 2026-08-24 os dois únicos
 * usos daquele predicado em `frontend/src/js/` estavam ambos em
 * `store/sync/tab-lock-sync-brake.js`: o produto sabia que havia um visitante e nunca dizia isso
 * a ele. Gatear por aqui também faz a faixa falhar FECHADA: ela não tem como aparecer para quem
 * entrou numa conta nem para o anônimo de mapa local, que não estão em visita nenhuma.
 */

import { getEventBus } from '@store/services.js';
import { EventTypes } from '@events/event_types.js';
import { sessionContext } from '@store/sync/session-context.js';
import { setupCleanup, subscribe, addDomListener, cleanup, removeElement } from '@utils/event-cleanup.js';
import { visitorBannerNotice } from './visitor-banner-phrases.js';

/** Ícone estático (olho). Nenhum dado de usuário passa por aqui. */
const EYE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
    + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>'
    + '<circle cx="12" cy="12" r="3"/></svg>';

/**
 * A página de escolha de atlas, que é PARA ONDE a saída leva.
 *
 * A saída já existia e não se anunciava (pergunta P3 da auditoria): o botão "Abrir" leva a esta
 * mesma página. O que faltava era alguém chamá-la de saída.
 */
const EXIT_HREF = './atlas.html';

class VisitorBanner {
    constructor() {
        /** @type {HTMLElement|null} */
        this._el = null;
        /** @type {HTMLElement|null} */
        this._titleEl = null;
        /** @type {*} O nome cru do atlas visitado. */
        this._atlasName = null;
        setupCleanup(this);
    }

    /**
     * Wires the session listener and syncs to the current state. Idempotent per instance.
     * @param {*} atlasName - Raw atlas name from the public-link response.
     */
    init(atlasName) {
        this._atlasName = atlasName;
        subscribe(this, getEventBus(), EventTypes.SESSION_CHANGED, () => this._sync());
        this._sync();
    }

    /**
     * Replaces the atlas being announced (a second public open in the same page session, e.g. the
     * tab-lock "Usar aqui" replay).
     * @param {*} atlasName
     */
    setAtlasName(atlasName) {
        this._atlasName = atlasName;
        this._sync();
    }

    /** @private Derives visibility from the session; builds the element on first show. */
    _sync() {
        if (!sessionContext.isVisitor()) {
            this._el?.classList.remove('visitor-banner--visible');
            return;
        }
        if (!this._el) this._build();
        this._titleEl.textContent = visitorBannerNotice(this._atlasName).title;
        this._el.classList.add('visitor-banner--visible');
    }

    /**
     * @private Builds the banner once. THE ATLAS NAME GOES IN THROUGH `textContent`: it is data
     * written by another person and the only markup here is the static icon.
     */
    _build() {
        const notice = visitorBannerNotice(this._atlasName);
        const el = document.createElement('div');
        el.className = 'visitor-banner';
        // `status`, not `alert`: nothing is wrong, and an assertive live region would talk over
        // whatever the screen reader is doing at boot.
        el.setAttribute('role', 'status');

        const icon = document.createElement('div');
        icon.className = 'visitor-banner__icon';
        icon.innerHTML = EYE_ICON;

        const text = document.createElement('div');
        text.className = 'visitor-banner__text';

        const title = document.createElement('strong');
        title.className = 'visitor-banner__title';
        title.textContent = notice.title;

        const message = document.createElement('p');
        message.className = 'visitor-banner__message';
        message.textContent = notice.message;

        const exit = document.createElement('button');
        exit.className = 'visitor-banner__exit';
        exit.type = 'button';
        exit.textContent = notice.exitLabel;
        exit.title = notice.exitHint;
        addDomListener(this, exit, 'click', () => this._exit());

        text.append(title, message);
        el.append(icon, text, exit);
        document.body.appendChild(el);

        this._el = el;
        this._titleEl = title;
    }

    /**
     * @private Leaves the visit.
     *
     * `assign`, NEVER `replace`, and that is the whole treatment of the URL. The public link is
     * the only thing this visitor owns: pushing a history entry keeps `?atlasPublico=` one Back
     * away, while `replace` would burn the current entry and destroy the link. Nothing here
     * touches the query string either, for the same reason `buildAtlasSearch` preserves
     * `atlasPublico` by contract.
     */
    _exit() {
        window.location.assign(EXIT_HREF);
    }

    /** Removes the banner and every listener it holds. */
    destroy() {
        cleanup(this);
        removeElement(this._el);
        this._el = null;
        this._titleEl = null;
    }
}

/** @type {VisitorBanner|null} One banner per page session. */
let _instance = null;

/**
 * Mounts (or updates) the public-visit banner. Call it right after a public link finished opening.
 *
 * Best-effort by design: it is the LAST step of a boot path that already succeeded, so a failure
 * here must not turn an open atlas into a failed one. The boolean is what lets the caller keep the
 * old transient announcement as a floor instead of leaving the visitor with nothing.
 *
 * @param {*} atlasName - Raw atlas name from the public-link response (may be missing).
 * @returns {boolean} true when the banner is up.
 */
export function showVisitorBanner(atlasName) {
    try {
        if (!sessionContext.isVisitor()) return false;
        if (_instance) {
            _instance.setAtlasName(atlasName);
        } else {
            _instance = new VisitorBanner();
            _instance.init(atlasName);
        }
        return true;
    } catch (error) {
        console.warn('[visitor-banner] mount failed:', error);
        return false;
    }
}

/** Tears the banner down (tests / teardown). */
export function destroyVisitorBanner() {
    _instance?.destroy();
    _instance = null;
}
