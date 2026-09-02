// Path: tests/unit/registro-de-uso-censo.test.js

/**
 * @fileoverview O CENSO DE QUEM CONTA USO, e as duas propriedades estruturais que nenhum teste de
 * comportamento alcança.
 *
 * A PRIMEIRA É O LITERAL DE STRING. `registrarUso('ferramenta.ativda', ...)` não lança, não avisa
 * e não conta: o catálogo descarta o evento desconhecido de propósito (mandá-lo custaria o LOTE
 * INTEIRO num 422), então um erro de digitação produz exatamente o mesmo silêncio que o produto
 * inteiro funcionando. É a mesma razão da convenção `EventTypes.XXX`, e o mesmo modo de falha: uma
 * métrica que simplesmente não existe, e ninguém sabe que não existe. Daqui em diante todo sítio
 * escreve `EventoDeUso.X`.
 *
 * A SEGUNDA É A INSTALAÇÃO NAS QUATRO PÁGINAS. `registrarUso` é INERTE antes de `instalarUso`, e
 * inerte em silêncio (só o contador `naoInstalado` sobe). Uma página que esqueça a instalação não
 * quebra nada: ela simplesmente não aparece em nenhum número do relatório, e a leitura do
 * relatório é "ninguém usa o painel de administração".
 *
 * A VARREDURA VEM DO VERSIONAMENTO (`git ls-files`, com os não rastreados), nunca de uma lista
 * escrita à mão: "conferir um subconjunto e tratá-lo como o conjunto" é a lição mais repetida do
 * livro-razão. Os quatro entries são nomeados um a um porque eles são o conjunto FIXO de páginas
 * do produto, e é isso que a asserção precisa dizer.
 *
 * FRAGILIDADE ACEITA: a varredura precisa de `git`; se o comando falhar, o caso de piso diz isso
 * nessas palavras, porque falha de ambiente lida como regressão custa mais do que o guarda salva.
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
    EVENTOS_DE_USO,
    EventoDeUso,
    PROPS_PERMITIDAS,
    PropDeUso,
} from '@js/session/eventos-de-uso.js';

const URL_JS = new URL('../../src/js/', import.meta.url);
const DIR_JS = fileURLToPath(URL_JS);

/** Toda chamada da porta única de contagem. */
const CHAMADA = /registrarUso\s*\(/g;

/**
 * A chamada INTEIRA, com os dois argumentos separados.
 *
 * O SEGUNDO ARGUMENTO PRECISA DA MESMA PROVA DO PRIMEIRO, e a primeira versão deste censo só
 * cobrava o primeiro. Um qualificador com erro de digitação é DESCARTADO em silêncio pela
 * porteira do catálogo, e o desfecho é byte a byte o do produto funcionando: a métrica
 * simplesmente não existe, e a linha some do relatório sem nada ficar vermelho.
 *
 * O segundo grupo é deliberadamente frouxo (ele precisa aceitar uma expressão, que é o caso
 * legítimo do evento LIVRE), e quem julga é a classificação abaixo, nunca o padrão.
 */
const CHAMADA_COMPLETA = /registrarUso\s*\(\s*([^,)]+?)\s*(?:,\s*([^;]*?)\s*)?\)\s*;/g;

/**
 * Os QUATRO entries de página, com o HTML que cada um serve. A lista é fixa porque as páginas são
 * fixas (`rollupOptions.input`, em `vite.config.js`), e escrevê-la é o ponto: uma quinta página
 * nasce sem contagem nenhuma até alguém acrescentá-la aqui.
 */
const ENTRIES = Object.freeze([
    { arquivo: 'index.js', pagina: 'mapa' },
    { arquivo: 'projects/projects-page.js', pagina: 'atlas' },
    { arquivo: 'admin/admin-page.js', pagina: 'admin' },
    { arquivo: 'calibration/calibracao-page.js', pagina: 'calibracao' },
]);

