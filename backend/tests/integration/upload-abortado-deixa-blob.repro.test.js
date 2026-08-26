// Path: tests/integration/upload-abortado-deixa-blob.repro.test.js
//
// CONEXAO DERRUBADA NO MEIO DE UM UPLOAD DEIXA LIXO E NAO TERMINA A REQUISICAO.
//
// O MECANISMO. `multer/lib/make-middleware.js:171` faz `req.pipe(busboy)`, e o
// `pipe` do Node registra o handler de erro no DESTINO, nunca na ORIGEM. Socket
// derrubado mata a origem sem produzir erro no busboy. Entao `pendingWrites`
// (`make-middleware.js:121`) nunca zera, `readFinished` nunca vira true
// (`make-middleware.js:166-169`) e `done()` (`make-middleware.js:40-48`) nunca
// roda. A requisicao nao termina, e nenhuma resposta sai.
//
// SAO DOIS VAZAMENTOS, e o segundo e pior. Alem do blob parcial em disco ficam
// pendurados o `fs.WriteStream` ABERTO, o `IncomingMessage`, o `busboy` com
// todos os listeners e a closure inteira do middleware. Cada aborto vaza um
// descritor de arquivo. Consertar so o arquivo conserta metade.
//
// O CONTRASTE que mostra que o alvo e o aborto e nao o multer inteiro: no
// caminho do LIMITE DE TAMANHO a limpeza funciona, porque `abortWithError`
// (`make-middleware.js:54-70`) roda `removeUploadedFiles` antes de `done`. Essa
// fronteira ja esta presa em `images-size-boundary.test.js`.
//
// POR QUE SOCKET CRU E NAO SUPERTEST. O supertest nao aborta socket no meio da
// requisicao, como ja anotado em `assets3d-semaphore-leak.repro.test.js:118-119`.
// Este arquivo copia aquele molde: sobe `app.listen(0, '127.0.0.1')` de verdade
// e escreve o multipart a mao, sem fechar o boundary.
//
// CONTROLE NEGATIVO OBRIGATORIO (caso 2). Sem ele o conserto passaria mesmo se o
// gancho apagasse TODO upload, inclusive o que terminou bem. O caso 2 sobe pelo
// MESMO socket cru, recebe 201, e confere que o arquivo continua em disco tres
// segundos depois.
//
// PROVA DE QUE REPROVA (executada em 2026-08-26, node 24.13.0, Windows): com
// `multer.diskStorage` no lugar do `armazenamentoAbortavel` em
// `images.routes.js`, reprovam os casos 1 (1 blob onde espera 0), 4 (2 blobs
// onde espera 1) e 5 (a sonda de descritor nao volta a linha de base). Os casos
// 2 e 3 passam nas duas versoes, e e essa a funcao deles: eles nao aferem o
// defeito, aferem que o conserto nao criou um pior.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { existsSync, rmSync, openSync, closeSync } from 'node:fs';
import { devNull } from 'node:os';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, loginUser } from '../helpers/fixtures.js';
import { contarBlobs, blobsEmDisco } from '../helpers/blobs-em-disco.js';
import config from '../../src/config.js';

// PNG 1x1 valido. `uploadImage` confere os bytes magicos com `fileTypeFromFile`,
// entao um texto qualquer reprovaria pelo motivo errado.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64',
);

// O corpo declarado fica ABAIXO do teto de 10 MB da rota, de proposito: se
// passasse do teto, o caminho exercitado seria o do LIMIT_FILE_SIZE, que ja
// limpa direito, e o teste mediria outra coisa.
const BYTES_DECLARADOS = 6 * 1024 * 1024;
// Quanto se envia antes de derrubar. Basta folgadamente para o busboy fechar o
// cabecalho da parte e o `_handleFile` criar o arquivo em disco.
const BYTES_ENVIADOS = 256 * 1024;

