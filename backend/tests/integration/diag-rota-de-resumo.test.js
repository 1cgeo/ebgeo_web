// Path: tests/integration/diag-rota-de-resumo.test.js
// `GET /api/v1/diag/resumo`: o relatório de UMA TELA na porta HTTP, que é como ele chega à
// aba de Administração (decisão do dono em 2026-09-02: o resumo tem de estar na interface, e
// não há digest diário por e-mail).
//
// POR QUE O `import` É DINÂMICO AQUI, como em `diag-log-em-arquivo.test.js`: `config.js` é um
// singleton congelado na avaliação do módulo e `src/app.js` o puxa transitivamente, então
// `LOG_DIR` precisa estar no ambiente ANTES daquela avaliação para que a rota leia o
// diretório SEMEADO por este arquivo em vez do `./data/logs` da máquina. Um `import` estático
// de `helpers/setup.js` roda antes de qualquer linha do corpo. O runner dá um processo por
// arquivo de teste, então a variável não vaza para os vizinhos.
//
// O QUE SÓ ESTE ARQUIVO COBRE. `diag-resumo.test.js` prende a composição pura,
// `diag-resumo-completo.test.js` prende o gathering com leitores injetados, e
// `diag-cli-resumo.test.js` prende o comando. O que nenhum deles alcança é a PORTA: o par de
// gates, a validação de janela na borda, a fiação até `config.log.dir` e a promessa que dá
// razão à rota existir, que é responder 200 com a metade de ARQUIVO quando o Postgres está
// fora. Uma rota de diagnóstico que morre junto com o banco falta exatamente na hora em que
// alguém a abre.
//
// CONTROLE NEGATIVO, conferido revertendo cada peça, com os casos vermelhos ANOTADOS:
//  - tirar `requireAdmin` da rota: UM vermelho, "usuário comum leva 403", que passa a devolver
//    200; o relatório do servidor inteiro viraria leitura de qualquer conta;
//  - tirar `auth` (e com ele o `requireAdmin`, que sem principal não tem o que gatear): DOIS
//    vermelhos, o do anônimo e o do usuário comum;
//  - trocar `janela('7d')` por um `Joi.string()` nu no schema (é o que remove de uma vez a
//    gramática e o teto): DOIS vermelhos, `?desde=24hs` e `?desde=30d`, e a requisição volta a
//    poder abrir trinta arquivos de log dentro do ciclo HTTP;
//  - tirar o `try/catch` de `montarResumoCompleto`: UM vermelho, o do banco recusando, que
//    passa de 200 para 500 levando junto o pulso, a latência e a saúde, que são de DISCO;
//  - trocar `config.log.dir` por um caminho fixo no controller: o caso da procedência é quem
//    pega, porque ele compara `janela.dir` com o diretório temporário deste arquivo;
//  - trocar `DEFEITOS_DO_RESUMO` por um literal diferente no `limite` do schema: UM vermelho,
//    o do padrão efetivo, que compara a borda com a constante em vez de comparar dois números
//    escritos à mão (era exatamente isso que o JSDoc prometia e o código não fazia).
//
// O PAR COMPLETO ESTÁ AQUI: quem NÃO pode não vê (401/403) e quem PODE vê (200 com o
// conteúdo semeado nas duas fontes). Só o negativo passaria idêntico se a rota não existisse.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import supertest from 'supertest';
import { randomUUID } from 'crypto';

const DIR_DE_LOG = fs.mkdtempSync(path.join(os.tmpdir(), 'ebgeo-diag-resumo-'));
process.env.LOG_DIR = DIR_DE_LOG;

const { setupTestEnv, teardownTestEnv } = await import('../helpers/setup.js');
const { createUser, createAdminUser, loginUser } = await import('../helpers/fixtures.js');
const { MARCADOR_AMOSTRA } = await import('../../src/utils/amostra-de-saude.js');
const { MARCADOR_QUERY_LENTA } = await import('../../src/utils/query-lenta.js');
const { DEFEITOS_DO_RESUMO } = await import('../../src/modules/diag/resumo.service.js');
const { resumoQuerySchema } = await import('../../src/modules/diag/diag.schemas.js');

