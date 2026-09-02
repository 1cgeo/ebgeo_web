// Path: src/modules/diag/diag.routes.js
import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/require-admin.js';
import { validate } from '../../middleware/validate.js';
import { clientErrorLimiter } from './diag.rate-limit.js';
import * as ctrl from './diag.controller.js';
import * as schemas from './diag.schemas.js';

const router = Router();

/**
 * A ROTA ANÔNIMA VEM PRIMEIRO no arquivo porque ela é a exceção, e escrevê-la no meio de
 * quatro rotas de administrador é como alguém a lê como uma delas. Ela é o único ponto
 * deste módulo sem `auth`: o app roda deslogado, e o visitante é justamente quem não tem
 * ninguém olhando o console dele.
 *
 * A ordem `limiter → validate` é a de `POST /auth/register`: o teto por endereço precisa
 * ser cobrado ANTES do trabalho de validar, senão o corpo gigante já custou o parse.
 */
router.post(
  '/erro-cliente',
  clientErrorLimiter,
  validate({ body: schemas.erroDeClienteSchema }),
  ctrl.registrarErroDeCliente
);

/**
 * As de leitura: `auth` ESTRITO (401 sem credencial) e `requireAdmin` (403 para
 * qualquer outro papel global, credenciado e produtor inclusive — nenhum dos dois
 * administra o sistema).
 *
 * `requireAdmin` ANTES de `validate`, como em `audit.routes.js`: quem não pode ler o
 * diagnóstico não precisa saber que a query dele estava malformada, e um 422 nesse caso
 * confirmaria a existência e a forma da rota para quem não deveria alcançá-la.
 */
router.get('/erros', auth, requireAdmin, validate({ query: schemas.errosQuerySchema }), ctrl.erros);
router.get('/lento', auth, requireAdmin, validate({ query: schemas.lentoQuerySchema }), ctrl.lento);
router.get('/status', auth, requireAdmin, validate({ query: schemas.statusQuerySchema }), ctrl.status);
/**
 * `GET /resumo` é a ÚNICA rota HÍBRIDA do módulo: ela lê o `.jsonl` E o Postgres na mesma
 * requisição, e continua respondendo 200 com a metade que a fonte viva sustentar. As quatro
 * acima são de uma fonte só, e as três de arquivo respondem com o banco fora por construção.
 * A tolerância é o contrato do relatório e mora em `resumo.service.js`, não aqui.
 *
 * O padrão de janela dela é `7d` e não `24h` (ver `resumoQuerySchema`): a aba é lida por
 * rotina e o que ela precisa mostrar é a semana. O teto de 7 dias é o mesmo das irmãs.
 */
router.get('/resumo', auth, requireAdmin, validate({ query: schemas.resumoQuerySchema }), ctrl.resumo);
router.get(
  '/erros-cliente',
  auth,
  requireAdmin,
  validate({ query: schemas.errosDeClienteQuerySchema }),
  ctrl.listarErrosDeCliente
);

/**
 * As duas do DEFEITO, com o mesmo par de gates das quatro acima.
 *
 * A ORDEM DAS DUAS ROTAS NO ARQUIVO É O CONTRATO DO EXPRESS, e não estilo: `/defeitos` casa
 * antes de `/defeitos/:id/ocorrencias` só porque os caminhos têm profundidades diferentes,
 * mas uma rota futura como `/defeitos/resumo` PRECISARIA vir antes de `/defeitos/:id/...`,
 * senão `resumo` entraria como `:id` e morreria no `guid()` com 422. Fica escrito porque é o
 * tipo de coisa que se descobre depurando.
 *
 * A ESCRITA DO CICLO DE VIDA ENTROU EM 2026-09-02, e é o `PATCH` logo abaixo. Ela é a ÚNICA
 * rota de escrita autenticada deste módulo (a outra, `POST /erro-cliente`, é a anônima do
 * topo), e é a única AUDITADA: o relato de erro é isento no censo porque é telemetria em
 * altíssima frequência, enquanto isto é um administrador afirmando um juízo que apaga um
 * alerta para todo mundo que olhar a tela depois. O argumento inteiro está no cabeçalho de
 * `019_defeito_estado_auditado.sql`.
 */
router.get(
  '/defeitos',
  auth,
  requireAdmin,
  validate({ query: schemas.defeitosQuerySchema }),
  ctrl.listarDefeitos
);
router.get(
  '/defeitos/:id/ocorrencias',
  auth,
  requireAdmin,
  validate({ params: schemas.ocorrenciasParamsSchema }),
  ctrl.listarOcorrencias
);

/**
 * A transição de estado: resolver, ignorar, reabrir.
 *
 * `auth` ESTRITO e não `flexibleAuth`, como toda rota de escrita da casa, e aqui isso tem uma
 * consequência que se perde de vista: desde 2026-08-29 o `auth` recusa com 401 o principal
 * que chegou por COOKIE nos métodos que escrevem. O `PATCH` é um deles, então a tela precisa
 * mandar `Authorization: Bearer`, e não depender do cookie que o navegador envia sozinho.
 *
 * `ocorrenciasParamsSchema` É REUSADO para os params, e não copiado: ele é exatamente
 * `{ id: guid().required() }`, que é o mesmo contrato, e uma segunda cópia divergiria no dia
 * em que a coluna mudasse de forma. O nome envelheceu, e trocá-lo agora renomearia um
 * símbolo citado noutro arquivo por ganho nenhum.
 */
router.patch(
  '/defeitos/:id',
  auth,
  requireAdmin,
  validate({ params: schemas.ocorrenciasParamsSchema, body: schemas.estadoDeDefeitoSchema }),
  ctrl.mudarEstadoDeDefeito
);

export { router as diagRoutes };
