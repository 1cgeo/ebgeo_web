// Path: tests/bench/escrita-caminho.bench.mjs
//
// E3 — REST CONTRA WEBSOCKET, MESMA CARGA. O que cada caminho conta ao cliente quando recusa.
//
// Rode a mao:
//   node tests/bench/escrita-caminho.bench.mjs
//   node tests/bench/escrita-caminho.bench.mjs --escritores 16 --lotes 20 --ops 50
//
// OS DOIS CAMINHOS CAEM NO MESMO `pushOperations`, ENTAO A LATENCIA DEVE BATER. Se ela nao
// bater, a diferenca e do transporte (handshake, keep-alive, enquadramento), e nao da escrita.
// Esta e a metade barata do cenario.
//
// A METADE QUE IMPORTA E O RELATO DA FALHA, E ELE NAO E SIMETRICO. No REST, o
// `ServiceUnavailableError` do `lock_timeout` chega como 503 com mensagem retentavel, e o
// cliente sabe que NADA foi aplicado. No socket, `handleOperations`
// (`src/modules/collab/collab.handlers.js`) captura TODO throw num unico
// `{ type: 'error', code: 'OPERATION_FAILED' }`, sem `ack_batch` e sem resultado por op. Do lado
// do cliente, "recusado, pode reenviar" e "aplicado, o ack se perdeu" tem exatamente a mesma
// forma. As colunas `WS_ERRO` e `WS_MUDO` nos status brutos contam quantas vezes isso aconteceu.
//
// A PROVA P2 E QUEM RESOLVE A AMBIGUIDADE, e e por isso que ela existe. Toda op sem veredito
// (503, `error` ou silencio) e conferida contra o ledger: se o lock estourou antes do primeiro
// INSERT, como o codigo afirma, nenhuma delas pode estar gravada. Uma unica que esteja
// transforma a ambiguidade do cliente em perda de dado de verdade.
//
// O SOCKET DESTE CENARIO SO ESCREVE. O fan-out para os pares e E5, deliberadamente separado:
// misturar os dois faria a latencia de escrita carregar o custo de transmitir para ouvintes, e
// nenhuma das duas perguntas seria respondida.

import { comBancada, medir, fechar, arg, aquecer } from './lib/bancada.mjs';
import { semearCenario, autenticar, novoAtlas, DSN_PADRAO } from './lib/semear.mjs';
import { escritorRest, escritorWs, criarRegistro } from './lib/escritor.mjs';
import { Serie } from './lib/metricas.mjs';

const ESCRITORES = arg('escritores', 16);
const LOTES = arg('lotes', 20);
const OPS = arg('ops', 50);

await comBancada(
  {
    titulo: 'E3 — REST contra WebSocket sob a mesma contencao',
    extraCabecalho: { escritores: ESCRITORES, lotes: LOTES, opsPorLote: OPS },
  },
  async (ctx) => {
    const cenario = await semearCenario({ dsn: DSN_PADRAO, escritores: ESCRITORES, atlas: 0 });
    const tokens = await autenticar(ctx.base, cenario.usuarios, cenario.senha);

    const aquecimento = await novoAtlas({ cenario, nome: 'Aquecimento' });
    await aquecer({
      servidor: ctx.servidor,
      token: tokens[0].token,
      atlasId: aquecimento.id,
      mapId: aquecimento.mapas[0],
    });

    const resultados = [];
    for (const caminho of ['rest', 'ws']) {
      const atlas = await novoAtlas({ cenario, nome: `Caminho ${caminho}` });
      const registro = criarRegistro();
      const serie = new Serie(caminho);
      const escrever = caminho === 'rest' ? escritorRest : escritorWs;

      const tarefas = tokens.map(({ token }) => () =>
        escrever({
          base: ctx.base,
          token,
          atlasId: atlas.id,
          mapId: atlas.mapas[0],
          lotes: LOTES,
          opsPorLote: OPS,
          serie,
          registro,
        })
      );

      resultados.push(
        await medir({
          ctx,
          rotulo: caminho.toUpperCase(),
          atlasIds: [atlas.id],
          registro,
          serie,
          tarefas,
        })
      );
      console.log(`  ... caminho ${caminho} concluido`);
    }

    return fechar(resultados, [
      'Latencia parecida entre os dois e o esperado: os dois chamam o mesmo pushOperations.',
      'A coluna 503 so aparece no REST. No socket a mesma recusa vira WS_ERRO nos status brutos.',
      'WS_MUDO e lote sem resposta nenhuma dentro de 30 s. Para o cliente, indistinguivel de ack perdido.',
      'Some WS_ERRO e WS_MUDO: e quanto do trabalho o cliente de socket nao sabe se aplicou.',
      'A prova P2 diz o que de fato aconteceu com essas ops. Ela e a unica coisa aqui que reprova.',
    ]);
  }
);
