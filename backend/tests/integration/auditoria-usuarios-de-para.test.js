// Path: tests/integration/auditoria-usuarios-de-para.test.js
//
// A FAMÍLIA DE USUÁRIOS PASSA A REGISTRAR O QUE VIROU O QUÊ (cláusula 9.3).
//
// O DEFEITO QUE ISTO FECHA, e ele ficou visível na tela antes de ficar no registro: desde
// 2026-08-23 a aba de Administração avisa, ANTES do clique, que trocar o papel global ou a
// OM produtora de alguém revoga toda concessão viva que a pessoa deu, e relata depois
// quantas caíram. O efeito ficou visível para quem clica e continuava invisível para quem
// audita: a trilha dizia que houve um `USER_UPDATE` e não dizia o que mudou.
//
// O QUE ESTE ARQUIVO PRENDE, e é mais do que "existe uma chave `mudou`":
//
//   1. O MIOLO ENTRA LITERAL. `role` e `producer_org_id` são os dois fundamentos de
//      concessão de RAIZ, e é a mudança deles que derruba acervo alheio. Um de-para que
//      dissesse "o papel mudou" sem dizer de onde para onde não responde a pergunta que a
//      queda levanta.
//   2. A IDENTIDADE NÃO ENTRA LITERAL. `nome` sai por IMPRESSÃO: a trilha responde
//      "mudou? voltou ao que era?" sem gravar o nome civil de ninguém para sempre.
//   3. O CONTROLE NEGATIVO É PARTE DO CONTRATO. Um PUT que não muda nada escreve a linha
//      com o de-para VAZIO, e não um de-para de dez campos idênticos. A escolha entre
//      "não escreve" e "escreve vazio" foi por escrever vazio: a lista vazia distingue
//      "nada mudou" de "esta linha é antiga e não tem de-para", e a segunda leitura é a
//      que uma investigação erra.
//   4. O QUE FICA DE FORA FICA DE FORA. Nem credencial, nem `updated_at`, que muda em toda
//      gravação por construção e encheria toda linha de ruído.
//
// CONTROLE NEGATIVO EXECUTADO E MEDIDO, e a medição contrariou a previsão: revertendo o
// `...dePara` do `USER_UPDATE` (e o disjunto que faz nascer a linha do PUT só de papel) em
// `src/modules/users/users.service.js`, ficam vermelhos os CINCO casos, não os quatro que
// eu esperava. O quinto, que afirma AUSÊNCIAS, cairia verde num de-para inexistente se ele
// não carregasse o piso `mudou.length === 3` antes das ausências: foi esse piso que o
// segurou. Vale registrar a lição, porque ela é a da casa: um caso que só afirma o que NÃO
// está lá passa idêntico quando não há nada lá.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createAdminUser, createUser, createProducerUser, loginUser } from '../helpers/fixtures.js';

