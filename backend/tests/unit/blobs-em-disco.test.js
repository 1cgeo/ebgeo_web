// Path: tests/unit/blobs-em-disco.test.js
//
// Fixa o INSTRUMENTO de contagem de blobs que cinco arquivos de integracao usam.
// O motivo esta por extenso em tests/helpers/blobs-em-disco.js: no Windows, o
// unlink de um blob deixa por milissegundos uma entrada `<UUID>.PNG.tmp` de zero
// byte, e contar entradas de diretorio transformava isso em vermelho intermitente.
//
// Estes casos existem para que o conserto nao seja desfeito por engano. Cada um
// deles REPROVA a versao anterior do instrumento.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync, readdirSync } from 'fs';
import { blobsEmDisco, contarBlobs } from '../helpers/blobs-em-disco.js';

describe('blobs-em-disco: o instrumento de contagem de blobs', () => {
  let dir;

  before(() => {
    dir = join(tmpdir(), `blobs-em-disco-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('diretorio inexistente conta zero, sem lancar', () => {
    assert.equal(contarBlobs(join(dir, 'nao-existe')), 0);
  });

  it('conta o blob que o servidor de fato escreve (<uuid>.<ext> minusculo)', () => {
    const nome = `${randomUUID()}.png`;
    writeFileSync(join(dir, nome), Buffer.from('conteudo'));
    assert.deepEqual(blobsEmDisco(dir), [nome]);
  });

  it('ignora o fantasma de exclusao do Windows, e a contagem crua NAO ignora', () => {
    // O rastro real, copiado de uma medicao: mesmo UUID em caixa alta, extensao em
    // caixa alta, sufixo .tmp, zero byte.
    const fantasma = '1058640C-B057-45D4-BB5E-91285B439E42.PNG.tmp';
    writeFileSync(join(dir, fantasma), Buffer.alloc(0));

    // A assercao que importa: as duas contagens DISCORDAM. Se alguem devolver o
    // helper para `readdirSync(dir).length`, esta linha cai.
    assert.equal(readdirSync(dir).length, 2, 'a contagem crua enxerga o fantasma');
    assert.equal(contarBlobs(dir), 1, 'a contagem de blobs nao o enxerga');
  });

  it('um orfao de verdade continua contando (o filtro nao e uma anistia)', () => {
    // Este e o caso que o filtro NAO pode deixar passar: blob parcial de uma
    // conexao derrubada no meio do upload. Nome normal, tamanho qualquer.
    const orfao = `${randomUUID()}.png`;
    writeFileSync(join(dir, orfao), Buffer.alloc(1024));
    assert.ok(blobsEmDisco(dir).includes(orfao), 'orfao de verdade tem de ser contado');
    assert.equal(contarBlobs(dir), 2, 'os dois blobs reais, e nada alem deles');
  });

  it('zero byte nao e criterio: blob real vazio com nome de blob conta', () => {
    // O fantasma tem zero byte, mas filtrar POR TAMANHO seria a regra errada: uma
    // escrita interrompida no primeiro byte tambem produz arquivo vazio, e esse
    // precisa reprovar.
    const vazio = `${randomUUID()}.webp`;
    writeFileSync(join(dir, vazio), Buffer.alloc(0));
    assert.ok(blobsEmDisco(dir).includes(vazio), 'blob vazio com nome de blob e orfao, e conta');
  });
});
