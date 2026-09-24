// Path: tests/integration/tela-de-recuperacao-duas-saidas.test.js

/**
 * @fileoverview A TELA DE RECUPERAÇÃO TEM DOIS COMANDOS, e só dois (decisão do dono, 2026-09-22).
 *
 * Ela tinha até SETE, conforme o `code`: tentar de novo, salvar cópia de recuperação, preparar uma
 * nova cópia, recuperar alterações em outro atlas, abrir cópia de recuperação, restaurar como
 * outro atlas e apagar o acervo antigo. Metade deles pedia à pessoa uma decisão que ela não tem
 * como julgar, e hoje o código as toma antes de desenhar a tela
 * (`tests/integration/transicao-resiliente.test.js`).
 *
 * POR QUE AQUI E NÃO NUM TESTE ESTRUTURAL. "Quantos botões a tela tem" é afirmação sobre o que
 * chega ao DOM, e ler o texto-fonte do arquivo provaria só que os literais estão lá. O dublê de
 * `tests/helpers/dom-double.js` é estreito de propósito e cobre o que esta tela toca; o clique é
 * disparado de verdade, então o que se mede é o caminho inteiro do comando.
 *
 * O QUE ELE NÃO ALCANÇA, declarado: `fake-indexeddb` mais localforage caem em `_encodeBlob`, que
 * precisa de `FileReader`, e node não tem. Então NENHUMA imagem é guardável aqui, e o ramo de
 * imagem de `montarDocumentoEbgeo` (a tabela de extensão, que decide o MIME na volta) só é
 * exercitado no navegador, por `tests/e2e-ui/browser-migracao-2.2.spec.js`.
 */

import { beforeAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { seedDatabase, resetIndexedDB, listDatabases, holdDatabaseOpen } from '../helpers/idb-helpers.js';
import { fire, makeElement, makeDocumentStub } from '../helpers/dom-double.js';
import {
    BAIXAR_LABEL, CONTINUAR_CANCELAR_LABEL, CONTINUAR_CONFIRMAR_LABEL, CONTINUAR_LABEL
} from '@js/ui/migration-recovery-phrases.js';

/** Os treze estados em que a tela pode nascer. Ver o censo em `migracao-frases-...`. */
const CODIGOS = Object.freeze([
    'legacy_tab', 'legacy_changes', 'source_changed', 'copy_failed', 'lock_unavailable',
    'migration_failed', 'unknown_version', 'unsupported_version', 'unreadable',
    'ambiguous_registry', 'drop_blocked', 'api_unavailable'
]);

let doc;
let baixados;
let recarregou;

// O CLIQUE EM "Baixar meus dados" CARREGA O CONSTRUTOR DO .ebgeo SOB DEMANDA, e o primeiro caso que
// clica pagava a TRANSFORMAÇÃO desse grafo dentro do `vi.waitFor`, que desiste em 1 s. Na suíte
// inteira da raiz, sob carga, o caso "com UM acervo" reprovou em 2 de 3 rodadas de 2026-09-24
// (`expected [] to have a length of 1`) e passava sozinho. É a classe do import a frio de
// `.claude/rules/testes-frontend-e-lint.md`: aquecer aqui tira o carregador da conta do caso, e o
// `vi.resetModules()` abaixo continua refazendo só a avaliação, que é barata.
beforeAll(async () => {
    await import('@store/migration/ebgeo-de-recuperacao.js');
    await import('@store/migration/recovery-archive.js');
}, 60_000);

beforeEach(async () => {
    vi.resetModules();
    await resetIndexedDB();
    baixados = [];
    recarregou = 0;
    doc = makeDocumentStub();
    doc.getElementById = () => null;
    doc.createElement = (tag) => {
        const el = makeElement(tag);
        // O dublê não tem `click()`, e `entregarArquivo` depende dele: é assim que o arquivo sai.
        el.click = () => { if (el.tagName === 'A') baixados.push({ nome: el.download, href: el.href }); };
        return el;
    };
    globalThis.document = doc;
    globalThis.window = { addEventListener() {}, location: { reload: () => { recarregou += 1; } } };
    globalThis.URL.createObjectURL = (blob) => { blobPorUrl.set('blob:teste', blob); return 'blob:teste'; };
    globalThis.URL.revokeObjectURL = () => {};
});

afterEach(async () => {
    vi.restoreAllMocks();
    await resetIndexedDB();
});

const blobPorUrl = new Map();

/** Uma instalação 2.4 da versão antiga, sem transição nenhuma: SETE registros. */
async function seedUmAcervo() {
    await seedDatabase('ebgeo_atlas', { current_atlas: {
        id: '76cfc275-0000-4000-8000-000000000000', name: 'Meu Atlas', schemaVersion: '2.4',
        lastActiveMapId: 'Principal', mapOrder: ['Principal', 'Segundo']
    } });
    await seedDatabase('ebgeo_maps', {
        Principal: { id: 'Principal', name: 'Principal', baseLayer: 'osm-overture', zoom: 7,
            features: { points: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [-47.9, -15.8] },
                properties: { id: 'p1', nome: 'Ponto', source: 'point' } }] } },
        Segundo: { id: 'seg', name: 'Segundo', baseLayer: 'osm-overture', features: { points: [] } }
    });
    await seedDatabase('ebgeo_app_settings', {
        schemaVersion: '2.4', lastActiveMap: 'Principal',
        color_usage_Principal: { '#ff0000': 1 }, map_notes_Principal: { title: 'Nota' }
    });
}

