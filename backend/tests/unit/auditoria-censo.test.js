// Path: tests/unit/auditoria-censo.test.js
//
// O CENSO DA AUDITORIA: toda rota de ESCRITA tem trilha, ou uma isenção escrita.
//
// Uma passada de auditoria fechou catorze buracos de uma vez, e três deles eram da pior
// espécie: `LOGIN`, `LOGOUT` e `ATLAS_DELETE` estavam DECLARADAS no CHECK desde a
// 002_auditoria.sql e a contagem de emissores em `src/` era ZERO para as três. Isso não
// é uma ação faltando — é um filtro que responde "ninguém apagou atlas nenhum" e
// parece uma resposta. O modo de falha que este arquivo existe para impedir é o
// mesmo, na direção do futuro: uma rota de escrita NOVA que nasce sem trilha, e
// nada fica vermelho porque nada estava olhando.
//
// COMO ELE FUNCIONA, em dois níveis (o molde é `tests/unit/papel-global-censo.test.js`):
//
//   A VARREDURA. O inventário vem do VERSIONAMENTO (`git ls-files -co
//   --exclude-standard` sobre `src/`), nunca de uma lista de alvos escrita à mão:
//   "conferir um subconjunto e tratar como o conjunto" é a classe mais repetida de
//   `docs/livro-razao.md`. As duas bandeiras não são detalhe: com `git ls-files`
//   puro o inventário era só o RASTREADO, e o guarda ficava cego exatamente onde o
//   trabalho novo aparece — a rota escrita há cinco minutos, que é a que ninguém
//   classificou, ficava fora da varredura até alguém dar `git add`, e o censo
//   passava verde sem tê-la olhado. Toda chamada `router.post/put/patch/delete` de
//   todo `*.routes.js` precisa aparecer no censo. Rota nova não classificada
//   REPROVA, e isso é PROVADO por DOIS casos deste arquivo: um aponta a mesma
//   varredura para uma fixture com uma rota de escrita sem classificação
//   (`tests/fixtures/censo-auditoria/`) e exige que ela seja acusada; o outro cria um
//   arquivo NÃO RASTREADO e exige que o inventário o alcance. Um guarda que afirma
//   sobre si mesmo não é guarda.
//
//   O CENSO. Uma entrada por rota, em exatamente uma de TRÊS classes:
//     - AUDITADA: emite trilha. A entrada nomeia a AÇÃO e o ARQUIVO EMISSOR, e o
//       teste confere que aquele arquivo cita aquela ação — a ligação rota→emissor
//       é o que uma lista de ações sozinha não prende.
//     - ISENTA: não audita, POR DECISÃO, com o motivo escrito. Conteúdo de atlas
//       (o log de operações já É a trilha), evento de altíssima frequência
//       (calibração de foto 360, rotação de token), cosmético sem eixo de acesso.
//     - BURACO: não audita e DEVERIA, reconhecido por escrito e com TETO. A classe
//       existe para que uma lacuna não possa se disfarçar de isenção — que é
//       exatamente como as três ações sem emissor sobreviveram desde o primeiro dia.
//
// FRAGILIDADES ACEITAS. (a) O inventário precisa de `git`; se o comando falhar, o
// caso-piso diz isso nessas palavras, porque falha de ambiente lida como regressão
// custa mais do que o guarda economiza. (b) A varredura reconhece rota pelo padrão
// `router.<verbo>(` com o caminho em literal — uma rota montada por variável sai da
// contagem, e a direção do erro é perder um sítio, não inventar um. (c) O censo
// prende a EXISTÊNCIA da trilha, nunca o conteúdo dela: que a linha traga o ator, o
// alvo certo e os detalhes é comportamento, e mora em
// `tests/integration/auditoria-acoes-novas.test.js`.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

const AUDITADA = 'auditada';
const ISENTA = 'isenta-por-decisao';
const BURACO = 'buraco-conhecido';

/** Emissores usados por mais de uma entrada, para o censo caber na tela. */
const ATLAS_CTRL = 'src/modules/atlas/atlas.controller.js';
const RA_SVC = 'src/modules/resource-access/resource-access.service.js';
const SHARING_SVC = 'src/modules/sharing/sharing.service.js';
const USERS_SVC = 'src/modules/users/users.service.js';
const SV360_ADMIN_SVC = 'src/modules/streetview360/sv360.admin.service.js';
const AG_SVC = 'src/modules/access-groups/access-groups.service.js';
const RANKS_CTRL = 'src/modules/ranks/ranks.controller.js';

/** Motivos de isenção que se repetem, escritos uma vez. */
const CONTEUDO_DE_ATLAS = 'Conteúdo colaborativo de atlas: o LOG DE OPERAÇÕES é a trilha, e ele guarda '
  + 'ator, momento e a mudança inteira. Uma segunda cópia em audit_trail divergiria da primeira.';
const CALIBRACAO_360 = 'Calibração de foto 360: evento de altíssima frequência, a foto já carrega '
  + '`updated_at`, e uma linha por ajuste afogaria a trilha no ruído que menos importa. A auditoria '
  + 'do 360 é no nível do PROJETO (ingestão, exclusão, ocultação), que é onde o acesso se decide.';
const COSMETICO = 'Metadado de apresentação do atlas (nome, descrição, capa): não move nenhum eixo '
  + 'de acesso e a própria linha guarda o valor atual.';

/**
 * @typedef {Object} EntradaDoCenso
 * @property {string} arquivo - Caminho do `*.routes.js`, relativo a `backend/`.
 * @property {string} rota - `METODO caminho`, como a varredura o encontra.
 * @property {AUDITADA|ISENTA|BURACO} classe
 * @property {string} [acao] - A ação de `audit_trail.action` (obrigatória em AUDITADA).
 * @property {string} [emissor] - O arquivo que a emite (obrigatório em AUDITADA).
 * @property {string} [motivo] - Obrigatório em ISENTA e BURACO.
 */

