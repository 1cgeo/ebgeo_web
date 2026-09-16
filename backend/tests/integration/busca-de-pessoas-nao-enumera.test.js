// Path: tests/integration/busca-de-pessoas-nao-enumera.test.js
//
// D13 (achado P8): `GET /users/search` deixa de enumerar o efetivo.
//
// O QUE ESTAVA ABERTO, e por que não era defeito de implementação: a rota é legítima e larga de
// propósito (compartilhar atlas é direito de qualquer conta, e para compartilhar é preciso achar
// a pessoa). O que a transformava em enumeração era o CASAMENTO por atributo COLETIVO: o `WHERE`
// carregava `LOWER(r.nome)` e `LOWER(o.nome)`, então o nome de uma organização devolvia o efetivo
// dela, vinte linhas por vez, para qualquer conta e para qualquer chave de API de escopo largo.
//
// OS CINCO CASOS SÃO UM PAR DE CONTROLES, e é isso que os torna prova em vez de afirmação:
//   - o piso de três caracteres (422 abaixo) MAIS a busca de três que funciona;
//   - o casamento por nome e por login que ACHA (positivo) MAIS o casamento por posto e por OM
//     que NÃO acha (negativo, com um usuário cujo único termo em comum com quem busca é a OM);
//   - o teto de vinte com `truncated` verdadeiro MAIS o caso abaixo do teto com `truncated`
//     falso, senão um `truncated: true` fixo passaria verde;
//   - o curinga escapado, que continua literal.
//
// O CASO NEGATIVO PRECISA DE UM TERMO QUE SÓ EXISTA NO POSTO E NA OM, e por isso as fixtures
// cunham um posto e uma organização de nome único: os postos semeados são compartilhados por
// quase todo usuário da suíte, e um teste que reprovasse por causa deles estaria medindo a base
// povoada, não a consulta.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, loginUser } from '../helpers/fixtures.js';

const U = () => `bpe_${randomUUID().slice(0, 8)}`;

