// Path: tests/unit/compactacao-id-nao-unico.test.js
//
// Os tipos cujo `entityId` NÃO identifica uma entidade única, e o que a compactação
// da fila faz com eles.
//
// O MECANISMO. `_compact` (`frontend/src/js/store/sync/operation-queue.js`) agrupa as
// operações por `scopeSuffix:entityType:entityId` e entrega cada grupo a
// `_compactEntityOps`, que mantém UMA operação por grupo. Isso é correto quando o id
// identifica uma entidade e o payload é o valor inteiro dela: três updates da mesma
// feição valem o último. Deixa de ser correto quando duas coisas diferentes
// compartilham o mesmo id, ou quando o payload é um PATCH PARCIAL.
//
// A INSTÂNCIA VIVA. `logAtlasSetting` (`frontend/src/js/store/sync/operation-dispatcher.js`)
// usa o id do atlas (ou o sentinela `atlas`) como `entityId` para TODAS as
// preferências de atlas, e cada op carrega um patch de UMA chave. Os patches caem
// todos no mesmo grupo, e a compactação mantém um: os demais somem sem erro nenhum.
//
// O dano é LATENTE, não ativo: `_compact` só roda acima de `MAX_QUEUE_SIZE`,
// alcançável numa rajada offline e não no uso normal. Entra assim mesmo porque a
// instância existe, nunca foi escrita em lugar nenhum e não tem dono.
//
// A SAÍDA CERTA NÃO É ALARGAR A CHAVE DE GRUPO. Mais grupos significa menos
// compactação e fila maior, o que muda a semântica do flush inteiro. As saídas sem
// perda são dar ao tipo um id próprio, ou ensinar a compactação a FUNDIR o payload.
// Uma entrada nova nesta tabela é registro de dívida, não conserto.
//
// O QUE MUDOU COM O NAMESPACE POR ATLAS (2026-08-15), e a pergunta que ele levanta:
// a fila passou a ser FÍSICA por atlas e a operação passou a carregar `scopeSuffix`
// (o endereço em disco) mais `atlasId` (o atlas de servidor). A chave de grupo ganhou
// o `scopeSuffix`, e é ele que impede duas operações de ATLAS diferentes de se
// compactarem uma na outra. O `atlasId` NÃO está na chave, e não precisa estar: ele é
// derivado do `scopeSuffix` nos dois ramos de `readScopeStamp`
// (`frontend/src/js/store/sync/operation-factory.js`). Os dois casos abaixo fixam essa
// derivação, porque se ela deixar de valer a chave de grupo passa a separar menos do
// que se pensa.
//
// FRAGILIDADES ACEITAS, escritas para que o verde signifique alguma coisa:
//   - a derivação lê as duas FÁBRICAS de logger por regex. Se os loggers virarem um
//     mapa gerado em laço, a extração cai a zero e o PISO fica vermelho, que é o lado
//     seguro;
//   - a metade comportamental exercita `_compactEntityOps`, que é privado. É
//     deliberado: é a única forma de dirigir o mecanismo sem IndexedDB, e o que
//     interessa aqui é a regra de colapso, não o caminho de disco;
//   - a chave de grupo é conferida por LEITURA da fonte, não por execução, porque
//     executá-la exigiria encher a fila acima de `MAX_QUEUE_SIZE`.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OperationQueue } from '../../src/js/store/sync/operation-queue.js';
import { EntityType, OperationType } from '../../src/js/store/sync/operation-types.js';
import { remoteScope, remoteAtlasIdFromDbSuffix } from '../../src/js/store/atlas-namespace.js';

const RAIZ = resolvePath(dirname(fileURLToPath(import.meta.url)), '../../..');
const SRC = 'frontend/src/js';
const DISPATCHER = 'frontend/src/js/store/sync/operation-dispatcher.js';
const QUEUE = 'frontend/src/js/store/sync/operation-queue.js';
const FACTORY = 'frontend/src/js/store/sync/operation-factory.js';

/**
 * Tipos cujo `entityId` não identifica a entidade que a operação descreve, com o
 * shape do id e a afirmação de perda.
 *
 * Uma entrada aqui é dívida DECLARADA. O conjunto é derivado da fonte do despachante
 * e comparado com esta tabela nos dois sentidos, então tipo novo com id não único não
 * entra em silêncio, e entrada morta não sobrevive à remoção do logger.
 */
