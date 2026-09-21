// Path: tests/unit/presenca-temporal-nao-volta.test.js
//
// GUARDA ESTRUTURAL da remoção do quadro de presença da linha do tempo (dono, 2026-09-21).
//
// O QUE ELA IMPEDE NÃO É UM BUG, É UMA VOLTA. Até esta data o módulo de colaboração tinha um
// tratador do quadro (`handleTemporal`), um schema próprio, um ramo no roteamento de mensagem do
// gateway, um campo retido no socket e uma chave no retrato que `getRoomUsers` monta. O dono
// decidiu que o instante de uma pessoa NÃO se propaga; as cinco peças saíram.
//
// POR QUE ELA EXISTE AO LADO DO CASO DE COMPORTAMENTO. `tests/ws/presenca-temporal-removida.test.js`
// afirma o efeito ponta a ponta, com piso de cursor. Mas uma volta PARCIAL não produz efeito
// algum e por isso não reprova lá: repor o schema sozinho, ou o campo retido no socket sem o
// tratador, deixa tudo verde e a metade religada esperando a outra. Uma varredura por SÍMBOLO
// reprova a primeira linha de qualquer metade.
//
// O QUE ELA NÃO ALCANÇA, declarado: é varredura por TEXTO, com comentário removido, então um
// despacho por string dinâmica ou por tabela indexada escapa. O modo provável de a
// funcionalidade voltar é alguém copiar o bloco vizinho de `selection` e trocar a palavra, e
// contra isso ela pega.
//
// O gêmeo do cliente é `frontend/tests/unit/presenca-temporal-nao-volta.test.js`.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..', '..');
const PASTA_COLLAB = path.join(RAIZ, 'src', 'modules', 'collab');

/**
 * Os símbolos da funcionalidade removida, cada um a PRIMEIRA linha de uma das peças: o tratador,
 * o schema, o campo retido no socket, a chave do retrato e o tipo do quadro no fio.
 */
const SIMBOLOS_PROIBIDOS = Object.freeze([
  'handleTemporal',
  'temporalPresenceSchema',
  'MAX_TEMPORAL_STATE_BYTES',
  'temporalState',
  "'temporal'",
]);

/**
 * Comentário fora: a decisão está ESCRITA em comentário em quatro destes arquivos, e um guarda
 * que acusasse a própria explicação obrigaria a apagá-la.
 * @param {string} src
 * @returns {string}
 */
function semComentarios(src) {
  const normalizado = src.replace(/\r\n?/g, '\n');
  const semBloco = normalizado.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  return semBloco.split('\n').map((linha) => linha.replace(/\/\/.*/, '')).join('\n');
}

/** Todo `.js` do módulo de colaboração. */
function arquivosDoModulo() {
  return fs.readdirSync(PASTA_COLLAB)
    .filter((nome) => nome.endsWith('.js'))
    .map((nome) => path.join(PASTA_COLLAB, nome));
}

const lerCodigo = (arquivo) => semComentarios(fs.readFileSync(arquivo, 'utf8'));

describe('o quadro temporal de presença não volta (guarda estrutural)', () => {
  const arquivos = arquivosDoModulo();

  it('PISO: a varredura enxerga o módulo e o código vivo dele', () => {
    // Sem este caso, errar o caminho da pasta ou fazer `semComentarios` devolver vazio produziria
    // zero achados e um verde que não prova nada. O piso exige os arquivos E os vizinhos VIVOS do
    // quadro removido, que são o cursor e a seleção.
    assert.ok(arquivos.length >= 4, `o módulo precisa existir; vieram ${arquivos.length} arquivos`);
    const corpo = arquivos.map(lerCodigo).join('\n');
    for (const vivo of ['handleCursor', 'handleSelection', 'cursorPresenceSchema', "'selection'"]) {
      assert.ok(corpo.includes(vivo), `o piso não achou \`${vivo}\`: a varredura está lendo o lugar errado`);
    }
  });

  it('nenhum arquivo de src/modules/collab/ cita os símbolos removidos', () => {
    const acusados = [];
    for (const arquivo of arquivos) {
      lerCodigo(arquivo).split('\n').forEach((texto, i) => {
        for (const simbolo of SIMBOLOS_PROIBIDOS) {
          if (texto.includes(simbolo)) {
            const rel = path.relative(RAIZ, arquivo).replace(/\\/g, '/');
            acusados.push(`${rel}:${i + 1} (${simbolo}) ${texto.trim()}`);
          }
        }
      });
    }
    assert.deepEqual(acusados, [], `o quadro temporal de presença voltou:\n${acusados.join('\n')}`);
  });

  it('o roteamento de mensagem do gateway não tem ramo para o quadro', () => {
    // A forma exata do ramo, para que um `case 'temporal':` mudo (que pareceria inofensivo) também
    // reprove: o contrato é que o quadro caia no `default`, que é o mesmo tratamento de todo tipo
    // desconhecido. PISO ao lado: os ramos vizinhos continuam declarados no mesmo arquivo.
    const gateway = lerCodigo(path.join(PASTA_COLLAB, 'collab.gateway.js'));
    assert.ok(!/case\s+'temporal'/.test(gateway), "o gateway voltou a ter um `case 'temporal'`");
    assert.ok(/case\s+'cursor'/.test(gateway), 'piso: o ramo do cursor precisa continuar aqui');
    assert.ok(/case\s+'selection'/.test(gateway), 'piso: o ramo da seleção precisa continuar aqui');
    assert.ok(/^\s*default:/m.test(gateway), 'piso: o `default` é para onde o quadro antigo cai');
  });

  it('o retrato de entrada não carrega a chave do instante', () => {
    // `getRoomUsers` é onde a chave morava. O piso são os dois vizinhos retidos pelo MESMO
    // caminho, que continuam no retrato.
    const rooms = lerCodigo(path.join(PASTA_COLLAB, 'collab.rooms.js'));
    const corpo = rooms.slice(rooms.indexOf('export function getRoomUsers'));
    assert.ok(corpo.length > 0, 'piso: `getRoomUsers` precisa existir para a varredura valer');
    assert.ok(!corpo.includes('temporalState'), 'o retrato voltou a expor o instante da linha do tempo');
    assert.ok(corpo.includes('cursorPosition'), 'piso: o cursor continua no retrato');
    assert.ok(corpo.includes('selectedFeatures'), 'piso: a seleção continua no retrato');
  });
});
