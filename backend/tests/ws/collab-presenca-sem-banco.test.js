// Path: tests/ws/collab-presenca-sem-banco.test.js
// A PRESENÇA NÃO TOCA O BANCO, e esta é a afirmação que sobreviveu à remoção de
// `active_sessions` (2026-08-23).
//
// O QUE ESTE ARQUIVO SUBSTITUI. Havia um teste de 221 linhas que contava linhas numa
// tabela para provar que nada as escrevia. Ele media UMA tabela, então uma escrita de
// presença que fosse parar em outro lugar passaria verde por ele; e quando a tabela saiu
// da baseline (ela nunca teve leitor, e a consolidação tirou o argumento forward-only que
// a mantinha), ele deixou de poder rodar. O que fica é a propriedade, medida direto: um
// ciclo de socket não emite ESCRITA nenhuma no banco.
//
// AS TRÊS ARMADILHAS que a decisão original registrou continuam sendo a justificativa
// dela, e ficam aqui porque o arquivo que as guardava não existe mais:
//
//   1. `createSession`/`deleteSession` eram fire-and-forget, então um connect seguido de
//      close rápido podia commitar o DELETE antes do INSERT e orfanar a linha;
//   2. nada expurgava a tabela, e todo restart com usuário conectado orfanava, em
//      silêncio, TODA linha viva;
//   3. nenhum `SELECT` dela existia em `backend/src` inteiro — a presença viva é o `Map`
//      em memória de `collab.rooms.js`, chaveado por `clientId`.
//
// O INSTRUMENTO É O CONTADOR DE POOL, o mesmo que `assets3d-privado.test.js` usa para
// afirmar "nenhuma consulta por requisição de asset". Ele conta TODO statement, leitura
// inclusive; o que este arquivo afirma é o subconjunto de ESCRITA, porque o caminho do
// socket legitimamente lê (autorização, permissão, snapshot).
//
// A PERGUNTA DE OURO para o verde abaixo — "o que ele estaria provando se o código
// estivesse errado?" — é o motivo do caso de discriminação: uma lista vazia de escritas
// passa verde tanto quando ninguém escreve quanto quando o contador parou de enxergar.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createShare, loginUser } from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';
import { installPoolQueryCounter } from '../helpers/query-counter.js';
// A ESCRITA DE DISCRIMINAÇÃO PRECISA PASSAR PELO MESMO POOL DO APP. O `db` que
// `setupTestEnv` devolve é um pool `pg` próprio do harness, e o contador patcheia o
// `db.query` do pg-promise: um UPDATE por aquele outro caminho não é visto, e o caso de
// discriminação reprovaria dizendo que o instrumento está cego quando ele está certo.
import { query as queryDoApp } from '../../src/database/index.js';
import { attachWebSocket, setAwayGraceMs } from '../../src/modules/collab/collab.gateway.js';

const U = () => `pres_${randomUUID().slice(0, 8)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GRACA_MS = 600;

// Janela em que uma escrita fire-and-forget teria tempo de commitar. Medir logo depois do
// `connected` daria verde por pressa, que é a família de falso-verde mais cara aqui.
const JANELA_DE_ESCRITA_MS = 700;

/** As escritas vistas pelo contador, na ordem em que saíram. */
function escritas(estado) {
  return estado.statements.filter((s) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(s));
}

describe('a presença do socket não escreve no banco', () => {
  let app, db, server, contador;
  let owner, atlas, user, token;

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

    // O contador entra DEPOIS das fixturas: elas escrevem, e legitimamente.
    contador = installPoolQueryCounter();
  });

  after(async () => {
    if (contador) contador.restore();
    setAwayGraceMs(120000);
    await new Promise((resolve) => server.close(resolve));
    await teardownTestEnv(db);
  });

  it('discriminação: o contador ENXERGA uma escrita de verdade', async () => {
    // Sem este caso, toda lista vazia abaixo passaria por verificação sendo apenas um
    // instrumento quebrado.
    contador.reset();
    await queryDoApp('UPDATE atlas SET updated_at = NOW() WHERE id = $1', [atlas.id]);
    assert.equal(escritas(contador.state).length, 1, 'o contador precisa ver o UPDATE');
    assert.match(escritas(contador.state)[0], /^UPDATE atlas/i);
  });

  it('connect + close limpo (1000): nenhuma escrita em momento nenhum', async () => {
    contador.reset();
    const client = await createWsClient(server, atlas.id, token, `c-${randomUUID().slice(0, 8)}`);
    await client.waitForType('connected');
    await sleep(JANELA_DE_ESCRITA_MS);

    assert.deepEqual(
      escritas(contador.state), [],
      'o connect não pode escrever: a presença vive no Map em memória',
    );
    // E o contador NÃO ficou mudo: o caminho de socket lê (autorização, permissão,
    // snapshot). Sem esta metade, o vazio acima também seria o resultado de um contador
    // que deixou de ver o pool inteiro.
    assert.ok(contador.state.count > 0, 'o connect lê o banco, e o contador tem de ver isso');

    client.ws.close(1000, 'bye');
    await sleep(JANELA_DE_ESCRITA_MS);
    assert.deepEqual(escritas(contador.state), [], 'e o close não tem nada a limpar');
  });

  it('queda anormal (1006) e expiração da graça: nenhuma escrita', async () => {
    contador.reset();
    const client = await createWsClient(server, atlas.id, token, `c-${randomUUID().slice(0, 8)}`);
    await client.waitForType('connected');
    await sleep(JANELA_DE_ESCRITA_MS);

    client.ws.terminate();
    await sleep(GRACA_MS + JANELA_DE_ESCRITA_MS);
    assert.deepEqual(escritas(contador.state), [], 'nem o caminho away escreve');
  });

  it('corrida connect→close imediato: nada a orfanar, porque nada é escrito', async () => {
    // A corrida ORIGINAL (o DELETE commitando antes do INSERT) deixava uma linha órfã que
    // ninguém limpava. Sem escritor, o caminho mais curto não produz nada.
    contador.reset();
    const client = await createWsClient(server, atlas.id, token, `c-${randomUUID().slice(0, 8)}`);
    client.ws.close(1000, 'bye');
    await sleep(GRACA_MS + JANELA_DE_ESCRITA_MS);
    assert.deepEqual(escritas(contador.state), [], 'connect e close colados não escrevem nada');
  });
});