const dorme = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Numero do proximo descritor de arquivo livre do processo. O servidor roda
 * DENTRO deste processo (`app.listen`), entao um descritor que o upload nao
 * devolveu aparece aqui como um numero maior. Ver o caso 5.
 *
 * @returns {number}
 */
function sondaDescritor() {
  const fd = openSync(devNull, 'r');
  closeSync(fd);
  return fd;
}

/**
 * Cabecalho da parte multipart. O boundary NAO e fechado por quem aborta.
 *
 * @param {string} boundary
 * @returns {Buffer}
 */
function parteImagem(boundary) {
  return Buffer.from(
    `--${boundary}\r\n`
    + 'Content-Disposition: form-data; name="image"; filename="a.png"\r\n'
    + 'Content-Type: image/png\r\n\r\n',
  );
}

/**
 * Socket cru com um POST multipart. Devolve o controle do socket para que o
 * teste decida entre completar o corpo ou derrubar a conexao no meio.
 *
 * @param {number} port
 * @param {string} rota
 * @param {string} token
 * @param {Buffer} corpo o que se escreve de imediato
 * @param {number} tamanhoDeclarado valor do Content-Length
 * @param {{fecharConexao?: boolean}} [opcoes]
 */
function postCru(port, rota, token, corpo, tamanhoDeclarado, opcoes = {}) {
  const boundary = opcoes.boundary;
  const socket = net.connect(port, '127.0.0.1');
  const estado = { bruto: Buffer.alloc(0), status: null };
  const respondeu = new Promise((resolver) => {
    socket.on('data', (chunk) => {
      estado.bruto = Buffer.concat([estado.bruto, chunk]);
      if (estado.status === null) {
        const linha = estado.bruto.toString('latin1').split('\r\n')[0];
        const m = /^HTTP\/1\.\d (\d{3})/.exec(linha);
        if (m) {
          estado.status = Number(m[1]);
          resolver(estado.status);
        }
      }
    });
    // Socket derrubado nunca responde, e isso e o proprio defeito. O teste que
    // espera resposta usa `Promise.race` com prazo, nunca este promise sozinho.
    socket.on('close', () => resolver(estado.status));
  });
  socket.on('error', () => {}); // socket abortado nao pode lancar

  const enviou = once(socket, 'connect').then(() => {
    const cabecalho = [
      `POST ${rota} HTTP/1.1`,
      'Host: 127.0.0.1',
      `Authorization: Bearer ${token}`,
      `Content-Type: multipart/form-data; boundary=${boundary}`,
      `Content-Length: ${tamanhoDeclarado}`,
      opcoes.fecharConexao ? 'Connection: close' : 'Connection: keep-alive',
      '',
      '',
    ].join('\r\n');
    socket.write(cabecalho);
    socket.write(corpo);
  });

  return { socket, estado, enviou, respondeu };
}

/**
 * Monta o corpo COMPLETO e bem formado de um upload de imagem.
 *
 * @param {string} boundary
 * @param {number} recheio bytes de enchimento depois do PNG
 * @returns {Buffer}
 */
