// Path: tests/unit/despachante-sem-escrita-crua.test.js
//
// A pré-condição que o despachante de diff DECLARA, cobrada por varredura do
// código em vez de por leitura atenta.
//
// A regra, que está escrita no `@fileoverview` de
// `frontend/src/js/layers/geojson-dispatcher.js`: uma source só pode ser migrada
// quando TODOS os seus escritores passarem pelo despachante. O motivo é medido,
// não teórico: `setData` de uma coleção inteira substitui o slot de
// pending-update do MapLibre, então um `setData` cru emitido enquanto existe um
// diff na fila faz o diff sumir. Sem exceção, sem log, sem erro. O usuário perde
// a feição que acabou de desenhar e nada no console diz por quê.
//
// Por que um teste e não uma linha de regra: o desvio é INVISÍVEL na leitura do
// arquivo que o comete. Quem escreve `map.getSource('polygons').setData(fc)` num
// controle de medição não tem como saber, ali, que outro arquivo migrou
// `polygons` para o despachante três meses antes. É exatamente a classe
// `verificacao-fantasma` do livro-razão: a checagem existia (em prosa) e não
// checava. Ao ser escrito, este guarda achou 22 escritores crus vivos sobre
// sources já migradas, incluindo `setOrCreateSource`, que é o co-escritor de TODAS
// as dezesseis.
//
// O que a varredura pergunta de cada `X.setData(...)` do `src/js`: dá para PROVAR
// que o alvo não é uma source com despachante? Só três respostas passam:
//   1. o receptor é um despachante (`getGeoJsonDispatcher(...)` ou um helper que
//      devolve um);
//   2. o id da source resolve para literal e não está no inventário migrado;
//   3. o arquivo está na allowlist, com motivo escrito e com a CONTAGEM de
//      chamadas declarada.
// Não provar é reprovar, de propósito: id vindo de parâmetro ou de variável é o
// caso em que a perda de dado é possível, então ele tem que ser decidido por
// alguém, não abençoado pelo silêncio da regex.
//
// Duas armadilhas que decidem se este arquivo vale alguma coisa, e como cada uma
// foi fechada:
//
// - INVENTÁRIO À MÃO ENVELHECE. A lista de sources migradas não é escrita aqui:
//   é DERIVADA dos pontos onde o despachante é instanciado
//   (`getGeoJsonDispatcher(map, '<id>')`). Migrar uma source nova a põe sob
//   vigilância no mesmo commit, sem ninguém lembrar de vir aqui.
// - VERDE VAZIO. Uma varredura que não casa com nada passa verde sem verificar
//   nada, e é o modo de falha mais caro que um teste-varredura tem. Por isso há
//   controle positivo: a mesma função de análise roda contra fixtures sintéticas
//   e o teste EXIGE que ela acuse a escrita crua e ABSOLVA as duas formas
//   corretas. Se a análise parar de enxergar o código, o controle positivo cai
//   antes da varredura real.

import { describe, it, expect } from 'vitest';
import { parse } from 'acorn';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolvePath(dirname(fileURLToPath(import.meta.url)), '../../..');
const SRC = 'frontend/src/js';

// ---------------------------------------------------------------------------
// Allowlist: escrita crua legítima, com motivo E contagem
// ---------------------------------------------------------------------------

/**
 * Arquivos que escrevem `setData` sem passar pelo despachante e podem.
 *
 * A `contagem` não é burocracia: sem ela, uma entrada aqui viraria cheque em
 * branco para o arquivo inteiro, e a próxima escrita crua acrescentada nele
 * entraria em silêncio, que é precisamente o que este guarda existe para
 * impedir. Com ela, acrescentar uma chamada quebra o teste e obriga a decisão a
 * ser tomada de novo.
 */
