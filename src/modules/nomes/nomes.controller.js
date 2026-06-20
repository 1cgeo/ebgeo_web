// Path: src/modules/nomes/nomes.controller.js
// NOTE: /busca and /catalogo3d return FROZEN frontend contracts that do NOT use
// the standard { data } envelope. Do not wrap them.
import { asyncHandler } from '../../utils/async-handler.js';
import * as nomesService from './nomes.service.js';

// Frozen contract: bare array of up to 5 results.
export const busca = asyncHandler(async (req, res) => {
  const result = await nomesService.busca({ ...req.query, userId: req.user?.id });
  res.json(result);
});

export const feicoes = asyncHandler(async (req, res) => {
  const result = await nomesService.feicoes({ ...req.query, userId: req.user?.id });
  res.json(result ?? { message: 'Nenhuma edificação encontrada nas proximidades.' });
});

// Frozen contract: { total, page, nr_records, data }.
export const catalogo3d = asyncHandler(async (req, res) => {
  const result = await nomesService.catalogo3d({ ...req.query, userId: req.user?.id });
  res.json(result);
});
