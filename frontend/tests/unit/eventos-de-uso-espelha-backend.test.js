// Path: tests/unit/eventos-de-uso-espelha-backend.test.js

/**
 * @fileoverview O vocabulário de uso do produto vive em DOIS módulos folha, um por pacote
 * (`frontend/src/js/session/eventos-de-uso.js` e `backend/src/modules/uso/eventos-de-uso.js`), e
 * o do backend é de onde saem o Joi de `POST /uso/eventos` e os CHECKs das colunas. Um valor
 * acrescentado no cliente e não no servidor recusa o LOTE INTEIRO com 422 — e o lote é um corpo
 * com N contagens, então um evento inventado apaga também a contagem de todos os outros daquele
 * intervalo. É esse modo de falha que este arquivo torna vermelho no build em vez de silencioso
 * em produção.
 *
 * MESMA FORMA DE `origens-de-erro-espelha-backend.test.js`: piso contra comparação vazia, lista
 * absoluta, e só então a comparação dos dois lados. ALCANCE: VOCABULÁRIO, e nada mais. Que o
 * servidor de fato recuse uma `prop` fora da lista é assunto do teste do Joi, do outro lado.
 *
 * O `EventoDeUso` É DELIBERADAMENTE SÓ DO CLIENTE, e por isso ele não é comparado com nada: o
 * backend nunca EMITE um evento de uso, ele só valida o que chega, e um enum de constantes
 * nomeadas lá seria uma segunda lista sem beneficiário. O que o mantém honesto é a asserção de
 * que os valores dele são, EXATAMENTE e NA MESMA ORDEM, os treze de `EVENTOS_DE_USO` — que é a
 * lista de fato espelhada. Sem essa asserção, a constante nomeada seria a terceira cópia do
 * vocabulário, e a única sem guarda.
 *
 * CONTROLE NEGATIVO conferido revertendo: trocar dois valores de lugar em qualquer um dos dois
 * arquivos derruba o caso da ordem; acrescentar um evento só de um lado derruba o caso da lista;
 * e trocar `Object.freeze([])` por `null` numa entrada de `PROPS_PERMITIDAS` derruba o caso das
 * props, que é o que separa "este evento não aceita qualificador" de "o qualificador é livre".
 */

import { describe, it, expect } from 'vitest';
import {
    EventoDeUso,
    EVENTOS_DE_USO,
    PAGINAS,
    PROPS_PERMITIDAS,
} from '../../src/js/session/eventos-de-uso.js';
import {
    EVENTOS_DE_USO as BACKEND_EVENTOS_DE_USO,
    PAGINAS as BACKEND_PAGINAS,
    PROPS_PERMITIDAS as BACKEND_PROPS_PERMITIDAS,
} from '../../../backend/src/modules/uso/eventos-de-uso.js';

const ESPERADOS = [
    'pagina.vista',
    'atlas.aberto',
    'ferramenta.ativada',
    'medicao.aberta',
    'visualizador3d.aberto',
    'visualizador360.aberto',
    'primeira-pessoa.aberto',
    'briefing.apresentado',
    'temporal.ativado',
    'pdf.exportado',
    'ebgeo.exportado',
    'ebgeo.importado',
    'indisponivel.visto',
];

const PAGINAS_ESPERADAS = ['mapa', 'atlas', 'admin', 'calibracao'];

describe('o vocabulário de uso do backend espelha o do frontend', () => {
    it('os dois módulos foram de fato carregados (piso contra comparação vazia)', () => {
        expect(EVENTOS_DE_USO.length).toBeGreaterThan(5);
        expect(BACKEND_EVENTOS_DE_USO.length).toBeGreaterThan(5);
        expect(Object.keys(PROPS_PERMITIDAS).length).toBe(EVENTOS_DE_USO.length);
        expect(Object.keys(BACKEND_PROPS_PERMITIDAS).length).toBe(BACKEND_EVENTOS_DE_USO.length);
    });

    it('os treze eventos são exatamente os esperados, dos DOIS lados e na mesma ordem', () => {
        expect([...EVENTOS_DE_USO]).toEqual(ESPERADOS);
        expect([...BACKEND_EVENTOS_DE_USO]).toEqual(ESPERADOS);
    });

    it('as quatro páginas são as mesmas, na mesma ordem', () => {
        expect([...PAGINAS]).toEqual(PAGINAS_ESPERADAS);
        expect([...BACKEND_PAGINAS]).toEqual(PAGINAS_ESPERADAS);
    });

    it('a tabela de qualificadores é idêntica, entrada por entrada', () => {
        // COMPARAÇÃO ENTRADA A ENTRADA, e não `toEqual` do objeto inteiro, porque a mensagem de
        // falha do `toEqual` sobre treze chaves não diz qual delas divergiu — e a divergência que
        // este caso existe para pegar (uma lista virar `null`, ou o contrário) é de UMA chave.
        expect(Object.keys(PROPS_PERMITIDAS).sort())
            .toEqual(Object.keys(BACKEND_PROPS_PERMITIDAS).sort());
        for (const evento of ESPERADOS) {
            const aqui = PROPS_PERMITIDAS[evento];
            const la = BACKEND_PROPS_PERMITIDAS[evento];
            // `null` é o estado LIVRE e `[]` é o estado "não aceita qualificador": os dois são
            // falsy, então comparar por veracidade passaria verde com os dois trocados.
            expect(aqui === null, `${evento}: só um dos lados é livre`).toBe(la === null);
            if (aqui !== null) expect([...aqui], evento).toEqual([...la]);
        }
    });

    it('as três listas dos dois lados são congeladas', () => {
        expect(Object.isFrozen(EVENTOS_DE_USO)).toBe(true);
        expect(Object.isFrozen(PROPS_PERMITIDAS)).toBe(true);
        expect(Object.isFrozen(PAGINAS)).toBe(true);
        expect(Object.isFrozen(BACKEND_EVENTOS_DE_USO)).toBe(true);
        expect(Object.isFrozen(BACKEND_PROPS_PERMITIDAS)).toBe(true);
        expect(Object.isFrozen(BACKEND_PAGINAS)).toBe(true);
    });

    it('`EventoDeUso` é a MESMA lista, na mesma ordem, com chaves UPPER_SNAKE', () => {
        // Ver o `fileoverview`: ele é só do cliente, então o que o prende é a derivação e não um
        // espelho. Sem isto, a constante nomeada seria a terceira cópia do vocabulário.
        expect(Object.values(EventoDeUso)).toEqual(ESPERADOS);
        expect(Object.isFrozen(EventoDeUso)).toBe(true);
        for (const chave of Object.keys(EventoDeUso)) {
            expect(chave, `${chave} não é UPPER_SNAKE`).toMatch(/^[A-Z][A-Z0-9_]*$/);
        }
    });
});
