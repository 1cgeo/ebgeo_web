// Path: tests/unit/resource-payload-prune.test.js
//
// A PODA POR CONTEÚDO, isolada. Os arquivos de comportamento (`tests/integration/
// poda-por-conteudo.test.js` e `tests/ws/poda-ws-fronteira.test.js`) medem o que sai no fio; este
// mede as propriedades que só se veem de dentro e que decidem se a fronteira é barata e segura:
// identidade quando não há nada a tirar, teto de profundidade, cegueira ao carimbo, e a
// autorização por identidade que a serialização não carrega.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  pruneResourcePayload, pruneResourceJsonText, markResourceDefinitionAuthorized,
  isResourceDefinitionAuthorized, MAX_PRUNE_DEPTH,
} from '../../src/modules/catalog/resource-payload.prune.js';
import { installOutboundResourcePrune } from '../../src/modules/collab/collab.send.js';

const URL_SECRETA = '/tiles/segredo/{z}/{x}/{y}.pbf';

const definicao = (id = 'data-restrita', type = 'data_layer') => ({
  id,
  type,
  visible: true,
  opacity: 0.6,
  name: 'Camada restrita',
  config: { id: 'restrita', source: { type: 'vector', url: URL_SECRETA } },
});

describe('poda por conteúdo — a decisão é a FORMA do nó, nunca o carimbo', () => {
  it('acha a definição onde quer que ela esteja, e o caminho não importa', () => {
    // As seis posições medidas: op de camada, documento de mapa, a coluna irmã, `previousData`,
    // `changes`, e um aninhamento fundo qualquer. Uma poda que decidisse por chave conhecida
    // passaria em cinco e falharia na sexta, que é a que ninguém previu.
    const carga = {
      data: definicao(),
      changes: { catalogLayers: [definicao('data-a'), { id: 'x', type: 'hillshade', config: { url: '/relevo' } }] },
      previousData: { analysis_layers: { camadas: [definicao('analysis-b', 'analysis_layer')] } },
      qualquer: { coisa: { bem: { fundo: [{ ninho: definicao('data-c') }] } } },
    };
    const podada = pruneResourcePayload(carga);

    assert.ok(!JSON.stringify(podada).includes(URL_SECRETA), 'nenhuma das posições pode restar');
    assert.equal(podada.data.visible, true, 'e o estado por atlas sobrevive em todas');
    assert.equal(podada.changes.catalogLayers[0].id, 'data-a', 'com a referência');
    assert.equal(podada.previousData.analysis_layers.camadas[0].type, 'analysis_layer');
    assert.equal(podada.qualquer.coisa.bem.fundo[0].ninho.config, undefined, 'inclusive no ninho');
  });

  it('HILLSHADE não é tocado, e é a regressão que ficaria quieta no teste e barulhenta na tela', () => {
    const relevo = {
      id: 'hillshade', type: 'hillshade', name: 'Sombreamento',
      config: { source: { type: 'raster-dem', url: '/dem' } },
    };
    assert.equal(pruneResourcePayload(relevo), relevo, 'sai por IDENTIDADE, sem cópia sequer');

    // E a entrada legada sem `type` nenhum, que não é definição nossa para tirar.
    const semTipo = { id: 'wms-a', name: 'A', config: { url: '/x' } };
    assert.equal(pruneResourcePayload(semTipo), semTipo);
  });

  it('IDENTIDADE quando não há nada a tirar: a fronteira roda no caminho quente', () => {
    const limpa = { type: 'operations', ops: [{ entityType: 'feature', data: { nome: 'Ponto' } }] };
    assert.equal(pruneResourcePayload(limpa), limpa, 'o objeto inteiro');
    assert.equal(pruneResourcePayload(limpa).ops, limpa.ops, 'e os sub-objetos');

    // Uma entrada JÁ podada também sai por identidade: a fronteira roda DEPOIS da poda de op no
    // relay, e uma cópia por nó ali seria puro desperdício.
    const jaPodada = { id: 'data-a', type: 'data_layer', visible: true };
    assert.equal(pruneResourcePayload(jaPodada), jaPodada);

    // Mas a que tem o que perder muda de objeto, senão "identidade" seria o comportamento de uma
    // função que não faz nada.
    assert.notEqual(pruneResourcePayload(definicao()), definicao());
  });

  it('RESGATA a referência pré-prefixo, que só existia dentro de `config`', () => {
    const preprefixo = {
      id: 'wms-sem-prefixo', type: 'data_layer', visible: true,
      name: 'Antiga', config: { id: 'restrita', source: { url: URL_SECRETA } },
    };
    const podada = pruneResourcePayload(preprefixo);
    assert.equal(podada.config, undefined, 'a definição sai');
    assert.equal(podada.originalId, 'restrita', 'e o único endereço que ela tinha é resgatado');
  });

  it('TETO DE PROFUNDIDADE: carga de cliente é entrada não confiável', () => {
    // Acima do teto o nó vira `null`. Passar adiante o que não foi caminhado transformaria
    // "aninhe mais fundo do que o caminhador vai" num contorno, que é a classe de buraco que esta
    // fase existe para fechar.
    let fundo = definicao();
    for (let i = 0; i < MAX_PRUNE_DEPTH + 5; i += 1) fundo = { dentro: fundo };
    const podada = pruneResourcePayload(fundo);
    assert.ok(!JSON.stringify(podada).includes(URL_SECRETA), 'nada além do teto atravessa');

    // E o teto é FOLGADO para o que é real: a profundidade máxima medida num snapshot real é 10.
    assert.ok(MAX_PRUNE_DEPTH >= 32, 'o teto precisa ficar muito acima de qualquer carga legítima');
    let raso = definicao();
    for (let i = 0; i < 20; i += 1) raso = { dentro: raso };
    let no = pruneResourcePayload(raso);
    for (let i = 0; i < 20; i += 1) no = no.dentro;
    assert.equal(no.id, 'data-restrita', 'a 20 níveis a carga continua chegando, podada');
    assert.equal(no.config, undefined);
  });

  it('AUTORIZAÇÃO por identidade: passa no objeto, e NÃO sobrevive à serialização', () => {
    const autorizada = markResourceDefinitionAuthorized(definicao());
    assert.ok(isResourceDefinitionAuthorized(autorizada));
    assert.equal(pruneResourcePayload({ camada: autorizada }).camada, autorizada, 'sai intacta');

    // A CONSEQUÊNCIA QUE PRECISA ESTAR MEDIDA, porque é o único jeito de quebrar este desenho em
    // silêncio: uma cópia da MESMA definição, sem a marca, é podada. É o que acontece com quem
    // serializa antes da fronteira — e a direção da falha é segura (a camada chega sem definição),
    // nunca um vazamento.
    const copia = JSON.parse(JSON.stringify(autorizada));
    assert.equal(isResourceDefinitionAuthorized(copia), false);
    assert.equal(pruneResourcePayload(copia).config, undefined);
  });

  it('a entrada em TEXTO: atalho sem parse quando não há discriminador, e poda quando há', () => {
    const semNada = JSON.stringify({ type: 'cursor', userId: 'u1', position: [1, 2] });
    assert.equal(pruneResourceJsonText(semNada), semNada, 'devolve a MESMA string, sem parse');

    const comDefinicao = JSON.stringify({ type: 'operation', op: { data: definicao() } });
    const podada = pruneResourceJsonText(comDefinicao);
    assert.notEqual(podada, comDefinicao);
    assert.ok(!podada.includes(URL_SECRETA));
    assert.ok(JSON.parse(podada).op.data.visible, 'o resto do frame continua lá');

    // Degeneradas: nada que não seja string, e texto que não é JSON, atravessam intactos. A
    // fronteira não é um validador, e derrubar um envio porque o frame não era JSON quebraria
    // transporte que não tem nada a ver com este assunto.
    assert.equal(pruneResourceJsonText('nao e json {'), 'nao e json {');
    const buf = Buffer.from('bytes');
    assert.equal(pruneResourceJsonText(buf), buf);
    assert.equal(pruneResourceJsonText(null), null);
  });

  it('degeneradas no objeto: null, primitivo, array vazio e ciclo não derrubam a fronteira', () => {
    assert.equal(pruneResourcePayload(null), null);
    assert.equal(pruneResourcePayload(42), 42);
    assert.equal(pruneResourcePayload('texto'), 'texto');
    const vazio = [];
    assert.equal(pruneResourcePayload(vazio), vazio);

    // Ciclo: o teto de profundidade é o que o limita. Não há caminho de produção que produza um
    // (`JSON.stringify` lançaria um quadro depois), mas a fronteira não pode ser o lugar onde um
    // laço infinito começa.
    const ciclico = { nome: 'a' };
    ciclico.eu = ciclico;
    assert.doesNotThrow(() => pruneResourcePayload(ciclico));
  });
});

