// Path: tests/unit/compartilhar-sem-a-store.test.js

/**
 * @fileoverview O modal de compartilhamento tem de caber em `atlas.html`, e "caber" é uma
 * propriedade do GRAFO DE IMPORTS, não uma intenção.
 *
 * O DEFEITO QUE ESTE ARQUIVO FECHA. A tela onde a pessoa administra seus atlas era justamente a
 * que não administrava ACESSO: o modal de compartilhamento só abria do mapa, com o atlas
 * conectado, embora as quatro rotas de `/atlas/:atlasId/sharing` aceitem qualquer atlas com
 * permissão `manage` e o modal já recebesse `atlasId` como parâmetro. O que impedia eram quatro
 * cadeias de import, medidas antes da separação: `store/services.js` (por `getEventBus`), o
 * barril `@modals` (por `showConfirm`), `store/sync/sync-engine.js` e `presence/presence-store.js`
 * (que puxa `services.js` de novo). Com elas, o arquivo alcançava 188 módulos contra os 48 de
 * `projects/projects-page.js`.
 *
 * E O PESO ERA A METADE MENOR DO PROBLEMA: `render()` chamava `getEventBus()`, e `getServices()`
 * LANÇA `Services not initialized` quando `initServices()` nunca rodou, que é a definição de
 * `atlas.html`. Um `import()` dinâmico teria movido o download e mantido o travamento; por isso a
 * correção foi separar a tela (REST mais DOM) da sessão viva de colaboração (presença, barramento,
 * motor de sync), com a presença voltando por INJEÇÃO EXPLÍCITA.
 *
 * O QUE ESTE TESTE PRENDE, e é o que impede a separação de se desfazer no primeiro import
 * distraído:
 *
 *   1. `modals/sharing.modal.core.js` não alcança o barril da store, `store/services.js`, o barril
 *      `@utils`, o barril `@modals`, `sync-engine.js` nem `presence-store.js` por caminho nenhum,
 *      estático ou dinâmico.
 *   2. O que ele ACRESCENTA ao grafo de `projects-page.js` é uma lista fechada. Esta é a afirmação
 *      de produto de verdade ("cabe em `atlas.html`"), e ela reprova nomeando o módulo novo.
 *   3. A metade pesada continua pesada: `modals/sharing.modal.js`, o ponto de entrada do MAPA,
 *      TEM de alcançar a presença e a store. Sem esta metade, um caminhador quebrado (alias que
 *      não resolve, regex que não casa) reportaria "nenhum proibido" para sempre, verde e cego.
 *
 * O caminhador é o mesmo de `paginas-sem-mapa-nao-arrastam-a-store.test.js`, deliberadamente:
 * aquele varre PASTAS de página e este varre um MÓDULO que ainda não é importado por nenhuma
 * delas (quem liga o botão é `projects/atlas-drive.js`). Uma cópia do caminhador é o preço de o
 * alvo ser de outra natureza; se um terceiro caso aparecer, ele vira helper.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Os aliases do `vite.config.js` / `vitest.config.js`, em cópia mínima (só o mapeamento). */
const ALIASES = Object.freeze({
    '@js': 'src/js',
    '@css': 'src/css',
    '@store': 'src/js/store',
    '@state': 'src/js/state',
    '@utils': 'src/js/utilities',
    '@tools': 'src/js/tool_manager',
    '@toolbar': 'src/js/toolbar',
    '@modals': 'src/js/modals',
    '@sidebar': 'src/js/sidebar',
    '@layers': 'src/js/layers',
    '@catalog': 'src/js/catalog',
    '@ui': 'src/js/ui',
    '@events': 'src/js/events',
    '@': 'src'
});

/** Do mais longo para o mais curto: `@` casaria `@store` se viesse antes. */
const ALIAS_KEYS = Object.keys(ALIASES).sort((a, b) => b.length - a.length);

const NORM = (p) => p.replace(/\\/g, '/');

/**
 * Apaga o CONTEÚDO dos comentários preservando a contagem de linhas, para que prosa citando um
 * `from '...'` não vire aresta do grafo. Sem isto, os próprios comentários deste refactor (que
 * citam `@modals` e `@store` por extenso, para explicar por que saíram) entrariam no grafo e
 * fariam o teste reprovar a si mesmo.
 * @param {string} texto
 * @returns {string}
 */
