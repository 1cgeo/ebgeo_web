// Path: tests/integration/users-search-scope.test.js
// Item 171 — SEARCH_USERS: os dois LEFT JOIN, o shape da linha e o escopo ENTRE organizações.
//
// ESTE ARQUIVO MUDOU DE SUJEITO EM 2026-09-14 (decisão D13), e a metade que virou o contrário
// vale ser dita. Ele nasceu para prender os ramos OR por POSTO e por ORGANIZAÇÃO, porque apagar
// os JOINs deixava a suíte verde e esvaziava as colunas Posto/OM do autocomplete de
// compartilhamento. Os dois ramos SAÍRAM do casamento: casar contra um atributo COLETIVO é
// enumeração do efetivo com outro nome, e o achado P8 mediu o custo (o nome de uma OM devolvia o
// efetivo dela, vinte linhas por vez, para qualquer conta).
//
// O QUE ELE PRENDE HOJE É A OUTRA METADE DA MESMA DECISÃO: os JOINs continuam vivos e as duas
// colunas continuam na PROJEÇÃO, porque quem compartilha reconhece a pessoa pelo par posto + OM.
// O negativo (o termo que só existe no posto ou na OM não acha ninguém) mora em
// `busca-de-pessoas-nao-enumera.test.js`, junto com o piso de três caracteres e o teto de vinte.
//
// O escopo ENTRE ORGS continua sendo decisão declarada: não há filtro por organization_id, e o
// último caso aqui o registra por escrito, para o dia em que alguém propuser escopar.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, loginUser } from '../helpers/fixtures.js';

const U = () => `usrch_${randomUUID().slice(0, 8)}`;

// Shape congelado da linha do autocomplete de compartilhamento.
const CAMPOS = [
  'id', 'nome', 'organizacao_militar', 'organization_id',
  'posto_graduacao', 'rank_id', 'username',
].sort();

describe('GET /users/search — os LEFT JOIN de posto/OM, shape e escopo entre orgs', () => {
  let app, db, quemBusca, token;
  let comPosto, postoNome, orgB, usuarioOrgB, orgBNome, semPosto;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    quemBusca = await createUser(db, { username: U() });
    token = await loginUser(app, quemBusca.username, quemBusca.password);

    // Posto de nome ÚNICO (os postos semeados são compartilhados por quase todo
    // usuário da suíte, e o LIMIT 20 da query cortaria o alvo numa base povoada —
    // um teste que passa sozinho e falha em lote não prova a query, prova a ordem).
    postoNome = `Marechal ${randomUUID().slice(0, 12)}`;
    const { rows: rk } = await db.query(
      'INSERT INTO ranks (code, nome, nome_abrev, sort_order) VALUES (NULL, $1, $2, 900) RETURNING id',
      [postoNome, postoNome.slice(0, 20)]
    );
    comPosto = await createUser(db, { username: U(), nome: `Zulu ${U()}`, rank_id: rk[0].id });

    // Organização de nome ÚNICO, e um usuário nela.
    orgBNome = `Batalhao ${randomUUID().slice(0, 12)}`;
    const slug = `slug${randomUUID().slice(0, 12)}`;
    const { rows } = await db.query(
      'INSERT INTO organizations (nome, sigla, slug) VALUES ($1, $2, $3) RETURNING id',
      [orgBNome, slug.slice(0, 10), slug]
    );
    orgB = rows[0].id;
    usuarioOrgB = await createUser(db, { username: U(), nome: `Yankee ${U()}`, organization_id: orgB });

    // Usuário SEM posto (rank_id NULL): o LEFT JOIN tem de mantê-lo visível.
    semPosto = await createUser(db, { username: U(), nome: `Xray ${U()}`, rank_id: null });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const buscar = (q) =>
    supertest(app)
      .get(`/api/v1/users/search?q=${encodeURIComponent(q)}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

  it('LEFT JOIN de ranks: o posto vem na linha de quem é achado pelo LOGIN', async () => {
    // A METADE QUE SOBREVIVEU A D13. O ramo de CASAMENTO por posto saiu; o JOIN ficou, e é
    // por ele que a coluna Posto do autocomplete continua preenchida. Apagá-lo deixa a linha
    // com `posto_graduacao: null` sem erro em lugar nenhum.
    const res = await buscar(comPosto.username);

    const achou = res.body.data.results.find((u) => u.id === comPosto.id);
    assert.ok(achou, `quem tem o posto ${postoNome} continua achável pelo próprio login`);
    // A projeção é a ABREVIATURA desde 2026-09-16; a fixture a cria com os 20 primeiros
    // caracteres do nome. O que o caso mede continua sendo o LEFT JOIN vivo.
    assert.equal(achou.posto_graduacao, postoNome.slice(0, 20), 'e a coluna Posto vem preenchida pelo LEFT JOIN');
  });

  it('LEFT JOIN de organizations: a OM vem na linha de quem é achado pelo LOGIN', async () => {
    const res = await buscar(usuarioOrgB.username);

    const achou = res.body.data.results.find((u) => u.id === usuarioOrgB.id);
    assert.ok(achou, 'o LEFT JOIN de organização é alcançável pela rota');
    assert.equal(achou.organizacao_militar, orgBNome);
    assert.equal(achou.organization_id, orgB);
  });

  it('shape: exatamente os sete campos, e nada parecido com credencial', async () => {
    const res = await buscar(comPosto.username);
    assert.ok(res.body.data.results.length > 0, 'guarda de lista não-vazia');

    for (const linha of res.body.data.results) {
      assert.deepEqual(Object.keys(linha).sort(), CAMPOS, `shape inesperado: ${JSON.stringify(linha)}`);
      const suspeitas = Object.keys(linha).filter((k) => /password|hash|api_key|email/i.test(k));
      assert.deepEqual(suspeitas, [], 'a busca é aberta a qualquer autenticado: nada sensível pode sair');
    }
  });

  it('rank_id NULL aparece na busca com posto_graduacao null (LEFT JOIN, não INNER)', async () => {
    const res = await buscar(semPosto.username);

    const achou = res.body.data.results.find((u) => u.id === semPosto.id);
    assert.ok(achou, 'um INNER JOIN silenciaria TODO usuário sem posto');
    assert.equal(achou.rank_id, null);
    assert.equal(achou.posto_graduacao, null);
  });

  it('CARACTERIZAÇÃO: a busca é deliberadamente GLOBAL — org A encontra org B', async () => {
    // Quem busca está na org default; o alvo está na org B. O compartilhamento entre
    // OMs é o caso de uso (um atlas conjunto entre unidades), então a ausência de
    // filtro por organization_id aqui é DECISÃO, não esquecimento. Escopar por tenant
    // quebra este teste de propósito, e a decisão volta à mesa.
    assert.notEqual(quemBusca.organization_id, orgB, 'as duas orgs são mesmo diferentes');

    const res = await buscar(usuarioOrgB.username);
    const achou = res.body.data.results.find((u) => u.id === usuarioOrgB.id);
    assert.ok(achou, 'busca entre organizações é permitida por decisão de produto');
  });
});
