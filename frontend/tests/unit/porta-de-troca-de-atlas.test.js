// Path: tests/unit/porta-de-troca-de-atlas.test.js

/**
 * @fileoverview O QUE A PORTA DE TROCA DE ATLAS DECIDE (`modals/atlas-switch.modal.js`), medido
 * em node puro.
 *
 * O QUE ESTE ARQUIVO PODE E O QUE ELE NAO PODE. O ambiente da suite e node SEM jsdom (ver
 * `vitest.config.js`), entao nada aqui desenha nem clica: o que se afere e a DECISAO e a FRASE.
 * Foi por isso que a decisao saiu do manipulador de clique e virou funcao exportada e pura. Uma
 * regra escrita entre um `createElement` e um `await` nao tem como ser reprovada em node, e uma
 * regra que nao se pode reprovar nao e regra, e habito.
 *
 * A METADE QUE FALTA, dita em voz alta para nao ser lida como cobertura completa: que o clique
 * chega mesmo nesta decisao e que a troca economiza tempo e assunto de
 * `tests/e2e-ui/troca-viva-de-atlas-medida.spec.js`, que exercita o CLIQUE REAL no navegador e
 * cronometra as duas formas de trocar de atlas na mesma bancada.
 *
 * ============================ O DEFEITO QUE ESTE ARQUIVO EXISTE PARA IMPEDIR ==================
 *
 * `switchAtlas` ACHATA TRES DESFECHOS DIFERENTES EM UM SO no ramo remoto. Perder a arbitragem
 * para uma aba irma, ser recusado pela testemunha e CANCELAR o descarte de trabalho resgatado
 * voltam todos como `{ ok: false, changed: false, reason: 'refused' }`, porque `openRemoteAtlas`
 * devolve um booleano. Os tres pedem coisas opostas da porta: no primeiro a sobreposicao do
 * tab-lock esta na tela e a porta TEM de sair da frente; no terceiro a pessoa cancelou de
 * proposito e a porta TEM de ficar. O desempate e `isTabLockBlocked()`, um fato, e os dois casos
 * do GRUPO 3 abaixo sao o que separa esse desenho de um que chuta.
 *
 * O CONTROLE NEGATIVO DE CADA GRUPO, porque afirmar so o caminho feliz nao discrimina nada:
 *
 *   - do silencio: afirmar que a troca bem-sucedida nao produz frase NAO reprova uma porta muda
 *     em tudo. O que reprova essa e o caso do slot local que sumiu, que TEM de falar;
 *   - do fechamento: afirmar que a porta fecha nos desfechos calados nao reprova uma porta que
 *     feche sempre. O que reprova essa e o cancelamento com a aba NAO bloqueada;
 *   - da frase de falha: afirmar que ela cita o nome do atlas nao reprova um texto vazio de
 *     conteudo. O que reprova esse e a asercao de que ela nomeia os TRES fatos do estado (a aba
 *     sem atlas de servidor, o mapa anterior fora da tela, nada apagado).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// O MODULO SOB TESTE ALCANCA A STORE E O MOTOR DE SINCRONISMO pelos imports estaticos dele, que
// e o certo (ele so e carregado por `await import()`, no clique). Aqui nao ha navegador, entao os
// vizinhos pesados viram dubles: o que se mede sao as funcoes puras, e nenhuma delas os toca.
vi.mock('@utils/toast_service.js', () => ({
    showToast: vi.fn(), showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn(),
    showInChannel: vi.fn(),
}));
vi.mock('@store/sync/sync-engine.js', () => ({ syncEngine: { atlasId: null } }));
vi.mock('@store/sync/api-client.js', () => ({ apiClient: { listAtlas: vi.fn(async () => []) } }));
vi.mock('@store/local-atlas.api.js', () => ({
    MAX_LOCAL_ATLASES: 10,
    listLocalAtlases: vi.fn(() => []),
    getCurrentLocalAtlasId: vi.fn(() => null),
}));
vi.mock('@js/projects/atlas-drive.js', () => ({
    LocalAtlasSection: class { mount() {} destroy() {} setAtlases() {} },
}));
vi.mock('@js/account/open-atlas.service.js', () => ({ switchAtlas: vi.fn() }));
vi.mock('@utils/tab-lock.js', () => ({ isTabLockBlocked: vi.fn(() => false) }));

const {
    AtlasSwitchDoor,
    atlasSwitchOutcome,
    atlasSwitchFailureNotice,
    localAtlasGoneNotice,
    atlasSwitchWhenLabel,
    atlasSwitchList,
} = await import('@modals/atlas-switch.modal.js');

/** Atalho: so a porta, que e a metade da decisao que muda a tela. */
const door = (result, contexto) => atlasSwitchOutcome(result, contexto).door;
/** Atalho: so a frase, ou `null`. */
const notice = (result, contexto) => atlasSwitchOutcome(result, contexto).notice;

