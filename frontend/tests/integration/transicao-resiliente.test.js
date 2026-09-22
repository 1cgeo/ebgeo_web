// Path: tests/integration/transicao-resiliente.test.js

/**
 * @fileoverview O REPARO VEM ANTES DA TELA (decisão do dono, 2026-09-22).
 *
 * A regra da junção tardia NÃO mudou: `planLateLegacyChanges` continua respondendo ABSORB ou
 * CONFLICT, e `prepareLegacyTransition` continua LANÇANDO `legacy_changes` no conflito. O que
 * mudou é o que o chamador faz com esse lançamento, e é isso que este arquivo mede: o conflito é
 * resolvido sozinho pela saída mais conservadora (as alterações da versão antiga vão para um atlas
 * local NOVO, e o atlas atualizado não é tocado), e a tela fica para quando nem isso deu certo.
 *
 * A FIXTURE É A DO CASO DO RELATO, reduzida: a mesma de
 * `tests/integration/alteracoes-tardias-legado.test.js`, porque o conflito que interessa é o
 * mesmo (as duas versões desenharam no MESMO mapa). Ela é copiada em vez de importada porque
 * aquele arquivo mede a REGRA e este mede o CHAMADOR: um helper compartilhado faria uma mudança
 * na fixture da regra mexer em silêncio no orçamento de tentativas medido aqui.
 */

import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { seedDatabase, resetIndexedDB } from '../helpers/idb-helpers.js';

beforeEach(async () => { vi.resetModules(); await resetIndexedDB(); });
afterEach(async () => { vi.restoreAllMocks(); vi.doUnmock('@store/migration/legacy-transition.js'); await resetIndexedDB(); });

const SEGUNDO_ID = '6f1c1d0e-4b3a-4d52-9a57-2f3c8e5b7a10';

function linha(n) {
    const id = `00000000-0000-4000-8000-00000000000${n}`;
    return {
        type: 'Feature', id,
        geometry: { type: 'LineString', coordinates: [[-53.03, -24.68], [-53.02, -24.67 - n / 1000]] },
        properties: {
            id, nome: `Linha de Coordenação #${n}`, color: '#000000', layerId: 'default',
            source: 'coordination_line', symbol_code: '290302', visivel: true, bloqueado: false
        }
    };
}

function mapa(nome, id, linhas = []) {
    return {
        id, name: nome, baseLayer: 'osm-overture', catalogLayers: [], analysisLayers: {},
        bearing: null, pitch: null, zoom: null, center_lat: null, center_long: null,
        features: { coordination_lines: linhas, points: [], lines: [], polygons: [] },
        sync: { createdAt: 1, updatedAt: 1, version: 1, deleted: false, deletedAt: null, dirty: true, ownerId: null }
    };
}

async function seed24() {
    await seedDatabase('ebgeo_atlas', { current_atlas: {
        id: '76cfc275-0000-4000-8000-000000000000', name: 'Meu Atlas', schemaVersion: '2.4',
        lastActiveMapId: 'Principal', mapOrder: ['Principal', 'Segundo'], settings: { terrainExaggeration: 1.5 }
    } });
    await seedDatabase('ebgeo_maps', { Principal: mapa('Principal', 'Principal'), Segundo: mapa('Segundo', SEGUNDO_ID) });
    await seedDatabase('ebgeo_app_settings', {
        schemaVersion: '2.4', lastActiveMap: 'Principal', color_usage_Principal: {}, color_usage_Segundo: {}
    });
}

/** O que a versão antiga grava quando desenha `n` linhas no mapa Principal. */
async function antigaDesenha(n = 2) {
    const linhas = Array.from({ length: n }, (_, i) => linha(i + 1));
    await seedDatabase('ebgeo_maps', { Principal: { ...mapa('Principal', 'Principal', linhas), sync: { createdAt: 1, updatedAt: 26, version: 26 } } });
    await seedDatabase('ebgeo_app_settings', { color_usage_Principal: { '#000000': n } });
}

