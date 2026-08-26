// Path: tests/bench/escrita-multiatlas.bench.mjs
//
// E4 — A MESMA CARGA REPARTIDA EM 1, 4 E 16 ATLAS. A afirmacao do lock, medida.
//
// Rode a mao:
//   node tests/bench/escrita-multiatlas.bench.mjs
//   node tests/bench/escrita-multiatlas.bench.mjs --escritores 32 --degraus 1,4,16 --lotes 20
//
// A FRASE QUE ESTA BANCADA COLOCA NA BALANCA esta no comentario do proprio lock, em
// `src/modules/sync/sync.service.js`: "o lock e por atlas, entao pushes para atlas DIFERENTES
// continuam rodando totalmente em paralelo". A frase e plausivel e nunca foi medida. O numero
// de escritores fica FIXO em todos os degraus; so muda em quantos atlas eles se espalham. Se a
// frase estiver certa, `lotes/s` sobe com o numero de atlas.
//
// ATE ONDE SUBIR E OUTRA PERGUNTA, E ELA TEM TETO CONHECIDO. `DATABASE_POOL_MAX` e 10 por
// padrao (`src/config.js`). Dezesseis atlas escrevendo de verdade em paralelo precisariam de
// dezesseis conexoes simultaneas, e o pool nao tem. A curva deve entao subir e ACHATAR perto do
// tamanho do pool, e `conexPico` diz se foi isso mesmo que aconteceu. Esta bancada NAO mexe no
// pool: ela mede o padrao e mostra onde o joelho cai.
//
// A ARMADILHA DA VERSAO, QUE NAO E DEFEITO. `server_version` vem de `atlas_version_seq`, uma
// sequencia GLOBAL compartilhada entre atlas. Com varios atlas escrevendo junto, a numeracao de
// cada um fica monotonica mas cheia de buracos, e cada buraco e uma op de outro atlas. Detectar
// perda por nao-contiguidade ja causou tempestade de `sync_request` neste sistema e foi
// removido. A reconciliacao aqui compara `op_id`, nunca versao.
//
// A RECONCILIACAO COBRE TODOS OS ATLAS DO DEGRAU de uma vez, porque o registro e compartilhado.
// Conferir so o primeiro seria conferir um subconjunto e dar o conjunto por conferido.

import { comBancada, medir, fechar, arg, argLista, aquecer } from './lib/bancada.mjs';
import { semearCenario, autenticar, novoAtlas, DSN_PADRAO } from './lib/semear.mjs';
import { escritorRest, criarRegistro } from './lib/escritor.mjs';
import { Serie } from './lib/metricas.mjs';

const ESCRITORES = arg('escritores', 32);
const DEGRAUS = argLista('degraus', [1, 4, 16]);
const LOTES = arg('lotes', 20);
const OPS = arg('ops', 10);

await comBancada(
  {
    titulo: 'E4 — a mesma carga repartida entre varios atlas',
    extraCabecalho: {
      escritores: ESCRITORES,
      atlasPorDegrau: DEGRAUS.join(', '),
      lotes: LOTES,
      opsPorLote: OPS,
    },
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
    for (const quantos of DEGRAUS) {
      const atlas = [];
      for (let a = 0; a < quantos; a += 1) {
        atlas.push(await novoAtlas({ cenario, nome: `${quantos} atlas #${a}` }));
      }
      const registro = criarRegistro();
      const serie = new Serie(`${quantos} atlas`);

      // Round-robin: escritor i escreve no atlas i % quantos. Reparticao igual, e com 32
      // escritores em 16 atlas cada atlas fica com exatamente dois, que e a contencao minima
      // capaz de acordar o lock.
      const tarefas = tokens.map(({ token }, i) => () => {
        const alvo = atlas[i % quantos];
        return escritorRest({
          base: ctx.base,
          token,
          atlasId: alvo.id,
          mapId: alvo.mapas[0],
          lotes: LOTES,
          opsPorLote: OPS,
          serie,
          registro,
        });
      });

      resultados.push(
        await medir({
          ctx,
          rotulo: `${quantos} atlas`,
          atlasIds: atlas.map((a) => a.id),
          registro,
          serie,
          tarefas,
        })
      );
      console.log(`  ... degrau de ${quantos} atlas concluido`);
    }

    return fechar(resultados, [
      'Escritores fixos em todos os degraus. So a reparticao entre atlas muda.',
      'lotes/s subindo com o numero de atlas confirma que o lock e mesmo por atlas.',
      'Se a subida achatar, compare conexPico com DATABASE_POOL_MAX: o teto passou a ser o pool.',
      'lockPico caindo entre degraus e a fila do advisory se dissolvendo, que e o efeito procurado.',
      'A numeracao de server_version fica esburacada por atlas, e isso e normal: a sequencia e global.',
    ]);
  }
);
