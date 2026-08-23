// Path: tests/integration/models3d-cena.test.js
// A CENA CAMINHÁVEL servida pelo mesmo serviço 3D, e ela NÃO é 3D Tiles: mora numa pasta,
// abre por outro visualizador e é lida EM FAIXA. Este arquivo prende o que essa diferença
// não pode mudar — o eixo de acesso, o `Range` e a conferência depois da instalação.
//
// POR QUE PASTA, E NÃO `.3dtiles`: o modelo convertido existe para resolver a multidão de
// objetos pequenos; a cena tem dezenas de arquivos e dois deles são grandes e lidos em
// faixa pelo motor de caminhada. O `Range` é o caso que decide: sem ele o visualizador
// baixaria o octree inteiro para ler o cabeçalho.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, loginUser } from '../helpers/fixtures.js';
import { invalidateAppConfigCache } from '../../src/modules/config/config.cache.js';
import { medirCena, caminhoLocalDaCena } from '../../src/modules/models3d/models3d.scene.js';
import { UPSERT_SCENE_3D } from '../../src/modules/models3d/models3d.queries.js';
import { query } from '../../src/database/index.js';
import config from '../../src/config.js';

const SUFIXO = randomUUID().slice(0, 8);
const CENA_PUB = `cena-pub-${SUFIXO}`;
const CENA_PRIV = `cena-priv-${SUFIXO}`;
// O octree é o arquivo que o visualizador lê em faixa; 4 KiB bastam para pedir um pedaço.
const VOXEL = Buffer.alloc(4096, 7);

const basePathDe = (id) => `${config.assets3d.baseUrl}/primeira-pessoa/${id}`;
const urlSplat = (id) => `${basePathDe(id)}/cena.sog`;
const urlVoxel = (id) => `${basePathDe(id)}/voxel/voxel.bin`;

/** Instala em disco uma cena mínima com o layout obrigatório. */
function instalarCena(id) {
  const raiz = caminhoLocalDaCena(basePathDe(id), config.assets3d);
  assert.ok(raiz, 'o basePath do teste tem de ser servido por este processo');
  rmSync(raiz, { recursive: true, force: true });
  mkdirSync(join(raiz, 'voxel'), { recursive: true });
  writeFileSync(join(raiz, 'cena.sog'), Buffer.alloc(2048, 3));
  writeFileSync(join(raiz, 'voxel', 'voxel-meta.json'), JSON.stringify({ dims: [1, 1, 1] }));
  writeFileSync(join(raiz, 'voxel', 'voxel.bin'), VOXEL);
  return raiz;
}

async function registrarCena(db, id, accessLevel, medida) {
  await db.query(
    `INSERT INTO tilesets (id, name, config, sort_order, active, access_level)
     VALUES ($1, $2, $3::jsonb, 0, true, $4)`,
    [
      id,
      `Cena ${id}`,
      JSON.stringify({ forma3d: 'indoor', viewer: 'firstPerson', basePath: basePathDe(id) }),
      accessLevel,
    ],
  );
  await query(UPSERT_SCENE_3D, {
    sceneId: id,
    basePath: basePathDe(id),
    fileCount: medida.arquivos.length,
    totalBytes: medida.totalBytes,
    manifestSha256: medida.sha256,
    sourcePath: null,
  });
}

