// Path: src/middleware/resource-access.js
// Gates de acesso a RECURSO (modelo 3D, camada de dados, camada de análise,
// panorama 360). Eixo distinto do de atlas: `requireAtlasPermission` responde
// "esta pessoa pode mexer NESTE atlas", e estes respondem "esta pessoa pode ver /
// repassar ESTE recurso".
//
// O papel global é lido do BANCO (`fn_has_global_data_access`), nunca do
// `req.user.role`, e a razão é a mesma que fez a função nascer em SQL: o token
// vive até 15 min e `flexibleAuth` não reconcilia, então um credenciado rebaixado
// carregaria o papel antigo por essa janela inteira.

import { ForbiddenError, NotFoundError, BadRequestError } from '../utils/errors.js';
import { one, oneOrNone } from '../database/index.js';
import { principalUserId } from '../utils/principal.js';
import { assertProductionTypeOf } from '../modules/catalog/catalog.tables.js';
import { requireAtlasPermission } from './permissions.js';
import * as svc from '../modules/resource-access/resource-access.service.js';

/**
 * Sobe o `atlasId` da QUERY para `req.params`.
 *
 * DUAS RAZÕES, e a segunda é a que morde. A primeira é a mesma do módulo `debug`:
 * `requireAtlasPermission` lê de `req.params`. A segunda é
 * `confineVisitorPrincipal` (dentro de `auth`), que confina o visitante de link
 * público comparando `req.params.atlasId || req.params.aId || req.params.id` com o
 * `publicAtlasId` do token — como esta rota recebe o atlas na QUERY, o visitante
 * cairia num 403 sem que nada estivesse errado. Por isso este middleware roda
 * ANTES de `auth`, e não depois como no `debug`.
 *
 * Ao contrário do `liftAtlasIdToParams` do `debug`, aqui o parâmetro é OPCIONAL:
 * "sem atlas em foco" é estado legítimo (a pessoa entrou e ainda não abriu
 * projeto nenhum), e responder 400 ali transformaria o login numa falha.
 *
 * SÃO DOIS CONSUMIDORES desde a fase F9, e a segunda razão acima NÃO alcança o
 * novo: as leituras do 360 correm sob `flexibleAuth`, e `confineVisitorPrincipal`
 * mora dentro do `auth` ESTRITO, que não roda lá. Lá quem confina o visitante é
 * `requireAtlasPermission`, que carrega a mesma checagem — e por isso a ordem
 * `validate` → este → gate continua sendo a mesma nos dois, por uma razão só
 * (`req.params`) em vez de duas.
 */
export function liftOptionalAtlasId(req, res, next) {
  const atlasId = req.query?.atlasId;
  if (atlasId) req.params.atlasId = atlasId;
  next();
}

/**
 * O gate de atlas que roda SÓ QUANDO há atlas em foco.
 *
 * O UUID DO ATLAS NÃO É SENHA, e este middleware existe para que ele nunca vire uma.
 * Receber `?atlasId=` diz apenas QUAL empréstimo o chamador quer usar; quem diz que
 * ele pode usá-lo é `requireAtlasPermission('read')`, que resolve dono, share,
 * `is_public` e — antes de tudo — CONFINA o visitante de link público ao atlas do
 * próprio token. Sem esta linha, `fn_granted_resource_ids` entregaria todo recurso
 * emprestado a qualquer um que soubesse o UUID do atlas, e o UUID viaja em toda URL
 * de compartilhamento.
 *
 * POR QUE NÃO ESCREVER UM TERCEIRO GATE: `requireAtlasPermission` já carrega a
 * confinação do visitante (o mesmo que `confineVisitorPrincipal` faz dentro do `auth`
 * estrito, que NÃO roda nas rotas de leitura do 360, servidas por `flexibleAuth`).
 * Duas definições de "este chamador alcança este atlas" é a dívida que este eixo
 * inteiro existe para não contrair.
 *
 * O NÍVEL É `read` DE PROPÓSITO, o mais baixo da escada: o empréstimo é uma
 * propriedade do atlas que TODO membro enxerga, inclusive o Visualizador e o
 * visitante de link público. Exigir mais transformaria "ver o atlas" em "ver o atlas
 * menos os recursos emprestados", que é a metade que ninguém entende na tela.
 *
 * O QUE ACONTECE COM ATLAS INALCANÇÁVEL, e a escolha é deliberada: o erro de
 * `requireAtlasPermission` PROPAGA (404 para quem não tem relação nenhuma, que é o
 * caso normal; 403 é inalcançável aqui porque `read` é o piso). A alternativa era
 * degradar para escopo nulo e responder o conteúdo público, o que mantém a camada 360
 * desenhada no mapa quando o share cai; foi recusada porque torna uma falha de
 * autorização indistinguível de "este atlas não empresta nada", e um eixo de acesso
 * que falha em silêncio é o que esta fase inteira existe para consertar. O par de
 * testes (positivo e negativo) de `sv360-empréstimo-http.test.js` fixa a escolha.
 *
 * Sem `atlasId` NÃO há gate: "sem atlas em foco" é o estado normal de quem abre o 360
 * pela URL, e cobrar atlas ali quebraria o caminho anônimo que o backend promete.
 */
