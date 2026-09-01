// Path: tests/unit/diag-saude.test.js
//
// `resumirAmostras` (`src/utils/diag-consulta.js`) responde a pergunta que o `fileoverview` de
// `src/utils/amostra-de-saude.js` formula e que, até 2026-08-31, não tinha comando, consulta
// nem tela: "quantas amostras faltaram e quando". Um amostrador dentro do processo não
// testemunha a própria morte, então nenhuma linha diz "eu caí"; o que revela a queda é o
// BURACO na série, e o `MARCADOR_AMOSTRA` era exportado para ser filtrado sem ter um só
// importador.
//
// O QUE ESTE ARQUIVO MEDE É HONESTIDADE, e não caminho feliz, porque é aqui que um relatório
// de disponibilidade mente:
//
//   (1) o intervalo é INFERIDO dos dados (o config exige DATABASE_URL na avaliação do módulo,
//       e a hora de ler log é a hora em que o banco pode não estar de pé), por um PERCENTIL
//       BAIXO das distâncias (p10). A saída diz qual intervalo usou, de onde ele veio e sobre
//       quantas distâncias, porque a conta de faltantes é inteira sobre essa premissa;
//   (2) zero amostra NÃO é "nenhuma queda", é instrumento que não produziu nada; uma amostra
//       só não permite afirmar coisa alguma sobre buraco, nem com `--intervalo` informado; e
//       uma DISTÂNCIA só não permite ESTIMAR, que é o terceiro estado;
//   (3) o trecho antes da primeira amostra é DESCONHECIDO, não faltante (senão todo
//       `--desde 7d` depois de um deploy inventaria uma queda), enquanto a distância entre a
//       última amostra e o agora é o sinal do presente e sai em campo próprio.
//
// POR QUE O ARQUIVO MUDOU EM 2026-09-01, e é a lição que ele carrega. A inferência era pela
// MEDIANA, e o único caso que a punha à prova era favorável a ela: quatro distâncias
// nominais e UM buraco, ou seja, o buraco em minoria, que é o regime em que qualquer estimador
// central acerta. Isso é cobertura vazia na ferramenta que existe para detectar queda: o
// verde não estava provando nada sobre o caso que importa, porque buraco só ALONGA distância
// e nunca encurta, então quando a queda vira MAIORIA a mediana sobe junto com ela e a conta
// de faltantes some. Observado: amostrador de 5 min, oito horas reiniciando de hora em hora,
// e o comando dizia "1h (INFERIDO)" mais "Nenhuma amostra faltando", enquanto `--intervalo
// 5m` sobre o MESMO arquivo achava dezenas. O caso favorável FICA, rotulado como o que é (não
// regressão do regime fácil), e ao lado dele entraram os adversariais: queda majoritária,
// duas amostras distantes, percentil degenerado em zero e a distinção entre "não dá para
// estimar" e "nada faltou". A pergunta que o caso favorável não fazia é a da constituição: o
// que este verde estaria provando se o código estivesse errado.
//
// A segunda metade do arquivo é `assinaturaDeErro`: com a amostra de banco fora sendo logada
// em `error`, ela ENTRA no relatório de erros, e "o Postgres caiu" e "o pool está entupido"
// colapsavam numa assinatura só (a amostra não tem url, nem err.type, nem statusCode: sobra a
// msg, que é idêntica). As duas pedem providências opostas.
//
// CONTROLE NEGATIVO (conferido revertendo cada um):
//   - volte o percentil para 50 (mediana) e cai a QUEDA MAJORITÁRIA, que é o defeito real;
//   - volte a guarda para contar amostras (`total === 1`) e caem as duas amostras distantes;
//   - tire o filtro de distância zero e cai o percentil degenerado;
//   - devolva 0 em vez de null nos faltantes de `amostra-unica`/`sem-amostras` e caem os dois
//     casos de ausência;
//   - conte o trecho anterior à primeira amostra como faltante e cai o caso do desconhecido;
//   - tire `detalheDeAmostra` da junção de `assinaturaDeErro` e cai o bloco da assinatura;
//   - faça o buraco ler o disco da amostra SEGUINTE e cai "o buraco carrega a leitura da
//     amostra que o ABRE"; devolva zeros em vez de null na ausência e cai "AUSÊNCIA não é
//     zero", que é o alarme invertido.
// A impressão (o terceiro estado, e a premissa dentro da frase tranquilizadora) é guardada à
// parte, em `diag-saude-impressao.test.js`, que dirige o comando de verdade.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseIntervalo, resumirAmostras, assinaturaDeErro, agruparErros, percentil,
} from '../../src/utils/diag-consulta.js';
import { MARCADOR_AMOSTRA } from '../../src/utils/amostra-de-saude.js';