describe('GRUPO 1: a troca que deu certo, e a que nao precisou acontecer', () => {
    it('fecha a porta quando a aba trocou mesmo de atlas', () => {
        expect(door({ ok: true, changed: true })).toBe(AtlasSwitchDoor.CLOSE);
    });

    it('fecha a porta, e CALADA, quando o destino ja era o atlas montado', () => {
        // O desfecho (a). Um toast de sucesso aqui afirmaria um trabalho que nao houve, e a
        // guarda de no-op de `switchAtlas` existe para NAO recarimbar o `claimedAt` do tab-lock:
        // celebrar um no-op ensinaria a pessoa a clicar de novo, que e justamente o gesto que a
        // mandaria para o fim da fila.
        const saida = atlasSwitchOutcome({ ok: true, changed: false });
        expect(saida.door).toBe(AtlasSwitchDoor.CLOSE);
        expect(saida.notice).toBeNull();
    });

    it('nao fala em NENHUM desfecho bem-sucedido', () => {
        expect(notice({ ok: true, changed: true })).toBeNull();
        expect(notice({ ok: true, changed: false })).toBeNull();
    });
});

describe('GRUPO 2: as recusas que outra camada JA anunciou', () => {
    it('sai da frente quando a aba irma ganhou a arbitragem (ramo local, recusa nomeada)', () => {
        // O desfecho (b). A sobreposicao do tab-lock esta na tela e o "Usar aqui" dela e o caminho
        // adiante; uma porta por cima dela esconderia a unica coisa acionavel que restou.
        const saida = atlasSwitchOutcome({ ok: false, changed: false, reason: 'peer' });
        expect(saida.door).toBe(AtlasSwitchDoor.CLOSE);
        expect(saida.notice).toBeNull();
    });

    it('sai da frente, sem repetir a frase, quando a testemunha recusou', () => {
        // O desfecho (c). `open-atlas.service.js` ja disse `OCCUPIED_MESSAGE`, que nomeia a
        // situacao e garante que nada foi apagado. Repeti-la seria a mesma noticia duas vezes.
        const saida = atlasSwitchOutcome({ ok: false, changed: false, reason: 'witness' });
        expect(saida.door).toBe(AtlasSwitchDoor.CLOSE);
        expect(saida.notice).toBeNull();
    });
});

describe('GRUPO 3: o desempate que o ramo remoto nao entrega', () => {
    /**
     * O QUE `switchAtlas` DEVOLVE NO RAMO REMOTO, para os tres desfechos. Uma constante so, porque
     * a indistinguibilidade e o fato que este grupo mede: se os casos abaixo montassem objetos
     * diferentes, o teste estaria assumindo a informacao que o codigo nao tem.
     */
    const RECUSA_REMOTA = Object.freeze({ ok: false, changed: false, reason: 'refused' });

    it('FICA ABERTA quando a pessoa cancelou o descarte do trabalho resgatado', () => {
        // O desfecho (d), e o unico em que a porta permanece. A aba NAO esta bloqueada: nenhuma
        // irma tomou o atlas, quem recusou foi a pessoa, no dialogo de dois botoes de
        // `confirmDiscardingRescuedWork`. Nada mudou na tela, entao fechar obrigaria a reabrir.
        const saida = atlasSwitchOutcome(RECUSA_REMOTA, { blocked: false });
        expect(saida.door).toBe(AtlasSwitchDoor.STAY);
        expect(saida.notice).toBeNull();
    });

    it('FECHA com o MESMO resultado quando a aba ficou bloqueada', () => {
        // O CONTROLE NEGATIVO DO CASO ACIMA, e o par que prova que o desempate e lido. O objeto
        // e literalmente o mesmo; so o fato do tab-lock muda. Uma porta que ignorasse
        // `isTabLockBlocked()` daria a mesma resposta aos dois, e um dos dois estaria errado.
        const saida = atlasSwitchOutcome(RECUSA_REMOTA, { blocked: true });
        expect(saida.door).toBe(AtlasSwitchDoor.CLOSE);
        expect(saida.notice).toBeNull();
    });

    it('trata a ausencia do contexto como aba NAO bloqueada', () => {
        // O padrao tem de ser o conservador: manter a porta custa um clique a mais, e fecha-la
        // por engano custa a escolha inteira.
        expect(door(RECUSA_REMOTA)).toBe(AtlasSwitchDoor.STAY);
    });
});