async function modules() {
    return {
        ns: await import('@store/atlas-namespace.js'),
        transition: await import('@store/migration/legacy-transition.js'),
        resiliente: await import('@store/migration/transicao-resiliente.js'),
        state: await import('@store/migration/transition-state.js')
    };
}

/** Conclui a transição e devolve o acesso ao destino. */
async function transicao() {
    const m = await modules();
    const { state } = await m.transition.prepareLegacyTransition();
    const destino = m.ns.localScope(state.entry.id, state.destination);
    return { ...m, destino, loja: id => m.ns.getStoreFor(id, destino), origem: m.ns.localScope('origem', '') };
}

/** O que a versão NOVA grava quando desenha um ponto num mapa. */
async function novaDesenhaPonto(loja, ns, chave) {
    const atual = await loja(ns.StoreName.MAPS).getItem(chave);
    atual.features.points = [...(atual.features.points || []), {
        type: 'Feature', geometry: { type: 'Point', coordinates: [-47.9, -15.8] },
        properties: { id: `ponto-${chave}`, nome: 'Ponto novo', color: '#ff0000', source: 'point' }
    }];
    await loja(ns.StoreName.MAPS).setItem(chave, atual);
    await loja(ns.StoreName.SETTINGS).setItem(`color_usage_${chave}`, { '#ff0000': 1 });
}

describe('o conflito da junção tardia se resolve sozinho', () => {
    it('o pior caso deixou de parar o boot: as alterações da antiga vão para um atlas NOVO', async () => {
        await seed24();
        const { transition, resiliente, ns, loja, destino, origem } = await transicao();
        await novaDesenhaPonto(loja, ns, 'Principal');
        await antigaDesenha(2);
        const destinoAntes = await transition.inventoryScope(destino);
        const origemAntes = await transition.inventoryScope(origem);

        // CONTROLE POSITIVO: a regra continua recusando. Sem isto, "resolveu sozinho" seria
        // satisfeito por um plano que passou a absorver o conflito, que é o contrário da decisão.
        await expect(transition.prepareLegacyTransition()).rejects.toMatchObject({ code: 'legacy_changes' });

        const boot = await resiliente.prepareLegacyTransitionResiliente();

        expect(boot.reparos).toHaveLength(1);
        expect(boot.reparos[0].kind).toBe(resiliente.ReparoAutomatico.ALTERACOES_RECUPERADAS);
        expect(boot.reparos[0].entry.name).toContain('Recuperado');

        // 1. O ATLAS ATUALIZADO NÃO FOI TOCADO, registro a registro.
        expect(await transition.inventoryScope(destino)).toEqual(destinoAntes);
        // 2. NEM A ORIGEM.
        expect(await transition.inventoryScope(origem)).toEqual(origemAntes);
        // 3. E O QUE A VERSÃO ANTIGA DESENHOU ESTÁ NUM SEGUNDO ATLAS DO REGISTRO.
        const entradas = await ns.readLocalAtlasRegistry();
        expect(entradas).toHaveLength(2);
        const recuperado = entradas.find(e => e.id === boot.reparos[0].entry.id);
        const recuperadoPrincipal = await ns.getStoreFor(
            ns.StoreName.MAPS, ns.localScope(recuperado.id, recuperado.dbSuffix)).getItem('Principal');
        expect(recuperadoPrincipal.features.coordination_lines).toHaveLength(2);
    });

    it('depois do resgate o boot seguinte passa direto, sem criar um terceiro atlas', async () => {
        await seed24();
        const { resiliente, ns, loja } = await transicao();
        await novaDesenhaPonto(loja, ns, 'Principal');
        await antigaDesenha(2);
        await resiliente.prepareLegacyTransitionResiliente();

        const segundo = await resiliente.prepareLegacyTransitionResiliente();
        expect(segundo.reparos, 'nada a reparar no segundo boot').toBeUndefined();
        expect(await ns.readLocalAtlasRegistry()).toHaveLength(2);
    });

    it('resgate que NÃO cabe (registro de atlas cheio) devolve o erro ORIGINAL para a tela', async () => {
        await seed24();
        const { resiliente, ns, loja, destino, transition } = await transicao();
        await novaDesenhaPonto(loja, ns, 'Principal');
        await antigaDesenha(2);
        // Dez slots é o teto de `restoreSnapshot`, e é um estado real: quem já tem dez atlas
        // locais não tem onde o resgate pousar.
        const global = ns.getGlobalStore();
        for (let i = (await ns.readLocalAtlasRegistry()).length; i < 10; i++) {
            const id = `aaaaaaaa-0000-4000-8000-00000000000${i}`;
            await global.setItem(ns.localAtlasRegistryKey(id), { id, name: `Atlas ${i}`, dbSuffix: `cheio-${i}`, version: 1 });
        }
        const destinoAntes = await transition.inventoryScope(destino);

        await expect(resiliente.prepareLegacyTransitionResiliente())
            .rejects.toMatchObject({ code: 'legacy_changes' });
        expect(await transition.inventoryScope(destino)).toEqual(destinoAntes);
    });
});

