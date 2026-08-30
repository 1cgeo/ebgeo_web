// Path: tests/unit/scripts-da-raiz.test.js
//
// Guarda contra a classe que já recorreu TRÊS vezes neste monorepo: um script da
// raiz que delega para UM pacote só e se anuncia como se cobrisse os dois.
//
//   1. `lint` e `test` da raiz rodavam `--prefix frontend`, e eram exatamente os dois
//      comandos que a constituição prescrevia como *a* verificação antes de commit.
//      Uma mudança só de backend, verificada como mandado, rodava zero teste de
//      backend e voltava verde.
//   2. `test:coverage` da raiz continuou apontando só para o frontend depois disso,
//      então o piso de cobertura que o backend acabara de ganhar ficava inalcançável
//      pelo comando da raiz.
//   3. `lint:fix` idem, com o backend tendo o seu próprio `lint:fix`.
//
// O livro-razão manda, quando uma correção recorre, MUDAR A ABORDAGEM em vez de
// re-anotar. A abordagem antiga era consertar o script; esta é afirmar a propriedade.
//
// A regra: um script da raiz que delega com `--prefix` para um pacote só precisa
// dizer isso no NOME (sufixo `:frontend`/`:backend`/`:web`) ou estar na lista de
// exceções abaixo, com o motivo. Assim, criar um comando novo que cubra meio
// monorepo passa a exigir uma decisão em vez de acontecer por descuido.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const raizPkg = JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8'));
const scriptsRaiz = raizPkg.scripts ?? {};

/**
 * Scripts que legitimamente valem para um pacote só. Cada entrada carrega o motivo,
 * e o motivo é a razão de a lista existir: sem ele ela vira esconderijo.
 */
const SO_UM_PACOTE_DE_PROPOSITO = new Map([
    ['build', 'só o frontend compila; o backend roda do fonte'],
    ['deploy', 'publica o dist do frontend (symlink swap)'],
    ['test:watch', 'watch é do Vitest; o runner do backend não tem modo watch'],
    // `test:e2e` mora no frontend mas exercita o BACKEND real (vitest full-chain, ~35 s,
    // sem browser). Está no encadeamento do `test` da raiz de propósito, desde 2026-07-25:
    // a constituição chama o E2E de "o guarda da fronteira entre os dois pacotes", e ele
    // ficou VERMELHO por um dia sem ninguém notar, porque não era rodado por comando nenhum
    // do Definition of Done. Guarda fora do comando que se manda rodar é guarda desligado.
    ['test:e2e', 'vive no frontend e sobe o backend REAL; entra no encadeamento do `test` da raiz'],
    // Estes dois SÃO Playwright (browser), caros demais para o loop; ficam manuais.
    ['test:e2e:ui', 'Playwright com browser, caro demais para o encadeamento do DoD'],
    ['test:e2e:mega', 'idem, e roda headed'],
    ['knip', 'dead-code do frontend; o backend não tem configuração de knip'],
    // `diag` lê o log em arquivo, e quem escreve esse log é o SERVIDOR (`pino`, um arquivo
    // por dia em `LOG_DIR`). O frontend não tem log em disco para consultar: o erro de
    // navegador não passa por aqui, ele vai virar uma tabela no Postgres alimentada por
    // um endpoint de telemetria, e a consulta dele será a mesma do backend. Ver
    // `docs/wiki/observabilidade.md`.
    ['diag', 'consulta o log em arquivo, que só o backend escreve'],
    ['clean', 'limpa artefatos de build, que só o frontend produz'],
]);

/** Sufixos que declaram o escopo no próprio nome. */
const SUFIXO_EXPLICITO = /:(frontend|backend|web)$/;

describe('scripts da raiz do monorepo', () => {
    it('lista os scripts da raiz (guarda contra a lista esvaziar em silêncio)', () => {
        expect(Object.keys(scriptsRaiz).length).toBeGreaterThan(10);
    });

    it('script que delega para um pacote só declara isso no nome ou tem motivo registrado', () => {
        const suspeitos = [];
        for (const [nome, corpo] of Object.entries(scriptsRaiz)) {
            if (!corpo.includes('--prefix')) continue;
            if (SUFIXO_EXPLICITO.test(nome)) continue;
            if (SO_UM_PACOTE_DE_PROPOSITO.has(nome)) continue;

            const tocaFrontend = corpo.includes('--prefix frontend');
            const tocaBackend = corpo.includes('--prefix backend');
            if (tocaFrontend && tocaBackend) continue;
            suspeitos.push(`${nome}: ${corpo}`);
        }
        expect(
            suspeitos,
            'script da raiz que delega para UM pacote sem dizer no nome. Ou ele deve cobrir os dois,'
                + ' ou o nome precisa do sufixo :frontend/:backend, ou entre em'
                + ` SO_UM_PACOTE_DE_PROPOSITO com o motivo:\n${suspeitos.join('\n')}`
        ).toEqual([]);
    });

    it('script que encadeia os dois pacotes chama de fato os dois', () => {
        // Um `lint` que chame `lint:frontend && lint:frontend` passaria na regra acima
        // (o corpo não tem `--prefix`) e cobriria metade. Esta resolve a cadeia.
        const encadeados = ['lint', 'test', 'test:coverage'];
        const quebrados = [];
        for (const nome of encadeados) {
            const corpo = scriptsRaiz[nome];
            if (!corpo) {
                quebrados.push(`${nome}: script inexistente na raiz`);
                continue;
            }
            const alcance = new Set();
            for (const m of corpo.matchAll(/npm run ([\w:-]+)/g)) {
                const alvo = scriptsRaiz[m[1]] ?? '';
                if (alvo.includes('--prefix frontend')) alcance.add('frontend');
                if (alvo.includes('--prefix backend')) alcance.add('backend');
            }
            if (!(alcance.has('frontend') && alcance.has('backend'))) {
                quebrados.push(`${nome} alcança apenas [${[...alcance].join(', ') || 'nada'}]`);
            }
        }
        expect(
            quebrados,
            `comando da raiz que se anuncia como verificação e cobre um pacote só:\n${quebrados.join('\n')}`
        ).toEqual([]);
    });

    it('todo pacote que tem um script tem o correspondente alcançável pela raiz', () => {
        // A recorrência nº 3 (`lint:fix`) foi exatamente isto: o backend ganhou o
        // script, a raiz continuou apontando só para o frontend, e nada acusou.
        const paresQueImportam = ['lint', 'lint:fix', 'test', 'test:coverage'];
        const faltando = [];
        for (const pacote of ['frontend', 'backend']) {
            const caminho = join(RAIZ, pacote, 'package.json');
            if (!existsSync(caminho)) continue;
            const scripts = JSON.parse(readFileSync(caminho, 'utf8')).scripts ?? {};
            for (const nome of paresQueImportam) {
                if (!scripts[nome]) continue;
                const alcancavel = Object.values(scriptsRaiz).some(
                    (c) => c.includes(`run ${nome} --prefix ${pacote}`) || c.includes(`${nome} --prefix ${pacote}`)
                );
                if (!alcancavel) faltando.push(`${pacote} tem "${nome}" e a raiz não o alcança`);
            }
        }
        expect(faltando, `script de pacote inalcançável pela raiz:\n${faltando.join('\n')}`).toEqual([]);
    });
});
