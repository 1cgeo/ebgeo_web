// Path: src/modules/uso/uso.controller.js
import { asyncHandler } from '../../utils/async-handler.js';
import * as usoService from './uso.service.js';

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
