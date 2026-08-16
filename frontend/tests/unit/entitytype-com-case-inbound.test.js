// Path: tests/unit/entitytype-com-case-inbound.test.js
//
// Todo `EntityType` que alguém EMITE tem `case` no roteador inbound.
//
// A classe de falha, e por que ela é muda: uma op cujo `entityType` não tem `case`
// em `applyRemoteOperation` (`frontend/src/js/store/sync/remote-operation-handler.js`)
// cai no ramo padrão, vira um `console.warn` e acaba ali. O autor vê a própria tela
// certa, o servidor grava, o par nunca converge, e nada falha: nem o push, nem o ack,
// nem a suíte. É a forma mais barata de perder trabalho de outra pessoa que este
// repositório tem.
//
// Por que um TESTE e não uma regra de lint: as regras do frontend só rodam sobre
// `src/`, e este desvio é invisível no arquivo que o comete. Quem acrescenta um
// `EntityType` e um logger no despachante não vê, ali, o switch de outro arquivo.
//
// COMO A EXTRAÇÃO FUNCIONA, e por que ela FATIA em vez de varrer o arquivo inteiro:
// existem DOIS switches sobre `entityType` neste arquivo. O principal, em
// `applyRemoteOperation`, e um segundo em `applyRemoteMapSettingOp`, cujos cinco
// rótulos são SUBCONJUNTO do primeiro. Uma regex de arquivo inteiro somaria os dois
// e deixaria passar exatamente a mutação mais provável: apagar um `case` do switch
// principal enquanto o interno continua citando o mesmo tipo. Por isso o recorte vai
// do `switch` de `applyRemoteOperation` até o PRIMEIRO ramo padrão, e o teste assere
// que o recorte é o que pensa que é antes de contar qualquer rótulo.
//
// A âncora do switch aceita discriminante de QUALQUER nome (`switch (x)`), para que
// renomear a variável não quebre o guarda.
//
// COMENTÁRIO NÃO É CÓDIGO, e esta linha custou uma rodada: a primeira versão deste
// guarda contava `// case EntityType.COMMENT:` como roteamento, então o controle
// negativo canônico do plano (comentar um case) passava VERDE. O recorte do handler
// é feito sobre a fonte sem comentários. A assimetria é deliberada: só o HANDLER é
// limpo, porque só ali um comentário produz falso VERDE. No despachante e no corpus
// um emissor comentado seria contado como emissor, o que só produz alarme falso,
// nunca silêncio, e não vale o risco de o removedor de comentários se confundir com
// um literal de expressão regular em algum dos ~600 arquivos.
//
// FRAGILIDADES ACEITAS (todas quebram para o lado seguro, que é o piso vermelho, e
// nunca para o verde vazio):
//   - trocar o switch por tabela de funções;
//   - trocar o rótulo `case EntityType.X` por literal de string (`case 'feature'`);
//   - renomear o enum com alias no import (`import { EntityType as T }`);
//   - inserir outro switch dentro de `applyRemoteOperation` ANTES do principal.
// A quarta é a única que poderia produzir um recorte errado sem cair no piso, e é
// por isso que existe a asserção de forma sobre o recorte.
//
// O que o verde NÃO prova: que o `case` faça a coisa certa. Prova só que ele existe.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EntityType } from '../../src/js/store/sync/operation-types.js';

const RAIZ = resolvePath(dirname(fileURLToPath(import.meta.url)), '../../..');
const SRC = 'frontend/src/js';
const HANDLER = 'frontend/src/js/store/sync/remote-operation-handler.js';
const DISPATCHER = 'frontend/src/js/store/sync/operation-dispatcher.js';

/**
 * Lacunas conhecidas do enum: membros que hoje não têm emissor NEM `case`.
 *
 * Isto NÃO é allowlist. Uma allowlist fica verde para sempre; este marcador quebra
 * nos DOIS sentidos, porque o teste exige que o conjunto seja exatamente este:
 * quebra quando o tipo ganhar `case` (a lacuna fechou, revise a decisão) e quebra
 * quando o tipo sair do enum (a lacuna sumiu, remova a entrada). A decisão de
 * produto pendente é "remover `atlas` do enum ou lhe dar emissor", e ela não tem
 * dono; o marcador existe para que ela não possa ser fechada em silêncio.
 */
