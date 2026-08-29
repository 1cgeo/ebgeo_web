// Path: src/modules/catalog-video/catalog-video.store.js
// Armazenamento em disco do VÍDEO DE PRÉVIA de recurso de catálogo (e de projeto 360).
//
// POR QUE EM DISCO, e não embutido no config como a thumbnail: a thumbnail vira um data URL de
// dezenas de kB dentro do `config` JSONB (que o `/api/config` memoiza e serve anônimo); um vídeo
// tem MB e quebraria esse payload. Então o arquivo vive aqui e o config guarda só a URL servida.
//
// O NOME DO ARQUIVO CARREGA UM TOKEN não-adivinhável (16 bytes aleatórios), e a URL só chega a
// quem VÊ o recurso (config público, ou o payload aditivo do privado). Servir é público-por-URL:
// a URL é a capacidade. É o mesmo modelo do link de compartilhamento, sem um segundo gate por
// tipo de recurso.
import { statSync, mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileTypeFromFile } from 'file-type';
import config from '../../config.js';
import { BadRequestError } from '../../utils/errors.js';

// Só MP4 e WebM: os dois que todo navegador toca em `<video>` sem plugin. O mime declarado não é
// evidência (o cliente escolhe o header), então o tipo vem dos MAGIC BYTES.
const EXT_BY_MIME = Object.freeze({ 'video/mp4': 'mp4', 'video/webm': 'webm' });
const CONTENT_TYPE_BY_EXT = Object.freeze({ mp4: 'video/mp4', webm: 'video/webm' });

/** O diretório dos vídeos, resolvido para caminho absoluto. */
export function videoDir() {
  return path.resolve(config.catalogVideo.dir);
}

/**
 * O caminho absoluto de um arquivo de vídeo servível, ou null se o nome não casa a forma
 * `{32 hex}.{mp4|webm}`. O `basename` é defesa em profundidade contra travessia de caminho.
 * @param {string} file
 * @returns {string|null}
 */
export function resolveVideoPath(file) {
  const safe = path.basename(String(file ?? ''));
  if (!/^[a-f0-9]{32}\.(mp4|webm)$/i.test(safe)) return null;
  return path.resolve(videoDir(), safe);
}

/** O `Content-Type` de um caminho de vídeo, por extensão. */
export function contentTypeOf(filePath) {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return CONTENT_TYPE_BY_EXT[ext] ?? 'application/octet-stream';
}

/**
 * Confere tamanho (teto de `config.catalogVideo.maxSizeMb`) e tipo (MP4/WebM por magic bytes),
 * ANTES de mover qualquer coisa: falha barata, sem estado meio-feito.
 * @param {string} tmpPath - caminho tmp do multer
 * @returns {Promise<string>} a extensão ('mp4' ou 'webm')
 * @throws {BadRequestError}
 */
export async function assertValidVideo(tmpPath) {
  const { size } = statSync(tmpPath);
  const max = config.catalogVideo.maxSizeMb * 1024 * 1024;
  if (size > max) {
    throw new BadRequestError(`O vídeo excede ${config.catalogVideo.maxSizeMb} MB (${size} bytes).`);
  }
  const detected = await fileTypeFromFile(tmpPath);
  if (!detected || !EXT_BY_MIME[detected.mime]) {
    throw new BadRequestError(`O vídeo deve ser MP4 ou WebM (detectado: ${detected?.mime ?? 'desconhecido'}).`);
  }
  return EXT_BY_MIME[detected.mime];
}

/**
 * Valida e GRAVA o vídeo enviado num arquivo de token, devolvendo a URL servida. O tmp do multer
 * é do CHAMADOR limpar.
 * @param {string} tmpPath
 * @returns {Promise<string>} a URL (`${baseUrl}/{token}.{ext}`)
 */
export async function saveVideo(tmpPath) {
  const ext = await assertValidVideo(tmpPath);
  const filename = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
  mkdirSync(videoDir(), { recursive: true });
  copyFileSync(tmpPath, path.resolve(videoDir(), filename));
  return `${config.catalogVideo.baseUrl}/${filename}`;
}

/**
 * Apaga o arquivo de vídeo de uma URL, SE ela for hospedada aqui. URL externa (o que o deploy já
 * tinha) não é nossa e é ignorada. Best-effort: uma falha de I/O não derruba a operação que a
 * chamou (o dado autoritativo é a coluna/`config`, e o arquivo órfão é higiene, não correção).
 * @param {string} [url]
 */
export function deleteVideoByUrl(url) {
  if (!url || typeof url !== 'string') return;
  const prefixo = `${config.catalogVideo.baseUrl}/`;
  if (!url.startsWith(prefixo)) return;
  const filePath = resolveVideoPath(url.slice(prefixo.length));
  if (filePath && existsSync(filePath)) {
    try { rmSync(filePath, { force: true }); } catch { /* higiene best-effort */ }
  }
}