const MIN = 60_000;

/** Uma amostra saudável no instante `time`. O marcador vem do SÍMBOLO, nunca da string. */
const amostra = (time, extra = {}) => ({
  time,
  level: 30,
  amostra: MARCADOR_AMOSTRA,
  msg: 'amostra de saúde',
  banco: { ok: true, ms: 2 },
  ...extra,
});

/** Uma série de `n` amostras espaçadas de `passo`, a partir de `t0`. */
function serie(t0, passo, n, extra = {}) {
  return Array.from({ length: n }, (_, i) => amostra(t0 + i * passo, extra));
}

describe('diag — parseIntervalo', () => {
  it('entende segundo, minuto, hora e dia', () => {
    assert.equal(parseIntervalo('30s'), 30_000);
    assert.equal(parseIntervalo('5m'), 300_000);
    assert.equal(parseIntervalo('1h'), 3_600_000);
    assert.equal(parseIntervalo('2d'), 172_800_000);
  });

  it('RECUSA o número nu, que seria ambíguo com HEALTH_SAMPLE_INTERVAL_MS (em ms)', () => {
    // Quem configurou o amostrador pensa em milissegundos; um número nu aqui só poderia ser
    // lido como segundos. As duas leituras diferem por mil, e a saída inteira é uma conta
    // sobre esse número.
    assert.equal(parseIntervalo('300000'), null);
  });

  it('devolve null no resto do que não entende, em vez de um default calado', () => {
    for (const ruim of ['', null, undefined, '5min', '0s', '-1m', '5 m', 'cinco', '1w']) {
      assert.equal(parseIntervalo(ruim), null, `deveria recusar: ${JSON.stringify(ruim)}`);
    }
  });
});

describe('diag — a série de amostras: as ausências que não são boa notícia', () => {
  it('zero amostra é INSTRUMENTO MUDO, e os números saem null em vez de zero', () => {
    const r = resumirAmostras([], { agora: 1_000_000, inicio: 0 });
    assert.equal(r.situacao, 'sem-amostras');
    assert.equal(r.total, 0);
    assert.equal(r.faltantes, null, 'zero faltantes leria como "nenhuma queda"');
    assert.equal(r.esperadas, null);
    assert.equal(r.intervaloMs, null);
    assert.equal(r.intervaloOrigem, null);
    assert.equal(r.ultima, null);
    assert.equal(r.desdeUltimaMs, null);
    assert.equal(r.ultimaAtrasada, null);
    assert.deepEqual(r.buracos, []);
  });

  it('linha que não é amostra não entra na série', () => {
    const outras = [
      { time: 1, msg: 'request completed', statusCode: 200 },
      { time: 2, amostra: 'outra-coisa' },
      null,
      { time: 3, err: { message: 'x' } },
    ];
    const r = resumirAmostras(outras, { agora: 10, inicio: 0 });
    assert.equal(r.situacao, 'sem-amostras');
    assert.equal(r.total, 0);
  });

  it('UMA amostra só: não dá para afirmar nada sobre buraco, nem com --intervalo', () => {
    const r = resumirAmostras([amostra(1000)], { agora: 601_000, inicio: 0, intervaloMs: 5 * MIN });
    assert.equal(r.situacao, 'amostra-unica');
    assert.equal(r.total, 1);
    assert.equal(r.faltantes, null, 'com uma amostra, "0 faltantes" seria afirmação sem base');
    assert.equal(r.esperadas, null);
    assert.deepEqual(r.buracos, []);
    // O que ela AINDA permite afirmar é o presente: a última amostra é velha demais.
    assert.equal(r.desdeUltimaMs, 600_000);
    assert.equal(r.ultimaAtrasada, true);
  });

  it('amostra sem horário é contada à parte, nunca descartada calada', () => {
    const r = resumirAmostras(
      [...serie(0, MIN, 3), { amostra: MARCADOR_AMOSTRA, msg: 'sem time' }],
      { agora: 2 * MIN, inicio: 0 }
    );
    assert.equal(r.total, 3, 'ela não tem lugar na série');
    assert.equal(r.semHorario, 1, 'mas existe, e some-la encurtaria a série');
  });
});