/** @type {EntradaDoCenso[]} */
const CENSO = [
  // ---------------- atlas: ciclo de vida auditado, conteúdo isento --------------
  { arquivo: 'src/modules/atlas/atlas.routes.js', rota: 'POST /', classe: AUDITADA, acao: 'ATLAS_CREATE', emissor: ATLAS_CTRL },
  { arquivo: 'src/modules/atlas/atlas.routes.js', rota: 'POST /import', classe: AUDITADA, acao: 'ATLAS_CREATE', emissor: ATLAS_CTRL },
  { arquivo: 'src/modules/atlas/atlas.routes.js', rota: 'POST /:atlasId/clone', classe: AUDITADA, acao: 'ATLAS_CREATE', emissor: ATLAS_CTRL },
  { arquivo: 'src/modules/atlas/atlas.routes.js', rota: 'DELETE /:atlasId', classe: AUDITADA, acao: 'ATLAS_DELETE', emissor: ATLAS_CTRL },
  { arquivo: 'src/modules/atlas/atlas.routes.js', rota: 'POST /:atlasId/restore', classe: AUDITADA, acao: 'ATLAS_RESTORE', emissor: ATLAS_CTRL },
  { arquivo: 'src/modules/atlas/atlas.routes.js', rota: 'POST /:atlasId/transfer', classe: AUDITADA, acao: 'ATLAS_TRANSFER', emissor: 'src/modules/atlas/atlas.service.js' },
  { arquivo: 'src/modules/atlas/atlas.routes.js', rota: 'POST /:atlasId/resources', classe: AUDITADA, acao: 'SHARING_CHANGE', emissor: RA_SVC },
  { arquivo: 'src/modules/atlas/atlas.routes.js', rota: 'DELETE /:atlasId/resources/:type/:id', classe: AUDITADA, acao: 'SHARING_CHANGE', emissor: RA_SVC },
  { arquivo: 'src/modules/atlas/atlas.routes.js', rota: 'PUT /:atlasId', classe: ISENTA, motivo: COSMETICO },
  { arquivo: 'src/modules/atlas/atlas.routes.js', rota: 'PUT /:atlasId/cover', classe: ISENTA, motivo: COSMETICO },
  { arquivo: 'src/modules/atlas/atlas.routes.js', rota: 'DELETE /:atlasId/cover', classe: ISENTA, motivo: COSMETICO },
  { arquivo: 'src/modules/atlas/atlas.routes.js', rota: 'POST /:atlasId/maps/:mapId/duplicate', classe: ISENTA, motivo: CONTEUDO_DE_ATLAS },
  // FECHADO EM 2026-08-21: era BURACO ("desliga superfícies inteiras para todos os
  // membros, então é decisão de acesso e deveria deixar linha"). `SHARING_CHANGE` é
  // reusada porque ela JÁ é o vocabulário de acesso do atlas, e `details.kind` a
  // discrimina dos dois emissores de empréstimo do mesmo alvo.
  { arquivo: 'src/modules/atlas/atlas.routes.js', rota: 'PATCH /:atlasId/settings', classe: AUDITADA, acao: 'SHARING_CHANGE', emissor: ATLAS_CTRL },

  // ---------------- auth ----------------------------------------------------
  { arquivo: 'src/modules/auth/auth.routes.js', rota: 'POST /login', classe: AUDITADA, acao: 'LOGIN', emissor: 'src/modules/auth/auth.controller.js' },
  { arquivo: 'src/modules/auth/auth.routes.js', rota: 'POST /logout', classe: AUDITADA, acao: 'LOGOUT', emissor: 'src/modules/auth/auth.controller.js' },
  { arquivo: 'src/modules/auth/auth.routes.js', rota: 'POST /register', classe: AUDITADA, acao: 'USER_CREATE', emissor: 'src/modules/auth/auth.service.js' },
  {
    arquivo: 'src/modules/auth/auth.routes.js', rota: 'POST /refresh', classe: ISENTA,
    motivo: 'Rotação de refresh token: altíssima frequência e nenhuma decisão humana. Auditá-la é '
      + 'auditar o keep-alive, e afogaria as duas linhas por sessão que LOGIN/LOGOUT produzem.',
  },
  {
    arquivo: 'src/modules/auth/auth.routes.js', rota: 'POST /verify-email', classe: ISENTA,
    motivo: 'Confirmação de e-mail pelo próprio titular, com token de uso único: não há ator '
      + 'administrativo, e o efeito (`email_verified`) é uma coluna da própria conta.',
  },
  {
    arquivo: 'src/modules/auth/auth.routes.js', rota: 'POST /resend-verification', classe: ISENTA,
    motivo: 'Reenvio do e-mail de confirmação: não muda estado de autorização nenhum, e é rota '
      + 'com limitador próprio justamente por poder ser repetida à vontade.',
  },
  {
    arquivo: 'src/modules/auth/auth.routes.js', rota: 'POST /forgot-password', classe: ISENTA,
    motivo: 'PEDIR um código de redefinição não muda nada: nenhuma coluna de conta é escrita, só '
      + 'um token de uso único é cunhado, e a rota responde igual exista ou não a conta. Auditar '
      + 'aqui seria pior que inútil, seria PERIGOSO: a trilha guarda o e-mail digitado por um '
      + 'chamador anônimo, e viraria uma lista de endereços tentados que ninguém pediu para '
      + 'guardar. O ato que importa é a redefinição, e ela está auditada logo abaixo.',
  },
  {
    arquivo: 'src/modules/auth/auth.routes.js', rota: 'POST /reset-password', classe: AUDITADA,
    acao: 'PASSWORD_RESET', emissor: 'src/modules/auth/auth.service.js',
  },

  // ---------------- catálogo (a fábrica serve as QUATRO tabelas) --------------
  { arquivo: 'src/modules/catalog/catalog.routes.js', rota: 'POST /', classe: AUDITADA, acao: 'CATALOG_CREATE', emissor: 'src/modules/catalog/catalog.controller.js' },
  { arquivo: 'src/modules/catalog/catalog.routes.js', rota: 'PUT /:id', classe: AUDITADA, acao: 'CATALOG_UPDATE', emissor: 'src/modules/catalog/catalog.controller.js' },
  { arquivo: 'src/modules/catalog/catalog.routes.js', rota: 'DELETE /:id', classe: AUDITADA, acao: 'CATALOG_DELETE', emissor: 'src/modules/catalog/catalog.controller.js' },

  // ---------------- config: o documento de boot -------------------------------
  { arquivo: 'src/modules/config/config.routes.js', rota: 'PUT /admin', classe: AUDITADA, acao: 'CONFIG_UPDATE', emissor: 'src/modules/config/config.service.js' },
  { arquivo: 'src/modules/config/config.routes.js', rota: 'DELETE /admin', classe: AUDITADA, acao: 'CONFIG_CLEAR', emissor: 'src/modules/config/config.service.js' },

  // ---------------- debug -----------------------------------------------------
  {
    arquivo: 'src/modules/debug/debug.routes.js', rota: 'DELETE /trace', classe: ISENTA,
    motivo: 'O anel do SyncLedger, montado só com o tracer ligado e NUNCA em produção (conjunção '
      + 'no ponto de montagem em app.js). Apagar diagnóstico volátil de test/dev não é evento de '
      + 'acesso, e a rota inteira não existe no ambiente onde a trilha é lida.',
  },

  // ---------------- conteúdo de atlas ----------------------------------------
  { arquivo: 'src/modules/images/images.routes.js', rota: 'POST /', classe: ISENTA, motivo: CONTEUDO_DE_ATLAS },
  { arquivo: 'src/modules/images/images.routes.js', rota: 'POST /bulk', classe: ISENTA, motivo: CONTEUDO_DE_ATLAS },
  { arquivo: 'src/modules/images/images.routes.js', rota: 'DELETE /:imageId', classe: ISENTA, motivo: CONTEUDO_DE_ATLAS },
  { arquivo: 'src/modules/maps/maps.routes.js', rota: 'POST /:mapId/merge', classe: ISENTA, motivo: CONTEUDO_DE_ATLAS },
  { arquivo: 'src/modules/sync/sync.routes.js', rota: 'POST /', classe: ISENTA, motivo: CONTEUDO_DE_ATLAS },
  {
    arquivo: 'src/modules/sync/sync.routes.js', rota: 'POST /admin/cleanup', classe: BURACO,
    motivo: 'Expurgo administrativo de operações antigas: apaga justamente o log que serve de '
      + 'trilha para todo o conteúdo de atlas, e não deixa nada dizendo quem apagou o quê. É a '
      + 'lacuna mais incômoda desta lista, porque destrói a trilha alternativa que isenta cinco '
      + 'outras rotas aqui.',
  },

  // ---------------- organizações e postos -------------------------------------
  { arquivo: 'src/modules/organizations/organizations.routes.js', rota: 'POST /', classe: AUDITADA, acao: 'ORG_CREATE', emissor: 'src/modules/organizations/organizations.controller.js' },
  { arquivo: 'src/modules/organizations/organizations.routes.js', rota: 'PUT /:id', classe: AUDITADA, acao: 'ORG_UPDATE', emissor: 'src/modules/organizations/organizations.controller.js' },
  { arquivo: 'src/modules/organizations/organizations.routes.js', rota: 'DELETE /:id', classe: AUDITADA, acao: 'ORG_DELETE', emissor: 'src/modules/organizations/organizations.controller.js' },
  // FECHADAS EM 2026-08-24 (decisão do dono, "postos ganham trilha", achado M1 do
  // relatório do administrador). Eram os TRÊS buracos que sobravam além do cleanup de
  // sync. O vocabulário novo (`RANK_*` mais o alvo `RANK`) nasceu LARGO na baseline
  // de auditoria, e não num arquivo com par DROP/ADD CONSTRAINT: enquanto nenhum banco
  // fora deste branch aplicou a baseline, alargá-la é o caminho que o pacote manda
  // seguir. Sem o alvo próprio as três linhas nasceriam com `target_type` nulo, e
  // `idx_audit_target` deixaria de responder "tudo que já foi feito com este posto".
  { arquivo: 'src/modules/ranks/ranks.routes.js', rota: 'POST /', classe: AUDITADA, acao: 'RANK_CREATE', emissor: RANKS_CTRL },
  { arquivo: 'src/modules/ranks/ranks.routes.js', rota: 'PUT /:id', classe: AUDITADA, acao: 'RANK_UPDATE', emissor: RANKS_CTRL },
  { arquivo: 'src/modules/ranks/ranks.routes.js', rota: 'DELETE /:id', classe: AUDITADA, acao: 'RANK_DELETE', emissor: RANKS_CTRL },

  // ---------------- acesso a recurso privado ----------------------------------
  { arquivo: 'src/modules/resource-access/resource-access.routes.js', rota: 'PATCH /:type/:id/visibility', classe: AUDITADA, acao: 'SHARING_CHANGE', emissor: RA_SVC },
  { arquivo: 'src/modules/resource-access/resource-access.routes.js', rota: 'POST /:type/:id/grants', classe: AUDITADA, acao: 'PERMISSION_GRANT', emissor: RA_SVC },
  { arquivo: 'src/modules/resource-access/resource-access.routes.js', rota: 'DELETE /grants/:grantId', classe: AUDITADA, acao: 'PERMISSION_REVOKE', emissor: RA_SVC },
  // A EXTENSÃO DE PRAZO reusa `SHARING_CHANGE`, e a escolha tem os dois lados escritos. Uma
  // ação própria (`PERMISSION_EXTEND`) custaria alargar o CHECK de `audit_trail.action`
  // (DROP/ADD CONSTRAINT mais uma linha em EXCECOES_DESTRUTIVAS), que é o mesmo preço que a
  // rota de metadado do 360 recusou pagar logo acima. E `PERMISSION_GRANT` seria pior que
  // caro, seria FALSO: ela conta concessões criadas, e estender não cria nenhuma — quem
  // contasse a ação para saber quantos acessos foram dados passaria a contar a mais. O de-para
  // dos prazos (pedido, anterior, efetivo) mora em `details`.
  { arquivo: 'src/modules/resource-access/resource-access.routes.js', rota: 'PATCH /grants/:grantId', classe: AUDITADA, acao: 'SHARING_CHANGE', emissor: RA_SVC },

  // ---------------- grupo de acesso -------------------------------------------
  // As CINCO ações são declaradas em `002_auditoria.sql`. O ciclo de vida e a
  // composição são separados de propósito: "quem criou este grupo" e "desde quando o
  // Fulano estava nele" são perguntas diferentes na investigação, e a segunda é a que
  // responde por que alguém viu um recurso.
  { arquivo: 'src/modules/access-groups/access-groups.routes.js', rota: 'POST /', classe: AUDITADA, acao: 'ACCESS_GROUP_CREATE', emissor: AG_SVC },
  { arquivo: 'src/modules/access-groups/access-groups.routes.js', rota: 'PATCH /:groupId', classe: AUDITADA, acao: 'ACCESS_GROUP_UPDATE', emissor: AG_SVC },
  { arquivo: 'src/modules/access-groups/access-groups.routes.js', rota: 'DELETE /:groupId', classe: AUDITADA, acao: 'ACCESS_GROUP_DELETE', emissor: AG_SVC },
  { arquivo: 'src/modules/access-groups/access-groups.routes.js', rota: 'POST /:groupId/members', classe: AUDITADA, acao: 'ACCESS_GROUP_MEMBER_ADD', emissor: AG_SVC },
  { arquivo: 'src/modules/access-groups/access-groups.routes.js', rota: 'DELETE /:groupId/members/:userId', classe: AUDITADA, acao: 'ACCESS_GROUP_MEMBER_REMOVE', emissor: AG_SVC },
  // A SAÍDA VOLUNTÁRIA (2026-08-23) REUSA A AÇÃO DA REMOÇÃO POR TERCEIRO, e a forma é a das duas
  // auto-edições de conta logo abaixo: `details.self === true` discrimina os dois emissores. Uma
  // ação nova custaria alargar o CHECK de `audit_trail.action` (DROP + ADD CONSTRAINT, uma linha
  // em EXCECOES_DESTRUTIVAS e uma migração) para partir em duas listas a história de um mesmo
  // acesso — que é justamente a pergunta que a trilha responde.
  { arquivo: 'src/modules/access-groups/access-groups.routes.js', rota: 'DELETE /:groupId/members/me', classe: AUDITADA, acao: 'ACCESS_GROUP_MEMBER_REMOVE', emissor: AG_SVC },

  // ---------------- compartilhamento de atlas ---------------------------------
  { arquivo: 'src/modules/sharing/sharing.routes.js', rota: 'POST /public', classe: AUDITADA, acao: 'SHARING_CHANGE', emissor: SHARING_SVC },
  { arquivo: 'src/modules/sharing/sharing.routes.js', rota: 'DELETE /public', classe: AUDITADA, acao: 'SHARING_CHANGE', emissor: SHARING_SVC },
  { arquivo: 'src/modules/sharing/sharing.routes.js', rota: 'POST /users', classe: AUDITADA, acao: 'PERMISSION_GRANT', emissor: SHARING_SVC },
  { arquivo: 'src/modules/sharing/sharing.routes.js', rota: 'PUT /users/:userId', classe: AUDITADA, acao: 'SHARING_CHANGE', emissor: SHARING_SVC },
  { arquivo: 'src/modules/sharing/sharing.routes.js', rota: 'DELETE /users/:userId', classe: AUDITADA, acao: 'PERMISSION_REVOKE', emissor: SHARING_SVC },
  // Idem à saída voluntária de grupo: mesma ação da revogação por terceiro, `details.self` a
  // discrimina, e o `actor_id` passa a ser a própria pessoa afetada.
  { arquivo: 'src/modules/sharing/sharing.routes.js', rota: 'DELETE /me', classe: AUDITADA, acao: 'PERMISSION_REVOKE', emissor: SHARING_SVC },
  // O EIXO DE GRUPO reusa as TRÊS ações do eixo de pessoa, e a reutilização é decisão: uma
  // ação nova exigiria alargar o CHECK de `audit_trail` (DROP + ADD CONSTRAINT, uma entrada
  // em EXCECOES_DESTRUTIVAS e uma migração a mais). Quem discrimina o eixo na trilha é
  // `details.groupId`, onde o eixo de pessoa põe `details.userId`.
  { arquivo: 'src/modules/sharing/sharing.routes.js', rota: 'POST /groups', classe: AUDITADA, acao: 'PERMISSION_GRANT', emissor: SHARING_SVC },
  { arquivo: 'src/modules/sharing/sharing.routes.js', rota: 'PUT /groups/:groupId', classe: AUDITADA, acao: 'SHARING_CHANGE', emissor: SHARING_SVC },
  { arquivo: 'src/modules/sharing/sharing.routes.js', rota: 'DELETE /groups/:groupId', classe: AUDITADA, acao: 'PERMISSION_REVOKE', emissor: SHARING_SVC },

  // ---------------- 360: projeto audita, foto não -----------------------------
  { arquivo: 'src/modules/streetview360/sv360.routes.js', rota: 'POST /admin/projects/upload', classe: AUDITADA, acao: 'SV360_INGEST', emissor: 'src/modules/streetview360/sv360.admin.controller.js' },
  { arquivo: 'src/modules/streetview360/sv360.routes.js', rota: 'PATCH /admin/projects/:slug/status', classe: AUDITADA, acao: 'SV360_STATUS_CHANGE', emissor: SV360_ADMIN_SVC },
  // A rota de METADADO reusa `CATALOG_UPDATE` de propósito: o projeto 360 é um dos cinco
  // tipos de recurso do catálogo, e uma ação própria custaria alargar o CHECK de
  // `audit_trail.action` (DROP/ADD CONSTRAINT mais uma linha em EXCECOES_DESTRUTIVAS) para
  // dizer a mesma coisa com outro nome. O emissor é o serviço, como nas outras duas.
  { arquivo: 'src/modules/streetview360/sv360.routes.js', rota: 'PATCH /admin/projects/:slug', classe: AUDITADA, acao: 'CATALOG_UPDATE', emissor: SV360_ADMIN_SVC },
  { arquivo: 'src/modules/streetview360/sv360.routes.js', rota: 'DELETE /admin/projects/:slug', classe: AUDITADA, acao: 'SV360_DELETE', emissor: SV360_ADMIN_SVC },
  { arquivo: 'src/modules/streetview360/sv360.routes.js', rota: 'POST /photos/batch-calibration', classe: ISENTA, motivo: CALIBRACAO_360 },
  { arquivo: 'src/modules/streetview360/sv360.routes.js', rota: 'PUT /photos/:uuid/calibration', classe: ISENTA, motivo: CALIBRACAO_360 },
  { arquivo: 'src/modules/streetview360/sv360.routes.js', rota: 'PUT /photos/:uuid/rotation-x', classe: ISENTA, motivo: CALIBRACAO_360 },
  { arquivo: 'src/modules/streetview360/sv360.routes.js', rota: 'PUT /photos/:uuid/rotation-z', classe: ISENTA, motivo: CALIBRACAO_360 },
  { arquivo: 'src/modules/streetview360/sv360.routes.js', rota: 'PUT /photos/:uuid/reviewed', classe: ISENTA, motivo: CALIBRACAO_360 },
  { arquivo: 'src/modules/streetview360/sv360.routes.js', rota: 'PUT /photos/:uuid/targets/:targetId/visibility', classe: ISENTA, motivo: CALIBRACAO_360 },
  { arquivo: 'src/modules/streetview360/sv360.routes.js', rota: 'DELETE /photos/:uuid/targets/:targetId', classe: ISENTA, motivo: CALIBRACAO_360 },
  { arquivo: 'src/modules/streetview360/sv360.routes.js', rota: 'POST /photos/:uuid/targets', classe: ISENTA, motivo: CALIBRACAO_360 },
  { arquivo: 'src/modules/streetview360/sv360.routes.js', rota: 'DELETE /photos/:uuid', classe: ISENTA, motivo: CALIBRACAO_360 },
  { arquivo: 'src/modules/streetview360/sv360.routes.js', rota: 'PUT /projects/:slug/batch-calibration', classe: ISENTA, motivo: CALIBRACAO_360 },
  { arquivo: 'src/modules/streetview360/sv360.routes.js', rota: 'POST /projects/:slug/reset-reviewed', classe: ISENTA, motivo: CALIBRACAO_360 },
  { arquivo: 'src/modules/streetview360/sv360.routes.js', rota: 'PUT /runs/:runId/batch-calibration', classe: ISENTA, motivo: CALIBRACAO_360 },

  // ---------------- usuários --------------------------------------------------
  { arquivo: 'src/modules/users/users.routes.js', rota: 'POST /', classe: AUDITADA, acao: 'USER_CREATE', emissor: USERS_SVC },
  { arquivo: 'src/modules/users/users.routes.js', rota: 'PUT /:userId', classe: AUDITADA, acao: 'USER_UPDATE', emissor: USERS_SVC },
  { arquivo: 'src/modules/users/users.routes.js', rota: 'POST /:userId/reset-password', classe: AUDITADA, acao: 'PASSWORD_RESET', emissor: USERS_SVC },
  { arquivo: 'src/modules/users/users.routes.js', rota: 'DELETE /:userId', classe: AUDITADA, acao: 'USER_DELETE', emissor: USERS_SVC },
  { arquivo: 'src/modules/users/users.routes.js', rota: 'POST /:userId/reactivate', classe: AUDITADA, acao: 'USER_REACTIVATE', emissor: USERS_SVC },
  { arquivo: 'src/modules/users/users.routes.js', rota: 'POST /:userId/api-key/rotate', classe: AUDITADA, acao: 'API_KEY_ROTATE', emissor: USERS_SVC },
  { arquivo: 'src/modules/users/users.routes.js', rota: 'POST /me/api-key/rotate', classe: AUDITADA, acao: 'API_KEY_ROTATE', emissor: USERS_SVC },
  // As chaves NOMEADAS (cláusula 10.7). Ações próprias, e não `API_KEY_ROTATE`: rotacionar
  // é um ato sobre a conta inteira, emitir e revogar são atos sobre UMA chave entre várias.
  { arquivo: 'src/modules/users/users.routes.js', rota: 'POST /me/api-keys', classe: AUDITADA, acao: 'API_KEY_CREATE', emissor: USERS_SVC },
  { arquivo: 'src/modules/users/users.routes.js', rota: 'DELETE /me/api-keys/:keyId', classe: AUDITADA, acao: 'API_KEY_REVOKE', emissor: USERS_SVC },
  { arquivo: 'src/modules/users/users.routes.js', rota: 'DELETE /:userId/api-keys/:keyId', classe: AUDITADA, acao: 'API_KEY_REVOKE', emissor: USERS_SVC },
  // AS DUAS AUTO-EDIÇÕES FECHARAM EM 2026-08-21, e as duas reusam a ação que o caminho
  // ADMINISTRATIVO já emitia: criar uma segunda ação para o mesmo fato partiria a
  // história de uma conta em duas listas que não se cruzam. `details.self === true` é o
  // que discrimina os dois emissores, e é ele que o caso de integração afirma.
  { arquivo: 'src/modules/users/users.routes.js', rota: 'PUT /me', classe: AUDITADA, acao: 'USER_UPDATE', emissor: USERS_SVC },
  { arquivo: 'src/modules/users/users.routes.js', rota: 'PUT /me/password', classe: AUDITADA, acao: 'PASSWORD_RESET', emissor: USERS_SVC },
  // O PEDIDO de troca de e-mail é auditado, e não a troca: a troca acontece depois, quando o link
  // do endereço novo é aberto. A ação reusada é `USER_UPDATE`, com `self: true` e
  // `emailChangeRequested: true`, e a linha é a MESMA nos dois desfechos (endereço livre, endereço
  // de outra conta) de propósito, porque a trilha não pode ser o canal por onde a colisão vaza.
  // O endereço pretendido NÃO entra na linha, nem por impressão: ele ainda não é fato da conta.
  { arquivo: 'src/modules/users/users.routes.js', rota: 'PUT /me/email', classe: AUDITADA, acao: 'USER_UPDATE', emissor: USERS_SVC },

  // ---------------- zonas geográficas (schema ng) -----------------------------
];