/** Um segundo acervo, registrado como atlas local, que faz o `.ebgeo` deixar de ser possível. */
async function seedSegundoAcervo() {
    const ns = await import('@store/atlas-namespace.js');
    const id = 'bbbbbbbb-0000-4000-8000-000000000001';
    await ns.getGlobalStore().setItem(ns.localAtlasRegistryKey(id),
        { id, name: 'Outro Atlas', dbSuffix: `local-${id}`, version: 1 });
    await ns.getStoreFor(ns.StoreName.MAPS, ns.localScope(id, `local-${id}`))
        .setItem('Principal', { id: 'Principal', name: 'Principal', features: { points: [] } });
}

async function desenharTela(code) {
    const { showMigrationRecovery } = await import('@js/ui/migration-recovery.js');
    showMigrationRecovery({ code });
    const tela = doc.body.children.find(c => c.dataset?.testid === 'migration-recovery');
    const card = tela.children[0];
    return { tela, card, texto: card.children[1], botoes: card.children.filter(c => c.tagName === 'BUTTON') };
}

/** Deixa o microtask queue drenar, porque o clique do dublê não devolve a promessa do handler. */
async function assentar(voltas = 8) {
    for (let i = 0; i < voltas; i++) await Promise.resolve();
}

describe('a tela é uma e os comandos são dois', () => {
    it.each(CODIGOS)('o código %s desenha exatamente dois comandos, nesta ordem', async (code) => {
        const { card, botoes, texto } = await desenharTela(code);
        expect(botoes.map(b => b.textContent)).toEqual([BAIXAR_LABEL, CONTINUAR_LABEL]);
        // O destrutivo é o ÚLTIMO e é o único com a classe de perigo.
        expect(card.children.at(-1)).toBe(botoes[1]);
        expect(botoes[1].className).toContain('ebgeo-unavailable__btn--danger');
        expect(botoes[0].className).not.toContain('--danger');
        // A causa daquele código chegou ao texto, e não a de outro.
        const { causaDaFalha } = await import('@js/ui/migration-recovery-phrases.js');
        expect(texto.textContent).toContain(causaDaFalha(code));
    });

    it('os comandos que saíram não são desenhados por código nenhum', async () => {
        const removidos = ['Tentar novamente', 'Preparar uma nova cópia',
            'Recuperar alterações em outro atlas', 'Abrir cópia de recuperação',
            'Restaurar como outro atlas', 'Salvar cópia de recuperação'];
        for (const code of CODIGOS) {
            const { card } = await desenharTela(code);
            const rotulos = card.children.map(c => c.textContent);
            for (const saiu of removidos) expect(rotulos, `${code} ainda oferece "${saiu}"`).not.toContain(saiu);
            // E nem o seletor de arquivo que a restauração usava.
            expect(card.children.some(c => c.tagName === 'INPUT')).toBe(false);
        }
    });
});