describe('diag — a série de amostras: intervalo e buracos', () => {
  it('série regular: intervalo INFERIDO, nenhum faltante', () => {
    const r = resumirAmostras(serie(0, 5 * MIN, 10), { agora: 45 * MIN, inicio: 0 });
    assert.equal(r.situacao, 'medida');
    assert.equal(r.total, 10);
    assert.equal(r.intervaloMs, 5 * MIN);
    assert.equal(r.intervaloOrigem, 'inferido');
    assert.equal(r.faltantes, 0);
    assert.equal(r.esperadas, 10);
    assert.deepEqual(r.buracos, []);
    assert.equal(r.maiorBuraco, null);
  });

  it('a deriva do timer não vira buraco (59s e 61s num intervalo de 60s)', () => {
    const instantes = [0, 59_000, 120_000, 181_000, 240_000];
    const r = resumirAmostras(instantes.map((t) => amostra(t)), { agora: 241_000, inicio: 0 });
    // 59 s, e não 60: a estimativa é por POSTO (`percentil`, nearest-rank), então o valor
    // devolvido é uma distância que de fato ocorreu, nunca uma interpolação entre duas. Com o
    // p10 ela é a MENOR das quatro, que é o lado certo para um timer que só atrasa.
    assert.equal(r.intervaloMs, 59_000);
    assert.equal(r.faltantes, 0, 'meia amostra de atraso não é amostra faltando');
  });

  it('NÃO REGRESSÃO: série longa com UM buraco só continua exata', () => {
    // O regime que a versão antiga acertava, agora com o percentil já fora da ponta (com 200
    // distâncias o posto do p10 é 20, não 1). Duzentas amostras de 5 min e um silêncio de 3 h.
    const instantes = [];
    for (let i = 0; i < 120; i += 1) instantes.push(i * 5 * MIN);
    const retomada = instantes[instantes.length - 1] + 3 * 60 * MIN;
    for (let i = 0; i < 80; i += 1) instantes.push(retomada + i * 5 * MIN);
    const r = resumirAmostras(instantes.map((t) => amostra(t)), {
      agora: instantes[instantes.length - 1], inicio: 0,
    });
    assert.equal(r.intervaloMs, 5 * MIN);
    assert.equal(r.estimativaFragil, false, 'com 199 distâncias o p10 tem margem de sobra');
    assert.equal(r.buracos.length, 1);
    assert.equal(r.faltantes, 35, 'três horas a cada 5 min são 36 posições, 35 sem amostra');
  });

  it('o buraco sai com início, fim, duração e quantas faltaram', () => {
    // Dez amostras de minuto em minuto, com as de t=3min e t=4min ausentes.
    const instantes = [0, 1, 2, 5, 6, 7].map((m) => m * MIN);
    const r = resumirAmostras(instantes.map((t) => amostra(t)), { agora: 7 * MIN, inicio: 0 });
    assert.equal(r.intervaloMs, MIN);
    assert.equal(r.buracos.length, 1);
    // `disco` faz parte da FORMA do buraco, e sai `null` porque estas amostras não trazem
    // leitura: a igualdade é exata de propósito, para que um campo novo no buraco tenha de
    // passar por aqui em vez de aparecer calado no relatório.
    assert.deepEqual(r.buracos[0], {
      inicio: 2 * MIN, fim: 5 * MIN, duracaoMs: 3 * MIN, faltantes: 2, disco: null,
    });
    assert.equal(r.faltantes, 2);
    assert.equal(r.esperadas, 8, 'as 6 que existem mais as 2 que faltaram');
    assert.equal(r.maiorBuraco.duracaoMs, 3 * MIN);
  });

  it('o MAIOR buraco é o maior, não o último', () => {
    const instantes = [0, 1, 10, 11, 15].map((m) => m * MIN);
    const r = resumirAmostras(instantes.map((t) => amostra(t)), { agora: 15 * MIN, inicio: 0 });
    assert.equal(r.buracos.length, 2);
    assert.equal(r.maiorBuraco.duracaoMs, 9 * MIN);
    assert.equal(r.maiorBuraco.inicio, 1 * MIN);
  });

  it('REGIME FAVORÁVEL (buraco em MINORIA): acerta, e este caso sozinho não provava nada', () => {
    // Quatro amostras de minuto em minuto e então seis horas de silêncio. As distâncias são
    // [60s, 60s, 60s, 6h]: com o buraco em minoria, mediana e p10 devolvem os mesmos 60s, e
    // era esta a ÚNICA medição adversarial do arquivo até 2026-09-01. Ela segue aqui como não
    // regressão do regime fácil; o regime que importa é o do caso seguinte.
    const instantes = [0, MIN, 2 * MIN, 3 * MIN, 3 * MIN + 360 * MIN];
    const r = resumirAmostras(instantes.map((t) => amostra(t)), { agora: 363 * MIN, inicio: 0 });
    assert.equal(r.intervaloMs, MIN);
    assert.equal(r.faltantes, 359, 'seis horas de silêncio com amostra por minuto');
  });

  it('QUEDA MAJORITÁRIA: 5 min nominal, oito horas reiniciando de hora em hora', () => {
    // O caso OBSERVADO, e o motivo do conserto. O processo reinicia de hora em hora; em três
    // dessas horas ele sobreviveu a um segundo tique de 5 min. Sobram 10 distâncias: TRÊS
    // nominais e SETE buracos, ou seja, o buraco é a maioria. Um estimador central acompanha
    // a queda e a conta de faltantes desaparece; o percentil baixo continua enxergando a
    // cadência, porque um buraco só ALONGA distância.
    const instantes = [];
    for (let h = 0; h < 8; h += 1) {
      instantes.push(h * 60 * MIN);
      if (h === 0 || h === 2 || h === 5) instantes.push(h * 60 * MIN + 5 * MIN);
    }
    const distancias = instantes.slice(1).map((t, i) => t - instantes[i]).sort((a, b) => a - b);

    // Asserção sobre a FIXTURE, para que ela não deslize de volta para o regime fácil sem
    // ninguém notar: é a maioria dos buracos que dá poder a este caso, e a mediana desta série
    // É a mentira que se está prendendo.
    assert.equal(distancias.length, 10);
    assert.equal(distancias.filter((d) => d === 5 * MIN).length, 3, 'nominais em minoria');
    assert.equal(percentil(distancias, 50), 55 * MIN, 'a mediana aqui é um BURACO, não a cadência');

    const r = resumirAmostras(instantes.map((t) => amostra(t)), { agora: 7 * 60 * MIN, inicio: 0 });
    assert.equal(r.intervaloMs, 5 * MIN, 'o p10 continua ancorado na cadência nominal');
    assert.equal(r.intervaloOrigem, 'inferido');
    assert.equal(r.intervaloPercentil, 10);
    assert.equal(r.intervaloBase, 10, 'a saída diz sobre quantas distâncias a premissa se apoia');
    assert.equal(r.faltantes, 74);
    assert.equal(r.esperadas, 85);
    assert.equal(r.buracos.length, 7);
    // Com a mediana o mesmo arquivo dava zero, que é a frase tranquilizadora do defeito.
    const comMediana = instantes.slice(1).reduce(
      (s, t, i) => s + Math.max(0, Math.round((t - instantes[i]) / (55 * MIN)) - 1), 0
    );
    assert.equal(comMediana, 0, 'controle: sob a mediana o incidente inteiro some');
  });

  it('a queda majoritária NÃO é caso de laboratório: p10 atravessa até 90% de buracos', () => {
    // A fronteira é aritmética do nearest-rank, e é ela que se está comprando: pK atravessa
    // até (100 - K)% de distâncias que são buraco. Vinte distâncias, DUAS nominais.
    const nominais = [5 * MIN, 5 * MIN];
    const buracos = Array.from({ length: 18 }, () => 60 * MIN);
    const passos = [...nominais, ...buracos];
    const instantes = [0];
    for (const p of passos) instantes.push(instantes[instantes.length - 1] + p);
    const r = resumirAmostras(instantes.map((t) => amostra(t)), { agora: instantes[instantes.length - 1], inicio: 0 });
    assert.equal(r.intervaloMs, 5 * MIN, '10% de distâncias nominais ainda ancoram o p10');
    assert.equal(r.faltantes, 18 * 11, 'cada hora de silêncio vale onze amostras de 5 min');
  });

  it('--intervalo sobrepõe a inferência, e a saída diz que foi informado', () => {
    // A série tem passo de 1 min; o operador afirma que o amostrador está configurado em
    // 30 s. A conta passa a ser sobre a premissa dele, e a saída precisa dizer isso, senão o
    // número de faltantes é uma conta sobre algo invisível.
    const r = resumirAmostras(serie(0, MIN, 4), { agora: 3 * MIN, inicio: 0, intervaloMs: 30_000 });
    assert.equal(r.intervaloMs, 30_000);
    assert.equal(r.intervaloOrigem, 'informado');
    assert.equal(r.faltantes, 3, 'uma faltando em cada uma das três distâncias');
  });

  it('DUAS AMOSTRAS a seis horas: uma distância só não estima nada (a guarda conta DISTÂNCIA)', () => {
    // A farpa do defeito: a guarda antiga contava AMOSTRAS, e duas amostras são duas, então a
    // série passava por "medida". Só que duas amostras dão UMA distância, e uma distância
    // dividida por si mesma dá zero faltantes por aritmética pura, sem que nada avise. Era o
    // "nada faltou" de uma janela em que só houve silêncio.
    const r = resumirAmostras([amostra(0), amostra(6 * 60 * MIN)], { agora: 6 * 60 * MIN, inicio: 0 });
    assert.equal(r.situacao, 'medida', 'a série existe: o que falta é base para ESTIMAR');
    assert.equal(r.distancias, 1);
    assert.equal(r.distanciasUteis, 1);
    assert.equal(r.intervaloMs, null, 'estimar a partir de uma distância é circular');
    assert.equal(r.intervaloOrigem, null);
    assert.equal(r.faltantes, null, 'zero aqui seria a afirmação tranquilizadora do defeito');
    assert.equal(r.esperadas, null);
    assert.equal(r.ultimaAtrasada, null, 'sem intervalo não há como julgar atraso');
  });

  it('as MESMAS duas amostras, com --intervalo, viram uma contagem de verdade', () => {
    // A premissa passa a ser declarada por quem pergunta, então a conta é legítima. É por isso
    // que a saída manda passar --intervalo em vez de arriscar um palpite.
    const r = resumirAmostras([amostra(0), amostra(6 * 60 * MIN)], {
      agora: 6 * 60 * MIN, inicio: 0, intervaloMs: 5 * MIN,
    });
    assert.equal(r.intervaloOrigem, 'informado');
    assert.equal(r.faltantes, 71, 'seis horas a cada 5 min são 72 posições, 71 sem amostra');
    assert.equal(r.esperadas, 73);
  });

  it('PERCENTIL DEGENERADO EM ZERO: carimbo repetido não é cadência', () => {
    // Quatro linhas no mesmo milissegundo. Com as distâncias zero na base, o percentil devolve
    // 0, e intervalo 0 não é intervalo: `faltantes` e `maiorBuraco` saíam null e o comando
    // imprimia "FALTARAM null" antes de desreferenciar o nulo e sair com código 1.
    const r = resumirAmostras(serie(1000, 0, 4), { agora: 1000, inicio: 0 });
    // A consequência vem PRIMEIRO, para que reverter o filtro de zero acuse o que importa (o
    // intervalo degenerado) em vez de acusar só a contagem de um campo de relatório.
    assert.equal(r.intervaloMs, null, 'nunca 0: um intervalo de zero não é um intervalo');
    assert.equal(r.faltantes, null);
    assert.equal(r.maiorBuraco, null);
    assert.equal(r.situacao, 'medida');
    assert.equal(r.distancias, 3);
    assert.equal(r.distanciasUteis, 0);
  });

  it('distância zero sai da ESTIMATIVA sem sair da série', () => {
    // Duas linhas gêmeas no meio de uma cadência de 5 min. O zero não pode ancorar o
    // percentil, e também não pode virar buraco nem sumir da contagem de amostras.
    const instantes = [0, 5 * MIN, 5 * MIN, 10 * MIN, 15 * MIN, 20 * MIN];
    const r = resumirAmostras(instantes.map((t) => amostra(t)), { agora: 20 * MIN, inicio: 0 });
    assert.equal(r.total, 6);
    assert.equal(r.distancias, 5);
    assert.equal(r.distanciasUteis, 4);
    assert.equal(r.intervaloMs, 5 * MIN);
    assert.equal(r.faltantes, 0);
  });

  it('"não dá para estimar" e "nada faltou" são desfechos DIFERENTES, não sinônimos', () => {
    // A distinção é o conserto inteiro: os dois terminam sem buraco na lista, e só um deles
    // afirma alguma coisa. Quem imprimir os dois como zero volta a mentir.
    const semBase = resumirAmostras([amostra(0), amostra(6 * 60 * MIN)], { agora: 6 * 60 * MIN, inicio: 0 });
    const medido = resumirAmostras(serie(0, 5 * MIN, 12), { agora: 55 * MIN, inicio: 0 });

    assert.deepEqual(semBase.buracos, []);
    assert.deepEqual(medido.buracos, []);
    assert.equal(semBase.faltantes, null, 'em aberto');
    assert.equal(medido.faltantes, 0, 'medido, e sobre premissa declarada');
    assert.notEqual(semBase.faltantes, medido.faltantes);
    assert.equal(semBase.intervaloMs, null);
    assert.equal(medido.intervaloMs, 5 * MIN);
  });

  it('a saída diz o quanto a estimativa se sustenta (`estimativaFragil`)', () => {
    // Abaixo de dez distâncias o posto do p10 é 1: a estimativa É a menor distância, e um
    // único reinício rápido decide o número. Isso não é motivo para calar, é motivo para
    // dizer. Acima disso o percentil volta a ter margem.
    const poucas = resumirAmostras(serie(0, 5 * MIN, 5), { agora: 20 * MIN, inicio: 0 });
    assert.equal(poucas.intervaloBase, 4);
    assert.equal(poucas.estimativaFragil, true);

    const muitas = resumirAmostras(serie(0, 5 * MIN, 30), { agora: 145 * MIN, inicio: 0 });
    assert.equal(muitas.intervaloBase, 29);
    assert.equal(muitas.estimativaFragil, false);

    const informada = resumirAmostras(serie(0, 5 * MIN, 5), { agora: 20 * MIN, inicio: 0, intervaloMs: 5 * MIN });
    assert.equal(informada.estimativaFragil, null, 'não se aplica: a premissa é de quem perguntou');
    assert.equal(informada.intervaloPercentil, null);
  });

  it('registros fora de ordem não inventam buraco', () => {
    const fora = [3, 0, 2, 1].map((m) => amostra(m * MIN));
    const r = resumirAmostras(fora, { agora: 3 * MIN, inicio: 0 });
    assert.equal(r.faltantes, 0);
    assert.equal(r.primeira, 0);
    assert.equal(r.ultima, 3 * MIN);
  });
});