/** Remove comentários (a varredura mede código, não prosa). */
function semComentarios(texto) {
    return texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** @param {string} rel @returns {string} */
function fonte(rel) {
    return readFileSync(new URL(rel, URL_JS), 'utf8');
}

/** Os arquivos versionados de `src/js/` que chamam a porta de contagem. */
function varrer() {
    const saida = execSync('git ls-files --cached --others --exclude-standard "*.js"',
        { cwd: DIR_JS, encoding: 'utf8' });
    return saida.split('\n').map((l) => l.trim().replace(/\\/g, '/')).filter(Boolean)
        .filter((rel) => CHAMADA.test(semComentarios(fonte(rel))) && (CHAMADA.lastIndex = 0) === 0)
        .sort();
}

const VARRIDOS = varrer();

/**
 * Os arquivos que DEFINEM a porta (e portanto a citam sem ser sítio de contagem).
 * Sem motivo escrito, uma allowlist é a lista à mão de volta com um nome melhor.
 */
const DEFINIDORES = Object.freeze({
    'session/uso-lote.js': 'É a porta. Ela declara `registrarUso` e a cita no próprio JSDoc.',
    'session/uso-do-barramento.js':
        'É um DESPACHANTE, e não um sítio: a chamada dele é `registrarUso(regra.uso)`, e o valor '
        + 'sai da allowlist logo acima, que é escrita com `EventoDeUso.X` como todo mundo. Cobrar '
        + 'o literal na CHAMADA aqui obrigaria a desenrolar a tabela em cinco chamadas, que é '
        + 'exatamente a lista à mão que a tabela existe para não ter. O que prende a tabela é '
        + '`tests/unit/uso-do-barramento.test.js`, que compara a allowlist com os nomes de '
        + '`EventTypes` e mede os cinco eventos um a um.',
});

describe('censo dos sítios que contam uso', () => {
    it('a varredura acha alguma coisa (piso: git vivo e padrão que casa)', () => {
        // Cobertura vazia passa verde: sem este piso, um `git ls-files` que falhasse ou um padrão
        // que deixasse de casar deixariam as asserções abaixo trivialmente satisfeitas.
        expect(VARRIDOS.length, 'a varredura não achou arquivo nenhum — git falhou ou o padrão parou de casar')
            .toBeGreaterThanOrEqual(8);
    });

/**
 * As chamadas de um arquivo, com os dois argumentos como texto-fonte.
 * @param {string} codigo
 * @returns {Array<{evento: string, prop: string|null}>}
 */
function chamadasDe(codigo) {
    const achadas = [];
    CHAMADA_COMPLETA.lastIndex = 0;
    let m = CHAMADA_COMPLETA.exec(codigo);
    while (m !== null) {
        achadas.push({ evento: m[1], prop: m[2] ?? null });
        m = CHAMADA_COMPLETA.exec(codigo);
    }
    return achadas;
}

/** O nome do evento por trás de `EventoDeUso.X`, ou `null`. */
function valorDoEvento(texto) {
    const m = /^EventoDeUso\.([A-Z][A-Z0-9_]*)$/.exec(texto ?? '');
    return m && Object.hasOwn(EventoDeUso, m[1]) ? EventoDeUso[m[1]] : null;
}

/** O valor por trás de `PropDeUso.Y`, ou `null`. */
function valorDaProp(texto) {
    const m = /^PropDeUso\.([A-Z][A-Z0-9_]*)$/.exec(texto ?? '');
    return m && Object.hasOwn(PropDeUso, m[1]) ? PropDeUso[m[1]] : null;
}

describe('censo dos sítios que contam uso: os DOIS argumentos', () => {
    it('o extrator acha todas as chamadas que a varredura contou (piso do padrão)', () => {
        // Sem este piso, um `CHAMADA_COMPLETA` que deixasse de casar tornaria os casos abaixo
        // trivialmente verdes: zero chamadas, zero infratores.
        for (const rel of VARRIDOS) {
            if (rel in DEFINIDORES) continue;
            const codigo = semComentarios(fonte(rel));
            const contadas = codigo.match(CHAMADA)?.length ?? 0;
            expect(chamadasDe(codigo).length, `${rel}: o extrator perdeu chamada`).toBe(contadas);
        }
    });

    it('TODA chamada usa `EventoDeUso.X` no primeiro argumento', () => {
        const infratores = [];
        for (const rel of VARRIDOS) {
            if (rel in DEFINIDORES) continue;
            for (const c of chamadasDe(semComentarios(fonte(rel)))) {
                if (valorDoEvento(c.evento) === null) infratores.push(`${rel}: ${c.evento}`);
            }
        }
        expect(infratores, 'primeiro argumento fora de `EventoDeUso`: um evento com erro de '
            + 'digitação é DESCARTADO em silêncio, e a métrica simplesmente não existe').toEqual([]);
    });

    it('TODO qualificador de lista fechada usa `PropDeUso.Y`, e o par é PERMITIDO', () => {
        // DUAS PERGUNTAS NUMA: que a constante seja usada (contra o literal com erro de
        // digitação) e que o par (evento, qualificador) seja aceito pelo catálogo (contra a
        // constante CERTA no evento ERRADO, que o servidor recusa com 422 e derruba o lote
        // inteiro). O evento LIVRE é a exceção declarada: o id vem do registro de ferramentas
        // em tempo de execução, então ali o argumento é uma expressão de propósito.
        const infratores = [];
        for (const rel of VARRIDOS) {
            if (rel in DEFINIDORES) continue;
            for (const c of chamadasDe(semComentarios(fonte(rel)))) {
                if (c.prop === null) continue;
                const evento = valorDoEvento(c.evento);
                const permitidas = evento !== null && Object.hasOwn(PROPS_PERMITIDAS, evento)
                    ? PROPS_PERMITIDAS[evento]
                    : [];
                if (permitidas === null) continue;
                const valor = valorDaProp(c.prop);
                if (valor === null) {
                    infratores.push(`${rel}: ${c.evento} recebeu "${c.prop}" (use PropDeUso.Y)`);
                } else if (!permitidas.includes(valor)) {
                    infratores.push(`${rel}: ${evento} não aceita "${valor}"`);
                }
            }
        }
        expect(infratores).toEqual([]);
    });

    it('a varredura encontrou par COM qualificador (piso da cobertura vazia)', () => {
        // O caso acima passaria verde numa árvore em que nenhuma chamada tivesse segundo
        // argumento, que é exatamente o estado que ele existe para vigiar.
        let comProp = 0;
        for (const rel of VARRIDOS) {
            if (rel in DEFINIDORES) continue;
            for (const c of chamadasDe(semComentarios(fonte(rel)))) {
                if (c.prop !== null) comProp += 1;
            }
        }
        expect(comProp, 'nenhuma chamada com qualificador').toBeGreaterThanOrEqual(6);
    });

    it('`PropDeUso` é DERIVADO das listas fechadas do catálogo, e não uma segunda cópia', () => {
        const fechadas = new Set();
        for (const permitidas of Object.values(PROPS_PERMITIDAS)) {
            if (permitidas === null) continue;
            for (const v of permitidas) fechadas.add(v);
        }
        expect([...Object.values(PropDeUso)].sort()).toEqual([...fechadas].sort());
        expect(Object.isFrozen(PropDeUso)).toBe(true);
        for (const chave of Object.keys(PropDeUso)) {
            expect(chave, `${chave} não é UPPER_SNAKE`).toMatch(/^[A-Z][A-Z0-9_]*$/);
        }
    });
});

    it('todo sítio de contagem IMPORTA as duas peças por arquivo, nunca por barril', () => {
        // `@js/session/uso-lote.js` e `@js/session/eventos-de-uso.js` são folhas; qualquer barril
        // no caminho arrastaria a store para dentro de uma ferramenta ou de uma página sem mapa.
        for (const rel of VARRIDOS) {
            if (rel in DEFINIDORES) continue;
            const codigo = fonte(rel);
            // O caminho aceita as duas formas porque os vizinhos de `session/` se importam por
            // caminho relativo (a pasta não tem barril) e o resto do produto pelo alias; o que a
            // asserção prende é o ARQUIVO no fim, que é a propriedade que importa.
            expect(codigo, `${rel} não importa \`registrarUso\` por arquivo`)
                .toMatch(/import \{[^}]*registrarUso[^}]*\} from '[^']*uso-lote\.js'/);
            expect(codigo, `${rel} não importa \`EventoDeUso\` por arquivo`)
                .toMatch(/import \{[^}]*EventoDeUso[^}]*\} from '[^']*eventos-de-uso\.js'/);
        }
    });

    it('o censo não guarda entrada morta', () => {
        const fantasmas = Object.keys(DEFINIDORES).filter((rel) => !VARRIDOS.includes(rel));
        expect(fantasmas, 'entrada de censo sem arquivo correspondente na varredura').toEqual([]);
    });

    it('todo evento do catálogo tem ao menos um sítio que o conta', () => {
        // A OUTRA DIREÇÃO DA MESMA PERGUNTA: um evento declarado e nunca emitido é uma linha que
        // nunca aparece no relatório, e ela se lê como "ninguém faz isto". Este caso obriga o
        // evento novo a nascer com o gancho, ou a ser removido do catálogo.
        const codigo = VARRIDOS.map((rel) => semComentarios(fonte(rel))).join('\n');
        const orfaos = [];
        for (const [chave, valor] of Object.entries(EventoDeUso)) {
            if (!codigo.includes(`EventoDeUso.${chave}`)) orfaos.push(valor);
        }
        expect(orfaos, 'evento do catálogo que ninguém conta: ou o gancho falta, ou o evento sobra')
            .toEqual([]);
        expect(Object.keys(EventoDeUso)).toHaveLength(EVENTOS_DE_USO.length);
    });
});

