// Path: src/modules/diag/estados-de-defeito.js
/**
 * @fileoverview O CICLO DE VIDA de um defeito: os quatro estados que `defeitos.estado`
 * aceita.
 *
 * ESTE ARQUIVO É O ESPELHO DO CHECK, e o CHECK é o espelho dele, exatamente como
 * `origens-de-erro.js`. A lista vive duas vezes, aqui e em
 * `018_defeitos_e_ocorrencias.sql`, porque as duas pontas recusam em momentos diferentes e
 * nenhuma substitui a outra: o Joi recusa na borda com 422 nomeando o campo, e o CHECK
 * recusa no banco com 23514 mesmo que a escrita venha por outro caminho (um roteiro, um
 * UPDATE à mão, o CASE do UPSERT). Valor novo entra nos DOIS no mesmo commit; a guarda é
 * `tests/unit/diag-estado-de-defeito.test.js`.
 *
 * ZERO IMPORTS, e isso é contrato pelo mesmo motivo do irmão: o schema de Joi e os testes o
 * carregam, e ele precisa continuar carregável sem `DATABASE_URL` e sem `JWT_SECRET`.
 *
 * A ORDEM É A DO CICLO DE VIDA, não alfabética: onde todo defeito nasce (`aberto`), os dois
 * desfechos que um administrador pode dar (`resolvido`, `ignorado`) e o estado para o qual
 * só a MÁQUINA leva (`regrediu`).
 *
 * ─── OS QUATRO, E O QUE DISTINGUE OS DOIS QUE SE CONFUNDEM ───
 *
 *  - `aberto`     — nasceu e ninguém decidiu nada sobre ele. É o DEFAULT da coluna;
 *  - `resolvido`  — alguém afirmou que consertou, e em qual release (`resolvido_na_release`).
 *                   Só este estado tem transição automática de saída;
 *  - `ignorado`   — alguém afirmou que NÃO vai consertar. Ele é o único estado que NADA
 *                   move, e é isso que o separa de `resolvido`: ignorar significa "eu sei, e
 *                   não quero mais ouvir sobre isto", então uma ocorrência nova voltar a
 *                   acusá-lo desfaria o único ato que existe para calar ruído conhecido
 *                   (o erro de extensão de navegador, o 404 de um robô);
 *  - `regrediu`   — estava `resolvido` e voltou a ocorrer numa release DIFERENTE daquela em
 *                   que foi resolvido. Ver o CASE de `UPSERT_DEFEITO`, que é onde a única
 *                   transição automática do produto está escrita, com o argumento de por que
 *                   ela é por release e não por ordem no tempo.
 */

/** Os quatro valores aceitos, na ordem do CHECK. */
export const ESTADOS_DE_DEFEITO = Object.freeze([
  'aberto',
  'resolvido',
  'ignorado',
  'regrediu',
]);

/**
 * Os mesmos quatro, por nome, para quem ESCREVE um estado em vez de validá-lo.
 *
 * Existe pela razão de sempre nesta casa: string literal espalhada é erro de digitação que
 * o compilador não vê e o CHECK só acusa em produção, dentro do caminho que existe para
 * registrar falhas.
 */
export const EstadoDeDefeito = Object.freeze({
  ABERTO: 'aberto',
  RESOLVIDO: 'resolvido',
  IGNORADO: 'ignorado',
  REGREDIU: 'regrediu',
});

/**
 * Os TRÊS que um administrador pode escrever à mão, DERIVADOS da lista completa.
 *
 * DERIVADOS E NÃO ESCRITOS À MÃO, pelo mesmo argumento de `ORIGENS_DO_CLIENTE`
 * (`origens-de-erro.js`): uma segunda cópia divergiria da primeira no dia em que um estado
 * novo nascesse, e divergiria falhando FECHADO (a borda recusaria um valor que o CHECK
 * aceita), que é o modo de falha silencioso.
 *
 * O QUE FICA DE FORA É `regrediu`, E ISSO É O CONTRATO INTEIRO DESTA CONSTANTE. Ele é o
 * único estado a que só a MÁQUINA leva, pelo CASE de `UPSERT_DEFEITO`, e a razão de proibir
 * a mão não é purismo: `regrediu` significa "voltou a ocorrer numa release DIFERENTE daquela
 * em que foi resolvido", e essa é uma afirmação sobre duas colunas (`resolvido_na_release` e
 * a release da ocorrência que chegou), não uma opinião. Escrito à mão, ele seria um rótulo
 * sem o fato por trás, e a tela passaria a mostrar regressão onde não houve nenhuma, que é
 * exatamente como um campo de ciclo de vida vira decoração e passa a ser ignorado. Quem quer
 * reabrir um defeito usa `aberto`; a regressão é conclusão do produto, nunca do operador.
 */
export const ESTADOS_MANUAIS = Object.freeze(
  ESTADOS_DE_DEFEITO.filter((e) => e !== EstadoDeDefeito.REGREDIU)
);
