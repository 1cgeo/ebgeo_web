// Regressão de PERFORMANCE: o predicado da busca do gazetteer era opaco ao
// planner, então o índice GIN trgm ficava ocioso e toda busca virava Seq Scan.
//
// `WHERE similarity(ng.f_unaccent(n.nome), q.term) > 0.25` é uma CHAMADA DE
// FUNÇÃO. O pg_trgm só alcança o índice GIN pelo OPERADOR de similaridade; uma
// chamada é opaca, e o Postgres varre `ng.nomes_geograficos` inteira avaliando
// `f_unaccent()` e `similarity()` linha a linha, e depois `ST_Distance(::geography)`
// sobre cada candidato. O índice que resolve isso existe desde a migração 004
// (`idx_ng_nome_unaccent_trgm`) e nunca foi usado — a existência dele é a
// evidência de que alguém já esperava que fosse.
//
// A rota é ANÔNIMA de propósito (é a busca do caminho sem login), então o custo
// por requisição é o que decide se ela é um vetor de DoS.
//
// COMO ESTE TESTE PROVA. Não mede tempo — medir tempo em suíte é ruído. Ele
// afirma a propriedade que interessa: **o predicado é INDEXÁVEL**. Com
// `enable_seqscan = off`, um predicado indexável faz o planner escolher o índice;
// um predicado opaco continua no Seq Scan (o `off` é uma penalidade de custo, não
// uma proibição), porque não existe caminho de índice para ele.
//
// CONTROLE NEGATIVO: trocar o operador de volta pela chamada de função faz o
// primeiro caso falhar — o plano volta a Seq Scan mesmo com seqscan penalizado.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import * as Q from '../../src/modules/nomes/nomes.queries.js';
import * as service from '../../src/modules/nomes/nomes.service.js';

const INDICE = 'idx_ng_nome_unaccent_trgm';

async function seed(db, nome, lon = -51.2, lat = -30.0) {
    await db.query(
        `INSERT INTO ng.nomes_geograficos (nome, tipo, municipio, estado, geom)
         VALUES ($1, 'cidade', 'M', 'RS', ST_SetSRID(ST_MakePoint($2, $3), 4674))`,
        [nome, lon, lat],
    );
}

describe('busca do gazetteer usa o índice GIN trgm (repro de performance)', () => {
    let db;

    before(async () => {
        const env = await setupTestEnv();
        db = env.db;
        await seed(db, 'Porto Alegre 1');
        // VOLUME é parte do teste, não enfeite. Com poucas centenas de linhas o
        // planner escolhe o índice de access_level e aplica o operador como
        // Filter — a escolha é legítima nessa escala e o teste mediria ruído.
        // Com volume de gazeteiro o índice trgm ganha, que é o cenário real.
        await db.query(
            `INSERT INTO ng.nomes_geograficos (nome, tipo, municipio, estado, geom)
             SELECT 'Localidade ' || g, 'cidade', 'M', 'RS',
                    ST_SetSRID(ST_MakePoint(-51.2 + (g%100)*0.01, -30.0 + (g%100)*0.01), 4674)
             FROM generate_series(1, 20000) g`,
        );
        await db.query('ANALYZE ng.nomes_geograficos');
    });

    after(async () => {
        await db.query("DELETE FROM ng.nomes_geograficos WHERE municipio = 'M'");
        await teardownTestEnv(db);
    });

    it('o plano da busca REAL alcança o índice trgm, como Index Cond', async () => {
        await db.query('BEGIN');
        try {
            await db.query('SET LOCAL pg_trgm.similarity_threshold = 0.25');
            const { rows } = await db.query(
                `EXPLAIN (FORMAT TEXT) ${Q.BUSCA}`,
                ['porto alegre', -30.0, -51.2, null],
            );
            const texto = rows.map((r) => r['QUERY PLAN']).join('\n');
            assert.ok(texto.includes(INDICE), `o plano deveria alcançar ${INDICE}.\n\n${texto}`);
            // Index Cond, não Filter: com o termo vindo da CTE materializada o
            // operador aparecia como Join Filter e o índice seguia ocioso. É essa
            // linha que separa "usa o índice" de "tem o índice no plano".
            assert.match(texto, /Index Cond:.*%/, 'o operador precisa ser condição de índice, não filtro');
        } finally {
            await db.query('ROLLBACK');
        }
    });

    it('o limiar de 0.25 é preservado: casa o que o default 0.3 descartaria', async () => {
        // "o alegr" vs "Porto Alegre 1" cai em 0.2778, exatamente na faixa em que o
        // default da extensão (0.3) e o limiar histórico (0.25) discordam. Se o
        // service esquecesse o SET LOCAL, este caso voltaria vazio — é o que separa
        // "trocou o operador" de "trocou o operador sem mudar o resultado".
        const TERMO = 'o alegr';
        const { rows: sim } = await db.query(
            `SELECT similarity(ng.f_unaccent('Porto Alegre 1'), ng.f_unaccent($1)) AS s`,
            [TERMO],
        );
        const s = Number(sim[0].s);
        assert.ok(s > 0.25 && s < 0.3, `o termo precisa cair entre 0.25 e 0.3, deu ${s}`);

        const achados = await service.busca({ q: TERMO, lat: -30.0, lon: -51.2, zoom: null, userId: null });
        assert.ok(achados.length > 0, 'com o limiar em 0.25 precisa achar; com 0.3 voltaria vazia');
    });

    it('a busca continua devolvendo o resultado óbvio', async () => {
        const achados = await service.busca({ q: 'Porto Alegre', lat: -30.0, lon: -51.2, zoom: null, userId: null });
        assert.ok(achados.length > 0);
        assert.ok(achados.every((r) => typeof r.nome === 'string'));
    });
});
