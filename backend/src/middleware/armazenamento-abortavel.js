// Path: src/middleware/armazenamento-abortavel.js
//
// ARMAZENAMENTO EM DISCO QUE SOBREVIVE A UMA CONEXAO DERRUBADA.
//
// O DEFEITO QUE ISTO CONSERTA, e ele sao dois vazamentos, nao um.
//
// `multer/lib/make-middleware.js:171` faz `req.pipe(busboy)`. O `pipe` do Node
// registra o handler de erro no DESTINO, nunca na ORIGEM. Quando o cliente
// derruba o socket no meio do upload, a origem (`req`) morre sem emitir erro
// algum no busboy. A maquina de estado do multer entao trava exatamente onde
// estava:
//
//   - `pendingWrites` (`make-middleware.js:121`) nunca volta a zero, porque o
//     `_handleFile` daquele arquivo nunca chama o callback;
//   - `readFinished` nunca vira true, porque `busboy.on('close')`
//     (`make-middleware.js:166-169`) nao chega;
//   - `done()` (`make-middleware.js:40-48`) nunca roda, entao `next()` nunca
//     roda, e a requisicao NAO TERMINA.
//
// O que fica pendurado nao e so o blob parcial em disco. Ficam o `fs.WriteStream`
// ABERTO (um descritor de arquivo por aborto), o `IncomingMessage`, o `busboy`
// com todos os seus listeners e a closure inteira do middleware. Em Windows um
// arquivo com handle aberto nem se apaga direito depois. Quem so apagasse o
// arquivo consertaria metade do problema.
//
// O CONTRASTE QUE PROVA QUE E SO O ABORTO: no caminho do LIMITE DE TAMANHO o
// multer limpa direito, porque `abortWithError` (`make-middleware.js:54-70`)
// roda `removeUploadedFiles` antes de `done`. O vazamento e especifico do aborto
// de conexao, onde nada aciona `abortWithError`.
//
// POR QUE UM STORAGE PROPRIO, E NAO UM MIDDLEWARE POR FORA.
//
// O multer nao ajuda de fora. `uploadedFiles` (`make-middleware.js:38`) esta
// VAZIO no instante do aborto, porque so recebe o arquivo depois que o
// `_handleFile` devolve. Alem disso e variavel de closure, invisivel de fora. O
// unico ponto que conhece o caminho do arquivo no momento do aborto e quem o
// criou. Entao o gancho tem de morar dentro do `_handleFile`.
//
// O `cb(err)` E O PONTO DE TODO O CONSERTO. Ele cai em
// `make-middleware.js:146-149`, que decrementa `pendingWrites` e chama
// `abortWithError`, que chama `done(err)`. Isto NAO contorna o multer: DEVOLVE a
// ele o sinal de erro que o `pipe` comeu. A propria maquina de estado do multer
// volta a fechar, e o vazamento de descritor some junto, de graca.
//
// O EVENTO E `req.on('close')` COM O DISCRIMINADOR `req.complete === false`.
// Medido contra as alternativas:
//   - `req.on('aborted')` funciona, mas esta deprecado desde a serie 16 do Node;
//   - `res.on('close')` chega TARDE DEMAIS (86 ms contra 3 ms no caminho feliz),
//     e o gancho precisa rodar enquanto o `_handleFile` ainda esta vivo.
// O `engines` do projeto pede node >=20.19.0, e o par `close` mais
// `req.complete` vale igual em 20, 22 e 24.
//
// A ORDEM DAS OPERACOES E DEPENDENTE DE SISTEMA, e inverter produz um bug
// diferente em cada um: `unpipe`, depois `destroy`, e SO ENTAO `unlink`. No
// POSIX o `unlink` antes do `destroy` passa, e o descritor segue escrevendo num
// inode fantasma que ninguem mais ve. No Windows ele falha com EPERM ou EBUSY, e
// o blob fica.
//
// TRES GUARDAS INDEPENDENTES CONTRA APAGAR ARQUIVO BOM, e cada um sozinho ja
// bastaria:
//   1. `req.complete`: corpo que chegou inteiro nunca e aborto;
//   2. a bandeira `encerrado`, por chamada, a prova de reentrancia;
//   3. o escopo do caminho: o handler so conhece o `finalPath` que ele mesmo
//      criou, entao nao alcanca arquivo de outra requisicao.

import fs from 'node:fs';
import path from 'node:path';
import { BadRequestError } from '../utils/errors.js';

