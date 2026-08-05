// Path: tests/unit/import-ebgeo-name.test.js
//
// "Importar .ebgeo" nomeia o projeto a partir do ARQUIVO, porque o formato não tem campo de nome
// de atlas (ele nomeia mapas, e é anterior aos atlas de servidor). O nome é a única coisa que o
// usuário vê antes de abrir o projeto importado, então vale fixar os casos que produzem lixo:
// nome vazio, caminho completo do input de arquivo, e extensão em maiúscula.

import { describe, it, expect } from 'vitest';
import { atlasNameFromFilename } from '@js/projects/import-ebgeo.service.js';

describe('atlasNameFromFilename', () => {
    it('tira a extensão .ebgeo', () => {
        expect(atlasNameFromFilename('Operação Alfa.ebgeo')).toBe('Operação Alfa');
    });

    it('aceita extensão em maiúscula/misturada', () => {
        expect(atlasNameFromFilename('Plano.EBGEO')).toBe('Plano');
        expect(atlasNameFromFilename('Plano.EbGeo')).toBe('Plano');
    });

    it('usa só o nome do arquivo quando vem caminho junto', () => {
        // Alguns browsers/plataformas entregam `C:\fakepath\arquivo.ebgeo` em input[type=file].
        expect(atlasNameFromFilename('C:\\fakepath\\Missao 3.ebgeo')).toBe('Missao 3');
        expect(atlasNameFromFilename('/home/user/docs/Missao 3.ebgeo')).toBe('Missao 3');
    });

    it('preserva pontos internos do nome', () => {
        expect(atlasNameFromFilename('op.2026.final.ebgeo')).toBe('op.2026.final');
    });

    it('mantém nome sem extensão nenhuma', () => {
        expect(atlasNameFromFilename('sem-extensao')).toBe('sem-extensao');
    });

    it('cai num rótulo genérico em vez de nome vazio', () => {
        // Um atlas com nome '' seria invisível na lista de projetos — e o backend recusa
        // string vazia em `name` (Joi.string() rejeita '' por default), então isto também
        // é o que impede um 422 no meio do import.
        for (const entrada of ['', '   ', '.ebgeo', null, undefined]) {
            expect(atlasNameFromFilename(entrada), `entrada ${JSON.stringify(entrada)}`)
                .toBe('Projeto importado');
        }
    });
});
