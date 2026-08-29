// Path: tests/unit/e2e-testids-existem.test.js

/**
 * @fileoverview Todo `data-testid` que um spec de navegador MIRA precisa existir em `src/`.
 *
 * POR QUE ISTO EXISTE, e por que não bastava a lição escrita. A suíte de Playwright roda FORA do
 * `npm test` e custa ~40 minutos, então uma mudança de UI entra sem que ninguém a rode, e o spec só
 * fica vermelho semanas depois — quando o vermelho já não parece envelhecimento, parece regressão, e
 * acusa a correção de ser o defeito. A classe `teste que afirma o mundo antigo` foi registrada no
 * livro-razão em 2026-08-16 com onze casos; RECORREU no mesmo dia com mais cinco, e a constituição é
 * explícita: correção que recorre significa que a guia não pegou, então muda-se a ABORDAGEM, não a
 * anotação. Esta é a abordagem: um guarda mecânico, de node puro, que roda em `npm test` e responde
 * em milissegundos a pergunta que antes custava a suíte inteira.
 *
 * Dos cinco vermelhos daquele lote, este teste teria pego quatro na hora
 * (`settings-modal`, `settings-exaggeration-slider`, `account-settings-btn`, `atlas-config--tabbed`
 * pela via do testid irmão), sem abrir um navegador.
 *
 * O QUE ELE NÃO ALCANÇA, de propósito, para não ser lido como cobertura completa: ele confere que o
 * ALVO existe, nunca que o fluxo continua fazendo sentido. Um testid que sobrevive num botão que
 * mudou de significado passa aqui e é exatamente o que aconteceu com o `share` da aba Mapas, que
 * mudou de lugar sem mudar de nome. Seletores por classe CSS (`.atlas-config--tabbed`) e por texto
 * também ficam fora: só `data-testid` tem a estabilidade que justifica cobrar.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = fileURLToPath(new URL('../..', import.meta.url));
const dirE2E = join(raiz, 'tests', 'e2e-ui');
const dirSrc = join(raiz, 'src');

/**
 * Todos os arquivos sob um diretório, recursivamente, que casem com o filtro.
 * @param {string} dir
 * @param {(nome: string) => boolean} aceita
 * @returns {string[]}
 */
function arquivos(dir, aceita) {
    const saida = [];
    for (const entrada of readdirSync(dir)) {
        const caminho = join(dir, entrada);
        if (statSync(caminho).isDirectory()) saida.push(...arquivos(caminho, aceita));
        else if (aceita(entrada)) saida.push(caminho);
    }
    return saida;
}

/**
 * Os testids que os specs de NAVEGADOR miram.
 *
 * Só `*.spec.js` e os helpers que eles compartilham: o que o Playwright de fato carrega
 * (`testMatch: '**‍/*.spec.js'`). O recorte é pela FORMA, não por nomes: qualquer arquivo que o
 * `testMatch` não case fica de fora por construção, porque um seletor que nenhum runner exercita
 * não é promessa que este guarda deva cobrar. (Esta frase citava um script de captura solto pelo
 * nome; ele foi apagado em 2026-08-17, e citar arquivo por nome numa isenção faz a isenção
 * apodrecer junto com ele.)
 */
const usados = (() => {
    const alvos = arquivos(dirE2E, (n) => n.endsWith('.spec.js') || n.endsWith('helpers.js') || n.endsWith('two-tabs.js'));
    const encontrados = new Map(); // testid -> arquivo que o cita primeiro
    for (const arquivo of alvos) {
        const texto = readFileSync(arquivo, 'utf8');
        for (const m of texto.matchAll(/data-testid="([^"$]+)"/g)) {
            if (!encontrados.has(m[1])) encontrados.set(m[1], arquivo.slice(raiz.length));
        }
    }
    return encontrados;
})();

/** Todo o texto de `src/`, concatenado uma vez (o custo é irrelevante e simplifica a busca). */
const fonte = arquivos(dirSrc, (n) => n.endsWith('.js') || n.endsWith('.html'))
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');

/**
 * Testids COMPOSTOS em runtime, que por construção não existem como literal inteiro.
 *
 * Cada entrada declara o prefixo que o código monta, e o próprio teste cobra que o prefixo exista
 * em `src/`: sem isso a allowlist viraria o esconderijo do apodrecimento que este arquivo existe
 * para impedir. Um testid dinâmico cujo prefixo sumiu reprova aqui.
 */
const PREFIXOS_DINAMICOS = Object.freeze([
    'admin-cat-',                  // `admin-cat-${cat.key}`        — admin/catalog-tab.js
    'admin-catalog-cfg-',          // `admin-catalog-cfg-${path}`   — admin/catalog-tab.js (config em campos)
    'admin-catalog-json-',         // `admin-catalog-json-${key}`   — admin/catalog-tab.js (caixas JSON estruturadas)
    'atlas-settings-nav-',         // `atlas-settings-nav-${s.id}`  — modals/atlas-settings.modal.js
    'atlas-settings-projection-',  // `atlas-settings-projection-${c.id}`
    'comments-group-',             // `comments-group-${key}`       — comment_tool/comments-panel.js
    'project-picker-tab-'          // `project-picker-tab-${f.key}` — projects/atlas-drive.js
]);