const gateDeLeituraDeAtlas = requireAtlasPermission('read');
export function requireAtlasScopeWhenPresent(req, res, next) {
  if (!req.params?.atlasId) return next();
  return gateDeLeituraDeAtlas(req, res, next);
}

/**
 * true quando o principal tem papel global de dado (admin ou CREDENCIADO).
 *
 * O papel `curator` nunca chegou a existir fora de uma revisão da migração 018: ele
 * foi SUBSTITUÍDO por `credenciado` antes de qualquer banco aplicá-lo, e o CHECK de
 * `users.role` recusa a palavra antiga. Prosa que a repete manda quem procurar o
 * papel no schema procurar um valor que o banco rejeita.
 * @param {object} req
 * @returns {Promise<boolean>}
 */
async function hasGlobalDataAccess(req) {
  const userId = principalUserId(req.user);
  if (!userId) return false;
  const row = await one('SELECT fn_has_global_data_access($1::uuid) AS ok', [userId]);
  return row.ok === true;
}

/**
 * true quando o ator MANTÉM este recurso (o eixo de PRODUÇÃO).
 *
 * Wrapper de `fn_can_produce_resource`, a MESMA função que gateia o `WHERE` de toda
 * escrita de catálogo e que `fn_can_see_resource` compõe — não há aqui uma segunda
 * cópia da regra. Ela levanta para tipo fora da whitelist, e é por isso que o
 * chamador roda depois do Joi da rota.
 * @param {string|null} userId
 * @param {string} type
 * @param {string} resourceId
 * @returns {Promise<boolean>}
 */
async function producesResource(userId, type, resourceId) {
  if (!userId) return false;
  const row = await one(
    'SELECT fn_can_produce_resource($1::uuid, $2::text, $3::text) AS ok',
    [userId, type, resourceId],
  );
  return row.ok === true;
}

/**
 * true quando o ator tem uma concessão VIVA de nível `view_share` neste recurso.
 *
 * "Viva" inclui o PRAZO, e não é este arquivo que o afirma: `LIVE_GRANTS_OF_ACTOR`
 * carrega `expires_at > NOW()`, de modo que quem já não VÊ o recurso também não o
 * repassa. D3: a estrutura é um DAG, então basta UMA concessão `view_share` entre as
 * vivas.
 * @param {string|null} userId
 * @param {string} type
 * @param {string} resourceId
 * @returns {Promise<boolean>}
 */
async function hasShareGrant(userId, type, resourceId) {
  const vivas = await svc.liveGrantsOfActor(userId, type, resourceId);
  return vivas.some((g) => g.grant_level === 'view_share');
}

