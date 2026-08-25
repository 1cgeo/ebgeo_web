// Path: tests/unit/camada-ativa-existe.repro.test.js

/**
 * @fileoverview A CAMADA ATIVA NOMEIA UMA CAMADA QUE EXISTE, medido em 2026-08-25.
 *
 * O DEFEITO, relatado pelo chefe assim: "ao subir um atlas as feições não aparecem no mapa, mas
 * aparecem na lista de feições nas camadas". As duas metades da frase estavam certas, e é isso que
 * torna o sintoma enganoso.
 *
 * A CADEIA, medida no banco de desenvolvimento e no navegador:
 *   1. a queda da camada ativa era o literal `'default'`, que é o id da camada padrão LOCAL
 *      (`getDefaultLayer`);
 *   2. num atlas de SERVIDOR toda camada tem UUID, cunhado pelo import, e o snapshot não traz a
 *      chave `activeLayer_`, então a queda entrava em ação em todo mapa de servidor;
 *   3. cada feição desenhada dali em diante nascia com `layerId: 'default'`, apontando para uma
 *      camada que não existe;
 *   4. o filtro do mapa cobra `coalesce(layerId, 'default')` DENTRO da lista de ids reais, então a
 *      feição órfã sumia da tela; a aba de feições lê a store, que não filtra, e continuava
 *      listando-a.
 *
 * A PROVA DE FORA: no atlas `Meu Atlas 123` do banco de desenvolvimento havia três pontos com
 * `layer_id` NULO e `properties.layerId = 'default'`, ao lado de uma linha que viera pelo import
 * com o UUID certo e desenhava normalmente. Uma feição visível e três invisíveis, no mesmo mapa.
 *
 * SÃO DOIS GETTERS E OS DOIS ERRAVAM IGUAL: o assíncrono
 * (`LocalRepository.getActiveLayerId`, preso em `tests/integration/repository-contract.test.js`) e
 * o SÍNCRONO daqui, que é o que a criação de feição usa. Consertar um só deixaria o defeito de pé
 * por baixo, e é por isso que este arquivo existe além daquele.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createLayerManager } from '../../src/js/layers/layer.manager.js';
import { memoryStore } from '../../src/js/store/memory-store.js';

const UUID_DA_PADRAO = '68ea95b9-c54b-41a3-897a-9687906ee1e7';

/** Semeia o cache em memória como o boot de um mapa o deixaria. */
function semear(mapa, camadas, ativa) {
    memoryStore.currentMap = mapa;
    memoryStore.layers = memoryStore.layers || {};
    memoryStore.layers[mapa] = new Map(camadas.map((l) => [l.id, l]));
    memoryStore.activeLayerId = ativa;
}

describe('a camada ativa síncrona nomeia uma camada que existe', () => {
    let gerente;

    beforeEach(() => {
        gerente = createLayerManager({ emit() {}, on() {}, off() {} });
    });

    it('ATLAS DE SERVIDOR: sem ativa em memória, cai na primeira camada REAL', () => {
        // O caso do chefe. Antes daqui saía `'default'`, e toda feição nova nascia órfã.
        semear('Principal', [{ id: UUID_DA_PADRAO, name: 'Padrão', order: 0 }], null);
        expect(gerente.getActiveLayerIdSync()).toBe(UUID_DA_PADRAO);
    });

    it('uma ativa que não nomeia camada nenhuma também cai na primeira REAL', () => {
        // O mesmo órfão pelo outro caminho: a camada ativa foi apagada, ou veio do atlas anterior.
        // Conferir só a AUSÊNCIA do valor deixaria este passar.
        semear('Principal', [{ id: UUID_DA_PADRAO, name: 'Padrão', order: 0 }], 'default');
        expect(gerente.getActiveLayerIdSync()).toBe(UUID_DA_PADRAO);
    });

    it('respeita a ordem: a PRIMEIRA é a de menor `order`, não a de inserção', () => {
        semear('Principal', [
            { id: 'uuid-b', name: 'B', order: 5 },
            { id: 'uuid-a', name: 'A', order: 1 },
        ], null);
        expect(gerente.getActiveLayerIdSync()).toBe('uuid-a');
    });

    it('CONTROLE: uma ativa que EXISTE é preservada, e o conserto não a atropela', () => {
        // Sem este controle, "cai na primeira" passaria verde numa implementação que IGNORASSE a
        // escolha da pessoa e devolvesse sempre a primeira camada.
        semear('Principal', [
            { id: 'uuid-a', name: 'A', order: 1 },
            { id: 'uuid-b', name: 'B', order: 5 },
        ], 'uuid-b');
        expect(gerente.getActiveLayerIdSync()).toBe('uuid-b');
    });

    it('CONTROLE: no atlas local a queda continua sendo "default"', () => {
        // O caminho local não pode mudar. A camada padrão sintetizada tem o id `'default'`, então
        // "a primeira que existe" e o literal antigo são a MESMA resposta, por construção.
        semear('Principal', [{ id: 'default', name: 'Padrão', order: 0 }], null);
        expect(gerente.getActiveLayerIdSync()).toBe('default');
    });

    it('BORDA: sem mapa e sem camada nenhuma, responde "default" e NÃO lança', () => {
        // Este getter é chamado antes de haver mapa, no boot. Lançar aqui trocaria um defeito
        // visual por uma tela morta.
        memoryStore.currentMap = null;
        memoryStore.layers = {};
        memoryStore.activeLayerId = null;
        expect(() => gerente.getActiveLayerIdSync()).not.toThrow();
        expect(gerente.getActiveLayerIdSync()).toBe('default');
    });
});