describe('GET /users/search — a busca não enumera o efetivo (D13)', () => {
  let app, db, token;
  let postoNome, orgNome, orgId, soPeloPosto, soPelaOm;
  let marca, porNome, porLogin;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const quemBusca = await createUser(db, { username: U() });
    token = await loginUser(app, quemBusca.username, quemBusca.password);

    // Posto e OM de nome ÚNICO. O fragmento usado no teste negativo não aparece em nenhum
    // `username` nem em nenhum `nome`, então SÓ um ramo por posto ou por OM poderia casar.
    postoNome = `Marechal ${randomUUID().slice(0, 12)}`;
    const { rows: rk } = await db.query(
      'INSERT INTO ranks (code, nome, nome_abrev, sort_order) VALUES (NULL, $1, $2, 901) RETURNING id',
      [postoNome, postoNome.slice(0, 20)],
    );
    soPeloPosto = await createUser(db, { username: U(), nome: `Zulu ${U()}`, rank_id: rk[0].id });

    orgNome = `Batalhao ${randomUUID().slice(0, 12)}`;
    const slug = `slug${randomUUID().slice(0, 12)}`;
    const { rows: og } = await db.query(
      'INSERT INTO organizations (nome, sigla, slug) VALUES ($1, $2, $3) RETURNING id',
      [orgNome, slug.slice(0, 10), slug],
    );
    orgId = og[0].id;
    soPelaOm = await createUser(db, { username: U(), nome: `Yankee ${U()}`, organization_id: orgId });

    // Duas contas com uma marca comum: uma alcançável pelo NOME, a outra pelo LOGIN.
    marca = `mrc${randomUUID().slice(0, 9)}`;
    porNome = await createUser(db, { username: U(), nome: `Fulano ${marca} da Silva` });
    porLogin = await createUser(db, { username: `${marca}_login`, nome: 'Sem marca no nome' });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const buscar = (q) => supertest(app)
    .get(`/api/v1/users/search?q=${encodeURIComponent(q)}`)
    .set('Authorization', `Bearer ${token}`);

  it('menos de três caracteres é 422, e três caracteres respondem', async () => {
    for (const curto of ['a', 'ab']) {
      const res = await buscar(curto).expect(422);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR', `"${curto}" tem de ser recusado na borda`);
      assert.equal(res.body.data, undefined, 'nenhuma linha pode acompanhar a recusa');
    }

    // O POSITIVO DO PAR: sem ele, um schema que recusasse TUDO passaria verde no bloco acima.
    const ok = await buscar(marca.slice(0, 3)).expect(200);
    assert.ok(Array.isArray(ok.body.data.results), 'três caracteres continuam sendo uma busca');
  });

  it('casa por NOME e por LOGIN', async () => {
    const res = await buscar(marca).expect(200);
    const ids = res.body.data.results.map((u) => u.id);

    assert.ok(ids.includes(porNome.id), 'o ramo por `nome` está vivo');
    assert.ok(ids.includes(porLogin.id), 'o ramo por `username` está vivo');
  });

  it('NÃO casa por posto nem por OM, e a linha continua trazendo os dois', async () => {
    // CONTROLE NEGATIVO DO ACHADO. O fragmento existe no nome do POSTO e em mais lugar nenhum.
    const doPosto = await buscar(postoNome.slice(-10)).expect(200);
    assert.deepEqual(
      doPosto.body.data.results.map((u) => u.id), [],
      'buscar pelo nome de um posto não pode devolver quem o tem: é o efetivo por atributo coletivo',
    );

    const daOm = await buscar(orgNome.slice(-10)).expect(200);
    assert.deepEqual(
      daOm.body.data.results.map((u) => u.id), [],
      'buscar pelo nome de uma OM não pode devolver o efetivo dela',
    );

    // E A OUTRA METADE, que é o que separa "saiu do casamento" de "saiu do produto": posto e OM
    // continuam na PROJEÇÃO, porque quem compartilha reconhece a pessoa por eles. Sem esta
    // asserção, apagar os dois LEFT JOIN deixaria os dois blocos acima verdes.
    const peloLogin = await buscar(soPelaOm.username).expect(200);
    const achado = peloLogin.body.data.results.find((u) => u.id === soPelaOm.id);
    assert.ok(achado, 'quem só compartilha a OM continua achável pelo próprio login');
    assert.equal(achado.organizacao_militar, orgNome, 'a OM vem na linha');
    assert.equal(achado.organization_id, orgId);

    const doPostoPeloLogin = await buscar(soPeloPosto.username).expect(200);
    const comPosto = doPostoPeloLogin.body.data.results.find((u) => u.id === soPeloPosto.id);
    assert.ok(comPosto, 'idem para quem só compartilha o posto');
    // A PROJEÇÃO É A ABREVIATURA desde 2026-09-16 (`COALESCE(r.nome_abrev, r.nome)`), porque é
    // assim que o Exército escreve posto. O que este caso mede não mudou: o posto continua vindo
    // na linha, e é isso que separa "saiu do casamento da busca" de "saiu do produto".
    assert.equal(comPosto.posto_graduacao, postoNome.slice(0, 20), 'o posto vem na linha');
  });

  it('vinte de vinte e cinco, com `truncated`; e abaixo do teto `truncated` é falso', async () => {
    const lote = `lot${randomUUID().slice(0, 9)}`;
    for (let i = 0; i < 25; i += 1) {
      // O índice vai no NOME com dois algarismos, para a ordenação por `nome` ser estável.
      await createUser(db, { username: U(), nome: `${lote} ${String(i).padStart(2, '0')}` });
    }

    const cheio = await buscar(lote).expect(200);
    assert.equal(cheio.body.data.results.length, 20, 'o teto é vinte linhas');
    assert.equal(cheio.body.data.truncated, true, 'e a resposta DIZ que cortou');

    // O CONTROLE do `truncated`: sem este caso, devolvê-lo fixo em `true` passaria verde.
    const curto = `crt${randomUUID().slice(0, 9)}`;
    await createUser(db, { username: U(), nome: `${curto} unico` });
    const parcial = await buscar(curto).expect(200);
    assert.equal(parcial.body.data.results.length, 1);
    assert.equal(parcial.body.data.truncated, false, 'uma linha só não é resposta cortada');
  });

  it('o curinga digitado continua LITERAL: `%` e `_` não são padrão', async () => {
    const base = `esc${randomUUID().slice(0, 9)}`;
    const alvo = await createUser(db, { username: U(), nome: `${base}xyz` });

    const literal = await buscar(`${base}xyz`).expect(200);
    assert.ok(
      literal.body.data.results.some((u) => u.id === alvo.id),
      'guarda: o alvo é mesmo alcançável pelo termo literal',
    );

    const comCuringa = await buscar(`${base}_yz`).expect(200);
    assert.ok(
      !comCuringa.body.data.results.some((u) => u.id === alvo.id),
      'o `_` do usuário é sublinhado literal, nunca o curinga de um caractere',
    );

    // `%%` sozinho tem três caracteres se contar o par mais um: aqui o ponto é que um termo só de
    // curingas não vira varredura da tabela inteira.
    const soCuringas = await buscar('%%%').expect(200);
    assert.deepEqual(
      soCuringas.body.data.results, [],
      'um termo só de `%` casa o texto literal "%%%", que ninguém tem no nome ou no login',
    );
  });
});
