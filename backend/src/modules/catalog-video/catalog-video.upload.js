// Path: src/modules/catalog-video/catalog-video.upload.js
// Multer de UPLOAD do vídeo de prévia, compartilhado pelas rotas de catálogo e do 360. Um campo
// (`video`), teto de `config.catalogVideo.maxSizeMb`. O storage é o abortável (o mesmo do 360 e
// das imagens), porque uma conexão derrubada no meio de um arquivo grande deixava o `WriteStream`
// aberto e a requisição sem terminar. O tipo (MP4/WebM) é conferido por MAGIC BYTES no store,
// depois de escrito o tmp; aqui só o TAMANHO é imposto (o `fileFilter` não vê o corpo).
import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { armazenamentoAbortavel } from '../../middleware/armazenamento-abortavel.js';
import { BadRequestError } from '../../utils/errors.js';
import config from '../../config.js';

const storage = armazenamentoAbortavel({
  destination: (req, file, cb) => {
    try {
      // Grava o tmp no MESMO volume do destino final, para a cópia ser barata e local.
      const dir = path.resolve(config.catalogVideo.dir, 'tmp');
      mkdirSync(dir, { recursive: true });
      cb(null, dir);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}.upload`),
});

export const uploadVideo = multer({
  storage,
  limits: { fileSize: config.catalogVideo.maxSizeMb * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (file.fieldname !== 'video') return cb(new BadRequestError(`Unexpected upload field: ${file.fieldname}`));
    return cb(null, true); // o tipo é validado por magic bytes no store
  },
}).fields([{ name: 'video', maxCount: 1 }]);
