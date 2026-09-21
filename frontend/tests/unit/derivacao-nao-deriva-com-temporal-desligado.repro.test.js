// Path: tests/unit/derivacao-nao-deriva-com-temporal-desligado.repro.test.js

/**
 * @fileoverview COM O TEMPORAL DESLIGADO, MARCAR "DIRECAO AUTOMATICA" NUM SIMBOLO ASSAVA NA
 * IMAGEM UMA SETA CALCULADA COM O CURSOR VELHO (achado E9, metade da derivacao).
 *
 * A CAUSA, e ela tem duas pernas que so juntas produzem o defeito:
 *
 *  1. `reapplyFeature` (o caminho que roda quando uma amarracao automatica e ligada ou desligada
 *     no painel) repintava a imagem canonica e, em seguida, chamava `_refreshEnabled()`. Esse
 *     portao pergunta apenas se ALGUMA feicao carrega `autoDirection`/`autoSpeed` — e ela carrega,
 *     porque a pessoa acabou de marcar a caixa. O portao reabria com o temporal desligado.
 *  2. O cursor do controlador NAO volta a nao numerico no ramo desligado (ao contrario do que o
 *     comentario do controlador promete), entao `Number.isFinite(cursor)` continuava verdadeiro,
 *     com o instante da ULTIMA vez em que a linha do tempo esteve ligada.
 *
 * Resultado: um simbolo com a seta de direcao de movimento assada na imagem, derivada de um
 * instante que nao esta na tela e que a pessoa nao tem como ver nem corrigir.
 *
 * O CONSERTO e uma pergunta so, e ela tem de vir ANTES de `_refreshEnabled`: com o temporal
 * desligado, `reapplyFeature` para depois do repintar CANONICO, que e o desfecho certo (a imagem
 * volta a ser a que as propriedades descrevem).
 *
 * O QUE ESTE ARQUIVO NAO ALCANCA, declarado: o caminho de reproducao (`_onCursor`), que ja era
 * gateado pelo evento de desligar, e a geracao do PNG em si.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const estado = {
    temporalLigado: false,
    cursor: NaN,
    controles: {},
};

vi.mock('../../src/js/store', () => ({
    getControl: (nome) => estado.controles[nome],
    registerControl: () => {},
    isMapTemporalEnabledSync: () => estado.temporalLigado,
}));

vi.mock('@utils', () => ({
    loadImageToMap: async () => {},
}));

vi.mock('../../src/js/utilities/event-cleanup.js', () => ({
    setupCleanup: () => {},
    subscribe: () => {},
    cleanup: () => {},
}));

const { TemporalDerivationService } = await import('../../src/js/temporal/temporal-derivation.service.js');

const T0 = 1_700_000_000_000;

/** Um simbolo militar com trajetoria e direcao automatica marcada. */
function simbolo() {
    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [0, 0] },
        properties: {
            id: 'sim-1',
            autoDirection: true,
            trajetoria: [
                { t: T0, lng: 0, lat: 0 },
                { t: T0 + 1000, lng: 1, lat: 0 }, // rumo leste: 90 graus
            ],
        },
    };
}

/** Mapa de mentira com a fonte de simbolos militares. */
function montar() {
    const feature = simbolo();
    const geradas = [];
    const gen = {
        generateSymbolBlob: async (props) => {
            geradas.push(props);
            return { blob: {} };
        },
    };
    estado.controles = {
        AddMilitarySymbolControl: { symbolGenerator: gen },
        TemporalControl: { getCursor: () => estado.cursor },
    };
    const map = {
        getSource: (id) => (id === 'military_symbols'
            ? { getData: async () => ({ type: 'FeatureCollection', features: [feature] }) }
            : null),
    };
    const service = new TemporalDerivationService({ map, eventBus: { on() {}, off() {} } });
    return { service, geradas };
}

describe('TemporalDerivationService.reapplyFeature', () => {
    beforeEach(() => {
        estado.temporalLigado = false;
        // O cursor NAO volta a NaN ao desligar: e' exatamente essa a segunda perna do defeito.
        estado.cursor = T0 + 500;
    });

    it('REGRESSAO: com o temporal DESLIGADO, repinta o canonico e NAO deriva', async () => {
        const { service, geradas } = montar();

        await service.reapplyFeature('sim-1');

        // Uma unica geracao, e ela e a CANONICA: nenhuma direcao assada por cima.
        expect(geradas).toHaveLength(1);
        expect(geradas[0].direction).toBeUndefined();
        // E o portao continua fechado, em vez de reaberto pela presenca de `autoDirection`.
        expect(service._enabled).toBe(false);
    });

    it('CONTROLE: com o temporal LIGADO, deriva a direcao do segmento no cursor', async () => {
        estado.temporalLigado = true;
        const { service, geradas } = montar();

        await service.reapplyFeature('sim-1');

        // Sem este caso, o teste acima passaria com uma derivacao que nunca funciona.
        expect(geradas).toHaveLength(2);
        expect(geradas[1].direction).toBe('90');
        expect(service._enabled).toBe(true);
    });

    it('BORDA: temporal ligado mas sem cursor numerico tambem nao deriva', async () => {
        estado.temporalLigado = true;
        estado.cursor = NaN;
        const { service, geradas } = montar();

        await service.reapplyFeature('sim-1');

        expect(geradas).toHaveLength(1);
        expect(geradas[0].direction).toBeUndefined();
    });

    it('BORDA: id ausente ou desconhecido nao gera imagem nenhuma', async () => {
        estado.temporalLigado = true;
        const { service, geradas } = montar();

        await service.reapplyFeature('');
        await service.reapplyFeature('nao-existe');

        expect(geradas).toHaveLength(0);
    });
});