const ESCRITA_CRUA_DE_PROPOSITO = new Map([
    ['frontend/src/js/layers/geojson-dispatcher.js', {
        chamadas: 2,
        motivo: 'o próprio despachante. É o único módulo que pode tocar uma source diretamente:'
            + ' `_writeWholeCollection` é o caminho de coleção inteira (redesenho e fallback de'
            + ' diff que falhou) e `writeWholeCollection` é o caminho cru das sources que NENHUM'
            + ' despachante possui, onde não existe fila para perder.',
    }],
    ['frontend/src/js/import_export/export-utils.js', {
        chamadas: 1,
        motivo: 'escreve no `hiddenMap`, o mapa fora de tela que o export monta e descarta. O'
            + ' registro do despachante é por (map, sourceId) e esse mapa não tem despachante'
            + ' nenhum, então não há fila para substituir. A varredura não prova isso porque o id'
            + ' vem de `ZOOM_INVARIANT_SOURCES`, e provar identidade de instância de mapa é'
            + ' análise de outra ordem.',
    }],
    ['frontend/src/js/tool_manager/helpers/label-tab.helpers.js', {
        chamadas: 1,
        motivo: '`syncLabelSource` escreve só as sources de etiqueta (`polygon-labels`,'
            + ' `circle-labels` e irmãs), declaradas DELIBERADAMENTE sem `promoteId` em'
            + ' `layers/styles/layer.helpers.js` e portanto não-difáveis e sem despachante'
            + ' possível. O id chega por parâmetro, então a prova estática não fecha.',
    }],
    ['frontend/src/js/azimuth_distance_tool/add_azimuth_distance_control.js', {
        chamadas: 2,
        motivo: 'as duas escritas são o preview do gesto, em `point-feedback`/`line-feedback`/'
            + '`polygon-feedback`, devolvidos por `_getFeedbackSource`. Fonte efêmera sem'
            + ' `properties.id`, declarada sem `promoteId` e nunca candidata a diff. As escritas'
            + ' PERSISTENTES deste arquivo (points/lines/polygons) já passam pelo despachante.',
    }],
    ['frontend/src/js/temporal/temporal-render.service.js', {
        chamadas: 2,
        motivo: 'as duas únicas escritas cruas que sobram sobre sources MIGRADAS, e ficam por'
            + ' decisão registrada no próprio arquivo. A do playback roda a cada rAF e é o'
            + ' contrato da cópia retida (`state.token`), fixado por'
            + ' `frontend/tests/unit/temporal-render-retained-source.test.js`: trocá-la pelo'
            + ' despachante adia a escrita um frame e invalida o token. A de `shiftSourcesTemporal`'
            + ' é mutação em massa da coleção inteira. As duas descartariam um diff enfileirado se'
            + ' houvesse um; fechá-las exige medir o playback, que é trabalho de outra fase.',
    }],
]);

/**
 * Instanciação de despachante com id que não resolve para literal.
 *
 * Estas não são violação: são o LIMITE do inventário derivado. Uma source que só
 * fosse dispachada por um destes sítios não apareceria em DISPATCHER_SOURCES, e
 * seus escritores crus passariam despercebidos. Declarar cada arquivo mantém o
 * ponto cego visível em vez de esquecido; todos os ids que passam por aqui são
 * sources já reivindicadas por um sítio literal na ferramenta que as possui.
 */
const DISPATCHER_DINAMICO_DE_PROPOSITO = new Map([
    ['frontend/src/js/azimuth_distance_tool/add_azimuth_distance_control.js',
        '`collectionSource(map, sourceName)` com sourceName em {points, lines, polygons}'],
    ['frontend/src/js/phone/phone-layout.js', '`storageType` da feição arrastada no layout de telefone'],
    ['frontend/src/js/temporal/temporal-render.service.js', '`sourceId` da source em playback'],
    ['frontend/src/js/attribute_table/attribute-table.control.js', '`sourceId` da linha editada na tabela'],
    ['frontend/src/js/context-menu/context-menu.control.js', '`storageType` da feição sob o menu'],
    ['frontend/src/js/features_tab/features_tab.js', '`sourceId` varrendo FEATURE_SOURCES'],
    ['frontend/src/js/import_export/import.control.js', '`sourceName` do tipo importado'],
    ['frontend/src/js/processing/processing-runner.js', '`storageType` do resultado do algoritmo'],
    ['frontend/src/js/sidebar/components/multi-selection-actions.js', '`storageType` da seleção múltipla'],
    ['frontend/src/js/tool_manager/clipboard_manager.js', '`storageType` da colagem'],
    ['frontend/src/js/tool_manager/helpers/label-tab.helpers.js', '`sourceName` da ferramenta que criou o handler'],
]);