function semComentarios(texto) {
    return texto
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/(^|[^:])\/\/[^\n]*/g, (m, antes) => antes + ' '.repeat(m.length - antes.length));
}

/**
 * Resolve um especificador como o bundler resolve: alias, relativo, ou pacote externo.
 * @param {string} spec
 * @param {string} arquivo - Arquivo que fez o import (para o caso relativo).
 * @returns {{file?: string, bare?: string, missing?: string}}
 */
function resolverEspecificador(spec, arquivo) {
    let base = null;
    if (spec.startsWith('.')) {
        base = resolve(dirname(arquivo), spec);
    } else {
        for (const alias of ALIAS_KEYS) {
            if (spec === alias || spec.startsWith(`${alias}/`)) {
                base = resolve(FRONT, ALIASES[alias], spec.slice(alias.length).replace(/^\//, ''));
                break;
            }
        }
    }
    if (base === null) return { bare: spec };
    for (const candidato of [base, `${base}.js`, join(base, 'index.js')]) {
        if (existsSync(candidato) && statSync(candidato).isFile()) return { file: NORM(candidato) };
    }
    return { missing: spec };
}

/**
 * O `[^;'"]*?` do meio (a lista de nomes importados) NÃO pode ser `[\s\S]*?`: com `[\s\S]` a
 * expansão preguiçosa atravessa a linha atrás do próximo ` from `, e um import de EFEITO COLATERAL
 * (`import '@utils';`) é engolido pelo import seguinte, sumindo do grafo. Medido no caminhador
 * irmão, onde o controle negativo passava verde por causa disso.
 */
const RE_ESTATICO = /(?:^|[\s;}])(?:import|export)\s+(?:[^;'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
const RE_DINAMICO = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/**
 * Percorre o grafo de imports a partir de um conjunto de raízes.
 * @param {string[]} raizes - Caminhos absolutos.
 * @returns {{arquivos: Set<string>, externos: Set<string>, naoResolvidos: string[],
 *   pai: Map<string, string>}}
 */
function percorrer(raizes) {
    const arquivos = new Set();
    const externos = new Set();
    const naoResolvidos = [];
    const pai = new Map();
    const fila = raizes.map(NORM);

    while (fila.length > 0) {
        const arquivo = fila.pop();
        if (arquivos.has(arquivo)) continue;
        arquivos.add(arquivo);
        if (!arquivo.endsWith('.js')) continue;

        const codigo = semComentarios(readFileSync(arquivo, 'utf8'));
        for (const regex of [RE_ESTATICO, RE_DINAMICO]) {
            regex.lastIndex = 0;
            let achado;
            while ((achado = regex.exec(codigo)) !== null) {
                const alvo = resolverEspecificador(achado[1], arquivo);
                if (alvo.file) {
                    if (!pai.has(alvo.file)) pai.set(alvo.file, arquivo);
                    fila.push(alvo.file);
                } else if (alvo.bare) {
                    externos.add(alvo.bare);
                } else {
                    naoResolvidos.push(`${arquivo} → ${achado[1]}`);
                }
            }
        }
    }
    return { arquivos, externos, naoResolvidos, pai };
}

/** Caminho de import da raiz até `alvo`, para a mensagem de falha dizer POR ONDE ele entrou. */
function caminhoAte(alvo, pai) {
    const cadeia = [alvo];
    let atual = alvo;
    while (pai.has(atual) && cadeia.length < 30) {
        atual = pai.get(atual);
        cadeia.push(atual);
    }
    return cadeia.reverse().map((p) => p.replace(`${NORM(FRONT)}/`, '')).join('\n  → ');
}

const abs = (rel) => NORM(resolve(FRONT, rel));
const rel = (p) => p.replace(`${NORM(FRONT)}/`, '');

/**
 * Os módulos que a tela de compartilhamento não pode alcançar fora do mapa.
 *
 * Os quatro primeiros são os barris e a fachada que arrastam a store inteira (mesma lista de
 * `paginas-sem-mapa-nao-arrastam-a-store.test.js`, mais `store/services.js`, que é o que LANÇA);
 * os dois últimos são as cadeias específicas deste caso, e entram por nome porque foram as
 * medidas: quem as reintroduzir vai reintroduzir exatamente estas.
 */
const PROIBIDOS = Object.freeze({
    'o barril @store (store/index.js)': /\/src\/js\/store\/index\.js$/,
    'a fachada da store (store/store.js)': /\/src\/js\/store\/store\.js$/,
    'o container de DI (store/services.js), que LANÇA fora do mapa': /\/src\/js\/store\/services\.js$/,
    'o barril @utils (utilities/index.js)': /\/src\/js\/utilities\/index\.js$/,
    'o barril @modals (modals/index.js)': /\/src\/js\/modals\/index\.js$/,
    'o motor de sync (store/sync/sync-engine.js)': /\/src\/js\/store\/sync\/sync-engine\.js$/,
    'a store de presença (presence/presence-store.js)': /\/src\/js\/presence\/presence-store\.js$/
});

const NUCLEO = 'src/js/modals/sharing.modal.core.js';
const ENTRADA_DO_MAPA = 'src/js/modals/sharing.modal.js';
const FONTE_DE_PRESENCA = 'src/js/presence/sharing-presence.source.js';
const PAGINA_PROJETOS = 'src/js/projects/projects-page.js';

/**
 * Arquivos que o núcleo TEM de alcançar. São o controle de que os aliases resolveram: sem eles, um
 * alias quebrado devolveria "nenhum proibido" sobre um grafo vazio.
 */
const ANCORAS = Object.freeze([
    'src/js/store/sync/api-client.js',      // as quatro rotas de sharing
    'src/js/store/sync/session-context.js', // quem sou eu, para o gate de "Tornar dono"
    'src/js/projects/permission-levels.js', // a ÚNICA implementação da escada por atlas
    'src/js/modals/confirm.modal.js',       // `showConfirm` por arquivo, não pelo barril
    'src/js/modals/modal.base.js',
    'src/js/presence/presence-colors.js'    // avatar é desenho, não sessão viva
]);

/**
 * O que o núcleo ACRESCENTA ao grafo de `atlas.html`, em lista fechada.
 *
 * A lista é conferida por SUBTRAÇÃO (o que sobra depois de tirar tudo que a página já alcançava),
 * então ela só cresce quando alguém importa algo novo, e encolhe sem reprovar quando a página
 * passa a alcançar o mesmo módulo por outro caminho. Fechada para CIMA é o sentido que importa:
 * módulo novo aqui é decisão, não efeito colateral.
 */
const ACRESCIMO_PERMITIDO = Object.freeze([
    NUCLEO,
    'src/js/catalog/grant-tree.js' // folha de funções puras, zero imports (rótulo e frase de grupo)
]);

describe('o núcleo do modal de compartilhamento cabe em `atlas.html`', () => {
    const grafo = percorrer([abs(NUCLEO)]);

    it('o caminhador de fato caminhou, e resolveu tudo', () => {
        // Cobertura vazia é o modo de falha desta classe de teste: um grafo de um arquivo só
        // deixaria todos os casos abaixo verdes sem verificar nada.
        expect(existsSync(abs(NUCLEO)), `${NUCLEO} não existe`).toBe(true);
        expect(grafo.naoResolvidos).toEqual([]);
        const alcancados = [...grafo.arquivos].map(rel);
        for (const ancora of ANCORAS) {
            expect(alcancados, `não alcançou ${ancora}`).toContain(ancora);
        }
        // Piso e teto MEDIDOS (16 módulos em 2026-08-23, contra os 188 de antes). O teto é o que
        // transforma "ficou leve" em propriedade: sem ele, o grafo pode dobrar sem nada acusar,
        // desde que os sete proibidos fiquem de fora.
        expect(grafo.arquivos.size).toBeGreaterThanOrEqual(12);
        expect(grafo.arquivos.size).toBeLessThanOrEqual(25);
    });

    for (const [rotulo, padrao] of Object.entries(PROIBIDOS)) {
        it(`não alcança ${rotulo}`, () => {
            const achados = [...grafo.arquivos].filter((f) => padrao.test(f));
            const detalhe = achados.map((f) => caminhoAte(f, grafo.pai)).join('\n\n');
            expect(achados, `entrou por:\n  ${detalhe}`).toEqual([]);
        });
    }

    it('e não alcança a fonte de presença, que é o arquivo que concentra as três cadeias', () => {
        expect([...grafo.arquivos].map(rel)).not.toContain(FONTE_DE_PRESENCA);
    });

    it('as dependências externas são exatamente as declaradas aqui', () => {
        // Lista FECHADA: "não contém tal pacote" aceitaria em silêncio um quilo de dependência
        // nova numa página que hoje baixa duas.
        expect([...grafo.externos].sort()).toEqual(['localforage']);
    });

    it('a página JÁ alcança o núcleo, e o que ela ganhou com isso é a lista fechada declarada', () => {
        // ESTE CASO MUDOU DE FORMA quando o botão foi ligado, e a mudança é a prova de que ele
        // media a coisa certa. Ele nasceu como uma SUBTRAÇÃO ("o que o núcleo acrescentaria ao
        // grafo da página"), com uma asserção de que o núcleo estaria entre os acréscimos, e essa
        // asserção existia justamente para o caso de a subtração passar a medir outra coisa. Foi o
        // que aconteceu: `atlas-drive.js` passou a abrir o núcleo por `import()` dinâmico, o
        // caminhador segue import dinâmico, e o núcleo deixou de ser "novo" porque virou parte do
        // grafo da página. Zero acréscimos, e a asserção de vácuo reprovou, como devia.
        //
        // A forma nova é mais forte e não depende de subtração: a página TEM de alcançar o núcleo
        // (senão a ponta se desligou sem ninguém ver, e o botão abre um chunk que não existe), e o
        // grafo INTEIRO dela continua sem nenhum dos proibidos. É a propriedade que interessa, e
        // ela é medida na página, que é onde o dano aconteceria.
        const pagina = percorrer([abs(PAGINA_PROJETOS)]);
        expect(pagina.arquivos.size).toBeGreaterThan(30);
        expect(pagina.naoResolvidos).toEqual([]);

        const daPagina = [...pagina.arquivos].map(rel);
        expect(daPagina, 'a página deixou de alcançar o núcleo: o botão foi desligado')
            .toContain(NUCLEO);

        for (const [rotulo, padrao] of Object.entries(PROIBIDOS)) {
            const achados = daPagina.filter((f) => padrao.test(f));
            const detalhe = achados
                .map((f) => caminhoAte(abs(f), pagina.pai))
                .join('\n\n');
            expect(achados, `a página passou a alcançar ${rotulo} por:\n  ${detalhe}`).toEqual([]);
        }
        expect(daPagina, 'a fonte de presença entrou no grafo da página')
            .not.toContain(FONTE_DE_PRESENCA);

        // A lista fechada de acréscimo continua valendo, agora contra a página SEM o núcleo: são os
        // módulos que só existem ali por causa dele. Medida por diferença de conjuntos, e não por
        // uma segunda travessia, porque duas travessias com raízes diferentes divergiriam calado.
        const semNucleo = [...grafo.arquivos].map(rel);
        const intrusos = semNucleo.filter(
            (f) => f !== NUCLEO && !ACRESCIMO_PERMITIDO.includes(f) && !daPagina.includes(f)
        );
        expect(intrusos, `módulos não declarados:\n  ${intrusos.join('\n  ')}`).toEqual([]);
    });
});

describe('CONTROLE DE VÁCUO: a metade PESADA continua pesada', () => {
    // Sem este bloco, todos os verdes acima seriam indistinguíveis de um caminhador que não
    // caminha. `modals/sharing.modal.js` é o ponto de entrada do MAPA e liga a presença viva por
    // default: ele TEM de alcançar tudo que o núcleo não alcança.
    const grafoDoMapa = percorrer([abs(ENTRADA_DO_MAPA)]);
    const grafoDoEntry = percorrer([abs('src/js/index.js')]);

    it('a entrada do mapa alcança a presença, o motor de sync e a store', () => {
        const alcancados = [...grafoDoMapa.arquivos].map(rel);
        expect(alcancados).toContain(FONTE_DE_PRESENCA);
        expect(alcancados).toContain(NUCLEO);
        for (const rotulo of [
            'o barril @store (store/index.js)',
            'a fachada da store (store/store.js)',
            'o container de DI (store/services.js), que LANÇA fora do mapa',
            'o barril @utils (utilities/index.js)',
            'o motor de sync (store/sync/sync-engine.js)',
            'a store de presença (presence/presence-store.js)'
        ]) {
            const achou = [...grafoDoMapa.arquivos].some((f) => PROIBIDOS[rotulo].test(f));
            expect(achou, `o caminhador NÃO achou ${rotulo} na entrada do mapa`).toBe(true);
        }
        // Uma ordem de grandeza acima do núcleo: é o custo que `atlas.html` não paga.
        expect(grafoDoMapa.arquivos.size).toBeGreaterThan(100);
    });

    it('e o padrão do barril `@modals` casa de fato, medido na página do mapa', () => {
        // O barril saiu do grafo dos DOIS arquivos de compartilhamento (o `showConfirm` passou a
        // vir por arquivo), então ele não tem controle positivo ali. Quem o carrega é o entry do
        // mapa; sem esta linha, o padrão de `@modals` poderia não casar com nada e o verde de cima
        // seria sobre uma regex morta.
        const achou = [...grafoDoEntry.arquivos]
            .some((f) => PROIBIDOS['o barril @modals (modals/index.js)'].test(f));
        expect(achou, 'o caminhador NÃO achou o barril @modals na página do mapa').toBe(true);
    });
});

describe('a separação está escrita no código, e não só no grafo', () => {
    const leia = (p) => readFileSync(abs(p), 'utf8');

    it('o núcleo não menciona barramento, presença viva nem motor de sync', () => {
        const fonte = semComentarios(leia(NUCLEO));
        for (const proibido of ['getEventBus', 'presenceStore', 'syncEngine', 'initServices']) {
            expect(fonte, `${NUCLEO} ainda cita ${proibido}`).not.toMatch(proibido);
        }
        // E a dependência é opcional de forma EXPLÍCITA, não por `try/catch` que engole: um modal
        // que silenciosamente parasse de reagir a evento no mapa seria pior que o estado anterior.
        // `readOnly` entrou em 2026-08-23 (o modo PARTICIPANTES) e vem DEPOIS de `presence`, no
        // mesmo objeto de opções: o que esta linha prende é o `presence = null`, ou seja, que a
        // presença continua OPCIONAL e por default ausente. Um terceiro campo entre os dois
        // reprovaria aqui de propósito, porque a ordem declara qual é o default do modo do mapa.
        expect(fonte).toMatch(/constructor\(atlasId,\s*\{\s*atlasName,\s*presence = null,\s*readOnly = false\s*\}/);
        expect(fonte).toMatch(/export function openSharingModal\(/);
    });

    it('a entrada do mapa injeta a fonte viva por default', () => {
        const fonte = semComentarios(leia(ENTRADA_DO_MAPA));
        expect(fonte).toMatch(/livePresenceSource/);
        expect(fonte).toMatch(/export function showSharingModal\(/);
        // O reexport é o que mantém os chamadores do mapa e os testes existentes intactos.
        expect(fonte).toMatch(/export \* from '\.\/sharing\.modal\.core\.js'/);
    });

    it('a busca acha de fato os padrões proibidos (controle do matcher)', () => {
        // Sem este controle, uma regex que não casasse com nada reportaria verde para um núcleo
        // que ainda tivesse `getEventBus()` dentro.
        const isca = semComentarios("const b = getEventBus();\npresenceStore.getUsers();\nsyncEngine.atlasId;");
        for (const proibido of ['getEventBus', 'presenceStore', 'syncEngine']) {
            expect(isca).toMatch(proibido);
        }
        // E o limpador de comentários não pode apagar código: sem esta linha, um limpador guloso
        // deixaria os três casos acima verdes sobre um arquivo em branco.
        expect(semComentarios('// getEventBus()\nconst x = 1;')).toMatch(/const x = 1;/);
        expect(semComentarios('// getEventBus()\nconst x = 1;')).not.toMatch(/getEventBus/);
    });
});
