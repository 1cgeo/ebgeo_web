// Path: tests/integration/compartilhamento-identidade-militar.test.js
//
// A TELA DE COMPARTILHAMENTO IDENTIFICA NA FORMA MILITAR: posto abreviado, nome de guerra e
// unidade (`Cap Silva · 1º CGEO`), decisão do dono em 2026-09-20.
//
// POR QUE ISTO É REGRA DE DOMÍNIO. No Exército ninguém é identificado pelo nome civil por
// extenso: documento, assinatura e chamada dizem `Cap Silva`, e o nome de guerra é o nome que a
// própria pessoa escolheu — ele pode nem ser um pedaço do `nome` (`João Batista de Souza`
// conhecido como `Silva` é o caso comum, não a exceção). A tela escrevia `nome` completo mais
// `@login`, que é como um sistema civil nomeia gente, e quem compartilha um atlas precisava
// traduzir antes de reconhecer o colega.
//
// SÃO TRÊS PAYLOADS ALIMENTANDO A MESMA TELA, e é por isso que este arquivo cobre os três num
// lugar só: a busca de pessoas (`GET /users/search`), a lista de participantes e o bloco do dono
// (`GET /atlas/:id/sharing`). Medir um deles deixaria os outros dois livres para divergir no dia
// seguinte, e a divergência aparece na MESMA janela: o dono era justamente a linha que vinha sem
// posto e sem OM, no topo da lista.
//
// O CASAMENTO DA BUSCA É A OUTRA METADE, e sem ela a mudança seria uma armadilha: a tela escreve
// `Cap Silva`, então quem digita `Silva` tem de achar a pessoa. Enquanto a busca casava só
// `nome` e `username`, o nome que a tela mostrava era exatamente o que não se podia procurar.
// Isso NÃO reabre o achado P8 (D13, 2026-09-14): nome de guerra é atributo INDIVIDUAL, e o que
// aquela decisão tirou do casamento foram os COLETIVOS (posto e OM), que continuam fora — os
// dois casos negativos daquele arquivo seguem valendo e este não os repete.
//
// CADA POSITIVO TEM O NEGATIVO DO MESMO PAR. Uma consulta que devolvesse os campos sempre nulos
// passaria em qualquer teste que só conferisse a PRESENÇA da chave, e uma que devolvesse todo
// mundo passaria em qualquer busca que só conferisse que o alvo voltou.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createShare, loginUser } from '../helpers/fixtures.js';

const tag = randomUUID().replace(/-/g, '').slice(0, 10);

/** Um fragmento que só existe no NOME DE GUERRA de quem o recebe. */
const MARCA_GUERRA = `Zebrante${tag}`;