function corpoCompleto(boundary, recheio) {
  return Buffer.concat([
    parteImagem(boundary),
    PNG_1X1,
    Buffer.alloc(recheio, 0x41),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
}

/** Rejeita em vez de pendurar, que e exatamente o sintoma do defeito. */
function comPrazo(promessa, ms, oque) {
  let timer;
  return Promise.race([
    Promise.resolve(promessa).then((v) => {
      clearTimeout(timer);
      return v;
    }),
    new Promise((_, rejeitar) => {
      timer = setTimeout(() => rejeitar(new Error(`prazo de ${ms}ms estourou: ${oque}`)), ms);
    }),
  ]);
}

describe('upload abortado no meio nao pode deixar blob nem descritor', () => {
  let app, db, server, port, dono, token;
  const sfx = randomUUID().slice(0, 8);
  const atlasPorCaso = [];

  /** Cria um atlas exclusivo do caso, para que a contagem de blobs seja isolada. */
  async function novoAtlas(nome) {
    const a = await createAtlas(db, dono.id, { name: `abort ${nome} ${sfx}` });
    const dir = resolve(join(config.images.dir, a.id));
    atlasPorCaso.push(dir);
    return { id: a.id, dir };
  }

  before(async () => {
    ({ app, db } = await setupTestEnv());
    dono = await createUser(db, { username: `abort-dono-${sfx}` });
    token = await loginUser(app, dono.username, dono.password);

    // Servidor de verdade: o supertest nao derruba socket no meio.
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    port = server.address().port;
  });

  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    for (const dir of atlasPorCaso) {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    }
    await teardownTestEnv(db);
  });

  it('caso 1: aborto no meio nao deixa blob parcial em disco', async () => {
    const atlas = await novoAtlas('caso1');
    const boundary = `x${randomUUID().replace(/-/g, '')}`;
    const parcial = Buffer.concat([
      parteImagem(boundary),
      PNG_1X1,
      Buffer.alloc(BYTES_ENVIADOS, 0x41),
    ]);

    const req = postCru(port, `/api/v1/atlas/${atlas.id}/images`, token, parcial, BYTES_DECLARADOS, { boundary });
    await req.enviou;
    await dorme(500);

    // PRECONDICAO. Sem ela um "0 blobs" no fim nao distingue "o conserto
    // limpou" de "nada chegou a ser escrito", e o teste seria vacuo.
    assert.equal(
      contarBlobs(atlas.dir), 1,
      'precondicao: o multer ja deveria estar gravando o blob parcial',
    );

    req.socket.destroy();
    await dorme(800);

    assert.deepEqual(
      blobsEmDisco(atlas.dir), [],
      'o aborto deixou blob orfao em disco',
    );
  });

  it('caso 2 (CONTROLE NEGATIVO): upload que termina bem continua em disco', async () => {
    const atlas = await novoAtlas('caso2');
    const boundary = `x${randomUUID().replace(/-/g, '')}`;
    const corpo = corpoCompleto(boundary, 64 * 1024);

    const req = postCru(port, `/api/v1/atlas/${atlas.id}/images`, token, corpo, corpo.length, { boundary });
    await req.enviou;
    const status = await comPrazo(req.respondeu, 10000, 'o upload completo nao respondeu');
    assert.equal(status, 201, 'o upload legitimo pelo socket cru nao deu 201');

    assert.equal(contarBlobs(atlas.dir), 1, 'o upload bem-sucedido nao gravou o blob');

    // Tres segundos: o gancho de aborto dispara no `close` do socket, que chega
    // DEPOIS da resposta. Se ele apagasse sem discriminar, o blob sumiria aqui.
    req.socket.destroy();
    await dorme(3000);
    assert.equal(
      contarBlobs(atlas.dir), 1,
      'o gancho de aborto apagou um arquivo BOM',
    );
  });

  it('caso 3: upload completo com Connection: close testa o guarda da bandeira', async () => {
    // Com `Connection: close` o `close` de `req` chega colado no `finish` do
    // WriteStream. Aqui quem segura o arquivo e a bandeira por chamada, nao o
    // `req.complete`, porque as duas condicoes se resolvem quase no mesmo tique.
    const atlas = await novoAtlas('caso3');
    const boundary = `x${randomUUID().replace(/-/g, '')}`;
    const corpo = corpoCompleto(boundary, 32 * 1024);

    const req = postCru(
      port, `/api/v1/atlas/${atlas.id}/images`, token, corpo, corpo.length,
      { boundary, fecharConexao: true },
    );
    await req.enviou;
    const status = await comPrazo(req.respondeu, 10000, 'o upload com Connection: close nao respondeu');
    assert.equal(status, 201);

    await dorme(1000);
    assert.equal(
      contarBlobs(atlas.dir), 1,
      'o fechamento da conexao apagou o arquivo recem-gravado',
    );
  });

  it('caso 4: aborto concorrente nao leva junto o upload que terminou', async () => {
    const atlas = await novoAtlas('caso4');
    const bAborta = `x${randomUUID().replace(/-/g, '')}`;
    const bCompleta = `x${randomUUID().replace(/-/g, '')}`;

    const parcial = Buffer.concat([
      parteImagem(bAborta),
      PNG_1X1,
      Buffer.alloc(BYTES_ENVIADOS, 0x42),
    ]);
    const morre = postCru(
      port, `/api/v1/atlas/${atlas.id}/images`, token, parcial, BYTES_DECLARADOS,
      { boundary: bAborta },
    );
    await morre.enviou;
    await dorme(400);
    assert.equal(contarBlobs(atlas.dir), 1, 'precondicao: o upload que vai morrer ja escreve');

    const corpo = corpoCompleto(bCompleta, 32 * 1024);
    const vive = postCru(
      port, `/api/v1/atlas/${atlas.id}/images`, token, corpo, corpo.length,
      { boundary: bCompleta },
    );
    await vive.enviou;
    const status = await comPrazo(vive.respondeu, 10000, 'o upload concorrente nao respondeu');
    assert.equal(status, 201);

    morre.socket.destroy();
    await dorme(800);
    vive.socket.destroy();

    const restantes = blobsEmDisco(atlas.dir);
    assert.equal(
      restantes.length, 1,
      `sobrou ${restantes.length} blob(s) onde so o upload bem-sucedido devia ficar: ${restantes.join(', ')}`,
    );
  });

  it('caso 5: o descritor de arquivo volta ao sistema depois do aborto', async () => {
    // O SEGUNDO VAZAMENTO, o pior, medido em vez de deduzido.
    //
    // O PALPITE INICIAL ERA OUTRO, E FOI REFUTADO NA BANCADA. Esperava-se que o
    // Windows recusasse `rmSync` do diretorio com EBUSY enquanto o WriteStream
    // estivesse aberto. MEDIDO com o defeito presente: o `rmSync` PASSA. A libuv
    // abre o arquivo com FILE_SHARE_DELETE, entao a exclusao e permitida mesmo
    // com handle vivo, e o teste seria vacuo. O sumico do arquivo nao prova nada
    // sobre o descritor.
    //
    // O QUE MEDE DE VERDADE: o numero do proximo descritor livre. Tanto no POSIX
    // quanto no CRT do Windows a alocacao e do menor livre primeiro, o que foi
    // conferido nesta maquina (base 3; com um WriteStream aberto 4; com dois 5;
    // depois de destruir, 3 outra vez). Se o `out.destroy()` do gancho nao rodar,
    // o descritor do blob parcial fica preso e a sonda nao volta a linha de base.
    const atlas = await novoAtlas('caso5');
    const boundary = `x${randomUUID().replace(/-/g, '')}`;
    const parcial = Buffer.concat([
      parteImagem(boundary),
      PNG_1X1,
      Buffer.alloc(BYTES_ENVIADOS, 0x43),
    ]);

    const base = sondaDescritor();

    const req = postCru(port, `/api/v1/atlas/${atlas.id}/images`, token, parcial, BYTES_DECLARADOS, { boundary });
    await req.enviou;
    await dorme(500);
    assert.equal(contarBlobs(atlas.dir), 1, 'precondicao: ha um blob parcial sendo escrito');
    // PRECONDICAO DA PROPRIA SONDA: sem esta linha, um "voltou a base" no fim nao
    // distingue "o descritor foi devolvido" de "a sonda nunca enxergou nada".
    assert.ok(
      sondaDescritor() > base,
      'precondicao: a sonda deveria ver o descritor do WriteStream em uso',
    );

    req.socket.destroy();
    await dorme(800);

    assert.equal(
      sondaDescritor(), base,
      'o descritor do blob parcial ficou preso: cada aborto vaza um handle de arquivo',
    );

    rmSync(atlas.dir, { recursive: true, force: true });
    assert.equal(existsSync(atlas.dir), false, 'o diretorio do atlas nao saiu do disco');
  });
});
