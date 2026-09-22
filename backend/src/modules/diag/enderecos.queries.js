// Path: src/modules/diag/enderecos.queries.js
/**
 * @fileoverview O SQL do relatório de endereços distintos: só a leitura dos NOMES das contas.
 *
 * O endereço, a contagem e as abas vêm do log em arquivo (`src/utils/diag-enderecos.js`), e o
 * banco entra apenas para trocar um UUID por um nome legível. É por isso que este arquivo tem uma
 * consulta só, e que a falha dela não derruba o relatório: ver `nomearContas`.
 *
 * ZERO IMPORTS, como `defeitos.queries.js`: é texto, e trazê-lo não arrasta o pool.
 */

/**
 * As contas pelos ids, com o estado de vida delas.
 *
 * `is_active` VIAJA porque uma conta desativada que aparece num endereço é informação para quem
 * monitora (quem ainda estava usando a sessão antes do corte), e escondê-la seria apagar o fato.
 * Conta que NÃO volta daqui foi excluída de verdade; o serviço a conta à parte em vez de inventar
 * um nome.
 */
export const SELECT_CONTAS_POR_ID = `
  SELECT id, username, nome, is_active
    FROM users
   WHERE id = ANY($1::uuid[])
`;
