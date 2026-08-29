// Path: src/modules/catalog-video/catalog-video.routes.js
import { Router } from 'express';
import { flexibleAuth } from '../../middleware/flexible-auth.js';
import * as ctrl from './catalog-video.controller.js';

// SÓ LEITURA aqui. O ENVIO do vídeo mora nas rotas do recurso (catálogo e 360), com o gate de
// escrita de cada um, porque é lá que se sabe QUAL recurso recebe a URL. Este router só serve os
// bytes, e é público-por-URL (o token é a capacidade), então `flexibleAuth` preserva anônimo.
const router = Router();
router.use(flexibleAuth);
router.get('/:file', ctrl.serveVideo);

export default router;