const ROTA = '/api/v1/diag/resumo';
const HORA = 3_600_000;
const MARCA = randomUUID().slice(0, 8);
const PAGINA = `resumo-http-${MARCA}`;

/**
 * Uma contagem alta o bastante para o defeito semeado caber nos CINCO maiores.
 *
 * A tabela é compartilhada pela suíte e o bloco 1 corta em `TOPO_DE_DEFEITOS`, então uma
 * contagem modesta tornaria o caso ESTATÍSTICO: ele passaria ou não conforme o que os
 * vizinhos tivessem semeado. Um número que ninguém mais usa torna a asserção determinística.
 */
const OCORRENCIAS_DO_TOPO = 9_000_000;

/** O dia local em AAAA-MM-DD, o mesmo formato que `log-diario.js` escreve. */
function diaLocal(data) {
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const d = String(data.getDate()).padStart(2, '0');
  return `${data.getFullYear()}-${mes}-${d}`;
}

/**
 * O caminho do `.jsonl` semeado, resolvido UMA VEZ na carga do módulo.
 *
 * Recalculá-lo com `new Date()` dentro de cada caso é a armadilha: numa rodada que cruze a
 * meia-noite o `before` escreve o arquivo de ontem e o caso procura o de hoje, que não existe.
 * O sintoma seria um `ENOENT` num arquivo de teste sem relação com o assunto, uma vez a cada
 * muitas rodadas, no horário em que ninguém está olhando. A LEITURA do log não sofre disso (a
 * janela do resumo cobre os dois dias); quem sofre é a conferência que ESTE arquivo faz do
 * próprio arquivo que semeou.
 */
const ARQUIVO_DE_LOG = path.join(DIR_DE_LOG, `ebgeo-${diaLocal(new Date())}.jsonl`);