const LACUNAS_CONHECIDAS = new Map([
    ['ATLAS', 'membro morto: nenhum `EntityType.ATLAS` é emitido e nenhum `case` o roteia.'
        + ' Configuração de atlas viaja como `setting`, com o id do atlas ou o sentinela'
        + ' `atlas` no slot de entityId. Ver docs/wiki/tipos-entidade-sync.md.'],
]);

// ---------------------------------------------------------------------------
// Extração
// ---------------------------------------------------------------------------

/**
 * Apaga comentários de linha e de bloco, preservando o conteúdo de literais de
 * string (aspas simples, duplas e template), para que um `case` comentado deixe de
 * contar como roteamento.
 *
 * NÃO reconhece literal de expressão regular, e é por isso que só o handler passa
 * por aqui: um `/['"]/` faria a varredura acreditar que uma string abriu e engolir
 * o resto do arquivo. O handler não tem nenhum (conferido), e o teste assere abaixo
 * que o recorte continua com a forma esperada, que é o que pega essa hipótese.
 *
 * @param {string} fonte
 * @returns {string}
 */
function semComentarios(fonte) {
    let saida = '';
    let i = 0;
    while (i < fonte.length) {
        const atual = fonte[i];
        const proximo = fonte[i + 1];
        if (atual === '/' && proximo === '/') {
            while (i < fonte.length && fonte[i] !== '\n') i++;
            continue;
        }
        if (atual === '/' && proximo === '*') {
            i += 2;
            while (i < fonte.length && !(fonte[i] === '*' && fonte[i + 1] === '/')) i++;
            i += 2;
            continue;
        }
        if (atual === '"' || atual === "'" || atual === '`') {
            saida += atual;
            i++;
            while (i < fonte.length) {
                if (fonte[i] === '\\') {
                    saida += fonte[i] + (fonte[i + 1] ?? '');
                    i += 2;
                    continue;
                }
                saida += fonte[i];
                const fechou = fonte[i] === atual;
                i++;
                if (fechou) break;
            }
            continue;
        }
        saida += atual;
        i++;
    }
    return saida;
}

/**
 * Recorta o corpo do switch principal de `applyRemoteOperation`: do `switch (...)`
 * até o primeiro ramo padrão. Opera sobre a fonte SEM comentários.
 *
 * @param {string} fonteBruta - Código de remote-operation-handler.js
 * @returns {string|null} O recorte, ou null quando a âncora não casou.
 */
