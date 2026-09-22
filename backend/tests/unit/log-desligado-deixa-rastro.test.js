// Path: tests/unit/log-desligado-deixa-rastro.test.js
//
// Quando o log em arquivo se DESLIGA em runtime (disco cheio, volume que sumiu, arquivo do dia de
// outro dono), o `.jsonl` para de crescer com o processo VIVO, e até 2026-09-22 o que o
// diagnóstico dizia era "sem amostras" ou um buraco na série, que é a mesma assinatura de uma
// queda. O arquivo não tem como registrar que parou; o aviso do stderr não sobrevive ao
// container recriado. Este arquivo mede as três pontas do rastro que ficou no lugar:
//
//   (1) o defeito de servidor que o boot anota (`defeitoDoLogDesligado`): assinatura estável por
//       código, para que o mesmo incidente conte ocorrência em vez de nascer defeito novo;
//   (2) o bloco de saúde do resumo (`montarResumo`), que acha esse defeito e o publica nos DOIS
//       ramos, inclusive quando a série está vazia ou o diretório cego;
//   (3) o estado do processo vivo (`estadoDoLogEmArquivo`), que as rotas publicam.
//
// Controle negativo: troque o `startsWith(MARCADOR_LOG_DESLIGADO)` do resumo por uma comparação
// com `mensagem` e o caso (2) cai; ponha `logEmArquivo` só no ramo disponível do bloco de saúde e
// o caso do diretório cego cai; ponha a mensagem crua dentro da assinatura e o caso (1) cai.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MARCADOR_LOG_DESLIGADO } from '../../src/utils/log-diario.js';
import { montarResumo } from '../../src/utils/diag-consulta.js';
import { defeitoDoLogDesligado } from '../../src/modules/diag/defeitos-de-servidor.js';
import { estadoDoLogEmArquivo, aoDesligarLogEmArquivo } from '../../src/utils/logger.js';
import config from '../../src/config.js';

const HORA = 3_600_000;
const FIM = 1_788_000_000_000;
const PERIODO = { desde: '24h', desdeMs: 24 * HORA, inicio: FIM - 24 * HORA, fim: FIM };
const LEITURA_VIVA = { diretorio: '/app/data/logs', ausente: false, arquivos: 1, linhas: 10 };
const SEM_AMOSTRAS = {
  situacao: 'sem-amostras', total: 0, faltantes: null, esperadas: null, buracos: [], maiorBuraco: null,
  desdeUltimaMs: null, ultimaAtrasada: null, intervaloMs: null, intervaloOrigem: null,
  estimativaFragil: null, discoNaUltima: null,
};

function estadoDesligado(dia, codigo = 'EACCES') {
  return {
    ligado: false,
    motivo: 'falha',
    diretorio: '/app/data/logs',
    desligadoEm: FIM - HORA,
    causa: 'falha ao escrever',
    codigo,
    mensagem: `${codigo}: permission denied, open '/app/data/logs/ebgeo-${dia}.jsonl'`,
  };
}

/** Um item de `listarDefeitos`, com a assinatura, que é o que o resumo procura. */
function itemDeDefeito(campos) {
  return {
    id: campos.id,
    assinatura: campos.assinatura,
    mensagem: campos.mensagem ?? 'mensagem',
    estado: campos.estado ?? 'aberto',
    origem: campos.origem,
    ocorrencias: campos.ocorrencias ?? 1,
    primeiraEm: FIM - 3 * HORA,
    ultimaEm: FIM - HORA,
  };
}

describe('(1) o defeito que um desligamento produz', () => {
  it('a assinatura abre com o marcador e separa por CÓDIGO, não pelo caminho do dia', () => {
    const ontem = defeitoDoLogDesligado(estadoDesligado('2026-09-21'));
    const hoje = defeitoDoLogDesligado(estadoDesligado('2026-09-22'));
    const cheio = defeitoDoLogDesligado(estadoDesligado('2026-09-22', 'ENOSPC'));

    assert.ok(hoje.assinatura.startsWith(MARCADOR_LOG_DESLIGADO));
    assert.equal(ontem.assinatura, hoje.assinatura,
      'o mesmo incidente em dois dias é UM defeito com duas ocorrências, não dois defeitos');
    assert.notEqual(cheio.assinatura, hoje.assinatura, 'EACCES e ENOSPC pedem consertos opostos');
  });

  it('a mensagem nomeia a causa, o erro e o diretório, e diz que só o reinício religa', () => {
    const d = defeitoDoLogDesligado(estadoDesligado('2026-09-22'));
    assert.match(d.mensagem, /DESLIGADO/);
    assert.match(d.mensagem, /falha ao escrever: EACCES: permission denied/);
    assert.match(d.mensagem, /Diretório: \/app\/data\/logs\./);
    assert.match(d.mensagem, /reinício/);
    // Não houve requisição nem resposta: nada de status inventado.
    assert.equal(d.statusCode, null);
    assert.equal(d.rota, null);
  });

  it('a mensagem respeita o teto de 500 mesmo com um caminho enorme', () => {
    const d = defeitoDoLogDesligado({ ...estadoDesligado('x'), mensagem: `EACCES: ${'a'.repeat(2000)}` });
    assert.equal(d.mensagem.length, 500);
  });

  it('sem código, a assinatura diz que não há código em vez de colapsar em outra', () => {
    const d = defeitoDoLogDesligado({ ...estadoDesligado('x'), codigo: null });
    assert.equal(d.assinatura, `${MARCADOR_LOG_DESLIGADO} | sem codigo`);
  });
});

