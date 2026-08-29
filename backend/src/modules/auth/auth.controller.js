// Path: src/modules/auth/auth.controller.js
import { asyncHandler } from '../../utils/async-handler.js';
import { createAuditBestEffort } from '../../utils/audit.js';
import * as authService from './auth.service.js';
import { env } from '../../utils/environment.js';

/**
 * PÕE O TOKEN DE SESSÃO NO COOKIE, ao lado do corpo que já o devolve.
 *
 * POR QUE O COOKIE EXISTE, e é a decisão 3 d`docs/wiki/tile-privado.md`:
 * há pedidos que o NAVEGADOR faz e que não aceitam cabeçalho nenhum — o tile do
 * MapLibre, o `img.src` de uma cena 3D, o `<video src>` de uma prévia. Sem cookie, a
 * única credencial que os alcança é a chave de API na URL, que é portadora, permanente
 * até a rotação, e aparece no log de acesso do nginx e no `Referer`. O cookie carrega o
 * MESMO JWT: não há credencial nova, e o que muda é a porta por onde ele entra.
 *
 * O TOKEN CONTINUA NO CORPO, e a duplicação é deliberada: o cliente guarda o par em
 * `localStorage` e manda `Authorization` nas rotas de escrita, que é justamente o que o
 * `auth` estrito passou a EXIGIR (ele recusa principal vindo de cookie). Tirar o token
 * do corpo tornaria toda escrita impossível.
 *
 * @param {import('express').Response} res
 * @param {string} accessToken
 */
function porCookieDeSessao(res, accessToken) {
  res.cookie('token', accessToken, env.cookieOptions());
}

// LOGIN E LOGOUT SÃO AUDITADOS EM BEST-EFFORT, e essa é a única decisão desta fase
// que troca garantia por disponibilidade. As três razões, em ordem de peso:
//
// 1. ORÁCULO. A trilha só é escrita DEPOIS de a credencial ter sido aceita. Se um
//    erro dela virasse 500, uma senha CERTA responderia 500 e uma senha ERRADA
//    responderia 401 sempre que o banco de auditoria tossisse — o oráculo de
//    usuário/senha que `DUMMY_HASH` existe para matar, remontado a partir da tabela
//    de log. Nenhuma linha de trilha vale isso.
// 2. DISPONIBILIDADE. Auditoria que bloqueia é auditoria que pode negar acesso a uma
//    credencial válida. Login é a porta do produto; a trilha é observabilidade.
// 3. STATUS. `/auth/logout` responde 204 para TODOS os desfechos de propósito (ver o
//    comentário abaixo); deixar a trilha decidir o status devolveria exatamente a
//    distinção que aquele desenho passa trinta linhas removendo.
//
// A contrapartida é dita em voz alta: uma falha de escrita da trilha some do
// caminho da requisição e sobrevive só como `logger.error`. Toda a auditoria
// TRANSACIONAL (usuários, atlas, catálogo, concessões) continua bloqueante — o
// best-effort é a exceção destes dois, não a regra da casa.
//
// LOGIN FALHO NÃO É AUDITÁVEL AQUI, e por impossibilidade estrutural, não por
// escolha: `audit_trail.actor_id` é NOT NULL e uma tentativa recusada não tem ator
// identificado (o `username` digitado não é identidade). Ele continua em
// `logger.warn` (`auth.service.js`).
export const login = asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  const result = await authService.login(username, password);
  // Auto-alvo: quem entra é o ator E o alvo. `details` carrega só o `username`, que
  // o próprio ator digitou — nada de token, nada de hash.
  await createAuditBestEffort(req, {
    action: 'LOGIN',
    actorId: result.user.id,
    targetType: 'USER',
    targetId: result.user.id,
    targetName: result.user.nome,
    details: { username: result.user.username },
  });
  porCookieDeSessao(res, result.accessToken);
  res.json({ data: result });
});

export const refresh = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  const result = await authService.refresh(refreshToken);
  // O MESMO cookie do login: sem esta linha, a sessão renovada perderia o transporte
  // de leitura e as camadas privadas sumiriam do mapa quinze minutos depois de entrar,
  // que é a classe de defeito que só aparece em uso prolongado.
  porCookieDeSessao(res, result.accessToken);
  res.json({ data: result });
});