function recortarSwitchPrincipal(fonteBruta) {
    const fonte = semComentarios(fonteBruta);
    const declaracao = fonte.indexOf('function applyRemoteOperation');
    if (declaracao === -1) return null;

    // Discriminante de QUALQUER nome e de qualquer forma sem parênteses aninhados
    // (`switch (entityType)`, `switch (op.entityType)`): renomear a variável, ou
    // deixar de desestruturá-la, não pode quebrar o guarda.
    const abertura = /switch\s*\(\s*[^()\n]{1,60}\)\s*\{/g;
    abertura.lastIndex = declaracao;
    const inicio = abertura.exec(fonte);
    if (!inicio) return null;

    const padrao = /(?:^|[\s{;])default\s*:/g;
    padrao.lastIndex = abertura.lastIndex;
    const fim = padrao.exec(fonte);
    if (!fim) return null;

    return fonte.slice(inicio.index, fim.index);
}

/**
 * Rótulos `case EntityType.X:` de um recorte, na ordem em que aparecem.
 * @param {string} recorte
 * @returns {string[]} Nomes de membro do enum (chaves, não valores).
 */
function rotulosDoRecorte(recorte) {
    return [...recorte.matchAll(/case\s+EntityType\.([A-Z0-9_]+)\s*:/g)].map((m) => m[1]);
}

/**
 * Tipos que o cliente EMITE: as duas fábricas do despachante mais toda chamada
 * direta de `logOperation(EntityType.X, ...)` em qualquer arquivo de `src/js`.
 *
 * A varredura das chamadas diretas é do corpus INTEIRO de propósito: o único emissor
 * de `slide` mora em `frontend/src/js/store/briefing.operations.js`, não no
 * despachante, e um extrator que olhasse só o despachante não o veria.
 *
 * @param {string} despachante - Código de operation-dispatcher.js
 * @param {Map<string, string>} corpus - {caminho: código} de src/js
 * @returns {{fabricas: Set<string>, diretos: Set<string>, todos: Set<string>}}
 */
function extrairEmitidos(despachante, corpus) {
    const fabricas = new Set();
    for (const m of despachante.matchAll(/create(?:Entity|MapSetting)Logger\(\s*EntityType\.([A-Z0-9_]+)/g)) {
        fabricas.add(m[1]);
    }
    const diretos = new Set();
    for (const codigo of corpus.values()) {
        for (const m of codigo.matchAll(/logOperation\(\s*EntityType\.([A-Z0-9_]+)/g)) diretos.add(m[1]);
    }
    return { fabricas, diretos, todos: new Set([...fabricas, ...diretos]) };
}

// ---------------------------------------------------------------------------
// Corpus real
// ---------------------------------------------------------------------------

function coletar(dir, acc = []) {
    const abs = join(RAIZ, dir);
    if (!existsSync(abs)) return acc;
    for (const nome of readdirSync(abs)) {
        if (['node_modules', 'vendors', 'dist', 'coverage'].includes(nome)) continue;
        const rel = `${dir}/${nome}`;
        if (statSync(join(RAIZ, rel)).isDirectory()) coletar(rel, acc);
        else if (nome.endsWith('.js')) acc.push(rel);
    }
    return acc;
}

const ARQUIVOS = coletar(SRC);
const CORPUS = new Map(ARQUIVOS.map((f) => [f, readFileSync(join(RAIZ, f), 'utf8')]));
const FONTE_HANDLER = readFileSync(join(RAIZ, HANDLER), 'utf8');
const FONTE_DISPATCHER = readFileSync(join(RAIZ, DISPATCHER), 'utf8');

const RECORTE = recortarSwitchPrincipal(FONTE_HANDLER);
const ROTULOS = RECORTE ? rotulosDoRecorte(RECORTE) : [];
const ROTEADOS = new Set(ROTULOS);
const EMITIDOS = extrairEmitidos(FONTE_DISPATCHER, CORPUS);
const MEMBROS = new Set(Object.keys(EntityType));

// ---------------------------------------------------------------------------

describe('roteamento inbound: todo EntityType emitido tem case', () => {
    it('CONTROLE POSITIVO: o extrator pega o primeiro switch e ignora o segundo', () => {
        // O teste do teste, e ele roda ANTES de qualquer varredura real. Sem ele, um
        // extrator que deixasse de reconhecer o switch reportaria "nenhum tipo fora do
        // roteador" e passaria verde para sempre.
        const doisSwitches = `
export async function applyRemoteOperation(operation) {
    const { entityType } = operation;
    switch (entityType) {
        case EntityType.ALFA:
            await umaCoisa();
            break;
        case EntityType.BETA:
        case EntityType.GAMA:
            await outraCoisa();
            break;
        default:
            console.warn('unknown entity type');
    }
}

async function applyRemoteMapSettingOp(entityType) {
    switch (entityType) {
        case EntityType.DELTA:
            break;
        default:
            break;
    }
}
`;
        const recorte = recortarSwitchPrincipal(doisSwitches);
        expect(recorte, 'o extrator não achou o switch principal na fixture').not.toBeNull();
        const rotulos = rotulosDoRecorte(recorte);
        expect(rotulos, 'o extrator perdeu um rótulo do switch principal (ou o case empilhado)')
            .toEqual(['ALFA', 'BETA', 'GAMA']);
        expect(rotulos, 'o extrator ATRAVESSOU o ramo padrão e comeu o segundo switch')
            .not.toContain('DELTA');

        // Discriminante de outro nome: renomear a variável não pode quebrar o guarda.
        const renomeado = doisSwitches.replace('switch (entityType)', 'switch (tipoDaVez)');
        expect(rotulosDoRecorte(recortarSwitchPrincipal(renomeado)),
            'a âncora do switch está presa ao nome do discriminante').toEqual(['ALFA', 'BETA', 'GAMA']);

        // Sem switch nenhum: o extrator tem de devolver null, e não um recorte vazio
        // que passaria por "nenhum tipo faltando".
        expect(recortarSwitchPrincipal('export async function applyRemoteOperation(op) { return op; }'),
            'sem switch o extrator deveria devolver null, não um recorte').toBeNull();
    });

    it('CONTROLE POSITIVO: um case COMENTADO não conta como roteamento', () => {
        // Este é o controle negativo canônico do plano (comentar um `case`), e a
        // primeira versão deste guarda passava VERDE nele: a regex casava dentro do
        // comentário. Fixado aqui para nunca mais depender de alguém lembrar.
        const comentado = `
export async function applyRemoteOperation(operation) {
    switch (operation.entityType) {
        case EntityType.ALFA:
            break;
        // case EntityType.BETA:
        /* case EntityType.GAMA: */
        default:
            console.warn('unknown');
    }
}
`;
        expect(rotulosDoRecorte(recortarSwitchPrincipal(comentado)),
            'case comentado (de linha ou de bloco) ainda está contando como roteamento')
            .toEqual(['ALFA']);

        // E o removedor de comentários não pode comer o que está DENTRO de string.
        expect(semComentarios('const s = "a // b"; // fora\nconst t = `c /* d */`;'),
            'o removedor de comentários mexeu no conteúdo de um literal de string')
            .toBe('const s = "a // b"; \nconst t = `c /* d */`;');
    });

    it('CONTROLE POSITIVO: o extrator de emissores enxerga as duas fábricas e a chamada direta', () => {
        const despachante = `
export const logFeatureOperation = createEntityLogger(EntityType.ALFA);
export const logMapOperation = createEntityLogger(EntityType.BETA, true);
export const logGridStyleOperation = createMapSettingLogger(EntityType.GAMA);
export async function logOperation(entityType, opType) { return [entityType, opType]; }
`;
        const corpus = new Map([
            ['frontend/src/js/store/__fixture__/pai.operations.js',
                'logOperation(EntityType.DELTA, OperationType.CREATE, id, paiId, filho);'],
            ['frontend/src/js/store/__fixture__/inerte.js', 'const x = 1;'],
        ]);
        const r = extrairEmitidos(despachante, corpus);
        expect([...r.fabricas].sort(), 'as fábricas não foram extraídas').toEqual(['ALFA', 'BETA', 'GAMA']);
        expect([...r.diretos], 'a chamada direta de logOperation não foi extraída').toEqual(['DELTA']);
        expect(r.todos.size, 'a união dos emissores está errada').toBe(4);
    });

    it('PISO: as âncoras casaram e o recorte é o que este teste pensa que é', () => {
        // Sem este piso, o dia em que a âncora quebrar produz o diagnóstico ERRADO:
        // lê-se "nenhum tipo fora do roteador" onde o certo é "o extrator parou de
        // funcionar" — verde vazio com cara de rigor.
        expect(RECORTE,
            `âncora quebrada: não achei o switch de applyRemoteOperation em ${HANDLER}.`
            + ' Sem o recorte, TODAS as asserções abaixo passariam em vazio.').not.toBeNull();
        expect(ROTULOS.length,
            'o recorte não tem nenhum `case EntityType.X:`: a extração quebrou').toBeGreaterThan(15);
        expect(ROTULOS.length, 'rótulo duplicado dentro do switch principal').toBe(ROTEADOS.size);

        // O recorte é o corpo do switch principal, não outra coisa: ele cita os
        // handlers que só o switch principal chama, e não contém um segundo switch.
        expect(RECORTE.includes('applyRemoteFeatureOp('),
            'o recorte não chama applyRemoteFeatureOp: não é o switch principal').toBe(true);
        expect(RECORTE.includes('applyRemoteSettingOp('),
            'o recorte não chega até o case de setting: parou cedo demais').toBe(true);
        expect((RECORTE.match(/switch\s*\(/g) || []).length,
            'há mais de um `switch (` dentro do recorte: a fatia pegou o bloco errado').toBe(1);

        expect(ARQUIVOS.length, 'corpus de src/js vazio ou não coletado').toBeGreaterThan(400);
        expect(EMITIDOS.fabricas.size,
            'nenhuma fábrica de logger extraída do despachante: a regex quebrou').toBeGreaterThan(15);
        expect(EMITIDOS.diretos.size,
            'nenhuma chamada direta de logOperation(EntityType.X) no corpus: a regex quebrou')
            .toBeGreaterThan(0);
        expect(MEMBROS.size, 'EntityType veio vazio (import quebrado?)').toBeGreaterThan(15);
    });

    it('todo rótulo extraído é membro real de EntityType', () => {
        // Pega o alias no import e o rótulo com nome de membro que não existe mais:
        // sem isto, um `case EntityType.MARKER3D:` (sem underscore) contaria como
        // roteamento de um tipo inexistente e mascararia a falta do tipo real.
        const fantasmas = [...ROTEADOS].filter((nome) => !MEMBROS.has(nome));
        expect(fantasmas,
            `case citando membro que não existe em EntityType: ${fantasmas.join(', ')}`).toEqual([]);
        const emitidosFantasmas = [...EMITIDOS.todos].filter((nome) => !MEMBROS.has(nome));
        expect(emitidosFantasmas,
            `emissor citando membro que não existe em EntityType: ${emitidosFantasmas.join(', ')}`).toEqual([]);
    });

    it('todo EntityType EMITIDO tem case no switch principal', () => {
        const orfaos = [...EMITIDOS.todos].filter((nome) => !ROTEADOS.has(nome));
        expect(
            orfaos,
            'tipo que o cliente emite e o roteador inbound não conhece. A op sai, chega ao par,'
            + ' cai no ramo padrão de `applyRemoteOperation` e morre num `console.warn`: o par'
            + ' NUNCA converge e nada falha.\n'
            + `Acrescente um \`case EntityType.X:\` no switch principal de ${HANDLER}.\n`
            + 'Duas armadilhas: (a) o switch interno de `applyRemoteMapSettingOp` NÃO conta,'
            + ' porque só é alcançado pelo case do principal; (b) tipo que é no-op inbound de'
            + ' propósito (o `slide`, que converge pela op do `briefing` pai) precisa do `case`'
            + ' assim mesmo, exatamente para não cair no `warn`.\n'
            + `Tipos sem case: ${orfaos.join(', ')}`
        ).toEqual([]);
    });

    it('o universo do enum está fechado: roteado, ou lacuna declarada', () => {
        const semDestino = [...MEMBROS].filter(
            (nome) => !ROTEADOS.has(nome) && !LACUNAS_CONHECIDAS.has(nome)
        );
        expect(
            semDestino,
            'membro de EntityType sem `case` inbound e sem lacuna declarada. Ou ele ganha um'
            + ' `case`, ou entra em LACUNAS_CONHECIDAS com o motivo escrito, ou sai do enum.\n'
            + `Membros: ${semDestino.join(', ')}`
        ).toEqual([]);
    });

    it('a lacuna conhecida quebra nos DOIS sentidos', () => {
        for (const [nome, motivo] of LACUNAS_CONHECIDAS) {
            expect(MEMBROS.has(nome),
                `LACUNAS_CONHECIDAS cita "${nome}", que não é mais membro de EntityType.`
                + ' A lacuna sumiu: remova a entrada deste teste (e a nota da wiki).').toBe(true);
            expect(ROTEADOS.has(nome),
                `"${nome}" GANHOU um case inbound e continua declarado como lacuna.`
                + ' A decisão pendente foi fechada: remova a entrada e registre a decisão.').toBe(false);
            expect(EMITIDOS.todos.has(nome),
                `"${nome}" GANHOU um emissor e continua declarado como lacuna, sem case inbound.`
                + ' Isto é a classe que este arquivo inteiro existe para pegar: dê-lhe o case.').toBe(false);
            expect(motivo.length,
                `lacuna "${nome}" declarada sem motivo escrito`).toBeGreaterThan(60);
        }
        // Piso anti-tapete: esvaziar o mapa não pode virar um jeito de passar verde.
        expect(LACUNAS_CONHECIDAS.size,
            'LACUNAS_CONHECIDAS vazio. Se a lacuna do `atlas` foi fechada, isso é uma decisão'
            + ' registrada, não uma linha apagada: confirme e ajuste este piso.').toBe(1);
    });
});
