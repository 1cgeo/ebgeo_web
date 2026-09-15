// Path: js/tutorial/tutorial-page.js

/**
 * @module tutorial/tutorial-page
 * @description Entrada de `frontend/tutorial.html`, a QUINTA página do produto: o tutorial.
 *
 * O QUE ESTA PÁGINA É, e o que ela deliberadamente NÃO tem. Ela renderiza
 * `frontend/public/docs/README.md` com o docsify e mais nada. É a única página do produto que não
 * toca no acervo local, não abre sessão e não fala com o backend: sem `initServices()`, sem store,
 * sem IndexedDB, sem `GET /api/config`. Daí ela ficar de fora de cinco fiações que as outras
 * quatro têm, e cada ausência é uma decisão com motivo, não um esquecimento:
 *
 *   - **sem `runLegacyUpgradeGate`** (o portão de migração), porque ele existe para as páginas que
 *     LEEM E ESCREVEM os bancos locais antes de a atualização copiá-los, e esta não abre banco
 *     nenhum. Importá-lo traria a store inteira para uma página de documentação;
 *   - **sem tab-lock**, porque a regra do dono é que duas abas colidem quando seguram o MESMO
 *     endereço de bancos, e esta não segura endereço nenhum. As outras três sem mapa entram no
 *     canal com a chave NULA para aparecer no roster; aqui nem o roster tem o que dizer;
 *   - **sem telemetria de erro e de uso, sem presença e sem o leitor de pendências**, porque os
 *     quatro dependem do `GET /api/config` e da identidade de sessão que esta página não busca. O
 *     preço, declarado: um erro do docsify aqui não vira defeito na tabela do administrador, e a
 *     visita a esta página não entra na contagem de uso.
 *
 * O CUSTO DELA É O DOCSIFY, e nada mais da casa. Quem quiser somar qualquer uma das cinco linhas
 * acima paga o payload das páginas sem mapa junto, e é essa a troca a discutir antes de escrever.
 *
 * A ORDEM DOS DOIS PRIMEIROS IMPORTS É CONTRATO: `vendor/docsify.js` traz `dist/themes/core.css` no
 * corpo dele, e `@css/tutorial.css` traz a paleta da casa. Módulos são avaliados na ordem textual,
 * então a folha da casa entra depois e vence; invertidos, o tema do pacote sobrescreveria a paleta
 * e nada ficaria vermelho, só a cor erraria.
 */

import { montarDocsify } from '@js/vendor/docsify.js';
import '@css/tutorial.css';
import { reescreverMidiaRelativa } from './caminhos-de-midia.js';

/**
 * Onde mora o markdown do tutorial, relativo a ESTA página.
 *
 * `frontend/public/docs/` é copiado verbatim para `dist/docs/`, então o endereço é sempre um
 * `docs/` ao lado da página. Resolver por `URL` em vez de escrever `/docs/` é o que mantém a
 * página viva num deploy sob subcaminho (`/cms/tutorial.html` -> `/cms/docs/`), que é a
 * possibilidade que o `base` comentado do `vite.config.js` deixou em aberto. O hash da rota não
 * participa: `new URL` o descarta.
 * @returns {string} O caminho absoluto do diretório, com barra final.
 */
function baseDoConteudo() {
    return new URL('docs/', window.location.href).pathname;
}

const BASE = baseDoConteudo();

montarDocsify({
    name: 'Tutorial',
    nameLink: window.location.pathname,
    basePath: BASE,
    homepage: 'README.md',
    // O tutorial é um documento só, e o sumário da barra lateral é gerado dos títulos dele. Três
    // níveis cobrem "Módulo N" e as duas subdivisões que o texto usa.
    subMaxLevel: 3,
    auto2top: true,
    plugins: [
        (hooks) => {
            // `beforeEach` recebe o markdown CRU, antes de marked. É o único ponto em que o HTML
            // embutido ainda é texto, e por isso o único em que a reescrita cabe numa função pura.
            hooks.beforeEach((conteudo) => reescreverMidiaRelativa(conteudo, BASE));
        }
    ]
});