// ---------------------------------------------------------------------------
// O ESTRANGULAMENTO DO WS, provado sobre um EMISSOR QUE NÃO SABE QUE ELE EXISTE
// ---------------------------------------------------------------------------
//
// POR QUE ESTE BLOCO PRECISA SER SEPARADO DOS TESTES DE COMPORTAMENTO. No fio, o frame de relay
// atravessa DUAS defesas: `broadcastToRoom`/`broadcastOperations` podam o objeto antes do fan-out
// (para não pagar a varredura por destinatário), e o embrulho de `ws.send` poda o que sobrar. Um
// teste de ponta a ponta fica verde com QUALQUER uma das duas de pé, e por isso não consegue
// mostrar o que esta fase realmente comprou: que um emissor NOVO, que não passe por nenhuma delas,
// já nasce coberto. Foi exatamente esse emissor — `handleOperation`, o relay singular — que
// sobreviveu a duas fases enquanto um comentário afirmava que ele estaria "coberto por construção".
//
// Aqui o emissor é um socket falso e a chamada é direta, sem sala, sem `broadcastToRoom`, sem
// nada. É a medida do embrulho sozinho.
describe('fronteira de `ws.send` — cobre quem nunca ouviu falar dela', () => {
  const socketFalso = () => {
    const enviados = [];
    return { enviados, send: (data, ...resto) => enviados.push({ data, resto }) };
  };

  it('um emissor direto, em STRING, sai podado', () => {
    const ws = socketFalso();
    installOutboundResourcePrune(ws);

    ws.send(JSON.stringify({ type: 'frame_que_ninguem_previu', op: { data: definicao() } }));

    assert.equal(ws.enviados.length, 1, 'o envio chegou ao `send` original');
    const frame = JSON.parse(ws.enviados[0].data);
    assert.ok(!ws.enviados[0].data.includes(URL_SECRETA), 'e chegou sem a definição');
    assert.equal(frame.op.data.visible, true, 'com o resto do frame intacto');
    assert.equal(frame.type, 'frame_que_ninguem_previu', 'e sem o tipo ser reescrito');
  });

  it('um emissor direto, em OBJETO, sai serializado e podado — e a autorização sobrevive', () => {
    const ws = socketFalso();
    installOutboundResourcePrune(ws);

    const autorizada = markResourceDefinitionAuthorized(definicao('data-publica'));
    ws.send({ type: 'sync_response', snapshot: { camadas: [autorizada, definicao('data-privada')] } });

    const frame = JSON.parse(ws.enviados[0].data);
    assert.equal(typeof ws.enviados[0].data, 'string', 'o objeto é serializado pela fronteira');
    assert.equal(frame.snapshot.camadas[0].config.source.url, URL_SECRETA, 'a autorizada passa inteira');
    assert.equal(frame.snapshot.camadas[1].config, undefined, 'e a que ninguém autorizou, não');
  });

  it('frame BINÁRIO e argumentos extras atravessam intactos', () => {
    const ws = socketFalso();
    installOutboundResourcePrune(ws);

    // Não existe frame binário neste socket hoje. A guarda é para que acrescentar um não comece,
    // em silêncio, a rodar um Buffer por uma varredura de JSON.
    const bytes = Buffer.from([1, 2, 3]);
    const callback = () => {};
    ws.send(bytes, { binary: true }, callback);
    assert.equal(ws.enviados[0].data, bytes, 'o Buffer é o MESMO objeto');
    assert.deepEqual(ws.enviados[0].resto, [{ binary: true }, callback], 'e os argumentos de `ws` seguem');
  });

  it('a instalação é IDEMPOTENTE: o segundo embrulho veria a saída do primeiro', () => {
    const ws = socketFalso();
    installOutboundResourcePrune(ws);
    const primeiro = ws.send;
    installOutboundResourcePrune(ws);
    assert.equal(ws.send, primeiro, 'a segunda instalação não empilha outro embrulho');
  });
});
