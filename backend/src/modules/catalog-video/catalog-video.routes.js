// Path: src/modules/catalog-video/catalog-video.routes.js
import { Router } from 'express';
import Joi from 'joi';
import { flexibleAuth } from '../../middleware/flexible-auth.js';
import { validate } from '../../middleware/validate.js';
import { liftOptionalAtlasId, requireAtlasScopeWhenPresent } from '../../middleware/resource-access.js';
import * as ctrl from './catalog-video.controller.js';

// SÓ LEITURA aqui. O ENVIO do vídeo mora nas rotas do recurso (catálogo e 360), com o gate de
// escrita de cada um, porque é lá que se sabe QUAL recurso recebe a URL. Este router só serve os
// bytes, e `flexibleAuth` preserva anônimo, que é quem vê a prévia de recurso PÚBLICO.
const router = Router();

/**
 * O `?atlasId=` da rota, no mesmo formato das leituras de catálogo e do 360.
 *
 * ELE NÃO É IMPORTADO DO CATÁLOGO de propósito: o vídeo de prévia é das quatro famílias (três
 * tabelas de catálogo mais o projeto 360), e amarrar este módulo ao schema de uma delas por um
 * objeto de três linhas faria a dependência apontar para o lado errado. O `.unknown(true)` é o
 * mesmo de lá, porque a rota não é dona da query string inteira.
 */
const atlasScopeQuerySchema = Joi.object({
  atlasId: Joi.string().trim().guid(),
}).unknown(true);

// A ORDEM É A MESMA DAS LEITURAS DE CATÁLOGO E DO 360, e ela é contrato (decisão D14): `validate`
// (um `atlasId` fora de forma vira 422 na borda, antes de qualquer cast `::uuid`) →
// `liftOptionalAtlasId` (os gates de atlas leem `req.params`) → `flexibleAuth` →
// `requireAtlasScopeWhenPresent`.
//
// O GATE DE ATLAS EXISTE PORQUE O EMPRÉSTIMO CHEGA AQUI: `fn_granted_resource_ids` casa
// `ar.atlas_id` e NÃO pergunta se o chamador participa do atlas, e o UUID viaja em toda URL de
// compartilhamento. Sem ele, saber o UUID de um atlas entregaria a prévia de todo recurso privado
// que ele empresta. Sem `atlasId` não há gate, porque "sem atlas em foco" é o estado normal de
// quem abre o cartão do catálogo.
router.get(
  '/:file',
  validate({ query: atlasScopeQuerySchema }),
  liftOptionalAtlasId,
  flexibleAuth,
  requireAtlasScopeWhenPresent,
  ctrl.serveVideo,
);

export default router;
