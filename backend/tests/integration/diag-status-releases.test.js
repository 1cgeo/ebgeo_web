// Path: tests/integration/diag-status-releases.test.js
/**
 * @fileoverview A SAÚDE POR RELEASE, que entra em `GET /diag/status` e é a única consulta do
 * repositório a cruzar as DUAS metades da observabilidade.
 *
 * POR QUE ELA SÓ EXISTE AGORA. `defeitos` sempre soube em qual build um defeito nasceu
 * (`primeira_release`, desde `018_defeitos_e_ocorrencias.sql`), e o número sozinho não
 * respondia nada: uma build usada por dez pessoas tem menos defeitos que uma usada por mil, e
 * sem contagem de SESSÕES as duas são indistinguíveis. `uso_sessoes` é o denominador que
 * faltava.
 *
 * A JANELA DAS ASSERÇÕES FICA NO PASSADO, pela mesma razão de `uso-resumo-blocos.test.js`: a
 * consulta não tem filtro por marca, e os outros arquivos desta família criam sessões de HOJE,
 * algumas com `release` preenchida. Com `agora` injetado 60 dias atrás, a faixa medida é só a
 * que este arquivo semeia. A ROTA é exercida à parte, com o relógio de verdade, e ali a
 * dependência de vizinhos está declarada no próprio caso.
 *
 * CONTROLE NEGATIVO (o que fica vermelho ao reverter cada peça):
 *  - recortar por `s.inicio >= $1` em vez de por SOBREPOSIÇÃO: a sessão longa que atravessa a
 *    janela some, e numa madrugada sem ninguém abrindo aba nova a build no ar sumiria da tela;
 *  - ordenar por CONTAGEM em vez de por último início: a build velha e muito usada empurra a
 *    recém-implantada para fora das três vagas, que é exatamente a que se quer olhar;
 *  - recortar `defeitos_novos` pela mesma janela das sessões: a build recém-implantada passa a
 *    parecer limpa por não ter tido tempo;
 *  - tirar o `release <> ''`: uma instalação sem `EBGEO_RELEASE` ganha uma linha "sem release"
 *    ocupando uma das três vagas;
 *  - tirar o `.catch(() => null)` do controller: o pulso, que é leitura de DISCO e sempre
 *    sobreviveu ao banco fora, passa a morrer junto com o Postgres;
 *  - pendurar a consulta em `diag.service.js`: aquele arquivo perde a propriedade de ser
 *    exercível em node puro (ele não importa `config` nem o banco, e isso é declarado no
 *    `fileoverview` dele).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { randomUUID } from 'crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createAdminUser, createUser, loginUser } from '../helpers/fixtures.js';
import { saudeDasReleases } from '../../src/modules/uso/uso.service.js';

describe('Saúde por release — o bloco `releases` de GET /diag/status', () => {
  let db, app, adminToken, comumToken;

  /** 60 dias atrás (1440 h): o fim da janela principal deste arquivo. Ver o cabeçalho. */
  const AGORA = new Date(Date.now() - 1440 * 3_600_000);
  /**
   * Um instante DENTRO da vida da sessão longa e FORA do tráfego das outras três.
   *
   * Ele existe para que o caso de sobreposição possa medir a sessão longa sozinha: com o
   * `AGORA` principal ela seria a quarta colocada e o `LIMIT 3` a cortaria.
   */
  const AGORA_NO_MEIO = new Date(Date.now() - 1447 * 3_600_000);

  const marca = randomUUID().slice(0, 8);

  const sessoes = [];
  const assinaturas = [];
  const releases = {
    velha: `r-velha-${marca}`,
    meio: `r-meio-${marca}`,
    nova: `r-nova-${marca}`,
    longa: `r-longa-${marca}`,
    fora: `r-fora-${marca}`,
    aoVivo: `r-vivo-${marca}`,
  };

  /**
   * Semeia uma sessão com `inicio` e `ultimo_sinal` em idades escolhidas, e a release dada.
   *
   * A IDADE É EM HORAS FRACIONÁRIAS, E NÃO EM DIAS, e não é preciosismo: a janela é meio-aberta
   * num lado (`inicio < $2`), então uma sessão semeada em `NOW() - 60 dias` cai FORA de uma
   * janela cujo fim é `Date.now() - 60 dias` calculado antes, por alguns milissegundos. Meia
   * hora de folga dentro da janela é o que torna o caso determinístico em vez de dependente do
   * relógio.
   *
   * `fimHoras` SEPARADO DE `inicioHoras` é o que permite a sessão LONGA, e sem ela o recorte
   * por sobreposição não teria como ser distinguido do recorte por início.
   */
  async function semear(release, inicioHoras, { erros = 0, fimHoras = null } = {}) {
    const id = randomUUID();
    sessoes.push(id);
    const fim = fimHoras === null ? inicioHoras - 1 / 60 : fimHoras;
    await db.query(
      `INSERT INTO uso_sessoes (
         sessao_id, dia, user_id, pagina_inicial, release, navegador,
         inicio, ultimo_sinal, eventos, erros
       ) VALUES (
         $1, (NOW() - ($2::numeric * INTERVAL '1 hour'))::date, NULL, 'mapa', $3, 'Chrome',
         NOW() - ($2::numeric * INTERVAL '1 hour'),
         NOW() - ($4::numeric * INTERVAL '1 hour'),
         0, $5
       )`,
      [id, inicioHoras, release, fim, erros]
    );
    return id;
  }

  async function semearDefeito(release, estado) {
    const assinatura = `TypeError | saude | ${randomUUID()}`;
    assinaturas.push(assinatura);
    await db.query(
      `INSERT INTO defeitos (assinatura, mensagem, estado, primeira_release, ultima_release)
       VALUES ($1, 'quebrou', $2, $3, $3)`,
      [assinatura, estado, release]
    );
  }

  before(async () => {
    const env = await setupTestEnv();
    db = env.db;
    app = env.app;

    const admin = await createAdminUser(db, { username: `rel_adm_${randomUUID().slice(0, 6)}` });
    adminToken = await loginUser(app, admin.username, admin.password);
    const comum = await createUser(db, { username: `rel_usr_${randomUUID().slice(0, 6)}` });
    comumToken = await loginUser(app, comum.username, comum.password);

    // Dentro da janela principal (`AGORA` menos dois dias): três releases, com idades distintas.
    await semear(releases.nova, 1452);
    await semear(releases.nova, 1452, { erros: 1 });
    await semear(releases.nova, 1452);
    await semear(releases.meio, 1464);
    await semear(releases.meio, 1464, { erros: 4 });
    await semear(releases.velha, 1476);

    // A SESSÃO LONGA: começou muito antes da janela e ainda respirava dentro dela. Ela é a
    // única que distingue o recorte por SOBREPOSIÇÃO do recorte por início.
    await semear(releases.longa, 1680, { fimHoras: 1445 });

    // FORA da janela, e mais recente que todas: ela prova que o recorte de tempo existe. Sem
    // ela, uma consulta sem `WHERE` passaria neste arquivo.
    await semear(releases.fora, 240);

    await semearDefeito(releases.nova, 'aberto');
    await semearDefeito(releases.nova, 'aberto');
    await semearDefeito(releases.nova, 'regrediu');
    await semearDefeito(releases.meio, 'resolvido');
  });

  after(async () => {
    await db.query('DELETE FROM uso_sessoes WHERE sessao_id = ANY($1::uuid[])', [sessoes]);
    await db.query('DELETE FROM defeitos WHERE assinatura = ANY($1::text[])', [assinaturas]);
    await teardownTestEnv(db);
  });

  it('as releases da janela vêm da mais recente para a mais antiga, com sessões e erros', async () => {
    const linhas = await saudeDasReleases({ desde: '2d', agora: AGORA });
    const minhas = linhas.filter((l) => l.release.endsWith(marca));
    assert.equal(minhas.length, 3, `esperava as três releases da janela, achei ${minhas.length}`);

    assert.deepEqual(
      minhas.map((l) => l.release),
      [releases.nova, releases.meio, releases.velha],
      'a ordem é pelo ÚLTIMO INÍCIO, e não pelo volume nem pelo último sinal'
    );

    assert.equal(minhas[0].sessoes, 3);
    assert.equal(minhas[0].sessoesComErro, 1);
    assert.equal(minhas[1].sessoes, 2);
    assert.equal(minhas[1].sessoesComErro, 1);
    assert.equal(minhas[2].sessoes, 1);
    assert.equal(minhas[2].sessoesComErro, 0);

    // A release mais recente do repositório de teste está FORA da janela: é ela que separa
    // "as três últimas da janela" de "as três últimas da tabela".
    assert.ok(
      !linhas.some((l) => l.release === releases.fora),
      'a janela recorta por tempo, e não devolve o que está fora dela'
    );
  });

  it('a sessão que ATRAVESSA a janela conta, mesmo tendo começado muito antes dela', async () => {
    // O recorte é por SOBREPOSIÇÃO (`ultimo_sinal >= inicio_da_janela AND inicio < fim`), e a
    // pergunta que ele responde é qual build ESTEVE NO AR. Com o recorte por `inicio`, esta
    // sessão sumiria, e numa madrugada em que ninguém abre aba nova a build no ar sumiria da
    // tela junto: a rota do pulso usa uma hora por padrão.
    const linhas = await saudeDasReleases({ desde: '1h', agora: AGORA_NO_MEIO });
    const minhas = linhas.filter((l) => l.release.endsWith(marca));
    assert.deepEqual(minhas.map((l) => l.release), [releases.longa]);
    assert.equal(minhas[0].sessoes, 1);
  });

  it('os defeitos NÃO são recortados pela janela: eles são propriedade da BUILD', async () => {
    const linhas = await saudeDasReleases({ desde: '2d', agora: AGORA });
    const nova = linhas.find((l) => l.release === releases.nova);
    assert.ok(nova);
    // Três defeitos nasceram nela (dois abertos e um que regrediu), e um deles é regressão.
    assert.equal(nova.defeitosNovos, 3);
    assert.equal(nova.regressoes, 1);

    const meio = linhas.find((l) => l.release === releases.meio);
    assert.equal(meio.defeitosNovos, 1);
    assert.equal(meio.regressoes, 0, 'defeito RESOLVIDO não é regressão');

    const velha = linhas.find((l) => l.release === releases.velha);
    assert.equal(velha.defeitosNovos, 0, 'zero é a resposta honesta, e não a ausência da linha');
    assert.equal(velha.regressoes, 0);
  });

  it('a janela CURTA corta a build cujo tráfego não a alcança', async () => {
    // Meio dia de janela a partir de `AGORA`: `nova` entra (o tráfego dela é de 1452 h atrás) e
    // as duas mais velhas ficam de fora. `longa` entra porque a vida dela atravessa TODA janela
    // dentro do intervalo em que ela respirou, que é o ponto do recorte por sobreposição.
    const linhas = await saudeDasReleases({ desde: '12h', agora: AGORA });
    const minhas = linhas.filter((l) => l.release.endsWith(marca));
    assert.deepEqual(minhas.map((l) => l.release), [releases.nova, releases.longa]);
  });

  it('`GET /diag/status` traz o bloco, e continua fechado para quem não administra', async () => {
    await supertest(app).get('/api/v1/diag/status').expect(401);
    await supertest(app)
      .get('/api/v1/diag/status')
      .set('Authorization', `Bearer ${comumToken}`)
      .expect(403);

    // A SEMEADURA ACONTECE AQUI, E NÃO NO `before`, de propósito: a rota usa o relógio de
    // verdade e uma janela de uma hora, então o bloco só tem conteúdo se existir sessão viva
    // agora. Semear no `before` também funcionaria, e semear imediatamente antes da requisição
    // é o que torna esta release a mais recente da tabela no instante da leitura, que é o que a
    // asserção de PRESENÇA precisa (a consulta só devolve três, ordenadas pelo último início).
    //
    // A DEPENDÊNCIA DE VIZINHOS, declarada: numa rodada paralela, `uso-eventos-rota.test.js` e
    // `uso-eventos-persistencia.test.js` também escrevem sessões com `release` no relógio de
    // agora. Elas disputam as outras duas vagas, nunca a primeira, porque esta linha é semeada
    // no instante da leitura.
    await semear(releases.aoVivo, 0.02);

    const r = await supertest(app)
      .get('/api/v1/diag/status')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    assert.ok(Array.isArray(r.body.data.releases), 'o bloco `releases` precisa existir');
    assert.ok(r.body.data.releases.length > 0,
      'sem conteúdo, o laço de forma abaixo roda zero vezes e o caso passa sem verificar nada');
    assert.ok(r.body.data.releases.length <= 3, 'no máximo três vagas');
    assert.ok(
      r.body.data.releases.some((l) => l.release === releases.aoVivo),
      'a release semeada no instante da leitura precisa aparecer'
    );

    for (const linha of r.body.data.releases) {
      assert.equal(typeof linha.release, 'string');
      assert.equal(typeof linha.sessoes, 'number');
      assert.equal(typeof linha.sessoesComErro, 'number');
      assert.equal(typeof linha.defeitosNovos, 'number');
      assert.equal(typeof linha.regressoes, 'number');
    }

    // E o `release` SINGULAR continua ali: eles respondem perguntas diferentes (qual build é
    // ESTE processo, contra como as builds que responderam estão se saindo), e fundir os dois
    // apagaria a segunda.
    assert.ok('release' in r.body.data, 'a build deste processo não pode sumir do payload');
  });

  it('com o banco recusando, o PULSO continua vindo e `releases` é `null`', async () => {
    // `GET /diag/status` é a rota que o administrador abre QUANDO algo está errado, e tudo o que
    // ela lia antes deste lote era ARQUIVO: ela sobrevivia ao Postgres fora. Um `Promise.all`
    // cru com a consulta de release desfazia isso em silêncio.
    //
    // A DERRUBADA É REAL E É A MAIS ESTREITA POSSÍVEL: renomear a coluna `release` de
    // `uso_sessoes` quebra `SAUDE_POR_RELEASE` e mais nada deste módulo (o único outro leitor da
    // coluna é o UPSERT da rota de escrita). A janela é de milissegundos e o `finally` a fecha;
    // numa rodada paralela, o que ela pode atingir é um `POST /uso/eventos` de outro arquivo
    // nesse intervalo, e isso está dito aqui em vez de ser descoberto depois.
    await db.query('ALTER TABLE uso_sessoes RENAME COLUMN "release" TO "release__derrubado"');
    let r;
    try {
      r = await supertest(app)
        .get('/api/v1/diag/status')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    } finally {
      await db.query('ALTER TABLE uso_sessoes RENAME COLUMN "release__derrubado" TO "release"');
    }

    // `null` E NÃO `[]`: `[]` significa "nenhuma build respondeu nesta janela", que é um fato
    // sobre o PRODUTO; `null` significa "não deu para perguntar", que é um fato sobre o
    // SERVIDOR. Colapsar os dois faria a tela anunciar silêncio de tráfego no exato momento em
    // que o banco está fora.
    assert.equal(r.body.data.releases, null, 'o bloco precisa dizer que não deu para ler');

    // E a metade de DISCO chegou inteira, que é a razão de o `catch` existir.
    assert.equal(typeof r.body.data.diretorio, 'string');
    assert.equal(typeof r.body.data.linhas, 'number');
    assert.ok('total' in r.body.data, 'o pulso (contagens por faixa de status) não pode sumir');
    assert.ok('release' in r.body.data, 'nem a build deste processo, que sai do `config`');
  });
});
