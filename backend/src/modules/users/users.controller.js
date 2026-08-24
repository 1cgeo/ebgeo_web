// Path: src/modules/users/users.controller.js
import { asyncHandler } from '../../utils/async-handler.js';
import * as usersService from './users.service.js';

export const getProfile = asyncHandler(async (req, res) => {
  const user = await usersService.getProfile(req.user.id);
  res.json({ data: user });
});

export const updateProfile = asyncHandler(async (req, res) => {
  const user = await usersService.updateProfile(req.user.id, req.body, req);
  res.json({ data: user });
});

export const updatePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  await usersService.updatePassword(req.user.id, currentPassword, newPassword, req);
  res.json({ data: { success: true } });
});

/**
 * Pede a troca do e-mail da própria conta.
 *
 * A RESPOSTA É A MESMA nos dois desfechos (endereço livre, endereço de outra conta), e o corpo é
 * só `{ success: true }`: qualquer diferença aqui, inclusive um campo a mais, seria o oráculo de
 * existência de conta que o serviço passa trinta linhas fechando. O que muda de fato viaja por
 * e-mail, e a tela diz isso em palavras.
 *
 * `requestOrigin` monta a base do link de confirmação; o mailer só a honra se ela for a origem
 * que o deployment já confia (`resolveVerificationBase`).
 */
export const changeMyEmail = asyncHandler(async (req, res) => {
  const origin = req.headers.origin || `${req.protocol}://${req.get('host') || ''}`;
  const result = await usersService.requestEmailChange(req.user.id, req.body, req, origin);
  res.json({ data: result });
});

export const searchUsers = asyncHandler(async (req, res) => {
  const users = await usersService.searchUsers(req.query.q);
  res.json({ data: users });
});

export const rotateMyApiKey = asyncHandler(async (req, res) => {
  const result = await usersService.rotateApiKey(req.user.id, req.user.id, req);
  res.json({ data: result });
});

// ============================================
// Chaves de API nomeadas (cláusula 10.7)
// ============================================
//
// O SEGREDO SAI UMA VEZ, na resposta 201 da criação, e nunca mais: `listApiKeys` não o
// devolve. Quem perder a chave emite outra e revoga a que perdeu — que é justamente o
// que a revogação individual passou a permitir sem derrubar as irmãs.

export const listMyApiKeys = asyncHandler(async (req, res) => {
  const keys = await usersService.listApiKeys(req.user.id);
  res.json({ data: keys });
});

export const createMyApiKey = asyncHandler(async (req, res) => {
  const result = await usersService.createApiKey(req.user.id, req.body, req.user.id, req);
  res.status(201).json({ data: result });
});

export const revokeMyApiKey = asyncHandler(async (req, res) => {
  const result = await usersService.revokeApiKey(req.user.id, req.params.keyId, req.user.id, req);
  res.json({ data: result });
});

export const listUserApiKeys = asyncHandler(async (req, res) => {
  const keys = await usersService.listApiKeys(req.params.userId);
  res.json({ data: keys });
});

// O ADMINISTRADOR REVOGA, E NÃO EMITE, e a assimetria é decisão: uma chave emitida por
// terceiro é uma credencial que o titular nunca viu e não sabe que carrega o nome dele.
// Desligar a chave alheia é contenção de incidente; ligar uma é personificação.
export const revokeUserApiKey = asyncHandler(async (req, res) => {
  const result = await usersService.revokeApiKey(
    req.params.userId, req.params.keyId, req.user.id, req
  );
  res.json({ data: result });
});

// ============================================
// Admin controllers
// ============================================

export const listUsers = asyncHandler(async (req, res) => {
  const includeInactive = !!req.query.includeInactive;
  const users = await usersService.listUsers(includeInactive);
  res.json({ data: users });
});

export const getUser = asyncHandler(async (req, res) => {
  const user = await usersService.getUserById(req.params.userId);
  res.json({ data: user });
});

// `req` e o id do ator seguem para o service porque a auditoria participa da
// MESMA transação da escrita — o `req` carrega ip e user-agent da trilha.
export const createUser = asyncHandler(async (req, res) => {
  const user = await usersService.createUser(req.body, req, req.user.id);
  res.status(201).json({ data: user });
});

// `data` NAO E SO A LINHA: alem das colunas do usuario, ela carrega `grantsAffected`,
// `grantsReparented` e `fundamentoPerdido`, que sao o EFEITO da poda que este PUT pode
// disparar (ver `fundamentoDeRaizPerdido` no service). Eles vao no mesmo objeto, e nao
// num envelope irmao, porque `_request` do cliente desembrulha `data` e devolve so ele:
// um segundo campo no topo nao chegaria a tela sem mudar o cliente HTTP. Os tres viajam
// sempre, com zero quando nada foi podado.
export const updateUser = asyncHandler(async (req, res) => {
  const user = await usersService.updateUser(req.params.userId, req.body, req.user.id, req);
  res.json({ data: user });
});

export const resetPassword = asyncHandler(async (req, res) => {
  await usersService.resetPassword(req.params.userId, req.body.newPassword, req, req.user.id);
  res.json({ data: { success: true } });
});

export const deleteUser = asyncHandler(async (req, res) => {
  const result = await usersService.deleteUser(
    req.params.userId,
    req.user.id,
    req.query.transferTo,
    req
  );
  res.json({ data: result });
});

export const reactivateUser = asyncHandler(async (req, res) => {
  const user = await usersService.reactivateUser(req.params.userId, req.user.id, req);
  res.json({ data: user });
});

export const rotateUserApiKey = asyncHandler(async (req, res) => {
  const result = await usersService.rotateApiKey(req.params.userId, req.user.id, req);
  res.json({ data: result });
});