/**
 * Normaliza a opcao no molde do multer: funcao `(req, file, cb)` ou string fixa.
 *
 * @param {Function|string} opcao
 * @returns {(req: object, file: object, cb: Function) => void}
 */
function comoCallback(opcao) {
  if (typeof opcao === 'function') return opcao;
  return (req, file, cb) => cb(null, opcao);
}

/**
 * @param {{destination: Function|string, filename: Function|string}} opts
 */
function ArmazenamentoAbortavel(opts) {
  this.getDestination = comoCallback(opts.destination);
  this.getFilename = comoCallback(opts.filename);
}

/**
 * Corpo copiado de `multer/storage/disk.js:31-54`, com o gancho de aborto.
 *
 * @param {import('express').Request} req
 * @param {object} file
 * @param {Function} cb
 */
ArmazenamentoAbortavel.prototype._handleFile = function _handleFile(req, file, cb) {
  const that = this;

  // Estado desta chamada, e so dela. `finalPath` e `out` comecam nulos porque
  // `getDestination` e `getFilename` sao assincronos por contrato: o aborto pode
  // chegar antes de existir arquivo, e nesse caso a limpeza correta e nao criar
  // nenhum.
  let finalPath = null;
  let out = null;
  let encerrado = false;

  function desarmar() {
    req.removeListener('close', aoFechar);
  }

  function aoFechar() {
    // Guarda 2: esta chamada ja terminou (finish ou error). Cobre tambem o caso
    // em que `close` chega no MESMO tique do `finish`, com `Connection: close`.
    if (encerrado) return;
    // Guarda 1: o corpo chegou inteiro, entao isto e o fim normal da requisicao
    // e nao um aborto. Sem esta linha o gancho apagaria todo upload bem-sucedido.
    if (req.complete) return;

    encerrado = true;

    if (out) {
      // A ordem importa e e dependente de sistema. Ver o cabecalho.
      try {
        file.stream.unpipe(out);
      } catch {
        // Stream ja desmontado pelo proprio aborto: nao ha o que desligar.
      }
      out.destroy();
    }
    if (finalPath) {
      // Callback que ENGOLE o erro, no molde de `sv360.admin.controller.js:24-32`.
      // Aborto e caminho de erro e tem de ser a prova de bala: um ENOENT aqui
      // (arquivo que nem chegou a existir) nao pode virar excecao nao tratada.
      fs.unlink(finalPath, () => {});
    }

    // O SINAL QUE O `pipe` COMEU, devolvido ao multer. Ver o cabecalho.
    cb(new BadRequestError('Upload aborted by client'));
  }

  req.once('close', aoFechar);

  that.getDestination(req, file, (errDest, destination) => {
    if (encerrado) return;
    if (errDest) {
      encerrado = true;
      desarmar();
      return cb(errDest);
    }

    that.getFilename(req, file, (errNome, filename) => {
      if (encerrado) return;
      if (errNome) {
        encerrado = true;
        desarmar();
        return cb(errNome);
      }

      finalPath = path.join(destination, filename);
      out = fs.createWriteStream(finalPath);

      out.on('error', (err) => {
        if (encerrado) return;
        encerrado = true;
        desarmar();
        cb(err);
      });

      out.on('finish', () => {
        if (encerrado) return;
        encerrado = true;
        desarmar();
        cb(null, {
          destination,
          filename,
          path: finalPath,
          size: out.bytesWritten,
        });
      });

      file.stream.pipe(out);
    });
  });
};

/**
 * Identico a `multer/storage/disk.js:57-65`. E o caminho que o proprio multer usa
 * em `removeUploadedFiles`, e ele continua valendo.
 *
 * @param {import('express').Request} req
 * @param {object} file
 * @param {Function} cb
 */
ArmazenamentoAbortavel.prototype._removeFile = function _removeFile(req, file, cb) {
  const alvo = file.path;

  delete file.destination;
  delete file.filename;
  delete file.path;

  if (!alvo) return cb(null);
  fs.unlink(alvo, cb);
};

/**
 * Substitui `multer.diskStorage`, com a mesma assinatura de opcoes.
 *
 * @param {{destination: Function|string, filename: Function|string}} opts
 * @returns {ArmazenamentoAbortavel}
 */
export function armazenamentoAbortavel(opts) {
  return new ArmazenamentoAbortavel(opts);
}

export default armazenamentoAbortavel;
