// Path: tests/unit/pending-import-consumo.test.js

/**
 * @fileoverview O `.ebgeo` que "Seus atlas" deixa para o mapa some do banco global em TODO caminho,
 * e NENHUM caminho que recusa gasta um dos dez atlas locais.
 *
 * A ENTREGA E O SEU CUSTO. A tela não tem store nem importador, então ela grava os bytes do arquivo
 * sob `GlobalKey.PENDING_IMPORT` e navega; o boot do mapa consome. Acontece que o banco global é o
 * ÚNICO que nenhum expurgo deste repositório alcança (nem o wipe de atlas, nem a destruição de
 * namespace, nem a varredura de logout). Um consumidor que só apagasse a entrega no SUCESSO deixaria
 * um arquivo de megabytes preso ali para sempre e o re-tentaria a cada F5, falhando igual. Por isso
 * `takePendingImport` lê-e-apaga incondicionalmente, e por isso o consumo tem UMA tentativa: o
 * arquivo continua no disco do usuário.
 *
 * O SEGUNDO RESÍDUO, e o motivo deste arquivo ter mudado de forma em 2026-08-16. Até então a TELA
 * criava o atlas local antes de navegar, e todo ramo que recusa aqui o deixava para trás. Ele nem
 * ficava vazio: o boot monta o slot e a inicialização do repositório escreve um mapa `Principal`
 * ANTES de a decisão ser tomada, então um guarda "só apaga se estiver vazio" nunca dispararia, e
 * apagá-lo daqui é pior ainda (com duas abas, quem recusa não é quem é dono do slot, e a exclusão
 * congela a dona). A correção não limpa o resíduo, ela o impede de nascer: o slot passa a ser criado
 * pelo consumidor, no último instante, e é por isso que o criador é um EFEITO INJETADO que este
 * arquivo dubla e conta.
 *
 * O consumidor mora em `deep-link/pending-import.js` e não em `index.js` pelo motivo que
 * `route-decision.js` já registra: `index.js` roda `initApp()` no import, então nada dele é
 * alcançável por teste. O que É injetado aqui são os efeitos do mapa (o importador, o criador de
 * atlas e o toast); a leitura e o apagamento vêm do módulo REAL, senão este arquivo estaria medindo
 * o próprio dublê.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { databases, makeStore, resetFake } = vi.hoisted(() => {
    const databases = new Map();
    function makeStore({ name, storeName = null }) {
        const key = `${name}::${storeName || 'keyvaluepairs'}`;
        const backing = databases.get(key) ?? new Map();
        databases.set(key, backing);
        return {
            setItem: vi.fn(async (k, v) => { backing.set(k, v); return v; }),
            getItem: vi.fn(async (k) => (backing.has(k) ? backing.get(k) : null)),
            removeItem: vi.fn(async (k) => { backing.delete(k); }),
            keys: vi.fn(async () => [...backing.keys()]),
            clear: vi.fn(async () => { backing.clear(); })
        };
    }
    return { databases, makeStore, resetFake: () => databases.clear() };
});

vi.mock('localforage', () => ({
    default: {
        createInstance: vi.fn(makeStore),
        dropInstance: vi.fn(async () => {})
    }
}));

const GLOBAL_DISK = 'ebgeo_global::keyvaluepairs';
const BYTES = new Uint8Array([1, 2, 3, 4]).buffer;
const NOME = 'Operação Alfa';

/** A frase que a API do atlas local produz ao bater no teto de dez. */
const RECUSA_DO_TETO = 'Limite de 10 atlas locais atingido. Exclua um atlas antes de criar outro.';

let ns;
let consumir;
let avisos;
/** O log COMPARTILHADO: é ele, e não dois espiões separados, que prende a ORDEM dos efeitos. */
let chamadas;

/** @returns {boolean} Se a entrega ainda está no disco falso. Lido pelas CHAVES, não pela API. */
function entregaNoDisco() {
    return databases.get(GLOBAL_DISK)?.has('pending_import') ?? false;
}

/** Um importador de mentira que anota no log compartilhado o que recebeu. */
function importadorFalso(impl) {
    const processFileDirectly = vi.fn(async (...args) => {
        chamadas.push('importar');
        if (impl) return impl(...args);
        return undefined;
    });
    return { service: { processFileDirectly }, processFileDirectly };
}