describe('diag — o disco da amostra, que desfaz a ambiguidade do buraco', () => {
  // Um buraco na série tem DUAS causas e uma assinatura só: o processo morreu, ou o volume do
  // log encheu e `log-diario.js` desligou o destino de arquivo com o processo vivo. A única
  // testemunha possível é a amostra ANTERIOR ao buraco, porque a que falta não existe.
  const comDisco = (t, livreMb) => amostra(t, { disco: { livreMb, totalMb: 20_480 } });

  it('o buraco carrega a leitura da amostra que o ABRE, não a da seguinte', () => {
    // As três leituras são distintas de propósito: ler a errada passaria despercebido se elas
    // fossem iguais, que é como um teste de campo carimbado não prova nada.
    const registros = [comDisco(0, 900), comDisco(MIN, 512), comDisco(11 * MIN, 64), comDisco(12 * MIN, 60)];
    const r = resumirAmostras(registros, { agora: 12 * MIN, inicio: 0 });
    assert.equal(r.buracos.length, 1);
    assert.equal(r.buracos[0].inicio, MIN);
    assert.deepEqual(r.buracos[0].disco, { livreMb: 512, totalMb: 20_480 }, 'a véspera do silêncio');
  });

  it('AUSÊNCIA não é zero, e não é "disco ok"', () => {
    // Zero byte livre é o valor mais ALARMANTE que o campo carrega, então converter ausência
    // em zero inverteria o alarme. O campo é novo: a maioria das linhas do log não o tem.
    const r = resumirAmostras([amostra(0), amostra(MIN), amostra(11 * MIN)], { agora: 11 * MIN, inicio: 0 });
    assert.equal(r.buracos.length, 1);
    assert.equal(r.buracos[0].disco, null, 'null, nunca {livreMb: 0}');
    assert.equal(r.amostrasComDisco, 0);
    assert.equal(r.discoNaUltima, null);
  });

  it('`amostrasComDisco` separa "a janela não tem o campo" de "faltou naquela amostra"', () => {
    // Os dois casos imprimem coisas diferentes: um é nota geral sobre a janela, o outro é uma
    // lacuna pontual. Sem esta contagem o relatório não tem como distingui-los.
    const registros = [comDisco(0, 900), amostra(MIN), comDisco(11 * MIN, 64)];
    const r = resumirAmostras(registros, { agora: 11 * MIN, inicio: 0 });
    assert.equal(r.amostrasComDisco, 2);
    assert.equal(r.buracos[0].disco, null, 'a amostra que abre o buraco não trouxe leitura');
    assert.deepEqual(r.discoNaUltima, { livreMb: 64, totalMb: 20_480 });
  });

  it('forma inesperada de `disco` não vira leitura (a linha vem de arquivo, não da função)', () => {
    // O que chega aqui saiu de `JSON.parse` de uma linha em disco: build anterior ao campo,
    // outro produtor, edição à mão. Aceitar o que não é par de números publicaria
    // "undefined MB livres" no meio de um incidente.
    for (const ruim of [5, 'cheio', [], { livreMb: 512 }, { livreMb: '512', totalMb: 20_480 }, { livreMb: NaN, totalMb: 1 }, null]) {
      const r = resumirAmostras(
        [amostra(0, { disco: ruim }), amostra(MIN, { disco: ruim }), amostra(11 * MIN)],
        { agora: 11 * MIN, inicio: 0 }
      );
      assert.equal(r.amostrasComDisco, 0, `deveria recusar: ${JSON.stringify(ruim)}`);
      assert.equal(r.buracos[0].disco, null);
    }
  });

  it('zero livre É uma leitura legítima, e a mais alarmante que o campo carrega', () => {
    const r = resumirAmostras([comDisco(0, 900), comDisco(MIN, 0), comDisco(11 * MIN, 0)], { agora: 11 * MIN, inicio: 0 });
    assert.deepEqual(r.buracos[0].disco, { livreMb: 0, totalMb: 20_480 }, 'zero é medição, não ausência');
    assert.equal(r.amostrasComDisco, 3);
  });

  it('a ordenação não desalinha leitura e instante', () => {
    // Os pontos são ordenados como PARES; um vetor paralelo se desalinharia aqui, e é o tipo
    // de erro que não aparece na saída, só troca um número por outro plausível.
    const foraDeOrdem = [comDisco(11 * MIN, 64), comDisco(0, 900), comDisco(MIN, 512)];
    const r = resumirAmostras(foraDeOrdem, { agora: 11 * MIN, inicio: 0 });
    assert.deepEqual(r.buracos[0].disco, { livreMb: 512, totalMb: 20_480 });
  });

  it('NADA de fração, faixa ou rótulo: sai o que a amostra registrou', () => {
    // Limiar escolhido sem distribuição observada é palpite com cara de medição. O contrato é
    // o par de números, e uma chave a mais aqui seria um juízo embutido no relatório.
    const r = resumirAmostras([comDisco(0, 900), comDisco(MIN, 512), comDisco(11 * MIN, 64)], { agora: 11 * MIN, inicio: 0 });
    assert.deepEqual(Object.keys(r.buracos[0].disco).sort(), ['livreMb', 'totalMb']);
  });
});

