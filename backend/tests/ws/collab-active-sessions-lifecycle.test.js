// Path: tests/ws/collab-active-sessions-lifecycle.test.js
// Itens 79 + 100 — `active_sessions` não tem mais ESCRITOR, por decisão de 2026-07-25.
//
// O QUE ESTE ARQUIVO AFIRMAVA ANTES, e por que foi reescrito em vez de apagado.
// Ele prendia o CICLO DE VIDA da linha: aparece no connect, some no close, sobrevive à
// graça `away`, uma linha por aba. Era coverage honesta de um comportamento que a
// decisão retirou — e as três armadilhas que ele documentava continuam sendo a
// justificativa dela, então elas ficam registradas aqui:
//
//   1. `createSession`/`deleteSession` eram fire-and-forget, então um connect seguido de
//      close rápido podia commitar o DELETE antes do INSERT e orfanar a linha;
//   2. nada expurgava a tabela, e todo restart com usuário conectado orfanava, em
//      silêncio, TODA linha viva;
//   3. nenhum `SELECT` dela existia em `backend/src` inteiro — a presença viva é o `Map`
//      em memória de `collab.rooms.js`, chaveado por `clientId`.
//
// Ou seja: a tabela PARECIA trilha durável de sessão e não conseguia ser uma. Coluna
// viva pela metade engana mais que coluna ausente (mesma lição do `org_role` sem
// escritor). A tabela FICA — migração é forward-only e aditiva, e derrubá-la seria DDL
// destrutiva, que `tests/unit/migrations-higiene.test.js` recusa — mas RESERVADA.
//
// INVARIANTE NOVO: nenhum caminho de socket escreve em `active_sessions`. Não é "escreve
// pouco" nem "escreve e limpa": é zero.
//
// A pergunta de ouro para cada verde abaixo — "o que ele estaria provando se o código
// estivesse errado?" — é o motivo do primeiro caso: contar zero linhas passa verde tanto
// quando ninguém escreve quanto quando a CONTAGEM está quebrada (nome de tabela errado,
// coluna trocada). O caso de discriminação escreve uma linha à mão e exige que ela
// apareça, então o zero dos demais significa alguma coisa.
//
// CONTROLE NEGATIVO (executado): restaurando `collab.gateway.js` e `collab.service.js`
// do backup (com as duas chamadas de sessão de volta), caem 4 dos 6 casos. Restauração
// por CÓPIA do backup, nunca `git checkout`.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createShare, loginUser } from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';
import { attachWebSocket, setAwayGraceMs } from '../../src/modules/collab/collab.gateway.js';