/**
 * Um criador de atlas de mentira, no formato de `switchToNewLocalAtlas`: devolve
 * `{ok: true, atlas}` ou a recusa nomeada, e nunca lança por conta própria.
 * @param {Object|Error} [resultado] - O que devolver, ou um erro para LANÇAR.
 */
function criadorFalso(resultado) {
    return vi.fn(async (name) => {
        chamadas.push(`criar:${name}`);
        if (resultado instanceof Error) throw resultado;
        return resultado ?? { ok: true, atlas: { id: 'slot-novo', name } };
    });
}

beforeEach(async () => {
    vi.resetModules();
    resetFake();
    avisos = [];
    chamadas = [];
    // O MESMO grafo de módulos para os dois: `pending-import.js` tem que enxergar a instância de
    // `atlas-namespace.js` que este teste semeia, ou o sujeito e o instrumento seriam duas cópias.
    ns = await import('@store/atlas-namespace.js');
    ({ consumePendingEbgeoImport: consumir } = await import('@js/deep-link/pending-import.js'));
});

/**
 * @param {Object} [options]
 * @returns {Promise<boolean>} O retorno do consumidor.
 */
function consumo({
    hasDeepLink = false,
    importador = importadorFalso().service,
    criador = criadorFalso(),
} = {}) {
    return consumir({
        hasDeepLink,
        getImporter: () => importador,
        createAtlas: criador,
        notify: (message, level) => avisos.push({ message, level })
    });
}

/** Semeia a entrega que a tela teria deixado: o NOME do arquivo e os bytes, e mais nada. */
async function entregaPronta() {
    await ns.savePendingImport({ name: NOME, data: BYTES });
    // Positiva antes das negativas: sem ela, "a entrega sumiu" não distingue consumo de uma
    // entrega que nunca foi gravada.
    expect(entregaNoDisco()).toBe(true);
}

