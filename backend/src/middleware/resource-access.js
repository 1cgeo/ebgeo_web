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
 * O papel `curator` nunca chegou a existir fora de uma revisão intermediária do eixo
 * global: ele foi SUBSTITUÍDO por `credenciado` antes de qualquer banco aplicá-lo, e o
 * CHECK de `users.role` recusa a palavra antiga. Prosa que a repete manda quem procurar o
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
 * A AUTORIDADE DE REPASSAR ESTE RECURSO, resolvida UMA vez, em três ramos.
 *
 * Os dois gates abaixo carregavam a mesma escada escrita duas vezes, e a diferença
 * entre eles nunca foi a regra: é de onde vem o alvo e qual é a mensagem. Duas cópias
 * de uma regra de autorização divergem na próxima edição, e a divergência aparece no
 * ramo que ninguém olha.
 *
 * A ORDEM DOS RAMOS É DE CUSTO, não de precedência: papel global (uma consulta sobre
 * `users`), produção (uma função STABLE sobre a linha do recurso) e só então a
 * concessão viva, que passa pela tabela de concessões. Como autoridade, os três são
 * alternativos: qualquer ordem daria a mesma resposta.
 *
 * NENHUM DELES COMPARA PAPEL EM JAVASCRIPT. `fn_has_global_data_access` e
 * `fn_can_produce_resource` resolvem no BANCO, pelo motivo do cabeçalho deste arquivo
 * (o token vive até 15 min e `flexibleAuth` não reconcilia) e porque este arquivo é
 * gate de PODER no censo de papel global: um literal de papel aqui reprova, e reprova
 * com razão.
 *
 * @param {object} req
 * @param {string} type - Tipo de recurso já validado pela borda.
 * @param {string} resourceId
 * @returns {Promise<{global: boolean, produz: boolean, repassa: boolean}>}
 */
async function autoridadeDeRepasse(req, type, resourceId) {
  const userId = principalUserId(req.user);
  const global = await hasGlobalDataAccess(req);
  if (global) return { global: true, produz: false, repassa: false };

  const produz = await producesResource(userId, type, resourceId);
  if (produz) return { global: false, produz: true, repassa: false };

  return { global: false, produz: false, repassa: await hasShareGrant(userId, type, resourceId) };
}

/**
 * Gate de COMPARTILHAR: papel global de dado, PRODUÇÃO daquele recurso, ou uma
 * concessão viva com `grant_level = 'view_share'`.
 *
 * `view` NÃO passa, e essa é a única diferença entre os dois níveis: quem recebeu
 * acesso simples vê e não repassa. O teste negativo
 * (`resource-grants-escalonamento.test.js`) é o que impede a distinção de virar prosa.
 *
 * O PRODUTOR ENTROU AQUI EM 2026-08-20, POR DECISÃO DO DONO, e o parágrafo que estas
 * linhas substituem dizia o contrário por extenso ("deixar o produtor entrar aqui
 * trocaria um 403 do gate por um 403 do serviço"). O argumento estava certo sobre o
 * mecanismo e errado sobre o produto: o serviço passou a tratar produção como RAIZ,
 * igual ao papel global, então quem mantém o acervo da OM concede sem precisar receber
 * de um administrador acesso àquilo que ele próprio publica.
 *
 * OS DOIS FATOS FICAM MARCADOS NO `req` porque o serviço precisa deles logo em
 * seguida (são eles que decidem `parent_grant_id = NULL`), e reconsultar seria uma
 * segunda leitura do mesmo fato — que é como uma requisição passa a ter duas respostas
 * para a mesma pergunta. Os dois nascem `false` ANTES de qualquer `await`: um
 * `undefined` que escapasse por um caminho de erro seria lido como "não", que é a
 * resposta certa pelo motivo errado.
 */