describe('o observador em sessão toma o MESMO reparo', () => {
    /**
     * O portão é um dos DOIS sítios que encontram o conflito; o outro é `watchLegacyChanges`, que
     * roda com a página já aberta quando a versão antiga grava. Enquanto só o portão resolvesse
     * sozinho, a mesma pessoa veria a tela ou o toast conforme a janela em que ela estivesse.
     *
     * O dublê de DOM é o mínimo que `showToast` e a tela tocam; `MutationObserver` fica ausente de
     * propósito, porque o serviço de aviso já declara esse caso e o pula.
     * @returns {{ toasts: string[], body: Object }}
     */
    function montarDom() {
        const toasts = [];
        const el = () => ({
            className: '', textContent: '', style: {}, dataset: {}, children: [],
            classList: { add() {}, remove() {}, contains: () => false },
            setAttribute() {}, getAttribute: () => null, removeAttribute() {},
            appendChild(c) { this.children.push(c); return c; },
            append(...n) { this.children.push(...n); }, remove() {},
            addEventListener() {}, getBoundingClientRect: () => ({ top: 0, height: 0, bottom: 0 })
        });
        const body = el();
        globalThis.document = {
            body, createElement: el, querySelector: () => null, getElementById: () => null,
            addEventListener() {}, removeEventListener() {}
        };
        const ouvintes = new Map();
        globalThis.window = {
            addEventListener: (nome, fn) => ouvintes.set(nome, fn),
            location: { reload() {} }
        };
        globalThis.requestAnimationFrame = () => 0;
        // O aviso é o ÚNICO texto que esta tela produz sem ser a tela: qualquer nó com texto que
        // caia no corpo depois do gesto é ele.
        const antes = body.appendChild.bind(body);
        body.appendChild = (c) => { toasts.push(c); return antes(c); };
        return { toasts, body, ouvintes };
    }

    it('o conflito visto com a página aberta vira toast, e não tela', async () => {
        await seed24();
        const { ns, loja } = await transicao();
        await novaDesenhaPonto(loja, ns, 'Principal');
        await antigaDesenha(2);

        const { toasts, body, ouvintes } = montarDom();
        const ui = await import('@js/ui/migration-recovery.js');
        ui.watchLegacyChanges();
        await ouvintes.get('focus')();

        // 1. NENHUMA TELA: o corpo não recebeu o cartão de recuperação.
        expect(body.children.some(c => c.dataset?.testid === 'migration-recovery')).toBe(false);
        // 2. O AVISO SAIU e nomeia o atlas.
        const texto = toasts.map(t => [t.textContent, ...(t.children || []).flatMap(
            c => [c.textContent, ...(c.children || []).map(n => n.textContent)])].join(' ')).join(' ');
        expect(texto).toContain('Recuperado');
        // 3. E O ATLAS EXISTE no registro, com o que a versão antiga desenhou.
        const entradas = await ns.readLocalAtlasRegistry();
        expect(entradas).toHaveLength(2);
        const recuperado = entradas.find(e => e.name?.includes('Recuperado'));
        const principal = await ns.getStoreFor(
            ns.StoreName.MAPS, ns.localScope(recuperado.id, recuperado.dbSuffix)).getItem('Principal');
        expect(principal.features.coordination_lines).toHaveLength(2);
    });
});

