// Path: src/modules/uso/uso.routes.js
import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/require-admin.js';
import { validate } from '../../middleware/validate.js';
import { usoEventosLimiter } from './uso.rate-limit.js';
import * as ctrl from './uso.controller.js';
import * as schemas from './uso.schemas.js';

const router = Router();

/**
 * A ROTA ANÔNIMA VEM PRIMEIRO no arquivo porque ela é a exceção, e escrevê-la depois da de
 * administrador é como alguém a lê como uma delas. Ela é o único ponto deste módulo sem
 * `auth`, e é o SEGUNDO endpoint anônimo deste servidor que escreve no banco (o primeiro é
 * `POST /diag/erro-cliente`). O motivo é o mesmo: o app roda deslogado, e a pergunta que
 * motivou a fase inteira ("quantas pessoas bateram na tela de indisponibilidade") é sobre
 * gente que, por definição, não conseguiu entrar.
 *
 * A IDENTIDADE SAI DE `req.user`, preenchido pelo `flexibleAuth` GLOBAL (`src/app.js`), que
 * é não-bloqueante: quem tem cookie ou Bearer chega identificado, quem não tem chega anônimo
 * e passa. O corpo NÃO tem campo de identidade, e `stripUnknown` descarta um `userId` que
 * venha; ver `eventosDeUsoSchema`.
 *
 * O COOKIE DECIDE A IDENTIDADE AQUI, e isso é CSRF possível, aceito, pelo mesmo argumento da
 * rota irmã (`POST /diag/erro-cliente`). Desde 2026-08-29 o login emite o cookie `token`, e o
 * `flexibleAuth` o resolve com precedência sobre o Bearer; a amarra que recusa principal vindo
 * de cookie nos métodos que escrevem mora no `auth` ESTRITO, que esta rota não monta e não
 * pode montar (ela existe para o anônimo). O que um terceiro consegue forjando uma requisição
 * é atribuir uma CONTAGEM à sessão de outra pessoa numa tabela de telemetria que não autoriza
 * nada, não é lida por gate nenhum e não volta em resposta alguma. O preço de fechar isso
 * (token de CSRF, ou recusar o cookie e perder a identidade de quem está logado) é maior que
 * o dano, e a decisão fica escrita para não ser redescoberta como se fosse esquecimento.
 *
 * A ORDEM `limiter -> validate` é a de `POST /diag/erro-cliente` e a de `POST /auth/register`:
 * o teto por endereço precisa ser cobrado ANTES do trabalho de validar, senão o corpo grande
 * já custou o parse. O teto de TAMANHO do corpo é o parser global de 10mb (`src/app.js`), que
 * é o cinto de fora; o que de fato limita este corpo são os tetos do Joi, que são de outra
 * ordem de grandeza (cinquenta eventos de campos curtos).
 */
router.post(
  '/eventos',
  usoEventosLimiter,
  validate({ body: schemas.eventosDeUsoSchema }),
  ctrl.registrarEventos
);

/**
 * A de LEITURA: `auth` ESTRITO (401 sem credencial) e `requireAdmin` (403 para qualquer outro
 * papel global, credenciado e produtor inclusive, porque ler todo recurso privado e manter o
 * acervo da própria OM não é administrar o sistema).
 *
 * `requireAdmin` ANTES de `validate`, como em `diag.routes.js` e `audit.routes.js`: quem não
 * pode ler o relatório não precisa saber que a query dele estava malformada, e um 422 nesse
 * caso confirmaria a forma da rota para quem não deveria alcançá-la.
 *
 * NENHUMA DAS DUAS EMITE TRILHA DE AUDITORIA, e as razões são diferentes, o que é justamente
 * o que o censo (`tests/unit/auditoria-censo.test.js`) existe para registrar: a leitura não é
 * um ato (consultar um resumo agregado não move eixo de acesso nenhum), e a escrita é
 * telemetria em altíssima frequência, vinda de chamador anônimo, cuja auditoria seria uma
 * linha de trilha por descarga de aba.
 */
router.get('/resumo', auth, requireAdmin, validate({ query: schemas.resumoQuerySchema }), ctrl.resumo);

export { router as usoRoutes };