/**
 * Gate de COMPARTILHAR: papel global de dado, ou uma concessão viva com
 * `grant_level = 'view_share'` naquele recurso.
 *
 * `view` NÃO passa, e essa é a única diferença entre os dois níveis: quem recebeu
 * acesso simples vê e não repassa. O teste negativo
 * (`resource-grants-escalonamento.test.js`) é o que impede a distinção de virar
 * prosa.
 *
 * O resultado do papel global fica em `req.hasGlobalDataAccess` porque o serviço
 * precisa dele logo em seguida (é quem decide `parent_grant_id = NULL`), e
 * reconsultar seria uma segunda leitura do mesmo fato — que é como duas respostas
 * diferentes para a mesma pergunta aparecem numa requisição só.
 *
 * ELE NÃO TEM O RAMO DE PRODUÇÃO, e a assimetria com `requireResourceRelay` é
 * deliberada: quem passa por aqui vai CONCEDER, e `grantResource` pendura a concessão
 * nova num `parent_grant_id` que só existe quando o ator tem papel global (raiz) ou
 * uma concessão `view_share` de onde derivar. Deixar o produtor entrar aqui trocaria
 * um 403 do gate por um 403 do serviço, com outra mensagem; dar-lhe concessão de raiz
 * é decisão de produto, não conserto de segurança.
 */
export function requireResourceShare(req, res, next) {
  Promise.resolve().then(async () => {
    const { type, id } = req.params;
    req.hasGlobalDataAccess = await hasGlobalDataAccess(req);
    if (req.hasGlobalDataAccess) return next();

    if (await hasShareGrant(principalUserId(req.user), type, id)) return next();

    return next(new ForbiddenError('É preciso ter acesso com permissão de compartilhar para esta ação.'));
  }).catch(next);
}

/**
 * Gate de REPASSAR um recurso a um atlas: o segundo degrau de
 * `POST /atlas/:atlasId/resources`.
 *
 * EMPRESTAR É REPASSAR, e é essa a leitura que faltava. O gate era `manage` no atlas
 * mais `assertCanSeeResource`, e `fn_can_see_resource` não distingue NÍVEL de
 * concessão: quem tinha só `view` — o nível cuja definição é "vê e NÃO repassa" —
 * anexava o recurso ao atlas dele e, com isso, o entregava a todo membro daquele
 * atlas. A distinção `view`/`view_share` continuava escrita em
 * `requireResourceShare`, e o caminho do empréstimo passava por fora dela.
 *
 * A AUTORIDADE EXIGIDA É A DE REPASSAR, com um ramo a mais: papel global de dado,
 * PRODUÇÃO daquele recurso, ou concessão viva `view_share`. Os ramos são os mesmos
 * objetos de `requireResourceShare` (`hasGlobalDataAccess`, `hasShareGrant`) mais
 * `producesResource`, que delega ao `fn_can_produce_resource` do banco: nenhuma regra
 * é redefinida aqui. O produtor entra porque o acervo da OM dele é dele — exigir que
 * um administrador lhe conceda acesso ao que ele mantém inverte a relação, e o
 * argumento está por extenso na migração 019.
 *
 * 403 E NÃO 404, ao contrário do gate irmão: `assertCanSeeResource` roda ANTES e já
 * respondeu 404 para o que este ator não enxerga, então quem chega aqui JÁ sabe que o
 * recurso existe. Um 404 nesta linha não esconderia nada e mentiria sobre a causa.
 *
 * O CASO ANÔNIMO EM ATLAS `is_public`, nomeado aqui porque é o extremo do eixo e não
 * estava escrito em lugar nenhum: `requireAtlasScopeWhenPresent` resolve `read` para
 * `userId` NULO quando o atlas é público (R4), e o braço de empréstimo de
 * `fn_granted_resource_ids` exige `p_atlas_id IS NOT NULL` sem pedir nada sobre
 * `p_user_id`. Logo um recurso PRIVADO anexado a um atlas que depois vira público é
 * entregue a chamador SEM CREDENCIAL NENHUMA, por `GET /sv360/projects?atlasId=`, por
 * `GET /resource-access/visible` e pelas listagens de catálogo. Isso é CONSEQUÊNCIA
 * ACEITA, não defeito: o visitante de link público herdar o empréstimo é decisão
 * registrada (R4), e o que a torna defensável é justamente este gate — a cadeia
 * inteira passa a começar em alguém com autoridade para repassar aquele recurso, e
 * publicar o atlas depois é ato deliberado de quem já a tinha. Sem ele, a mesma cadeia
 * começava em `view`, o nível definido como "não repassa", e terminava em acesso
 * anônimo.
 */