describe('GET /diag/resumo, o relatório de uma tela, das duas fontes', () => {
  let app, db, comum, comumToken, admin, adminToken;
  const agora = Date.now();
  const naJanela = agora - HORA;
  const naAnterior = agora - 3 * HORA;

  const pedir = (query = '', token = adminToken) => supertest(app)
    .get(`${ROTA}${query}`)
    .set('Authorization', `Bearer ${token}`);

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    comum = await createUser(db, { username: `res_usr_${randomUUID().slice(0, 6)}` });
    admin = await createAdminUser(db, { username: `res_adm_${randomUUID().slice(0, 6)}` });
    comumToken = await loginUser(app, comum.username, comum.password);
    adminToken = await loginUser(app, admin.username, admin.password);

    // ── a fonte ARQUIVO: DUAS janelas de 2h, para o delta ter base ──
    const linhas = [];
    for (let i = 0; i < 20; i += 1) {
      linhas.push({ time: naJanela, method: 'POST', url: `/atlas/${randomUUID()}/sync`, duration: 300, statusCode: 200 });
      linhas.push({ time: naAnterior, method: 'POST', url: `/atlas/${randomUUID()}/sync`, duration: 30, statusCode: 200 });
    }
    // Só na janela atual: precisa sair com base `null`, e não com um delta contra zero.
    linhas.push({ time: naJanela, method: 'GET', url: '/api/config', duration: 12, statusCode: 200 });
    linhas.push({ time: naJanela, method: 'GET', url: '/api/v1/atlas', duration: 5, statusCode: 500, err: { type: 'Error', message: MARCA } });
    linhas.push({ time: naJanela, amostra: MARCADOR_AMOSTRA });
    linhas.push({ time: naJanela + 300_000, amostra: MARCADOR_AMOSTRA });
    // Contagens DIFERENTES nas duas janelas: iguais passariam verdes com o corte quebrado.
    linhas.push({ time: naJanela, level: 40, msg: MARCADOR_QUERY_LENTA, duration: 900 });
    linhas.push({ time: naJanela, level: 40, msg: MARCADOR_QUERY_LENTA, duration: 800 });
    linhas.push({ time: naAnterior, level: 40, msg: MARCADOR_QUERY_LENTA, duration: 600 });
    fs.writeFileSync(
      ARQUIVO_DE_LOG,
      `${linhas.map((l) => JSON.stringify(l)).join('\n')}\n`
    );

    // ── a fonte BANCO ──
    await db.query(
      `INSERT INTO defeitos (assinatura, mensagem, pagina, estado, origem, ocorrencias,
                             primeira_em, ultima_em)
       VALUES ($1, 'novo do servidor', $2, 'aberto',   'servidor',     $5, NOW(), NOW()),
              ($3, 'queda vista',      $2, 'aberto',   'indisponivel', 7,  NOW(), NOW()),
              ($4, 'voltou a doer',    $2, 'regrediu', 'store',        3,
               NOW() - INTERVAL '40 days', NOW())`,
      [`A | ${MARCA}`, PAGINA, `B | ${MARCA}`, `C | ${MARCA}`, OCORRENCIAS_DO_TOPO]
    );
  });

  after(async () => {
    await db.query('DELETE FROM defeitos WHERE pagina = $1', [PAGINA]);
    fs.rmSync(DIR_DE_LOG, { recursive: true, force: true });
    await teardownTestEnv(db);
  });

  describe('o gate: os dois lados do par', () => {
    it('anônimo leva 401', async () => {
      await supertest(app).get(ROTA).expect(401);
    });

    it('usuário comum leva 403: ler o diagnóstico do servidor é administração do sistema', async () => {
      await pedir('', comumToken).expect(403);
    });

    it('administrador leva 200', async () => {
      await pedir('?desde=2h').expect(200);
    });
  });

  describe('a janela: mesma gramática e mesmo teto das rotas irmãs', () => {
    it('forma não reconhecida é 422, e não um default calado', async () => {
      // Um comando que aceita `24hs` calado e responde sobre a última hora responde a OUTRA
      // pergunta sem avisar, e quem lê a saída acha que viu as 24 horas.
      const r = await pedir('?desde=24hs').expect(422);
      assert.match(JSON.stringify(r.body), /Janela inválida/);
    });

    it('além de 7d é 422, com a saída nomeada', async () => {
      const r = await pedir('?desde=30d').expect(422);
      assert.match(JSON.stringify(r.body), /npm run diag/);
    });

    it('sem `desde` o padrão é 7d, e não as 24h do comando', async () => {
      // A aba é lida por ROTINA e o que ela precisa mostrar é a semana; o terminal responde a
      // uma pergunta de incidente. A divergência é escolha, e está escrita em `diag.schemas.js`.
      const { body } = await pedir('').expect(200);
      assert.equal(body.data.periodo.desde, '7d');
      assert.equal(body.data.periodo.desdeMs, 7 * 86_400_000);
      assert.equal(body.data.janela.desde, '7d');
    });
  });

  describe('com as DUAS fontes vivas', () => {
    it('os cinco blocos saem disponíveis, cada um com a premissa', async () => {
      const { body } = await pedir('?desde=2h').expect(200);
      const d = body.data;
      for (const bloco of ['defeitos', 'latencia', 'saude', 'indisponivel', 'status']) {
        assert.equal(d[bloco].disponivel, true, `${bloco} tinha de estar disponível`);
        assert.ok(d[bloco].premissa, `${bloco} precisa declarar a premissa, mesmo na boa notícia`);
      }
      assert.equal(d.latencia.premissa.fonte, 'arquivo');
      assert.equal(d.defeitos.premissa.fonte, 'banco');
    });

    it('a procedência da leitura viaja, e ela aponta para o diretório configurado', async () => {
      // Sem ela, uma lista vazia vinda de um diretório errado é indistinguível de uma janela
      // limpa, e quem lê esta resposta é justamente quem não tem terminal para desconfiar.
      const { body } = await pedir('?desde=2h').expect(200);
      const j = body.data.janela;
      assert.equal(j.dir, path.resolve(DIR_DE_LOG));
      assert.equal(j.diretorioAusente, false);
      assert.equal(j.truncado, false);
      assert.equal(j.arquivos, 1);
      assert.ok(j.linhas > 0, 'não-vacuidade: alguma linha precisa ter sido lida');
      assert.equal(j.banco, true);
      assert.equal(typeof body.data.gerado_em, 'number');
    });

    it('a premissa conta as linhas da janela ATUAL, e não as do DOBRO que foi lido', async () => {
      const { body } = await pedir('?desde=2h').expect(200);
      const doArquivo = fs.readFileSync(
        ARQUIVO_DE_LOG, 'utf8'
      ).trim().split('\n').length;
      const naJanelaAtual = body.data.latencia.premissa.linhas;
      assert.ok(naJanelaAtual > 0);
      assert.ok(
        naJanelaAtual < doArquivo,
        `a premissa (${naJanelaAtual}) tem de ser MENOR que o arquivo inteiro (${doArquivo}), que é o dobro da janela`
      );
      assert.equal(body.data.status.premissa.linhas, naJanelaAtual, 'os três blocos de arquivo compartilham a premissa');
      assert.equal(body.data.janela.linhas, naJanelaAtual);
    });

    it('o p95 compara com a janela ANTERIOR, e a rota sem base sai com delta null', async () => {
      const { body } = await pedir('?desde=2h').expect(200);
      const sync = body.data.latencia.rotas.find((x) => x.rota === 'POST /atlas/:id/sync');
      assert.ok(sync, 'a rota mais chamada precisa aparecer');
      assert.equal(sync.n, 20, 'só as 20 da janela atual');
      assert.equal(sync.p95, 300);
      assert.equal(sync.p95Anterior, 30, 'a base vem da janela anterior, do mesmo tamanho');
      assert.equal(sync.delta, 270);

      const config = body.data.latencia.rotas.find((x) => x.rota === 'GET /api/config');
      assert.equal(config.p95Anterior, null, 'rota nova não tem base, e base ausente NÃO é zero');
      assert.equal(config.delta, null);

      assert.deepEqual(body.data.latencia.queriesLentas, { janela: 2, anterior: 1 });
      const ja = body.data.latencia.premissa.janelaAnterior;
      assert.equal(ja.fim - ja.inicio, 2 * HORA);
    });

    it('os defeitos semeados aparecem: novo, regressão, recorte por origem e a queda vista', async () => {
      const { body } = await pedir('?desde=2h').expect(200);
      const d = body.data;
      // A tabela é compartilhada, então o que é asserível é que as linhas SEMEADAS aparecem,
      // com o recorte certo, e não uma contagem absoluta.
      assert.ok(d.defeitos.novos >= 2, 'os dois nascidos AGORA contam como novos da janela');
      assert.ok(d.defeitos.regressoes >= 1, '`regrediu` com ocorrência nova é regressão da janela');
      assert.ok(d.defeitos.porOrigem.servidor >= 1);
      assert.ok(d.defeitos.porOrigem.cliente >= 2, 'store e indisponivel são do navegador');
      assert.ok(
        d.defeitos.topo.some((t) => t.ocorrencias === OCORRENCIAS_DO_TOPO),
        'o defeito de maior contagem tem de estar entre os cinco maiores'
      );
      assert.ok(d.indisponivel.defeitos >= 1, 'a origem `indisponivel` vira o bloco 4');
      assert.ok(d.indisponivel.ocorrencias >= 7, 'ocorrências, e não assinaturas');
    });

    it('SEM `?limite`, o efetivo é a constante do comando, e o teto é ela também', async () => {
      // O JSDoc do schema prometia `DEFEITOS_DO_RESUMO` e o arquivo tinha DOIS literais 200: a
      // promessa era prosa, e prosa não tem guarda. O que se compara aqui é o valor EFETIVO da
      // borda contra a constante, e não dois números escritos à mão.
      const { value, error } = resumoQuerySchema.validate({});
      assert.equal(error, undefined);
      assert.equal(value.limite, DEFEITOS_DO_RESUMO, 'o padrão da borda É a constante');

      // E o TETO é a mesma constante, provado pelos dois lados na porta de verdade: o valor
      // exato passa, o seguinte é 422. Só o 422 passaria idêntico com o teto em qualquer
      // número menor, então o par é obrigatório.
      await pedir(`?desde=2h&limite=${DEFEITOS_DO_RESUMO}`).expect(200);
      await pedir(`?desde=2h&limite=${DEFEITOS_DO_RESUMO + 1}`).expect(422);

      // A resposta sem `?limite` responde sobre a MESMA lista que o padrão pede: com menos
      // defeitos na janela que o teto, `vistos` é o total e nada saiu parcial.
      const { body } = await pedir('?desde=2h').expect(200);
      assert.ok(body.data.defeitos.premissa.vistos <= DEFEITOS_DO_RESUMO);
      assert.equal(
        body.data.defeitos.premissa.parcial,
        body.data.defeitos.premissa.total > body.data.defeitos.premissa.vistos
      );
    });

    it('o `limite` chega à consulta e a premissa declara a lista PARCIAL', async () => {
      // `parcial` é o campo que salva o "topo 5" de mentir: a consulta ordena por `ultima_em`
      // e corta por `LIMIT`, então os cinco maiores são os cinco maiores DENTRE OS QUE VIERAM.
      const { body } = await pedir('?desde=2h&limite=1').expect(200);
      assert.equal(body.data.defeitos.premissa.vistos, 1);
      assert.equal(body.data.defeitos.premissa.parcial, true);
      assert.ok(body.data.defeitos.premissa.total >= 3, 'o total da janela ignora o corte');
    });
  });

  describe('com o BANCO RECUSANDO, a metade de ARQUIVO continua vindo', () => {
    it('responde 200, com os dois blocos de banco cegos e os três de arquivo inteiros', async () => {
      // É A RAZÃO DE A ROTA EXISTIR EM VEZ DE A TELA CHAMAR DUAS. O administrador abre o
      // diagnóstico QUANDO algo está errado, e "algo errado" com frequência é o Postgres: um
      // relatório que morresse inteiro nesse caso faltaria exatamente na hora marcada.
      //
      // A DERRUBADA É REAL E É A MAIS ESTREITA QUE ACHAMOS: `resolvido_no_commit` é lido por
      // `LIST_DEFEITOS` e por `SELECT_DEFEITO_POR_ID`, e escrito só pelo `PATCH` do ciclo de
      // vida. O UPSERT da rota ANÔNIMA (`POST /diag/erro-cliente`), que é a escrita de alta
      // frequência desta tabela, não a toca. A janela é de milissegundos e o `finally` a
      // fecha; numa rodada paralela o que ela pode atingir é um `GET /diag/defeitos` de outro
      // arquivo nesse intervalo, e isso fica dito aqui em vez de ser descoberto depois.
      await db.query('ALTER TABLE defeitos RENAME COLUMN resolvido_no_commit TO resolvido_no_commit__derrubado');
      let r;
      try {
        r = await pedir('?desde=2h').expect(200);
      } finally {
        await db.query('ALTER TABLE defeitos RENAME COLUMN resolvido_no_commit__derrubado TO resolvido_no_commit');
      }

      const d = r.body.data;
      for (const bloco of ['defeitos', 'indisponivel']) {
        assert.equal(d[bloco].disponivel, false, `${bloco} tinha de se declarar sem fonte`);
        // A MENSAGEM DO DRIVER VIAJA: "o banco não respondeu" não distingue Postgres fora de
        // `DATABASE_URL` ausente, e as duas pedem coisas opostas de quem lê.
        assert.match(d[bloco].motivo, /o banco não respondeu/);
        assert.equal(d[bloco].premissa, null);
        // A ASSERÇÃO QUE IMPORTA: nenhum zero ao lado da indisponibilidade. Um zero aqui se
        // leria como "nenhum defeito", que é o oposto de "não sei".
        assert.equal(d[bloco].novos, undefined);
        assert.equal(d[bloco].topo, undefined);
        assert.equal(d[bloco].defeitos, undefined);
      }

      // E a metade de DISCO chegou INTEIRA, que é a razão de a rota tolerar em vez de morrer.
      assert.equal(d.latencia.disponivel, true);
      assert.equal(d.saude.disponivel, true);
      assert.equal(d.status.disponivel, true);
      assert.ok(d.latencia.rotas.length > 0, 'não-vacuidade: o bloco vivo precisa ter conteúdo');
      assert.equal(d.janela.banco, false, '`banco` é a mesma afirmação, num nome só');
    });
  });
});
