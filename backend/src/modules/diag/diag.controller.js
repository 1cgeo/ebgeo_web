// Path: src/modules/diag/diag.controller.js
import config from '../../config.js';
import { asyncHandler } from '../../utils/async-handler.js';
import * as diagService from './diag.service.js';
import * as clientErrors from './client-errors.service.js';

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

export const status = asyncHandler(async (req, res) => {
  res.json({ data: await diagService.status({ diretorio: diretorio(), desde: req.query.desde }) });
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
  await clientErrors.registrarErroDeCliente(relato, req.user?.id ?? null);
  res.status(204).end();
});

export const listarErrosDeCliente = asyncHandler(async (req, res) => {
  res.json({ data: await clientErrors.listarErrosDeCliente(req.query) });
});