describe('as QUATRO páginas instalam a telemetria de uso', () => {
    it('cada entry chama `instalarUso()` e o importa por arquivo', () => {
        for (const { arquivo } of ENTRIES) {
            const codigo = fonte(arquivo);
            expect(codigo, `${arquivo} não importa \`instalarUso\``)
                .toMatch(/import \{[^}]*instalarUso[^}]*\} from '[^']*session\/uso-telemetria\.js'/);
            expect(semComentarios(codigo), `${arquivo} não chama \`instalarUso()\``)
                .toMatch(/\binstalarUso\s*\(\s*\)/);
        }
    });

    it('a instalação vem LOGO DEPOIS da telemetria de erro, e não antes', () => {
        // A ORDEM É O CONTRATO, e ela tem uma razão em cada sentido: a de erro precisa ser a
        // primeira linha do boot (é o erro de boot que mais custa), e a de uso lê o contador de
        // erros dela. Invertê-las não quebra nada visível, e é justamente por isso que a asserção
        // existe.
        for (const { arquivo } of ENTRIES) {
            const codigo = semComentarios(fonte(arquivo));
            const erro = codigo.indexOf('instalarTelemetriaDeErro()');
            const uso = codigo.indexOf('instalarUso()');
            expect(erro, `${arquivo}: chamada de telemetria de erro não encontrada`)
                .toBeGreaterThan(-1);
            expect(uso, `${arquivo}: chamada de telemetria de uso não encontrada`)
                .toBeGreaterThan(-1);
            expect(uso, `${arquivo}: \`instalarUso\` antes de \`instalarTelemetriaDeErro\``)
                .toBeGreaterThan(erro);
        }
    });

    it('as três páginas sem mapa NÃO instalam o tap do barramento', () => {
        // Elas bootam sem `initServices()` e portanto sem barramento; importar o tap ali seria
        // código que nunca roda, e a leitura errada é que aqueles cinco eventos são contados nas
        // quatro páginas.
        for (const { arquivo } of ENTRIES.filter((e) => e.pagina !== 'mapa')) {
            expect(fonte(arquivo), `${arquivo} importa o tap de barramento`)
                .not.toMatch(/uso-do-barramento/);
        }
        expect(fonte('index.js')).toMatch(/instalarUsoDoBarramento\(getEventBus\(\)\)/);
    });
});
