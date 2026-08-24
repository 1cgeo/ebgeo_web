// Path: src/modules/users/users.routes.js
import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/require-admin.js';
import { validate } from '../../middleware/validate.js';
import { emailChangeLimiter } from '../../middleware/rate-limit.js';
import { canDeliverAccountMail } from '../../utils/mailer.js';
import * as ctrl from './users.controller.js';
import * as schemas from './users.schemas.js';

const router = Router();

// User routes (authenticated user manages their own profile)
router.get('/me', auth, ctrl.getProfile);
router.put('/me', auth, validate({ body: schemas.updateProfileSchema }), ctrl.updateProfile);
router.put('/me/password', auth, validate({ body: schemas.updatePasswordSchema }), ctrl.updatePassword);
// ROTA PRÓPRIA, e não um campo a mais em `PUT /me`: o endereço é o canal de recuperação da conta,
// exige a senha atual e dispara re-verificação, e nenhuma das três coisas cabe na edição de nome
// e posto. O limitador é por ENDEREÇO mesmo com o chamador autenticado, porque a rota manda
// e-mail para um destino que o chamador digita (ver `emailChangeLimiter`).
//
// MONTADA SÓ COM CANAL DE ENTREGA, pela MESMA porta que as rotas de recuperação em
// `auth.routes.js`. Ela era incondicional, e a assimetria custava exatamente o que aquela decisão
// tomou o cuidado de evitar do outro lado: numa produção sem relay o pedido respondia 200, o envio
// só era registrado em log, e a tela mostrava a promessa de um link de confirmação que ninguém
// mandou. O endereço da conta ficava pendurado num convite inalcançável.
//
// Sem canal, o caminho que sobra é o do administrador, que a decisão de 2026-08-20 abriu
// (`updateUserAdminSchema` aceita `email`). Avaliado UMA vez na carga do módulo, como lá: a
// configuração congela no boot.
if (canDeliverAccountMail()) {
  router.put('/me/email', auth, emailChangeLimiter, validate({ body: schemas.changeEmailSchema }), ctrl.changeMyEmail);
}
router.post('/me/api-key/rotate', auth, ctrl.rotateMyApiKey);

// AS CHAVES NOMEADAS (cláusula 10.7). A rota de ROTAÇÃO acima continua governando o
// slot legado (`users.api_key`, uma chave por conta, emitir a nova mata a anterior); as
// três abaixo são o modelo novo, em que revogar UMA não derruba as outras.
//
// AS TRÊS SÃO GATEADAS POR `auth` ESTRITO, e isso não é redundância com o gate de
// escopo: uma chave de escopo `tiles` não passa no `auth` estrito, então nenhuma chave
// de tile emite nem revoga chave nenhuma. Uma chave de escopo `full` passa — ela é uma
// sessão da conta para todo efeito que não seja administração — e isso é aceito: quem
// tem a credencial da conta já pode rotacionar o slot legado pela rota acima.
router.get('/me/api-keys', auth, ctrl.listMyApiKeys);
router.post('/me/api-keys', auth, validate({ body: schemas.createApiKeySchema }), ctrl.createMyApiKey);
router.delete('/me/api-keys/:keyId', auth, validate({ params: schemas.apiKeyIdParamsSchema }), ctrl.revokeMyApiKey);

router.get('/search', auth, validate({ query: schemas.searchQuerySchema }), ctrl.searchUsers);

// Admin routes (manage all users)
router.get('/', auth, requireAdmin, validate({ query: schemas.listUsersQuerySchema }), ctrl.listUsers);
router.post('/', auth, requireAdmin, validate({ body: schemas.createUserAdminSchema }), ctrl.createUser);
router.get('/:userId', auth, requireAdmin, validate({ params: schemas.userIdParamsSchema }), ctrl.getUser);
router.put('/:userId', auth, requireAdmin, validate({ params: schemas.userIdParamsSchema, body: schemas.updateUserAdminSchema }), ctrl.updateUser);
router.post('/:userId/reset-password', auth, requireAdmin, validate({ params: schemas.userIdParamsSchema, body: schemas.resetPasswordSchema }), ctrl.resetPassword);
router.delete('/:userId', auth, requireAdmin, validate({ params: schemas.userIdParamsSchema, query: schemas.deleteUserQuerySchema }), ctrl.deleteUser);
router.post('/:userId/reactivate', auth, requireAdmin, validate({ params: schemas.userIdParamsSchema }), ctrl.reactivateUser);
router.post('/:userId/api-key/rotate', auth, requireAdmin, validate({ params: schemas.userIdParamsSchema }), ctrl.rotateUserApiKey);
// O administrador VÊ e REVOGA a chave alheia, e não EMITE: ver o comentário de
// `revokeUserApiKey`. As duas passam por `requireAdmin`, que desde 2026-08-24 recusa
// TODA chave de API, qualquer que seja o escopo — inclusive a de um administrador.
router.get('/:userId/api-keys', auth, requireAdmin, validate({ params: schemas.userIdParamsSchema }), ctrl.listUserApiKeys);
router.delete('/:userId/api-keys/:keyId', auth, requireAdmin, validate({ params: schemas.userApiKeyIdParamsSchema }), ctrl.revokeUserApiKey);

export { router as usersRoutes };