// ---------------------------------------------------------------------------
// Análise estática
// ---------------------------------------------------------------------------

const FUNCOES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

/** Percorre a AST inteira levando a pilha de ancestrais. */
function percorrer(no, visitar, pilha = []) {
    if (!no || typeof no !== 'object') return;
    if (Array.isArray(no)) {
        for (const n of no) percorrer(n, visitar, pilha);
        return;
    }
    if (typeof no.type !== 'string') return;
    visitar(no, pilha);
    pilha.push(no);
    for (const chave of Object.keys(no)) {
        if (chave === 'type' || chave === 'start' || chave === 'end' || chave === 'loc') continue;
        percorrer(no[chave], visitar, pilha);
    }
    pilha.pop();
}

/** Tira `await`, `?.` e parênteses de cima de uma expressão. */
function nu(n) {
    while (n && (n.type === 'ChainExpression' || n.type === 'AwaitExpression' || n.type === 'ParenthesizedExpression')) {
        n = n.expression ?? n.argument;
    }
    return n;
}

/** Literal string (inclusive template sem interpolação) como conjunto de um elemento. */
function literal(no) {
    no = nu(no);
    if (!no) return null;
    if (no.type === 'Literal' && typeof no.value === 'string') return new Set([no.value]);
    if (no.type === 'TemplateLiteral' && no.expressions.length === 0) return new Set([no.quasis[0].value.cooked]);
    return null;
}

/** Array só de literais string; qualquer elemento não-literal invalida o todo. */
function arranjo(no) {
    no = nu(no);
    if (!no || no.type !== 'ArrayExpression') return null;
    const saida = new Set();
    for (const el of no.elements) {
        const s = literal(el);
        if (!s) return null;
        for (const v of s) saida.add(v);
    }
    return saida;
}

/** ObjectExpression, atravessando um `Object.freeze(...)` em volta. */
function objeto(no) {
    let n = nu(no);
    if (n && n.type === 'CallExpression' && n.callee.type === 'MemberExpression'
        && n.callee.object?.name === 'Object' && n.callee.property?.name === 'freeze') n = nu(n.arguments[0]);
    return n && n.type === 'ObjectExpression' ? n : null;
}

/** Nome da função chamada, seja `f()` ou `o.f()`. */
function nomeDaChamada(no) {
    const callee = nu(no.callee);
    if (!callee) return null;
    if (callee.type === 'Identifier') return callee.name;
    if (callee.type === 'MemberExpression' && !callee.computed) return callee.property?.name ?? null;
    return null;
}

/** Aliases do `vite.config.js` usados para seguir import entre módulos. */
const ALIAS = {
    '@js/': 'frontend/src/js/', '@store/': 'frontend/src/js/store/', '@utils/': 'frontend/src/js/utilities/',
    '@tools/': 'frontend/src/js/tools/', '@toolbar/': 'frontend/src/js/toolbar/', '@modals/': 'frontend/src/js/modals/',
    '@sidebar/': 'frontend/src/js/sidebar/', '@layers/': 'frontend/src/js/layers/', '@catalog/': 'frontend/src/js/catalog/',
    '@ui/': 'frontend/src/js/ui/', '@events/': 'frontend/src/js/events/', '@state/': 'frontend/src/js/state/',
    '@/': 'frontend/src/',
};

/**
 * Analisa um conjunto de arquivos e devolve o inventário derivado, as escritas
 * cruas encontradas e as instanciações dinâmicas.
 *
 * Recebe o corpus como mapa {caminho: código} para que as fixtures do controle
 * positivo rodem pela MESMA função que a varredura real. Duas cópias da análise
 * divergiriam, e a que passa verde seria a errada.
 * @param {Map<string, string>} corpus - Arquivos a analisar
 * @returns {{sources: Set<string>, cruas: Array, dinamicos: Array, sitios: number}}
 */
