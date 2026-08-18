// Path: src/utils/cache-scope.js
// O ESCOPO DE CACHE de uma resposta que variou por chamador.
//
// Nasceu dentro de `sv360.controller.js` na fase F9 e saiu de lá porque a mesma
// pergunta apareceu em mais duas superfícies (as quatro listagens de catálogo e o
// payload aditivo de `/resource-access/visible`). Uma terceira cópia da regra é
// exatamente o que este arquivo existe para não haver: o dia em que "escopado" ganhar
// um terceiro eixo, ele precisa ganhar num lugar só.
//
// O QUE UM CABEÇALHO AUSENTE AUTORIZA, que é a razão de o arquivo existir: sem
// `Cache-Control`, o RFC 9111 permite a um cache COMPARTILHADO aplicar heurística e
// guardar a resposta. Era aceitável enquanto o corpo era o mesmo para todo mundo, e
// deixou de ser quando ele passou a variar por papel global, por escopo de produção,
// por concessão e por empréstimo de atlas.
//
// A ISENÇÃO DO RFC PARA `Authorization` NÃO SEGURA ISTO. Ela só alcança requisição que
// CARREGA aquele cabeçalho, e `flexibleAuth` é global e lê também o cookie `token`:
// uma requisição autenticada por cookie chega sem `Authorization` nenhum e cai fora da
// isenção. Daí o `Vary` citar os dois.

/**
 * A resposta dependeu de QUEM pediu?
 *
 * Duas fontes, e a segunda é a que não se adivinha. `req.user` sempre valeu: o corpo
 * embute papel e escopo de produção, então marcá-lo `public` autorizaria um cache
 * compartilhado a repor a resposta de um membro para um anônimo. `req.atlasId` é o
 * atlas em foco DEPOIS de `requireAtlasScopeWhenPresent` tê-lo confirmado, e ele
 * alcança o caso que `req.user` sozinho NÃO alcança: um atlas `is_public` dá `read` a
 * chamador ANÔNIMO, então, com o empréstimo ligado, uma resposta anônima pode carregar
 * recurso privado emprestado. Sem este segundo termo, essa resposta sairia `public` e o
 * empréstimo vazaria pelo cache.
 *
 * A propriedade que isto preserva, e que vale escrever por extenso: RESPOSTA QUE
 * DEPENDEU DE EMPRÉSTIMO NUNCA É PUBLICAMENTE CACHEÁVEL. O teste conservador (todo
 * atlas em foco fecha o cache, mesmo quando o empréstimo não acrescentou nada) é
 * deliberado: o alternativo exigiria o SQL devolver "esta linha veio do braço de
 * empréstimo", uma segunda definição do predicado dentro da consulta que ele mesmo é.
 *
 * @param {import('express').Request} req
 * @returns {boolean}
 */
export function respostaEscopada(req) {
  return Boolean(req.user) || Boolean(req.atlasId);
}

/**
 * Rotas JSON: `private, no-cache` quando a resposta dependeu de quem pediu.
 *
 * `no-cache` (e não `no-store`) de propósito: o navegador continua guardando e
 * REVALIDANDO pelo ETag fraco que o Express deriva do CORPO, que já incorpora o
 * conjunto de visibilidade por construção. Resposta pública continua sem cabeçalho,
 * como sempre esteve.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export function marcarEscopoJson(req, res) {
  if (!respostaEscopada(req)) return;
  res.setHeader('Cache-Control', 'private, no-cache');
  res.setHeader('Vary', 'Authorization, Cookie');
}
