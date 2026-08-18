// Path: tests/unit/busca-360-escopo.test.js
//
// O EMPRESTADO NÃO SOBREVIVE À SAÍDA DO ATLAS, MEDIDO NA BUSCA (fase F9, item 7).
//
// O invariante do servidor é que um recurso privado emprestado por um atlas só é
// entregue ENQUANTO aquele atlas está em foco: o braço de empréstimo do predicado
// exige o `atlasId`, e sem ele o projeto simplesmente não existe para o chamador.
// No cliente esse invariante morria num cache de módulo: `fetchProjects()` guardava a
// lista, e a barra de busca a relia por `getCachedProjects()` depois que o usuário já
// tinha saído do atlas. O servidor recusaria; ninguém perguntava de novo.
//
// POR QUE ESTE ARQUIVO E NÃO `cache-projetos-escopo.test.js`. Aquele mede o DONO do
// cache (o carimbo, o miss, a corrida em voo). Este mede a SUPERFÍCIE — a função que a
// tela chama — e mede-a porque ela tem um `try/catch` que devolve `[]` em qualquer
// falha. Contra um catch assim, "o emprestado não apareceu" é o resultado tanto do
// acerto quanto de um erro engolido, e um teste que só olhasse a ausência ficaria
// verde com a busca inteira quebrada. Por isso TODO caso negativo aqui vem com o
// público junto: a lista precisa continuar respondendo, sem o item que saiu de escopo.
//
// A DIREÇÃO DA FALHA TAMBÉM É MEDIDA (último caso): quando a repergunta falha, o certo
// é a busca ficar vazia, nunca reexibir a lista do escopo anterior.

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/js/config.js', () => ({
    default: { streetView360: { serviceUrl: 'http://backend.test/api/v1/sv360' } },
}));

vi.mock('../../src/js/store/sync/api-client.js', () => ({
    apiClient: {
        getVisibleResources: vi.fn(async () => ({
            basemaps: [], tilesets: [], dataLayers: [], analysisLayers: [], views360: [],
        })),
    },
}));

vi.mock('../../src/js/store/sync/atlas-settings.service.js', () => ({
    mergeGrantedIntoBaseline: vi.fn(),
    revertGrantedResources: vi.fn(),
}));

// PARCIAL, e precisa ser: a barra de busca importa o store, e o barrel do sync lê
// `PermissionAction` deste módulo no load. Substituir o arquivo inteiro derruba a
// importação antes de qualquer caso rodar. Só o singleton é trocado, por um usuário
// fixo — o eixo que este arquivo move é o ATLAS, e a identidade tem de ficar parada
// para que a mudança medida seja uma só.
vi.mock('../../src/js/store/sync/session-context.js', async (importOriginal) => ({
    ...(await importOriginal()),
    sessionContext: { userId: 'u-1', hasGlobalDataAccess: () => false },
}));

const { searchStreetViewMarkers } = await import('../../src/js/search/search-bar.search-providers.js');
const { refreshVisibleResources, clearVisibleResources } = await import('../../src/js/store/sync/resource-access.service.js');
const { getCachedProjects } = await import('../../src/js/street_view_tool/streetview-api.service.js');

const PUBLICO = { id: 'pub', name: 'Panorama Público', center: { lon: -50, lat: -29 } };
const EMPRESTADO_A = { id: 'emp-a', name: 'Panorama Emprestado pelo Alfa', center: { lon: -51, lat: -30 } };
const EMPRESTADO_B = { id: 'emp-b', name: 'Panorama Emprestado pelo Bravo', center: { lon: -52, lat: -31 } };

/** O que o servidor responderia em cada escopo, indexado pelo atlas em foco. */
const ACERVO = {
    'atlas-alfa': [PUBLICO, EMPRESTADO_A],
    'atlas-bravo': [PUBLICO, EMPRESTADO_B],
    null: [PUBLICO],
};

let chamadas = 0;
let falhar = false;

/**
 * Um `fetch` que responde como o servidor responderia: o acervo do escopo QUE ESTÁ EM
 * FOCO no instante da chamada. Um cache que atravessa escopo não é pego por um stub que
 * devolve sempre a mesma coisa — ele precisa poder devolver coisas diferentes.
 */
function stubFetch(atlasEmFoco) {
    globalThis.fetch = vi.fn(async () => {
        chamadas += 1;
        if (falhar) return { ok: false, status: 403, json: async () => ({}) };
        return { ok: true, json: async () => ACERVO[atlasEmFoco ?? 'null'] };
    });
}

/** Entra num escopo: declara-o (como o login e a abertura de atlas fazem) e reaponta o servidor. */
async function entrarEm(atlasId) {
    stubFetch(atlasId);
    await refreshVisibleResources(atlasId);
}