// 204 UNCONDITIONALLY, including when the revocation matched no row — and that is a
// decision, not the leftover of not reading the result.
//
// The three misses (a token belonging to another account, one already revoked, one
// never issued) are exactly the three facts an attacker would want to learn, and a
// distinct status would answer all of them. `/auth/logout` carries no rate limiter
// (only login/refresh/register do) and, unlike `/auth/refresh`, does not consume the
// token it is handed, so a 403/404 here would be an unlimited, non-destructive oracle
// for "is this refresh token live, and is it mine?". 204 for every outcome answers
// nothing.
//
// It is also the honest answer semantically: logout states an intent about a session,
// and after any of the three misses the intended end state ("this token cannot rotate,
// and I hold no session for it") already holds. Nothing failed for the caller.
//
// The cost is that the status no longer distinguishes anything — so the guarantees are
// asserted against `refresh_tokens` in tests/integration/auth-logout-revocation.test.js,
// which is where they are observable at all. The service still RETURNS whether it
// revoked, so a future caller that needs to tell the cases apart can.
export const logout = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  const revoked = await authService.logout(refreshToken, req.user.id);
  // `revoked` NÃO reabre o oráculo do 204: ele vai para a trilha, que só um
  // administrador lê, e a resposta continua idêntica nos três desfechos. É o dado
  // que distingue um encerramento de sessão real de um logout que não achou token
  // — sem ele, "esta conta encerrou a sessão" e "esta conta mandou um token que não
  // era dela" viram a mesma linha.
  await createAuditBestEffort(req, {
    action: 'LOGOUT',
    actorId: req.user.id,
    targetType: 'USER',
    targetId: req.user.id,
    details: { revoked },
  });
  // O COOKIE MORRE AQUI, e esta é a única saída que tem o cliente na mão. Os outros
  // cinco encerramentos de sessão (reuso detectado, troca de senha, reset, reset por
  // administrador, desativação) agem sobre o ESTADO e nem têm a resposta daquele
  // cliente; para eles quem limpa é o ramo de sessão morta de `flexibleAuth`, na
  // requisição seguinte. Sem esta linha o cookie sobreviveria ao logout até o `maxAge`,
  // e o cliente se acharia anônimo (`isAuthenticated()` é in-memory) enquanto o
  // servidor continuaria vendo um principal em toda superfície que lê cookie.
  //
  // As opções de limpeza vêm de `env.clearCookieOptions()`, e o porquê de elas serem as
  // da emissão menos `maxAge` está escrito lá.
  res.clearCookie('token', env.clearCookieOptions());
  res.status(204).send();
});

export const getMe = asyncHandler(async (req, res) => {
  const user = await authService.getMe(req.user.id);
  res.json({ data: user });
});

/** Request origin for building the verification link: Origin header, else scheme+Host. */
function requestOrigin(req) {
  return req.headers.origin || `${req.protocol}://${req.get('host') || ''}`;
}

/**
 * Self-registration. Answers the SAME 201 and the SAME body whether an account was created or the
 * username/e-mail was already taken — see the oracle note on `authService.register`. The created
 * user is deliberately NOT returned: echoing it back would distinguish the two branches just as
 * plainly as the 409 this replaced. Anything a caller needs about the new account it either already
 * knows (it typed it) or learns by logging in.
 */
export const register = asyncHandler(async (req, res) => {
  await authService.register(req.body, requestOrigin(req), req);
  res.status(201).json({ data: { success: true } });
});

export const verifyEmail = asyncHandler(async (req, res) => {
  const result = await authService.verifyEmail(req.body.token);
  res.json({ data: result });
});

export const resendVerification = asyncHandler(async (req, res) => {
  const result = await authService.resendVerification(
    { email: req.body.email ?? null, username: req.body.username ?? null },
    requestOrigin(req)
  );
  res.json({ data: result });
});

/**
 * Step one of the password recovery.
 *
 * ANSWERS THE SAME 200 AND THE SAME BODY whether or not the address has a resettable account —
 * the same anti-enumeration decision `register` makes, applied to the route that would otherwise
 * be the cheapest account oracle in the product: no credential, no limit on who may ask, and an
 * answer for every address on the internet. Nothing about the outcome may reach the response; it
 * reaches the mailbox or nowhere.
 */
export const forgotPassword = asyncHandler(async (req, res) => {
  const result = await authService.requestPasswordReset(req.body.email, requestOrigin(req));
  res.json({ data: result });
});

/**
 * Step two of the password recovery.
 *
 * This one DOES distinguish its outcomes (invalid code, expired code, success), and that is not
 * a contradiction of the route above: the caller here is holding a code that was mailed to the
 * account's own address, so telling them it expired reveals nothing they could not learn by
 * trying, and hiding it would leave the only recovery path unusable in silence.
 */
export const resetPasswordByToken = asyncHandler(async (req, res) => {
  const { token, newPassword } = req.body;
  const result = await authService.resetPasswordWithToken(token, newPassword, req);
  res.json({ data: result });
});
