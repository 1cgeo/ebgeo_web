// Path: tests/unit/log-diario.test.js
//
// `src/utils/log-diario.js` é o destino de log em arquivo, com virada por dia e poda por
// idade. Ele é infraestrutura no caminho onde a falha apaga justamente o que se quer ler,
// então este arquivo mede as três propriedades do cabeçalho daquele módulo, e não só o
// caminho feliz:
//
//   (1) nunca derruba quem loga: erro de escrita degrada, avisa UMA vez e o `write` seguinte
//       continua sendo uma chamada inofensiva;
//   (2) fala alto ao nascer: diretório que não pode ser criado vira aviso, não silêncio;
//   (3) poda só o que é nosso, e o limite de retenção é INCLUSIVO.
//
// O relógio e o `fs` são injetados, então nada aqui depende do dia em que a suíte roda nem
// escreve em disco — que é a razão de o módulo ter sido escrito com essas duas costuras.
//
// Controle negativo: troque `m[2] < diaLimite` por `<=` em `arquivosExpirados` e o caso do
// limite inclusivo cai; tire o `on('error')` de `abrir` e o caso de degradação passa a
// derrubar o processo do runner em vez de reprovar.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  diaLocal,
  nomeDoArquivo,
  arquivosExpirados,
  diaLimiteDaRetencao,
  criarLogDiario,
} from '../../src/utils/log-diario.js';

/**
 * Um `fs` de mentira, em memória. Só os quatro métodos que o módulo usa.
 * `falharEm` permite mandar um deles quebrar, que é como se mede a degradação.
 */
function fsFalso({ falharEm = null, arquivosExistentes = [] } = {}) {
  const escritos = new Map();
  const apagados = [];
  const diretoriosCriados = [];
  let inventario = [...arquivosExistentes];
  const fluxos = [];

  return {
    escritos, apagados, diretoriosCriados, fluxos,
    get inventario() { return inventario; },
    mkdirSync(dir) {
      if (falharEm === 'mkdir') throw new Error('EACCES: sem permissão');
      diretoriosCriados.push(dir);
    },
    readdirSync() {
      if (falharEm === 'readdir') throw new Error('EIO: leitura falhou');
      return [...inventario];
    },
    unlinkSync(alvo) {
      const nome = alvo.split(/[/\\]/).pop();
      apagados.push(nome);
      inventario = inventario.filter((n) => n !== nome);
    },
    createWriteStream(alvo) {
      if (falharEm === 'create') throw new Error('ENOSPC: disco cheio');
      const nome = alvo.split(/[/\\]/).pop();
      const ouvintes = [];
      const fluxo = {
        nome,
        encerrado: false,
        write(linha) {
          if (falharEm === 'write') throw new Error('ENOSPC: disco cheio');
          escritos.set(nome, (escritos.get(nome) || '') + linha);
        },
        end() { fluxo.encerrado = true; },
        on(evento, cb) { if (evento === 'error') ouvintes.push(cb); return fluxo; },
        /** Dispara o erro assíncrono que o disco produziria. */
        emitirErro(err) { for (const cb of ouvintes) cb(err); },
      };
      fluxos.push(fluxo);
      inventario.push(nome);
      return fluxo;
    },
  };
}

/** Relógio controlado: devolve a data que o teste mandar. */
function relogio(inicial) {
  let atual = new Date(inicial);
  return { agora: () => atual, avanca: (iso) => { atual = new Date(iso); } };
}

