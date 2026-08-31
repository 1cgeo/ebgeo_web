// Path: tests/integration/config-effective-invariant.repro.test.js
//
// A CLASSE DE DEFEITO QUE ESTE ARQUIVO GUARDA: um administrador emparedar o produto INTEIRO,
// para todo mundo e o anônimo inclusive, com um salvamento de configuração de aparência
// legítima. `map2d.minZoom` maior que `map2d.maxZoom` no documento efetivo faz o cliente
// entregar os dois verbatim ao construtor do MapLibre, que LEVANTA; o boot é fail-fast no
// `GET /api/config` e não tem plano B, então a aplicação para de carregar. O administrador vê
// 200 e nenhum sinal de que alguma coisa está errada, e a recuperação
// (`DELETE /config/admin`) existe só por curl, porque o painel que a dispararia vive no
// frontend que não sobe mais.
//
// A DEFESA MUDOU DE CAMADA EM 2026-08-31, e o arquivo mudou com ela. A faixa de zoom da
// aplicação deixou de ser configurável (decisão do dono): ela é FIXA em `MAP2D_BASE` e o
// único nível ajustável passou a ser o do mapa base, na linha de catálogo dele. Antes o que
// segurava era uma invariante calculada sobre o documento efetivo, e ela precisava existir
// porque as duas chaves entravam. Agora elas não entram, e o teste que interessa é outro.
//
// SÃO DUAS METADES, e nenhuma prova a outra:
//
//   1. A BORDA recusa as duas chaves. Não basta tirá-las do schema: `map2d` é
//      `.unknown(true)`, então uma chave apenas removida passaria como desconhecida, seria
//      GRAVADA em `config_settings` e voltaria a vencer no deep-merge. A recusa é nomeada
//      (`Joi.any().forbidden()`), e é isto que o primeiro bloco mede.
//
//   2. O DOCUMENTO JÁ GRAVADO não emparedou ninguém. Uma linha `app_config` escrita ANTES
//      da mudança carrega `map2d.minZoom` que nenhum corpo novo menciona e que borda nenhuma
//      alcança: ela sobrevive a toda fusão seguinte. Este é o insumo degenerado do arquivo, e
//      ele é construído à mão, ESCREVENDO DIRETO NO BANCO, porque a API já não consegue
//      produzi-lo. Sem esta metade, `podarZoomDeAplicacao` poderia ser apagado da leitura de
//      `getAppConfig` sem deixar nada vermelho.
//
// CONTROLE NEGATIVO: tire o `forbidden` do schema e o bloco 1 vira 200; tire a poda da
// leitura e o bloco 2 serve o zoom da linha velha.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createAdminUser, loginUser } from '../helpers/fixtures.js';
import { MAP2D_BASE } from '../../src/modules/config/config.static.js';

describe('a faixa de zoom da aplicação é fixa, e nada a derruba (repro)', () => {
  let app, db, adminTok;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    const admin = await createAdminUser(db);
    adminTok = await loginUser(app, admin.username, admin.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  beforeEach(async () => {
    await supertest(app)
      .delete('/api/v1/config/admin')
      .set('Authorization', `Bearer ${adminTok}`);
  });

  const put = (body) =>
    supertest(app)
      .put('/api/v1/config/admin')
      .set('Authorization', `Bearer ${adminTok}`)
      .send(body);

  const servido = async () => (await supertest(app).get('/api/v1/config').expect(200)).body.data.map2d;

  it('o par fixo é o que o produto serve', async () => {
    const map2d = await servido();
    assert.equal(map2d.minZoom, MAP2D_BASE.minZoom);
    assert.equal(map2d.maxZoom, MAP2D_BASE.maxZoom);
    assert.ok(map2d.minZoom <= map2d.maxZoom, 'e é consistente por construção');
  });

  it('a BORDA recusa minZoom sozinho, que era o payload que o painel produzia', async () => {
    // Era este o formato real do defeito: `diffNum` mandava só a chave que mudou, então
    // quem editasse apenas "Zoom mínimo" produzia `{map2d:{minZoom:20}}` pelo uso normal.
    const res = await put({ map2d: { minZoom: 20 } });
    assert.ok(res.status >= 400, `deveria recusar, veio ${res.status}`);
    const map2d = await servido();
    assert.equal(map2d.minZoom, MAP2D_BASE.minZoom, 'o valor fixo continua de pé');
  });

  it('a BORDA recusa maxZoom sozinho, e o par junto, mesmo quando consistente', async () => {
    assert.ok((await put({ map2d: { maxZoom: 16 } })).status >= 400);
    assert.ok((await put({ map2d: { minZoom: 4, maxZoom: 16 } })).status >= 400,
      'consistente ou não, a chave não é mais configurável');
    const map2d = await servido();
    assert.equal(map2d.maxZoom, MAP2D_BASE.maxZoom);
  });

  it('e a recusa NOMEIA o campo, em vez de reprovar a aba inteira em silêncio', async () => {
    const res = await put({ map2d: { minZoom: 20 } });
    assert.match(JSON.stringify(res.body), /[Zz]oom/);
  });

  it('o RESTO de map2d continua editável: a recusa é das duas chaves, não da seção', async () => {
    await put({ map2d: { maxPitch: 70 } }).expect(200);
    const map2d = await servido();
    assert.equal(map2d.maxPitch, 70, 'o override legítimo aplica');
    assert.equal(map2d.minZoom, MAP2D_BASE.minZoom, 'e o zoom fixo não se move junto');
  });

  it('O DOCUMENTO VELHO: uma linha gravada antes da mudança NÃO derruba o valor fixo', async () => {
    // O insumo degenerado, escrito DIRETO no banco porque a API já não o produz. É a forma
    // exata que emparedava: minZoom acima do teto estático.
    await db.query(
      `INSERT INTO config_settings (key, value) VALUES ('app_config', $1::jsonb)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify({ map2d: { minZoom: 20, maxZoom: 3, maxPitch: 70 } })],
    );

    const map2d = await servido();
    assert.equal(map2d.minZoom, MAP2D_BASE.minZoom, 'a linha velha não vence a poda da leitura');
    assert.equal(map2d.maxZoom, MAP2D_BASE.maxZoom);
    assert.ok(map2d.minZoom <= map2d.maxZoom, 'e o produto nunca serve um par que emparede');
    assert.equal(map2d.maxPitch, 70, 'o resto da linha velha continua valendo: a poda é cirúrgica');
  });

  it('e o próximo salvamento CICATRIZA a linha velha, em vez de conviver com ela', async () => {
    await db.query(
      `INSERT INTO config_settings (key, value) VALUES ('app_config', $1::jsonb)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify({ map2d: { minZoom: 20, maxZoom: 3 } })],
    );

    await put({ map2d: { maxPitch: 65 } }).expect(200);

    const { rows } = await db.query("SELECT value FROM config_settings WHERE key = 'app_config'");
    assert.equal(rows[0].value.map2d.minZoom, undefined, 'a chave morta some do documento gravado');
    assert.equal(rows[0].value.map2d.maxZoom, undefined);
    assert.equal(rows[0].value.map2d.maxPitch, 65);
  });
});
