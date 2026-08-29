// Path: tests/unit/link-publico-aviso-de-exposicao.test.js
//
// O AVISO QUE O DONO VÊ AO PUBLICAR O LINK, e ele é o cumprimento da cláusula 6.6.
//
// A 6.3 diz que o empréstimo do atlas alcança o visitante de link público, e ela foi
// REEXAMINADA e MANTIDA em 2026-08-29: restringi-la a quem tem conta não protegeria nada,
// porque o auto-cadastro é aberto. O que faltava não era o predicado, era o
// CONSENTIMENTO, e é isso que estas frases entregam.
//
// O QUE ESTE ARQUIVO PRENDE, e cada bloco é uma decisão que se perderia numa reescrita:
//
//   - o aviso NOMEIA em vez de contar. "3 recursos privados" não permite decidir nada;
//   - ele NÃO APARECE quando não há privado emprestado, senão vira ruído e ninguém o lê;
//   - `access_level` NULO não conta como privado. Nulo é o empréstimo ÓRFÃO (a linha de
//     catálogo sumiu), que não expõe byte nenhum porque não há recurso para servir.

import { describe, it, expect } from 'vitest';
import {
    avisoDeExposicao,
    recursosPrivados,
    nomeDoRecurso,
    LIMITE_DE_NOMES,
} from '../../src/js/modals/link-publico-phrases.js';

const privado = (name, resource_id = 't-x') => ({ name, resource_id, access_level: 'private' });
const publico = (name, resource_id = 't-y') => ({ name, resource_id, access_level: 'public' });
const orfao = (resource_id = 't-orfao') => ({ name: null, resource_id, access_level: null });

describe('quais empréstimos entram no aviso', () => {
    it('só os privados', () => {
        const lista = [privado('Áreas de treinamento'), publico('Hidrografia'), privado('Pistas')];
        expect(recursosPrivados(lista).map((r) => r.name)).toEqual(['Áreas de treinamento', 'Pistas']);
    });

    it('o ÓRFÃO não conta como privado', () => {
        // `access_level` nulo é a linha de catálogo que sumiu. Contá-la encheria o aviso
        // de fantasmas e treinaria o dono a ignorá-lo, que é o oposto do que a 6.6 quer.
        expect(recursosPrivados([orfao(), orfao('outro')])).toEqual([]);
    });

    it('entrada inválida não derruba nem inventa', () => {
        for (const lixo of [null, undefined, 'texto', 42, {}]) {
            expect(recursosPrivados(lixo)).toEqual([]);
        }
        expect(recursosPrivados([null, undefined, privado('Vale')])).toHaveLength(1);
    });
});

describe('o nome de cada item', () => {
    it('usa o nome quando ele existe', () => {
        expect(nomeDoRecurso(privado('Áreas de treinamento'))).toBe('Áreas de treinamento');
    });

    it('cai no id quando o nome não veio, porque o dono precisa saber QUAL desfazer', () => {
        expect(nomeDoRecurso({ name: null, resource_id: 't-areas' })).toBe('t-areas');
        expect(nomeDoRecurso({ name: '   ', resource_id: 't-areas' })).toBe('t-areas');
    });

    it('sem nome e sem id, ainda devolve texto legível', () => {
        expect(nomeDoRecurso({})).toBe('recurso sem nome');
        expect(nomeDoRecurso(null)).toBe('recurso sem nome');
    });
});

describe('o aviso', () => {
    it('NÃO existe quando o atlas não empresta nada privado', () => {
        // Aviso que aparece sempre é aviso que ninguém lê.
        expect(avisoDeExposicao([])).toBeNull();
        expect(avisoDeExposicao([publico('Hidrografia'), orfao()])).toBeNull();
        expect(avisoDeExposicao(null)).toBeNull();
    });

    it('NOMEIA os itens, em vez de contá-los', () => {
        const aviso = avisoDeExposicao([privado('Áreas de treinamento'), privado('Pistas de pouso')]);
        expect(aviso.nomes).toEqual(['Áreas de treinamento', 'Pistas de pouso']);
        expect(aviso.restantes).toBe(0);
    });

    it('o título concorda em número', () => {
        expect(avisoDeExposicao([privado('Uma')]).titulo).toContain('1 item privado');
        expect(avisoDeExposicao([privado('Uma'), privado('Duas')]).titulo).toContain('2 itens privados');
    });

    it('acima do teto, nomeia os primeiros e diz quantos sobram', () => {
        // Um atlas pode emprestar dezenas; sem teto o aviso vira um parágrafo que ninguém
        // lê, que é o mesmo efeito de não avisar.
        const muitos = Array.from({ length: LIMITE_DE_NOMES + 3 }, (_, i) => privado(`Camada ${i + 1}`));
        const aviso = avisoDeExposicao(muitos);
        expect(aviso.nomes).toHaveLength(LIMITE_DE_NOMES);
        expect(aviso.restantes).toBe(3);
        expect(aviso.titulo).toContain(`${LIMITE_DE_NOMES + 3} itens privados`);
    });

    it('o corpo diz a CONSEQUÊNCIA e a saída, não o mecanismo', () => {
        // Quem lê precisa saber o que acontece (veem sem entrar) e o que fazer a respeito
        // (tirar do atlas, ou não publicar). "Empréstimo" e "predicado" não ajudam ninguém.
        const { corpo } = avisoDeExposicao([privado('Áreas')]);
        expect(corpo).toContain('sem precisar entrar');
        expect(corpo).toMatch(/remova|não publique/i);
    });
});
