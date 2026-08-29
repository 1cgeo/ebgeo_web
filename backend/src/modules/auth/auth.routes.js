// Path: src/modules/auth/auth.routes.js
import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import {
  authLimiter,
  registerLimiter,
  refreshLimiter,
  verifyEmailLimiter,
  resendVerificationLimiter,
  forgotPasswordLimiter,
  resetPasswordLimiter,
} from '../../middleware/rate-limit.js';
import { canDeliverAccountMail } from '../../utils/mailer.js';
import * as ctrl from './auth.controller.js';
import * as schemas from './auth.schemas.js';
import { requireTileAccess } from './tile-access.js';
import { requireSelfRegistrationEnabled } from './register-gate.js';

const router = Router();

// Self-registration is a RUNTIME toggle since 2026-08-29 (owner decision): the route is
// ALWAYS mounted and `requireSelfRegistrationEnabled` gates it on the effective
// `features.self_registration`, which starts at the `ALLOW_SELF_REGISTRATION` env default and
// the admin flips from the Sistema tab. The gate runs FIRST, before the limiters, so a disabled
// registration answers 403 without consuming a rate-limit bucket. Disabled = the signup button
// is hidden (same config flag) and this route answers 403.
//
// TWO limiters, in this order, because they key on different things. `registerLimiter`
// is by ADDRESS and is the one that bounds mass creation: the `${ip}:${username}` key of
// `authLimiter` is attacker-chosen here (the name never exists yet), so it hands out a
// fresh bucket per request. `authLimiter` stays because it still throttles repetition
// against one specific name.
router.post(
  '/register',
  requireSelfRegistrationEnabled,
  registerLimiter,
  authLimiter,
  validate({ body: schemas.registerSchema }),
  ctrl.register
);
// One limiter per route, NOT one shared instance. `authLimiter` keys by
// `${ip}:${body.username}`, which only means something on the two routes whose schema
// declares `username`; on the other three it collapsed to `${ip}:` and the three
// drained a single bucket together — see the note in middleware/rate-limit.js.
//
// E-mail confirmation (always mounted: needed whenever an e-mail-bearing account exists).
router.post('/verify-email', verifyEmailLimiter, validate({ body: schemas.verifyEmailSchema }), ctrl.verifyEmail);
router.post('/resend-verification', resendVerificationLimiter, validate({ body: schemas.resendVerificationSchema }), ctrl.resendVerification);

// PASSWORD RECOVERY BY E-MAIL, MOUNTED ONLY WHERE THE MESSAGE CAN LAND, exactly as `/register`
// is mounted only where self-registration is on. The condition is the honest half of "prever o
// e-mail": the account e-mail is optional in this product (`POST /api/v1/users` creates accounts
// without one) and SMTP is only REQUIRED at boot in production with self-registration on
// (`validateEnvVariables`, src/config.js), so a PRODUCTION deployment with no relay is a
// supported state. Mounting there would answer 200 to "enviamos um código" and mail nothing: the
// person would wait for a message that cannot arrive, which is worse than not offering recovery.
// Unmounted means 404, `features.password_reset_email` false in `GET /api/config`, and a login
// screen that offers only the administrator path — which is the rule that is true there.
//
// `canDeliverAccountMail` and not `isSmtpConfigured`, because outside production the mailer
// WRITES the code to the log instead of sending it, and that log is the delivery channel of a
// local stack. Using the narrow predicate would leave the whole flow unreachable in dev and in
// the test suite, i.e. untestable and unusable exactly where it is developed.
//
// Evaluated ONCE at module load (SMTP config is frozen at boot). This is the opposite of the
// `/register` gate above, which is a RUNTIME check: mail delivery cannot be toggled without a
// redeploy, self-registration now can.
if (canDeliverAccountMail()) {
  router.post(
    '/forgot-password',
    forgotPasswordLimiter,
    validate({ body: schemas.forgotPasswordSchema }),
    ctrl.forgotPassword
  );
  router.post(
    '/reset-password',
    resetPasswordLimiter,
    validate({ body: schemas.resetPasswordWithTokenSchema }),
    ctrl.resetPasswordByToken
  );
}

router.post('/login', authLimiter, validate({ body: schemas.loginSchema }), ctrl.login);
router.post('/refresh', refreshLimiter, validate({ body: schemas.refreshSchema }), ctrl.refresh);
router.post('/logout', auth, validate({ body: schemas.logoutSchema }), ctrl.logout);
router.get('/me', auth, ctrl.getMe);

// O `auth_request` do nginx para as rotas do servidor de tiles (cláusula 10.7).
//
// SÓ-`flexibleAuth`, e a ausência do `auth` estrito é a decisão que sustenta a rota
// inteira: o estrito recusa a chave de escopo `tiles` (é assim que a amarra 2 foi
// implementada), que é justamente a credencial que o tile carrega. Montá-lo aqui faria
// este endpoint recusar todo tile.
//
// SEM `validate`: não há corpo nem parâmetro de rota, e a única entrada (`?api_key=`) é
// peneirada por forma de UUID dentro de `flexibleAuth` antes de qualquer consulta.
//
// SEM AUDITORIA, por decisão declarada no `fileoverview` de `tile-access.js`: seria uma
// linha por TILE, e `audit_trail.action` não tem ação de leitura para gravar.
//
// LEIA O `fileoverview` DE `tile-access.js` ANTES DE DESCREVER ESTA ROTA EM QUALQUER
// LUGAR. Ela decide POR RECURSO desde 2026-08-29: resolve o caminho pedido contra o
// índice de catálogo, libera o público sem credencial nenhuma e passa o privado pelo
// mesmo `fn_can_see_resource` do resto do acervo. Até aquela data ela validava só a
// credencial, e qualquer chave viva alcançava qualquer camada privada.
//
// UM MIDDLEWARE SÓ, e ele responde: não há par gate/handler porque os quatro desfechos
// (não reivindicado, público, sem credencial, recurso não alcançado) são decididos no
// mesmo lugar, e separá-los faria o handler ter de repetir a consulta ao índice.
router.get('/tile-access', requireTileAccess);

export { router as authRoutes };