describe('log-diario — as partes puras', () => {
  it('diaLocal usa o fuso LOCAL, não UTC', () => {
    // Construído com componentes locais: o dia tem de ser o mesmo que se lê no relógio da
    // parede, inclusive às 23h, que é quando `toISOString()` já teria virado num fuso
    // negativo. O caso é escrito sem depender do fuso da máquina: comparamos com os
    // componentes locais da própria data.
    const d = new Date(2026, 7, 30, 23, 30, 0); // 30/ago/2026, 23:30 local
    assert.equal(diaLocal(d), '2026-08-30');
  });

  it('diaLocal zera à esquerda mês e dia', () => {
    assert.equal(diaLocal(new Date(2026, 0, 5, 12, 0, 0)), '2026-01-05');
  });

  it('nomeDoArquivo compõe prefixo e dia', () => {
    assert.equal(nomeDoArquivo('ebgeo', '2026-08-30'), 'ebgeo-2026-08-30.jsonl');
  });

  it('diaLimiteDaRetencao conta HOJE como o primeiro dos N', () => {
    const hoje = new Date(2026, 7, 30, 10, 0, 0);
    assert.equal(diaLimiteDaRetencao(hoje, 1), '2026-08-30', 'retenção de 1 dia = só hoje');
    assert.equal(diaLimiteDaRetencao(hoje, 30), '2026-08-01');
  });

  it('diaLimiteDaRetencao atravessa a virada de mês e de ano', () => {
    assert.equal(diaLimiteDaRetencao(new Date(2026, 2, 3, 10, 0, 0), 5), '2026-02-27',
      'março para fevereiro, ano não bissexto');
    assert.equal(diaLimiteDaRetencao(new Date(2026, 0, 2, 10, 0, 0), 5), '2025-12-29');
  });

  it('arquivosExpirados: o limite é INCLUSIVO (o dia do limite sobrevive)', () => {
    const nomes = [
      'ebgeo-2026-07-31.jsonl',
      'ebgeo-2026-08-01.jsonl',
      'ebgeo-2026-08-30.jsonl',
    ];
    const apagar = arquivosExpirados(nomes, 'ebgeo', '2026-08-01');
    assert.deepEqual(apagar, ['ebgeo-2026-07-31.jsonl']);
  });

  it('arquivosExpirados NÃO toca em arquivo que não é nosso', () => {
    const nomes = [
      'ebgeo-2020-01-01.jsonl',   // nosso e velho: vai
      'outro-2020-01-01.jsonl',   // prefixo alheio: fica
      'ebgeo-2020-01-01.log',     // extensão alheia: fica
      'ebgeo.jsonl',              // sem data: fica
      'backup-do-banco.sql',      // vizinho inocente: fica
      'ebgeo-2020-1-1.jsonl',     // data sem zero à esquerda: não é o nosso formato
    ];
    assert.deepEqual(arquivosExpirados(nomes, 'ebgeo', '2026-08-01'), ['ebgeo-2020-01-01.jsonl']);
  });

  it('arquivosExpirados com inventário vazio não inventa trabalho', () => {
    assert.deepEqual(arquivosExpirados([], 'ebgeo', '2026-08-01'), []);
  });
});

