// Path: tests/unit/prazo-de-acesso-no-cartao.test.js
//
// O PRAZO DO ACESSO CHEGANDO AO CARTÃO DO CATÁLOGO, do payload até o chip.
//
// O DEFEITO QUE ELE FECHA. A frase (`accessExpiryPhrase`), o chip, o estilo e o teste da
// frase já existiam; o que não existia era DADO. `prazoDoAcesso` lia
// `item.originalData.access_expires_at`, e essa leitura nunca poderia dar certo: o payload
// aditivo mantém as colunas fora do item (o cliente despeja os itens nos arrays de `config`)
// e a projeção do 360 é lista explícita de campos, então nenhuma coluna nova atravessa até
// `originalData` em nenhum dos cinco grupos. Ou seja, o chip era código morto e a suíte
// inteira ficava verde: `accessExpiryPhrase(null)` devolve `null`, e nada desenhado é uma
// tela bem-formada.
//
// O QUE ESTE ARQUIVO MEDE, nas duas metades que o defeito tinha:
//
//   1. O ÍNDICE (`resourceAccessExpiry`), irmão de `resourceAccessOrigin`, alimentado pelo
//      mapa `expirations`. Ele carrega a mesma degradação: servidor antigo, valor
//      malformado, id nunca visto e limpeza de sessão caem todos em `null`.
//   2. O SÍTIO. `prazoDoAcesso` (`catalog/components/catalog-card.js`) tem de ler o ÍNDICE, e
//      não `originalData` — a verificação é por TEXTO, como a das irmãs de
//      `concessao-prazo-e-alcance.test.js`, porque o cartão monta DOM e esta suíte roda em
//      `node`. Sem este caso, restaurar a leitura antiga deixaria tudo verde e mudo, que é
//      exatamente o estado de antes.
//
// AUSÊNCIA É O CASO NORMAL, e não uma falha a corrigir: o servidor só carimba prazo para
// quem enxerga o recurso por CONCESSÃO. Papel global, produção e empréstimo por atlas não
// têm prazo a afirmar, e um consumidor que leia `null` como "vale para sempre" está
// inventando o que o cliente não sabe.
//
// CONTROLE NEGATIVO, conferido revertendo de fato: apagar a leitura de `expirations` em
// `indexarPayload` derruba os casos do índice; devolver `prazoDoAcesso` à leitura de
// `originalData` derruba o caso do sítio; apagar a linha de limpeza derruba o caso da sessão.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACOTE = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CARTAO = readFileSync(join(PACOTE, 'src/js/catalog/components/catalog-card.js'), 'utf8');

const h = vi.hoisted(() => ({ voos: [] }));

vi.mock('../../src/js/store/sync/api-client.js', () => ({
    apiClient: {
        getVisibleResources: vi.fn(
            () => new Promise((resolve_) => { h.voos.push({ resolve: resolve_ }); })
        ),
    },
}));

vi.mock('../../src/js/store/sync/atlas-settings.service.js', () => ({
    mergeGrantedIntoBaseline: vi.fn(),
    revertGrantedResources: vi.fn(),
}));

vi.mock('../../src/js/store/sync/session-context.js', () => ({
    sessionContext: {
        userId: 'user-1',
        hasGlobalDataAccess: () => false,
        isAuthenticated: () => true,
    },
}));

const {
    clearVisibleResources,
    isPrivateResource,
    refreshVisibleResources,
    resourceAccessExpiry,
} = await import('../../src/js/store/sync/resource-access.service.js');

const GRUPOS = ['basemaps', 'tilesets', 'dataLayers', 'analysisLayers', 'views360'];
const vazio = () => Object.fromEntries(GRUPOS.map((g) => [g, []]));
const vazioMapa = () => Object.fromEntries(GRUPOS.map((g) => [g, {}]));

/**
 * Um payload aditivo com um tileset privado e, opcionalmente, o prazo dele.
 * @param {string} id @param {*} [prazo] - `undefined` omite `expirations` (servidor antigo).
 */
function payloadCom(id, prazo) {
    const base = { ...vazio(), tilesets: [{ id, name: id }], shareable: vazio() };
    if (prazo === undefined) return base;
    return { ...base, expirations: { ...vazioMapa(), tilesets: { [id]: prazo } } };
}

