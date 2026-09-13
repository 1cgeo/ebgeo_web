// Path: tests/unit/pendencias-leitor-unico.test.js

/**
 * @fileoverview O LEITOR DE PENDÊNCIAS É UM SÓ, E ALCANÇA AS QUATRO PÁGINAS (achado F23).
 *
 * DUAS METADES, e elas reprovam por razões diferentes.
 *
 * A METADE ESTRUTURAL. O leitor entra em serviço no ramo de SUCESSO do portão de migração
 * (`runLegacyUpgradeGate`, em `ui/migration-recovery.js`), e as quatro páginas chamam o portão.
 * Enquanto ele foi instalado à mão em `index.js` e em `projects-page.js` apenas, quem abrisse
 * `admin.html` ou `calibracao.html` pulsava presença SEM o campo de pendências, e o painel do
 * administrador contava a si mesmo como "verificação indisponível": o próprio instrumento
 * aparecia como navegador que não se sabe medir. A asserção é sobre o SÍTIO DE CHAMADA e a
 * ordem, nunca sobre o comportamento (que é da metade de baixo), e o inventário de páginas vem
 * do disco, no molde de `portao-de-migracao-nas-quatro-paginas.test.js`: uma quinta página nasce
 * reprovada até ser classificada, que é o modo silencioso desta classe de teste envelhecer.
 *
 * A METADE DE COMPORTAMENTO. O leitor devolve as MESMAS contagens para as duas telas que
 * perguntam (o pulso de presença, sobre o navegador inteiro, e a luz de sync, sobre o atlas
 * montado), e as duas propriedades que ele não pode perder são a ausência que não vira zero e o
 * recorte de quais atlas contam.
 *
 * CONTROLE NEGATIVO, conferido em 2026-09-13:
 *   1. `instalarMonitoramentoDePendencias()` retirado do portão e reposto à mão só em
 *      `index.js` (que é exatamente o estado anterior a este lote): 1 caso estrutural
 *      reprovado, o do portão, acusando junto o segundo sítio de instalação;
 *   2. o teto de chaves trocado por um corte na lista (contar o que der e seguir): 1 caso
 *      reprovado, o do desconhecido que vira contagem;
 *   3. a quarentena e os blobs zerados em `lerPendenciasDoEscopoAtivo`: 4 casos reprovados,
 *      1 aqui e 3 em `sync-status-control.test.js`, que é o alcance da mudança.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// ---------------------------------------------------------------------------
// Metade estrutural
// ---------------------------------------------------------------------------

/** Apaga o conteúdo dos comentários preservando as linhas, para que a prosa não conte como código. */
function semComentarios(texto) {
    return texto
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/(^|[^:])\/\/[^\n]*/g, (m, antes) => antes + ' '.repeat(m.length - antes.length));
}

/** @returns {Array<{html: string, entrada: string}>} As páginas do disco e seus módulos de entrada. */
function paginasDoDisco() {
    return readdirSync(FRONT)
        .filter((f) => f.endsWith('.html'))
        .sort()
        .map((html) => {
            const modulo = readFileSync(join(FRONT, html), 'utf8')
                .match(/<script\s+type="module"\s+src="\/(src\/js\/[^"]+)"/);
            expect(modulo, `${html} não declara um módulo de entrada`).not.toBeNull();
            return { html, entrada: modulo[1] };
        });
}

const PAGINAS = paginasDoDisco();