describe('log-diario — o destino', () => {
  it('escreve no arquivo do dia', () => {
    const fsys = fsFalso();
    const t = relogio('2026-08-30T10:00:00');
    const destino = criarLogDiario({ diretorio: '/logs', agora: t.agora, sistemaDeArquivos: fsys });

    destino.write('{"msg":"um"}\n');
    destino.write('{"msg":"dois"}\n');

    assert.equal(fsys.escritos.get('ebgeo-2026-08-30.jsonl'), '{"msg":"um"}\n{"msg":"dois"}\n');
    assert.equal(fsys.fluxos.length, 1, 'não reabre o arquivo a cada linha');
  });

  it('vira o arquivo quando o dia muda, e fecha o anterior', () => {
    const fsys = fsFalso();
    const t = relogio('2026-08-30T23:59:59');
    const destino = criarLogDiario({ diretorio: '/logs', agora: t.agora, sistemaDeArquivos: fsys });

    destino.write('{"msg":"ontem"}\n');
    t.avanca('2026-08-31T00:00:01');
    destino.write('{"msg":"hoje"}\n');

    assert.equal(fsys.escritos.get('ebgeo-2026-08-30.jsonl'), '{"msg":"ontem"}\n');
    assert.equal(fsys.escritos.get('ebgeo-2026-08-31.jsonl'), '{"msg":"hoje"}\n',
      'o dia anterior não pode receber a linha do dia novo');
    assert.equal(fsys.fluxos.length, 2);
    assert.equal(fsys.fluxos[0].encerrado, true, 'o fluxo do dia anterior é fechado');
    assert.equal(destino.diaAtual(), '2026-08-31');
  });

  it('poda os antigos ao abrir, e só na abertura', () => {
    const fsys = fsFalso({
      arquivosExistentes: ['ebgeo-2026-07-01.jsonl', 'ebgeo-2026-08-29.jsonl', 'alheio.txt'],
    });
    const t = relogio('2026-08-30T10:00:00');
    const destino = criarLogDiario({
      diretorio: '/logs', retencaoDias: 30, agora: t.agora, sistemaDeArquivos: fsys,
    });

    destino.write('a\n');
    assert.deepEqual(fsys.apagados, ['ebgeo-2026-07-01.jsonl'],
      'o de 29/08 está dentro dos 30 dias e o alheio nunca se toca');

    destino.write('b\n');
    assert.deepEqual(fsys.apagados, ['ebgeo-2026-07-01.jsonl'], 'não varre o diretório a cada linha');
  });

  it('erro de escrita SÍNCRONO degrada, avisa uma vez e não propaga', () => {
    const fsys = fsFalso({ falharEm: 'write' });
    const t = relogio('2026-08-30T10:00:00');
    const avisos = [];
    const destino = criarLogDiario({
      diretorio: '/logs', agora: t.agora, sistemaDeArquivos: fsys, avisar: (m) => avisos.push(m),
    });

    // O ponto inteiro do módulo: isto não pode lançar, porque quem chama é um handler HTTP.
    assert.doesNotThrow(() => destino.write('a\n'));
    assert.doesNotThrow(() => destino.write('b\n'));
    assert.doesNotThrow(() => destino.write('c\n'));

    assert.equal(avisos.length, 1, 'avisa UMA vez, não a cada linha');
    assert.match(avisos[0], /DESLIGADO/);
    assert.match(avisos[0], /disco cheio/, 'o aviso nomeia a causa real');
  });

  it('erro ASSÍNCRONO do fluxo (o do disco de verdade) também degrada', () => {
    const fsys = fsFalso();
    const t = relogio('2026-08-30T10:00:00');
    const avisos = [];
    const destino = criarLogDiario({
      diretorio: '/logs', agora: t.agora, sistemaDeArquivos: fsys, avisar: (m) => avisos.push(m),
    });

    destino.write('a\n');
    // É assim que ENOSPC chega de verdade: depois, pelo evento, longe do write que o causou.
    // Sem ouvinte, o node derruba o processo com um 'error' não tratado.
    fsys.fluxos[0].emitirErro(new Error('ENOSPC: disco cheio'));

    assert.equal(avisos.length, 1);
    assert.doesNotThrow(() => destino.write('b\n'));
    assert.equal(fsys.escritos.get('ebgeo-2026-08-30.jsonl'), 'a\n', 'nada mais é escrito depois de degradar');
  });

  it('diretório impossível: avisa ao NASCER, e não vira silêncio', () => {
    const fsys = fsFalso({ falharEm: 'mkdir' });
    const avisos = [];
    const destino = criarLogDiario({
      diretorio: '/proibido', sistemaDeArquivos: fsys, avisar: (m) => avisos.push(m),
    });

    assert.equal(avisos.length, 1, 'o operador precisa saber que não haverá log em arquivo');
    assert.match(avisos[0], /diretório/);
    assert.doesNotThrow(() => destino.write('a\n'));
    assert.equal(fsys.fluxos.length, 0, 'e não tenta escrever mesmo assim');
  });

  it('falha ao PODAR não desliga o log: escrever é o serviço, apagar é higiene', () => {
    const fsys = fsFalso({ falharEm: 'readdir' });
    const t = relogio('2026-08-30T10:00:00');
    const avisos = [];
    const destino = criarLogDiario({
      diretorio: '/logs', agora: t.agora, sistemaDeArquivos: fsys, avisar: (m) => avisos.push(m),
    });

    destino.write('a\n');

    assert.equal(avisos.length, 1);
    assert.match(avisos[0], /podar/);
    assert.doesNotMatch(avisos[0], /DESLIGADO/);
    assert.equal(fsys.escritos.get('ebgeo-2026-08-30.jsonl'), 'a\n', 'a linha foi escrita assim mesmo');
  });
});