const ID_NAO_UNICO = new Map([
    [EntityType.MAP_POSITION, {
        shapeDoId: 'o UUID do MAPA (`createMapSettingLogger` passa o mesmo id como entityId e como mapId)',
        perda: 'nenhuma hoje: as cinco sub-entidades de mapa compartilham o entityId e só não'
            + ' colidem porque o `entityType` difere na chave de grupo. A dívida é que a chave'
            + ' de grupo depende do entityType para o que o entityId deveria fazer sozinho: um'
            + ' tipo NOVO que reuse o id do mapa passa a competir por este grupo.',
    }],
    [EntityType.BASE_LAYER, {
        shapeDoId: 'o UUID do MAPA (entityId === mapId)',
        perda: 'nenhuma hoje, pelo mesmo motivo do mapPosition: só o entityType separa. O payload'
            + ' é o valor inteiro daquele campo do mapa, então colapsar para o último é correto.',
    }],
    [EntityType.MAP_NOTES, {
        shapeDoId: 'o UUID do MAPA (entityId === mapId)',
        perda: 'nenhuma hoje: payload é o par título/descrição inteiro, e o último vale.',
    }],
    [EntityType.GRID_STYLE, {
        shapeDoId: 'o UUID do MAPA (entityId === mapId)',
        perda: 'nenhuma hoje: payload é o estilo de grade inteiro, e o último vale.',
    }],
    [EntityType.MAP_TEMPORAL, {
        shapeDoId: 'o UUID do MAPA (entityId === mapId)',
        perda: 'nenhuma hoje: payload é a configuração temporal inteira daquele mapa. Repare que'
            + ' o lado LOCAL faz merge de patch (`setMapTemporalConfig`), mas o que vai para a'
            + ' fila é o estado já mesclado, não o patch.',
    }],
    [EntityType.SETTING, {
        shapeDoId: 'o UUID do ATLAS, ou o sentinela literal `atlas` quando ele não resolve',
        perda: 'PERDA REAL, e é a razão de este arquivo existir. Todas as preferências de atlas'
            + ' compartilham este id e este entityType, e cada op carrega um PATCH DE UMA CHAVE.'
            + ' Enfileirados juntos, os patches caem no mesmo grupo e a compactação mantém UM:'
            + ' os demais somem sem erro. As chaves são derivadas dos chamadores neste teste,'
            + ' não do JSDoc de `logAtlasSetting`, que não é a fonte.',
    }],
]);

// ---------------------------------------------------------------------------
// Extração
// ---------------------------------------------------------------------------

/** Corpo textual de uma função de topo, do cabeçalho até a chave de fechamento na coluna 0. */
function corpoDaFuncao(fonte, nome) {
    const inicio = fonte.indexOf(`function ${nome}(`);
    if (inicio === -1) return null;
    const fim = fonte.indexOf('\n}', inicio);
    return fim === -1 ? null : fonte.slice(inicio, fim);
}

/**
 * Tipos com `entityId` não único, derivados da fonte do despachante.
 *
 * Duas famílias, e as duas são mecânicas:
 *  1. `createMapSettingLogger(EntityType.X)` — a fábrica passa UM id como entityId e
 *     como mapId, então o id é o do mapa e não o da sub-entidade;
 *  2. o logger chamado dentro de `logAtlasSetting`, que escopa toda preferência de
 *     atlas no id do atlas (ou no sentinela).
 *
 * @param {string} despachante - Código de operation-dispatcher.js
 * @returns {{subMapa: Set<string>, atlasWide: Set<string>, todos: Set<string>}}
 */