describe('trilha de usuários: o de-para diz o que virou o quê', () => {
  let app;
  let db;
  let tok;
  let orgA;
  let orgB;

  const rid = () => randomUUID().slice(0, 8);

  /** As linhas `USER_UPDATE` de um alvo, da mais antiga para a mais nova. */
  async function atualizacoes(targetId) {
    const { rows } = await db.query(
      `SELECT details FROM audit_trail
        WHERE action = 'USER_UPDATE' AND target_id = $1
        ORDER BY created_at ASC, id ASC`,
      [targetId],
    );
    return rows.map((r) => r.details);
  }

  /** A entrada do de-para de um campo, ou `undefined`. */
  const entradaDe = (detalhes, campo) => (detalhes?.mudou ?? []).find((m) => m.campo === campo);

  async function criarOrg(sigla) {
    const { rows } = await db.query(
      `INSERT INTO organizations (nome, slug, sigla) VALUES ($1, $2, $3) RETURNING id`,
      [`OM ${sigla}`, `om-${sigla.toLowerCase()}-${rid()}`, sigla],
    );
    return rows[0].id;
  }

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    const admin = await createAdminUser(db, { username: `dp_admin_${rid()}` });
    tok = await loginUser(app, admin.username, admin.password);
    orgA = await criarOrg(`DPA${rid().slice(0, 3)}`);
    orgB = await criarOrg(`DPB${rid().slice(0, 3)}`);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('a troca de PAPEL entra literal, com o valor de antes e o de depois', async () => {
    const alvo = await createUser(db, { username: `dp_role_${rid()}`, role: 'user' });

    // PISO — a conta começa sem linha nenhuma, senão a leitura abaixo poderia estar
    // olhando para o rastro de outro caso deste mesmo arquivo.
    assert.deepEqual(await atualizacoes(alvo.id), []);

    const res = await supertest(app)
      .put(`/api/v1/users/${alvo.id}`)
      .set('Authorization', `Bearer ${tok}`)
      .send({ role: 'credenciado' });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const linhas = await atualizacoes(alvo.id);
    // O PUT que traz SÓ o papel passou a produzir a linha: antes dela o de-para do campo
    // mais importante da família não tinha onde morar.
    assert.equal(linhas.length, 1, 'um PUT só de papel produz UMA linha USER_UPDATE');
    assert.deepEqual(
      entradaDe(linhas[0], 'role'),
      { campo: 'role', de: 'user', para: 'credenciado' },
      'o papel global entra no regime VALOR, de ponta a ponta',
    );
    // DISCRIMINAÇÃO — e ele é a ÚNICA mudança. Um walker que comparasse por identidade de
    // objeto reportaria toda coluna da linha como mudada, e o `deepEqual` acima passaria
    // no meio do ruído sem que ninguém percebesse.
    assert.deepEqual(linhas[0].mudou.map((m) => m.campo), ['role']);
    assert.deepEqual(linhas[0].outros, [], 'nenhum campo caiu para nome-só');
    assert.equal(linhas[0].truncado, false);
  });

  it('a troca da OM PRODUTORA entra literal, e é ela que derruba concessão de raiz', async () => {
    const alvo = await createProducerUser(db, orgA, { username: `dp_om_${rid()}` });
    assert.deepEqual(await atualizacoes(alvo.id), []);

    const res = await supertest(app)
      .put(`/api/v1/users/${alvo.id}`)
      .set('Authorization', `Bearer ${tok}`)
      .send({ producer_org_id: orgB });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const linhas = await atualizacoes(alvo.id);
    assert.equal(linhas.length, 1);
    assert.deepEqual(
      entradaDe(linhas[0], 'producer_org_id'),
      { campo: 'producer_org_id', de: orgA, para: orgB },
      'a OM produtora entra no regime VALOR: é o escopo que decide o que a conta mantém',
    );
    // A LOTAÇÃO NÃO SE MEXEU, e dizê-lo importa: os dois campos são colunas diferentes que
    // a tela mostra lado a lado, e a confusão entre eles já foi escalação de privilégio.
    assert.equal(entradaDe(linhas[0], 'organization_id'), undefined);
    assert.deepEqual(linhas[0].outros, []);
  });

  it('o NOME sai por impressão: nunca o valor, e a impressão diz que voltou ao que era', async () => {
    const NOME_ORIGINAL = 'Fulano Sensivel Da Silva';
    const NOME_NOVO = 'Beltrano Trocado De Nome';
    const alvo = await createUser(db, { username: `dp_nome_${rid()}`, nome: NOME_ORIGINAL });

    const put = (nome) => supertest(app)
      .put(`/api/v1/users/${alvo.id}`)
      .set('Authorization', `Bearer ${tok}`)
      .send({ nome })
      .expect(200);

    await put(NOME_NOVO);
    await put(NOME_ORIGINAL);

    const linhas = await atualizacoes(alvo.id);
    assert.equal(linhas.length, 2, 'duas edições, duas linhas');
    const ida = entradaDe(linhas[0], 'nome');
    const volta = entradaDe(linhas[1], 'nome');

    // PISO — as duas edições foram MESMO percebidas. Sem isto, "não contém o nome" seria
    // verdade por o campo nunca ter sido comparado.
    assert.equal(ida?.regime, 'impressao', 'o nome entra por impressão, e precisa ENTRAR');
    assert.equal(volta?.regime, 'impressao');
    assert.notEqual(ida.de, ida.para, 'a impressão discrimina a troca');

    // DISCRIMINAÇÃO — a pergunta que só a impressão responde: voltou ao que era.
    assert.equal(volta.para, ida.de, 'a mesma string dá a mesma impressão nas duas linhas');
    assert.equal(volta.de, ida.para);

    // E o valor não está em lugar nenhum das duas linhas.
    const cru = JSON.stringify(linhas);
    assert.equal(cru.includes(NOME_ORIGINAL), false, 'o nome civil não entra na trilha');
    assert.equal(cru.includes(NOME_NOVO), false);
  });

  it('CONTROLE NEGATIVO: um PUT que não muda nada escreve a linha com o de-para VAZIO', async () => {
    const NOME = `Igual ${rid()}`;
    const alvo = await createUser(db, { username: `dp_noop_${rid()}`, nome: NOME });

    const res = await supertest(app)
      .put(`/api/v1/users/${alvo.id}`)
      .set('Authorization', `Bearer ${tok}`)
      .send({ nome: NOME });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const linhas = await atualizacoes(alvo.id);
    // A LINHA EXISTE: o ato aconteceu, alguém tocou naquela conta, e isso é fato de
    // auditoria mesmo quando o valor não mudou.
    assert.equal(linhas.length, 1);
    assert.deepEqual(linhas[0].fields, ['nome'], 'o piso antigo continua: os NOMES dos campos');
    // E O DE-PARA ESTÁ VAZIO, com as três chaves presentes. Sem esta propriedade, o painel
    // reenviando a linha inteira a cada gravação fabricaria um de-para de dez campos
    // idênticos, e a trilha viraria ruído que ninguém lê.
    assert.deepEqual(linhas[0].mudou, []);
    assert.deepEqual(linhas[0].outros, []);
    assert.equal(linhas[0].truncado, false);
  });

  it('o que fica de fora fica de fora: nem credencial, nem o carimbo de hora que muda sempre', async () => {
    const alvo = await createUser(db, { username: `dp_fora_${rid()}`, role: 'user' });
    await supertest(app)
      .put(`/api/v1/users/${alvo.id}`)
      .set('Authorization', `Bearer ${tok}`)
      .send({ nome: `Outro ${rid()}`, role: 'producer', producer_org_id: orgA })
      .expect(200);

    const linhas = await atualizacoes(alvo.id);
    assert.equal(linhas.length, 1, 'piso: há uma linha para inspecionar');
    // PISO DO PISO — a linha registra ALGUMA coisa. Um de-para vazio passaria em todas as
    // ausências abaixo sem ter verificado nada, que é a cobertura vazia canônica da casa.
    assert.equal(linhas[0].mudou.length, 3, 'nome, papel e OM produtora mudaram');

    const cru = JSON.stringify(linhas[0]);
    for (const proibido of ['password', 'api_key', 'sessions_valid_from', 'updated_at', 'posto_graduacao']) {
      assert.equal(cru.includes(proibido), false, `${proibido} não pode aparecer na trilha`);
    }
    assert.equal(/\$2[aby]\$/.test(cru), false, 'nem hash bcrypt');
  });
});
