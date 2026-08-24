// Path: tests/unit/catalogo-frases-destrutivas.test.js

/**
 * @fileoverview As frases dos atos destrutivos da aba Catálogo.
 *
 * O QUE ESTE VERDE PROVA. Os três atos mais destrutivos da aba eram os que menos falavam:
 * `_deleteResource` e `_delete360` chamavam `showConfirm` SEM `message`, e `ConfirmModal` não
 * desenha corpo nenhum quando a mensagem falta, então a pergunta era só o título; `_toggle360`
 * não perguntava nada, embora `disabled` esconda o projeto de todo mundo fora da OM dona. Os casos
 * abaixo levam asserção ABSOLUTA sobre a PROPRIEDADE de cada frase, e não sobre o texto inteiro:
 * prender a redação faria o próximo teste falhar por vírgula.
 *
 * A ASSIMETRIA É O DESENHO, e é o caso que um teste ingênuo esqueceria: `projectStatusChangeWarning`
 * tem de devolver NULO no sentido aditivo (reativar). Perguntar sempre treina o operador a
 * confirmar sem ler, e é o mesmo argumento que `visibilityChangeWarning` já carrega por medição.
 */

import { describe, it, expect } from 'vitest';
import {
    catalogDeletionWarning,
    projectStatusChangeWarning,
    projectDeletionWarning,
} from '../../src/js/admin/catalog-delete-phrases.js';

describe('catalogDeletionWarning', () => {
    it('nomeia os três efeitos: catálogo, concessões e atlas que já referenciam', () => {
        const frase = catalogDeletionWarning({ nome: 'Ortofoto 2024', id: 'orto-2024' });
        expect(frase).toMatch(/Ortofoto 2024/);
        expect(frase).toMatch(/concess/i);
        expect(frase).toMatch(/atlas/i);
    });

    it('diz "não se desfaz PELA INTERFACE", e não "não se desfaz"', () => {
        // A distinção é verdade, não cortesia: a exclusão é `active = false`, e recriar com o
        // MESMO id cai no ramo de ressurreição de `createCatalogItem`. Dizer que é definitivo
        // seria falso; o que é verdade é que a linha some da listagem e o id se perde com ela.
        const frase = catalogDeletionWarning({ nome: 'X', id: 'x1' });
        expect(frase).toMatch(/interface/i);
        expect(frase).toMatch(/x1/);
    });

    it('sem id, não promete o caminho de volta que depende dele', () => {
        const frase = catalogDeletionWarning({ nome: 'X' });
        expect(frase).toMatch(/interface/i);
        expect(frase).not.toMatch(/mesmo id/i);
    });

    it('sem nome nenhum continua sendo uma frase, e não "Excluir ""', () => {
        const frase = catalogDeletionWarning();
        expect(frase).toMatch(/este item/);
        expect(frase).not.toMatch(/""/);
        expect(frase.length).toBeGreaterThan(40);
    });
});

describe('projectStatusChangeWarning', () => {
    it('pergunta ao DESATIVAR, e nomeia o alcance maior que o da privatização', () => {
        const frase = projectStatusChangeWarning({ nome: 'Museu', para: 'disabled' });
        expect(frase).not.toBeNull();
        expect(frase).toMatch(/Museu/);
        expect(frase).toMatch(/OM dona/);
        // O ponto que o operador confunde: os dois eixos existem e não são o mesmo.
        expect(frase).toMatch(/privado/i);
    });

    it('devolve NULO ao reativar, e em qualquer status que não seja desativar', () => {
        for (const para of ['enabled', 'ativo', '', null, undefined]) {
            expect(projectStatusChangeWarning({ nome: 'Museu', para })).toBeNull();
        }
        expect(projectStatusChangeWarning()).toBeNull();
    });

    it('diz que reativar desfaz, porque desfaz', () => {
        const frase = projectStatusChangeWarning({ nome: 'M', para: 'disabled' });
        expect(frase).toMatch(/reativar desfaz/i);
    });
});

describe('projectDeletionWarning', () => {
    it('usa a contagem de fotos quando ela existe, porque a listagem já a traz', () => {
        const frase = projectDeletionWarning({ nome: 'Museu', fotos: 90 });
        expect(frase).toMatch(/90 fotos/);
        expect(frase).toMatch(/calibra/i);
    });

    it('omite a contagem quando ela não é um número útil, em vez de escrever "0 fotos"', () => {
        for (const fotos of [null, undefined, NaN, 0, -3, 'muitas']) {
            const frase = projectDeletionWarning({ nome: 'Museu', fotos });
            expect(frase, String(fotos)).not.toMatch(/\bfotos dele\b/);
            expect(frase).toMatch(/Museu/);
        }
    });

    it('avisa que reenviar o bundle NÃO devolve o alinhamento', () => {
        // É a informação que decide o clique: o acervo volta, as horas de calibração não.
        const frase = projectDeletionWarning({ nome: 'Museu', fotos: 5 });
        expect(frase).toMatch(/alinhamento/i);
        expect(frase).toMatch(/não se desfaz|nao se desfaz/i);
    });
});
