// Path: src/middleware/require-audit-reader.js
// Gate de LEITURA da trilha de auditoria, com DOIS ramos e um recorte.
//
// A rota era `requireAdmin`. Ela passa a servir também quem MANTÉM o acervo de uma OM,
// e o que separa os dois ramos não é o nível de poder: é o ALCANCE. O administrador lê
// a trilha inteira; quem mantém acervo lê a da OM dele, e só. O recorte NÃO é parâmetro
// do chamador — este middleware o resolve e o deixa em `req.auditScope`, e o serviço o
// impõe numa linha (`audit.service.js`). Uma query string que pedisse OM alheia seria
// ignorada, nunca obedecida.
//
// O PAPEL VEM DO BANCO, NUNCA DO JWT, pela mesma razão de `fn_has_global_data_access` e
// do cabeçalho de `resource-access.js`: o token vive até 15 min e um crachá revogado
// continuaria valendo por essa janela inteira. Aqui a consulta é uma só, e resolve os
// dois ramos de uma vez.
//
// A LIVENESS ESPELHA `fn_can_produce_resource`, e são TRÊS termos, não dois: conta
// ativa, OM de LOTAÇÃO ativa e OM PRODUTORA ativa. As três colunas são independentes —
// `organization_id` (lotação) e `producer_org_id` (escopo) podem apontar para
// organizações DIFERENTES, e desativar qualquer uma das duas suspende o que a pessoa
// alcança por ela. A revisão adversarial mediu o par que faltava: com só os dois
// primeiros termos, o produtor cuja OM PRODUTORA foi desativada perdia o direito de
// produzir (`fn_can_produce_resource = false`, medido) e CONTINUAVA lendo a trilha do
// acervo daquela OM. Desativar uma OM é kill-switch declarado no produto, e um
// kill-switch que fecha a escrita e deixa a leitura aberta não é kill-switch.
//
// O TERMO DA PRODUTORA CARREGA O DISJUNTO `u.role = 'admin'`, e ele não é folga: o
// administrador não tem `producer_org_id`, então `COALESCE(po.is_active, false)` sem o
// disjunto derrubaria justamente quem administra. É a mesma armadilha que o comentário
// de `fn_can_produce_resource` nomeia ao pôr a checagem DEPOIS do early return de papel
// dentro da função SQL; aqui, com um `WHERE` só, ela vira disjunção.
//
// O TERMO DA LOTAÇÃO VALE TAMBÉM PARA O ADMINISTRADOR, e isso é espelho fiel de
// `fn_can_produce_resource`, cujo `WHERE` derruba antes do `IF v_role = 'admin'`. UMA
// REVISÃO LEU ISSO COMO DIVERGÊNCIA de `requireAdmin` (que decide pelo JWT e não
// consulta o banco) e previu que o administrador de lotação desativada manteria
// `GET /users` e perderia `GET /audit`. MEDIDO: os dois respondem 403, porque a
// reconciliação ao vivo do `auth` (`utils/org-status.js`) barra membro de OM desativada
// antes de qualquer gate. Ou seja, pela rota não há divergência; o termo aqui é a
// segunda linha de defesa e o que mantém o espelho fiel quando o middleware é chamado
// sozinho. O caso que mede as duas metades está em
// `tests/integration/auditoria-gate.test.js`.
//
// POR QUE ARQUIVO PRÓPRIO em vez de crescer `resource-access.js`: aquele arquivo é
// classificado como gate de PODER no censo de papel global, e um arquivo de PODER não
// pode citar `producer` — este cita, porque o escopo de produção é metade da resposta.
//
// E POR QUE O GATE NÃO É `fn_has_global_data_access`: o credenciado LÊ todo recurso
// privado e não administra coisa nenhuma. A trilha do sistema não é acervo: ela conta
// quem fez o quê com contas, atlas, configuração e permissões. Ele leva 403 aqui, e o
// caso que afirma isso por nome é o controle de que o gate não foi escrito com o
// predicado errado.

import { ForbiddenError, UnauthorizedError } from '../utils/errors.js';
import { oneOrNone } from '../database/index.js';
import { principalUserId } from '../utils/principal.js';

/**
 * Quem lê a trilha, resolvido NO BANCO numa consulta só.
 *   $1 = userId (uuid)
 */
const AUDIT_READER_ACTOR = `
  SELECT (u.role = 'admin')  AS administra,
         u.producer_org_id   AS escopo
    FROM users u
    LEFT JOIN organizations o  ON o.id  = u.organization_id
    LEFT JOIN organizations po ON po.id = u.producer_org_id
   WHERE u.id = $1::uuid
     AND u.is_active = true
     AND COALESCE(o.is_active, true) = true
     AND (u.role = 'admin' OR COALESCE(po.is_active, false) = true)
`;

/**
 * Middleware: administrador (tudo) OU produtor (só a OM dele).
 *
 * Deixa `req.auditScope = { administra: boolean, orgId: string|null }`. O objeto nasce
 * ANTES de qualquer `await` na forma mais FECHADA possível, para que um caminho de erro
 * que escapasse não deixasse o serviço lendo `undefined` como "administra tudo".
 *
 * @type {import('express').RequestHandler}
 */
export function requireAuditReader(req, res, next) {
  req.auditScope = { administra: false, orgId: null };
  Promise.resolve().then(async () => {
    const userId = principalUserId(req.user);
    // Sem credencial é problema de AUTENTICAÇÃO (401), não de autorização (403), como
    // em `require-admin.js`. A rota já roda atrás do `auth` estrito, então isto é a
    // segunda linha de defesa e não a primeira.
    if (!userId) return next(new UnauthorizedError('Authentication required'));

    const linha = await oneOrNone(AUDIT_READER_ACTOR, [userId]);
    if (linha?.administra === true) {
      req.auditScope = { administra: true, orgId: null };
      return next();
    }
    if (linha?.escopo) {
      req.auditScope = { administra: false, orgId: linha.escopo };
      return next();
    }

    return next(new ForbiddenError(
      'É preciso ser administrador ou produtor para ler a trilha de auditoria.',
    ));
  }).catch(next);
}