/**
 * Os `target_type` DECLARADOS e sem nenhum emissor. São QUATRO, e os dois últimos
 * são medições, não heranças:
 *
 *   - `MODEL` e `GROUP` vieram do primeiro CHECK de alvo e nunca tiveram escritor. A revisão os
 *     manteve porque removê-los seria DDL destrutiva sem ganho.
 *   - `SYSTEM` TINHA um escritor e PERDEU: era onde `setResourceVisibility`
 *     depositava o alvo que não cabia nas colunas (`target_type` sem valor para
 *     recurso, `target_id` UUID contra um slug). O alargamento devolveu o alvo às colunas e,
 *     com isso, 'SYSTEM' voltou a significar sistema — e ficou sem ninguém que o
 *     escreva.
 *   - `STREETVIEW_MARKER` também TINHA escritor e PERDEU, e por um motivo
 *     diferente dos outros três: o único emissor era o mapa
 *     `AUDIT_TARGET_TYPE_BY_TABLE` de `catalog.tables.js`, e a TABELA que aquela entrada
 *     nomeava saiu do schema. O valor sobrevive no CHECK porque
 *     tirá-lo seria DDL destrutiva sem ganho (o mesmo argumento de `MODEL`/`GROUP`)
 *     e porque linhas de trilha já gravadas podem carregá-lo.
 *
 * Está certo assim, e fica REGISTRADO aqui: um vocabulário reservado é diferente de
 * um vocabulário esquecido, e a única forma de manter a distinção é escrevê-la.
 */