export function requireResourceRelay(req, res, next) {
  Promise.resolve().then(async () => {
    const type = req.body?.resourceType ?? req.params?.type;
    const resourceId = req.body?.resourceId ?? req.params?.id;
    if (!type || !resourceId) {
      return next(new BadRequestError('resourceType e resourceId são obrigatórios'));
    }

    if (await hasGlobalDataAccess(req)) return next();

    const userId = principalUserId(req.user);
    if (await producesResource(userId, type, resourceId)) return next();
    if (await hasShareGrant(userId, type, resourceId)) return next();

    return next(new ForbiddenError(
      'É preciso ter acesso com permissão de compartilhar para emprestar este recurso.',
    ));
  }).catch(next);
}

/**
 * O ator de uma REVOGAÇÃO, resolvido NO BANCO numa consulta só.
 *
 * `administra` é o papel global de ADMINISTRAÇÃO, e não `fn_has_global_data_access`:
 * ver todo recurso privado (o que o credenciado faz) e desfazer a concessão de
 * outra pessoa são poderes diferentes. Resolvido a partir do UUID, como todo o
 * resto deste arquivo, e não de `req.user.role` — aqui o caminho é `auth` estrito,
 * que reconcilia, mas manter as duas leituras no MESMO lugar é o que impede uma
 * segunda resposta para a mesma pergunta dentro de uma requisição só.
 *   $1 = id da concessão (uuid), $2 = userId (uuid, nullable)
 */
const GRANT_REVOKER_ACTOR = `
  SELECT g.id,
         (g.granted_by = $2::uuid) AS concedeu,
         EXISTS (SELECT 1
                   FROM users u
                   LEFT JOIN organizations o ON o.id = u.organization_id
                  WHERE u.id = $2::uuid
                    AND u.is_active = true
                    AND COALESCE(o.is_active, true) = true
                    AND u.role = 'admin') AS administra
    FROM resource_grants g
   WHERE g.id = $1::uuid
`;

/**
 * Gate de REVOGAR: ADMINISTRADOR revoga qualquer linha; qualquer outro ator revoga
 * só as que ELE concedeu.
 *
 * O CREDENCIADO SAIU DO RAMO CURINGA, e essa é a mudança da fase F9. O gate perguntava
 * `fn_has_global_data_access`, que é o predicado de VER dado privado e inclui o
 * credenciado — então o papel definido como "lê todo recurso privado e NÃO ESCREVE
 * NADA" derrubava a concessão de terceiros, subárvore inclusa. Ele continua concedendo
 * nos dois níveis (`requireResourceShare` não muda): o desenho é "o credenciado concede
 * e revoga O QUE ELE DEU", e o que ele deu está em `granted_by`.
 *
 * Repare que isto NÃO é uma lista fechada de papel disfarçada: o ramo largo pergunta
 * por UM papel (o que administra o sistema) e o ramo estreito não pergunta por papel
 * nenhum — pergunta por autoria. Um papel novo entra por `granted_by` sem que ninguém
 * precise editar este arquivo, que é o oposto do defeito que a constituição descreve.
 *
 * Não basta ter `view_share` no recurso: revogar a concessão de outra pessoa
 * derrubaria uma subárvore que não é sua, e a poda é exatamente a operação cujo
 * alcance passa longe da linha que se aponta.
 */
export function requireGrantRevoker(req, res, next) {
  Promise.resolve().then(async () => {
    const linha = await oneOrNone(GRANT_REVOKER_ACTOR, [
      req.params.grantId, principalUserId(req.user),
    ]);
    if (!linha) return next(new NotFoundError('Grant'));

    if (linha.administra === true || linha.concedeu === true) return next();

    return next(new ForbiddenError('Só quem concedeu esta permissão (ou um administrador) pode revogá-la.'));
  }).catch(next);
}

/**
 * O ator de uma escrita de CATÁLOGO, resolvido NO BANCO numa consulta só.
 *
 * `produz_este` é `fn_can_produce_resource` sobre a linha apontada pela rota — a
 * MESMA função que gateia o `WHERE` da escrita, e não uma segunda cópia da regra.
 * `producer_org_id` é o escopo, lido do banco e não do token, porque `flexibleAuth`
 * não reconcilia: um produtor rebaixado carregaria o crachá antigo por até 15 min.
 *   $1 = userId (uuid, nullable), $2 = tipo de produção, $3 = id do recurso (texto)
 */
