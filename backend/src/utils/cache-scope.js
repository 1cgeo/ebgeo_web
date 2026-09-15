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
 * O REGIME e o EIXO de uma resposta escopada, definidos UMA vez para os dois emissores.
 *
 * É a constante que não se duplica, e não a linha de `setHeader`: extrair também a linha
 * para um ajudante foi TENTADO e revertido, porque o censo de superfícies liga rota ->
 * handler -> marcador -> `Cache-Control` por TEXTO, a um salto de profundidade, e o
 * ajudante escondia o cabeçalho de dezessete rotas de uma vez. O censo está certo: é
 * exatamente assim que uma função de nome sugestivo passaria por coberta. O que importa
 * não se perde, porque a cópia perigosa é a do VALOR, e ela continua impossível.
 */
const ESCOPADO = 'private, no-cache';
/** Os dois transportes de credencial que `flexibleAuth` lê. Ver o cabeçalho. */
const VARIA_POR = 'Authorization, Cookie';

/**
 * Rotas JSON: `private, no-cache` quando a resposta dependeu de quem pediu.
 *
 * `no-cache` (e não `no-store`) de propósito: o navegador continua guardando e
 * REVALIDANDO pelo ETag fraco que o Express deriva do CORPO, que já incorpora o
 * conjunto de visibilidade por construção. Resposta pública continua sem cabeçalho,
 * como sempre esteve.
 *
 * `Vary` é ESCRITO e não acrescentado, o que substitui o `Vary: Origin` do CORS.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export function marcarEscopoJson(req, res) {
  if (!respostaEscopada(req)) return;
  res.setHeader('Cache-Control', ESCOPADO);
  res.setHeader('Vary', VARIA_POR);
}

/**
 * O TILE: o mesmo regime, posto numa resposta que NÃO carrega os bytes que ele governa.
 *
 * ESTA É A SUPERFÍCIE TORTA, e o torto é do desenho e não deste arquivo. Os bytes do tile
 * saem do servidor de tiles atrás do nginx e nunca passam por este processo; o que passa é
 * a subrequisição do `auth_request`, que responde 200 ou 401 sem corpo. Então a única forma
 * de o regime alcançar a resposta real é o nginx COPIAR este cabeçalho da subrequisição
 * para o tile (`auth_request_set` mais `add_header`), que é o mesmo caminho pelo qual o
 * motivo da recusa já viaja hoje. Um `Cache-Control` escrito aqui é, portanto, uma
 * INSTRUÇÃO ao host, e não um cabeçalho que o cliente receberá por si só.
 *
 * POR QUE ELE EXISTE (D17, 2026-09-15): com o empréstimo por atlas valendo no tile, a
 * decisão passou a depender de QUEM pede e de QUAL atlas está em foco. Uma resposta assim
 * guardada por cache compartilhado seria entregue a quem não tem o empréstimo, que é
 * exatamente a porta que a cláusula 6.7 mandou fechar. O `?atlasId=` já separa as URLs, mas
 * ele não separa PESSOAS: dois chamadores pedem a mesma URL e só um alcança o atlas.
 *
 * O QUE ELE DELIBERADAMENTE NÃO FAZ: tocar no tile PÚBLICO. Aquele ramo não consulta
 * credencial nenhuma (decisão 5 de `tile-access.js`), então ele continua saindo sem
 * cabeçalho nosso, com o regime que o servidor de tiles já lhe dá — e é por isso que o
 * `add_header` do host, cujo valor vem vazio nesse caso, não acrescenta nada.
 *
 * `no-store` foi considerado e recusado: ele mataria também o cache do NAVEGADOR, e um
 * deslocamento de mapa rebaixaria toda a camada privada à rede outra vez. `private` já
 * proíbe a guarda em cache compartilhado, que é a exposição real.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export function marcarEscopoDeTile(req, res) {
  // Passa pelo MESMO predicado dos JSON, e não por um `if` próprio, mesmo sendo hoje
  // sempre verdadeiro no ramo que o chama (aquele ramo já recusou quem não tem principal).
  // Uma segunda definição de "esta resposta dependeu de quem pediu" é o que este arquivo
  // inteiro existe para não haver.
  if (!respostaEscopada(req)) return;
  res.setHeader('Cache-Control', ESCOPADO);
  res.setHeader('Vary', VARIA_POR);
}
