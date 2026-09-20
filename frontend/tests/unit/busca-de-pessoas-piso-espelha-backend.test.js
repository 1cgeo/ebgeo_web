// Path: tests/unit/busca-de-pessoas-piso-espelha-backend.test.js

/**
 * @fileoverview O PISO E O TETO DA BUSCA DE PESSOAS SÃO NÚMEROS DE DOIS PACOTES, e quem MANDA é
 * o servidor: `GET /users/search` responde 422 abaixo do piso e corta no teto (decisão D13,
 * 2026-09-14). O cliente carrega a própria cópia para não gastar uma requisição já sabidamente
 * recusada, e para escrever a frase que diz quantos caracteres faltam.
 *
 * O MODO DE FALHA É MUDO NOS DOIS SENTIDOS, e é por isso que o espelho precisa de guarda. Se o
 * servidor SOBE o piso e o cliente não, o campo passa a gastar um 422 por tecla e a tela mostra
 * a frase de falha de busca para quem só digitou pouco: um erro que se lê como servidor fora do
 * ar. Se o CLIENTE sobe e o servidor não, a busca legítima de três letras deixa de sair, e a
 * pessoa lê "digite ao menos quatro caracteres" sobre uma rota que aceitaria três. Nenhum dos
 * dois produz vermelho em lugar nenhum.
 *
 * A COMPARAÇÃO É POR TEXTO, e não por import, e isso é deliberado: o arquivo do servidor importa
 * Joi, que não é dependência deste pacote, então `import` cruzado (a forma de
 * `marcador-estrutural-espelha-backend.test.js`) derrubaria a suíte por resolução de módulo em
 * vez de por divergência. O que se lê é a DECLARAÇÃO da constante, que é onde o número mora.
 *
 * ALCANCE: aqui está o NÚMERO. Que o servidor de fato recuse dois caracteres com 422 é
 * `backend/tests/integration/busca-de-pessoas-nao-enumera.test.js`; que o campo espere antes de
 * chamar é leitura das cinco telas que consomem `PEOPLE_SEARCH_MIN_CHARS`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
    PEOPLE_SEARCH_MIN_CHARS,
    PEOPLE_SEARCH_MAX_ROWS,
    peopleSearchHint,
    peopleSearchTruncatedNotice,
} from '../../src/js/catalog/grant-tree.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SCHEMAS_DO_SERVIDOR = resolve(AQUI, '../../../backend/src/modules/users/users.schemas.js');
/** O SQL da busca. A frase promete o que o `WHERE` de `SEARCH_USERS` de fato casa. */
const QUERIES_DO_SERVIDOR = resolve(AQUI, '../../../backend/src/modules/users/users.queries.js');

/**
 * O valor de uma constante numérica exportada, lido do TEXTO do arquivo do servidor.
 * @param {string} fonte @param {string} nome
 * @returns {number|null}
 */
function constanteDeclarada(fonte, nome) {
    const achado = new RegExp(`export const ${nome} = (\\d+);`).exec(fonte);
    return achado ? Number(achado[1]) : null;
}

