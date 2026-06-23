// Path: js/ui/unavailable-screen.js

/**
 * @fileoverview Branded "EBGeo indisponível" screen, shown at boot when the backend
 * (`GET /api/config`) is unreachable. The deploy always ships a backend and the config/
 * catalog is 100% server-sourced, so without it there is nothing to boot — we surface a
 * clear branded screen instead of starting on an empty config.
 */

let _shown = false;

/**
 * Renders a full-screen branded unavailable screen (idempotent). Uses the EBGeo logo served by
 * the frontend (so it loads even with the backend down) and offers a "Tentar novamente" reload.
 */
export function showUnavailableScreen() {
    if (_shown) return;
    _shown = true;

    // The boot splash (#initial-loader) is normally removed once the app finishes loading; on a
    // fail-fast boot it never does, so remove it here so the unavailable screen is visible.
    document.getElementById('initial-loader')?.remove();

    const screen = document.createElement('div');
    screen.className = 'ebgeo-unavailable';
    screen.setAttribute('role', 'alert');
    screen.dataset.testid = 'ebgeo-unavailable';

    const card = document.createElement('div');
    card.className = 'ebgeo-unavailable__card';

    const logo = document.createElement('img');
    logo.className = 'ebgeo-unavailable__logo';
    logo.src = '/images/logo_ebgeo.webp';
    logo.alt = 'EBGeo';
    card.appendChild(logo);

    const title = document.createElement('h1');
    title.className = 'ebgeo-unavailable__title';
    title.textContent = 'EBGeo indisponível';
    card.appendChild(title);

    const msg = document.createElement('p');
    msg.className = 'ebgeo-unavailable__msg';
    msg.textContent = 'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.';
    card.appendChild(msg);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ebgeo-unavailable__btn';
    btn.dataset.testid = 'ebgeo-unavailable-retry';
    btn.textContent = 'Tentar novamente';
    btn.addEventListener('click', () => window.location.reload());
    card.appendChild(btn);

    screen.appendChild(card);
    document.body.appendChild(screen);
}
