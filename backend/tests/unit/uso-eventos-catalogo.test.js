// Path: tests/unit/uso-eventos-catalogo.test.js
/**
 * @fileoverview O ESPELHO do vocabulário de uso, e as decisões PURAS do lote.
 *
 * ESTE É O LADO DO SERVIDOR DE UM ESPELHO DE DOIS LADOS. `src/modules/uso/eventos-de-uso.js`
 * e `frontend/src/js/session/eventos-de-uso.js` carregam a MESMA lista, e o par de testes é
 * que a mantém uma só: o de lá importa os dois arquivos e os compara termo a termo, e este
 * prende o lado de cá contra números de controle ABSOLUTOS. Só o teste de comparação seria
 * insuficiente, e a razão é a de sempre: duas cópias erradas do mesmo jeito passam num teste
 * que só as compara entre si.
 *
 * CONTROLE NEGATIVO (o que fica vermelho ao reverter cada peça):
 *  - reordenar `EVENTOS_DE_USO`: a asserção da lista inteira, em ordem, reprova (e o teste do
 *    frontend também, porque a ordem é contrato do CHECK);
 *  - trocar o `null` de `ferramenta.ativada` por `[]`: o caso do qualificador livre passa a
 *    recusar todo id de ferramenta, e é justamente a confusão entre "livre" e "nenhum" que o
 *    cabeçalho do espelho existe para impedir;
 *  - tirar a apara do futuro de `instantesDoLote`: o caso do relógio adiantado deixa passar um
 *    instante que nenhuma poda alcança;
 *  - tirar o PISO de `instantesDoLote`: o caso do lote de 400 dias passa a escrever uma linha
 *    permanente em duas tabelas que ninguém poda;
 *  - trocar o `Math.min(inicio, ultimo)` por `Math.min(inicio, agoraMs)`: o caso dos DOIS no
 *    futuro passa a devolver `inicio > ultimoSinal`, ou seja duração negativa.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVENTOS_DE_USO, PROPS_PERMITIDAS, PAGINAS } from '../../src/modules/uso/eventos-de-uso.js';
import {
  propAceita, instantesDoLote, devePassar, FORMA_DE_PROP_LIVRE, RETENCAO_PADRAO_DIAS,
} from '../../src/modules/uso/uso.lote.js';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** A migração que declara os CHECK. O espelho do banco é ela, e não outra cópia aqui. */
const MIGRACAO = fs.readFileSync(
  path.join(RAIZ, 'src/database/migrations/020_uso_de_produto.sql'), 'utf8'
);