export function requireResourceShare(req, res, next) {
  req.hasGlobalDataAccess = false;
  req.producesResource = false;
  Promise.resolve().then(async () => {
    const { type, id } = req.params;
    const quem = await autoridadeDeRepasse(req, type, id);
    req.hasGlobalDataAccess = quem.global;
    req.producesResource = quem.produz;
    if (quem.global || quem.produz || quem.repassa) return next();

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
 * atlas.
 *
 * A AUTORIDADE EXIGIDA É A MESMA do gate irmão, resolvida pela mesma função. O que
 * continua diferente são as duas coisas que sempre foram: o ALVO vem do corpo antes
 * dos params (quem anexa manda `resourceType`/`resourceId` no corpo), e a MENSAGEM
 * fala de emprestar.
 *
 * 403 E NÃO 404, ao contrário do gate irmão: `assertCanSeeResource` roda ANTES e já
 * respondeu 404 para o que este ator não enxerga, então quem chega aqui JÁ sabe que o
 * recurso existe. Um 404 nesta linha não esconderia nada e mentiria sobre a causa.
 *
 * O CASO ANÔNIMO EM ATLAS `is_public`, nomeado aqui porque é o extremo do eixo:
 * `requireAtlasScopeWhenPresent` resolve `read` para `userId` NULO quando o atlas é
 * público (R4), e o braço de empréstimo de `fn_granted_resource_ids` exige
 * `p_atlas_id IS NOT NULL` sem pedir nada sobre `p_user_id`. Logo um recurso PRIVADO
 * anexado a um atlas que depois vira público é entregue a chamador SEM CREDENCIAL
 * NENHUMA. Isso é CONSEQUÊNCIA ACEITA, não defeito: o visitante de link público herdar
 * o empréstimo é decisão registrada (R4), e o que a torna defensável é justamente este
 * gate — a cadeia inteira passa a começar em alguém com autoridade para repassar
 * aquele recurso, e publicar o atlas depois é ato deliberado de quem já a tinha.
 */
export function requireResourceRelay(req, res, next) {
  Promise.resolve().then(async () => {
    const type = req.body?.resourceType ?? req.params?.type;
    const resourceId = req.body?.resourceId ?? req.params?.id;
    if (!type || !resourceId) {
      return next(new BadRequestError('resourceType e resourceId são obrigatórios'));
    }

    const quem = await autoridadeDeRepasse(req, type, resourceId);
    if (quem.global || quem.produz || quem.repassa) return next();

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
 * Gate de MANUTENÇÃO de recurso: administrador OU quem produz alguma coisa.
 *
 * A rota que ele gateia é `PATCH /resource-access/:type/:id/visibility`, e até
 * 2026-08-20 ela era `requireAdmin`. Marcar público ou privado deixou de ser ato de
 * ADMINISTRAÇÃO do catálogo e passou a ser ato de MANUTENÇÃO do acervo: quem mantém o
 * que a OM produziu decide o que dela é público. O eixo de CONCESSÃO continua à parte
 * — tornar privado não concede nada a ninguém, e conceder não muda a visibilidade.
 *
 * SÃO DOIS GATES EM CAMADAS DIFERENTES, exatamente como em `requireCatalogProducer`, e
 * nenhum duplica o predicado do outro. Este pergunta "esta pessoa mantém ALGUMA
 * coisa?" e recusa cedo (403) quem não mantém nada — o credenciado e o usuário comum
 * inclusive. QUAL linha é dela é decidido pelo `WHERE` da própria escrita
 * (`SET_360_ACCESS_LEVEL` e `setCatalogAccessLevel`), que devolve 404 para a linha de
 * outra OM. Um gate FINO aqui responderia 403 para recurso de outra OM e confirmaria a
 * existência do que o 404 esconde.
 *
 * A DIFERENÇA PARA O IRMÃO é de onde vem o tipo: lá ele vem da TABELA com que o router
 * foi fabricado, aqui vem de `req.params.type`, já validado pelo Joi da rota contra os
 * CINCO tipos. É por isso que a rota roda `validate({ params })` ANTES deste gate:
 * `fn_can_produce_resource` LEVANTA para tipo fora da whitelist, e um tipo inventado na
 * URL viraria 500 em vez de 422.
 *
 * O ID VAI VAZIO, NUNCA NULO, pelo mesmo motivo documentado em
 * `requireCatalogProducer`: `fn_can_produce_resource` sai cedo com FALSE para argumento
 * nulo, ANTES de olhar o papel, e isso faria o ADMINISTRADOR levar 403.
 */
export function requireResourceMaintainer(req, res, next) {
  Promise.resolve().then(async () => {
    const userId = principalUserId(req.user);
    const tipo = req.params?.type;
    const bruto = req.params?.id;
    const resourceId = typeof bruto === 'string' ? bruto : '';

    const linha = userId && tipo
      ? await one(CATALOG_PRODUCER_ACTOR, [userId, tipo, resourceId])
      : null;

    if (!linha || (linha.produz_este !== true && !linha.producer_org_id)) {
      return next(new ForbiddenError(
        'É preciso ser administrador ou manter este acervo para alterar a visibilidade.',
      ));
    }
    return next();
  }).catch(next);
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
