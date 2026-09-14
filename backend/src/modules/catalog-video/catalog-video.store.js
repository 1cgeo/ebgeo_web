// Path: src/modules/catalog-video/catalog-video.store.js
// Armazenamento em disco do VÍDEO DE PRÉVIA de recurso de catálogo (e de projeto 360).
//
// POR QUE EM DISCO, e não embutido no config como a thumbnail: a thumbnail vira um data URL de
// dezenas de kB dentro do `config` JSONB (que o `/api/config` memoiza e serve anônimo); um vídeo
// tem MB e quebraria esse payload. Então o arquivo vive aqui e o config guarda só a URL servida.
//
// O NOME DO ARQUIVO CARREGA UM TOKEN não-adivinhável (16 bytes aleatórios), e ele NÃO é mais a
// capacidade: desde 2026-09-14 (decisão D14, achado R6) servir os bytes passa pelo MESMO
// predicado das outras mídias do recurso, e o token virou só o que torna o arquivo único.
//
// POR QUE A URL NÃO PODIA CONTINUAR SENDO A CAPACIDADE. A justificativa era "a URL só chega a
// quem VÊ o recurso", e ela é verdadeira a cada instante e falsa ao longo do tempo: um recurso
// que já foi PÚBLICO teve a URL do vídeo servida a todo mundo dentro do `/api/config`, que é o
// documento anônimo e cacheável, e marcá-lo privado depois não revogava nada. Era a única
// superfície de recurso em que a marca de privacidade não movia byte nenhum, e a assimetria com
// o tile (onde marcar privado FECHA os bytes desde 2026-08-29) é o que a tornava fácil de ler ao
// contrário.
//
// DUAS METADES, E AS DUAS SÃO NECESSÁRIAS. O gate fecha a porta daqui para a frente; a
// RE-CUNHAGEM do nome ({@link remintVideoUrl}) mata a URL que já circulou, e sem ela o gate
// deixaria viva uma capacidade repassada enquanto o recurso era público. Repare que as duas se
// cobrem: mesmo que o `rename` em disco falhe, a URL antiga já morreu, porque o gate resolve o
// arquivo a partir da linha do recurso e nenhuma linha a nomeia mais.
import { statSync, mkdirSync, copyFileSync, existsSync, renameSync, rmSync } from 'node:fs';
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

/** O prefixo das URLs que ESTE servidor hospeda. URL externa não é nossa. */
function prefixoHospedado() {
  return `${config.catalogVideo.baseUrl}/`;
}

/**
 * O nome do arquivo de uma URL hospedada aqui, ou null (URL externa, vazia ou fora de forma).
 * @param {string} [url]
 * @returns {string|null}
 */
export function hostedVideoName(url) {
  if (!url || typeof url !== 'string') return null;
  const prefixo = prefixoHospedado();
  if (!url.startsWith(prefixo)) return null;
  const nome = url.slice(prefixo.length);
  return resolveVideoPath(nome) ? nome : null;
}

/**
 * A URL NOVA de um vídeo hospedado, com token novo e a MESMA extensão, ou null quando não há o
 * que re-cunhar (sem vídeo, ou vídeo externo).
 *
 * É PURA: ela não toca o disco. Quem move o arquivo é {@link renameHostedVideo}, e a separação é
 * o que permite gravar a URL nova DENTRO da transação e mexer no disco só depois do commit. A
 * ordem inversa (renomear antes) deixaria, num rollback, a linha apontando para um nome que não
 * existe mais, com o recurso ainda PÚBLICO: o pior dos dois desfechos, porque quebra o que devia
 * continuar funcionando. Na ordem escrita, uma falha de `rename` custa a prévia do recurso que
 * acabou de virar privado, e a URL antiga já está morta de qualquer jeito. Falha FECHADA.
 *
 * A EXTENSÃO É PRESERVADA porque ela é o que decide o `Content-Type` servido; sortear uma nova
 * faria um WebM sair como MP4.
 *
 * @param {string} [url] - a URL atual
 * @returns {string|null} a URL nova, ou null quando não há o que re-cunhar
 */
export function remintVideoUrl(url) {
  const nome = hostedVideoName(url);
  if (!nome) return null;
  const ext = path.extname(nome).slice(1).toLowerCase();
  return `${config.catalogVideo.baseUrl}/${crypto.randomBytes(16).toString('hex')}.${ext}`;
}

/**
 * Move o arquivo de `deUrl` para `paraUrl`, as duas hospedadas aqui.
 *
 * BEST-EFFORT, e o motivo está em {@link remintVideoUrl}: o dado autoritativo é a linha do
 * recurso, que já foi gravada. Devolve `false` quando não moveu, para que o chamador possa
 * REGISTRAR o arquivo que ficou para trás em vez de apenas engolir.
 *
 * @param {string} deUrl @param {string} paraUrl
 * @returns {boolean} `true` quando o arquivo foi movido.
 */
export function renameHostedVideo(deUrl, paraUrl) {
  const de = hostedVideoName(deUrl);
  const para = hostedVideoName(paraUrl);
  if (!de || !para) return false;
  const origem = path.resolve(videoDir(), de);
  const destino = path.resolve(videoDir(), para);
  if (!existsSync(origem)) return false;
  try {
    renameSync(origem, destino);
    return true;
  } catch {
    return false;
  }
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