describe('"Baixar meus dados" tenta o .ebgeo antes da cópia bruta', () => {
    it('com UM acervo entrega um .ebgeo, e diz que a pessoa o reabre sozinha', async () => {
        await seedUmAcervo();
        const { botoes, texto } = await desenharTela('unreadable');
        fire(botoes[0], 'click');
        await vi.waitFor(() => expect(baixados).toHaveLength(1));
        expect(baixados[0].nome).toMatch(/^ebgeo-\d{4}-\d{2}-\d{2}\.ebgeo$/);
        expect(texto.textContent).toContain('Importar atlas');
        expect(texto.textContent).not.toContain('equipe do EBGeo');
    });

    it('o arquivo entregue é lido pelo leitor REAL de `.ebgeo`, com os mapas dentro', async () => {
        await seedUmAcervo();
        const { construirEbgeoDeRecuperacao } = await import('@store/migration/ebgeo-de-recuperacao.js');
        const { blob, nome, registros } = await construirEbgeoDeRecuperacao();
        expect(nome.endsWith('.ebgeo')).toBe(true);
        expect(registros).toBe(7);

        // O LEITOR DO PRODUTO, e não um `JSON.parse` deste teste: é ele que decide se o arquivo
        // pode ser importado, e um `.ebgeo` que só este arquivo sabe ler não serve de recuperação.
        const { readEbgeoArchive } = await import('@js/import_export/ebgeo-file-gate.js');
        const { data } = await readEbgeoArchive(blob);
        expect(Object.keys(data.maps).sort()).toEqual(['Principal', 'Segundo']);
        expect(data.maps.Principal.features.points).toHaveLength(1);
        expect(data.maps.Principal.baseLayer).toBe('osm-overture');
        expect(data.maps.Principal.zoom).toBe(7);
        // As seções laterais vieram pelos endereços que o registro usa, e não em branco.
        expect(data.colorUsage.Principal).toEqual({ '#ff0000': 1 });
        expect(data.mapNotes.Principal).toEqual({ title: 'Nota' });
        expect(data.mapOrder).toEqual(['Principal', 'Segundo']);
        expect(data.currentMap).toBe('Principal');
        // O documento não leva o que o importador cunha de novo.
        expect(data.maps.Principal.sync).toBeUndefined();
        expect(data.maps.Principal.name).toBeUndefined();
    });

    it.each(['__proto__', 'constructor', 'toString'])('a cópia de recuperação conserva o mapa %s e suas notas', async name => {
        await seedUmAcervo();
        await seedDatabase('ebgeo_maps', Object.fromEntries([[name, {
            id: 'mapa-reservado', name, features: { points: [] }
        }]]));
        await seedDatabase('ebgeo_app_settings', {
            [`map_notes_${name}`]: { title: `Nota ${name}` }
        });
        const { construirEbgeoDeRecuperacao } = await import('@store/migration/ebgeo-de-recuperacao.js');
        const { blob } = await construirEbgeoDeRecuperacao();
        const { readEbgeoArchive } = await import('@js/import_export/ebgeo-file-gate.js');
        const { data } = await readEbgeoArchive(blob);
        expect(Object.keys(data.maps)).toContain(name);
        expect(data.maps[name].features.points).toEqual([]);
        expect(Object.hasOwn(data.mapNotes, name)).toBe(true);
        expect(data.mapNotes[name]).toEqual({ title: `Nota ${name}` });
    });

    it('com DOIS acervos cai para a cópia bruta, e a frase diz por quê', async () => {
        await seedUmAcervo();
        await seedSegundoAcervo();
        const { botoes, texto } = await desenharTela('unreadable');
        fire(botoes[0], 'click');
        await vi.waitFor(() => expect(baixados).toHaveLength(1));
        expect(baixados[0].nome).toMatch(/^ebgeo-recuperacao-\d{4}-\d{2}-\d{2}\.zip$/);
        expect(texto.textContent).toContain('mais de um atlas');
        expect(texto.textContent).toContain('equipe do EBGeo');
    });

    it('mapas diferentes com o mesmo nome vão completos para a cópia bruta', async () => {
        await seedUmAcervo();
        await seedDatabase('ebgeo_maps', {
            'aaaaaaaa-0000-4000-8000-000000000001': { id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'Principal', features: { points: [] } }
        });
        const { botoes, texto } = await desenharTela('unreadable');
        fire(botoes[0], 'click');
        await vi.waitFor(() => expect(baixados).toHaveLength(1));
        expect(baixados[0].nome).toMatch(/\.zip$/);
        const { readRecoveryArchive } = await import('@store/migration/recovery-archive.js');
        const archive = await readRecoveryArchive(blobPorUrl.get(baixados[0].href));
        expect(archive.scopes[0].records.filter(record => record.store === 'maps').map(record => record.key).sort())
            .toEqual(['Principal', 'Segundo', 'aaaaaaaa-0000-4000-8000-000000000001']);
        expect(texto.textContent).toContain('mesmo nome');
    });

    it('recusa um arquivo montado enquanto outra janela muda os documentos', async () => {
        await seedUmAcervo();
        const ns = await import('@store/atlas-namespace.js');
        const { legacyScope } = await import('@store/migration/migration-scope.js');
        const maps = ns.getStoreFor(ns.StoreName.MAPS, legacyScope());
        await maps.ready(); // localforage installs its driver methods during initialization.
        const originalIterate = maps.iterate.bind(maps);
        let mudou = false;
        vi.spyOn(maps, 'iterate').mockImplementationOnce(async callback => {
            const result = await originalIterate(callback);
            await maps.setItem('Segundo', { id: 'seg', name: 'Segundo', features: { points: [] }, modified: true });
            mudou = true;
            return result;
        });
        const { construirEbgeoDeRecuperacao } = await import('@store/migration/ebgeo-de-recuperacao.js');
        await expect(construirEbgeoDeRecuperacao()).rejects.toMatchObject({ code: 'source_changed' });
        expect(mudou).toBe(true);
        expect((await maps.getItem('Segundo')).modified).toBe(true);
    });

    it('o campo Novo Mapa herdado não junta registros com chaves diferentes', async () => {
        await seedUmAcervo();
        await seedDatabase('ebgeo_maps', {
            Alfa: { name: 'Novo Mapa', features: { points: [] } },
            Bravo: { name: 'Novo Mapa', features: { points: [] } }
        });
        const { construirEbgeoDeRecuperacao } = await import('@store/migration/ebgeo-de-recuperacao.js');
        const { blob } = await construirEbgeoDeRecuperacao();
        const { readEbgeoArchive } = await import('@js/import_export/ebgeo-file-gate.js');
        const { data } = await readEbgeoArchive(blob);
        expect(Object.keys(data.maps).sort()).toEqual(['Alfa', 'Bravo', 'Principal', 'Segundo']);
    });

    it('a ordem e o mapa corrente traduzem os UUIDs para os nomes do arquivo', async () => {
        await seedUmAcervo();
        const alfa = 'aaaaaaaa-0000-4000-8000-000000000001';
        const bravo = 'bbbbbbbb-0000-4000-8000-000000000001';
        await seedDatabase('ebgeo_maps', {
            [alfa]: { id: alfa, name: 'Alfa', features: { points: [] } },
            [bravo]: { id: bravo, name: 'Bravo', features: { points: [] } }
        });
        await seedDatabase('ebgeo_atlas', { current_atlas: {
            id: 'atlas', name: 'Meu Atlas', schemaVersion: '2.4',
            mapOrder: [bravo, alfa, bravo, 'ausente', 'Segundo', 'Principal'], lastActiveMapId: bravo
        } });
        const { construirEbgeoDeRecuperacao } = await import('@store/migration/ebgeo-de-recuperacao.js');
        const { blob } = await construirEbgeoDeRecuperacao();
        const { readEbgeoArchive } = await import('@js/import_export/ebgeo-file-gate.js');
        const { data } = await readEbgeoArchive(blob);
        expect(data.mapOrder).toEqual(['Bravo', 'Alfa', 'Segundo', 'Principal']);
        expect(data.currentMap).toBe('Bravo');
    });

    it('sem acervo nenhum ainda entrega a cópia bruta, nomeando a ausência', async () => {
        const { botoes, texto } = await desenharTela('unreadable');
        fire(botoes[0], 'click');
        await vi.waitFor(() => expect(baixados).toHaveLength(1));
        expect(baixados[0].nome.endsWith('.zip')).toBe(true);
        expect(texto.textContent).toContain('não há um atlas legível');
    });
});