/**
 * Testids RETIRADOS de propósito, que um spec cita para afirmar a AUSÊNCIA deles.
 *
 * O GUARDA NÃO DISTINGUE MIRAR DE NEGAR, e é bom que não distinga: ele lê o literal, e um
 * `toHaveCount(0)` tem a mesma forma textual de um `click()`. Sem esta lista, mover um botão de
 * lugar ficava impossível de PROVAR: o spec que mostra que a porta velha sumiu reprovava aqui
 * exatamente por ela ter sumido, que é o resultado desejado.
 *
 * ELA NÃO É ESCONDERIJO, porque a cobrança se INVERTE: cada entrada precisa estar mesmo AUSENTE
 * de `src/`. Um testid que voltar reprova por esta lista, e não passa despercebido. É a mesma
 * disciplina de `PREFIXOS_DINAMICOS`, com o sinal trocado.
 */
/**
 * Testids COMPOSTOS cujo prefixo NÃO pode virar isenção larga.
 *
 * `PREFIXOS_DINAMICOS` isenta tudo que começa com o prefixo, e isso só é seguro quando o
 * namespace inteiro é dinâmico (`admin-cat-` é: não há um `admin-cat-algo` literal em `src/`).
 * `admin-personnel-` NÃO é: ali convivem os dois compostos da sub-nav
 * (`admin-personnel-${sub.key}`) com meia dúzia de literais de verdade (`-new`, `-list`, `-row`,
 * `-edit`, `-save`). Isentar o prefixo apagaria a proteção sobre os literais, que é o esconderijo
 * que o cabeçalho deste arquivo manda caçar.
 *
 * Então a isenção é POR ID EXATO, e cada uma declara o prefixo que o código monta. O teste cobra
 * o prefixo, igual ao caso dos dinâmicos: uma entrada cujo montador sumiu reprova.
 *
 * @type {ReadonlyArray<[string, string]>} pares [id exato, prefixo montado em src/]
 */
const IDS_COMPOSTOS = Object.freeze([
    ['admin-personnel-posto', 'admin-personnel-'],  // SUBCATS[].key — admin/personnel-tab.js
    ['admin-personnel-om', 'admin-personnel-'],
]);

const RETIRADOS = Object.freeze([
    // 2026-08-25: a porta do estúdio de calibração 360 saiu das duas barras globais e virou ação
    // de linha no catálogo (`admin-360-calibrar`). Ver `tests/e2e-ui/admin-360-calibrar.spec.js`.
    'app-bar-calibration',
    'account-calibration-btn',
]);

describe('todo data-testid mirado por spec de navegador existe em src/', () => {
    // PISO DE CONTAGEM. Sem ele, uma extração que pare de casar (regex quebrada, pasta renomeada)
    // reporta VERDE varrendo zero alvos, que é a cobertura vazia que a constituição manda caçar.
    // O número é o medido em 2026-08-16, com folga para baixo.
    it('varre uma quantidade plausível de testids (piso contra extração vazia)', () => {
        expect(usados.size).toBeGreaterThan(90);
    });

    it('cada prefixo dinâmico declarado ainda é montado em src/', () => {
        for (const prefixo of PREFIXOS_DINAMICOS) {
            expect(fonte, `o prefixo dinâmico "${prefixo}" não é montado em src/: ou o código mudou, `
                + 'ou a allowlist está protegendo um testid morto')
                .toMatch(new RegExp(`["'\`]${prefixo}`));
        }
    });

    it('cada id composto declarado ainda tem o montador dele em src/', () => {
        for (const [id, prefixo] of IDS_COMPOSTOS) {
            expect(fonte, `o id composto "${id}" declara o prefixo "${prefixo}", que não é montado `
                + 'em src/: ou o código mudou, ou a isenção está protegendo um testid morto')
                .toMatch(new RegExp(`["'\`]${prefixo}`));
        }
    });

    it('todo testid declarado RETIRADO está mesmo ausente de src/', () => {
        // A cobrança invertida, que impede a lista de virar esconderijo.
        //
        // BUSCA LITERAL, sem regex: um testid é kebab-case e não carrega metacaractere nenhum,
        // então a cadeia de escape que o caso irmão precisa (ele varre nomes vindos de arquivo)
        // aqui só seria uma cópia a mais para errar. As aspas nas duas pontas fazem o mesmo
        // trabalho: impedem que `app-bar-calibration` case dentro de um nome maior.
        for (const testid of RETIRADOS) {
            const presente = [`"${testid}"`, `'${testid}'`, `\`${testid}\``]
                .some((forma) => fonte.includes(forma));
            expect(presente, `"${testid}" está declarado RETIRADO e VOLTOU a src/: `
                + 'ou o testid renasceu e a declaração está mentindo, ou a remoção foi desfeita')
                .toBe(false);
        }
    });

    it('nenhum spec mira um testid que não existe mais', () => {
        /** @type {string[]} */
        const orfaos = [];
        const compostos = new Set(IDS_COMPOSTOS.map(([id]) => id));
        for (const [testid, arquivo] of usados) {
            if (PREFIXOS_DINAMICOS.some((p) => testid.startsWith(p))) continue;
            if (compostos.has(testid)) continue;
            if (RETIRADOS.includes(testid)) continue;
            // Literal EXATO, entre aspas: `settings-exaggeration-value` não pode passar por casar
            // dentro de `atlas-settings-exaggeration-value`, que é justamente o par que a troca de
            // 2026-08-16 criou.
            const literal = new RegExp(`["'\`]${testid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'\`]`);
            if (!literal.test(fonte)) orfaos.push(`${testid}  (citado em ${arquivo})`);
        }
        expect(orfaos, `testid(s) mirados por spec e ausentes de src/:\n  ${orfaos.join('\n  ')}\n`)
            .toEqual([]);
    });
});
