// Path: tests/unit/diag-sonda.test.js
/**
 * @fileoverview A SONDA EXTERNA COMO SEGUNDA FONTE DO BLOCO DE DISPONIBILIDADE, e o desfecho que
 * este arquivo existe para acertar: SEM SONDA NÃO É ZERO QUEDA (achado F23).
 *
 * O que o bloco já contava era a queda vista pelo CLIENTE, e ela chega enfileirada: o navegador
 * não consegue relatar enquanto o servidor está fora, então a queda em curso não aparece e a de
 * madrugada, sem ninguém com o produto aberto, não aparece nunca. `scripts/sonda-disponibilidade.js`
 * existia desde antes deste lote, gravava um `.jsonl` por dia e não estava agendada nem era lida
 * por ninguém.
 *
 * AS TRÊS ARMADILHAS QUE ESTE ARQUIVO PRENDE, e cada uma produz um número plausível e falso:
 *
 *   1. arquivo nenhum virando `indisponiveis: 0`, isto é, disponibilidade perfeita a partir de
 *      medição nenhuma. É o modo de falha mais caro, porque é uma boa notícia;
 *   2. a duração da maior queda calculada entre a primeira e a última batida falha, que dá ZERO
 *      quando só uma batida falhou. Por isso o que se publica é a CONTAGEM de batidas seguidas: o
 *      período da sonda é decisão de quem a agendou e o servidor não o conhece;
 *   3. a sonda desaparecendo quando o Postgres cai, porque ela mora dentro de um bloco cujo
 *      cabeçalho é decidido pelo banco. As duas fontes são independentes e a queda de uma não pode
 *      apagar a outra: é justamente durante o incidente que se lê esta tela.
 *
 * CONTROLE NEGATIVO, conferido em 2026-09-13: trocando o `return null` de `lerSonda` (diretório
 * ausente) por um resumo de lista vazia, 2 casos reprovam; e movendo `sonda` para dentro do ramo
 * não cego de `blocoIndisponivel`, 1 caso reprova, o do banco fora.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { arquivosDaJanela, resumirBatidas, lerSonda } from '../../src/modules/diag/sonda.service.js';
import { montarResumo } from '../../src/utils/diag-consulta.js';

const PERIODO = { desde: '24h', desdeMs: 86400000, inicio: 1000000, fim: 87400000 };

describe('sonda: quais arquivos entram na janela', () => {
  it('pega o dia da janela e o anterior, e ignora arquivo que não é do padrão', () => {
    const inicio = Date.parse('2026-09-12T23:00:00Z');
    const fim = Date.parse('2026-09-13T01:00:00Z');
    const nomes = [
      'sonda-2026-09-11.jsonl', 'sonda-2026-09-12.jsonl', 'sonda-2026-09-13.jsonl',
      'sonda-2026-09-01.jsonl', 'leia-me.txt', 'sonda.jsonl',
    ];
    const escolhidos = arquivosDaJanela(nomes, inicio, fim);
    // O dia ANTERIOR entra: o arquivo é nomeado pela data UTC e a janela é um instante, então a
    // primeira linha da janela pode morar no arquivo de ontem em qualquer fuso a leste.
    assert.deepEqual(escolhidos,
      ['sonda-2026-09-11.jsonl', 'sonda-2026-09-12.jsonl', 'sonda-2026-09-13.jsonl']);
  });

  it('teto de sete arquivos, e o que sobrevive são os MAIS RECENTES', () => {
    const nomes = Array.from({ length: 12 }, (_, i) => `s-2026-09-${String(i + 1).padStart(2, '0')}.jsonl`);
    const escolhidos = arquivosDaJanela(nomes, Date.parse('2026-09-01T00:00:00Z'), Date.parse('2026-09-12T00:00:00Z'));
    assert.equal(escolhidos.length, 7);
    assert.equal(escolhidos[6], 's-2026-09-12.jsonl');
  });
});

describe('sonda: o resumo das batidas', () => {
  it('conta indisponíveis e a MAIOR sequência de batidas seguidas', () => {
    const r = resumirBatidas([
      { time: 1, disponivel: true }, { time: 2, disponivel: false }, { time: 3, disponivel: false },
      { time: 4, disponivel: true }, { time: 5, disponivel: false },
    ]);
    assert.equal(r.medicoes, 5);
    assert.equal(r.indisponiveis, 3);
    // TRÊS indisponíveis, mas a maior SEQUÊNCIA é dois: as duas contagens respondem perguntas
    // diferentes (quantas vezes falhou, e por quanto tempo seguido).
    assert.equal(r.maiorSequencia, 2);
    assert.equal(r.ultimaEm, 5);
    assert.equal(r.ultimaDisponivel, false);
  });

  it('tudo disponível é sequência zero, e a última batida é a mais recente', () => {
    const r = resumirBatidas([{ time: 10, disponivel: true }, { time: 20, disponivel: true }]);
    assert.equal(r.indisponiveis, 0);
    assert.equal(r.maiorSequencia, 0);
    assert.equal(r.ultimaDisponivel, true);
    assert.equal(r.ultimaEm, 20);
  });
});

describe('sonda: leitura do disco', () => {
  let dir;
  before(async () => { dir = await mkdtemp(join(tmpdir(), 'ebgeo-sonda-')); });
  after(async () => { await rm(dir, { recursive: true, force: true }); });

  it('diretório inexistente devolve null, e null é o que vira "sem sonda"', async () => {
    const lido = await lerSonda({ diretorio: join(dir, 'nao-existe'), inicio: 0, fim: 1e13 });
    assert.equal(lido, null);
  });

  it('diretório vazio também devolve null, e não uma medição de zero queda', async () => {
    assert.equal(await lerSonda({ diretorio: dir, inicio: 0, fim: 1e13 }), null);
  });

  it('lê as batidas da janela, descarta as de fora e a linha quebrada', async () => {
    const dia = new Date().toISOString().slice(0, 10);
    const agora = Date.now();
    await writeFile(join(dir, `sonda-${dia}.jsonl`), [
      JSON.stringify({ time: agora - 1000, disponivel: true, status: 200 }),
      JSON.stringify({ time: agora - 500, disponivel: false, status: null }),
      '{ isto nao e json',
      JSON.stringify({ disponivel: false }),
      JSON.stringify({ time: agora - 999999999, disponivel: false }),
      '',
    ].join('\n'), 'utf8');

    const lido = await lerSonda({ diretorio: dir, inicio: agora - 60000, fim: agora });
    assert.equal(lido.medicoes, 2, 'a linha quebrada, a sem `time` e a antiga ficam de fora');
    assert.equal(lido.indisponiveis, 1);
    assert.equal(lido.arquivos, 1);
    assert.equal(lido.ultimaDisponivel, false);
  });

  it('arquivo só com linhas FORA da janela devolve null, e não medições zero', async () => {
    // "A sonda rodou ontem e parou" não é "o servidor esteve disponível hoje".
    const lido = await lerSonda({ diretorio: dir, inicio: Date.now() + 1000, fim: Date.now() + 2000 });
    assert.equal(lido, null);
  });
});

describe('montarResumo: a sonda dentro do bloco de disponibilidade', () => {
  it('SEM SONDA o sub-bloco fala, e a frase diz que não é zero queda', () => {
    const r = montarResumo({ periodo: PERIODO, defeitos: { itens: [], totalDefeitos: 0 } });
    assert.equal(r.indisponivel.sonda.disponivel, false);
    assert.match(r.indisponivel.sonda.motivo, /sem sonda/);
    assert.match(r.indisponivel.sonda.motivo, /NÃO é zero queda/);
    // A ASSERÇÃO QUE IMPORTA: nenhuma contagem ao lado de `disponivel: false`.
    assert.equal(r.indisponivel.sonda.medicoes, undefined);
    assert.equal(r.indisponivel.sonda.indisponiveis, undefined);
    assert.equal(r.indisponivel.sonda.premissa, null);
  });

  it('COM SONDA o sub-bloco traz as contagens e a premissa nomeia a fonte', () => {
    const r = montarResumo({
      periodo: PERIODO,
      defeitos: { itens: [], totalDefeitos: 0 },
      sonda: {
        diretorio: '/srv/sonda', arquivos: 2, medicoes: 100, indisponiveis: 4,
        maiorSequencia: 3, ultimaEm: 87000000, ultimaDisponivel: true,
      },
    });
    const s = r.indisponivel.sonda;
    assert.equal(s.disponivel, true);
    assert.equal(s.medicoes, 100);
    assert.equal(s.indisponiveis, 4);
    assert.equal(s.maiorSequencia, 3);
    assert.deepEqual(s.premissa, {
      fonte: 'sonda', diretorio: '/srv/sonda', arquivos: 2, medicoes: 100,
    });
  });

  it('BANCO FORA: o bloco se declara cego E a sonda continua falando', () => {
    // As duas fontes são independentes, e é durante o incidente que esta tela é lida. Um sub-bloco
    // que sumisse junto com o Postgres apagaria justamente a testemunha que não depende dele.
    const r = montarResumo({
      periodo: PERIODO, defeitos: null, defeitosErro: 'ECONNREFUSED',
      sonda: { diretorio: '/srv/sonda', arquivos: 1, medicoes: 10, indisponiveis: 10, maiorSequencia: 10, ultimaEm: 1, ultimaDisponivel: false },
    });
    assert.equal(r.indisponivel.disponivel, false);
    assert.match(r.indisponivel.motivo, /ECONNREFUSED/);
    assert.equal(r.indisponivel.defeitos, undefined, 'nenhuma contagem de banco ao lado do cego');
    assert.equal(r.indisponivel.sonda.disponivel, true);
    assert.equal(r.indisponivel.sonda.indisponiveis, 10);
  });

  it('os cinco blocos de topo continuam sendo cinco: a sonda não virou um sexto', () => {
    // Não-vacuidade da forma do documento: `sonda` responde à mesma pergunta do bloco 4 e mora
    // dentro dele; promovê-la a bloco de topo quebraria as duas portas do resumo de uma vez.
    const r = montarResumo({ periodo: PERIODO, defeitos: null });
    assert.deepEqual(Object.keys(r).sort(),
      ['defeitos', 'indisponivel', 'latencia', 'periodo', 'saude', 'status']);
  });
});
