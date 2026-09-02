// Path: tests/integration/uso-eventos-persistencia.test.js
/**
 * @fileoverview O QUE ACONTECE COM A LINHA quando o mesmo cliente manda o segundo lote.
 *
 * A borda já está coberta em `uso-eventos-rota.test.js`. O que este arquivo prende é a metade
 * que nenhum 204 revela: as regras de conflito dos dois UPSERT, que NÃO são a mesma regra
 * (soma, `GREATEST`, primeiro-não-nulo e último-não-nulo convivem no mesmo `ON CONFLICT`), e a
 * derivação do `dia`.
 *
 * CONTROLE NEGATIVO (o que fica vermelho ao reverter cada peça):
 *  - trocar a soma de `contagem` por `EXCLUDED.contagem`: o segundo lote passa a SUBSTITUIR a
 *    contagem do primeiro, e o total do dia vira "o último lote", com cara de número certo;
 *  - trocar o `GREATEST` de `erros` por soma: o mesmo erro passa a ser contado uma vez por
 *    descarga, e a taxa de "sessões com erro" cresce com a DURAÇÃO da sessão;
 *  - trocar o `GREATEST` de `ultimo_sinal` por `EXCLUDED`: um lote atrasado empurra a sessão
 *    para trás e encurta a duração;
 *  - trocar os quatro `COALESCE` de vitais por uma regra só: um dos dois pares congela no
 *    instante da carga (INP e CLS) ou passa a medir a última descarga (LCP);
 *  - tirar o `GROUP BY` do UPSERT de contagens: um lote com o mesmo par (evento, qualificador)
 *    duas vezes derruba a rota com `21000`, que é um 500 no caminho que existe para medir;
 *  - tirar a saturação (`LEAST(... , 2147483647)`): o contador estoura com `22003`, alcançável
 *    por chamador anônimo em minutos;
 *  - tirar o PISO de `instantesDoLote`: o lote de 400 dias atrás escreve linha permanente em
 *    duas tabelas que ninguém poda;
 *  - tirar o `TETO_DE_VITAL_MS`: um vital acima de `2^31` estoura a coluna `integer` com
 *    `22003` dentro da transação, e o LOTE INTEIRO (todas as contagens daquele intervalo) some
 *    por causa de um único número.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { randomUUID } from 'crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, loginUser } from '../helpers/fixtures.js';

describe('Uso do produto — as regras de conflito da segunda descarga', () => {
  let app, db, comum, comumToken;
  const sessoes = [];
  const props = [];

  const novaSessao = () => { const id = randomUUID(); sessoes.push(id); return id; };

  /**
   * Um qualificador irrepetível para `ferramenta.ativada`, que é a única dimensão livre.
   *
   * As contagens são POR DIA e a tabela é compartilhada pela rodada inteira, então um
   * qualificador fixo faria dois casos somarem no mesmo balde e o segundo mediria o resíduo
   * do primeiro. O prefixo `t` garante a forma `[a-z0-9_-]`.
   */
  const novoProp = () => { const p = `t${randomUUID().slice(0, 8)}`; props.push(p); return p; };

  const sessaoDe = (id) => db.query('SELECT * FROM uso_sessoes WHERE sessao_id = $1', [id])
    .then((r) => r.rows[0]);

  const contagemDe = (prop) => db.query(
    'SELECT contagem FROM uso_eventos_dia WHERE evento = $1 AND prop = $2',
    ['ferramenta.ativada', prop]
  ).then((r) => (r.rows[0] ? Number(r.rows[0].contagem) : null));

  const corpo = (sessaoId, extra = {}) => ({
    sessaoId,
    pagina: 'mapa',
    inicio: Date.now() - 60_000,
    ultimoSinal: Date.now() - 1_000,
    eventos: [],
    ...extra,
  });

  const enviar = (corpoDoLote, token) => {
    const req = supertest(app).post('/api/v1/uso/eventos');
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req.send(corpoDoLote).expect(204);
  };

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    comum = await createUser(db, { username: `usop_${randomUUID().slice(0, 6)}` });
    comumToken = await loginUser(app, comum.username, comum.password);
  });

  after(async () => {
    await db.query('DELETE FROM uso_sessoes WHERE sessao_id = ANY($1::uuid[])', [sessoes]);
    await db.query('DELETE FROM uso_eventos_dia WHERE prop = ANY($1::text[])', [props]);
    await teardownTestEnv(db);
  });

  it('as contagens SOMAM entre dois lotes da mesma sessão, na mesma linha do dia', async () => {
    const id = novaSessao();
    const prop = novoProp();
    await enviar(corpo(id, { eventos: [{ evento: 'ferramenta.ativada', prop, contagem: 3 }] }));
    assert.equal(await contagemDe(prop), 3, 'o primeiro lote precisa criar a linha');

    await enviar(corpo(id, { eventos: [{ evento: 'ferramenta.ativada', prop, contagem: 4 }] }));
    assert.equal(await contagemDe(prop), 7, 'o segundo lote SOMA, não substitui');

    // E o total de eventos da SESSÃO soma junto: são a mesma medida contada de dois jeitos, e
    // é por isso que as duas escritas estão na mesma transação.
    assert.equal((await sessaoDe(id)).eventos, 7);
  });

  it('o mesmo par (evento, qualificador) DUAS VEZES no mesmo lote soma, em vez de 21000', async () => {
    // A forma que o `GROUP BY` do UPSERT existe para tornar correta. Sem ele, o Postgres
    // recusa com "ON CONFLICT DO UPDATE command cannot affect row a second time", que chega
    // ao cliente como 500 e não tem relação aparente com o assunto.
    const prop = novoProp();
    await enviar(corpo(novaSessao(), {
      eventos: [
        { evento: 'ferramenta.ativada', prop, contagem: 2 },
        { evento: 'ferramenta.ativada', prop, contagem: 5 },
      ],
    }));
    assert.equal(await contagemDe(prop), 7);
  });

  it('o contador SATURA em INT_MAX em vez de estourar', async () => {
    // Ele é semeado perto do teto porque chegar lá pelo caminho normal levaria minutos de
    // rajada; o que se mede é a instrução, e ela é a mesma.
    const prop = novoProp();
    const hoje = (await db.query('SELECT CURRENT_DATE AS d')).rows[0].d;
    await db.query(
      `INSERT INTO uso_eventos_dia (dia, pagina, evento, prop, contagem)
       VALUES ($1, 'mapa', 'ferramenta.ativada', $2, 2147483000)`,
      [hoje, prop]
    );

    await enviar(corpo(novaSessao(), {
      eventos: [{ evento: 'ferramenta.ativada', prop, contagem: 100_000 }],
    }));
    assert.equal(await contagemDe(prop), 2147483647, 'a soma tem de saturar, não lançar 22003');
  });

  it('`erros` é o MÁXIMO e não a soma, porque o cliente manda o acumulado da sessão', async () => {
    const id = novaSessao();
    await enviar(corpo(id, { erros: 2 }));
    assert.equal((await sessaoDe(id)).erros, 2);
    await enviar(corpo(id, { erros: 3 }));
    assert.equal((await sessaoDe(id)).erros, 3, 'somar contaria o mesmo erro uma vez por descarga');
    // E um lote atrasado, com o acumulado ANTIGO, não pode fazer o número cair.
    await enviar(corpo(id, { erros: 1 }));
    assert.equal((await sessaoDe(id)).erros, 3);
  });

  it('`ultimo_sinal` só avança: o lote fora de ordem não encurta a sessão', async () => {
    const id = novaSessao();
    const agora = Date.now();
    await enviar(corpo(id, { inicio: agora - 300_000, ultimoSinal: agora - 10_000 }));
    const depoisDoPrimeiro = (await sessaoDe(id)).ultimo_sinal.getTime();

    await enviar(corpo(id, { inicio: agora - 300_000, ultimoSinal: agora - 200_000 }));
    assert.equal(
      (await sessaoDe(id)).ultimo_sinal.getTime(), depoisDoPrimeiro,
      'um lote atrasado empurraria a sessão para trás'
    );

    await enviar(corpo(id, { inicio: agora - 300_000, ultimoSinal: agora - 5_000 }));
    assert.ok(
      (await sessaoDe(id)).ultimo_sinal.getTime() > depoisDoPrimeiro,
      'e o lote mais novo precisa avançar, senão o GREATEST viraria "nunca muda"'
    );
  });

  it('os VITAIS se dividem em dois pares: carga guarda o PRIMEIRO, acumulado guarda o ÚLTIMO', async () => {
    const id = novaSessao();
    await enviar(corpo(id, { vitais: { lcpMs: 1200, tempoAteMapaMs: 3000, inpMs: 80, cls: 0.05 } }));
    await enviar(corpo(id, { vitais: { lcpMs: 9999, tempoAteMapaMs: 9999, inpMs: 210, cls: 0.31 } }));

    const linha = await sessaoDe(id);
    assert.equal(linha.lcp_ms, 1200, 'LCP acontece uma vez: vale o primeiro');
    assert.equal(linha.tempo_ate_mapa_ms, 3000, 'tempo até o mapa acontece uma vez: vale o primeiro');
    assert.equal(linha.inp_ms, 210, 'INP é o pior até agora: vale o último');
    assert.equal(Number(linha.cls), 0.31, 'CLS é acumulado: vale o último');
  });

  it('vital ausente no primeiro lote é preenchido pelo segundo', async () => {
    // O par negativo do caso acima: "primeiro vence" não pode virar "nunca preenche".
    const id = novaSessao();
    await enviar(corpo(id, { vitais: { inpMs: 40 } }));
    assert.equal((await sessaoDe(id)).lcp_ms, null);
    await enviar(corpo(id, { vitais: { lcpMs: 1500 } }));
    const linha = await sessaoDe(id);
    assert.equal(linha.lcp_ms, 1500);
    assert.equal(linha.inp_ms, 40, 'e o que já estava lá não pode ser apagado por um lote sem o campo');
  });

  it('o vital FRACIONÁRIO é arredondado nas colunas inteiras e preservado em `cls`', async () => {
    // O navegador entrega `DOMHighResTimeStamp`, que tem casas decimais. Sem o arredondamento,
    // a coluna `integer` recusa com 22P02 dentro da transação; arredondando `cls` junto, toda
    // medida boa viraria zero.
    const id = novaSessao();
    await enviar(corpo(id, { vitais: { lcpMs: 1234.7, cls: 0.123 } }));
    const linha = await sessaoDe(id);
    assert.equal(linha.lcp_ms, 1235);
    assert.equal(Number(linha.cls), 0.123);
  });

  it('a sessão que COMEÇA anônima e depois entra fica com o usuário; a release fica a primeira', async () => {
    const id = novaSessao();
    await enviar(corpo(id, { release: 'build-a', navegador: 'Firefox' }));
    assert.equal((await sessaoDe(id)).user_id, null);

    await enviar(corpo(id, { release: 'build-b', navegador: 'Chrome' }), comumToken);
    const linha = await sessaoDe(id);
    assert.equal(linha.user_id, comum.id, 'o último não nulo vence para a identidade');
    assert.equal(linha.release, 'build-a', 'a build é a do INÍCIO da sessão');
    assert.equal(linha.navegador, 'Firefox');
  });

  it('`dia` e `pagina_inicial` são os do PRIMEIRO sinal e não se movem', async () => {
    const id = novaSessao();
    const ultimoSinal = Date.now() - 1_000;
    await enviar(corpo(id, { pagina: 'atlas', ultimoSinal }));

    // O dia é o do FUSO DO SERVIDOR, o mesmo de `date_trunc('day', …)` do resto do módulo. A
    // expectativa é calculada PELO BANCO, e não formatada em JS: refazer a conversão aqui
    // exigiria adivinhar o fuso, que é exatamente o defeito que se quer poder detectar.
    const esperado = (await db.query('SELECT ($1::timestamptz)::date AS d', [new Date(ultimoSinal)])).rows[0].d;
    const linha = await sessaoDe(id);
    assert.equal(linha.dia.getTime(), esperado.getTime());
    assert.equal(linha.pagina_inicial, 'atlas');

    await enviar(corpo(id, { pagina: 'mapa' }));
    assert.equal((await sessaoDe(id)).pagina_inicial, 'atlas', 'a página INICIAL não migra');
  });

  it('o instante ALÉM DA RETENÇÃO é puxado para o piso, e não cria dia permanente', async () => {
    // As duas tabelas de contagem (`uso_eventos_dia` e `uso_diario`) NÃO são podadas, então um
    // `ultimoSinal` de 400 dias atrás escreveria nelas uma linha que nada apaga. O piso é
    // `agora` menos `LOG_RETENTION_DAYS`, que na suíte é o padrão de trinta dias.
    const id = novaSessao();
    const prop = novoProp();
    await enviar(corpo(id, {
      inicio: Date.now() - 401 * 86_400_000,
      ultimoSinal: Date.now() - 400 * 86_400_000,
      eventos: [{ evento: 'ferramenta.ativada', prop, contagem: 1 }],
    }));

    // O DIA ESPERADO É CALCULADO PELO BANCO, e não formatado em JS, pela mesma razão do caso do
    // `dia` acima: refazer a conversão aqui exigiria adivinhar o fuso do servidor.
    const { rows } = await db.query("SELECT (NOW() - INTERVAL '30 days')::date AS d");
    const linha = await sessaoDe(id);
    assert.equal(linha.dia.getTime(), rows[0].d.getTime(), 'o dia tem de cair no piso da retenção');
    assert.ok(linha.inicio <= linha.ultimo_sinal, 'duração nunca pode ser negativa');
    // E a contagem foi para o MESMO dia, que é o que impede a dimensão livre de ser
    // multiplicada por uma data arbitrária.
    const doDia = await db.query(
      'SELECT dia FROM uso_eventos_dia WHERE evento = $1 AND prop = $2',
      ['ferramenta.ativada', prop]
    );
    assert.equal(doDia.rows.length, 1);
    assert.equal(doDia.rows[0].dia.getTime(), rows[0].d.getTime());
  });

  it('o VITAL absurdo vira NULL e o LOTE sobrevive, em vez de estourar a coluna', async () => {
    // `2^31` milissegundos são 24 dias: acima disso a coluna `integer` responde `22003` DENTRO
    // da transação, e o lote inteiro (com todas as contagens) morre por causa de um número.
    // Descartar um percentil vale muito mais que descartar as contagens.
    const id = novaSessao();
    const prop = novoProp();
    await enviar(corpo(id, {
      eventos: [{ evento: 'ferramenta.ativada', prop, contagem: 3 }],
      vitais: {
        lcpMs: 9007199254740991,
        inpMs: 3_600_001,
        tempoAteMapaMs: 3_600_000,
      },
    }));

    const linha = await sessaoDe(id);
    assert.equal(linha.lcp_ms, null, 'o maior inteiro seguro do JS não pode derrubar o lote');
    assert.equal(linha.inp_ms, null, 'um milissegundo acima do teto já é descartado');
    // A FRONTEIRA EXATA pelo outro lado: sem ela, um teto escrito em qualquer número menor
    // passaria neste arquivo.
    assert.equal(linha.tempo_ate_mapa_ms, 3_600_000, 'exatamente no teto, o vital FICA');
    assert.equal(await contagemDe(prop), 3, 'e as contagens do mesmo lote foram gravadas');
  });

  it('o instante no FUTURO é aparado antes de virar linha', async () => {
    // Sem a apara, a linha teria `ultimo_sinal` além de qualquer `NOW() - retenção` e nenhuma
    // poda a alcançaria: lixo permanente escrito por chamador anônimo.
    const id = novaSessao();
    const antes = new Date();
    await enviar(corpo(id, { inicio: Date.now(), ultimoSinal: Date.now() + 30 * 86_400_000 }));
    const depois = new Date();
    const linha = await sessaoDe(id);
    assert.ok(
      linha.ultimo_sinal >= antes && linha.ultimo_sinal <= depois,
      `o sinal foi gravado fora do intervalo da requisição: ${linha.ultimo_sinal.toISOString()}`
    );
    assert.ok(linha.inicio <= linha.ultimo_sinal, 'duração nunca pode ser negativa');
  });
});