describe('O vocabulário de uso: espelho, forma e ordem', () => {
  it('os treze eventos estão na ordem do contrato, congelados', () => {
    assert.deepEqual(EVENTOS_DE_USO, [
      'pagina.vista',
      'atlas.aberto',
      'ferramenta.ativada',
      'medicao.aberta',
      'visualizador3d.aberto',
      'visualizador360.aberto',
      'primeira-pessoa.aberto',
      'briefing.apresentado',
      'temporal.ativado',
      'pdf.exportado',
      'ebgeo.exportado',
      'ebgeo.importado',
      'indisponivel.visto',
    ]);
    assert.equal(EVENTOS_DE_USO.length, 13);
    assert.ok(Object.isFrozen(EVENTOS_DE_USO), 'a lista precisa ser congelada');
    assert.equal(new Set(EVENTOS_DE_USO).size, 13, 'evento duplicado');
  });

  it('as quatro páginas são as quatro entradas HTML do produto, congeladas', () => {
    assert.deepEqual(PAGINAS, ['mapa', 'atlas', 'admin', 'calibracao']);
    assert.ok(Object.isFrozen(PAGINAS));
  });

  it('PROPS_PERMITIDAS cobre TODOS os eventos e só eles, com os três estados distintos', () => {
    assert.deepEqual(
      Object.keys(PROPS_PERMITIDAS).sort(),
      [...EVENTOS_DE_USO].sort(),
      'a tabela de qualificadores precisa ter uma entrada por evento, sem sobra e sem falta'
    );
    assert.ok(Object.isFrozen(PROPS_PERMITIDAS));

    // Os TRÊS estados, nomeados: lista fechada, lista vazia (proibido) e `null` (livre).
    assert.deepEqual(PROPS_PERMITIDAS['atlas.aberto'], ['local', 'servidor', 'publico']);
    assert.deepEqual(PROPS_PERMITIDAS['pdf.exportado'], ['folha', 'mosaico']);
    assert.equal(PROPS_PERMITIDAS['ferramenta.ativada'], null,
      '`null` significa LIVRE, e trocá-lo por [] recusaria todo id de ferramenta');

    // E TODOS os demais são a lista vazia. Um `undefined` aqui seria indistinguível de `[]`
    // num teste de veracidade, e é por isso que a asserção é sobre o valor exato.
    const semQualificador = EVENTOS_DE_USO
      .filter((e) => !['atlas.aberto', 'pdf.exportado', 'ferramenta.ativada'].includes(e));
    assert.equal(semQualificador.length, 10);
    for (const e of semQualificador) {
      assert.deepEqual(PROPS_PERMITIDAS[e], [], `${e} deveria não aceitar qualificador`);
    }
  });

  it('o CHECK da migração declara EXATAMENTE os treze eventos e as quatro páginas', () => {
    // O ESPELHO DO BANCO. A lista vive duas vezes (aqui e no CHECK) porque as duas pontas
    // recusam em momentos diferentes: o Joi com 422 nomeando o campo, o CHECK com 23514 mesmo
    // que alguém escreva por outro caminho. Sem este caso, valor novo entraria no JS e a
    // escrita morreria no banco, com uma mensagem sem relação aparente com o assunto.
    assert.equal(EVENTOS_DE_USO.length, 13, 'laço sobre lista vazia seria zero asserções');
    for (const evento of EVENTOS_DE_USO) {
      assert.ok(
        MIGRACAO.includes(`'${evento}'`),
        `o CHECK de uso_eventos_dia.evento não declara '${evento}'`
      );
    }
    // A direção inversa: o CHECK não pode declarar valor que o espelho não tem. A regex pega a
    // lista literal do CHECK de evento, que é a única do arquivo com mais de dez termos.
    const bloco = MIGRACAO.match(/uso_eventos_dia_evento_check CHECK \(evento IN \(([\s\S]*?)\)\)/);
    assert.ok(bloco, 'o CHECK de evento mudou de forma e este espelho parou de olhar para ele');
    const doCheck = [...bloco[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    assert.deepEqual(doCheck, [...EVENTOS_DE_USO], 'o CHECK e o espelho divergiram');

    assert.equal(PAGINAS.length, 4, 'laço sobre lista vazia seria zero asserções');
    for (const pagina of PAGINAS) {
      assert.ok(MIGRACAO.includes(`'${pagina}'`), `o CHECK de página não declara '${pagina}'`);
    }
  });
});

describe('propAceita: os três estados do qualificador', () => {
  it('vazio e ausente são SEMPRE aceitos, inclusive no evento de lista fechada', () => {
    // A decisão está no espelho: a linha sem qualificador é o TOTAL daquele gesto, que
    // continua sendo uma contagem verdadeira. Recusá-la faria um cliente que não soube
    // qualificar perder o lote inteiro.
    assert.equal(EVENTOS_DE_USO.length, 13, 'laço sobre lista vazia seria zero asserções');
    for (const evento of EVENTOS_DE_USO) {
      assert.deepEqual(propAceita(evento, ''), { ok: true }, `${evento} com prop vazia`);
      assert.deepEqual(propAceita(evento, undefined), { ok: true }, `${evento} sem prop`);
      assert.deepEqual(propAceita(evento, null), { ok: true }, `${evento} com prop nula`);
    }
  });

  it('lista fechada aceita os valores dela e recusa o inventado, NOMEANDO o motivo', () => {
    assert.deepEqual(propAceita('atlas.aberto', 'local'), { ok: true });
    assert.deepEqual(propAceita('atlas.aberto', 'servidor'), { ok: true });
    assert.deepEqual(propAceita('atlas.aberto', 'publico'), { ok: true });
    assert.deepEqual(propAceita('atlas.aberto', 'nuvem'), { ok: false, motivo: 'desconhecida' });
    assert.deepEqual(propAceita('pdf.exportado', 'mosaico'), { ok: true });
    assert.deepEqual(propAceita('pdf.exportado', 'a3'), { ok: false, motivo: 'desconhecida' });
    // Sensível a caixa de propósito: o agrupamento é por string, e 'Local' viraria uma
    // segunda linha para o mesmo fato.
    assert.deepEqual(propAceita('atlas.aberto', 'Local'), { ok: false, motivo: 'desconhecida' });
  });

  it('lista VAZIA recusa qualquer qualificador, com motivo próprio', () => {
    assert.deepEqual(propAceita('medicao.aberta', 'x'), { ok: false, motivo: 'proibida' });
    assert.deepEqual(propAceita('indisponivel.visto', 'boot'), { ok: false, motivo: 'proibida' });
    // O motivo é DIFERENTE do de lista fechada, e essa distinção é o que faz a mensagem de
    // 422 dizer coisas diferentes: "não aceita qualificador" e "fora da lista" mandam a
    // pessoa consertar coisas diferentes.
    assert.notEqual(
      propAceita('medicao.aberta', 'x').motivo,
      propAceita('atlas.aberto', 'x').motivo
    );
  });

  it('o LIVRE aceita a forma e recusa o resto, inclusive o que casaria por acidente', () => {
    assert.deepEqual(propAceita('ferramenta.ativada', 'point_tool'), { ok: true });
    assert.deepEqual(propAceita('ferramenta.ativada', 'military-symbol'), { ok: true });
    assert.deepEqual(propAceita('ferramenta.ativada', 'a'), { ok: true });
    assert.deepEqual(propAceita('ferramenta.ativada', 'a'.repeat(40)), { ok: true });
    assert.deepEqual(propAceita('ferramenta.ativada', 'a'.repeat(41)), { ok: false, motivo: 'forma' });
    assert.deepEqual(propAceita('ferramenta.ativada', 'Point_Tool'), { ok: false, motivo: 'forma' });
    assert.deepEqual(propAceita('ferramenta.ativada', 'ponto tool'), { ok: false, motivo: 'forma' });
    assert.deepEqual(propAceita('ferramenta.ativada', 'ponto;drop'), { ok: false, motivo: 'forma' });
    // A ÂNCORA DA REGEX, sem a qual `\n` no fim passaria: `$` casa antes de uma quebra final.
    assert.deepEqual(propAceita('ferramenta.ativada', 'ponto\n'), { ok: false, motivo: 'forma' });
    assert.ok(FORMA_DE_PROP_LIVRE.test('ponto-3'), 'a forma precisa aceitar hífen e dígito');
  });

  it('evento fora do vocabulário não é acolhido pela regra do qualificador', () => {
    // A borda de verdade é o `valid()` do Joi; aqui o que se prende é que esta função não
    // devolve `ok` para um evento que não existe, senão ela seria uma segunda porta.
    assert.deepEqual(propAceita('inventado', 'x'), { ok: false, motivo: 'desconhecida' });
  });
});

describe('instantesDoLote: o relógio do cliente preso à janela do servidor', () => {
  const AGORA = 1_800_000_000_000;
  const DIA = 86_400_000;
  const RETENCAO = 30;
  const PISO = AGORA - RETENCAO * DIA;

  it('o caso normal atravessa intacto', () => {
    const r = instantesDoLote({ inicio: AGORA - 60_000, ultimoSinal: AGORA - 1_000 }, AGORA, RETENCAO);
    assert.equal(r.inicio.getTime(), AGORA - 60_000);
    assert.equal(r.ultimoSinal.getTime(), AGORA - 1_000);
  });

  it('o FUTURO é aparado, porque é ele que cria linha que nenhuma poda alcança', () => {
    const r = instantesDoLote(
      { inicio: AGORA - 60_000, ultimoSinal: AGORA + 86_400_000 }, AGORA, RETENCAO
    );
    assert.equal(r.ultimoSinal.getTime(), AGORA, 'o sinal não pode ser posterior a agora');
    assert.equal(r.inicio.getTime(), AGORA - 60_000, 'o início legítimo não se move');
  });

  it('com os DOIS no futuro, o início cai no sinal APARADO e não em agora', () => {
    // É o caso que separa `Math.min(inicio, ultimo)` de `Math.min(inicio, agoraMs)`: com a
    // segunda forma, um lote inteiramente no futuro devolveria início e sinal ambos em
    // `agora`, o que por acaso funciona aqui, mas com `inicio` MAIOR que `ultimoSinal` no
    // corpo produziria duração negativa. Este caso prende a ordem das aparas.
    const r = instantesDoLote({ inicio: AGORA + 20_000, ultimoSinal: AGORA + 10_000 }, AGORA, RETENCAO);
    assert.equal(r.ultimoSinal.getTime(), AGORA);
    assert.equal(r.inicio.getTime(), AGORA);
    assert.ok(r.inicio.getTime() <= r.ultimoSinal.getTime(), 'duração nunca pode ser negativa');
  });

  it('o início posterior ao sinal é puxado para o sinal, e a duração fica zero', () => {
    const r = instantesDoLote({ inicio: AGORA - 1_000, ultimoSinal: AGORA - 5_000 }, AGORA, RETENCAO);
    assert.equal(r.inicio.getTime(), AGORA - 5_000);
    assert.equal(r.ultimoSinal.getTime(), AGORA - 5_000);
  });

  it('o passado DENTRO da retenção atravessa: o lote offline é legítimo', () => {
    // Aparar isto quebraria a fila offline, que chega horas ou dias depois do gesto e é o caso
    // que a rota existe para servir. É o par positivo do piso, e sem ele um piso que apagasse
    // tudo passaria neste arquivo.
    const antigo = AGORA - 29 * DIA;
    const r = instantesDoLote({ inicio: antigo, ultimoSinal: antigo + 1_000 }, AGORA, RETENCAO);
    assert.equal(r.inicio.getTime(), antigo);
    assert.equal(r.ultimoSinal.getTime(), antigo + 1_000);
  });

  it('o passado ALÉM da retenção cai no PISO, nos dois instantes', () => {
    // 400 dias atrás. Sem o piso, isto escreveria uma linha em `uso_eventos_dia` e outra em
    // `uso_diario` num dia que nenhuma poda alcança, porque as duas tabelas não são podadas.
    const remoto = AGORA - 400 * DIA;
    const r = instantesDoLote({ inicio: remoto, ultimoSinal: remoto + 1_000 }, AGORA, RETENCAO);
    assert.equal(r.ultimoSinal.getTime(), PISO);
    assert.equal(r.inicio.getTime(), PISO, 'o início também, senão a duração vira décadas');
  });

  it('a fronteira do piso é inclusiva, e um milissegundo antes dela já é aparado', () => {
    const noPiso = instantesDoLote({ inicio: PISO, ultimoSinal: PISO }, AGORA, RETENCAO);
    assert.equal(noPiso.ultimoSinal.getTime(), PISO, 'exatamente no piso, nada se move');

    const antesDoPiso = instantesDoLote({ inicio: PISO - 1, ultimoSinal: PISO - 1 }, AGORA, RETENCAO);
    assert.equal(antesDoPiso.ultimoSinal.getTime(), PISO);
  });

  it('retenção torta NÃO desliga o piso: ela cai no padrão de trinta dias', () => {
    // Um piso que desaparece com um erro de digitação no ambiente não é um piso. O padrão
    // repete o de `LOG_RETENTION_DAYS` porque este módulo é folha e não importa `config`.
    assert.equal(RETENCAO_PADRAO_DIAS, 30);
    const remoto = AGORA - 400 * DIA;
    const esperado = AGORA - RETENCAO_PADRAO_DIAS * DIA;
    const tortas = [0, -5, NaN, Infinity, undefined, null, 'trinta'];
    assert.equal(tortas.length, 7, 'laço sobre lista vazia seria zero asserções');
    for (const torta of tortas) {
      const r = instantesDoLote({ inicio: remoto, ultimoSinal: remoto }, AGORA, torta);
      assert.equal(r.ultimoSinal.getTime(), esperado, `retenção ${String(torta)}`);
    }
  });
});

describe('devePassar: a guarda da manutenção oportunista', () => {
  const base = { agoraMs: 1_000_000, ultimaPassadaEm: 0, intervaloMs: 3_600_000, emTeste: false };

  it('em teste NUNCA passa, e o motivo é nomeado', () => {
    assert.deepEqual(devePassar({ ...base, emTeste: true }), { passar: false, motivo: 'teste' });
  });

  it('a PRIMEIRA passada roda na primeira escrita depois do boot', () => {
    // Sem isto, um processo que sobe, recebe um lote e cai nunca teria agregado nada.
    assert.deepEqual(devePassar(base), { passar: true });
  });

  it('dentro do intervalo NÃO passa; passado o intervalo, passa', () => {
    assert.deepEqual(
      devePassar({ ...base, ultimaPassadaEm: base.agoraMs - 1_000 }),
      { passar: false, motivo: 'intervalo' }
    );
    // A fronteira exata: `agora - ultima === intervalo` já passa.
    assert.deepEqual(
      devePassar({ ...base, agoraMs: 3_600_001, ultimaPassadaEm: 1 }),
      { passar: true }
    );
  });

  it('intervalo inválido não vira passada infinita', () => {
    for (const intervaloMs of [0, -1, NaN, Infinity, undefined]) {
      assert.deepEqual(
        devePassar({ ...base, ultimaPassadaEm: 1, intervaloMs }),
        { passar: false, motivo: 'intervalo-invalido' },
        `intervalo ${intervaloMs}`
      );
    }
  });
});
