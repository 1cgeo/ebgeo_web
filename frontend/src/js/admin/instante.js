// Path: js/admin/instante.js

/**
 * @fileoverview A leitura de um INSTANTE vindo do servidor, compartilhada pelas abas do painel.
 *
 * POR QUE ESTE ARQUIVO EXISTE. As abas Diagnóstico e Uso nasceram no mesmo dia, em frentes
 * separadas, e as duas escreveram esta função — BYTE A BYTE IGUAL, conferido antes de extrair.
 * Ela é o tipo de peça que diverge: são quatro ramos de parsing (Date, número, string de
 * dígitos, string de data) mais duas guardas de inválido, e quem consertar um caso numa das
 * cópias não tem como saber que a outra existe. Este repositório já pagou por cópia que
 * divergiu (os cinco arquivos de navegação do 360 e o carregador de tiles têm seções inteiras
 * de regra sobre isso), e o preço é sempre o mesmo: as duas telas passam a discordar sobre o
 * mesmo dado, com as duas suítes verdes.
 *
 * O QUE **NÃO** FOI EXTRAÍDO JUNTO, e a distinção é o ponto. As outras funções que parecem
 * gêmeas nas duas abas NÃO são iguais: `contagemLabel` (Diagnóstico) e `numeroLabel` (Uso)
 * validam por caminhos diferentes, e `horaLocal` (data e hora, para correlacionar com o log de
 * um servidor) e `dataLocal` (só data, porque uma série diária não tem hora) respondem a
 * perguntas diferentes. Fundir função PARECIDA é como se cria defeito enquanto se acredita
 * estar removendo duplicação; só o que é idêntico por construção sobe para cá.
 *
 * ELE É FOLHA, DE PROPÓSITO: zero imports. As duas abas o consomem de dentro de módulos que
 * também são folhas, e é isso que mantém `admin.html` bootando sem arrastar a store.
 */

/**
 * Converte o que o servidor mandou num `Date`, ou `null`.
 *
 * `null` em vez de lançar, e `null` em vez de `new Date(NaN)`: quem chama está formatando
 * texto para uma tela, e um instante ilegível tem de virar travessão, nunca "Invalid Date"
 * escrito na cara do operador nem uma exceção que derruba a aba inteira por causa de um campo.
 *
 * A string de dígitos é tratada ANTES da string de data porque `new Date('1788119395550')` não
 * é o epoch: o construtor a lê como texto de data e devolve inválido. Um servidor que serialize
 * o epoch como string (JSON de `BIGINT` faz isso em várias bibliotecas) cairia nesse buraco.
 *
 * @param {*} valor - Epoch ms (número ou string), string de data, ou `Date`.
 * @returns {Date|null}
 */
export function instanteDe(valor) {
    let d = null;
    if (valor instanceof Date) {
        d = valor;
    } else if (typeof valor === 'number') {
        d = Number.isFinite(valor) ? new Date(valor) : null;
    } else if (typeof valor === 'string') {
        const texto = valor.trim();
        if (texto) d = /^-?\d+$/.test(texto) ? new Date(Number(texto)) : new Date(texto);
    }
    if (!d || Number.isNaN(d.getTime())) return null;
    return d;
}