describe('diag — a série de amostras: o desconhecido e o presente', () => {
  it('o trecho ANTES da primeira amostra é desconhecido, não faltante', () => {
    // Janela de 24 h, processo que subiu há 10 min: contar o começo como ausência inventaria
    // uma queda a cada deploy.
    const inicio = 0;
    const r = resumirAmostras(serie(24 * 60 * MIN - 10 * MIN, MIN, 10), {
      agora: 24 * 60 * MIN, inicio,
    });
    assert.equal(r.faltantes, 0, 'nada faltou entre as amostras que existem');
    assert.equal(r.desconhecidoAntesMs, 24 * 60 * MIN - 10 * MIN);
    assert.equal(r.buracos.length, 0, 'o desconhecido não vira buraco na lista');
  });

  it('a distância até AGORA é campo próprio e não entra na lista de buracos', () => {
    const r = resumirAmostras(serie(0, MIN, 5), { agora: 4 * MIN + 10 * MIN, inicio: 0 });
    assert.equal(r.desdeUltimaMs, 10 * MIN);
    assert.equal(r.ultimaAtrasada, true, 'passou do intervalo: pode estar fora AGORA');
    assert.equal(r.faltantes, 0, 'o presente não é um buraco medido entre duas amostras');
  });

  it('última amostra dentro do intervalo não é atraso', () => {
    const r = resumirAmostras(serie(0, MIN, 5), { agora: 4 * MIN + 20_000, inicio: 0 });
    assert.equal(r.ultimaAtrasada, false);
  });

  it('as amostras que falharam e as de banco fora são contadas à parte', () => {
    const registros = [
      ...serie(0, MIN, 2),
      amostra(2 * MIN, { level: 50, banco: { ok: false, ms: 5000, motivo: 'prazo' } }),
      amostra(3 * MIN, { level: 50, banco: { ok: false, ms: 12, motivo: 'erro' } }),
      { time: 4 * MIN, level: 50, amostra: MARCADOR_AMOSTRA, falhou: true, err: { message: 'x' } },
    ];
    const r = resumirAmostras(registros, { agora: 4 * MIN, inicio: 0 });
    assert.equal(r.total, 5, 'a que falhou continua na série: ela prova que o processo vivia');
    assert.equal(r.faltantes, 0);
    assert.equal(r.bancoFora, 2);
    assert.equal(r.falhasDoAmostrador, 1);
  });
});