describe('(2) o bloco de saúde do resumo acha o desligamento', () => {
  const desligado = defeitoDoLogDesligado(estadoDesligado('2026-09-22'));
  const itens = [
    itemDeDefeito({ id: 'log', origem: 'servidor', assinatura: desligado.assinatura, mensagem: desligado.mensagem, ocorrencias: 3 }),
    // Um 500 qualquer do servidor: não é desligamento.
    itemDeDefeito({ id: 'outro', origem: 'servidor', assinatura: 'GET /api/v1/atlas [500] | Error | boom' }),
    // Um relato de NAVEGADOR com o mesmo começo: só o servidor escreve sobre o próprio log.
    itemDeDefeito({ id: 'forjado', origem: 'console', assinatura: `${MARCADOR_LOG_DESLIGADO} | EACCES` }),
  ];
  const defeitos = { itens, totalDefeitos: itens.length };

  it('série SEM AMOSTRAS: o bloco diz que o log foi desligado pelo servidor, e só esse defeito', () => {
    const r = montarResumo({ periodo: PERIODO, leitura: LEITURA_VIVA, defeitos, amostras: SEM_AMOSTRAS, status: null });

    assert.equal(r.saude.situacao, 'sem-amostras');
    const l = r.saude.logEmArquivo;
    assert.equal(l.disponivel, true);
    assert.equal(l.desligamentos.length, 1);
    assert.deepEqual(l.desligamentos[0], {
      id: 'log', mensagem: desligado.mensagem, estado: 'aberto', ocorrencias: 3,
      primeiraEm: FIM - 3 * HORA, ultimaEm: FIM - HORA,
    });
    assert.equal(l.premissa.fonte, 'banco');
  });

  it('diretório de log CEGO: o bloco se declara sem fonte e MESMO ASSIM carrega o desligamento', () => {
    // É o caso em que ele mais importa: o arquivo não diz nada, e o banco diz por quê.
    const r = montarResumo({
      periodo: PERIODO, leitura: { diretorio: '/app/data/logs', ausente: true, arquivos: 0, linhas: 0 },
      defeitos, amostras: null, status: null,
    });

    assert.equal(r.saude.disponivel, false);
    assert.equal(r.saude.logEmArquivo.disponivel, true);
    assert.equal(r.saude.logEmArquivo.desligamentos.length, 1);
  });

  it('banco fora: o sub-bloco se declara cego, e não publica lista vazia como "nenhum desligamento"', () => {
    const r = montarResumo({
      periodo: PERIODO, leitura: LEITURA_VIVA, defeitos: null, defeitosErro: 'Postgres fora',
      amostras: SEM_AMOSTRAS, status: null,
    });

    assert.equal(r.saude.logEmArquivo.disponivel, false);
    assert.match(r.saude.logEmArquivo.motivo, /Postgres fora/);
    assert.equal(Object.hasOwn(r.saude.logEmArquivo, 'desligamentos'), false);
  });

  it('nenhum desligamento na janela: lista vazia, com o banco respondendo', () => {
    const r = montarResumo({
      periodo: PERIODO, leitura: LEITURA_VIVA, defeitos: { itens: [itens[1]], totalDefeitos: 1 },
      amostras: SEM_AMOSTRAS, status: null,
    });
    assert.equal(r.saude.logEmArquivo.disponivel, true);
    assert.deepEqual(r.saude.logEmArquivo.desligamentos, []);
  });
});

describe('(3) o estado do processo vivo', () => {
  it('sob a suíte o log em arquivo está desligado por CONFIGURAÇÃO de teste, nunca por falha', () => {
    const e = estadoDoLogEmArquivo();
    assert.equal(config.isTest, true, 'premissa: o runner sobe a suíte com NODE_ENV=test');
    assert.equal(e.ligado, false);
    // O esperado sai da configuração, e não de uma lista de aceitáveis: com LOG_TO_FILE=off no
    // ambiente de quem roda, o motivo certo é o da configuração, que vence o de teste.
    assert.equal(e.motivo, config.log.emArquivo ? 'teste' : 'configuracao');
    assert.equal(e.desligadoEm, null, 'desligado por configuração não tem instante de desligamento');
  });

  it('o ouvinte do desligamento não é chamado sem falha, e o registro devolve o cancelamento', () => {
    let chamadas = 0;
    const cancelar = aoDesligarLogEmArquivo(() => { chamadas += 1; });
    assert.equal(typeof cancelar, 'function');
    cancelar();
    assert.equal(chamadas, 0, 'desligado por configuração não é incidente, e não vira defeito');
  });
});