/** Os nomes que a busca por "panorama" devolve agora. */
const buscar = async () => (await searchStreetViewMarkers('panorama')).map((r) => r.name);

describe('a busca por panorama não atravessa escopo de acesso', () => {
    beforeEach(async () => {
        chamadas = 0;
        falhar = false;
        clearVisibleResources();
        stubFetch(null);
        getCachedProjects(); // adota o escopo anônimo e zera o cache do módulo
        chamadas = 0;
    });

    it('piso: dentro do atlas que empresta, a busca ACHA o panorama emprestado', async () => {
        // Sem este caso, tudo abaixo seria satisfeito por uma busca que nunca acha nada.
        await entrarEm('atlas-alfa');
        const nomes = await buscar();
        expect(nomes).toContain(EMPRESTADO_A.name);
        expect(nomes).toContain(PUBLICO.name);
        // E o resultado carrega o que a tela usa para voar até lá.
        const [primeiro] = await searchStreetViewMarkers('emprestado pelo alfa');
        expect(primeiro).toMatchObject({ type: 'streetview-marker', markerId: 'emp-a' });
        expect(primeiro.coordinates).toEqual([-51, -30]);
    });

    it('SAIR do atlas tira o emprestado da busca, e o público continua lá', async () => {
        await entrarEm('atlas-alfa');
        expect(await buscar()).toContain(EMPRESTADO_A.name);

        await entrarEm(null);

        const nomes = await buscar();
        expect(nomes, 'o emprestado sobreviveu à saída do atlas').not.toContain(EMPRESTADO_A.name);
        // A DISCRIMINAÇÃO: lista vazia também não conteria o emprestado. A busca tem de
        // continuar funcionando — o que saiu foi um item, não a superfície.
        expect(nomes).toEqual([PUBLICO.name]);
    });

    it('e ela REPERGUNTOU ao servidor, em vez de devolver o cache podado', async () => {
        // O que separa "o cliente esqueceu a lista" de "o cliente filtrou a lista que já
        // tinha". Só o primeiro é seguro: o cliente não sabe o que o servidor decidiria.
        await entrarEm('atlas-alfa');
        await buscar();
        const depoisDoAquecimento = chamadas;
        expect(depoisDoAquecimento).toBe(1);

        await buscar();
        expect(chamadas, 'dentro do mesmo escopo o cache serve').toBe(depoisDoAquecimento);

        await entrarEm(null);
        await buscar();
        expect(chamadas, 'a troca de escopo obriga uma requisição nova').toBe(depoisDoAquecimento + 1);
    });

    it('TROCAR de atlas troca o empréstimo: some o do anterior, entra o do novo', async () => {
        // O caso que "sair do atlas" sozinho não cobre: aqui o escopo novo também
        // empresta, então um cache que atravessasse escopo mostraria os DOIS — e isso é
        // o vazamento na sua forma mais visível.
        await entrarEm('atlas-alfa');
        expect(await buscar()).toContain(EMPRESTADO_A.name);

        await entrarEm('atlas-bravo');

        const nomes = await buscar();
        expect(nomes).toContain(EMPRESTADO_B.name);
        expect(nomes).not.toContain(EMPRESTADO_A.name);
        expect(nomes).toHaveLength(2);
    });

    it('o LOGOUT também tira o emprestado, sem que atlas nenhum tenha mudado', async () => {
        // `clearVisibleResources` é o caminho do logout e da desconexão. O atlas em foco
        // é o MESMO nos dois lados desta linha: o que mudou foi quem pergunta.
        await entrarEm('atlas-alfa');
        expect(await buscar()).toContain(EMPRESTADO_A.name);

        stubFetch(null); // deslogado, o servidor responde só o acervo público
        clearVisibleResources();

        expect(await buscar()).toEqual([PUBLICO.name]);
    });

    it('se a repergunta FALHA, a busca fica vazia — e não repõe a lista do escopo anterior', async () => {
        // A direção da falha importa: `searchStreetViewMarkers` engole a exceção e devolve
        // `[]`. Fechado é o certo. O que este caso proíbe é o outro desfecho, o de um
        // `fetchProjects` que, ao falhar, preservasse o cache anterior como "melhor que
        // nada" — aí a falha de rede viraria o vazamento.
        await entrarEm('atlas-alfa');
        expect(await buscar()).toContain(EMPRESTADO_A.name);

        stubFetch(null); // o servidor do escopo novo, que é quem vai falhar e depois voltar
        falhar = true;
        await refreshVisibleResources(null);

        expect(await buscar()).toEqual([]);
        expect(getCachedProjects(), 'o cache não pode ter sobrado do escopo anterior').toBeNull();

        // E quando o servidor volta, a busca volta com o acervo do escopo CORRENTE.
        falhar = false;
        expect(await buscar()).toEqual([PUBLICO.name]);
    });
});