describe('a tela de compartilhamento identifica pela forma militar', () => {
  let app, db;
  let dono, donoTok, participante, semNada, atlas;
  let omComSigla, omSemSigla, usuarioSemSigla;

  const busca = (q, token) => supertest(app)
    .get(`/api/v1/users/search?q=${encodeURIComponent(q)}`)
    .set('Authorization', `Bearer ${token}`);

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    // O posto de nome inconfundível: "Primeiro Tenente" não se parece com "1º Ten" por
    // acidente de prefixo, então um teste que confunda as duas formas fica vermelho.
    const { rows: postos } = await db.query(
      "SELECT id FROM ranks WHERE nome = 'Primeiro Tenente' LIMIT 1"
    );
    assert.ok(postos[0], 'fixture: o posto semeado "Primeiro Tenente" tem de existir');

    const { rows: comSigla } = await db.query(
      `INSERT INTO organizations (nome, slug, sigla)
       VALUES ($1, $2, $3) RETURNING id, nome, sigla`,
      [`Centro de Geoinformacao ${tag}`, `cgeo-${tag}`, `CGEO${tag}`]
    );
    omComSigla = comSigla[0];

    // A OM SEM SIGLA É O RAMO DA QUEDA, e ele não é hipotético: `organizations.sigla` é
    // anulável e o painel de Pessoal deixa o campo em branco. Sem o `COALESCE` a linha
    // apareceria SEM unidade nenhuma, que é pior que a unidade comprida.
    const { rows: semSigla } = await db.query(
      `INSERT INTO organizations (nome, slug, sigla)
       VALUES ($1, $2, NULL) RETURNING id, nome`,
      [`Batalhao Sem Sigla ${tag}`, `bss-${tag}`]
    );
    omSemSigla = semSigla[0];

    dono = await createUser(db, {
      username: `mil_dono_${tag}`,
      nome: `Joao Batista de Souza ${tag}`,
      rank_id: postos[0].id,
      organization_id: omComSigla.id,
    });
    await db.query('UPDATE users SET nome_guerra = $1 WHERE id = $2', [MARCA_GUERRA, dono.id]);
    donoTok = await loginUser(app, dono.username, dono.password);

    participante = await createUser(db, {
      username: `mil_part_${tag}`,
      nome: `Maria Clara de Andrade ${tag}`,
      organization_id: omComSigla.id,
    });
    await db.query('UPDATE users SET nome_guerra = $1 WHERE id = $2', ['Andrade', participante.id]);

    // O CONTROLE: conta sem posto, sem OM e sem nome de guerra. As três colunas são anuláveis,
    // e uma conta administrativa recém-criada é exatamente assim.
    semNada = await createUser(db, {
      username: `mil_nada_${tag}`,
      nome: `Pessoa Sem Nada ${tag}`,
      rank_id: null,
      organization_id: null,
    });

    usuarioSemSigla = await createUser(db, {
      username: `mil_sigla_${tag}`,
      nome: `Pessoa Sem Sigla ${tag}`,
      organization_id: omSemSigla.id,
    });

    atlas = await createAtlas(db, dono.id, { name: `Atlas militar ${tag}` });
    await createMap(db, atlas.id);
    await createShare(db, atlas.id, participante.id, 'write', dono.id);
    await createShare(db, atlas.id, semNada.id, 'read', dono.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  // ── GET /users/search ──────────────────────────────────────────────────────
  describe('a busca de pessoas', () => {
    it('devolve nome de guerra e a SIGLA da OM ao lado dos campos antigos', async () => {
      const res = await busca(`Joao Batista de Souza ${tag}`, donoTok).expect(200);
      const alvo = res.body.data.results.find((u) => u.id === dono.id);

      assert.ok(alvo, 'premissa: o alvo tem de voltar pela busca por nome');
      assert.equal(alvo.nome_guerra, MARCA_GUERRA);
      assert.equal(alvo.posto_graduacao, '1º Ten', 'o posto continua vindo abreviado');
      assert.equal(alvo.organizacao_militar_sigla, omComSigla.sigla);
      // Os campos ANTIGOS ficam: `nome` é o fallback de quem não tem nome de guerra, e o nome
      // da OM por extenso tem consumidor. Acrescentar não é substituir.
      assert.equal(alvo.nome, `Joao Batista de Souza ${tag}`);
      assert.equal(alvo.organizacao_militar, omComSigla.nome);
    });

    it('a OM SEM sigla cai para o nome por extenso, em vez de vir vazia', async () => {
      const res = await busca(`Pessoa Sem Sigla ${tag}`, donoTok).expect(200);
      const alvo = res.body.data.results.find((u) => u.id === usuarioSemSigla.id);

      assert.ok(alvo);
      assert.equal(alvo.organizacao_militar_sigla, omSemSigla.nome);
      // DISCRIMINAÇÃO: o `COALESCE` não pode estar devolvendo o nome para TODO MUNDO, senão
      // o caso acima passaria por acidente.
      assert.notEqual(alvo.organizacao_militar_sigla, omComSigla.sigla);
    });

    it('quem não tem posto, OM nem nome de guerra volta com os três NULOS, e volta', async () => {
      // A DIREÇÃO DA FALHA IMPORTA: um `JOIN` no lugar do `LEFT JOIN` faria esta pessoa SUMIR
      // da busca, e sumir é indistinguível de "não está cadastrada" para quem procura.
      const res = await busca(`Pessoa Sem Nada ${tag}`, donoTok).expect(200);
      const alvo = res.body.data.results.find((u) => u.id === semNada.id);

      assert.ok(alvo, 'a pessoa sem posto e sem OM continua achável');
      assert.equal(alvo.nome_guerra, null);
      assert.equal(alvo.posto_graduacao, null);
      assert.equal(alvo.organizacao_militar_sigla, null);
    });

    it('ACHA pelo NOME DE GUERRA, que é o que a tela escreve', async () => {
      // O POSITIVO DA MUDANÇA. `MARCA_GUERRA` não aparece no `nome` nem no `username` de
      // ninguém: só o ramo novo do `WHERE` pode devolver esta linha.
      const res = await busca(MARCA_GUERRA, donoTok).expect(200);

      const ids = res.body.data.results.map((u) => u.id);
      assert.ok(ids.includes(dono.id), 'o ramo por nome_guerra está vivo');
      assert.equal(res.body.data.results.length, 1, 'e ele devolve a PESSOA, não um grupo');
    });

    it('e continua não achando ninguém por um termo que não é de ninguém', async () => {
      // O CONTROLE NEGATIVO da busca: sem ele, uma cláusula que devolvesse todas as linhas
      // passaria no caso acima.
      const res = await busca(`Zebrante${randomUUID().slice(0, 8)}`, donoTok).expect(200);
      assert.deepEqual(res.body.data.results, []);
    });

    it('o curinga digitado continua LITERAL também no ramo novo', async () => {
      // `escapeLike` é aplicado ao termo inteiro, antes de qualquer ramo: o `_` casaria
      // qualquer caractere se o escape não alcançasse a cláusula nova.
      const comCuringa = `${MARCA_GUERRA.slice(0, -1)}_`;
      const res = await busca(comCuringa, donoTok).expect(200);

      const ids = res.body.data.results.map((u) => u.id);
      assert.ok(!ids.includes(dono.id), 'o curinga de um caractere não pode ser honrado');
    });
  });

  // ── GET /atlas/:id/sharing ─────────────────────────────────────────────────
  describe('a configuração de compartilhamento', () => {
    it('o bloco do DONO carrega posto abreviado, nome de guerra e a sigla da OM', async () => {
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sharing`)
        .set('Authorization', `Bearer ${donoTok}`)
        .expect(200);

      const bloco = res.body.data.owner;
      assert.equal(bloco.postoGraduacao, '1º Ten');
      assert.equal(bloco.nomeGuerra, MARCA_GUERRA);
      assert.equal(bloco.organizacaoMilitarSigla, omComSigla.sigla);
      assert.equal(bloco.organizacaoMilitar, omComSigla.nome);
      // E os campos antigos, que a tela ainda usa: `nome` é a queda de quem não tem nome de
      // guerra e `username` é o que desempata homônimo.
      assert.equal(bloco.nome, `Joao Batista de Souza ${tag}`);
      assert.equal(bloco.username, dono.username);
    });

    it('cada PARTICIPANTE carrega os mesmos campos, com os mesmos nomes', async () => {
      // A SIMETRIA É O PONTO: é ela que permite ao cliente ter UM compositor de rótulo para o
      // dono e para o participante. Dois shapes seriam dois caminhos, e um deles ficaria para
      // trás — que foi exatamente o que aconteceu com o dono até esta data.
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sharing`)
        .set('Authorization', `Bearer ${donoTok}`)
        .expect(200);

      const linha = res.body.data.shares.find((s) => s.userId === participante.id);
      assert.ok(linha, 'premissa: o participante está na lista');
      assert.equal(linha.postoGraduacao, 'Cap');
      assert.equal(linha.nomeGuerra, 'Andrade');
      assert.equal(linha.organizacaoMilitarSigla, omComSigla.sigla);
      assert.equal(linha.permission, 'write', 'e o nível não se perdeu no caminho');
    });

    it('o participante SEM posto, OM e nome de guerra vem com os três nulos, e vem', async () => {
      // Mesmo argumento do controle da busca: os dois `LEFT JOIN` novos não podem ESCONDER
      // uma linha de share. Uma pessoa que some da lista continua tendo acesso ao atlas, e o
      // gestor perde a única tela onde poderia retirá-lo.
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sharing`)
        .set('Authorization', `Bearer ${donoTok}`)
        .expect(200);

      const linha = res.body.data.shares.find((s) => s.userId === semNada.id);
      assert.ok(linha, 'o LEFT JOIN não pode derrubar quem não tem posto nem OM');
      assert.equal(linha.postoGraduacao, null);
      assert.equal(linha.nomeGuerra, null);
      assert.equal(linha.organizacaoMilitarSigla, null);
      assert.equal(linha.nome, `Pessoa Sem Nada ${tag}`, 'e o nome continua lá para a queda');
    });

    it('o snake_case dos JOINs novos NÃO vaza para o envelope', async () => {
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sharing`)
        .set('Authorization', `Bearer ${donoTok}`)
        .expect(200);

      const linha = res.body.data.shares.find((s) => s.userId === participante.id);
      for (const cru of ['posto_graduacao', 'nome_guerra', 'organizacao_militar']) {
        assert.equal(linha[cru], undefined, `${cru} é nome de coluna, não de campo do envelope`);
      }
      assert.equal(res.body.data.owner_posto_graduacao, undefined);
      assert.equal(res.body.data.owner_nome_guerra, undefined);
    });
  });

  // ── GET /atlas/overview (o MESMO modal, no modo somente-leitura) ───────────
  it('a lista de participantes do modo somente-leitura também traz o nome de guerra', async () => {
    // A cláusula 5.7 dá a todo participante o direito de ver quem mais participa, e essa tela é
    // o mesmo modal sem controles. Sem este campo, quem tem leitura leria o nome civil completo
    // enquanto quem tem gestão lê "1º Ten Zebrante", na mesma janela do mesmo produto.
    const res = await supertest(app)
      .get('/api/v1/atlas/overview')
      .set('Authorization', `Bearer ${donoTok}`)
      .expect(200);

    const cartao = res.body.data.atlases.find((a) => a.id === atlas.id);
    assert.ok(cartao, 'premissa: o atlas do dono está no resumo');
    const linhaDono = cartao.members.find((m) => m.permission === 'owner');
    assert.equal(linhaDono.nome_guerra, MARCA_GUERRA);
    assert.equal(linhaDono.posto_graduacao, '1º Ten');
    // DISCRIMINAÇÃO: quem não tem nome de guerra vem NULO, e não com o nome completo copiado
    // para dentro do campo — a queda é do cliente, e ela precisa saber que não houve valor.
    const linhaSemNada = cartao.members.find((m) => m.id === semNada.id);
    assert.ok(linhaSemNada);
    assert.equal(linhaSemNada.nome_guerra, null);
  });
});