const ALVOS_SEM_EMISSOR = ['GROUP', 'MODEL', 'STREETVIEW_MARKER', 'SYSTEM'];

// ============================================================================
// A VARREDURA
// ============================================================================

/** Remove comentário de bloco e de linha (o `\r` do CRLF entra na normalização). */
function semComentarios(src) {
  const normalizado = src.replace(/\r\n?/g, '\n');
  const semBloco = normalizado.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  return semBloco.split('\n').map((linha) => linha.replace(/\/\/.*/, '')).join('\n');
}

/**
 * O INVENTÁRIO: rastreado MAIS não rastreado não ignorado.
 *
 * `git ls-files src` sozinho lista só o que já passou por `git add`. O efeito é um
 * ponto cego posicionado no pior lugar possível: o arquivo que a fase corrente acabou
 * de escrever é o que ainda não foi classificado, e era o único que a varredura não
 * via. O censo respondia verde sobre um inventário que não continha o trabalho novo,
 * que é cobertura vazia com cara de aprovação.
 *
 * `--others --exclude-standard` acrescenta o NÃO RASTREADO e mantém fora o IGNORADO
 * (`node_modules/`, `coverage/`, `data/`). As duas metades são MEDIDAS — a segunda
 * pelo caso-piso, a primeira pelo controle negativo do fim deste arquivo — e nenhuma
 * delas fica afirmada aqui em prosa.
 * @param {string} [pathspec] - Relativo à raiz do pacote.
 * @returns {string[]} Caminhos relativos, só `.js`.
 */
