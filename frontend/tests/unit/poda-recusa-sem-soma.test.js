// Path: tests/unit/poda-recusa-sem-soma.test.js
//
// A PRÉ-CONDIÇÃO DA PODA DE SAÍDA: ela se RECUSA a rodar quando há sessão viva e a soma
// de recursos privados nunca aconteceu.
//
// O RISCO QUE ISTO FECHA é de perda de dado, não de vazamento, e é por isso que ele é
// fácil de deixar passar. `refreshVisibleResources` é BEST-EFFORT por desenho: ela engole
// o próprio erro e devolve `false`, porque uma falha ali não pode derrubar o login. Como a
// poda é KEEP-LIST, uma soma que falhou faz TODO recurso privado legítimo cair em
// `unknown` — e a cópia sai sem o acervo a que o usuário tem direito, num caminho
// IRREVERSÍVEL (o arquivo já foi baixado, o slot local já foi criado).
//
// O PISO e a DISCRIMINAÇÃO são o mesmo par de chamadas com uma variável trocada: com soma
// (`_grantedScope()` definido) o resolver nasce e classifica; sem soma e com sessão viva
// ele lança. E o visitante ANÔNIMO continua podendo exportar: sem sessão não há o que
// somar, e o catálogo público é tudo o que ele alcança de qualquer forma.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const estado = {
    escopo: undefined,
    autenticado: true,
    privados: new Set(),
    /** Quantas vezes a re-soma foi tentada, e o que ela faz com o escopo quando roda. */
    tentativas: 0,
    somaQuePousa: false,
};

vi.mock('@js/config.js', () => ({
    default: {
        basemaps: { 'carta-topografica': { name: 'Topográfica' } },
        tilesets: [{ id: 'modelo-publico', name: 'Modelo Público' }],
        dataLayers: { layers: [] },
        analysisLayers: { layers: [] },
    },
}));

vi.mock('@store/sync/resource-access.service.js', () => ({
    _grantedScope: () => estado.escopo,
    isPrivateResource: (grupo, id) => estado.privados.has(id),
    // O DUBLÊ DA TENTATIVA ÚNICA. Ele conta as chamadas e, quando o caso pede, faz a soma
    // POUSAR (escreve o escopo) — que é o que a função real faz no caminho de sucesso.
    retryVisibleResources: async () => {
        estado.tentativas += 1;
        if (estado.somaQuePousa) estado.escopo = null;
        return estado.escopo !== undefined;
    },
}));

vi.mock('@store/sync/session-context.js', () => ({
    sessionContext: { isAuthenticated: () => estado.autenticado },
}));

const carregar = () => import('@catalog/resource-reference.resolver.js');

describe('a poda de saída recusa rodar sem a soma de recursos privados', () => {
    beforeEach(() => {
        estado.escopo = undefined;
        estado.autenticado = true;
        estado.privados = new Set();
        estado.tentativas = 0;
        estado.somaQuePousa = false;
    });

    it('PISO: com soma feita e sessão viva, o resolver nasce e classifica', async () => {
        estado.escopo = null; // somou, sem atlas em foco
        const { construirResolverDeSaida } = await carregar();
        const resolver = await construirResolverDeSaida();

        expect(resolver('tilesets', 'modelo-publico')).toBe('public');
        expect(resolver('tilesets', 'modelo-inexistente')).toBe('unknown');
        // E NÃO TENTA REFAZER O QUE JÁ ESTÁ DE PÉ: a tentativa é do caminho de falha, e uma
        // chamada de rede a cada exportação normal seria custo escondido.
        expect(estado.tentativas).toBe(0);
    });

    it('com soma INDEFINIDA e sessão viva, tenta UMA vez e LANÇA', async () => {
        estado.escopo = undefined;
        estado.somaQuePousa = false;
        const { construirResolverDeSaida, ResourceSumMissingError } = await carregar();

        await expect(construirResolverDeSaida()).rejects.toThrow(ResourceSumMissingError);
        // A mensagem é acionável: ela diz o que fazer, e é ela que o chamador mostra.
        await expect(construirResolverDeSaida()).rejects.toThrow(/Reconecte ao servidor/);
        // UMA por chamada, nunca um laço: duas chamadas, duas tentativas.
        expect(estado.tentativas).toBe(2);
    });

    it('DISCRIMINAÇÃO de F3: logado, soma apagada por `disconnect`, a re-soma POUSA e exporta', async () => {
        // O DEFEITO QUE ESTE CASO FECHA é de disponibilidade, e ele não é hipotético:
        // `disconnect()` chama `clearVisibleResources()` (que zera o escopo) e dispara a
        // re-soma SEM `await`, com `.catch(() => {})`. Entre as duas — ou para sempre, se a
        // rede falhar naquele instante — um usuário CONECTADO clicando em "Exportar" recebia
        // "Reconecte ao servidor", que é um diagnóstico falso. Sem esta metade, o caso de
        // cima passaria verde com a exportação quebrada para quem acabou de sair do atlas.
        estado.escopo = undefined;
        estado.somaQuePousa = true;
        const { construirResolverDeSaida } = await carregar();

        const resolver = await construirResolverDeSaida();
        expect(estado.tentativas).toBe(1);
        expect(resolver('tilesets', 'modelo-publico')).toBe('public');
    });

    it('DISCRIMINAÇÃO: o visitante ANÔNIMO exporta, e o público sobrevive', async () => {
        // Sem sessão não há soma a esperar, e recusar aqui tiraria a exportação de quem o
        // produto atende sem login. Este caso é o que impede a guarda de virar "ninguém pode".
        estado.autenticado = false;
        estado.escopo = undefined;
        const { construirResolverDeSaida } = await carregar();
        const resolver = await construirResolverDeSaida();

        expect(resolver('tilesets', 'modelo-publico')).toBe('public');
        expect(resolver('basemaps', 'carta-topografica')).toBe('public');
        // E NÃO pede re-soma: não há sessão para somar nada.
        expect(estado.tentativas).toBe(0);
    });

    it('depois da soma, o que o servidor marcou como privado responde `private`', async () => {
        estado.escopo = null;
        estado.privados = new Set(['modelo-publico']);
        const { construirResolverDeSaida } = await carregar();
        expect((await construirResolverDeSaida())('tilesets', 'modelo-publico')).toBe('private');
    });

    it('o 360 responde SEMPRE `unknown`: a saída 3 da decisão do dono', async () => {
        // A referência gravada é o nome da foto e não existe mapa local foto -> projeto.
        // Resolver por rede foi recusado (degrada fechado e apagaria 360 público por acidente
        // numa exportação grande) e carregar o projeto junto resolveria só o dado novo.
        estado.escopo = null;
        const { construirResolverDeSaida } = await carregar();
        expect((await construirResolverDeSaida())('views360', 'qualquer-foto.jpg')).toBe('unknown');
    });
});
