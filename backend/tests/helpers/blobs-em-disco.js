// Path: tests/helpers/blobs-em-disco.js
//
// Contagem de blobs no diretorio de upload de um atlas.
//
// POR QUE ISTO NAO E `readdirSync(dir).length`, que era o que cinco arquivos de
// teste faziam ate 2026-08-25.
//
// `readdirSync` devolve ENTRADAS DE DIRETORIO, e entrada de diretorio nao e blob
// do aplicativo. Nesta maquina Windows, o `unlink` de um blob recem-fechado faz
// nascer, no MESMO diretorio, uma entrada com o mesmo UUID em caixa alta, a
// extensao em caixa alta e o sufixo `.tmp`. Ela tem zero byte e vive alguns
// milissegundos. Ninguem neste repositorio escreve esse nome: e o rastro da
// camada de filtro do sistema de arquivos ao concluir a exclusao.
//
// MEDIDO, e nao deduzido. Sonda com amostragem de 1 ms sobre o diretorio do atlas,
// repetindo 400 vezes a sequencia de `images-upload-error-mapping.test.js`. Doze
// repeticoes viram a entrada fantasma, ou seja 3 por cento. Uma delas, inteira:
//
//     56418.0 ms  + 1058640c-b057-45d4-bb5e-91285b439e42.png   (o multer grava)
//     56499.7 ms  - 1058640c-b057-45d4-bb5e-91285b439e42.png   (o multer apaga)
//     56502.2 ms  o servidor responde 400 "Image too large"
//     56512.2 ms  + 1058640C-B057-45D4-BB5E-91285B439E42.PNG.tmp   (0 bytes)
//
// Repare em duas coisas. A primeira: o fantasma nasce DEPOIS da resposta, entao o
// caso seguinte tira o retrato antes e ve a contagem subir de 0 para 1 no meio da
// propria execucao. Era esse o vermelho intermitente. A segunda: nem sempre ele
// falha no `statSync`. Em parte das repeticoes o nome ja nao resolvia (ENOENT), em
// outras resolvia com zero byte. Filtrar so por `statSync` NAO fecha o buraco, e
// isso tambem foi medido, com a versao anterior deste helper.
//
// O QUE O APLICATIVO FAZ, e que este helper precisa enxergar: os dois unicos
// caminhos que escrevem blob geram `<uuid>.<ext>`, com UUID minusculo e extensao
// minuscula de ate oito caracteres. Sao `images.routes.js` (multer, `randomUUID`
// mais `safeExtension`) e `images.service.js` linha 220 (lote, `randomUUID` mais
// `EXT_BY_MIME`). O proprio `images-upload-error-mapping.test.js` ja fixa esse
// formato em disco com `/^[0-9a-f-]{36}\.[a-z0-9]{1,8}$/`.
//
// ISTO NAO AFROUXA A ASSERCAO. Orfao de verdade e escrito por um desses dois
// caminhos, casa com o padrao, resolve no `statSync` e continua contando. Provado
// pelo caminho que de fato vaza: uma conexao derrubada no meio do upload deixa em
// disco o blob parcial, com nome minusculo normal, e esta contagem o soma. Se um
// caminho novo passar a escrever com outro nome, o teste que quebra primeiro e o
// que fixa o formato em disco, e ele aponta para ca.
//
// Tambem nao ha espera aqui, de proposito. Esperar o diretorio "assentar" nao
// distingue "o fantasma ja sumiu" de "o orfao ainda nao nasceu", entao seria um
// `setTimeout` disfarcado de condicao. Medir o que existe e mais forte que esperar.

import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Formato do nome que o servidor da ao blob em disco. O nome do cliente nunca
 * chega ao sistema de arquivos, entao este padrao cobre tudo o que o aplicativo
 * consegue escrever num diretorio de atlas.
 */
const NOME_DE_BLOB = /^[0-9a-f-]{36}\.[a-z0-9]{1,8}$/;

/**
 * Blobs de verdade dentro de `dir`. Devolve [] quando o diretorio nem existe.
 *
 * @param {string} dir
 * @returns {string[]}
 */
export function blobsEmDisco(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((nome) => {
    if (!NOME_DE_BLOB.test(nome)) return false;
    try {
      statSync(join(dir, nome));
      return true;
    } catch {
      // Nome que o aplicativo escreveria mas que ja nao resolve: e exclusao em
      // curso, nao blob. Contar isso como blob so produz vermelho intermitente.
      return false;
    }
  });
}

/**
 * Quantos blobs de verdade existem em `dir`.
 *
 * @param {string} dir
 * @returns {number}
 */
export function contarBlobs(dir) {
  return blobsEmDisco(dir).length;
}