describe('o orçamento de tentativas da cópia', () => {
    /**
     * A cópia é exercida com o degrau REAL em `tests/integration/legacy-transition.test.js`; o que
     * falta medir é o CHAMADOR, e para isso o que importa é quantas vezes ele refaz e em que
     * ordem. Um duplo do degrau torna a interleaving determinística, que é o que a constituição
     * pede para qualquer coisa contada.
     * @param {string[]} falhas - Os códigos que a preparação lança, na ordem, antes de passar.
     * @returns {Promise<Object>} O módulo resiliente e os contadores do duplo.
     */
    async function comDegrauFalso(falhas) {
        const chamadas = { prepare: 0, restart: 0 };
        const restos = [...falhas];
        vi.doMock('@store/migration/legacy-transition.js', () => ({
            prepareLegacyTransition: async () => {
                chamadas.prepare += 1;
                const code = restos.shift();
                if (!code) return { kind: 'ready', state: { status: 'committed' } };
                const erro = new Error(code);
                erro.code = code;
                throw erro;
            },
            restartLegacyCopy: async () => { chamadas.restart += 1; },
            LateResult: {}, absorbLateLegacyChangesNow: async () => ({}), legacyHasChanged: async () => false
        }));
        return { resiliente: await import('@store/migration/transicao-resiliente.js'), chamadas };
    }

    it('uma cópia perturbada é refeita sozinha e o boot passa', async () => {
        const { resiliente, chamadas } = await comDegrauFalso(['source_changed']);
        const boot = await resiliente.prepareLegacyTransitionResiliente();
        expect(chamadas.restart).toBe(1);
        expect(chamadas.prepare).toBe(2);
        expect(boot.reparos.map(r => r.kind)).toEqual([resiliente.ReparoAutomatico.COPIA_REFEITA]);
    });

    it('duas perturbações ainda passam, e a terceira vai para a tela com o erro original', async () => {
        const { resiliente, chamadas } = await comDegrauFalso(['copy_failed', 'source_changed']);
        expect((await resiliente.prepareLegacyTransitionResiliente()).reparos).toHaveLength(2);
        expect(chamadas.restart).toBe(resiliente.MAX_COPIAS_REFEITAS);

        vi.resetModules();
        const terceira = await comDegrauFalso(['copy_failed', 'copy_failed', 'copy_failed']);
        await expect(terceira.resiliente.prepareLegacyTransitionResiliente())
            .rejects.toMatchObject({ code: 'copy_failed' });
        // O TETO É O NÚMERO, e não "até cansar": a terceira falha não gastou uma quarta cópia.
        expect(terceira.chamadas.restart).toBe(terceira.resiliente.MAX_COPIAS_REFEITAS);
        expect(terceira.chamadas.prepare).toBe(terceira.resiliente.MAX_COPIAS_REFEITAS + 1);
    });

    it('código que não tem reparo não gasta tentativa nenhuma', async () => {
        const { resiliente, chamadas } = await comDegrauFalso(['unreadable']);
        await expect(resiliente.prepareLegacyTransitionResiliente())
            .rejects.toMatchObject({ code: 'unreadable' });
        expect(chamadas.restart).toBe(0);
        expect(chamadas.prepare).toBe(1);
    });

    it('reparo que ele mesmo falha devolve a causa ORIGINAL, nunca a do reparo', async () => {
        vi.doMock('@store/migration/legacy-transition.js', () => ({
            prepareLegacyTransition: async () => {
                const erro = new Error('copy_failed');
                erro.code = 'copy_failed';
                throw erro;
            },
            restartLegacyCopy: async () => { throw new Error('coordenação indisponível'); },
            LateResult: {}, absorbLateLegacyChangesNow: async () => ({}), legacyHasChanged: async () => false
        }));
        const resiliente = await import('@store/migration/transicao-resiliente.js');
        await expect(resiliente.prepareLegacyTransitionResiliente())
            .rejects.toMatchObject({ code: 'copy_failed' });
    });
});
