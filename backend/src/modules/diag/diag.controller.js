// Path: src/modules/diag/diag.controller.js
import config from '../../config.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { NotFoundError } from '../../utils/errors.js';
import * as diagService from './diag.service.js';
import * as defeitos from './defeitos.service.js';

/**
 * O DIRETÓRIO DE LOG É DECIDIDO AQUI E NUNCA PELO CHAMADOR.
 *
 * O comando aceita `--dir`, e o paralelo tentador seria um `?dir=` nesta rota. Não existe,
 * de propósito: seria um leitor de arquivo arbitrário do servidor, com o filtro de "linha
 * que faz JSON.parse" como única barreira, atrás de um gate de administrador — e um
 * administrador não deve poder ler `/etc` pela porta do diagnóstico. Quem precisa de outro
 * diretório usa o comando, no servidor, onde já tem shell.
 */
const diretorio = () => config.log.dir;

export const erros = asyncHandler(async (req, res) => {
  const { desde, limite } = req.query;
  res.json({ data: await diagService.erros({ diretorio: diretorio(), desde, limite }) });
});

export const lento = asyncHandler(async (req, res) => {
  const { desde, limite } = req.query;
  res.json({ data: await diagService.lento({ diretorio: diretorio(), desde, limite }) });
});

/**
 * O pulso do serviço, MAIS a build que está no ar.
 *
 * POR QUE O `release` ENTRA AQUI E NÃO NO `/health`. O commit implantado nomeia a versão exata
 * do código rodando, e o `/health` não tem credencial nenhuma: publicá-lo lá seria entregar
 * essa informação a quem só sabe o endereço do servidor. Esta rota já é `auth` + `requireAdmin`
 * (`diag.routes.js`), e o administrador é justamente quem precisa dela — a primeira pergunta
 * diante de um erro que voltou é se ele voltou na MESMA build, e a resposta tem de estar ao
 * lado das contagens que ele acabou de ler.
 *
 * POR QUE NO CONTROLLER E NÃO NO SERVIÇO. `diag.service.js` não importa `config`, e a ausência
 * é declarada no `fileoverview` dele: é o que o mantém exercível em node sem `DATABASE_URL` nem
 * `JWT_SECRET`. Ler a env aqui é a mesma decisão (e o mesmo lugar) do `diretorio()` acima.
 *
 * `?? null` E NUNCA A CHAVE AUSENTE: aqui o `null` significa uma coisa só, "esta instalação não
 * declarou release", e a tela precisa poder dizer isso em voz alta em vez de calar. É o oposto
 * da regra do `enderecos` no relatório de erros, onde a chave ausente distingue servidor antigo
 * de zero endereços.
 */
export const status = asyncHandler(async (req, res) => {
  const dados = await diagService.status({ diretorio: diretorio(), desde: req.query.desde });
  res.json({ data: { ...dados, release: config.release ?? null } });
});

/**
 * Recebe um erro do navegador. 204: quem relata não tem o que fazer com um corpo.
 *
 * A IDENTIDADE SAI DE `req.user`, e o corpo não tem campo para ela (ver `diag.schemas.js`).
 * `flexibleAuth` é global e não-bloqueante, então aqui `req.user` já está preenchido para
 * quem tem credencial e ausente para o anônimo — que PRECISA passar: o app roda deslogado,
 * e é justamente no visitante que um erro de tela não tem nenhuma outra testemunha.
 *
 * O `user-agent` do CABEÇALHO tem precedência sobre o do corpo porque é o que o navegador
 * diz de si; o corpo é o que o cliente escolheu dizer. O corte em 300 repete o teto do Joi
 * porque este valor não passou por ele: cabeçalho é entrada tão externa quanto o corpo.
 */
export const registrarErroDeCliente = asyncHandler(async (req, res) => {
  const relato = {
    ...req.body,
    userAgent: (req.get('user-agent') || req.body.userAgent || '').slice(0, 300),
  };
  await defeitos.registrarErroDeCliente(relato, req.user?.id ?? null);
  res.status(204).end();
});