const CATALOG_PRODUCER_ACTOR = `
  SELECT fn_can_produce_resource($1::uuid, $2::text, $3::text) AS produz_este,
         (SELECT u.producer_org_id
            FROM users u
            LEFT JOIN organizations o ON o.id = u.organization_id
           WHERE u.id = $1::uuid
             AND u.is_active = true
             AND COALESCE(o.is_active, true) = true) AS producer_org_id
`;

/**
 * Gate de ESCRITA de catálogo: administrador OU produtor.
 *
 * SÃO DOIS GATES EM CAMADAS DIFERENTES, e nenhum duplica o predicado do outro.
 * Este pergunta "esta pessoa produz alguma coisa?" e recusa cedo (403) quem não
 * produz nada, para que a rota inteira nem rode. QUAL linha é dela é decidido pelo
 * `WHERE` da própria escrita (`catalog.service.js`), na mesma consulta que muta —
 * o que fecha a janela entre ler o dono e escrever, e devolve 404 (não 403) para a
 * linha de outra OM, pela mesma escada de `assertCanSeeResource`.
 *
 * O tipo vem da TABELA com que o router foi fabricado, nunca do request.
 *
 * Deixa em `req.catalogActor` o escopo de produção, que a criação usa para FORÇAR
 * `owner_org_id`. Ele é conveniência para o INSERT, nunca o gate.
 *
 * @param {string} table - Uma de CATALOG_TABLES.
 * @returns {import('express').RequestHandler}
 */
export function requireCatalogProducer(table) {
  const tipo = assertProductionTypeOf(table);
  return (req, res, next) => {
    Promise.resolve().then(async () => {
      const userId = principalUserId(req.user);
      // O id da rota (PUT/DELETE) ou o do corpo (POST, que ainda não passou pelo
      // Joi). AUSENTE VIRA STRING VAZIA, NUNCA NULL, e a distinção não é estética:
      // `fn_can_produce_resource` sai cedo com FALSE para argumento nulo, antes de
      // olhar o papel, então um POST sem `id` (que o Joi vai recusar com 422 na
      // linha seguinte) fazia o ADMINISTRADOR levar 403 aqui. Um id vazio é um id
      // que não existe, e para esse a função responde a pergunta certa: verdadeiro
      // para administrador, falso para todo o resto.
      const bruto = req.params?.id ?? req.body?.id;
      const resourceId = typeof bruto === 'string' ? bruto : '';

      const linha = userId
        ? await one(CATALOG_PRODUCER_ACTOR, [userId, tipo, resourceId])
        : null;
      const producerOrgId = linha?.producer_org_id ?? null;

      if (!linha || (linha.produz_este !== true && !producerOrgId)) {
        return next(new ForbiddenError('É preciso ser administrador ou produtor para alterar o catálogo.'));
      }

      req.catalogActor = { id: userId, producerOrgId };
      return next();
    }).catch(next);
  };
}

/**
 * Gate de VER o recurso apontado no corpo (o anexo ao atlas, na fase F5).
 *
 * Além de `manage` no atlas, quem anexa precisa VER o recurso — sem isso um
 * co-Gestor emprestaria, por adivinhação de id, um recurso que ele mesmo não pode
 * abrir.
 *
 * 404 e não 403: um recurso que o ator não enxerga precisa ser indistinguível de
 * um que não existe, senão o próprio 403 confirma a existência. É a mesma escada
 * de `enforceProjectReadable` no 360.
 */
export function assertCanSeeResource(req, res, next) {
  Promise.resolve().then(async () => {
    const type = req.body?.resourceType ?? req.params?.type;
    const resourceId = req.body?.resourceId ?? req.params?.id;
    if (!type || !resourceId) {
      return next(new BadRequestError('resourceType e resourceId são obrigatórios'));
    }

    const ok = await svc.canSeeResource({
      userId: principalUserId(req.user),
      atlasId: req.params.atlasId ?? null,
      type,
      resourceId,
    });
    if (!ok) return next(new NotFoundError('Resource'));
    return next();
  }).catch(next);
}
