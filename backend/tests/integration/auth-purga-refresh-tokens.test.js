// Path: tests/integration/auth-purga-refresh-tokens.test.js
//
// A PROVA DOS DOIS DEFEITOS de `refresh_tokens`, nos DOIS sentidos.
//
// 1. O INDICE. `001_identidade.sql` declara `token_hash ... UNIQUE`, e o UNIQUE cria
//    um btree sobre TODAS as linhas (`refresh_tokens_token_hash_key`). Duas linhas
//    abaixo ela criava `idx_refresh_tokens_hash`, um btree PARCIAL sobre a mesma
//    coluna. A `011_refresh_tokens_indice.sql` derruba o parcial. O caso abaixo le
//    `pg_indexes` e cobra os dois lados: o unico continua, o parcial sumiu. Sem o
//    segundo lado o teste passaria verde com a migracao inteira ausente.
//
// 2. A PURGA. A tabela nunca perdia linha nenhuma. `scripts/auth-purgar-refresh-tokens.js`
//    apaga o que ja morreu, e a parte dificil e o que ele NAO pode apagar: a linha
//    revogada e a prova que a deteccao de reuso de `auth.service.js` le. Cada caso de
//    purga aqui vem em par, um afirmando que a linha certa sai e outro afirmando que a
//    linha viva fica.
//
// AS CONTAGENS SAO ESCOPADAS AO USUARIO DESTE ARQUIVO, sempre. A purga age na tabela
// inteira, os arquivos de teste rodam em paralelo contra o mesmo banco, e uma contagem
// global aqui seria verde ou vermelha por causa de trabalho alheio.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser } from '../helpers/fixtures.js';