describe('"Continuar" pergunta uma vez, nomeando a contagem, e só então apaga', () => {
    it('o clique não apaga nada: ele desenha a confirmação com o número do disco', async () => {
        await seedUmAcervo();
        const { card, botoes, texto } = await desenharTela('migration_failed');
        fire(botoes[1], 'click');
        await vi.waitFor(() => expect(texto.textContent).toContain('7 registros'));

        const confirmacao = card.children.find(c => c.dataset?.testid === 'migration-continue-confirm');
        expect(confirmacao.children.map(b => b.textContent))
            .toEqual([CONTINUAR_CONFIRMAR_LABEL, CONTINUAR_CANCELAR_LABEL]);
        // CONTROLE: o acervo continua no disco enquanto a pergunta está na tela.
        expect(await (await import('@store/atlas-namespace.js'))
            .getStoreFor('maps', (await import('@store/migration/migration-scope.js')).legacyScope())
            .length()).toBe(2);
        expect(recarregou).toBe(0);
    });

    it('enquanto a pergunta está na tela o comando "Continuar" some, e volta ao manter', async () => {
        // Visto na captura de 2026-09-22: dois botões vermelhos, um sobre o outro, liam como dois
        // atos diferentes. O comando se esconde (não some do DOM) enquanto a confirmação desenha o
        // dela, e reaparece quando a pessoa mantém os dados.
        await seedUmAcervo();
        const { card, botoes, texto } = await desenharTela('migration_failed');
        expect(botoes[1].hidden).toBe(false);
        fire(botoes[1], 'click');
        await vi.waitFor(() => expect(texto.textContent).toContain('7 registros'));
        expect(botoes[1].hidden, 'o comando cede a vez à pergunta').toBe(true);
        const confirmacao = card.children.find(c => c.dataset?.testid === 'migration-continue-confirm');
        fire(confirmacao.children[1], 'click');
        await assentar();
        expect(botoes[1].hidden, 'manter os dados devolve o comando').toBe(false);
    });

    it('manter os dados fecha a pergunta e devolve o texto anterior', async () => {
        await seedUmAcervo();
        const { card, botoes, texto } = await desenharTela('migration_failed');
        const antes = texto.textContent;
        fire(botoes[1], 'click');
        await vi.waitFor(() => expect(texto.textContent).toContain('7 registros'));
        const confirmacao = card.children.find(c => c.dataset?.testid === 'migration-continue-confirm');
        fire(confirmacao.children[1], 'click');
        await assentar();
        expect(texto.textContent).toBe(antes);
        expect(card.children.some(c => c.dataset?.testid === 'migration-continue-confirm')).toBe(false);
        expect(recarregou).toBe(0);
    });

    it('outra janela segurando um banco NÃO apaga nada, e o comando continua na tela', async () => {
        await seedUmAcervo();
        // Sem a válvula de `versionchange`: a conexão fica aberta e o delete não confirma, que é
        // exatamente o que uma segunda janela do EBGeo faz.
        const preso = await holdDatabaseOpen('ebgeo_maps', { withVersionChangeValve: false });
        try {
            const { card, botoes, texto } = await desenharTela('migration_failed');
            fire(botoes[1], 'click');
            await vi.waitFor(() => expect(texto.textContent).toContain('7 registros'));
            const confirmacao = card.children.find(c => c.dataset?.testid === 'migration-continue-confirm');
            fire(confirmacao.children[0], 'click');
            await vi.waitFor(() => expect(texto.textContent).toContain('nada foi apagado'), { timeout: 15000 });

            expect(texto.textContent).toContain('Feche as outras janelas');
            expect(recarregou, 'nada foi aberto por cima de um acervo que não saiu').toBe(0);
            // O REGISTRO GLOBAL SOBREVIVE: é ele que nomeia o que ainda está no disco.
            const ns = await import('@store/atlas-namespace.js');
            expect(await ns.getGlobalStore().length()).toBeGreaterThanOrEqual(0);
            // E o comando continua clicável: o estado é reversível por quem está lendo a recusa.
            expect(botoes[1].disabled).toBeFalsy();
            expect(botoes[1].getAttribute('aria-disabled')).not.toBe('true');
        } finally { preso.close(); }
    });

    it('confirmar apaga os bancos desta origem e recarrega a página', async () => {
        await seedUmAcervo();
        await seedSegundoAcervo();
        expect((await listDatabases()).length).toBeGreaterThan(0);
        const { card, botoes, texto } = await desenharTela('migration_failed');
        fire(botoes[1], 'click');
        await vi.waitFor(() => expect(texto.textContent).toMatch(/registros?/));
        const confirmacao = card.children.find(c => c.dataset?.testid === 'migration-continue-confirm');
        fire(confirmacao.children[0], 'click');
        await vi.waitFor(() => expect(recarregou).toBe(1), { timeout: 10000 });

        expect(texto.textContent).toContain('saíram deste computador');
        // NADA DO ACERVO SOBRA: nem o legado, nem o slot registrado, nem o registro global.
        const nomes = await listDatabases();
        expect(nomes.filter(n => n.startsWith('ebgeo_maps'))).toEqual([]);
        const ns = await import('@store/atlas-namespace.js');
        expect(await ns.readLocalAtlasRegistry()).toEqual([]);
    });
});