describe('diag — a assinatura separa os desfechos da amostra de saúde', () => {
  const prazo = amostra(1, { level: 50, banco: { ok: false, ms: 5000, motivo: 'prazo' } });
  const erro = amostra(2, { level: 50, banco: { ok: false, ms: 9, motivo: 'erro', erro: 'ECONNREFUSED' } });

  it('"pool entupido" e "Postgres caiu" NÃO compartilham assinatura', () => {
    const a = assinaturaDeErro(prazo);
    const b = assinaturaDeErro(erro);
    assert.notEqual(a, b, 'as duas pedem providências opostas');
    assert.match(a, /prazo/);
    assert.match(b, /erro/);
  });

  it('e por isso o relatório mostra DOIS grupos, não um com contagem somada', () => {
    const grupos = agruparErros([prazo, erro, prazo, erro, erro]);
    assert.equal(grupos.length, 2);
    assert.deepEqual(grupos.map((g) => g.total).sort(), [2, 3]);
  });

  it('a falha do PRÓPRIO amostrador é uma terceira assinatura', () => {
    const falhou = { time: 3, level: 50, amostra: MARCADOR_AMOSTRA, falhou: true, msg: 'amostra de saúde falhou' };
    const assinatura = assinaturaDeErro(falhou);
    assert.match(assinatura, /amostrador falhou/);
    assert.notEqual(assinatura, assinaturaDeErro(prazo));
  });

  it('banco fora sem motivo declarado se anuncia como tal, em vez de virar a linha saudável', () => {
    const semMotivo = amostra(4, { level: 50, banco: { ok: false, ms: 1 } });
    assert.match(assinaturaDeErro(semMotivo), /motivo não declarado/);
  });

  it('NÃO REGRESSÃO: a assinatura de quem não é amostra continua idêntica', () => {
    // O caso HTTP completo, o erro sem rota e a amostra SAUDÁVEL (que nem chega ao relatório,
    // mas cuja assinatura não pode mudar de forma por causa do campo novo).
    assert.equal(
      assinaturaDeErro({
        url: '/api/v1/atlas/0720562f-9054-4de8-9bd1-49543c203c9e/sync',
        method: 'POST',
        statusCode: 400,
        err: { type: 'ValidationError', message: 'corpo inválido' },
      }),
      'POST /api/v1/atlas/:id/sync | ValidationError | corpo inválido [400]'
    );
    assert.equal(
      assinaturaDeErro({ level: 50, msg: 'sweep do WS falhou' }),
      'sweep do WS falhou'
    );
    assert.equal(assinaturaDeErro(amostra(5)), 'amostra de saúde');
  });
});