describe('o piso da busca de pessoas espelha o do backend', () => {
    const fonte = readFileSync(SCHEMAS_DO_SERVIDOR, 'utf8');

    // PISO CONTRA COMPARAÇÃO VAZIA. Sem ele, um arquivo movido ou uma constante renomeada faria
    // os dois lados valerem `null` e a igualdade abaixo passaria verde comparando nada com nada.
    it('as duas constantes do servidor foram mesmo encontradas', () => {
        expect(fonte.length).toBeGreaterThan(0);
        expect(constanteDeclarada(fonte, 'USER_SEARCH_MIN_TERM')).not.toBeNull();
        expect(constanteDeclarada(fonte, 'USER_SEARCH_MAX_ROWS')).not.toBeNull();
    });

    // ABSOLUTO, e não só comparativo: mudar os dois lados juntos mantém o par consistente e
    // derruba este caso, que é o ponto, porque o número também é decisão registrada (D13).
    it('o piso é TRÊS dos dois lados, e o teto é VINTE', () => {
        expect(PEOPLE_SEARCH_MIN_CHARS).toBe(3);
        expect(PEOPLE_SEARCH_MAX_ROWS).toBe(20);
        expect(constanteDeclarada(fonte, 'USER_SEARCH_MIN_TERM')).toBe(3);
        expect(constanteDeclarada(fonte, 'USER_SEARCH_MAX_ROWS')).toBe(20);
    });

    it('e os dois lados são iguais entre si', () => {
        expect(PEOPLE_SEARCH_MIN_CHARS).toBe(constanteDeclarada(fonte, 'USER_SEARCH_MIN_TERM'));
        expect(PEOPLE_SEARCH_MAX_ROWS).toBe(constanteDeclarada(fonte, 'USER_SEARCH_MAX_ROWS'));
    });

    // AS FRASES CARREGAM OS NÚMEROS, então elas são a superfície em que uma mudança de piso
    // chega à pessoa. Derivá-las da constante é o que impede o texto de envelhecer sozinho.
    it('as duas frases citam os números que as constantes declaram', () => {
        expect(peopleSearchHint()).toContain(String(PEOPLE_SEARCH_MIN_CHARS));
        expect(peopleSearchTruncatedNotice()).toContain(String(PEOPLE_SEARCH_MAX_ROWS));
    });

    // A DICA PRECISA DIZER O QUE A BUSCA CASA, e isso é consequência direta de D13: posto e OM
    // saíram do casamento, então uma frase que só peça "mais caracteres" deixaria a pessoa
    // insistindo no nome da OM, que é justamente o termo que deixou de funcionar.
    it('a dica nomeia nome e usuário, que é o que a busca passou a casar', () => {
        const dica = peopleSearchHint().toLowerCase();
        expect(dica).toContain('nome');
        expect(dica).toContain('usuário');
        expect(dica).not.toContain('posto');
    });

    // O NOME DE GUERRA ENTROU NO CASAMENTO EM 2026-09-20 (`SEARCH_USERS`), e as telas passaram
    // a ESCREVÊ-LO ("Cap Silva"). As duas frases enumeram o que a busca casa, então são elas
    // que chegam à pessoa: uma que oferecesse só "nome ou usuário" mandaria quem está lendo
    // "Cap Silva" desconfiar do termo certo e concluir que o colega não tem conta.
    //
    // A NEGATIVA DE `posto` E `om` CONTINUA VALENDO NAS DUAS, e é o que impede esta correção
    // de reabrir o P8 que D13 fechou: nome de guerra é atributo INDIVIDUAL, posto e OM são
    // COLETIVOS, e casar por coletivo é enumeração com outro nome.
    it('as duas frases nomeiam o NOME DE GUERRA, e nenhuma promete posto ou OM', () => {
        for (const frase of [peopleSearchHint(), peopleSearchTruncatedNotice()]) {
            const texto = frase.toLowerCase();
            expect(texto, frase).toContain('nome de guerra');
            expect(texto, frase).toContain('usuário');
            expect(texto, frase).not.toContain('posto');
            expect(texto, frase).not.toContain('organização');
        }
    });

    // DISCRIMINAÇÃO ESTRUTURAL: a frase promete o que o SERVIDOR casa, e o servidor casa em
    // três ramos de `SEARCH_USERS`. Sem este caso, tirar `nome_guerra` do `WHERE` de lá
    // deixaria as duas frases prometendo o que a busca já não entrega, sem nada ficar
    // vermelho — é a mesma assimetria que D13 pagou na direção oposta.
    it('e o `WHERE` do servidor de fato casa os TRÊS campos que elas prometem', () => {
        const sql = readFileSync(QUERIES_DO_SERVIDOR, 'utf8');
        const inicio = sql.indexOf('export const SEARCH_USERS');
        // PISO CONTRA COMPARAÇÃO VAZIA, como o caso do topo deste arquivo: um `indexOf` que
        // devolvesse -1 faria as três asserções abaixo varrerem o arquivo inteiro e passarem
        // por acidente.
        expect(inicio, 'SEARCH_USERS precisa existir no arquivo de queries').toBeGreaterThan(0);
        const corpo = sql.slice(inicio, sql.indexOf('`;', inicio));
        expect(corpo).toContain('LOWER(u.nome_guerra) LIKE LOWER($1)');
        expect(corpo).toContain('LOWER(u.nome) LIKE LOWER($1)');
        expect(corpo).toContain('LOWER(u.username) LIKE LOWER($1)');
    });
});