describe('resourceAccessExpiry: o prazo, e o null que não quebra nada', () => {
    beforeEach(() => {
        h.voos.length = 0;
        clearVisibleResources();
    });

    /** @param {Object} payload */
    async function somar(payload) {
        const voo = refreshVisibleResources('atlas-1');
        h.voos[h.voos.length - 1].resolve(payload);
        await voo;
    }

    it('lê o ISO que o servidor mandou', async () => {
        await somar(payloadCom('priv-3d', '2026-12-01T00:00:00.000Z'));
        expect(resourceAccessExpiry('tilesets', 'priv-3d')).toBe('2026-12-01T00:00:00.000Z');
        // O PISO: sem isto, "leu o prazo" também seria o que se mede se o índice de privados
        // tivesse parado de ser preenchido e a lista chegasse vazia.
        expect(isPrivateResource('tilesets', 'priv-3d')).toBe(true);
    });

    it('servidor antigo (sem `expirations`) devolve null, com o resto do índice intacto', async () => {
        await somar(payloadCom('priv-3d'));
        expect(isPrivateResource('tilesets', 'priv-3d')).toBe(true);
        expect(resourceAccessExpiry('tilesets', 'priv-3d')).toBeNull();
    });

    it('valor malformado NÃO entra cru: vira null, e a frase cai no ramo genérico', async () => {
        // O chip só pode existir se disser um dia certo. Guardar `null`, número ou objeto aqui
        // empurraria a decisão para `accessExpiryPhrase`, que já trata "não sei" e não deveria
        // precisar aprender um segundo vocabulário de lixo.
        for (const lixo of [null, '', 0, 17, { quando: 'amanhã' }, ['2026-01-01']]) {
            await somar(payloadCom('priv-3d', lixo));
            expect(resourceAccessExpiry('tilesets', 'priv-3d'), String(lixo)).toBeNull();
        }
    });

    it('id ausente, grupo inventado e argumentos vazios devolvem null', async () => {
        await somar(payloadCom('priv-3d', '2026-12-01T00:00:00.000Z'));
        expect(resourceAccessExpiry('tilesets', 'nunca-visto')).toBeNull();
        expect(resourceAccessExpiry('grupoInventado', 'priv-3d')).toBeNull();
        expect(resourceAccessExpiry('', 'priv-3d')).toBeNull();
        expect(resourceAccessExpiry('tilesets', null)).toBeNull();
        expect(resourceAccessExpiry('tilesets', undefined)).toBeNull();
    });

    it('id numérico casa com a chave string do payload', async () => {
        await somar({
            ...vazio(),
            tilesets: [{ id: 7 }],
            shareable: vazio(),
            expirations: { ...vazioMapa(), tilesets: { 7: '2026-12-01T00:00:00.000Z' } },
        });
        expect(resourceAccessExpiry('tilesets', 7)).toBe('2026-12-01T00:00:00.000Z');
        expect(resourceAccessExpiry('tilesets', '7')).toBe('2026-12-01T00:00:00.000Z');
    });

    it('a limpeza esvazia o índice de prazo junto com os outros três', async () => {
        await somar(payloadCom('priv-3d', '2026-12-01T00:00:00.000Z'));
        expect(resourceAccessExpiry('tilesets', 'priv-3d')).not.toBeNull();
        clearVisibleResources();
        // Mesma razão dos irmãos: prazo é resposta decidida sob a sessão que acabou, e um chip
        // "expira em" num catálogo anônimo é o vazamento que a limpeza existe para impedir.
        expect(resourceAccessExpiry('tilesets', 'priv-3d')).toBeNull();
    });
});

describe('o SÍTIO: o cartão lê o índice, e não mais `originalData`', () => {
    /** A única linha que contém a âncora, falhando alto quando ela some ou duplica. */
    function linhaUnica(ancora) {
        const casos = CARTAO.split('\n').filter((l) => l.includes(ancora));
        expect(casos.length, `esperada UMA linha com "${ancora}" em catalog-card.js`).toBe(1);
        return casos[0];
    }

    it('`prazoDoAcesso` consulta `resourceAccessExpiry` com o par (grupo, id)', () => {
        expect(linhaUnica('return acesso ? resourceAccessExpiry(')).toContain('acesso.grupo');
        // E o símbolo vem do serviço de acesso, não de um homônimo local.
        expect(linhaUnica('    resourceAccessExpiry,')).toBeTruthy();
        expect(CARTAO).toContain("} from '@store/sync/resource-access.service.js';");
    });

    it('a leitura ANTIGA saiu do código', () => {
        // Ela nunca poderia funcionar: coluna nova não atravessa até `originalData` em grupo
        // nenhum. Deixá-la como fallback seria manter um caminho que a suíte não distingue de
        // "não há prazo", que é como o chip passou a fase inteira sem dado.
        const semComentario = CARTAO.split('\n')
            .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'))
            .join('\n');
        expect(semComentario).not.toContain('access_expires_at');
        expect(semComentario).not.toContain('accessExpiresAt');
    });

    it('controle do matcher: o padrão negado casa com a forma ANTIGA', () => {
        // Sem isto, a negação acima poderia estar procurando um texto que nunca existiu, e
        // passaria verde contra qualquer código.
        const antigo = 'return item?.originalData?.access_expires_at '
            + '?? item?.originalData?.accessExpiresAt ?? null;';
        expect(antigo).toContain('access_expires_at');
        expect(antigo).toContain('accessExpiresAt');
    });

    it('o chip continua gateado por PRIVADO, e o desenho não mudou', () => {
        // O prazo só faz sentido sobre item privado: um chip de vencimento num item público
        // afirmaria que o acervo aberto some um dia.
        expect(linhaUnica('const prazo = privado ?')).toContain('accessExpiryPhrase(prazoDoAcesso(item))');
        expect(CARTAO).toContain("chip.dataset.testid = 'catalog-card-expiry'");
    });
});