function extrairIdNaoUnico(despachante) {
    const subMapa = new Set();
    for (const m of despachante.matchAll(/createMapSettingLogger\(\s*EntityType\.([A-Z0-9_]+)/g)) {
        subMapa.add(m[1]);
    }

    const porNome = new Map();
    for (const m of despachante.matchAll(/export const (\w+) = createEntityLogger\(\s*EntityType\.([A-Z0-9_]+)/g)) {
        porNome.set(m[1], m[2]);
    }

    const atlasWide = new Set();
    const corpo = corpoDaFuncao(despachante, 'logAtlasSetting');
    if (corpo) {
        for (const m of corpo.matchAll(/await\s+(\w+)\(/g)) {
            if (porNome.has(m[1])) atlasWide.add(porNome.get(m[1]));
        }
    }

    return { subMapa, atlasWide, todos: new Set([...subMapa, ...atlasWide]) };
}

/**
 * Chaves de payload que viajam numa op `setting`, colhidas nos CHAMADORES.
 *
 * Duas formas de chamada, e as duas produzem o mesmo entityId (o id do atlas ou o
 * sentinela), logo o mesmo grupo de compactação: `logAtlasSetting({ chave: ... })` e
 * `logSettingOperation(opType, <id do atlas>, { chave: ... })`.
 *
 * @param {Map<string, string>} corpus - {caminho: código} de src/js
 * @returns {Set<string>}
 */
function extrairChavesDeSetting(corpus) {
    const chaves = new Set();
    for (const codigo of corpus.values()) {
        for (const m of codigo.matchAll(/logAtlasSetting\(\s*\{\s*(\w+)\s*:/g)) chaves.add(m[1]);
        for (const m of codigo.matchAll(/logSettingOperation\(\s*[^,]+,\s*[^,]+,\s*\{\s*(\w+)\s*:/g)) {
            chaves.add(m[1]);
        }
        // A terceira forma, e a razão de ela existir: desde 2026-08-16 as preferências de
        // APARÊNCIA são escritas por um serviço que monta o patch a partir de uma lista, então o
        // literal inline que as duas regexes acima procuram não está mais em lugar nenhum. O
        // extrator passou a ler a lista, que é a autoridade viva — sem isto ele emagrecia em
        // silêncio, que é o modo de falha que este arquivo inteiro existe para impedir.
        const lista = /APPEARANCE_KEYS\s*=\s*Object\.freeze\(\[([^\]]+)\]\)/.exec(codigo);
        if (lista) {
            for (const m of lista[1].matchAll(/'(\w+)'/g)) chaves.add(m[1]);
        }
    }
    return chaves;
}

// ---------------------------------------------------------------------------
// Corpus
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
const FONTE_DISPATCHER = readFileSync(join(RAIZ, DISPATCHER), 'utf8');
const FONTE_QUEUE = readFileSync(join(RAIZ, QUEUE), 'utf8');
const FONTE_FACTORY = readFileSync(join(RAIZ, FACTORY), 'utf8');

const DERIVADO = extrairIdNaoUnico(FONTE_DISPATCHER);
const CHAVES_SETTING = extrairChavesDeSetting(CORPUS);
const CHAVE_DE_GRUPO = (FONTE_QUEUE.match(/const groupKey = `([^`]*)`/) || [])[1] ?? null;

/** Op mínima com os campos que a compactação lê. */
function op(id, operationType, data) {
    return {
        id,
        entityType: EntityType.SETTING,
        operationType,
        entityId: 'atlas',
        mapId: null,
        data,
        scopeSuffix: '',
    };
}

// ---------------------------------------------------------------------------

describe('compactação da fila: tipos cujo entityId não identifica uma entidade', () => {
    it('PISO: as extrações acharam alguma coisa', () => {
        // Sem este piso, o dia em que uma regex parar de casar produz o diagnóstico
        // errado: lê-se "as listas concordam" onde o certo é "o extrator quebrou".
        expect(ARQUIVOS.length, 'corpus de src/js vazio ou não coletado').toBeGreaterThan(400);
        expect(DERIVADO.subMapa.size,
            `nenhum createMapSettingLogger(EntityType.X) encontrado em ${DISPATCHER}:`
            + ' a regex das fábricas quebrou').toBeGreaterThanOrEqual(5);
        expect(DERIVADO.atlasWide.size,
            'nenhum logger de setting alcançado a partir de `logAtlasSetting`: o recorte da'
            + ' função ou a regex de chamada quebrou').toBeGreaterThanOrEqual(1);
        expect(CHAVES_SETTING.size,
            'nenhuma chave de payload de setting encontrada nos chamadores: a regex quebrou')
            .toBeGreaterThanOrEqual(4);
        expect(CHAVE_DE_GRUPO,
            `não achei a chave de grupo (\`const groupKey = \`) em ${QUEUE}`).not.toBeNull();
        expect(ID_NAO_UNICO.size, 'a tabela congelada deste teste está vazia').toBe(6);
    });

    it('COMPORTAMENTO: updates do mesmo grupo colapsam para o último', () => {
        const fila = new OperationQueue();
        const ops = [
            op('a', OperationType.UPDATE, { mapBadgeColors: { m1: '#f00' } }),
            op('b', OperationType.UPDATE, { colorUsage: { m1: { '#0f0': 3 } } }),
            op('c', OperationType.UPDATE, { customIcons: ['icone'] }),
        ];
        expect(ops.length, 'a fixture não tem ops para compactar').toBe(3);

        const compactado = fila._compactEntityOps(ops);

        // Asserção ABSOLUTA, não comparativa: uma comparação sozinha ficaria verde se
        // o mecanismo deixasse de compactar E a expectativa fosse derivada dele.
        expect(compactado.length,
            'três UPDATEs do mesmo grupo deveriam colapsar em UM').toBe(1);
        expect(compactado[0].id, 'o sobrevivente deveria ser o ÚLTIMO da ordem cronológica').toBe('c');
        expect(compactado[0].data, 'o payload do sobrevivente é o do último, sem fusão')
            .toEqual({ customIcons: ['icone'] });

        // E aqui está a perda, escrita como asserção: os patches de mapBadgeColors e
        // colorUsage não sobrevivem em lugar nenhum do resultado.
        const chavesSobreviventes = compactado.flatMap((o) => Object.keys(o.data ?? {}));
        expect(chavesSobreviventes,
            'os três patches parciais entraram no mesmo grupo e dois sumiram. Isto NÃO é'
            + ' regressão: é o comportamento vigente, fixado aqui para que fechá-lo seja uma'
            + ' mudança visível.').toEqual(['customIcons']);
    });

    it('COMPORTAMENTO: CREATE seguido de UPDATEs vira um CREATE com o ÚLTIMO data', () => {
        // O outro ramo do mesmo mecanismo, e ele confirma a natureza do colapso: a
        // compactação SUBSTITUI o payload, nunca o funde. Uma compactação que fundisse
        // seria a saída sem perda para os patches parciais.
        const fila = new OperationQueue();
        const ops = [
            op('a', OperationType.CREATE, { mapOrder: ['m1'] }),
            op('b', OperationType.UPDATE, { mapBadgeColors: { m1: '#f00' } }),
        ];
        const compactado = fila._compactEntityOps(ops);
        expect(compactado.length, 'CREATE + UPDATE deveria colapsar em UM').toBe(1);
        expect(compactado[0].operationType, 'o sobrevivente deveria continuar sendo o CREATE')
            .toBe(OperationType.CREATE);
        expect(compactado[0].data,
            'o payload foi SUBSTITUÍDO pelo do último, não fundido com o do CREATE')
            .toEqual({ mapBadgeColors: { m1: '#f00' } });
    });

    it('a chave de grupo separa por ATLAS, e o atlasId não precisa estar nela', () => {
        // Duas ops de atlas diferentes não podem se compactar uma na outra. Quem garante
        // isso é o `scopeSuffix` na chave de grupo (além da separação física da fila, que
        // é `perAtlas`). O `atlasId` fica de fora e isso é correto SÓ enquanto ele for
        // derivado do sufixo; os dois casos abaixo fixam essa dependência.
        expect(CHAVE_DE_GRUPO.includes('op.scopeSuffix'),
            'a chave de grupo perdeu o `scopeSuffix`. Sem ele, duas operações nascidas em'
            + ' atlas diferentes que dividam a mesma base de dados (a migração inacabada, o'
            + ' slot resgatado) passam a se compactar uma na outra.\n'
            + `Chave lida da fonte: ${CHAVE_DE_GRUPO}`).toBe(true);
        expect(CHAVE_DE_GRUPO.includes('op.entityType'),
            'a chave de grupo perdeu o `entityType`. É só ele que impede as cinco'
            + ' sub-entidades de mapa (todas com entityId === mapId) de colidirem.\n'
            + `Chave lida da fonte: ${CHAVE_DE_GRUPO}`).toBe(true);
        expect(CHAVE_DE_GRUPO.includes('op.entityId'),
            `a chave de grupo perdeu o \`entityId\`.\nChave lida da fonte: ${CHAVE_DE_GRUPO}`).toBe(true);

        // Ramo REMOTO: o sufixo carrega o atlasId literalmente, e o round-trip prova.
        const atlasId = 'abcdef0123456789';
        const sufixo = remoteScope(atlasId).dbSuffix;
        expect(sufixo, 'o sufixo remoto deixou de conter o atlasId').toContain(atlasId);
        expect(remoteAtlasIdFromDbSuffix(sufixo),
            'o atlasId deixou de ser recuperável do sufixo: agrupar por scopeSuffix passaria a'
            + ' separar MENOS do que agrupar por atlasId').toBe(atlasId);

        // Ramo LOCAL: a fábrica DERIVA o atlasId do sufixo, em vez de lê-lo do escopo.
        expect(FONTE_FACTORY.includes('remoteAtlasIdFromDbSuffix(scopeSuffix)'),
            'o `atlasId` do envelope deixou de ser derivado do `scopeSuffix` no ramo local de'
            + ' `readScopeStamp`. Se ele passar a ser independente, o `scopeSuffix` sozinho na'
            + ' chave de grupo deixa de garantir separação por atlas.').toBe(true);
    });

    it('o conjunto derivado da fonte é exatamente o da tabela congelada', () => {
        const naoDeclarados = [...DERIVADO.todos]
            .map((nome) => EntityType[nome])
            .filter((valor) => !ID_NAO_UNICO.has(valor));
        expect(
            naoDeclarados,
            'tipo cujo `entityId` não identifica a entidade e que não está declarado neste'
            + ' teste. Antes de acrescentar a entrada, confira o payload: a compactação só é SEM'
            + ' PERDA se o payload for o valor INTEIRO daquele tipo para aquele id. Se for patch'
            + ' parcial, a saída certa NÃO é uma entrada aqui, é dar ao tipo um id próprio ou'
            + ' ensinar a compactação a fundir o payload.\n'
            + `Tipos: ${naoDeclarados.join(', ')}`
        ).toEqual([]);

        const mortas = [...ID_NAO_UNICO.keys()].filter((valor) => {
            const nome = Object.keys(EntityType).find((k) => EntityType[k] === valor);
            return !DERIVADO.todos.has(nome);
        });
        expect(
            mortas,
            'entrada morta: o tipo já não tem id não único (o logger saiu, ou mudou de fábrica),'
            + ` e a entrada continua aqui dando cheque em branco. Remova-a.\nTipos: ${mortas.join(', ')}`
        ).toEqual([]);
    });

    it('anti-tapete: toda entrada declara shape do id e afirmação de perda', () => {
        const magras = [];
        for (const [valor, { shapeDoId, perda }] of ID_NAO_UNICO) {
            if (!shapeDoId || shapeDoId.length < 20) magras.push(`${valor}: shapeDoId em branco`);
            if (!perda || perda.length < 60) magras.push(`${valor}: afirmação de perda em branco`);
            expect(Object.values(EntityType),
                `a tabela cita "${valor}", que não é membro de EntityType`).toContain(valor);
        }
        expect(magras, `entrada sem conteúdo:\n${magras.join('\n')}`).toEqual([]);
    });

    it('as chaves que compartilham o grupo do `setting` vêm dos chamadores', () => {
        // O JSDoc de `logAtlasSetting` não é a fonte: ele lista quatro chaves, e uma
        // delas (terrainExaggeration) não tem chamador de `logAtlasSetting` nenhum.
        // Ela chega ao MESMO grupo por outro caminho, `logSettingOperation` chamado
        // direto com o id do atlas, e é por isso que a extração varre as duas formas.
        // `globeProjection` entrou em 2026-08-16, irmã de `terrainExaggeration`: as duas dizem
        // como o mapa 2D deste projeto se parece e viajam pela mesma porta. Ela AUMENTA em um o
        // risco que este caso mede — dois patches de aparência escritos em sequência colapsam
        // para o último —, e o modal grava as duas JUNTAS, num patch só, exatamente por isso.
        const esperadas = ['colorUsage', 'customIcons', 'globeProjection', 'mapBadgeColors', 'mapOrder', 'terrainExaggeration'];
        expect([...CHAVES_SETTING].sort(),
            'as chaves de preferência de atlas mudaram. Toda chave nesta lista divide o grupo'
            + ' `<escopo>:setting:<id do atlas>` com as demais, então acrescentar uma aumenta em'
            + ' um o número de patches que a compactação pode descartar. Confira se a chave nova'
            + ' realmente pode viajar como patch parcial.').toEqual(esperadas);
        expect(CHAVES_SETTING.size,
            'menos de seis chaves compartilhando o grupo: a extração encolheu').toBeGreaterThanOrEqual(6);
    });
});
