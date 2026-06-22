// Path: e2e-ui/_capture-comments.mjs
// Standalone Playwright capture (NOT a spec — run with `node`). Stress-tests the spatial-comment
// UI with MANY comments (open + resolved + replies) to check the Maps-panel list and the map pins.
//   node tests/e2e-ui/_capture-comments.mjs   (with `npm run dev` running on :3000)

import { chromium } from '@playwright/test';

const BASE = process.env.CAPTURE_URL || 'http://localhost:3000';
const OUT = 'screenshots';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 820 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.warn('[pageerror]', e.message));

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
    () => globalThis.__ebgeoMap && typeof globalThis.__ebgeoMap.loaded === 'function' && globalThis.__ebgeoMap.loaded(),
    { timeout: 40000 },
);
await page.evaluate(() => globalThis.__ebgeoMap.jumpTo({ center: [-43.18, -22.91], zoom: 14, bearing: 0, pitch: 0 }));
await page.waitForTimeout(3500);

// ── Tool behavior + compose card (empty map, before seeding) ──
// Shift+C activates the comment TOOL → the active-tool chip ("Ferramenta ativa: Comentário") shows.
await page.keyboard.press('Shift+C');
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/tool-01-chip.png` });
// Click the (empty) map center → the compose card opens at that coordinate.
await page.mouse.click(683, 410);
await page.waitForSelector('[data-testid="comment-compose"]', { timeout: 5000 }).catch(() => {});
await page.fill('[data-testid="comment-compose-input"]', 'Reforçar a vigilância neste acesso à ponte ao amanhecer, antes do nascer do sol.').catch(() => {});
await page.waitForTimeout(300);
const composeCard = await page.$('[data-testid="comment-compose"]');
if (composeCard) await composeCard.screenshot({ path: `${OUT}/tool-02-compose-card.png` });
// Cancel (don't persist this scratch comment).
await page.click('[data-testid="comment-compose"] .comment-composer__btn--ghost').catch(() => {});
await page.waitForTimeout(300);

// Seed MANY comments (18 open + 12 resolved), varied authors, some with replies, spread across view.
const ids = await page.evaluate(async () => {
    const store = await import('/src/js/store/index.js');
    const c = globalThis.__ebgeoMap.getCenter();
    const authors = [
        { ini: 'JM', col: '#2563eb' }, { ini: 'AS', col: '#16a34a' }, { ini: 'RC', col: '#9333ea' },
        { ini: 'PT', col: '#dc2626' }, { ini: 'LF', col: '#ea580c' }, { ini: 'MB', col: '#0891b2' },
    ];
    const texts = [
        'Reforçar a vigilância neste acesso à ponte.',
        'Confirmar a posição do posto de observação avançado.',
        'Acesso liberado — sem obstruções na via principal.',
        'Verificar cobertura de rádio neste setor.',
        'Posicionar equipe de apoio logístico aqui.',
        'Ponto de controle de tráfego estabelecido.',
        'Risco de alagamento na cota baixa ao amanhecer.',
        'Rota alternativa pelo lado norte confirmada.',
        'Obstáculo removido, via desimpedida.',
        'Necessária reavaliação ao anoitecer.',
    ];
    let n = 0;
    const mk = async (resolved) => {
        const a = authors[n % authors.length];
        const lng = c.lng + (Math.random() - 0.5) * 0.022;
        const lat = c.lat + (Math.random() - 0.5) * 0.014;
        const cm = await store.addComment({ lng, lat, text: texts[n % texts.length], authorInitials: a.ini, authorColor: a.col });
        if (n % 4 === 0) {
            const b = authors[(n + 1) % authors.length];
            await store.addReply(cm.id, { text: 'Ciente, providenciando o necessário.', authorInitials: b.ini, authorColor: b.col });
        }
        if (n % 7 === 0) {
            const b = authors[(n + 2) % authors.length];
            await store.addReply(cm.id, { text: 'Concluído.', authorInitials: b.ini, authorColor: b.col });
        }
        if (resolved) await store.resolveComment(cm.id, true);
        const id = cm.id;
        n++;
        return id;
    };
    const open = [];
    for (let i = 0; i < 18; i++) open.push(await mk(false));
    const res = [];
    for (let i = 0; i < 12; i++) res.push(await mk(true));
    return { open, res };
});

await page.waitForSelector('[data-testid="comment-pin"]', { timeout: 10000 });
await page.waitForTimeout(1000);

// 1) Map with MANY pins (open colored + resolved greyed).
await page.screenshot({ path: `${OUT}/many-01-pins.png` });

// 2) Maps panel — Comentários with a long list. Full-page (real scroll view) + the panel element.
await page.getByText('Mapas', { exact: true }).first().click().catch(() => {});
await page.waitForSelector('[data-testid="comments-panel"]', { timeout: 5000 }).catch(() => {});
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/many-02-sidebar-view.png` });
const panel = await page.$('[data-testid="comments-panel"]');
if (panel) await panel.screenshot({ path: `${OUT}/many-03-panel-default.png` });
// Expand the "Resolvidos" group to show the collapse working.
await page.click('[data-testid="comments-group-resolved"]').catch(() => {});
await page.waitForTimeout(300);
const panel2 = await page.$('[data-testid="comments-panel"]');
if (panel2) await panel2.screenshot({ path: `${OUT}/many-03b-panel-resolved-open.png` });

// 3) A thread with replies, opened from the list (clicking an item flies + opens).
await page.click(`[data-testid="comment-list-item"][data-comment-id="${ids.open[0]}"]`).catch(() => {});
await page.waitForSelector('[data-testid="comment-thread"]', { timeout: 5000 }).catch(() => {});
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/many-04-thread-from-list.png` });

console.log(`Seeded ${ids.open.length} open + ${ids.res.length} resolved comments.`);
await browser.close();
console.log('Screenshots written to', OUT);