function arquivosDoInventario(pathspec = 'src') {
  return execFileSync(
    'git', ['ls-files', '--cached', '--others', '--exclude-standard', pathspec],
    { cwd: RAIZ, encoding: 'utf8' }
  ).split('\n').map((s) => s.trim()).filter((s) => s.endsWith('.js'));
}

/**
 * Toda rota de ESCRITA dos arquivos dados, na forma `{ arquivo, rota }`.
 *
 * O caminho é lido do literal que segue o verbo, e o `\s*` cobre as declarações
 * multi-linha (a metade das rotas do 360 e do acesso a recurso é assim).
 * @param {string[]} arquivos - Caminhos relativos a `backend/`.
 * @returns {{arquivo: string, rota: string, linha: number}[]}
 */
function rotasDeEscrita(arquivos) {
  const achadas = [];
  for (const arquivo of arquivos) {
    const src = semComentarios(fs.readFileSync(path.join(RAIZ, arquivo), 'utf8'));
    const re = /router\.(post|put|patch|delete)\(\s*(['"`])([^'"`]*)\2/g;
    let m = re.exec(src);
    while (m !== null) {
      achadas.push({
        arquivo,
        rota: `${m[1].toUpperCase()} ${m[3]}`,
        linha: src.slice(0, m.index).split('\n').length,
      });
      m = re.exec(src);
    }
  }
  return achadas;
}

/** As rotas não classificadas, no formato de mensagem de erro. */
function naoClassificadas(achadas) {
  return achadas
    .filter((a) => !CENSO.some((e) => e.arquivo === a.arquivo && e.rota === a.rota))
    .map((a) => `${a.arquivo}:${a.linha} ${a.rota}`);
}

const arquivosDeRota = () => arquivosDoInventario().filter((a) => a.endsWith('.routes.js'));

// O VOCABULÁRIO DA TRILHA É LIDO POR VARREDURA, e não abrindo a baseline por nome.
//
// Hoje `002_auditoria.sql` é a ÚNICA declaração dos dois CHECK, e ler aquele arquivo por
// nome daria a resposta certa. A varredura existe pelo que vem depois: a primeira migração
// forward-only que alargar o vocabulário terá de fazê-lo por `DROP CONSTRAINT` +
// `ADD CONSTRAINT` num arquivo NOVO, porque nenhum banco que já aplicou a baseline a roda
// de novo. Um leitor fixado no nome passaria verde e ficaria cego para toda ação nova.
//
// O EFEITO DE NÃO TER CORRIGIDO ISTO seria o pior formato deste defeito: o censo
// continuaria verde e passaria a MENTIR na direção mais cara. Ele reprovaria toda
// rota nova cuja ação só apareça numa migração posterior à que ele lê ("essa ação não existe"),
// e ao mesmo tempo
// deixaria de cobrar emissor para as cinco ações novas — ou seja, exatamente a classe
// "ação declarada sem emissor" que este arquivo existe para impedir voltaria pela
// porta do próprio guarda.
//
// A REGRA É "A ÚLTIMA DECLARAÇÃO VENCE", que é o que o banco faz: percorre-se os
// arquivos em ordem numérica decrescente e usa-se o primeiro que declare aquele
// CHECK, tomando dentro dele a ÚLTIMA ocorrência (um arquivo que derrube e reponha o
// constraint termina no `ADD`). A regra "a mais recente vence" é exercitada por um caso
// com fixture SINTÉTICA, e não pela contagem de arquivos do repositório: enquanto houver
// uma declaração só, contar arquivos não discrimina nada — e exigir duas transformaria a
// consolidação do schema em vermelho, premiando quem reintroduzisse um degrau.
const DIR_MIGRACOES = 'src/database/migrations';

/** Os arquivos de migração, do MAIOR número para o menor. */
function migracoesDecrescentes() {
  const dir = path.join(RAIZ, DIR_MIGRACOES);
  const arquivos = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().reverse();
  assert.ok(arquivos.length >= 5, `esperava >= 5 migrações, achei ${arquivos.length}`);
  return arquivos.map((f) => ({ nome: f, sql: fs.readFileSync(path.join(dir, f), 'utf8') }));
}

/**
 * Os valores de UM bloco `CHECK (<col> IN (...))` dentro de um texto SQL, tomando a
 * ÚLTIMA ocorrência do marcador — um arquivo que derrube e reponha o constraint
 * termina no `ADD`, e é o `ADD` que vale.
 * @param {string} sql
 * @param {string} marcador
 * @returns {string[]} Vazio quando o marcador não aparece.
 */
function valoresDoCheck(sql, marcador) {
  const i = sql.lastIndexOf(marcador);
  if (i === -1) return [];
  const bloco = sql.slice(i, sql.indexOf('))', i));
  const semComentario = bloco.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  return [...semComentario.matchAll(/'([A-Z][A-Z0-9_]+)'/g)].map((m) => m[1]);
}

/**
 * A escolha da declaração vigente, SEM tocar no disco: recebe a lista já ordenada do maior
 * número para o menor e devolve a primeira que declara o marcador. Separada de
 * `checkVigente` para que a regra possa ser exercitada contra uma fixture sintética.
 * @param {{nome: string, sql: string}[]} arquivos - Do MAIOR número para o menor.
 * @param {string} marcador
 * @returns {{valores: string[], arquivo: string}}
 */
function checkVigenteEm(arquivos, marcador) {
  for (const { nome, sql } of arquivos) {
    const valores = valoresDoCheck(sql, marcador);
    if (valores.length > 0) return { valores, arquivo: nome };
  }
  return { valores: [], arquivo: '' };
}

/**
 * Os valores do CHECK vigente, lidos da migração mais recente que o declara.
 * @param {string} marcador - `'CHECK (action IN ('` ou `'CHECK (target_type IN ('`.
 * @returns {{valores: string[], arquivo: string}}
 */
function checkVigente(marcador) {
  const achado = checkVigenteEm(migracoesDecrescentes(), marcador);
  if (achado.valores.length === 0) assert.fail(`nenhuma migração declara ${marcador}`);
  return achado;
}

/** As ações declaradas no CHECK vigente (nunca uma terceira cópia). */
function acoesDoCheck() {
  return checkVigente('CHECK (action IN (').valores;
}

/** Os `target_type` declarados no CHECK vigente. */
function alvosDoCheck() {
  return checkVigente('CHECK (target_type IN (').valores;
}

/** O CÓDIGO (sem comentário) de todo arquivo versionado de `src/`, por caminho. */
function fontesDeSrc() {
  return new Map(arquivosDoInventario().map((a) => [
    a, semComentarios(fs.readFileSync(path.join(RAIZ, a), 'utf8')),
  ]));
}

describe('Censo da auditoria (fase F7): rota de escrita tem trilha, ou isenção escrita', () => {
  it('piso: o inventário vem do git e alcança todos os módulos de rota', () => {
    let arquivos;
    try {
      arquivos = arquivosDeRota();
    } catch (err) {
      assert.fail(
        `o inventário deste censo vem de \`git ls-files\` e o comando FALHOU (${err.message}). `
        + 'Isto é falha de ambiente, não regressão de código: rode dentro do repositório.'
      );
    }
    assert.ok(arquivos.length >= 15, `esperava >= 15 arquivos de rota, achei ${arquivos.length}`);

    // A OUTRA METADE DO INVENTÁRIO: `--others` SEM `--exclude-standard` arrastaria
    // `node_modules/` inteiro, e um censo com dezenas de milhares de arquivos de
    // terceiro é um censo que ninguém fecha. A medição é sobre o PACOTE inteiro, e não
    // sobre `src/`, porque em `src/` não há nada ignorado: medir ali seria vácuo.
    assert.ok(
      fs.existsSync(path.join(RAIZ, 'node_modules')),
      'sem `node_modules` no disco esta medição não prova nada: instale as dependências'
    );
    const doPacote = arquivosDoInventario('.');
    assert.ok(doPacote.length >= 100, `esperava >= 100 arquivos .js no pacote, achei ${doPacote.length}`);
    const lixo = doPacote.filter((a) => /(^|[/])(node_modules|coverage|dist|data)[/]/.test(a));
    assert.deepEqual(lixo, [], '`--exclude-standard` deixou entrar arquivo ignorado no inventário');
    assert.ok(arquivos.includes('src/modules/atlas/atlas.routes.js'), 'a varredura precisa alcançar o atlas');
    assert.ok(arquivos.includes('src/modules/catalog/catalog.routes.js'), 'e o catálogo');

    const achadas = rotasDeEscrita(arquivos);
    assert.ok(achadas.length >= 60, `esperava >= 60 rotas de escrita, achei ${achadas.length}`);
  });

  it('toda rota de escrita está no censo, com classe e (quando audita) ação e emissor', () => {
    const achadas = rotasDeEscrita(arquivosDeRota());
    assert.ok(achadas.length >= 60, 'guarda: censo comparado contra varredura vazia passaria verde');

    assert.deepEqual(
      naoClassificadas(achadas), [],
      'rota de ESCRITA fora do censo da auditoria. Classifique-a em '
      + `'${AUDITADA}' (com \`acao\` e \`emissor\`), '${ISENTA}' (com motivo escrito) `
      + `ou '${BURACO}' (lacuna reconhecida, com motivo e dentro do teto).`
    );
  });

  it('toda entrada do censo aponta para uma rota que EXISTE (apagar rota é tão vermelho quanto criar)', () => {
    const achadas = rotasDeEscrita(arquivosDeRota());
    assert.ok(achadas.length >= 60);

    const orfas = CENSO
      .filter((e) => !achadas.some((a) => a.arquivo === e.arquivo && a.rota === e.rota))
      .map((e) => `${e.arquivo} :: ${e.rota}`);
    assert.deepEqual(
      orfas, [],
      'entrada de censo sem rota correspondente: ou a rota foi renomeada/removida, ou o caminho '
      + 'está escrito diferente do literal. Um censo que descreve rotas inexistentes deixa de '
      + 'descrever as que existem.'
    );

    // Duplicata silenciosa: duas entradas para a mesma rota fariam a contagem por
    // classe mentir sem que nada mais reclamasse.
    const chaves = CENSO.map((e) => `${e.arquivo} :: ${e.rota}`);
    assert.equal(new Set(chaves).size, chaves.length, 'entrada duplicada no censo');
  });

  it('cada rota AUDITADA nomeia uma ação do CHECK e um emissor que realmente a cita', () => {
    const auditadas = CENSO.filter((e) => e.classe === AUDITADA);
    assert.ok(auditadas.length >= 30, `esperava >= 30 rotas auditadas, achei ${auditadas.length}`);

    const acoes = new Set(acoesDoCheck());
    // PISO 29, e ele BAIXOU de 30 em 2026-08-19: as três ações ZONE_* saíram do CHECK
    // junto com o sistema de zonas. Piso decrescente só se justifica com a remoção
    // escrita ao lado, senão ele vira o número que alguém abaixa quando incomoda.
    assert.ok(acoes.size >= 29, `o CHECK devolveu só ${acoes.size} ações`);

    const fontes = fontesDeSrc();
    const quebradas = auditadas.flatMap((e) => {
      const problemas = [];
      if (!e.acao || !acoes.has(e.acao)) {
        problemas.push(`${e.arquivo} :: ${e.rota} declara a ação '${e.acao}', que não está no CHECK vigente de audit_trail.action`);
      }
      const emissor = fontes.get(e.emissor);
      if (!emissor) {
        problemas.push(`${e.arquivo} :: ${e.rota} aponta para o emissor '${e.emissor}', que não existe em src/`);
      } else if (!emissor.includes(`'${e.acao}'`)) {
        // A LIGAÇÃO ROTA -> EMISSOR é o que uma lista de ações sozinha não prende:
        // uma ação com emissor em ALGUM lugar do sistema não diz que ESTA rota
        // escreve trilha. O texto é o CÓDIGO, sem comentário, senão uma menção em
        // prosa satisfaria o guarda.
        problemas.push(`${e.arquivo} :: ${e.rota} declara '${e.acao}' em ${e.emissor}, que não a emite`);
      }
      return problemas;
    });
    assert.deepEqual(quebradas, [], 'entrada AUDITADA sem ação válida ou sem emissor que a escreva');
  });

  it('toda isenção e todo buraco têm motivo escrito, e os buracos não crescem em silêncio', () => {
    const isentas = CENSO.filter((e) => e.classe === ISENTA);
    const buracos = CENSO.filter((e) => e.classe === BURACO);
    assert.ok(isentas.length >= 15, `esperava >= 15 isenções, achei ${isentas.length}`);
    assert.ok(buracos.length >= 1, 'guarda: a classe BURACO precisa estar em uso, senão ela não discrimina nada');

    const semMotivo = [...isentas, ...buracos]
      .filter((e) => !e.motivo || e.motivo.length < 80)
      .map((e) => `${e.arquivo} :: ${e.rota}`);
    assert.deepEqual(
      semMotivo, [],
      'isenção sem motivo escrito é a mesma coisa que rota sem trilha, só que com uma linha a mais'
    );

    // O TETO, E ELE APERTA A CADA BURACO FECHADO. Sem ele, a saída fácil para uma rota
    // nova sem trilha seria classificá-la como BURACO e seguir em frente — que é
    // exatamente como LOGIN, LOGOUT e ATLAS_DELETE sobreviveram sem emissor desde o
    // primeiro CHECK de ação. Um teto que ficasse no número antigo depois de os buracos
    // caírem seria folga: espaço para três lacunas novas passarem verdes.
    //
    // Eram SETE até 2026-08-21; a onda de auditoria por OM fechou três (auto-edição de
    // perfil, troca de senha pelo titular e o overlay de disponibilidade do atlas), e o
    // teto desceu para quatro. Em 2026-08-24 caíram mais TRÊS de uma vez, o CRUD de
    // postos inteiro, e o teto desceu para UM.
    //
    // A JUSTIFICATIVA QUE MANTINHA OS QUATRO DEIXOU DE VALER PARA TRÊS DELES, e o que a
    // derrubou não foi o dono ter mudado de ideia sobre o preço: foi o preço ter caído.
    // Ela dizia que vocabulário novo no CHECK de `action` custa migração com par
    // DROP/ADD CONSTRAINT, e mais uma linha à mão em `EXCECOES_DESTRUTIVAS`
    // (`tests/unit/migrations-higiene.test.js`). Isso passou a valer só a partir do dia
    // em que existir banco de produção: com a base consolidada em baselines escritas no
    // estado final, e nenhuma delas aplicada fora deste branch, o CHECK simplesmente
    // NASCE largo em `002_auditoria.sql` e nenhum DDL destrutivo é escrito.
    //
    // O QUE SOBRA É UM SÓ, e ele não é caro pelo mesmo motivo: `POST /admin/cleanup` do
    // sync apaga o log de operações, que é justamente a trilha alternativa que isenta
    // cinco outras rotas desta lista. Fechá-lo é decisão de produto sobre o que a linha
    // deve dizer (quantas ops, de qual atlas, até que data), não uma migração.
    //
    // Com o teto em 1 e a classe exigida em uso, este par de asserções fixa o buraco
    // restante: fechá-lo obriga a mexer aqui, e abrir um novo também.
    assert.ok(
      buracos.length <= 1,
      `o buraco conhecido é 1 e não pode crescer sem decisão; achei ${buracos.length}`
    );

    // Nenhuma entrada pode ter classe fora das três, nem ação declarada sem auditar.
    const malFormadas = CENSO
      .filter((e) => ![AUDITADA, ISENTA, BURACO].includes(e.classe)
        || (e.classe !== AUDITADA && (e.acao || e.emissor)))
      .map((e) => `${e.arquivo} :: ${e.rota}`);
    assert.deepEqual(malFormadas, [], 'entrada com classe inválida, ou com ação declarada sem auditar');
  });

  it('a leitura pega a declaração MAIS RECENTE, e não a primeira que encontrar', () => {
    // O GUARDA DO GUARDA, contra fixture SINTÉTICA. Enquanto o repositório tinha duas
    // declarações (a baseline mais um alargamento), este caso as contava; com o schema
    // consolidado há UMA, e contar arquivos deixaria de discriminar qualquer coisa — pior,
    // exigir duas faria a consolidação reprovar e premiaria quem reintroduzisse um degrau.
    // A afirmação que a contagem aproximava é esta: dadas duas declarações, vence a de
    // maior número, e o resultado não pode PERDER valor da anterior.
    const sintetico = [
      { nome: '099_alarga.sql', sql: "ALTER TABLE audit_trail ADD CONSTRAINT x CHECK (action IN ('LOGIN','LOGOUT','NOVA_ACAO'));" },
      { nome: '002_auditoria.sql', sql: "action VARCHAR(50) NOT NULL CHECK (action IN ('LOGIN','LOGOUT'))" },
    ];
    const vigente = checkVigenteEm(sintetico, 'CHECK (action IN (');
    assert.equal(vigente.arquivo, '099_alarga.sql', 'a leitura não pegou a migração mais recente');
    assert.deepEqual(vigente.valores, ['LOGIN', 'LOGOUT', 'NOVA_ACAO']);

    // Alargar não pode ESTREITAR: uma leitura que perdesse valor antigo passaria num teste
    // de contagem e quebraria o banco no primeiro INSERT com a ação perdida.
    const antigos = valoresDoCheck(sintetico[1].sql, 'CHECK (action IN (');
    assert.deepEqual(antigos.filter((a) => !vigente.valores.includes(a)), []);

    // E o repositório real: a declaração vigente existe, sai de um arquivo que está no
    // disco, e carrega o vocabulário inteiro.
    const real = checkVigente('CHECK (action IN (');
    assert.ok(
      migracoesDecrescentes().some((m) => m.nome === real.arquivo),
      `a declaração vigente veio de um arquivo fora do diretório de migrações: ${real.arquivo}`
    );
    assert.ok(real.valores.length >= 29, `esperava >= 29 acoes no CHECK vigente, achei ${real.valores.length}`);
  });

  it('toda ação declarada no CHECK tem pelo menos UM emissor em src/', () => {
    // ESTE É O CASO QUE FALTAVA. `LOGIN`, `LOGOUT` e `ATLAS_DELETE` ficaram
    // declaradas e sem emissor por toda a vida do projeto, e o sintoma não é erro: é
    // um filtro que responde lista vazia e parece resposta. A varredura é
    // independente do censo de rotas de propósito — ela pergunta pelo outro lado da
    // ponte (a ação existe no vocabulário, alguém a escreve?).
    const acoes = acoesDoCheck();
    assert.ok(acoes.length >= 29, `esperava >= 29 ações no CHECK, achei ${acoes.length}`);
    assert.equal(new Set(acoes).size, acoes.length, 'ação duplicada no CHECK vigente');

    const fontes = [...fontesDeSrc().values()];
    assert.ok(fontes.length >= 100, `esperava >= 100 fontes em src/, achei ${fontes.length}`);

    const semEmissor = acoes.filter((a) => !fontes.some((texto) => texto.includes(`'${a}'`)));
    assert.deepEqual(
      semEmissor, [],
      'ação declarada no CHECK e sem nenhum emissor: quem filtrar a trilha por ela recebe lista '
      + 'vazia e conclui que o evento nunca aconteceu'
    );
  });

  it('todo `target_type` do CHECK tem emissor, exceto os quatro declarados sem escritor', () => {
    const alvos = alvosDoCheck();
    // PISO 13, de 14: ZONE saiu do vocabulario com o sistema de zonas.
    assert.ok(alvos.length >= 13, `esperava >= 14 tipos de alvo, achei ${alvos.length}`);

    const fontes = [...fontesDeSrc().values()];
    const semEmissor = alvos.filter((a) => !fontes.some((texto) => texto.includes(`'${a}'`)));
    assert.deepEqual(
      semEmissor.sort(), ALVOS_SEM_EMISSOR,
      'a lista de alvos sem emissor mudou. `MODEL`, `GROUP`, `STREETVIEW_MARKER` e `SYSTEM` estão '
      + 'declarados e sem escritor por razões escritas ao lado da constante; qualquer OUTRO tipo '
      + 'sem emissor é vocabulário que ninguém escreve, e um dos quatro que ganhe emissor precisa '
      + 'sair da lista'
    );
  });

  // ---------------------------------------------------------------------------
  // O CONTROLE NEGATIVO
  // ---------------------------------------------------------------------------
  it('a varredura REPROVA uma rota de escrita não classificada (provado, não afirmado)', () => {
    // A MESMA FUNÇÃO usada nos casos acima, apontada para uma fixture que declara uma
    // rota de escrita e não está no censo. Sem isto, "o censo pega rota nova" seria
    // uma afirmação do guarda sobre o guarda — e um censo cuja varredura não casasse
    // mais nada (regex quebrada, `git` mudando de saída) passaria os outros casos
    // verdes, comparando vazio com vazio.
    const fixture = 'tests/fixtures/censo-auditoria/exemplo-nao-classificado.routes.js';
    const achadas = rotasDeEscrita([fixture]);
    assert.deepEqual(
      achadas.map((a) => a.rota), ['POST /rota-de-escrita-sem-trilha'],
      'a varredura precisa ENXERGAR a rota da fixture; se ela deixar de casar, os outros casos '
      + 'deste arquivo passam verdes sem verificar nada'
    );

    const acusadas = naoClassificadas(achadas);
    assert.equal(acusadas.length, 1, 'a rota da fixture precisa ser ACUSADA como não classificada');
    assert.match(acusadas[0], /POST \/rota-de-escrita-sem-trilha/);

    // E a discriminação: a MESMA função, sobre as rotas REAIS, não acusa ninguém.
    // Um par, e não duas afirmações soltas: sem o lado positivo, "acusa" também
    // seria o comportamento de uma função que acusa tudo.
    assert.deepEqual(naoClassificadas(rotasDeEscrita(arquivosDeRota())), []);
  });

  it('o inventário ENXERGA arquivo NOVO ainda não rastreado (provado, não afirmado)', () => {
    // O SEGUNDO CEGO DESTE ARQUIVO, e o mais fácil de não ver, porque ele não erra a
    // classificação: erra o CONJUNTO. `git ls-files` sozinho enumera o índice, então a
    // rota de escrita escrita há cinco minutos — a que ninguém classificou ainda —
    // ficava fora da varredura até alguém dar `git add`, e o censo passava verde sem
    // tê-la olhado. Provar a correção exige um arquivo que EXISTA e NÃO esteja
    // rastreado: ele nasce aqui e morre no `finally`.
    const dir = 'tests/fixtures/censo-auditoria';
    const relativo = `${dir}/tmp-nao-rastreado.routes.js`;
    const abs = path.join(RAIZ, relativo);
    fs.writeFileSync(abs, [
      `// Path: ${relativo}`,
      '// Temporário: criado e apagado pelo controle negativo de `auditoria-censo.test.js`.',
      "router.post('/rota-de-escrita-recem-nascida', ctrl.qualquer);",
      '',
    ].join('\n'));

    try {
      // CONTROLE: o git precisa CONCORDAR que ele não está rastreado, e precisa
      // enxergar a fixture rastreada nos dois modos. Sem este par, o caso passaria
      // verde num mundo em que alguém tivesse dado `git add` no arquivo temporário, e
      // aí ele não provaria nada sobre `--others`.
      const soRastreados = execFileSync('git', ['ls-files', dir], { cwd: RAIZ, encoding: 'utf8' });
      assert.ok(
        !soRastreados.includes('tmp-nao-rastreado'),
        'a fixture temporária não pode estar rastreada, senão este caso não distingue os dois modos'
      );
      assert.ok(
        soRastreados.includes('exemplo-nao-classificado.routes.js'),
        'o pathspec precisa alcançar a fixture rastreada'
      );

      const inventario = arquivosDoInventario(dir);
      assert.ok(
        inventario.includes(relativo),
        'o inventário precisa enxergar o arquivo NÃO RASTREADO: é ele que representa o trabalho da '
        + 'fase corrente, e era exatamente o que `git ls-files` sozinho deixava de fora'
      );
      assert.ok(
        inventario.includes(`${dir}/exemplo-nao-classificado.routes.js`),
        'e o rastreado precisa continuar dentro: a correção SOMA, não troca'
      );

      // E A CADEIA INTEIRA, que é o que transforma "o inventário vê" em "o guarda
      // pega": o arquivo novo é varrido e a rota dele é ACUSADA, pela MESMA função dos
      // casos acima.
      const acusadas = naoClassificadas(
        rotasDeEscrita(inventario.filter((a) => a.endsWith('.routes.js')))
      );
      assert.ok(
        acusadas.some((a) => a.includes('rota-de-escrita-recem-nascida')),
        `a rota do arquivo não rastreado precisa ser ACUSADA; acusadas: ${acusadas.join(' | ')}`
      );
    } finally {
      fs.rmSync(abs, { force: true });
    }
  });
});