describe('o leitor de pendências alcança as quatro páginas', () => {
    it('as quatro páginas do produto continuam sendo quatro', () => {
        // Controle de vácuo: com uma página a mais, a classificação abaixo deixaria de cobrir o
        // conjunto e o verde passaria a ser sobre outra coisa.
        expect(PAGINAS.map((p) => p.html))
            .toEqual(['admin.html', 'atlas.html', 'calibracao.html', 'index.html']);
    });

    it.each(PAGINAS)('$html passa pelo portão, que é quem instala o leitor', ({ entrada }) => {
        const codigo = semComentarios(readFileSync(join(FRONT, entrada), 'utf8'));
        expect(codigo).toMatch(/if\s*\(!\s*await\s+runLegacyUpgradeGate\(\)\)\s*return;/);
    });

    it('o portão instala o leitor, e só no ramo de SUCESSO', () => {
        const codigo = semComentarios(readFileSync(join(FRONT, 'src/js/ui/migration-recovery.js'), 'utf8'));
        const chamada = codigo.indexOf('instalarMonitoramentoDePendencias()');
        // Asserido como ENCONTRADO antes de comparar: -1 passaria por "veio antes de tudo".
        expect(chamada).toBeGreaterThan(-1);
        // O sucesso é o `return true`, e a instalação vem ANTES dele e depois do `closeScreen()`.
        const sucesso = codigo.indexOf('return true;', chamada);
        expect(sucesso).toBeGreaterThan(chamada);
        // E não há uma segunda instalação em página nenhuma: um segundo sítio faria a página que o
        // tem sobrescrever o leitor da outra, que é a forma como "um leitor só" volta a ser dois.
        const outros = PAGINAS
            .map((p) => semComentarios(readFileSync(join(FRONT, p.entrada), 'utf8')))
            .filter((c) => c.includes('instalarMonitoramentoDePendencias'));
        expect(outros).toEqual([]);
    });

    it('a luz de sync consome o MESMO leitor, e não uma varredura própria', () => {
        const codigo = semComentarios(
            readFileSync(join(FRONT, 'src/js/account/sync-status.control.js'), 'utf8'));
        expect(codigo).toContain('lerPendenciasDoEscopoAtivo');
        // O que a reversão desfaria: a luz voltando a somar o censo por conta própria, ao lado de
        // um pulso que conta de outro jeito.
        expect(codigo).not.toContain('countByState');
        expect(codigo).not.toContain('listQuarantinedOperations');
    });
});

// ---------------------------------------------------------------------------
// Metade de comportamento
// ---------------------------------------------------------------------------

const mundo = {
    escopoAtivo: { kind: 'remote', atlasId: 'a1', dbSuffix: 'remote__a1' },
    locais: [],
    remotos: [],
    /** Por dbSuffix: as chaves `op_` e os envelopes daquele banco. */
    bancos: new Map(),
    censoPorSufixo: new Map(),
    quarentena: [],
    blobs: [],
};

vi.mock('@store/atlas-namespace.js', () => ({
    getActiveScope: () => mundo.escopoAtivo,
    getStoreFor: (_nome, scope) => ({
        keys: async () => [...(mundo.bancos.get(scope.dbSuffix)?.keys() ?? [])],
        getItem: async (k) => mundo.bancos.get(scope.dbSuffix)?.get(k) ?? null,
    }),
    readLocalAtlasRegistry: async () => mundo.locais,
    remoteScope: (atlasId) => ({ kind: 'remote', atlasId, dbSuffix: `remote__${atlasId}` }),
    StoreName: Object.freeze({ OPERATION_QUEUE: 'operation_queue' }),
    StoreScopeKind: Object.freeze({ LOCAL: 'local', REMOTE: 'remote' }),
}));

vi.mock('@store/remote-atlas.api.js', () => ({ listRemoteAtlases: async () => mundo.remotos }));

vi.mock('@store/sync/operation-queue.js', () => ({
    operationBelongsToScope: (op, sufixo) => op.scopeSuffix === sufixo,
    OperationQueue: class {
        constructor(scope) { this._sufixo = scope.dbSuffix; }
        async countByState() {
            return mundo.censoPorSufixo.get(this._sufixo)
                ?? { pendentes: 0, preparadas: 0, problemas: 0 };
        }
    },
}));

vi.mock('@store/sync/quarantine-registry.js', () => ({
    listQuarantinedOperations: async () => mundo.quarentena,
}));

vi.mock('@store/sync/blob-upload-queue.js', () => ({
    BlobUploadState: Object.freeze({
        PENDENTE: 'pendente', CONFIRMADO: 'confirmado', RECUSADO: 'recusado',
    }),
    listarPendenciasDeBlob: async () => mundo.blobs,
}));

vi.mock('@js/session/presenca.js', () => ({ configurarPendenciasDePresenca() {} }));

const { lerPendenciasDoEscopoAtivo, lerPendenciasDoNavegador } =
    await import('../../src/js/session/pendencias-monitoramento.js');

/** Povoa o banco de um atlas com N envelopes, o mais antigo em `nascimento`. */
function povoar(atlasId, quantidade, nascimento) {
    const sufixo = `remote__${atlasId}`;
    const banco = new Map();
    for (let i = 0; i < quantidade; i++) {
        banco.set(`op_${nascimento + i}_000_id${i}`, { scopeSuffix: sufixo, timestamp: nascimento + i });
    }
    mundo.bancos.set(sufixo, banco);
    mundo.censoPorSufixo.set(sufixo, { pendentes: quantidade, preparadas: 0, problemas: 0 });
}