/** Semeia uma linha de `refresh_tokens` com idade escolhida. */
async function semear(db, userId, { expiraEmDias, revogadoHaDias }) {
  const { rows } = await db.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, created_at, revoked_at)
     VALUES ($1, $2,
             NOW() + ($3::double precision * INTERVAL '1 day'),
             NOW() - INTERVAL '120 days',
             CASE WHEN $4::double precision IS NULL THEN NULL
                  ELSE NOW() - ($4::double precision * INTERVAL '1 day') END)
     RETURNING id, revoked_at`,
    [userId, randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, ''), expiraEmDias, revogadoHaDias],
  );
  return rows[0];
}

describe('refresh_tokens: indice redundante e purga', () => {
  let db;
  let user;
  let script;

  // As sete linhas semeadas. As quatro primeiras devem SAIR, as tres ultimas FICAR.
  let vencidoNuncaRevogado;
  let vencidoRevogadoHaMuito;
  let vencidoHaExatos40Dias;
  let vencidoRevogadoHa31Dias;
  let revogadoAgora;
  let vivoNuncaRevogado;
  let vencidoOntemMasRevogadoOntem;

  before(async () => {
    const env = await setupTestEnv();
    db = env.db;
    user = await createUser(db);

    // O roteiro importa `src/database/index.js`, que exige DATABASE_URL e JWT_SECRET
    // no topo do modulo. `setupTestEnv` poe as duas, entao o import so pode vir depois.
    script = await import('../../scripts/auth-purgar-refresh-tokens.js');

    vencidoNuncaRevogado = await semear(db, user.id, { expiraEmDias: -90, revogadoHaDias: null });
    vencidoRevogadoHaMuito = await semear(db, user.id, { expiraEmDias: -90, revogadoHaDias: 95 });
    vencidoHaExatos40Dias = await semear(db, user.id, { expiraEmDias: -40, revogadoHaDias: null });
    vencidoRevogadoHa31Dias = await semear(db, user.id, { expiraEmDias: -60, revogadoHaDias: 31 });

    // OS TRES SOBREVIVENTES, cada um por um motivo diferente.
    // (a) revogado ha 5 minutos: e a prova viva da deteccao de reuso.
    revogadoAgora = await semear(db, user.id, { expiraEmDias: 7, revogadoHaDias: 5 / 1440 });
    // (b) sessao normal em curso.
    vivoNuncaRevogado = await semear(db, user.id, { expiraEmDias: 7, revogadoHaDias: null });
    // (c) morto, mas morto ha POUCO: dentro da janela, um replay dele ainda dispara o alarme.
    vencidoOntemMasRevogadoOntem = await semear(db, user.id, { expiraEmDias: -1, revogadoHaDias: 1 });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  /** Ids das linhas deste usuario que ainda existem. */
  async function idsVivos() {
    const { rows } = await db.query(
      'SELECT id FROM refresh_tokens WHERE user_id = $1 ORDER BY id',
      [user.id],
    );
    return rows.map((r) => r.id).sort();
  }

  it('a 011 derrubou o indice parcial E o indice unico do UNIQUE continua de pe', async () => {
    const { rows } = await db.query(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'refresh_tokens' ORDER BY indexname`,
    );
    const nomes = rows.map((r) => r.indexname);

    // O lado que PROVA a migracao: o parcial saiu.
    assert.equal(
      nomes.includes('idx_refresh_tokens_hash'),
      false,
      `idx_refresh_tokens_hash ainda existe; a 011 nao rodou. Indices: ${nomes.join(', ')}`,
    );
    // O lado que prova que a queda NAO custou busca: o unico, que ja servia tudo, ficou.
    assert.equal(
      nomes.includes('refresh_tokens_token_hash_key'),
      true,
      `o btree implicito do UNIQUE sumiu; a busca por token_hash ficou sem indice. Indices: ${nomes.join(', ')}`,
    );
  });

  // COM POUCAS LINHAS O POSTGRES PREFERE Seq Scan, e um EXPLAIN nessa condicao nao diz
  // nada sobre indice: ele diz que a tabela cabe numa varredura. Por isso este caso
  // semeia ate o planejador virar, roda o EXPLAIN, e leva as sementes embora. O numero
  // grande da bancada (300.000 linhas, EXPLAIN ANALYZE das quatro consultas antes e
  // depois) esta no cabecalho de `011_refresh_tokens_indice.sql`.
  it('o planejador continua usando indice para a busca por token_hash', async () => {
    const { rows: donos } = await db.query(
      `INSERT INTO users (username, password_hash, nome, role)
       VALUES ($1, 'x', 'plano', 'user') RETURNING id`,
      [`plano_${randomUUID().slice(0, 8)}`],
    );
    const donoId = donos[0].id;
    try {
      await db.query(
        `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
         SELECT $1, encode(sha256(($2 || i::text)::bytea), 'hex'), NOW() + INTERVAL '7 days'
           FROM generate_series(1, 5000) i`,
        [donoId, randomUUID()],
      );
      await db.query('ANALYZE refresh_tokens');

      const { rows } = await db.query(
        `EXPLAIN SELECT id, user_id, expires_at FROM refresh_tokens
          WHERE token_hash = $1 AND revoked_at IS NULL`,
        ['nao-existe'],
      );
      const plano = rows.map((r) => r['QUERY PLAN']).join('\n');
      assert.match(plano, /Index Scan using refresh_tokens_token_hash_key/, plano);
    } finally {
      // ON DELETE CASCADE leva os 5000 junto, e a tabela volta ao tamanho que os
      // outros casos deste arquivo contam.
      await db.query('DELETE FROM users WHERE id = $1', [donoId]);
    }
  });

  it('--dias abaixo de uma validade de refresh e RECUSADO', () => {
    const r = script.lerArgumentos(['--dias=1', '--apply']);
    assert.match(r.erro ?? '', /--dias precisa ser inteiro >= 7/);
  });

  it('sem bandeira nenhuma a janela e 30 dias e o modo e dry-run', () => {
    const r = script.lerArgumentos([]);
    assert.equal(r.erro, undefined);
    assert.equal(r.dias, 30);
    assert.equal(r.aplicar, false);
  });

  it('--apply liga a purga de verdade', () => {
    const r = script.lerArgumentos(['--apply']);
    assert.equal(r.erro, undefined);
    assert.equal(r.aplicar, true);
  });

  it('dry-run conta as linhas mortas E NAO APAGA NENHUMA', async () => {
    const antes = await idsVivos();
    assert.equal(antes.length, 7, 'as sete sementes precisam existir antes do dry-run');

    const simuladas = await script.simular(30);
    assert.ok(
      simuladas >= 4,
      `o dry-run precisava contar ao menos as 4 linhas mortas deste usuario, contou ${simuladas}`,
    );

    const depois = await idsVivos();
    assert.deepEqual(depois, antes, 'o dry-run apagou linha; ele tinha de desfazer a transacao');
  });

  it('--apply apaga as quatro linhas mortas', async () => {
    await script.purgar(30, 1000);

    const restaram = await idsVivos();
    const esperado = [revogadoAgora.id, vivoNuncaRevogado.id, vencidoOntemMasRevogadoOntem.id].sort();
    assert.deepEqual(
      restaram,
      esperado,
      'a purga precisava tirar exatamente as quatro linhas mortas ha mais de 30 dias',
    );

    // A checagem so vale se REPROVA o estado anterior: as quatro sumiram de fato.
    const mortas = [
      vencidoNuncaRevogado.id,
      vencidoRevogadoHaMuito.id,
      vencidoHaExatos40Dias.id,
      vencidoRevogadoHa31Dias.id,
    ];
    const { rows } = await db.query('SELECT id FROM refresh_tokens WHERE id = ANY($1::uuid[])', [mortas]);
    assert.deepEqual(rows, [], 'linha morta sobreviveu a purga');
  });

  it('a purga NAO desliga o alarme de roubo: o token revogado ha 5 minutos sobrevive intacto', async () => {
    const { rows } = await db.query(
      'SELECT id, revoked_at, expires_at FROM refresh_tokens WHERE id = $1',
      [revogadoAgora.id],
    );
    assert.equal(rows.length, 1, 'a purga comeu a prova que a deteccao de reuso le');

    // E o carimbo continua o mesmo. `auth.service.js` decide duplicata contra reuso pela
    // IDADE de `revoked_at`: mover o carimbo seria tao ruim quanto apagar a linha.
    assert.equal(
      new Date(rows[0].revoked_at).getTime(),
      new Date(revogadoAgora.revoked_at).getTime(),
      'revoked_at mudou; a idade que decide duplicata contra reuso foi adulterada',
    );
  });

  it('rodar de novo nao apaga mais nada: a purga e idempotente', async () => {
    const antes = await idsVivos();
    await script.purgar(30, 1000);
    const depois = await idsVivos();
    assert.deepEqual(depois, antes, 'a segunda passada comeu linha viva');
  });
});
