// Path: src/modules/diag/enderecos.service.js
/**
 * @fileoverview Os NOMES das contas do relatório de endereços distintos: a metade de BANCO.
 *
 * O relatório é de ARQUIVO (`src/utils/diag-enderecos.js`, pelo `.jsonl` que o `request-logger`
 * escreve), e o banco entra só para trocar o UUID de cada conta por login e nome. As duas metades
 * caem por motivos sem relação, e a regra é a do `resumo`: com o Postgres fora, a lista de
 * endereços continua respondendo inteira e o bloco `contas` DIZ que não conseguiu os nomes
 * (`disponivel: false` e um `motivo`), em vez de desenhar os ids como se fossem o nome ou de
 * derrubar a resposta. Nenhuma contagem sai ao lado de `disponivel: false`.
 *
 * AS DUAS PORTAS CHAMAM ESTA FUNÇÃO, e nenhuma escreve SQL próprio: a rota
 * (`GET /api/v1/diag/enderecos`, no controller) e o comando (`npm run diag -- enderecos`, que
 * injeta um leitor que abre o pool silenciando o logger antes, como os outros comandos de banco).
 *
 * O QUE ESTE ARQUIVO NÃO IMPORTA NO TOPO: o pool. Ele entra por `import()` tardio dentro do leitor
 * padrão, pela mesma razão de `resumo.service.js`: `scripts/diag.js` importa este arquivo
 * estaticamente, e um import do pool aqui faria os comandos de log passarem a exigir
 * `DATABASE_URL`, que é a única propriedade que os justifica.
 */

import { SELECT_CONTAS_POR_ID } from './enderecos.queries.js';

/**
 * O teto do texto de erro do banco que viaja no `motivo`. O mesmo 300 de `resumo.service.js`, e
 * pela mesma razão: texto de origem externa (o driver) entrando num payload de tela.
 */
const MAX_MOTIVO = 300;

/** UUID estrito: o cast `::uuid[]` levantaria 22P02 com qualquer outra forma. */
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * O leitor padrão: o pool da aplicação, carregado tarde.
 * @param {string[]} ids
 * @returns {Promise<Array<{id: string, username: string, nome: string, is_active: boolean}>>}
 */
export async function lerContasDoBanco(ids) {
  const { any } = await import('../../database/index.js');
  return any(SELECT_CONTAS_POR_ID, [ids]);
}

/**
 * O bloco cego, com a mensagem do driver aparada.
 *
 * `String(err?.message ?? err)` E NÃO `err.message`, pela lição que `resumo.service.js` já pagou:
 * nem tudo que se lança é `Error`, e "o banco não respondeu (undefined)" não informa nada no lugar
 * onde a informação mais importa. A mensagem distingue Postgres fora de `DATABASE_URL` ausente, que
 * pedem providências opostas, e é lida por um administrador atrás de `requireAdmin`.
 * @param {*} err
 * @returns {{disponivel: false, motivo: string}}
 */
export function contasCegas(err) {
  return {
    disponivel: false,
    motivo: `o banco não respondeu (${String(err?.message ?? err).slice(0, MAX_MOTIVO)})`,
  };
}

/**
 * Nomeia as contas citadas pelo relatório, sem nunca lançar.
 *
 * SEM CONTA NENHUMA, NÃO HÁ IDA AO BANCO, e o bloco é `disponivel: true` com zero pedidas: não
 * havia nada a nomear, então a afirmação é verdadeira mesmo com o Postgres fora, e fica
 * distinguível do caso cego pelo `pedidas`.
 *
 * CONTA QUE NÃO VOLTA é contada em `naoEncontradas` e NÃO entra em `porId`: a tela a mostra pelo
 * identificador e diz que ela não existe mais, em vez de inventar um nome.
 *
 * @param {string[]} ids - de `idsDeContas`
 * @param {{lerContas?: (ids: string[]) => Promise<Array<Object>>}} [opcoes] - injetável para teste
 *   e para o comando, que abre o pool do jeito dele
 * @returns {Promise<Object>}
 */
export async function nomearContas(ids, { lerContas = lerContasDoBanco } = {}) {
  const unicos = [...new Set((ids ?? []).filter((id) => typeof id === 'string' && RE_UUID.test(id)))];
  if (unicos.length === 0) {
    return { disponivel: true, pedidas: 0, achadas: 0, naoEncontradas: 0, porId: {} };
  }
  let linhas;
  try {
    linhas = await lerContas(unicos);
  } catch (err) {
    return contasCegas(err);
  }
  const porId = {};
  for (const l of Array.isArray(linhas) ? linhas : []) {
    if (!l || typeof l.id !== 'string') continue;
    porId[l.id] = {
      username: typeof l.username === 'string' ? l.username : null,
      nome: typeof l.nome === 'string' && l.nome.trim() ? l.nome : null,
      ativo: l.is_active !== false,
    };
  }
  const achadas = Object.keys(porId).length;
  return {
    disponivel: true,
    pedidas: unicos.length,
    achadas,
    naoEncontradas: unicos.length - achadas,
    porId,
  };
}