beforeEach(() => {
    mundo.escopoAtivo = { kind: 'remote', atlasId: 'a1', dbSuffix: 'remote__a1' };
    mundo.locais = [];
    mundo.remotos = [];
    mundo.bancos = new Map();
    mundo.censoPorSufixo = new Map();
    mundo.quarentena = [];
    mundo.blobs = [];
});

describe('o total do navegador, para o pulso de presença', () => {
    it('soma os atlas de servidor e relata a idade da pendência MAIS ANTIGA', async () => {
        mundo.remotos = [{ atlasId: 'a1', dbSuffix: 'remote__a1' }, { atlasId: 'a2', dbSuffix: 'remote__a2' }];
        povoar('a1', 2, 1000);
        povoar('a2', 3, 500);
        const lido = await lerPendenciasDoNavegador(10000);
        expect(lido).toEqual({ pendentes: 5, idadePendenteMs: 9500 });
    });

    it('sem pendência nenhuma a idade é zero, e não a idade de um envelope confirmado', async () => {
        mundo.remotos = [{ atlasId: 'a1', dbSuffix: 'remote__a1' }];
        povoar('a1', 0, 0);
        expect(await lerPendenciasDoNavegador(10000)).toEqual({ pendentes: 0, idadePendenteMs: 0 });
    });

    it('atlas RESGATADO (sufixo remoto no registro local) sai da conta', async () => {
        // Ele deixou de ser dívida com o servidor no instante em que virou slot local, mesmo
        // continuando a ser literalmente os mesmos bancos.
        mundo.remotos = [{ atlasId: 'a1', dbSuffix: 'remote__a1' }];
        mundo.locais = [{ dbSuffix: 'remote__a1' }];
        povoar('a1', 4, 1000);
        expect(await lerPendenciasDoNavegador(10000)).toEqual({ pendentes: 0, idadePendenteMs: 0 });
    });

    it('atlas já marcado para descarte sai da conta', async () => {
        mundo.remotos = [{ atlasId: 'a1', dbSuffix: 'remote__a1', discardRequested: true }];
        povoar('a1', 4, 1000);
        expect(await lerPendenciasDoNavegador(10000)).toEqual({ pendentes: 0, idadePendenteMs: 0 });
    });

    it('banco grande demais devolve DESCONHECIDO, e desconhecido não é zero', async () => {
        // O objeto vazio é o que faz o painel dizer "verificação indisponível". Contar o que
        // desse tempo produziria um número menor que o real com cara de medição.
        mundo.remotos = [{ atlasId: 'a1', dbSuffix: 'remote__a1' }];
        const banco = new Map();
        for (let i = 0; i <= 100000; i++) banco.set(`op_${i}`, { scopeSuffix: 'remote__a1' });
        mundo.bancos.set('remote__a1', banco);
        expect(await lerPendenciasDoNavegador(10000)).toEqual({});
    });
});

describe('as pendências do atlas montado, para a luz', () => {
    it('junta o censo da fila, a quarentena e os uploads abertos', async () => {
        mundo.censoPorSufixo.set('remote__a1', { pendentes: 1, preparadas: 2, problemas: 3 });
        mundo.quarentena = [{ atlasId: 'a1' }, { atlasId: 'a2' }];
        mundo.blobs = [{ estado: 'pendente' }, { estado: 'recusado' }, { estado: 'confirmado' }];
        expect(await lerPendenciasDoEscopoAtivo()).toEqual({
            pendentes: 1, preparadas: 2, problemas: 3,
            quarentena: 2, uploads: 2, uploadsRecusados: 1,
        });
    });

    it('num atlas local a pergunta não se aplica, e a resposta é nula e não zero', async () => {
        mundo.escopoAtivo = { kind: 'local', atlasId: 'l1', dbSuffix: 'local1' };
        expect(await lerPendenciasDoEscopoAtivo()).toBeNull();
    });

    it('sem escopo ativo nenhum também é nulo, e não uma leitura de banco errado', async () => {
        mundo.escopoAtivo = null;
        expect(await lerPendenciasDoEscopoAtivo()).toBeNull();
    });
});
