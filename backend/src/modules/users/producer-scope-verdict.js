// Path: modules/users/producer-scope-verdict.js

/**
 * @fileoverview O predicado que decide se uma edicao de usuario DERRUBA concessoes de raiz.
 *
 * ZERO IMPORTS, e e por isso que este arquivo existe separado de `users.service.js`.
 *
 * A DECISAO E ESPELHADA NO CLIENTE (`frontend/src/js/admin/producer-scope-phrases.js`,
 * `verdictOfChange`), que a reimplementa para saber SE deve pedir confirmacao antes do PUT. O
 * espelho nao impoe nada (a imposicao e do servidor, e o toast pos-acao relata os numeros que o
 * servico devolve), mas um espelho que DERIVE volta a deixar o administrador destruindo as
 * concessoes de um produtor com um toast dizendo "usuario atualizado", que e o defeito de
 * 2026-08-23.
 *
 * Ate 2026-08-24 nao havia teste ligando os dois lados, e os dois `@fileoverview` diziam isso por
 * extenso, com o motivo: o espelho e folha e `users.service.js` puxa banco e bcrypt, entao um
 * teste que importasse os dois no mesmo processo arrastaria o servidor inteiro. O motivo era
 * verdadeiro e a conclusao era evitavel: o que precisava ficar leve era o PREDICADO, nao o
 * servico. Extraido daqui, `frontend/tests/unit/escopo-de-producao-espelha-backend.test.js` importa
 * os DOIS e compara, que e o mesmo padrao de `sync-trace-espelha-backend.test.js`.
 *
 * O alcance daquele teste e o VOCABULARIO e a TABELA VERDADE, nunca a semantica: um veredito certo
 * emitido no lugar errado continua passando verde.
 */

/**
 * Os papeis globais que carregam acesso a dado por si mesmos.
 *
 * Exportado para o espelho poder ser comparado com ele em vez de com uma copia escrita no teste.
 * @type {ReadonlySet<string>}
 */
export const PAPEIS_DE_DADO_GLOBAL = new Set(['admin', 'credenciado']);

/**
 * O fundamento de raiz que uma edicao FAZ PERDER, ou null quando nenhum se perde.
 *
 * A ordem dos ramos e contrato, e nao estilo: quem CONTINUA com papel de dado global nao perde
 * nada, entao esse ramo vem primeiro e engole os demais. So depois se pergunta o que havia antes.
 *
 * `is_active` NAO ENTRA: desativar por este PUT e recusado com 409 antes de chegar aqui, e quem
 * desativa (`deleteUser`) tem a poda dele, com origem propria. `organization_id` tambem nao:
 * lotacao e auto-declarada no cadastro e nao autoriza nada.
 *
 * @param {{role: string, producer_org_id?: string|null}} antes - A linha ANTES do UPDATE.
 * @param {{role: string, producer_org_id?: string|null}} depois - A linha GRAVADA.
 * @returns {'acesso_global_de_dado'|'escopo_de_producao'|null}
 */
export function fundamentoDeRaizPerdido(antes, depois) {
  if (PAPEIS_DE_DADO_GLOBAL.has(depois.role)) return null;
  if (PAPEIS_DE_DADO_GLOBAL.has(antes.role)) return 'acesso_global_de_dado';

  const omAntes = antes.producer_org_id ?? null;
  const omDepois = depois.producer_org_id ?? null;
  if (omAntes && omAntes !== omDepois) return 'escopo_de_producao';

  return null;
}