function analisar(corpus) {
    const INFO = new Map();
    for (const [arquivo, codigo] of corpus) {
        INFO.set(arquivo, {
            arquivo,
            ast: parse(codigo, { ecmaVersion: 'latest', sourceType: 'module', locations: true }),
        });
    }

    const resolverModulo = (deArquivo, especificador) => {
        let alvo = null;
        if (especificador.startsWith('.')) {
            alvo = resolvePath(dirname(join(RAIZ, deArquivo)), especificador).replaceAll('\\', '/');
            alvo = alvo.slice(RAIZ.length + 1);
        } else {
            for (const [a, p] of Object.entries(ALIAS)) {
                if (especificador.startsWith(a)) { alvo = p + especificador.slice(a.length); break; }
            }
        }
        if (!alvo) return null;
        for (const cand of [alvo, `${alvo}.js`, `${alvo}/index.js`]) if (INFO.has(cand)) return cand;
        return null;
    };

    // --- passada 1: constantes de módulo, imports e fábricas de despachante ---
    for (const info of INFO.values()) {
        const consts = new Map();
        const acrescentar = (nome, vals) => {
            if (!vals || !vals.size) return;
            if (!consts.has(nome)) consts.set(nome, new Set());
            for (const v of vals) consts.get(nome).add(v);
        };
        const imports = new Map();
        const fabricas = new Set();

        percorrer(info.ast, (no) => {
            if (no.type === 'ImportDeclaration') {
                for (const esp of no.specifiers) {
                    if (esp.type === 'ImportSpecifier') imports.set(esp.local.name, { spec: no.source.value, nome: esp.imported.name });
                }
            }
            if (no.type === 'VariableDeclarator' && no.id.type === 'Identifier') {
                acrescentar(no.id.name, literal(no.init) || arranjo(no.init));
                const o = objeto(no.init);
                if (o) {
                    for (const p of o.properties) {
                        if (p.type !== 'Property' || p.computed) continue;
                        acrescentar(`${no.id.name}.${p.key.name ?? p.key.value}`, literal(p.value) || arranjo(p.value));
                    }
                }
            }
            if (no.type === 'AssignmentExpression' && no.left.type === 'MemberExpression'
                && !no.left.computed && no.left.object.type === 'ThisExpression') {
                acrescentar(`this.${no.left.property.name}`, literal(no.right) || arranjo(no.right));
            }
            if (no.type === 'PropertyDefinition' && !no.computed && no.key.type === 'Identifier') {
                acrescentar(`this.${no.key.name}`, literal(no.value) || arranjo(no.value));
            }
            // `function losSource(map) { return getGeoJsonDispatcher(map, 'los'); }` — o padrão
            // que as 24 ferramentas migradas usam. Sem reconhecê-lo, cada `losSource(map).add()`
            // viraria "receptor desconhecido" e a allowlist inflaria com falso-positivo.
            if (FUNCOES.has(no.type)) {
                const nome = no.type === 'FunctionDeclaration' ? no.id?.name : null;
                if (!nome) return;
                let devolve = false;
                percorrer(no.body, (n) => {
                    if (n.type !== 'ReturnStatement' || !n.argument) return;
                    const a = nu(n.argument);
                    if (a.type === 'CallExpression'
                        && (nomeDaChamada(a) === 'getGeoJsonDispatcher' || fabricas.has(nomeDaChamada(a)))) devolve = true;
                });
                if (devolve) fabricas.add(nome);
            }
        });
        info.consts = consts;
        info.imports = imports;
        info.fabricas = fabricas;
    }

    /** Constante do arquivo, ou a do módulo de onde ela foi importada. */
    const constDe = (info, nome, vistos = new Set()) => {
        if (info.consts.has(nome)) return info.consts.get(nome);
        const imp = info.imports.get(nome.split('.')[0]);
        if (!imp) return null;
        const alvo = resolverModulo(info.arquivo, imp.spec);
        if (!alvo || vistos.has(alvo)) return null;
        vistos.add(alvo);
        const renomeado = nome.includes('.') ? `${imp.nome}.${nome.split('.').slice(1).join('.')}` : imp.nome;
        return constDe(INFO.get(alvo), renomeado, vistos);
    };

    const escopoDe = (pilha) => {
        for (let i = pilha.length - 1; i >= 0; i--) if (FUNCOES.has(pilha[i].type)) return pilha[i];
        return pilha[0];
    };

    /**
     * Toda ligação de nome do arquivo, com a FAIXA em que ela é visível.
     *
     * A faixa é o que impede o vazamento de escopo: sem ela, um `sourceName` que
     * é parâmetro numa função e itera literais noutra faz a resolução misturar
     * as duas, e o inventário derivado engorda com fonte efêmera. Medido: a
     * primeira versão sem escopo pôs `line-feedback`, `point-feedback`,
     * `polygon-feedback` e `texts` entre as sources migradas e produziu 14
     * violações inexistentes.
     */
    const ligacoes = (info) => {
        const regs = [];
        percorrer(info.ast, (no, pilha) => {
            const esc = escopoDe(pilha.concat(no));
            if (no.type === 'VariableDeclarator' && no.id.type === 'Identifier') {
                regs.push({ nome: no.id.name, de: esc.start, ate: esc.end, pos: no.start, init: no.init });
            }
            if (no.type === 'AssignmentExpression' && no.left.type === 'Identifier') {
                regs.push({ nome: no.left.name, de: esc.start, ate: esc.end, pos: no.start, init: no.right });
            }
            if (no.type === 'AssignmentExpression' && no.left.type === 'MemberExpression' && !no.left.computed) {
                const dono = no.left.object.type === 'ThisExpression' ? 'this' : no.left.object.name;
                if (dono) {
                    regs.push({
                        nome: `${dono}.${no.left.property.name}`,
                        de: info.ast.start, ate: info.ast.end, pos: no.start, init: no.right,
                    });
                }
            }
            if (no.type === 'ForOfStatement' && no.left.type === 'VariableDeclaration') {
                const d = no.left.declarations[0];
                if (d?.id.type === 'Identifier') regs.push({ nome: d.id.name, de: no.start, ate: no.end, pos: no.start, iterando: no.right });
            }
            if (no.type === 'CallExpression' && no.callee.type === 'MemberExpression'
                && ['forEach', 'map', 'flatMap'].includes(no.callee.property?.name)) {
                const cb = no.arguments[0];
                if (cb && FUNCOES.has(cb.type) && cb.params[0]?.type === 'Identifier') {
                    regs.push({ nome: cb.params[0].name, de: cb.start, ate: cb.end, pos: cb.start, iterando: no.callee.object });
                }
            }
            // Parâmetro sombreia o de fora e NÃO é resolvível: registrá-lo como opaco é o que
            // faz a análise responder "não sei" em vez de responder o valor de outro escopo.
            if (FUNCOES.has(no.type)) {
                for (const p of no.params) if (p.type === 'Identifier') regs.push({ nome: p.name, de: no.start, ate: no.end, opaco: true });
            }
        });
        return regs;
    };

    /** A ligação de menor faixa que contém a posição. */
    const ligacaoEm = (regs, nome, pos) => {
        let melhor = null;
        for (const r of regs) {
            if (r.nome !== nome || pos < r.de || pos > r.ate) continue;
            if (!melhor || (r.ate - r.de) < (melhor.ate - melhor.de)) melhor = r;
        }
        return melhor;
    };

    const valoresDoObjeto = (info, regs, obj, pos) => {
        if (!obj || obj.type !== 'Identifier') return null;
        const b = ligacaoEm(regs, obj.name, pos);
        const alvo = b && b.init ? objeto(b.init) : null;
        if (alvo) {
            const saida = new Set();
            for (const p of alvo.properties) {
                const v = literal(p.value);
                if (!v) return null;
                for (const x of v) saida.add(x);
            }
            return saida;
        }
        const imp = info.imports.get(obj.name);
        if (!imp) return null;
        const outro = INFO.get(resolverModulo(info.arquivo, imp.spec));
        if (!outro) return null;
        const saida = new Set();
        for (const [k, v] of outro.consts) if (k.startsWith(`${imp.nome}.`)) for (const x of v) saida.add(x);
        return saida.size ? saida : null;
    };

    /** Conjunto de ids que uma expressão pode valer, ou null quando não dá para provar. */
    const idsDe = (info, regs, no, pos) => {
        no = nu(no);
        if (!no) return null;
        const l = literal(no) || arranjo(no);
        if (l) return l;
        if (no.type === 'ConditionalExpression') {
            const a = idsDe(info, regs, no.consequent, pos);
            const b = idsDe(info, regs, no.alternate, pos);
            return a && b ? new Set([...a, ...b]) : null;
        }
        if (no.type === 'CallExpression' && nomeDaChamada(no) === 'values' && no.callee.object?.name === 'Object') {
            return valoresDoObjeto(info, regs, nu(no.arguments[0]), pos);
        }
        let nome = null;
        if (no.type === 'Identifier') {nome = no.name;} else if (no.type === 'MemberExpression' && !no.computed) {
            const dono = no.object.type === 'ThisExpression' ? 'this' : no.object.name;
            if (dono) nome = `${dono}.${no.property.name}`;
        }
        if (!nome) return null;
        if (!nome.includes('.')) {
            const b = ligacaoEm(regs, nome, pos);
            if (b) {
                if (b.opaco) return null;
                if (b.iterando) return idsDe(info, regs, b.iterando, b.pos);
                return b.init ? idsDe(info, regs, b.init, b.pos) : null;
            }
        }
        return constDe(info, nome);
    };

    /** Classifica o receptor de um `.setData(...)`. */
    const classificar = (info, regs, receptor, pos) => {
        const obj = nu(receptor);
        if (!obj) return { tipo: 'opaco' };
        if (obj.type === 'CallExpression') {
            const nome = nomeDaChamada(obj);
            if (nome === 'getSource') return { tipo: 'source', ids: idsDe(info, regs, obj.arguments[0], pos) };
            if (nome === 'getGeoJsonDispatcher' || nome === 'peekGeoJsonDispatcher' || info.fabricas.has(nome)) {
                return { tipo: 'despachante' };
            }
            return { tipo: 'opaco' };
        }
        let nome = null;
        if (obj.type === 'Identifier') {nome = obj.name;} else if (obj.type === 'MemberExpression' && !obj.computed) {
            const dono = obj.object.type === 'ThisExpression' ? 'this' : obj.object.name;
            if (dono) nome = `${dono}.${obj.property.name}`;
        }
        if (!nome) return { tipo: 'opaco' };
        const b = ligacaoEm(regs, nome, pos);
        if (!b || !b.init) return { tipo: 'opaco' };
        return classificar(info, regs, b.init, b.pos ?? b.de);
    };

    // --- passada 2: inventário derivado ---
    const sources = new Set();
    const dinamicos = [];
    for (const info of INFO.values()) {
        const regs = ligacoes(info);
        percorrer(info.ast, (no) => {
            if (no.type !== 'CallExpression') return;
            const nome = nomeDaChamada(no);
            if (nome !== 'getGeoJsonDispatcher' && nome !== 'destroyGeoJsonDispatcher') return;
            const vals = idsDe(info, regs, no.arguments[1], no.start);
            if (vals) for (const v of vals) sources.add(v);
            else dinamicos.push({ arquivo: info.arquivo, linha: no.loc.start.line });
        });
    }

    // --- passada 3: escritas ---
    const cruas = [];
    let sitios = 0;
    for (const info of INFO.values()) {
        const regs = ligacoes(info);
        percorrer(info.ast, (no) => {
            if (no.type !== 'CallExpression') return;
            const callee = nu(no.callee);
            if (callee.type !== 'MemberExpression' || callee.property?.name !== 'setData') return;
            sitios++;
            const r = classificar(info, regs, callee.object, no.start);
            if (r.tipo === 'despachante') return;
            const linha = no.loc.start.line;
            if (r.tipo === 'source' && r.ids) {
                const migradas = [...r.ids].filter((id) => sources.has(id));
                if (migradas.length) cruas.push({ arquivo: info.arquivo, linha, classe: 'source migrada', ids: migradas });
                return;
            }
            cruas.push({
                arquivo: info.arquivo,
                linha,
                classe: r.tipo === 'source' ? 'id da source não resolve' : 'receptor não resolve',
                ids: [],
            });
        });
    }

    return { sources, cruas, dinamicos, sitios };
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
const REAL = analisar(CORPUS);

// ---------------------------------------------------------------------------

describe('despachante de diff: nenhuma escrita crua sobre source migrada', () => {
    it('a varredura enxerga o código (guarda contra verde vazio)', () => {
        // Um corpus que encolheu para zero, ou uma busca que parou de casar,
        // passariam TODOS os testes abaixo sem verificar nada. Estes três pisos
        // são o que transforma "não achei violação" em "procurei e não achei".
        expect(ARQUIVOS.length, 'corpus de src/js vazio ou não coletado').toBeGreaterThan(400);
        expect(REAL.sitios, 'nenhuma chamada de setData encontrada: a análise quebrou').toBeGreaterThan(100);
        expect(REAL.sources.size, 'inventário de sources com despachante vazio').toBeGreaterThanOrEqual(15);
    });

    it('o inventário de sources migradas é DERIVADO, não escrito à mão', () => {
        // Nada nesta suíte lista as sources migradas: elas saem dos sítios de
        // `getGeoJsonDispatcher(map, '<id>')`. Migrar uma source nova a põe sob
        // vigilância no mesmo commit, e desmigrar a tira, sem visita a este
        // arquivo. A asserção aqui é só de forma: id de source é string não
        // vazia, sem espaço.
        for (const id of REAL.sources) {
            expect(typeof id, `id de source derivado não é string: ${String(id)}`).toBe('string');
            expect(id.length, 'id de source vazio no inventário derivado').toBeGreaterThan(0);
            expect(/\s/.test(id), `id de source com espaço (resolução errada?): "${id}"`).toBe(false);
        }
    });

    it('CONTROLE POSITIVO: a análise acusa a escrita crua e absolve as corretas', () => {
        // O teste do teste. Sem isto, uma análise que deixasse de reconhecer
        // `setData` reportaria zero violação e passaria verde para sempre — o
        // modo de falha exato que este repositório já pagou mais de uma vez.
        const fixtures = new Map([
            ['frontend/src/js/__fixture__/dono.js', `
                import { getGeoJsonDispatcher } from '@layers/geojson-dispatcher.js';
                export function dono(map) { return getGeoJsonDispatcher(map, 'fixture-migrada'); }
            `],
            // (1) deve PEGAR: escrita crua numa source que tem despachante
            ['frontend/src/js/__fixture__/crua.js', `
                export function escreve(map, fc) { map.getSource('fixture-migrada').setData(fc); }
            `],
            // (2) NÃO deve pegar: escrita numa source que ninguém migrou
            ['frontend/src/js/__fixture__/efemera.js', `
                export function escreve(map, fc) { map.getSource('fixture-feedback').setData(fc); }
            `],
            // (3) NÃO deve pegar: escrita pelo despachante, inclusive via helper
            ['frontend/src/js/__fixture__/correta.js', `
                import { getGeoJsonDispatcher } from '@layers/geojson-dispatcher.js';
                function fonte(map) { return getGeoJsonDispatcher(map, 'fixture-migrada'); }
                export function escreve(map, fc) {
                    fonte(map).setData(fc);
                    getGeoJsonDispatcher(map, 'fixture-migrada').setData(fc);
                }
            `],
            // (4) deve PEGAR: id vindo de parâmetro, que é o caso genérico onde
            // a perda de dado é possível e a prova não fecha
            ['frontend/src/js/__fixture__/generica.js', `
                export function escreve(map, sourceId, fc) { map.getSource(sourceId).setData(fc); }
            `],
        ]);

        const r = analisar(fixtures);
        expect(r.sources, 'a fixture não derivou a source migrada').toContain('fixture-migrada');

        const pegos = r.cruas.map((c) => c.arquivo);
        expect(pegos, 'a análise NÃO acusou a escrita crua sobre source migrada')
            .toContain('frontend/src/js/__fixture__/crua.js');
        expect(pegos, 'a análise NÃO acusou a escrita genérica por id de parâmetro')
            .toContain('frontend/src/js/__fixture__/generica.js');
        expect(pegos, 'falso positivo em source sem despachante')
            .not.toContain('frontend/src/js/__fixture__/efemera.js');
        expect(pegos, 'falso positivo em escrita pelo próprio despachante')
            .not.toContain('frontend/src/js/__fixture__/correta.js');
        expect(r.cruas.length, 'a fixture deveria produzir exatamente dois achados').toBe(2);
    });

    it('nenhum arquivo fora da allowlist escreve setData sem provar o alvo', () => {
        const violacoes = REAL.cruas
            .filter((c) => !ESCRITA_CRUA_DE_PROPOSITO.has(c.arquivo))
            .map((c) => `${c.arquivo}:${c.linha} (${c.classe}${c.ids.length ? `: ${c.ids.join(', ')}` : ''})`);

        expect(
            violacoes,
            'escrita crua sobre source com despachante, ou escrita cujo alvo não dá para provar.'
                + ' Um setData por fora apaga o diff enfileirado sem erro nenhum. Roteie pelo'
                + ' despachante (`add`/`patch`/`remove`, ou `writeWholeCollection` para redesenho),'
                + ' ou declare o arquivo em ESCRITA_CRUA_DE_PROPOSITO com motivo e contagem:\n'
                + violacoes.join('\n')
        ).toEqual([]);
    });

    it('toda entrada da allowlist ainda corresponde ao que existe no código', () => {
        // Allowlist é dívida declarada, e dívida declarada apodrece igual a
        // documentação. Entrada morta (arquivo corrigido e ninguém removeu a
        // isenção) devolve cheque em branco a um arquivo que já não precisa
        // dele; contagem desatualizada deixa entrar a PRÓXIMA escrita crua em
        // silêncio, que é o buraco exato que este teste fecha.
        const porArquivo = new Map();
        for (const c of REAL.cruas) porArquivo.set(c.arquivo, (porArquivo.get(c.arquivo) || 0) + 1);

        const problemas = [];
        for (const [arquivo, { chamadas, motivo }] of ESCRITA_CRUA_DE_PROPOSITO) {
            expect(motivo.length, `entrada de allowlist sem motivo escrito: ${arquivo}`).toBeGreaterThan(40);
            const achadas = porArquivo.get(arquivo) || 0;
            if (achadas === 0) problemas.push(`${arquivo}: isenção morta, nenhuma escrita crua sobrou (remova a entrada)`);
            else if (achadas !== chamadas) problemas.push(`${arquivo}: declarado ${chamadas}, encontrado ${achadas}`);
        }
        expect(problemas, `allowlist fora de sincronia com o código:\n${problemas.join('\n')}`).toEqual([]);
        expect(ESCRITA_CRUA_DE_PROPOSITO.size, 'allowlist vazia: o teste deixou de exercitar este caminho').toBeGreaterThan(0);
    });

    it('toda instanciação de despachante com id dinâmico está declarada', () => {
        // Estas são o limite do inventário derivado, não uma violação: uma
        // source dispachada SÓ por um destes sítios não entraria em
        // DISPATCHER_SOURCES e seus escritores crus passariam despercebidos.
        // Declarar mantém o ponto cego visível.
        const arquivos = [...new Set(REAL.dinamicos.map((d) => d.arquivo))];
        const naoDeclarados = arquivos.filter((a) => !DISPATCHER_DINAMICO_DE_PROPOSITO.has(a));
        expect(
            naoDeclarados,
            'instanciação de despachante com id que não resolve para literal. A source dispachada'
                + ' aqui pode ficar fora do inventário derivado, e com ela seus escritores crus.'
                + ' Confirme que algum sítio literal já reivindica essas sources e declare o'
                + ` arquivo em DISPATCHER_DINAMICO_DE_PROPOSITO:\n${naoDeclarados.join('\n')}`
        ).toEqual([]);

        const mortas = [...DISPATCHER_DINAMICO_DE_PROPOSITO.keys()].filter((a) => !arquivos.includes(a));
        expect(mortas, `declaração morta em DISPATCHER_DINAMICO_DE_PROPOSITO:\n${mortas.join('\n')}`).toEqual([]);
    });
});
