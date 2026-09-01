// Path: tests/unit/diag-saude-impressao.test.js
//
// `imprimirSaude` (`scripts/diag.js`) é a metade do comando `npm run diag -- saude` que NÃO
// tem função pura para testar, e foi ela que quebrou. `resumirAmostras` já devolvia o terceiro
// estado (série de pé, intervalo INESTIMÁVEL, `faltantes: null`); a impressão não o honrava,
// escrevia "FALTARAM null amostra(s) de null esperada(s)" e caía na linha seguinte
// desreferenciando `maiorBuraco` nulo, saindo com código 1. Uma suíte que só exercitasse a
// função pura ficaria verde com o comando morrendo na frente do operador.
//
// POR ISSO ELE DIRIGE O COMANDO DE VERDADE, com `spawnSync` sobre um diretório de log
// sintético, e não importa nada de `scripts/diag.js`: o arquivo chama `main()` na avaliação do
// módulo, então importá-lo executaria o comando com os argumentos do corredor de testes. O que
// se mede aqui é o que o operador lê e o código de saída, que são as duas coisas que a função
// pura não pode prometer.
//
// O comando roda SEM banco de propósito: com `--dir` ele nem importa `src/config.js` (que
// exigiria DATABASE_URL na avaliação do módulo), e a hora de ler log é a hora em que o banco
// pode não estar de pé. Se este teste passar a precisar de banco, alguma coisa regrediu ali.
//
// CONTROLE NEGATIVO (conferido revertendo cada um):
//   - tire o ramo `r.faltantes === null` de `imprimirSaude` e o terceiro estado volta a sair
//     com código 1 e "FALTARAM null";
//   - tire a `premissa` da frase tranquilizadora e cai o caso da série saudável;
//   - volte a inferência para a mediana e cai o caso da queda majoritária;
//   - troque a nota de disco por uma que afirme causa ("o log parou por disco cheio") e cai o
//     caso do INDÍCIO, que é o que impede o relatório de mandar consertar a coisa errada;
//   - cale a nota quando nenhuma amostra traz leitura e cai o caso do buraco AMBÍGUO, que é o
//     estado da maioria dos logs enquanto o campo for novo.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MARCADOR_AMOSTRA } from '../../src/utils/amostra-de-saude.js';

const COMANDO = fileURLToPath(new URL('../../scripts/diag.js', import.meta.url));
const MIN = 60_000;
const temporarios = [];

after(() => {
  for (const dir of temporarios) fs.rmSync(dir, { recursive: true, force: true });
});

/** O nome de arquivo que `diasDaJanela` vai procurar para um instante (dia LOCAL). */
function arquivoDoDia(t) {
  const d = new Date(t);
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `ebgeo-${d.getFullYear()}-${mes}-${dia}.jsonl`;
}

/**
 * Escreve um log com amostras de saúde nos instantes pedidos, relativos a AGORA.
 *
 * Os deslocamentos são negativos (passado), porque o comando lê uma janela que termina no
 * relógio da máquina e não aceita um "agora" de fora. Um deslocamento pode vir como par
 * `[ms, livreMb]` para que a amostra carregue leitura de disco; o número nu não carrega
 * nenhuma, que é o estado da esmagadora maioria das linhas existentes.
 */
function logCom(deslocamentos) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ebgeo-diag-'));
  temporarios.push(dir);
  const agora = Date.now();
  const porArquivo = new Map();
  for (const bruto of deslocamentos) {
    const [d, livreMb] = Array.isArray(bruto) ? bruto : [bruto, null];
    const t = agora + d;
    const nome = arquivoDoDia(t);
    if (!porArquivo.has(nome)) porArquivo.set(nome, []);
    const linha = {
      level: 30, time: t, amostra: MARCADOR_AMOSTRA, banco: { ok: true, ms: 2 }, msg: 'amostra de saúde',
    };
    // Campo ausente quando não medido, como `montarAmostra` escreve: `disco: null` seria uma
    // forma que o produtor nunca emite.
    if (livreMb !== null) linha.disco = { livreMb, totalMb: 20_480 };
    porArquivo.get(nome).push(JSON.stringify(linha));
  }
  for (const [nome, linhas] of porArquivo) fs.writeFileSync(path.join(dir, nome), `${linhas.join('\n')}\n`);
  return dir;
}

