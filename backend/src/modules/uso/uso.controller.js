// Path: src/modules/uso/uso.controller.js
import { asyncHandler } from '../../utils/async-handler.js';
import * as usoService from './uso.service.js';
import * as eventos from './uso.eventos.service.js';

/**
 * `GET /uso/resumo`.
 *
 * O CONTROLLER NÃO DECIDE NADA, e a ausência é o desenho: ele não recorta por OM, não lê
 * `req.user` e não passa nada do chamador para dentro da consulta além da janela já
 * validada. O relatório é global por definição (é a pergunta "como esta instalação está
 * sendo usada"), e o gate que torna isso legítimo é `requireAdmin`, na rota — o mesmo
 * lugar, e a mesma razão, das quatro rotas de leitura de `/diag`.
 *
 * A ASSIMETRIA COM `GET /audit` É DELIBERADA e vale dizer, porque a rota vizinha faz o
 * contrário: lá o produtor lê a trilha RECORTADA na própria OM, e o recorte é imposto no
 * serviço. Aqui não há recorte possível que preserve o sentido — "quantas contas ativas
 * existem" e "quais atlas mais receberam edição" não têm versão por OM que não seja outro
 * relatório. Abrir esta rota ao produtor exigiria escrevê-lo, não afrouxar o gate.
 */
export const resumo = asyncHandler(async (req, res) => {
  res.json({ data: await usoService.resumo({ desde: req.query.desde }) });
});

/**
 * Recebe um lote de uso do navegador. 204: quem relata não tem o que fazer com um corpo.
 *
 * A IDENTIDADE SAI DE `req.user`, e o corpo não tem campo para ela (ver `uso.schemas.js`).
 * `flexibleAuth` é global e não-bloqueante, então aqui `req.user` já está preenchido para
 * quem tem credencial e ausente para o anônimo, que PRECISA passar: o app roda deslogado, e
 * é justamente do visitante que não existe nenhuma outra medida.
 *
 * NÃO DEVOLVER A LINHA GRAVADA é a mesma decisão de `registrarErroDeCliente`, pelo mesmo
 * motivo: um corpo de resposta aqui daria a um chamador ANÔNIMO uma leitura do que já está na
 * tabela, ou seja, transformaria a porta de escrita numa porta de leitura de telemetria
 * agregada da instalação inteira.
 *
 * O QUE ESTE CONTROLLER NÃO FAZ, e a ausência é deliberada: ele não lê cabeçalho nenhum. O
 * relato de erro prefere o `user-agent` do CABEÇALHO ao do corpo, porque lá o valor serve
 * para reproduzir um defeito; aqui a coluna equivalente (`navegador`) é uma DIMENSÃO de
 * agrupamento, e um `user-agent` cru como dimensão tem cardinalidade de milhares e não agrupa
 * nada. Ver o campo no schema.
 */
export const registrarEventos = asyncHandler(async (req, res) => {
  await eventos.registrarLoteDeUso(req.body, req.user?.id ?? null);
  res.status(204).end();
});