describe('models3d — a cena caminhável no mesmo serviço', () => {
  let app, db, raizPub, raizPriv, tokenBeneficiario, tokenForasteiro;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    raizPub = instalarCena(CENA_PUB);
    raizPriv = instalarCena(CENA_PRIV);
    await registrarCena(db, CENA_PUB, 'public', await medirCena(raizPub));
    await registrarCena(db, CENA_PRIV, 'private', await medirCena(raizPriv));

    const admin = await createAdminUser(db);
    const beneficiario = await createUser(db);
    const forasteiro = await createUser(db);
    // Os dois são gêmeos: mesma fábrica, mesmo papel, nenhum atlas. A ÚNICA diferença no
    // banco é a linha de concessão abaixo, e é ela que o par mede.
    await db.query(
      `INSERT INTO resource_grants (resource_type, resource_id, grantee_id, grant_level, granted_by)
       VALUES ('tileset', $1, $2, 'view_share', $3)`,
      [CENA_PRIV, beneficiario.id, admin.id],
    );
    // `loginUser` devolve o token, não o envelope: um `.accessToken` aqui daria `undefined`,
    // o pedido "autorizado" sairia sem credencial e o 404 dele passaria pelo motivo errado.
    tokenBeneficiario = await loginUser(app, beneficiario.username, 'Test@1234');
    tokenForasteiro = await loginUser(app, forasteiro.username, 'Test@1234');
    invalidateAppConfigCache();
  });

  after(async () => {
    for (const raiz of [raizPub, raizPriv]) {
      if (raiz && existsSync(raiz)) rmSync(raiz, { recursive: true, force: true });
    }
    await db.query('DELETE FROM resource_grants WHERE resource_id LIKE $1', [`cena-%${SUFIXO}`]);
    await db.query('DELETE FROM a3d.scenes WHERE scene_id LIKE $1', [`cena-%${SUFIXO}`]);
    await db.query('DELETE FROM tilesets WHERE id LIKE $1', [`cena-%${SUFIXO}`]);
    invalidateAppConfigCache();
    await teardownTestEnv(db);
  });

  it('a cena PÚBLICA sai sem credencial, e o splat é imutável como qualquer asset', async () => {
    const res = await supertest(app).get(urlSplat(CENA_PUB)).expect(200);
    assert.match(res.headers['cache-control'], /immutable/);
    assert.equal(res.headers['accept-ranges'], 'bytes');
  });

  it('o octree responde a Range com 206, que é como o visualizador o lê', async () => {
    // Sem isto o motor de caminhada baixaria o octree inteiro só para ler o cabeçalho.
    const faixa = await supertest(app)
      .get(urlVoxel(CENA_PUB))
      .set('Range', 'bytes=0-15')
      .expect(206);
    assert.equal(faixa.headers['content-length'], '16');
    assert.match(faixa.headers['content-range'], /^bytes 0-15\/4096$/);
  });

  it('a cena PRIVADA segue o mesmo gate dos modelos: anônimo 404, concessão 200', async () => {
    // O índice de regime indexa `config.basePath` como PASTA, então a cena privada é
    // gateada sem uma linha de código a mais — e é isso que este caso prova.
    await supertest(app).get(urlSplat(CENA_PRIV)).expect(404);
    await supertest(app)
      .get(urlSplat(CENA_PRIV))
      .set('Authorization', `Bearer ${tokenForasteiro}`)
      .expect(404);

    const autorizado = await supertest(app)
      .get(urlSplat(CENA_PRIV))
      .set('Authorization', `Bearer ${tokenBeneficiario}`)
      .expect(200);
    assert.match(autorizado.headers['cache-control'], /^private/);
  });

  it('o gate alcança TODO arquivo de dentro da pasta, e não só o splat', async () => {
    // A pasta inteira pertence à linha de catálogo. Um gate que cobrisse só o endereço
    // publicado deixaria o octree e as fichas abertos, que é o dado.
    await supertest(app).get(urlVoxel(CENA_PRIV)).expect(404);
    await supertest(app)
      .get(`${basePathDe(CENA_PRIV)}/voxel/voxel-meta.json`)
      .expect(404);
    await supertest(app)
      .get(urlVoxel(CENA_PRIV))
      .set('Authorization', `Bearer ${tokenBeneficiario}`)
      .expect(200);
  });

  it('a assinatura registrada acusa a pasta trocada depois da instalação', async () => {
    // O par que dá sentido ao registro: enquanto os bytes são os mesmos, a assinatura
    // medida bate; um byte a mais em QUALQUER arquivo derruba a igualdade.
    const { rows } = await db.query('SELECT manifest_sha256, file_count FROM a3d.scenes WHERE scene_id = $1', [
      CENA_PUB,
    ]);
    const antes = await medirCena(raizPub);
    assert.equal(antes.sha256, rows[0].manifest_sha256);
    assert.equal(antes.arquivos.length, rows[0].file_count);

    writeFileSync(join(raizPub, 'voxel', 'voxel.bin'), Buffer.concat([VOXEL, Buffer.from([1])]));
    const depois = await medirCena(raizPub);
    assert.notEqual(depois.sha256, rows[0].manifest_sha256);

    writeFileSync(join(raizPub, 'voxel', 'voxel.bin'), VOXEL);
    assert.equal((await medirCena(raizPub)).sha256, rows[0].manifest_sha256);
  });
});