/** Roda `diag saude` contra aquele diretório e devolve saída e código de saída. */
function rodar(dir, extras = []) {
  const r = spawnSync(process.execPath, [COMANDO, 'saude', '--desde', '24h', '--dir', dir, ...extras], {
    encoding: 'utf8',
  });
  return { codigo: r.status, saida: r.stdout || '', erro: r.stderr || '' };
}

describe('diag saude — a impressão honra os três estados', () => {
  it('TERCEIRO ESTADO: intervalo inestimável não imprime "null" nem derruba o comando', () => {
    // Quatro linhas no mesmo milissegundo: todas as distâncias valem zero, nenhuma serve para
    // estimar. Era exatamente esta série que produzia `intervaloMs: 0` e o TypeError.
    const dir = logCom([-3_600_000, -3_600_000, -3_600_000, -3_600_000]);
    const { codigo, saida, erro } = rodar(dir);

    assert.equal(codigo, 0, `o comando saiu com erro:\n${erro}`);
    assert.doesNotMatch(saida, /null/, 'nenhum "null" pode chegar ao operador');
    assert.doesNotMatch(saida, /TypeError/);
    assert.match(saida, /NÃO FOI POSSÍVEL ESTIMAR O INTERVALO/);
    assert.match(saida, /Isto NÃO é "nada faltou"/, 'a ausência de estimativa não é saúde');
    assert.doesNotMatch(saida, /Nenhuma amostra faltando/);
  });

  it('DUAS AMOSTRAS distantes: não afirma "nada faltou" e explica o silêncio do presente', () => {
    const dir = logCom([-6 * 60 * MIN, -30 * MIN]);
    const { codigo, saida } = rodar(dir);

    assert.equal(codigo, 0);
    assert.doesNotMatch(saida, /Nenhuma amostra faltando/);
    assert.match(saida, /NÃO FOI POSSÍVEL ESTIMAR O INTERVALO/);
    assert.match(saida, /1 distância\(s\) entre amostras/);
    // O aviso de última amostra atrasada depende do intervalo, então ele fica mudo aqui: o
    // relatório diz POR QUE ficou, em vez de deixar o operador ler o silêncio como bom sinal.
    assert.match(saida, /não dá para dizer se a última amostra/);
  });

  it('QUEDA MAJORITÁRIA: o incidente aparece, e a contagem casa com --intervalo 5m', () => {
    // O caso observado: 5 min nominal, oito horas reiniciando de hora em hora, com um segundo
    // tique em três dessas horas. Sob a mediana, o comando dizia "1h (INFERIDO)" e "Nenhuma
    // amostra faltando"; a mesma série com --intervalo 5m acusava dezenas de faltantes.
    const deslocamentos = [];
    for (let h = 0; h < 8; h += 1) {
      const base = -(8 - h) * 60 * MIN;
      deslocamentos.push(base);
      if (h === 0 || h === 2 || h === 5) deslocamentos.push(base + 5 * MIN);
    }
    const dir = logCom(deslocamentos);
    const inferido = rodar(dir);
    const informado = rodar(dir, ['--intervalo', '5m']);

    assert.equal(inferido.codigo, 0);
    assert.doesNotMatch(inferido.saida, /Nenhuma amostra faltando/, 'era esta a frase que mentia');
    assert.match(inferido.saida, /FALTARAM 74 amostra\(s\) de 85 esperada\(s\)/);
    assert.match(inferido.saida, /Intervalo considerado: 5min \(INFERIDO do p10 de 10 distância\(s\)/);
    // A prova de que a inferência parou de divergir da premissa declarada: as duas contagens
    // são a mesma, e foi a divergência entre elas que denunciou o defeito.
    assert.match(informado.saida, /FALTARAM 74 amostra\(s\) de 85 esperada\(s\)/);
  });

  it('SÉRIE SAUDÁVEL: a frase tranquilizadora carrega a premissa dentro dela', () => {
    // "Nenhuma amostra faltando" sozinha lê como saúde medida, quando é uma divisão por um
    // intervalo que o próprio comando inferiu. A premissa vai na MESMA linha, não numa acima.
    const deslocamentos = [];
    for (let i = 12; i >= 1; i -= 1) deslocamentos.push(-i * 5 * MIN);
    const { codigo, saida } = rodar(logCom(deslocamentos));

    assert.equal(codigo, 0);
    const linha = saida.split('\n').find((l) => l.startsWith('Nenhuma amostra faltando'));
    assert.ok(linha, `a linha tranquilizadora não saiu:\n${saida}`);
    assert.match(linha, /supondo intervalo de 5min, INFERIDO do p10 de 11 distância\(s\)/);
  });

  it('SÉRIE SAUDÁVEL com --intervalo: a premissa nomeada é a de quem perguntou', () => {
    const deslocamentos = [];
    for (let i = 12; i >= 1; i -= 1) deslocamentos.push(-i * 5 * MIN);
    const { codigo, saida } = rodar(logCom(deslocamentos), ['--intervalo', '5m']);

    assert.equal(codigo, 0);
    const linha = saida.split('\n').find((l) => l.startsWith('Nenhuma amostra faltando'));
    assert.ok(linha, `a linha tranquilizadora não saiu:\n${saida}`);
    assert.match(linha, /supondo o intervalo de 5min que você informou/);
    assert.doesNotMatch(saida, /ESTIMATIVA FRÁGIL/, 'não há estimativa a qualificar');
  });

  it('DISCO: o buraco sai com a leitura da amostra anterior, como INDÍCIO e não como causa', () => {
    // A ambiguidade que o campo desfaz: buraco na série é processo morto OU log em arquivo
    // desligado por falta de espaço, com o processo vivo. O relatório publica o número e
    // devolve o juízo a quem lê; afirmar a causa mandaria consertar a coisa errada.
    const dir = logCom([
      [-60 * MIN, 900], [-55 * MIN, 512], [-15 * MIN, 64], [-10 * MIN, 60],
    ]);
    const { codigo, saida } = rodar(dir, ['--intervalo', '5m']);

    assert.equal(codigo, 0);
    assert.match(saida, /disco na amostra anterior: 512 MB livres de 20480 MB/, 'a véspera do silêncio');
    assert.doesNotMatch(saida, /900 MB livres/, 'a leitura é daquele buraco, não da janela');
    assert.match(saida, /INDÍCIO, não/);
    // Nenhuma forma de veredito: o comando descreve o mecanismo e para aí.
    assert.doesNotMatch(saida, /log parou/i);
    assert.doesNotMatch(saida, /disco cheio/i);
    assert.doesNotMatch(saida, /pouco espaço/i);
    assert.doesNotMatch(saida, /%/, 'nem fração nem limiar derivado');
  });

  it('DISCO ausente na janela inteira: a nota diz que o buraco continua AMBÍGUO', () => {
    // O campo é novo, então a maioria dos logs existentes não o tem. Silêncio aqui leria como
    // "disco ok", que é a inversão que a amostra recusa na escrita.
    const dir = logCom([-60 * MIN, -55 * MIN, -15 * MIN, -10 * MIN]);
    const { codigo, saida } = rodar(dir, ['--intervalo', '5m']);

    assert.equal(codigo, 0);
    assert.match(saida, /Nenhuma amostra desta janela traz leitura de disco/);
    assert.match(saida, /continua AMBÍGUO/);
    assert.doesNotMatch(saida, /MB livres/, 'não se inventa leitura onde não houve medição');
  });

  it('DISCO faltando SÓ na amostra que abre o buraco: a lacuna é nomeada, não omitida', () => {
    // Aqui a janela TEM o campo, então a ausência é pontual e significa outra coisa: a nota
    // geral não serve, e uma linha em branco leria como leitura boa.
    const dir = logCom([[-60 * MIN, 900], -55 * MIN, [-15 * MIN, 64], [-10 * MIN, 60]]);
    const { codigo, saida } = rodar(dir, ['--intervalo', '5m']);

    assert.equal(codigo, 0);
    assert.match(saida, /disco na amostra anterior: sem leitura nessa amostra/);
    assert.match(saida, /INDÍCIO, não/, 'a janela tem o campo, então vale a nota do indício');
  });

  it('ESTIMATIVA FRÁGIL: poucas distâncias qualificam a tranquilidade em vez de escondê-la', () => {
    // Com menos de dez distâncias o posto do p10 é 1, ou seja, a estimativa É a menor
    // distância: um único reinício rápido decide o número, e a saída diz isso.
    const dir = logCom([-20 * MIN, -15 * MIN, -10 * MIN, -5 * MIN]);
    const { codigo, saida } = rodar(dir);

    assert.equal(codigo, 0);
    assert.match(saida, /ESTIMATIVA FRÁGIL/);
    assert.match(saida, /Nenhuma amostra faltando/);
    assert.match(saida, /esta tranquilidade vale o/, 'a ressalva acompanha a frase, não só o cabeçalho');
  });
});
