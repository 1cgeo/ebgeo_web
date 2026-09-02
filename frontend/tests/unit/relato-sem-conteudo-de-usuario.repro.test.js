// Path: tests/unit/relato-sem-conteudo-de-usuario.repro.test.js

import { describe, it, expect } from 'vitest';
import {
    formaDeValor,
    montarCorpo,
    textoDeErro,
} from '@js/session/erro-telemetria-assinatura.js';

// REPRO: A TELEMETRIA DE ERRO SERIALIZAVA DADO DO USUÁRIO.
//
// A CAUSA RAIZ. `textoDeErro`, no ramo do valor que não é `Error`, fazia
// `JSON.stringify(valor).slice(0, TETOS.mensagem)`. A intenção era boa e está registrada no
// próprio código: o objeto rejeitado quase sempre é um corpo de resposta, e `{"status":500}` é
// muito mais útil que `[object Object]`. O que ela não previu é o que de fato circula rejeitado
// num GIS: feição, camada, `FeatureCollection`. Um `Promise.reject(feature)` — ou um
// `throw` com o objeto de trabalho — mandava para o servidor o `nome` escrito pela pessoa, a
// `descricao` dela e as COORDENADAS DECIMAIS da posição, quinhentos caracteres por vez. E
// telemetria é justamente o tipo de dado que acaba num log, num relatório e num anexo de e-mail:
// nenhum dos três é lugar de posição de tropa.
//
// A CORREÇÃO: descrever a FORMA (tipo, chaves de topo ordenadas, e o valor de no máximo três
// chaves de um vocabulário fechado), nunca o conteúdo.
//
// CONTROLE NEGATIVO, CONFERIDO REVERTENDO EM 2026-09-01: repondo o
// `JSON.stringify(valor).slice(0, TETOS.mensagem)` no lugar da chamada a `formaDeValor`, ficam
// VERMELHOS exatamente QUATRO casos deste arquivo (os que atravessam `textoDeErro`), e a mensagem
// de falha mostra as coordenadas decimais e o nome da feição dentro do corpo do POST. Os TRÊS
// restantes seguem verdes nos dois estados, e isso é parte do controle: o que chama `formaDeValor`
// direto não depende da fiação, e os dois últimos afirmam o que CONTINUA viajando, que é o que
// impede a correção de degenerar em "apagar tudo".

/** Uma `FeatureCollection` como as que o produto manipula, com nome e coordenadas de verdade. */
function colecaoDeFeicoes() {
    return {
        type: 'FeatureCollection',
        features: [
            {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-43.9876543, -22.1234567] },
                properties: {
                    nome: 'Posto de Comando do Cel Fulano',
                    descricao: 'Deslocamento previsto para 0600',
                    visivel: true,
                },
            },
        ],
    };
}

/** Tudo o que NÃO pode aparecer em lugar nenhum do corpo. */
const SEGREDOS = [
    'Fulano',
    'Posto de Comando',
    'Deslocamento previsto',
    '-43.9876543',
    '-22.1234567',
    '43.98',
    '22.12',
];

describe('repro: nenhum conteúdo de usuário chega ao corpo do relato', () => {
    it('a `FeatureCollection` vira FORMA, e nada dela vaza', () => {
        const { mensagem } = textoDeErro(colecaoDeFeicoes());
        expect(mensagem).toBe('Object{features,type}');
        for (const segredo of SEGREDOS) expect(mensagem).not.toContain(segredo);
    });

    it('nenhum NÚMERO DECIMAL sobrevive à travessia', () => {
        const { mensagem } = textoDeErro(colecaoDeFeicoes());
        expect(mensagem).not.toMatch(/-?\d+\.\d+/);
    });

    it('o CORPO INTEIRO do POST está limpo, e não só a mensagem', () => {
        // O corpo é o que de fato viaja: assinatura, mensagem e pilha saem todos do mesmo valor.
        const colecao = colecaoDeFeicoes();
        const { mensagem, stack } = textoDeErro(colecao);
        const corpo = montarCorpo({
            mensagem,
            stack,
            stackBruta: stack,
            url: 'http://local/index.html?atlas=abc',
            pagina: 'mapa',
        });
        const inteiro = JSON.stringify(corpo);
        for (const segredo of SEGREDOS) expect(inteiro).not.toContain(segredo);
        expect(inteiro).not.toMatch(/-?\d+\.\d{4,}/);
    });

    it('a FEIÇÃO solta (o caso mais comum de `Promise.reject`) também só entrega a forma', () => {
        const feicao = colecaoDeFeicoes().features[0];
        const { mensagem } = textoDeErro(feicao);
        expect(mensagem).toBe('Object{geometry,properties,type}');
        for (const segredo of SEGREDOS) expect(mensagem).not.toContain(segredo);
    });

    it('o array de coordenadas cru não entrega número nenhum', () => {
        expect(formaDeValor([-43.9876543, -22.1234567])).toBe('Array{0,1}');
    });

    it('o que CONTINUA viajando é o que diagnostica: as chaves e os três campos de protocolo', () => {
        // Sem isto a correção seria "apagar tudo", e o campo deixaria de servir para o que existe.
        expect(formaDeValor({ status: 403, code: 'FORBIDDEN', detalhe: 'x' }))
            .toBe('Object{code,detalhe,status} code=FORBIDDEN status=403');
        expect(textoDeErro(colecaoDeFeicoes()).mensagem).toContain('features');
    });

    it('a mensagem de um `Error` de verdade continua INTEIRA (o ramo não foi tocado)', () => {
        // A poda é só do ramo do objeto que NÃO é `Error`. Um `Error` tem mensagem escrita por
        // programador, e ela é o campo mais útil do relato.
        const erro = new Error('Cannot read properties of undefined (reading nome)');
        expect(textoDeErro(erro).mensagem)
            .toBe('Error: Cannot read properties of undefined (reading nome)');
    });
});