/**
 * A listagem TRANSITÓRIA, com o shape de quando a tabela se chamava `client_errors`.
 *
 * Ela sobrevive à renomeação porque a aba de Administração ainda a consome; o consumidor
 * troca para `defeitos` no lote seguinte, e é aí que esta rota sai. Enquanto isso, ela lê a
 * tabela nova recortada em `origem IS DISTINCT FROM 'servidor'`, ou seja, responde exatamente
 * o que respondia antes de o erro de servidor entrar na mesma tabela.
 */
export const listarErrosDeCliente = asyncHandler(async (req, res) => {
  res.json({ data: await defeitos.listarErrosDeCliente(req.query) });
});

/**
 * Os DEFEITOS da janela, com ciclo de vida.
 *
 * `req.query` VAI INTEIRO para o serviço, e isso é seguro por uma razão que precisa
 * continuar valendo: `validate()` roda com `stripUnknown`, então o que chega aqui é
 * exatamente o que `defeitosQuerySchema` declara, com os defaults já aplicados. Um filtro
 * novo que não passe pelo schema chegaria como `undefined` e sumiria calado.
 */
export const listarDefeitos = asyncHandler(async (req, res) => {
  res.json({ data: await defeitos.listarDefeitos(req.query) });
});

/**
 * As ocorrências de um defeito (no máximo vinte, ver `TETO_DE_OCORRENCIAS`).
 *
 * SEM 404 PARA DEFEITO INEXISTENTE, de propósito: a poda por idade pode ter passado entre a
 * listagem que o administrador está lendo e o clique dele, e um 404 ali leria como "a rota
 * quebrou" em vez de "isto envelheceu". Lista vazia é a resposta honesta para as duas
 * causas, e a tela já precisa desenhar o vazio de qualquer jeito.
 */
export const listarOcorrencias = asyncHandler(async (req, res) => {
  res.json({ data: await defeitos.listarOcorrencias(req.params.id) });
});

/**
 * Resolve, ignora ou reabre um defeito. É a única ESCRITA de administrador deste módulo.
 *
 * 404 E NÃO 204, ao contrário da rota irmã de ocorrências logo acima, e a assimetria é
 * deliberada. Lá, defeito inexistente devolve lista VAZIA porque a pergunta é de LEITURA e a
 * poda pode ter passado entre a listagem e o clique: um 404 ali leria como "a rota quebrou".
 * Aqui a pergunta é de ESCRITA, e responder 200 sobre uma linha que não existe diria ao
 * administrador que o ato dele valeu quando ele não mudou nada. Um ato que não aconteceu tem
 * de ser dito.
 *
 * O ATOR SAI DE `req.user`, NUNCA DO CORPO. É o mesmo gate de identidade de
 * `registrarErroDeCliente`, e aqui ele pesa mais: este valor vai para `resolvido_por` E para
 * `actor_id` da trilha, ou seja, aceitá-lo do corpo deixaria um administrador assinar o ato
 * no nome de outro. `estadoDeDefeitoSchema` não tem campo para isso, e `stripUnknown`
 * descartaria um que viesse.
 *
 * A RESPOSTA É O ITEM INTEIRO, no mesmo shape de `GET /diag/defeitos`, e não um `{ ok: true }`:
 * a tela precisa redesenhar a linha com `resolvidoEm`, `resolvidoPorUsername` e
 * `resolvidoNaRelease` já preenchidos, e um segundo GET para isso abriria a janela em que
 * outro relato chega e a tela mostra um estado que não é o do ato que ela acabou de fazer.
 */
export const mudarEstadoDeDefeito = asyncHandler(async (req, res) => {
  const r = await defeitos.mudarEstadoDoDefeito({
    id: req.params.id,
    estado: req.body.estado,
    commit: req.body.commit,
    userId: req.user.id,
    req,
  });
  if (!r) {
    throw new NotFoundError(
      'Defeito não encontrado. A poda por idade apaga defeito e ocorrências juntos, então '
      + 'um id que a listagem mostrou minutos atrás pode ter envelhecido.'
    );
  }
  res.json({ data: r.item });
});
