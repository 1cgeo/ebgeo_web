// Path: tests/fixtures/censo-superficies/exemplo-nao-classificado.queries.js
//
// FIXTURE DO CONTROLE NEGATIVO de `tests/unit/superficies-de-recurso-censo.test.js`.
//
// Este arquivo NÃO é importado por `src/` e não é alcançado por `git ls-files src`:
// ele existe para que o censo possa ser apontado, num caso do próprio arquivo, a uma
// CONSULTA que toca uma tabela de recurso e não está classificada — e reprovar. Sem
// ele, "o censo pega superfície nova" seria uma afirmação do guarda sobre o guarda, e
// um censo cuja varredura deixasse de casar qualquer coisa (regex quebrada, `git`
// mudando de saída) passaria os outros casos verdes comparando vazio com vazio.
//
// Ele é deliberadamente banal, e sem predicado nenhum: é a forma exata do defeito.

export const SUPERFICIE_SEM_CLASSIFICACAO = `
  SELECT p.id, p.slug, p.name
  FROM sv360.projects p
  WHERE p.status = 'enabled'
`;