const U = () => `sess_${randomUUID().slice(0, 8)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GRACA_MS = 600;

// Janela em que uma escrita fire-and-forget teria tempo de commitar. Menor que isto e o
// caso poderia passar só porque o INSERT ainda não tinha chegado ao banco — verde por
// pressa, que é a família de falso-verde mais cara deste repositório.
const JANELA_DE_ESCRITA_MS = 700;

describe('active_sessions não tem escritor (itens 79 e 100)', () => {
  let app, db, server;
  let owner, atlas;
  let user, token;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    server = createServer(app);
    attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, resolve));
    setAwayGraceMs(GRACA_MS);

    owner = await createUser(db, { username: U() });
    atlas = await createAtlas(db, owner.id, { name: `Atlas ${U()}` });
    await createMap(db, atlas.id);

    user = await createUser(db, { username: U() });
    await createShare(db, atlas.id, user.id, 'write', owner.id);
    token = await loginUser(app, user.username, user.password);
  });

  after(async () => {
    setAwayGraceMs(120000);
    await new Promise((resolve) => server.close(resolve));
    await teardownTestEnv(db);
  });

  async function contarSessoes(clientId) {
    const { rows } = await db.query(
      'SELECT COUNT(*)::int AS n FROM active_sessions WHERE user_id = $1 AND atlas_id = $2 AND client_id = $3',
      [user.id, atlas.id, clientId]
    );
    return rows[0].n;
  }

  it('discriminação: a tabela existe, aceita escrita e a contagem enxerga a linha', async () => {
    // Sem este caso, todo "0 linhas" abaixo poderia ser um erro de digitação passando
    // por verificação.
    const cid = `probe-${randomUUID().slice(0, 8)}`;
    assert.equal(await contarSessoes(cid), 0, 'guarda: começa vazio');

    await db.query(
      'INSERT INTO active_sessions (user_id, atlas_id, client_id) VALUES ($1, $2, $3)',
      [user.id, atlas.id, cid]
    );
    assert.equal(await contarSessoes(cid), 1, 'a contagem tem de enxergar uma linha realmente escrita');

    await db.query('DELETE FROM active_sessions WHERE client_id = $1', [cid]);
    assert.equal(await contarSessoes(cid), 0);
  });

  it('connect + close limpo (1000): nenhuma linha em momento nenhum', async () => {
    const cid = `c-${randomUUID().slice(0, 8)}`;
    const client = await createWsClient(server, atlas.id, token, cid);
    await client.waitForType('connected');

    // O ponto exato onde o INSERT rodava. A janela dá tempo de ele commitar, se existisse.
    await sleep(JANELA_DE_ESCRITA_MS);
    assert.equal(await contarSessoes(cid), 0, 'o connect não pode escrever sessão');

    client.ws.close(1000, 'bye');
    await sleep(JANELA_DE_ESCRITA_MS);
    assert.equal(await contarSessoes(cid), 0, 'e o close não tem nada a apagar');
  });

  it('queda anormal (1006) e expiração da graça: nenhuma linha', async () => {
    const cid = `c-${randomUUID().slice(0, 8)}`;
    const client = await createWsClient(server, atlas.id, token, cid);
    await client.waitForType('connected');
    await sleep(JANELA_DE_ESCRITA_MS);
    assert.equal(await contarSessoes(cid), 0);

    client.ws.terminate();
    await sleep(GRACA_MS + JANELA_DE_ESCRITA_MS);
    assert.equal(await contarSessoes(cid), 0, 'nem o caminho away escreve');
  });

  it('corrida connect→close imediato: nenhuma linha órfã, porque não há linha', async () => {
    // A corrida ORIGINAL (DELETE commitando antes do INSERT) deixava órfã uma linha que
    // ninguém limpava. Sem escritor, o caminho mais curto simplesmente não produz nada.
    const cid = `c-${randomUUID().slice(0, 8)}`;
    const addr = server.address();
    const port = typeof addr === 'object' ? addr.port : addr;
    const url = `ws://localhost:${port}/api/v1/collab?atlasId=${atlas.id}&token=${token}&clientId=${cid}`;

    await new Promise((resolve) => {
      const ws = new WebSocket(url);
      ws.on('open', () => {
        ws.close(1000, 'imediato');
        resolve();
      });
      ws.on('error', () => resolve());
      setTimeout(resolve, 4000);
    });

    await sleep(JANELA_DE_ESCRITA_MS);
    assert.equal(await contarSessoes(cid), 0);
  });

  it('duas abas simultâneas: nenhuma linha, e a presença segue viva na memória', async () => {
    const cidA = `a-${randomUUID().slice(0, 8)}`;
    const cidB = `b-${randomUUID().slice(0, 8)}`;
    const abaA = await createWsClient(server, atlas.id, token, cidA);
    await abaA.waitForType('connected');
    const abaB = await createWsClient(server, atlas.id, token, cidB);
    const conectadoB = await abaB.waitForType('connected');

    await sleep(JANELA_DE_ESCRITA_MS);
    assert.equal(await contarSessoes(cidA), 0);
    assert.equal(await contarSessoes(cidB), 0);

    // A verificação que importa: a presença NÃO regrediu com a remoção da escrita — ela
    // nunca vinha da tabela. Duas sessões visíveis no roster, zero linhas no banco.
    const sessoesNoRoster = (conectadoB.usersOnline ?? []).filter((u) => u.id === user.id);
    assert.equal(
      sessoesNoRoster.length,
      2,
      `o roster em memória tem de listar as duas abas: ${JSON.stringify(conectadoB.usersOnline)}`
    );

    abaA.ws.close(1000);
    abaB.ws.close(1000);
  });

  it('guarda estrutural: nenhum SQL em backend/src referencia active_sessions', () => {
    // O caso de comportamento acima passa a valer só enquanto ninguém religa a escrita
    // por outro caminho. Este varre o código e falha na REINTRODUÇÃO, em qualquer módulo,
    // que é o único jeito de a decisão sobreviver a quem não leu o histórico.
    // Comentário `//` é removido antes da busca: a decisão está DOCUMENTADA em comentário
    // no gateway e na migração, e documentar não é escrever.
    const raizSrc = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src');

    const arquivos = [];
    const andar = (dir) => {
      for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
        const alvo = path.join(dir, entrada.name);
        if (entrada.isDirectory()) andar(alvo);
        else if (entrada.name.endsWith('.js')) arquivos.push(alvo);
      }
    };
    andar(raizSrc);

    assert.ok(arquivos.length >= 50, `guarda: esperava varrer >= 50 arquivos, varri ${arquivos.length}`);

    const citacoes = [];
    for (const arquivo of arquivos) {
      const linhas = fs.readFileSync(arquivo, 'utf8').split('\n');
      linhas.forEach((texto, i) => {
        if (texto.trim().startsWith('//') || texto.trim().startsWith('*')) return;
        if (/active_sessions/.test(texto)) {
          citacoes.push(`${path.relative(raizSrc, arquivo)}:${i + 1} ${texto.trim()}`);
        }
      });
    }

    assert.deepEqual(
      citacoes,
      [],
      'a tabela está RESERVADA e sem escritor por decisão de 2026-07-25; '
        + 'se voltar a ser usada, comece pelo LEITOR e reescreva este teste'
    );
  });
});
