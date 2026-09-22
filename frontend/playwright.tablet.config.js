// Path: playwright.tablet.config.js

/**
 * @fileoverview A RODADA DE TABLET, que até 2026-09-20 não existia.
 *
 * O `playwright.config.js` só tem projeto de MESA (`Desktop Chrome` e, sob bandeira, `Desktop
 * Firefox`), e um contexto de mesa não casa `@media (pointer: coarse)`, não dispara
 * `touchstart` e não aceita `locator.tap()`. Ou seja: a única camada que exercita a interface
 * era cega para toda a metade de toque do produto, e todo defeito de dedo só podia ser
 * AFIRMADO por leitura de código — foi assim que se descobriu, lendo, que arrastar vértice de
 * linha e polígono não funcionava com o dedo, que a medição não fechava e que o menu de dois
 * dedos nascia fora da tela.
 *
 * O QUE ESTE CONFIG MUDA, e é só isto: o projeto. `hasTouch: true` faz o contexto ter tela de
 * toque de verdade (o `pointer: coarse` casa e os eventos de toque nascem), e o viewport é o
 * de um iPad, que cai na FAIXA DO TABLET de `utilities/tablet-mode.js` — acima do corte de
 * telefone e, portanto, na interface de mesa com entrada por toque, que é exatamente a
 * combinação que o produto entrega hoje e que ninguém media.
 *
 * `isMobile` FICA DE FORA, de propósito, e a razão é que ele faz mais do que o nome diz: além
 * do toque, ele liga o meta viewport do Chromium e muda a escala da página. O que se quer
 * medir aqui é o produto em tablet, não o produto redimensionado por um emulador.
 *
 * O QUE ELE NÃO SUBSTITUI, e a lista importa tanto quanto o que ele faz:
 *   - NÃO é um iPad. É Chromium com toque. Continuam fora do alcance a síntese de eventos de
 *     mouse do Safari a partir do toque, o `dblclick` que talvez não venha de um toque duplo, o
 *     `contextmenu` do toque longo e a existência de `requestPointerLock`.
 *   - NÃO mede desempenho nem memória. A GPU e a RAM são as da máquina, não as do aparelho.
 *   - NÃO responde se o dedo acerta o alvo. `locator.tap()` acerta o centro geométrico sempre;
 *     um dedo de nove milímetros, não. Alvo pequeno continua sendo medido por régua de CSS.
 *
 * DOIS DEDOS: `page.touchscreen` só faz `tap`. Pinça e toque de dois dedos se roteirizam por
 * CDP (`Input.dispatchTouchEvent` com dois pontos), e o ajudante mora com as specs, não aqui.
 *
 * `retries: 0` PORQUE ESTA RODADA É DE MEDIÇÃO: o config base tem `retries: 1`, e um caso de
 * toque que passa na segunda tentativa é justamente o que não se quer aprender. As portas e o
 * banco são os do base, então ela COLIDE com uma rodada de `test:e2e:ui` normal; para rodar as
 * duas ao mesmo tempo, isole pelas três variáveis de `tests/e2e-ui/constants.js`.
 */

import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config.js';

export default defineConfig({
    ...base,
    // O SEGUNDO PADRÃO É O GUARDA DO "VERDE POR SKIP", e ele entrou em 2026-09-21 junto com a
    // exclusão do lado de lá. As duas `*.tablet.spec.js` são `state.skip ? test.describe.skip :
    // test.describe`, como todo spec desta pasta: sem Postgres o backend não sobe, as nove
    // pulam e a rodada fecha VERDE tendo dirigido zero. Enquanto o config padrão as recolhia,
    // quem reprovava nessa condição era o `_backend-required.spec.js` daquela rodada; tirando-as
    // de lá, esta rodada passou a ser a ÚNICA que as exercita, e ela herdaria o falso verde. O
    // guarda não se gateia, não faz E/S e não usa `page`, então custa zero e roda em qualquer
    // projeto. Ver `tests/unit/guarda-de-e2e-nao-pula.test.js`.
    testMatch: ['**/*.tablet.spec.js', '**/_backend-required.spec.js'],
    // O SPREAD ACIMA TRAZ O `testIgnore` DO BASE, E DESDE 2026-09-21 ELE IGNORA
    // `**/*.tablet.spec.js` — ou seja, herdá-lo aqui faria esta rodada ignorar as próprias
    // specs, porque `testIgnore` vence `testMatch`. Sobrescrever é obrigatório, e a lista vai
    // VAZIA em vez de repetir a entrada da mega: `browser-collab-mega.spec.js` não é uma
    // `*.tablet.spec.js`, então o `testMatch` desta linha já o deixa de fora, e repetir a
    // exclusão criaria uma segunda cópia de uma regra que ninguém lembraria de manter.
    testIgnore: [],
    outputDir: './test-results/tablet',
    retries: 0,
    timeout: 90000,
    reporter: [['list']],
    projects: [
        {
            name: 'tablet-chromium',
            use: {
                ...devices['Desktop Chrome'],
                // 1024 por 768 é o iPad em PAISAGEM, que é como se usa um mapa. Em retrato o
                // eixo curto fica em 768, também dentro da faixa; a orientação se troca na
                // spec, com `page.setViewportSize`, quando o caso for sobre isso.
                viewport: { width: 1024, height: 768 },
                hasTouch: true,
                deviceScaleFactor: 2,
            },
        },
    ],
});