describe('GRUPO 4: os desfechos em que a frase e DAQUI', () => {
    it('fala quando o slot local sumiu do registro entre o desenho e o clique', () => {
        const saida = atlasSwitchOutcome(
            { ok: false, changed: false, reason: 'not-found' },
            { atlasName: 'Rascunho de campo' }
        );
        expect(saida.door).toBe(AtlasSwitchDoor.CLOSE);
        expect(saida.notice?.tone).toBe('error');
        expect(saida.notice?.message).toContain('Rascunho de campo');
    });

    it('a frase do slot sumido diz que a LISTA estava velha, nao que o atlas se perdeu', () => {
        // A diferenca nao e de estilo. "Nao existe mais" sem a segunda metade se le como perda de
        // dado; o que houve foi uma lista desatualizada na tela.
        expect(localAtlasGoneNotice('X')).toContain('velha');
    });

    it('a frase da falha de rede nomeia os TRES fatos do estado em que a aba ficou', () => {
        // O desfecho (e), que nao passa por `atlasSwitchOutcome`: `switchAtlas` LANCA, por
        // contrato, e quem produz esta frase e o `catch` da porta. Ela existe porque
        // `openRemoteAtlas` ja desmontou o atlas anterior quando o `connect` falha, e reverte a
        // origem para LOCAL. Um "falha ao abrir" seco deixaria a pessoa olhando um mapa que
        // mudou sozinho.
        const frase = atlasSwitchFailureNotice('Atlas do 1 CGEO');
        expect(frase).toContain('Atlas do 1 CGEO');
        expect(frase).toContain('sem atlas de servidor');
        expect(frase).toContain('atlas local');
        expect(frase).toContain('Nada foi apagado');
    });

    it('a frase da falha continua inteira sem o nome do atlas', () => {
        // O nome vem do cartao clicado e pode faltar (uma lista sem `name`). Uma frase que
        // dependesse dele degradaria para `"undefined"`, que e pior que generica.
        const frase = atlasSwitchFailureNotice('');
        expect(frase).not.toContain('undefined');
        expect(frase).toContain('sem atlas de servidor');
    });
});

describe('GRUPO 5: a lista que a grade de servidor desenha', () => {
    const LISTA = Object.freeze([
        { id: 'a', name: 'Amazonia', updated_at: '2026-08-01T00:00:00Z' },
        { id: 'b', name: 'Sao Gabriel', updated_at: '2026-08-20T00:00:00Z' },
        { id: 'c', name: 'Brasilia', updated_at: '2026-08-10T00:00:00Z' },
    ]);

    it('poe o mais recentemente alterado no alto', () => {
        expect(atlasSwitchList(LISTA).map((a) => a.id)).toEqual(['b', 'c', 'a']);
    });

    it('NAO devolve o array recebido, e nao o reordena no lugar', () => {
        // A grade redesenha a cada tecla digitada na busca. Ordenar o array de origem faria a
        // ordem depender de quantas vezes a pessoa digitou.
        const saida = atlasSwitchList(LISTA);
        expect(saida).not.toBe(LISTA);
        expect(LISTA.map((a) => a.id)).toEqual(['a', 'b', 'c']);
    });

    it('filtra pelo nome ignorando caixa e ACENTO', () => {
        // Quem digita rapido nao acentua. Uma busca que nao achasse "sao gabriel" ensinaria a
        // pessoa a nao usar a busca, que e o mesmo que nao ter busca.
        const comAcento = [{ id: 'z', name: 'São Gabriel da Cachoeira', updated_at: '2026-08-01' }];
        expect(atlasSwitchList(comAcento, { query: 'sao gab' }).map((a) => a.id)).toEqual(['z']);
        expect(atlasSwitchList(comAcento, { query: 'CACHOEIRA' }).map((a) => a.id)).toEqual(['z']);
        expect(atlasSwitchList(comAcento, { query: 'manaus' })).toEqual([]);
    });

    it('aguenta uma lista ausente, nula ou com buracos', () => {
        // `listAtlas()` e rede: um payload fora do contrato nao pode derrubar a porta inteira.
        expect(atlasSwitchList(null)).toEqual([]);
        expect(atlasSwitchList(undefined)).toEqual([]);
        expect(atlasSwitchList([null, undefined])).toEqual([]);
    });
});

describe('GRUPO 6: o relogio do cartao', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-26T12:00:00Z'));
    });
    afterEach(() => vi.useRealTimers());

    it('escreve a distancia em dias para uma data recente', () => {
        expect(atlasSwitchWhenLabel('2026-08-23T12:00:00Z')).toBe('há 3 dias');
    });

    it('cai para a data absoluta depois de um mes', () => {
        // Uma frase relativa deixa de informar quando o numero cresce: "ha 400 dias" nao situa
        // ninguem, e a data situa.
        expect(atlasSwitchWhenLabel('2025-03-04T12:00:00Z')).toBe('04/03/2025');
    });

    it('devolve string VAZIA para o que nao e data, em vez de "Invalid Date"', () => {
        // O controle negativo do cartao: `updated_at` pode faltar, e o cartao tem de ficar sem a
        // linha em vez de escrever lixo nela.
        for (const ruim of [null, undefined, '', 'ontem', {}]) {
            expect(atlasSwitchWhenLabel(ruim)).toBe('');
        }
    });
});