describe('o .ebgeo pendente: o caminho feliz', () => {
    it('cria UM atlas com o nome da entrega, ANTES de importar, e assume o boot', async () => {
        await entregaPronta();
        const { service, processFileDirectly } = importadorFalso();
        const criador = criadorFalso();

        const assumiu = await consumo({ importador: service, criador });

        expect(assumiu).toBe(true);
        expect(criador).toHaveBeenCalledTimes(1);
        expect(criador).toHaveBeenCalledWith(NOME);
        expect(processFileDirectly).toHaveBeenCalledTimes(1);
        // A ORDEM, num log só: importar antes de criar significa importar por cima do atlas que o
        // usuário tinha aberto, e o import não aditivo SUBSTITUI o atlas em que cai.
        expect(chamadas).toEqual([`criar:${NOME}`, 'importar']);

        const [arquivo, aditivo] = processFileDirectly.mock.calls[0];
        expect(arquivo).toBeInstanceOf(File);
        expect(arquivo.name).toBe('Operação Alfa.ebgeo');
        expect(new Uint8Array(await arquivo.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
        // Não aditivo: o slot foi criado vazio para este arquivo, e é o modo que substitui.
        expect(aditivo).toBe(false);
        expect(avisos).toEqual([]);
        expect(entregaNoDisco()).toBe(false);
    });

    it('a entrega já sumiu do disco NO INSTANTE em que o importador roda', async () => {
        // A ordem é a propriedade: apagar depois de importar deixaria a chave de pé se o importador
        // travasse a aba no meio, e o F5 seguinte reimportaria o mesmo arquivo.
        await entregaPronta();
        let existiaDuranteOImport = null;
        const { service } = importadorFalso(async () => { existiaDuranteOImport = entregaNoDisco(); });

        await consumo({ importador: service });

        expect(existiaDuranteOImport).toBe(false);
    });

    it('importador que LANÇA: a entrega já foi apagada, e o usuário ouve o erro', async () => {
        // O caso que vira lixo se ninguém testar. O arquivo falhou ao abrir (arquivo corrompido,
        // versão futura), e o único jeito de a próxima carga não repetir a mesma falha é a entrega
        // já não existir. O atlas criado FICA, e isso é deliberado: o usuário está dentro dele,
        // o importador já mexeu no escopo montado, e é dele que o usuário sai por "Seus atlas".
        const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
        await entregaPronta();
        const { service } = importadorFalso(async () => { throw new Error('arquivo corrompido'); });

        const assumiu = await consumo({ importador: service });

        // Assumiu o boot mesmo falhando: a cadeia de roteamento não pode rodar por cima de um
        // importador que já mexeu no escopo montado.
        expect(assumiu).toBe(true);
        expect(entregaNoDisco()).toBe(false);
        expect(avisos).toEqual([
            { message: 'Não foi possível abrir o arquivo .ebgeo.', level: 'error' }
        ]);
        expect(erro).toHaveBeenCalled();
        erro.mockRestore();
    });
});

// ============================================================================
// OS RAMOS QUE RECUSAM ANTES DE CRIAR
//
// A propriedade é uma só e vale para os cinco: a entrega some do disco E nenhum atlas local nasce.
// A segunda metade é a que este arquivo passou a cobrar, e é a que não tem erro quando quebra —
// um slot a mais na lista do usuário, com um mapa `Principal` dentro, indistinguível de um atlas
// que ele mesmo criou.
// ============================================================================

const RAMOS_DE_RECUSA = [
    {
        nome: 'deep link na URL: um arquivo nunca entra num atlas de servidor',
        preparar: () => entregaPronta(),
        opcoes: { hasDeepLink: true },
        aviso: { nivel: 'warning', trecho: 'outro atlas' }
    },
    {
        nome: 'importador AUSENTE: o controle não chegou a ser registrado',
        preparar: () => entregaPronta(),
        opcoes: { importador: null },
        aviso: { nivel: 'error', trecho: 'Seus atlas' }
    },
    {
        nome: 'sem entrega nenhuma: o boot de quase todo mundo',
        preparar: async () => {},
        opcoes: {},
        aviso: null
    },
    {
        nome: 'registro de OUTRO DEPLOY (o shape v1, que nomeava um slot): descartado calado',
        preparar: async () => {
            // Nem toast: não houve gesto do usuário NESTA aba a que responder. E o descarte é o que
            // impede o pior dos dois mundos na virada de versão — o slot que a tela antiga criou
            // sobreviveria à navegação, e o consumidor novo criaria um SEGUNDO ao lado dele.
            await ns.getGlobalStore().setItem('pending_import', {
                version: 1, atlasId: 'slot-da-tela-antiga', name: NOME, savedAt: Date.now(), data: BYTES
            });
        },
        opcoes: {},
        aviso: null
    },
    {
        nome: 'banco global ilegível: o boot segue, em vez de morrer numa leitura opcional',
        preparar: async () => { ns.getGlobalStore().getItem.mockRejectedValueOnce(new Error('idb morto')); },
        opcoes: {},
        aviso: null,
        calaWarn: true
    }
];

describe('o .ebgeo pendente: nenhum ramo de recusa gasta um atlas local', () => {
    it.each(RAMOS_DE_RECUSA)('$nome', async ({ preparar, opcoes, aviso, calaWarn }) => {
        const warn = calaWarn ? vi.spyOn(console, 'warn').mockImplementation(() => {}) : null;
        await preparar();
        const { service, processFileDirectly } = importadorFalso();
        const criador = criadorFalso();

        const assumiu = await consumo({
            ...opcoes,
            importador: 'importador' in opcoes ? opcoes.importador : service,
            criador
        });

        expect(assumiu).toBe(false);
        // O QUE ESTE ARQUIVO EXISTE PARA PRENDER: recusar não pode custar um slot.
        expect(criador).not.toHaveBeenCalled();
        expect(processFileDirectly).not.toHaveBeenCalled();
        // E o log compartilhado confirma que NADA aconteceu, não só que estes dois não aconteceram.
        expect(chamadas).toEqual([]);
        expect(entregaNoDisco()).toBe(false);

        if (aviso === null) {
            expect(avisos).toEqual([]);
        } else {
            expect(avisos).toHaveLength(1);
            expect(avisos[0].level).toBe(aviso.nivel);
            expect(avisos[0].message).toContain(aviso.trecho);
        }
        warn?.mockRestore();
    });

    it('controle: os cinco ramos são ramos DISTINTOS, e não a mesma linha cinco vezes', () => {
        // Uma tabela cujas entradas colapsassem no mesmo caminho passaria cinco vezes provando uma.
        expect(new Set(RAMOS_DE_RECUSA.map(r => r.nome)).size).toBe(5);
        expect(RAMOS_DE_RECUSA.filter(r => r.aviso !== null)).toHaveLength(2);
    });
});

describe('o .ebgeo pendente: quando a criação do atlas é o passo que falha', () => {
    it('teto de dez atlas: não importa NADA, e a frase da API chega ao usuário', async () => {
        await entregaPronta();
        const { service, processFileDirectly } = importadorFalso();
        const criador = criadorFalso({ ok: false, error: 'local_atlas_limit', message: RECUSA_DO_TETO });

        const assumiu = await consumo({ importador: service, criador });

        expect(assumiu).toBe(false);
        // Ele TENTOU criar (é o passo recusável), e parou aí: importar sem slot novo cairia no
        // atlas que o usuário tinha aberto, e o import não aditivo o substituiria.
        expect(criador).toHaveBeenCalledTimes(1);
        expect(processFileDirectly).not.toHaveBeenCalled();
        expect(chamadas).toEqual([`criar:${NOME}`]);
        // A frase é a da API, repassada inteira: ela sabe o que o usuário tem de fazer.
        expect(avisos).toEqual([{ message: RECUSA_DO_TETO, level: 'error' }]);
        expect(entregaNoDisco()).toBe(false);
    });

    it('recusa SEM frase: o usuário ouve alguma coisa, nunca silêncio', async () => {
        await entregaPronta();
        const { processFileDirectly, service } = importadorFalso();

        const assumiu = await consumo({ importador: service, criador: criadorFalso({ ok: false }) });

        expect(assumiu).toBe(false);
        expect(processFileDirectly).not.toHaveBeenCalled();
        expect(avisos).toHaveLength(1);
        expect(avisos[0].message.length).toBeGreaterThan(0);
        expect(avisos[0].level).toBe('error');
    });

    it('a criação LANÇA (falha de persistência no meio da troca): avisa e não importa', async () => {
        const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
        await entregaPronta();
        const { service, processFileDirectly } = importadorFalso();

        const assumiu = await consumo({
            importador: service,
            criador: criadorFalso(new Error('idb morreu no meio da montagem'))
        });

        // Devolve o boot para a cadeia: é ela que ainda sabe pousar a aba num mapa local.
        expect(assumiu).toBe(false);
        expect(processFileDirectly).not.toHaveBeenCalled();
        expect(avisos).toHaveLength(1);
        expect(avisos[0].level).toBe('error');
        expect(entregaNoDisco()).toBe(false);
        expect(erro).toHaveBeenCalled();
        erro.mockRestore();
    });
});

describe('e o consumidor é o que o boot do mapa realmente chama', () => {
    it('index.js importa este módulo, injeta o criador, e não guarda uma segunda cópia da decisão', async () => {
        const { readFileSync } = await import('node:fs');
        const { fileURLToPath } = await import('node:url');
        const fonte = readFileSync(
            fileURLToPath(new URL('../../src/js/index.js', import.meta.url)), 'utf8'
        );
        expect(fonte).toContain("from './deep-link/pending-import.js'");
        // O efeito injetado é a QUINTA entrada em atlas, e é a de verdade: um `createAtlas` que não
        // fosse `switchToNewLocalAtlas` seria uma sexta entrada improvisada, que é o defeito que
        // `tests/unit/portao-de-montagem.test.js` vigia do outro lado.
        expect(fonte).toContain('createAtlas: (name) => switchToNewLocalAtlas(name)');
        // E não lê mais a entrega por conta própria: duas cópias da regra é como uma delas para de
        // apagar sem ninguém notar.
        expect(fonte).not.toContain('takePendingImport');
    });

    // A outra metade (a TELA não cria mais o slot) é asserida em
    // `tests/unit/portao-de-montagem.test.js`, que é onde mora a pergunta "quem gasta o teto de 10".
});
