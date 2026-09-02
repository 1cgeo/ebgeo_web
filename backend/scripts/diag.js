#!/usr/bin/env node
// Path: scripts/diag.js
/**
 * @fileoverview `npm run diag` — consulta o log em arquivo pelo terminal.
 *
 * É o consumidor de investigação do `src/utils/log-diario.js`, e o caminho pelo qual um
 * agente responde "o que quebrou". O outro consumidor é a aba Diagnóstico do painel de
 * administração, que serve à pergunta do dia a dia; este serve à pergunta profunda, porque
 * o arquivo tem TUDO e o banco tem só o resumo.
 *
 * A lógica de agregação não mora aqui, e sim em `src/utils/diag-consulta.js`, que é puro e
 * testado. Aqui fica leitura de disco, argumentos e formatação.
 *
 * A LEITURA É EM FLUXO, E O COMANDO NÃO TEM TETO DE REGISTROS. As duas metades da frase são
 * decisão, e a segunda é a que se perde ao "reusar o leitor da rota": `diag.service.js`
 * retém um anel de 200 mil linhas porque ele responde dentro de um processo que também
 * atende sync, e uma resposta sua pode ser truncada. Aqui não: o comando vê o arquivo
 * INTEIRO, e é isso que faz `diag -- saude` contar buracos numa janela longa. Importar
 * aquele anel para cá mudaria respostas em silêncio, trocando o conjunto por uma amostra sem
 * dizer que virou amostra.
 *
 * O que saiu foi o `readFileSync().split('\n')`, que era teto de outro tipo, e mais duro:
 * acima de 512 MiB de string o node levanta `ERR_STRING_TOO_LONG`, o que na densidade deste
 * log dá algo entre dois e dois milhões e meio de linhas num dia, sem escape por reduzir a
 * janela, porque o arquivo era lido e parseado INTEIRO antes do filtro por tempo (medido:
 * 382 ms com `--desde 5m` contra 433 ms com `24h`). Medido nesta máquina, num arquivo de
 * 108 MB com 402 mil linhas: pico de 410 a 488 MB de working set antes, 60 a 78 MB depois.
 *
 * TODA AGREGAÇÃO É INCREMENTAL, com duas exceções declaradas. A latência precisa da amostra
 * porque percentil por posto exige a distribuição, mas guarda NÚMEROS (`criarResumoDeLatencia`),
 * não registros. E `erros` faz DUAS passadas pelo arquivo, porque a fusão das duas linhas de
 * uma requisição falha (`fundirPorRequisicao`) precisa saber se existe linha rica para aquele
 * `reqId` em QUALQUER lugar da janela, inclusive depois da linha que está sendo lida; a
 * primeira passada só indexa esses `reqId`, e a segunda agrega. O preço é ler o arquivo duas
 * vezes (medido: 572 ms antes, 720 ms depois, no mesmo arquivo de 108 MB), e a alternativa
 * seria segurar toda linha com `reqId` até o fim, que é a memória que este trabalho existe
 * para tirar.
 *
 * OS COMANDOS SE DIVIDEM EM TRÊS FAMÍLIAS, e a divisão é por FONTE, não por assunto. Os
 * cinco de LOG (`erros`, `lento`, `status`, `saude`, `linhas`) leem o `.jsonl` e respondem
 * com o Postgres fora, que é metade da razão de o arquivo existir. Os de BANCO (`defeitos`,
 * `pilha` e os três verbos de ciclo de vida) consultam as tabelas do lote B (`defeitos` e
 * `defeito_ocorrencias`), o que os obriga a importar o `config.js` e o pool, SEMPRE e não só
 * quando falta `--dir`; eles NÃO podem responder com o banco fora, porque a resposta É o
 * banco. E há UM híbrido, `resumo`, que lê as duas fontes e tolera a ausência de cada uma:
 * o bloco cuja fonte não respondeu diz isso em vez de imprimir zero (ver `montarResumo`, em
 * `src/utils/diag-consulta.js`).
 *
 * OS TRÊS VERBOS DE CICLO DE VIDA SÃO A ÚNICA ESCRITA DESTE COMANDO. Eles chamam a MESMA
 * função de serviço que a rota `PATCH /diag/defeitos/:id` chama, pela regra de sempre (uma
 * segunda verdade sobre o que "resolver" significa faria a tela e o terminal divergirem), e
 * exigem `--como <usuário>`: `audit_trail.actor_id` é NOT NULL, o terminal não tem sessão, e
 * um ato de administrador sem autor na trilha não responde a pergunta que a trilha existe
 * para responder. Ver `comandoCicloDeVida`.
 *
 * `--json` VALE PARA TODOS ELES, e o contrato dele é curto: UM documento JSON no stdout e
 * NADA MAIS ali. As notas que o modo humano escreve (o cabeçalho com o diretório, as
 * ressalvas sobre indício e premissa) ou viram campo do documento ou saem no stderr. É o que
 * torna a saída consumível por `| jq` e por um agente sem nenhum recorte de texto, que é o
 * consumidor que esta ferramenta existe para servir (ver `docs/wiki/observabilidade.md`).
 *
 * Uso:
 *   npm run diag -- erros [--desde 24h] [--limite 20]
 *   npm run diag -- lento [--desde 24h] [--limite 15] [--por-release]
 *   npm run diag -- status [--desde 24h]
 *   npm run diag -- saude [--desde 24h] [--intervalo 5m]
 *   npm run diag -- linhas [--desde 24h] [--filtro texto] [--limite 50]
 *   npm run diag -- resumo [--desde 24h] [--intervalo 5m]
 *   npm run diag -- defeitos [--desde 24h] [--estado aberto] [--origem store] [--novos]
 *   npm run diag -- defeitos --id <uuid>
 *   npm run diag -- pilha --id <uuid> --mapas <dir>
 *   npm run diag -- resolver <uuid> --como <usuário> [--commit <hash>]
 *   npm run diag -- ignorar <uuid> --como <usuário>
 *   npm run diag -- reabrir <uuid> --como <usuário>
 *   (--dir <caminho> para ler um diretório de log que não seja o configurado)
 *   (--json em qualquer um deles)
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import {
  parseJanela, parseIntervalo, diasDaJanela, parseLinha, resumirAmostras,
  criarAgrupadorDeErros, criarIndiceDeRequisicoesComErro, criarCensoDeEnderecos,
  criarResumoDeLatencia, criarResumoDeStatus, montarResumo, MAX_ENDERECOS_PRINCIPAIS,
  ROTULO_SEM_RELEASE,
} from '../src/utils/diag-consulta.js';
import { MARCADOR_AMOSTRA } from '../src/utils/amostra-de-saude.js';
// A MESMA REGRA DOS DOIS VOCABULÁRIOS ABAIXO: o marcador da query lenta é importado do
// escritor e nunca redigitado. `query-lenta.js` é folha de zero imports (é o que o
// `fileoverview` dele existe para garantir), então trazê-lo aqui não arrasta `config.js`
// nem o pool para dentro dos comandos que rodam com o Postgres fora.
import { MARCADOR_QUERY_LENTA } from '../src/utils/query-lenta.js';
// Os DOIS vocabulários entram por import e nunca como literal: são os mesmos que o Joi da
// rota valida e que o CHECK do banco impõe, e os dois arquivos têm zero imports por
// contrato, então trazê-los aqui não arrasta `config.js` nem o pool para dentro dos cinco
// comandos que rodam sem banco. Uma cópia à mão desta lista envelheceria na próxima origem
// nova, e envelheceria falhando FECHADO: o comando recusaria um valor que o banco aceita.
import {
  ESTADOS_DE_DEFEITO, ESTADOS_MANUAIS, EstadoDeDefeito,
} from '../src/modules/diag/estados-de-defeito.js';
import { ORIGENS_DE_ERRO } from '../src/modules/diag/origens-de-erro.js';
import {
  analisarPilha, resolverQuadros, localizarReleaseDeMapas,
} from './diag/pilha.js';
import { resolver as resolverPosicao } from './diag/mapa-de-fonte.js';

/**
 * Os três atos de CICLO DE VIDA, e o estado que cada um escreve.
 *
 * O MAPA EXISTE PARA QUE O VERBO NÃO SEJA O ESTADO. "reabrir" escreve `aberto`, e as outras
 * duas coincidem por acaso: um `op.comando` usado direto como estado funcionaria para dois
 * dos três e falharia no terceiro com 23514 vindo do banco, que é a pior forma de descobrir
 * isso. Os valores saem de `EstadoDeDefeito` e não são literais, pelo mesmo motivo de
 * sempre: erro de digitação aqui não é visto por ninguém até o CHECK reclamar.
 */
const ESTADO_DO_VERBO = Object.freeze({
  resolver: EstadoDeDefeito.RESOLVIDO,
  ignorar: EstadoDeDefeito.IGNORADO,
  reabrir: EstadoDeDefeito.ABERTO,
});

const COMANDOS = new Set([
  'erros', 'lento', 'status', 'saude', 'linhas', 'resumo', 'defeitos', 'pilha',
  ...Object.keys(ESTADO_DO_VERBO),
]);

/**
 * Os que consultam o Postgres, e por isso NÃO respondem com o banco fora.
 *
 * A separação é usada em UM lugar só (o despacho de `main`) e mesmo assim é constante
 * nomeada: ela é a fronteira entre a promessa dos cinco comandos de log ("funciona quando
 * nada mais funciona") e a destes dois, e um `op.comando === 'defeitos' || ...` solto no
 * meio do fluxo seria exatamente a lista fechada que esta casa proíbe, com o mesmo modo de
 * falha (o comando de banco que alguém acrescentar depois cairia no ramo do arquivo e
 * morreria procurando `.jsonl`).
 */
const COMANDOS_DE_BANCO = new Set(['defeitos', 'pilha', ...Object.keys(ESTADO_DO_VERBO)]);

/**
 * O HÍBRIDO, e ele é o único: `resumo` lê o ARQUIVO **e** o BANCO.
 *
 * Ele não cabe em nenhum dos dois conjuntos acima, e forçá-lo num deles quebraria a promessa
 * daquele conjunto: no de arquivo, a ida ao banco derrubaria o comando com o Postgres fora;
 * no de banco, o `existsSync` de LOG_DIR nunca rodaria. O que ele faz é o que nenhum outro
 * faz: tolera a ausência das DUAS fontes, uma de cada vez, e o bloco cuja fonte não
 * respondeu DIZ isso em vez de imprimir zero. É o desenho inteiro do comando, e está no
 * `fileoverview` de `montarResumo`.
 */
const COMANDO_HIBRIDO = 'resumo';

function lerArgumentos(argv) {
  const [comando, ...resto] = argv;
  const op = {
    comando, desde: '24h', limite: null, filtro: null, dir: null, intervalo: null,
    json: false, estado: null, origem: null, release: null, pagina: null, novos: false,
    id: null, mapas: null, limiteBruto: null, commit: null, como: null, porRelease: false,
  };
  for (let i = 0; i < resto.length; i += 1) {
    const a = resto[i];
    if (a === '--desde') op.desde = resto[++i];
    // O TEXTO CRU DO `--limite` É GUARDADO ao lado do número, e ele é o que distingue os
    // TRÊS estados que o número sozinho colapsa: não passado, passado e válido, passado e
    // lixo. Sem ele, `--limite abc` (NaN) e `--limite 0` caem no mesmo `|| 20` do default,
    // e o comando responde OUTRA pergunta em silêncio, que é a mesma classe do
    // `--desde 24hs` que `parseJanela` existe para recusar.
    else if (a === '--limite') { op.limiteBruto = resto[++i]; op.limite = parseInt(op.limiteBruto, 10); }
    else if (a === '--filtro') op.filtro = resto[++i];
    else if (a === '--dir') op.dir = resto[++i];
    else if (a === '--intervalo') op.intervalo = resto[++i];
    else if (a === '--json') op.json = true;
    else if (a === '--estado') op.estado = resto[++i];
    else if (a === '--origem') op.origem = resto[++i];
    else if (a === '--release') op.release = resto[++i];
    else if (a === '--pagina') op.pagina = resto[++i];
    else if (a === '--novos') op.novos = true;
    else if (a === '--id') op.id = resto[++i];
    else if (a === '--mapas') op.mapas = resto[++i];
    else if (a === '--commit') op.commit = resto[++i];
    else if (a === '--como') op.como = resto[++i];
    else if (a === '--por-release') op.porRelease = true;
    // O ID TAMBÉM VEM SOLTO, mas SÓ NOS TRÊS VERBOS DE CICLO DE VIDA, e o recorte é o
    // conserto de uma versão anterior que aceitava posicional em TODO comando. Os dois
    // estragos daquela versão: um `diag -- defeitos aberto` (o operador quis `--estado
    // aberto`) virava "--id não é um uuid", que manda procurar o erro no lugar errado; e o
    // VALOR de uma bandeira que este parser não conhece caía aqui e virava id, silenciosamente.
    //
    // Os verbos aceitam posicional porque `diag -- resolver <uuid>` é a forma natural de um
    // comando que age sobre UMA coisa; `defeitos` e `pilha` continuam só com `--id`, que é o
    // que eles sempre pediram. O primeiro token solto vence e o segundo é ignorado: reclamar
    // exigiria uma gramática por comando, e o id lido sai impresso na resposta.
    else if (!a.startsWith('--') && op.id === null && ESTADO_DO_VERBO[comando] !== undefined) op.id = a;
  }
  return op;
}

/**
 * A ajuda, e o DESTINO dela é argumento porque `--json` o muda.
 *
 * Sob `--json` o contrato é que o stdout carregue UM documento e nada mais; um texto de
 * ajuda ali quebraria todo `| jq` no exato caso em que o operador errou o comando, que é
 * quando ele mais precisa ler o erro. Escrever no stderr mantém as duas coisas: a ajuda
 * chega ao terminal e o stdout continua parseável (vazio).
 *
 * @param {{write: (s: string) => unknown}} destino
 */
function ajuda(destino) {
  destino.write(`
diag — consulta o log em arquivo e as tabelas de defeito do EBGeo

  npm run diag -- erros  [--desde 24h] [--limite 20]   erros agrupados por assinatura
  npm run diag -- lento  [--desde 24h] [--limite 15]   latência por rota (p50/p95/máx)
         [--por-release]                               uma linha por rota E POR BUILD
  npm run diag -- status [--desde 24h]                 contagem por faixa de status
  npm run diag -- saude  [--desde 24h] [--intervalo 5m] buracos na amostra de saúde
  npm run diag -- linhas [--desde 24h] [--filtro texto] despejo cru filtrado
  npm run diag -- resumo [--desde 24h]                 UMA tela: defeitos, latência contra a
                                                       janela anterior, saúde, queda vista
                                                       pelo cliente e status
  npm run diag -- defeitos [--desde 24h] [--estado x] [--origem y] [--release h]
                           [--pagina p] [--novos] [--limite 50] [--id <uuid>]
  npm run diag -- pilha --id <uuid> --mapas <dir>      desminifica a pilha crua

  ciclo de vida do defeito (ESCREVE no banco, e deixa linha na trilha de auditoria):
  npm run diag -- resolver <uuid> --como <usuário> [--commit <hash>]
  npm run diag -- ignorar  <uuid> --como <usuário>
  npm run diag -- reabrir  <uuid> --como <usuário>

  --como <usuário>  QUEM está operando. É obrigatório nos três verbos acima porque
                    audit_trail.actor_id é NOT NULL e o terminal não tem sessão: sem ele o
                    ato mais consequente deste módulo ficaria sem autor na trilha. Ele NÃO
                    é autenticação (quem tem shell tem DATABASE_URL); ele é ATRIBUIÇÃO. A
                    conta precisa existir, estar ativa e ter papel de administrador, que é
                    o mesmo gate da rota equivalente.
  --commit <hash>   só faz sentido com "resolver"; a release é a do SERVIDOR (EBGEO_RELEASE)
                    e nunca vem da linha de comando, porque é ela que decide REGRESSÃO.
  O estado "regrediu" não se escreve à mão em lugar nenhum: é a única transição automática
  do produto, e significa um FATO sobre duas releases. Para desfazer um "resolvido", use
  "reabrir".

  --dir <caminho>   lê outro diretório de log (default: o de LOG_DIR)
  --json            UM documento JSON no stdout e nada mais ali
  janela: 30m, 24h, 7d (o default de TODO comando é 24h; os colchetes acima mostram esse
          default, não uma sugestão por comando)
  --intervalo: 30s, 5m, 1h (sem isto, ele é INFERIDO da própria série)
  --filtro: casa a LINHA COMO ESTÁ NO DISCO, então nome de campo ("time", "msg")
            casa toda linha que o tenha. Procure pelo valor.

  LEEM O BANCO (precisam de DATABASE_URL): defeitos, pilha, resolver, ignorar, reabrir.
  LEEM O ARQUIVO e respondem com o Postgres fora: erros, lento, status, saude, linhas.
  resumo le OS DOIS, e cada bloco dele diz quando a fonte daquele bloco nao respondeu.
  --estado: ${ESTADOS_DE_DEFEITO.join(' | ')}
  --origem: ${ORIGENS_DE_ERRO.join(' | ')}
  --mapas: o diretório da build (com release.json) ou o que contém as builds. A
           pilha é resolvida SÓ contra a release que a produziu; sem ela, saída 2.
`);
}

/**
 * Percorre os registros da janela, um a um, e não devolve nenhum.
 *
 * Abre só os arquivos dos dias que a janela toca, e depois filtra por `time`: sem o
 * segundo passo, `--desde 1h` às 00h30 devolveria o dia de ontem inteiro.
 *
 * NADA É ACUMULADO AQUI, e é isso que separa esta função da que ela substituiu. Quem chama
 * decide o que reter, e nenhum dos cinco comandos retém a janela: erros e status são
 * contadores, saúde fica só com as linhas de amostra (uma a cada poucos minutos), latência
 * fica com números e `linhas` com um anel do tamanho do `--limite`.
 *
 * A LINHA CRUA VAI JUNTO com o registro, e não é conveniência: é o texto que existe no
 * disco, e é contra ele que `--filtro` casa. Re-serializar o objeto para filtrar produz um
 * texto que nunca existiu em lugar nenhum.
 *
 * @param {string} dir
 * @param {number} desdeMs
 * @param {Date} agora
 * @param {(reg: Object, linha: string) => void} aoRegistro
 * @returns {Promise<{arquivosLidos: number, linhas: number, inicio: Date}>}
 */
export async function percorrerRegistros(dir, desdeMs, agora, aoRegistro) {
  const inicio = new Date(agora.getTime() - desdeMs);
  let arquivosLidos = 0;
  let linhas = 0;

  for (const dia of diasDaJanela(inicio, agora)) {
    const alvo = path.join(dir, `ebgeo-${dia}.jsonl`);
    if (!fs.existsSync(alvo)) continue;
    arquivosLidos += 1;
    const entrada = fs.createReadStream(alvo, 'utf8');
    const leitor = readline.createInterface({ input: entrada, crlfDelay: Infinity });
    try {
      for await (const linha of leitor) {
        const reg = parseLinha(linha);
        if (!reg) continue;
        if (typeof reg.time === 'number' && reg.time < inicio.getTime()) continue;
        linhas += 1;
        aoRegistro(reg, linha);
      }
    } finally {
      leitor.close();
      entrada.destroy();
    }
  }
  return { arquivosLidos, linhas, inicio };
}

const hora = (t) => (typeof t === 'number' ? new Date(t).toLocaleString('pt-BR') : '?');

/**
 * Uma duração em ms como o operador a leria em voz alta.
 *
 * Arredonda para a unidade que ainda distingue alguma coisa: num buraco de seis horas, o
 * segundo não informa nada e só atrapalha a comparação entre dois buracos.
 */
function duracao(ms) {
  if (!Number.isFinite(ms)) return '?';
  const seg = Math.round(ms / 1000);
  if (seg < 60) return `${seg}s`;
  const min = Math.floor(seg / 60);
  // A unidade menor só aparece quando ela distingue alguma coisa: "5min 0s" faz o leitor
  // conferir duas vezes um número que é redondo.
  if (min < 60) return seg % 60 ? `${min}min ${seg % 60}s` : `${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 ? `${h}h ${min % 60}min` : `${h}h`;
  return h % 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${Math.floor(h / 24)}d`;
}

/**
 * Os endereços de UM grupo, e o formato muda com o número deles porque a pergunta muda.
 *
 * Com um só, a linha é curta e é a que dispara a nota da ambiguidade adiante. Com vários, um
 * por linha e alinhados, porque aí o que se lê é a COMPARAÇÃO entre as contagens.
 *
 * Grupo sem endereço nenhum não escreve nada, e a explicação sai UMA vez, depois da lista:
 * o campo nasceu em 2026-08-31 e vai faltar na maioria das linhas existentes, então uma
 * frase por grupo seria a mesma frase vinte vezes no mesmo relatório.
 */
function imprimirEnderecosDoGrupo(g) {
  const { distintos, principais } = g.enderecos;
  if (!distintos) return;
  if (distintos === 1) {
    process.stdout.write(`         1 endereço só, em ${principais[0].total} das ${g.total} ocorrência(s): ${principais[0].ip}\n`);
    return;
  }
  process.stdout.write(`         ${distintos} endereço(s) distinto(s):\n`);
  for (const e of principais) {
    process.stdout.write(`           ${String(e.total).padStart(5)}x  ${e.ip}\n`);
  }
  if (distintos > MAX_ENDERECOS_PRINCIPAIS) {
    process.stdout.write(`           ... e mais ${distintos - MAX_ENDERECOS_PRINCIPAIS}, fora dos ${MAX_ENDERECOS_PRINCIPAIS} maiores\n`);
  }
}

/**
 * A nota do endereço, que sai UMA vez e NOMEIA AS DUAS LEITURAS em vez de escolher uma.
 *
 * "Um endereço só" sobre muitas ocorrências pode ser um atacante único ou pode ser
 * `TRUST_PROXY_HOPS` em desacordo com o número de proxies à frente, caso em que toda linha
 * registra o endereço do proxy e o campo vira constante. O `fileoverview` de `clientAddress`
 * (`middleware/request-logger.js`) teme esse caso em voz alta e nada o vigiava; esta é a
 * primeira coisa do produto capaz de acusá-lo, e ela só pode acusar porque tem o CENSO da
 * janela inteira, que é a evidência que nenhum grupo carrega sozinho.
 *
 * Afirmar uma das duas leituras seria inventar veredito, que é a mesma classe de erro da nota
 * de disco em `imprimirNotaDeDisco`, logo abaixo, e pela mesma razão a redação descreve o
 * mecanismo e devolve o juízo a quem lê.
 */
function imprimirNotaDeEndereco(censo, algumGrupoConcentrado) {
  if (!censo.linhas) {
    process.stdout.write('\nNenhuma linha desta janela registra endereço, então nada se afirma sobre origem. O\n');
    process.stdout.write('campo `ip` nasceu em 2026-08-31 na linha de requisição, e linha fora do ciclo HTTP\n');
    process.stdout.write('(o sweep do WS, um job, a amostra de saúde) não o tem nem vai ter.\n');
    return;
  }
  process.stdout.write(`\nNa janela inteira: ${censo.distintos} endereço(s) distinto(s) em ${censo.linhas} linha(s) com endereço.\n`);
  if (!algumGrupoConcentrado) return;

  process.stdout.write('UM ENDEREÇO SÓ NUM GRUPO TEM DUAS LEITURAS, e este comando não escolhe entre elas: pode\n');
  process.stdout.write('ser um endereço único insistindo, ou pode ser TRUST_PROXY_HOPS em desacordo com o número\n');
  process.stdout.write('de proxies à frente, caso em que TODA linha registra o endereço do proxy e o campo vira\n');
  process.stdout.write('constante. O censo acima é o que separa as duas, e é INDÍCIO, não veredito:\n');
  if (censo.distintos === 1) {
    process.stdout.write(`  a janela INTEIRA tem um endereço (${censo.principais[0].ip}), que é o que a hipótese do\n`);
    process.stdout.write('  proxy prevê e também o que um serviço com um cliente só produz. Confira TRUST_PROXY_HOPS\n');
    process.stdout.write('  contra o número de proxies do deploy antes de tratar o endereço como origem.\n');
    return;
  }
  process.stdout.write(`  a janela tem ${censo.distintos} endereços distintos, então o campo NÃO é constante aqui e a\n`);
  process.stdout.write('  concentração é do grupo, não do instrumento.\n');
}

function imprimirErros(grupos, limite, censo) {
  if (!grupos.length) {
    process.stdout.write('Nenhum erro na janela.\n');
    return;
  }
  process.stdout.write(`${grupos.length} assinatura(s) de erro, ${grupos.reduce((s, g) => s + g.total, 0)} ocorrência(s):\n\n`);
  const mostrados = grupos.slice(0, limite);
  for (const g of mostrados) {
    process.stdout.write(`[${String(g.total).padStart(5)}x] ${g.assinatura}\n`);
    process.stdout.write(`         primeira ${hora(g.primeira)}   última ${hora(g.ultima)}\n`);
    imprimirEnderecosDoGrupo(g);
    const e = g.exemplo.err;
    if (e && e.stack) {
      process.stdout.write(`         ${String(e.stack).split('\n').slice(0, 3).join('\n         ')}\n`);
    }
    process.stdout.write('\n');
  }
  if (grupos.length > limite) process.stdout.write(`... e mais ${grupos.length - limite} assinatura(s). Use --limite.\n`);
  // A ambiguidade é do grupo com UM endereço e MAIS DE UMA ocorrência: uma ocorrência só não
  // tem o que concentrar. O limiar é esse e não um número escolhido a dedo, que seria palpite
  // com cara de medição.
  imprimirNotaDeEndereco(censo, mostrados.some((g) => g.enderecos.distintos === 1 && g.total > 1));
}

/**
 * A tabela de latência, com uma coluna a mais quando o agrupamento é por BUILD.
 *
 * A COLUNA DE RELEASE SÓ APARECE COM `--por-release`, e não sempre com um traço: sem a
 * bandeira o campo é `null` em TODA linha por construção (`criarResumoDeLatencia` só o
 * preenche quando agrupa por ele), e uma coluna inteira de traços ocuparia a largura que a
 * rota usa, sugerindo que a informação não existe no log quando ela existe e não foi pedida.
 *
 * A LINHA SEM BUILD SAI NOMEADA e nunca sumida (`ROTULO_SEM_RELEASE`). `EBGEO_RELEASE` só
 * existe desde o lote A, então num arquivo que atravesse aquele dia esse grupo é o maior de
 * todos; escondê-lo faria a comparação entre duas builds ser feita ignorando a mais antiga
 * das duas, sem dizer que ignorou.
 */
function imprimirLento(linhas, limite, porRelease) {
  if (!linhas.length) {
    process.stdout.write('Nenhuma requisição com duração na janela.\n');
    return;
  }
  const coluna = porRelease ? `  ${'release'.padEnd(20)}` : '';
  process.stdout.write(`     n     p50     p95     máx${coluna}  rota\n`);
  for (const l of linhas.slice(0, limite)) {
    const build = porRelease ? `  ${cortar(l.release ?? ROTULO_SEM_RELEASE, 20).padEnd(20)}` : '';
    process.stdout.write(
      `${String(l.n).padStart(6)}  ${String(l.p50).padStart(5)}ms ${String(l.p95).padStart(5)}ms ${String(l.max).padStart(5)}ms${build}  ${l.rota}\n`
    );
  }
  if (!porRelease) return;
  // A NOTA SAI UMA VEZ, no fim, e ela existe porque a tabela agrupada CONVIDA a uma leitura
  // errada: duas linhas da mesma rota com p95 diferente NÃO provam que o deploy piorou nada.
  // Cada linha tem o `n` dela, e uma build que serviu vinte requisições contra outra que
  // serviu vinte mil produz um p95 que oscila por amostragem, não por código.
  process.stdout.write('\nDuas linhas da mesma rota são duas BUILDS, e a comparação entre elas vale o que vale o\n');
  process.stdout.write('`n` da menor: p95 sobre poucas dezenas de requisições oscila por amostragem. A linha\n');
  process.stdout.write(`"${ROTULO_SEM_RELEASE}" é anterior ao carimbo de build (EBGEO_RELEASE), não é uma build sem nome.\n`);
}

/**
 * O pulso. As TRÊS contagens saem do mesmo denominador (ver `criarResumoDeStatus`), e é
 * isso que mantém a taxa entre 0 e 100.
 *
 * A LINHA FINAL DIZ "requisição", e não "registro": a palavra é o que faz a diferença com
 * `diag -- erros` ser legível. Aqui a unidade é a requisição que falhou; lá é a assinatura
 * distinta, depois de fundir as duas linhas de uma requisição por `reqId`. Os dois números
 * seguem diferentes de propósito, e agora a diferença é explicável em vez de ser o mesmo
 * fato contado duas vezes de um dos lados.
 */
function imprimirStatus({ total, porFaixa, erros }) {
  process.stdout.write(`${total} requisição(ões) na janela\n`);
  for (const faixa of Object.keys(porFaixa).sort()) {
    const n = porFaixa[faixa];
    process.stdout.write(`  ${faixa}: ${String(n).padStart(6)}  (${((n / total) * 100).toFixed(1)}%)\n`);
  }
  // Taxa só existe com denominador: numa janela sem tráfego ela não é 0%, ela não existe.
  const taxa = total > 0 ? `  (${((erros / total) * 100).toFixed(1)}%)` : '';
  process.stdout.write(`\n${erros} requisição(ões) com erro${taxa}. Detalhe: npm run diag -- erros\n`);
}

/**
 * A nota que diz o que a leitura de disco significa, e sobretudo o que ela NÃO significa.
 *
 * Ela sai UMA vez, depois da lista, e em duas versões conforme o estado do campo na janela.
 * Repeti-la por buraco treinaria o olho a pular a lista inteira; omiti-la deixaria um número
 * de MB solto ao lado de um incidente, que é um convite a concluir causa.
 *
 * A REDAÇÃO É DELIBERADA: ela descreve o mecanismo (o destino de arquivo se desliga sozinho e
 * a série some com o processo vivo) e devolve o juízo a quem lê. "O log parou por disco
 * cheio" seria mais curta e mandaria consertar a coisa errada quando o processo tiver morrido
 * por outro motivo com o volume apertado por coincidência.
 */
function imprimirNotaDeDisco(r) {
  if (r.amostrasComDisco) {
    process.stdout.write('\nO disco acima é o que a amostra ANTERIOR a cada buraco registrou, e é INDÍCIO, não\n');
    process.stdout.write('veredito: quando o volume do log enche, o destino de arquivo se desliga sozinho e a\n');
    process.stdout.write('série some do .jsonl com o processo VIVO, produzindo um buraco igual ao da queda.\n');
    process.stdout.write('Compare o livre com o total e julgue: nem o comando nem a amostra afirmam a causa.\n');
    return;
  }
  process.stdout.write('\nNenhuma amostra desta janela traz leitura de disco (o campo é novo, ou a medição não\n');
  process.stdout.write('estava disponível), então o buraco continua AMBÍGUO: processo morto e log em arquivo\n');
  process.stdout.write('desligado por falta de espaço produzem a mesma série, e daqui não dá para separar.\n');
}

/**
 * A saúde do PROCESSO pela série de amostras, e sobretudo pelos buracos dela.
 *
 * A ordem das linhas é a decisão desta função, e não é estética. Primeiro a ÚLTIMA amostra,
 * porque a distância dela até agora é o único número que fala do presente (se ela passou do
 * intervalo, o processo pode estar fora NESTE momento); depois a série; a lista de buracos
 * por último, que é histórico. Um relatório que abrisse pela lista enterraria o "pode estar
 * fora agora" no meio de vinte linhas de passado.
 *
 * As TRÊS ausências saem com todas as letras em vez de virarem zero: nenhuma amostra, uma
 * amostra só, e intervalo INESTIMÁVEL com a série de pé (ver `resumirAmostras`). A terceira
 * foi acrescentada em 2026-09-01 e é a que custou: `faltantes` e `esperadas` chegam `null`,
 * esta função imprimia "FALTARAM null amostra(s) de null esperada(s)" e caía na linha
 * seguinte desreferenciando `maiorBuraco`, saindo com código 1. Um ramo que não existe não é
 * um ramo silencioso, é um `TypeError` na frente do operador durante o incidente.
 *
 * E TODA AFIRMAÇÃO SOBRE FALTANTE CARREGA A PREMISSA (`premissa`), inclusive a
 * tranquilizadora. "Nenhuma amostra faltando" sozinha foi a frase que mentiu: ela lê como
 * saúde medida, quando é só uma divisão pelo intervalo que o próprio comando inferiu.
 */
function imprimirSaude(registros, opcoes) {
  const r = resumirAmostras(registros, opcoes);

  if (r.situacao === 'sem-amostras') {
    process.stdout.write('NENHUMA AMOSTRA DE SAÚDE NA JANELA: o instrumento não produziu nada.\n');
    process.stdout.write('Isto NÃO é "nenhuma queda", é ausência de medição, e as causas são outras:\n');
    process.stdout.write('  amostrador desligado (HEALTH_SAMPLE=off), log em arquivo desligado\n');
    process.stdout.write('  (LOG_TO_FILE), diretório de log errado, ou processo que não subiu na janela.\n');
    if (r.semHorario) {
      process.stdout.write(`\n${r.semHorario} linha(s) de amostra sem horário: existem, mas não têm lugar na série.\n`);
    }
    return;
  }

  process.stdout.write(`Última amostra: ${hora(r.ultima)}  (há ${duracao(r.desdeUltimaMs)})\n`);
  if (r.ultimaAtrasada) {
    process.stdout.write('  ATENÇÃO: passou do intervalo. O processo pode estar FORA agora, e nenhuma\n');
    process.stdout.write('  amostra vai dizer isso: um amostrador dentro do processo não testemunha a\n');
    process.stdout.write('  própria morte. Confira se ele está de pé.\n');
    // O silêncio que ainda está aberto tem a MESMA ambiguidade dos buracos fechados, e a
    // mesma testemunha possível: a última amostra. Sem juízo aqui também, só o número.
    if (r.discoNaUltima) {
      process.stdout.write(`  Nela o disco do log estava em ${r.discoNaUltima.livreMb} MB livres de ${r.discoNaUltima.totalMb} MB (indício,\n`);
      process.stdout.write('  não veredito: log em arquivo desligado produz este mesmo silêncio).\n');
    }
  }
  process.stdout.write(`Primeira amostra: ${hora(r.primeira)}\n`);
  process.stdout.write(`${r.total} amostra(s) na janela.\n`);

  if (r.intervaloMs) {
    const comoSoube = r.intervaloOrigem === 'informado'
      ? 'informado em --intervalo'
      : `INFERIDO do p${r.intervaloPercentil} de ${r.intervaloBase} distância(s), não lido da configuração`;
    process.stdout.write(`Intervalo considerado: ${duracao(r.intervaloMs)} (${comoSoube})\n`);
    if (r.estimativaFragil) {
      process.stdout.write(`  ESTIMATIVA FRÁGIL: com ${r.intervaloBase} distância(s), o p${r.intervaloPercentil} É a MENOR delas, então um\n`);
      process.stdout.write('  único reinício rápido decide este número. Confirme com --intervalo.\n');
    }
  }

  if (r.desconhecidoAntesMs) {
    process.stdout.write(`Antes da primeira amostra: ${duracao(r.desconhecidoAntesMs)} de janela DESCONHECIDA\n`);
    process.stdout.write('  (não é buraco medido: pode ser processo que ainda não tinha subido).\n');
  }

  // A premissa vai DENTRO da frase, e não numa linha acima que o olho pula: "nenhuma amostra
  // faltando" sozinha é a frase que mentiu, porque ela lê como saúde medida quando é só uma
  // divisão por um intervalo que o próprio comando chutou.
  const premissa = r.intervaloOrigem === 'informado'
    ? `supondo o intervalo de ${duracao(r.intervaloMs)} que você informou`
    : `supondo intervalo de ${duracao(r.intervaloMs)}, INFERIDO do p${r.intervaloPercentil} de ${r.intervaloBase} distância(s)`;

  if (r.situacao === 'amostra-unica') {
    process.stdout.write('\nUMA AMOSTRA SÓ: não há distância entre amostras, então não dá para inferir o\n');
    process.stdout.write('intervalo nem afirmar nada sobre buraco. Alargue a janela com --desde.\n');
  } else if (r.faltantes === null) {
    // O terceiro estado. Ele nasce de duas séries diferentes (uma distância só, ou distâncias
    // todas de duração zero), e das duas o número de faltantes fica em ABERTO: imprimi-lo
    // como zero seria a mesma mentira tranquilizadora, e imprimi-lo como `null` era o que
    // derrubava o comando na linha seguinte.
    process.stdout.write('\nNÃO FOI POSSÍVEL ESTIMAR O INTERVALO, e por isso NADA se afirma sobre buraco.\n');
    process.stdout.write(`A série tem ${r.distancias} distância(s) entre amostras, ${r.distanciasUteis} com duração maior que zero,\n`);
    process.stdout.write('e a inferência exige duas: uma distância dividida por si mesma dá zero faltantes\n');
    process.stdout.write('por aritmética, não por medição.\n');
    process.stdout.write('Isto NÃO é "nada faltou". Passe --intervalo (5m, ou o que estiver em\n');
    process.stdout.write('HEALTH_SAMPLE_INTERVAL_MS, que é em ms) para a conta sair sobre premissa declarada.\n');
    if (r.desdeUltimaMs !== null) {
      process.stdout.write(`Sem intervalo também não dá para dizer se a última amostra (há ${duracao(r.desdeUltimaMs)})\n`);
      process.stdout.write('está atrasada, e é por isso que o aviso do presente saiu mudo lá em cima.\n');
    }
  } else if (r.faltantes === 0) {
    process.stdout.write(`\nNenhuma amostra faltando entre a primeira e a última, ${premissa}\n`);
    process.stdout.write(`(${r.total} amostra(s), ${r.esperadas} esperada(s) sob essa premissa).\n`);
    if (r.estimativaFragil) {
      process.stdout.write('  Mas a estimativa é frágil (veja a linha do intervalo): esta tranquilidade vale o\n');
      process.stdout.write('  que vale a premissa. Confirme com --intervalo antes de concluir que está tudo bem.\n');
    }
  } else {
    // A premissa vai junto TAMBÉM aqui, e não só na linha tranquilizadora: uma estimativa
    // baixa demais infla esta contagem, e quem lê precisa poder desconfiar do número sem
    // procurar de onde ele veio.
    process.stdout.write(`\nFALTARAM ${r.faltantes} amostra(s) de ${r.esperadas} esperada(s), em ${r.buracos.length} buraco(s), ${premissa}:\n`);
    for (const b of r.buracos) {
      process.stdout.write(`  [${String(b.faltantes).padStart(4)} faltando] ${hora(b.inicio)} → ${hora(b.fim)}  (${duracao(b.duracaoMs)})\n`);
      // A leitura vai LOGO ABAIXO do buraco a que pertence, porque ela é daquela amostra e de
      // nenhuma outra. Sem leitura na janela inteira não se escreve nada por buraco: a nota
      // sai uma vez, adiante.
      if (b.disco) {
        process.stdout.write(`       disco na amostra anterior: ${b.disco.livreMb} MB livres de ${b.disco.totalMb} MB\n`);
      } else if (r.amostrasComDisco) {
        process.stdout.write('       disco na amostra anterior: sem leitura nessa amostra\n');
      }
    }
    process.stdout.write(`Maior buraco: ${duracao(r.maiorBuraco.duracaoMs)}, a partir de ${hora(r.maiorBuraco.inicio)}\n`);
    imprimirNotaDeDisco(r);
  }

  if (r.falhasDoAmostrador || r.bancoFora || r.semHorario) process.stdout.write('\n');
  if (r.falhasDoAmostrador) {
    process.stdout.write(`${r.falhasDoAmostrador} amostra(s) em que o PRÓPRIO amostrador falhou. Detalhe: npm run diag -- erros\n`);
  }
  if (r.bancoFora) {
    process.stdout.write(`${r.bancoFora} amostra(s) com o banco fora (erro ou prazo). Detalhe: npm run diag -- erros\n`);
  }
  if (r.semHorario) {
    process.stdout.write(`${r.semHorario} linha(s) de amostra sem horário, fora da série.\n`);
  }
}

/**
 * O despejo cru, e ele é CRU dos dois lados: o que se casa e o que se imprime é a linha COMO
 * ELA ESTÁ NO DISCO.
 *
 * Até 2026-09-01 o filtro casava contra `JSON.stringify(reg)`, um texto re-serializado que
 * nunca existiu em arquivo nenhum, e a linha impressa era essa mesma re-serialização. Casar
 * o disco é mais rápido (nenhum objeto é re-serializado) e é a única versão em que o
 * resultado do comando é conferível com um `grep` no mesmo arquivo.
 *
 * A DIFERENÇA APARECE NO ESCAPE, e é a única que aparece: `JSON.parse` seguido de
 * `JSON.stringify` normaliza `"café"` para `"café"`, então o filtro antigo casava a
 * forma que o disco NÃO tem e não casava a que ele tem. Nome de campo casa dos dois jeitos,
 * porque ele é texto na linha também, e é disso que trata a nota do fim.
 *
 * @param {string[]} linhas - as últimas que casaram, em ordem cronológica
 * @param {number} casaram - quantas casaram ao todo (antes do corte)
 * @param {number} naJanela - quantas linhas a janela tem
 * @param {string|null} filtro
 */
function imprimirLinhas(linhas, casaram, naJanela, filtro) {
  for (const linha of linhas) process.stdout.write(`${linha}\n`);
  process.stdout.write(`\n(${casaram} linha(s) casaram; mostrando as ${linhas.length} últimas)\n`);

  // O filtro que casa TUDO não estreitou nada, e quem digitou um nome de campo (`time`,
  // `level`, `msg`) merece saber por que, em vez de concluir que o comando está quebrado ou,
  // pior, que aquelas 402 mil linhas têm todas a ver com o que ele procura.
  if (filtro && naJanela > 0 && casaram === naJanela) {
    process.stdout.write(`\nO filtro casou TODAS as ${naJanela} linha(s) da janela, ou seja, não estreitou nada. O texto\n`);
    process.stdout.write('conferido é a linha como ela está no disco, e ali o NOME de cada campo também é texto:\n');
    process.stdout.write('"time", "level" e "msg" aparecem em toda linha que os tenha. Procure pelo VALOR (um\n');
    process.stdout.write('endereço, um uuid, um trecho de mensagem), não pelo nome do campo.\n');
  }
}

/**
 * O ÚNICO documento que o modo `--json` escreve no stdout.
 *
 * O ENVELOPE TEM TRÊS CAMPOS FIXOS e o resto é a estrutura do comando, espalhada na raiz:
 *
 *   `comando`   — qual dos sete respondeu. Uma saída salva em arquivo perde o comando que a
 *                 produziu, e sem ele `total` e `itens` não dizem de que assunto se trata;
 *   `janela`    — o recorte, e a PROCEDÊNCIA dele (ver a chamada em `main`);
 *   `gerado_em` — quando. Em EPOCH MS, como toda data desta família (o `time` do pino, o
 *                 `primeiraEm` das rotas de defeito). Duas unidades de tempo no mesmo
 *                 documento é conversão errada esperando para acontecer, e ISO aqui ao lado
 *                 de epoch nos itens seria exatamente isso.
 *
 * `null, 2` E NÃO UMA LINHA SÓ, de propósito: o consumidor é um agente ou um `| jq`, e os
 * dois leem indentado; um documento de uma linha com centenas de kB é ilegível no terminal
 * quando alguém esquece o `| jq` e não ganha nada em troca.
 *
 * O `\n` FINAL EXISTE porque um documento sem quebra deixa o prompt colado na última chave.
 *
 * @param {string} comando
 * @param {Object|null} janela
 * @param {Object} estrutura
 */
function escreverJson(comando, janela, estrutura) {
  // O ENVELOPE VEM DEPOIS DO ESPALHAMENTO, e a ordem é a guarda: com ele antes, uma
  // estrutura que um dia ganhasse um campo `janela` (ou `comando`, ou `gerado_em`)
  // SOBRESCREVERIA a procedência, calada, e o documento passaria a mentir sobre de onde
  // veio. Invertida, a procedência sempre ganha. E a colisão não passa em silêncio pelo
  // outro lado: um campo do comando desaparecendo do documento é defeito igual, só que
  // mais difícil de notar, então ela LANÇA em vez de escolher um vencedor.
  for (const chave of ['comando', 'janela', 'gerado_em']) {
    if (Object.hasOwn(estrutura, chave)) {
      throw new Error(`estrutura de "${comando}" colide com o campo de envelope "${chave}"`);
    }
  }
  process.stdout.write(`${JSON.stringify({
    ...estrutura, comando, janela, gerado_em: Date.now(),
  }, null, 2)}\n`);
}

/* ------------------------------------------------------------------------------------- *
 *  `defeitos` e `pilha`: a metade que lê o BANCO.
 * ------------------------------------------------------------------------------------- */

/**
 * O pool, aberto TARDE e uma vez só.
 *
 * `src/database/index.js` cria o pool na avaliação do módulo e importa `config.js`, que
 * exige `DATABASE_URL` e `JWT_SECRET`. Um `import` no topo deste arquivo faria os CINCO
 * comandos de log passarem a exigir banco configurado, que é exatamente a propriedade que o
 * comentário de `--dir` existe para preservar: a hora de ler log é a hora em que alguma
 * coisa não está de pé.
 */
let bancoAberto = null;

async function abrirBanco() {
  if (bancoAberto) return bancoAberto;
  // O LOGGER DA APLICAÇÃO É SILENCIADO ANTES DO POOL, e isso não é higiene: é o contrato do
  // `--json`. O hook `error` de `database/index.js` loga em `error`, que está sempre ligado,
  // e o pino escreve no STDOUT — ou seja, um Postgres fora fazia a linha "DB Error" (com
  // pilha, em várias linhas) sair ANTES do documento JSON, quebrando todo `| jq` exatamente
  // no cenário que o `resumo` existe para atravessar. O comando relata a falha com as
  // próprias palavras, no stderr, e é essa mensagem que serve a quem lê.
  //
  // Vale para os cinco comandos de banco pelo mesmo motivo, e tem um efeito colateral
  // desejado: uma LEITURA de diagnóstico deixa de escrever no `.jsonl` que ela está lendo.
  const { default: registrador } = await import('../src/utils/logger.js');
  registrador.level = 'silent';
  bancoAberto = await import('../src/database/index.js');
  return bancoAberto;
}

/**
 * Fecha o pool, senão o processo NÃO SAI.
 *
 * O `pg-promise` mantém as conexões do pool vivas, e um handle aberto segura o loop de
 * eventos: sem isto o comando imprime a resposta inteira e fica pendurado no terminal, que
 * se lê como consulta lenta. `pgp.end()` devolve `undefined` em algumas versões, então nada
 * de encadear nele (o mesmo cuidado está em `scripts/models3d-adotar.js`).
 */
async function fecharBanco() {
  if (!bancoAberto) return;
  await Promise.resolve(bancoAberto.pgp.end()).catch(() => {});
  bancoAberto = null;
}

/** UUID v4 canônico, o formato que a coluna `id` de `defeitos` tem. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Corta um texto no comprimento pedido, marcando o corte.
 *
 * A MARCA É OBRIGATÓRIA e é a razão de a função existir: uma mensagem de erro cortada em
 * silêncio no meio de uma frase se lê como a mensagem INTEIRA, e quem procura o texto no
 * código não acha. O `--json` nunca corta nada, e é lá que está o valor completo.
 */
function cortar(texto, tamanho) {
  const t = texto === null || texto === undefined ? '' : String(texto).replace(/\s+/g, ' ');
  return t.length <= tamanho ? t : `${t.slice(0, tamanho - 1)}…`;
}

/** `hora()` com os milissegundos, que a linha do tempo de migalhas precisa para ordenar. */
function horaFina(t) {
  if (typeof t !== 'number') return '?';
  return `${hora(t)}.${String(new Date(t).getMilliseconds()).padStart(3, '0')}`;
}

/**
 * A tabela de defeitos, uma linha por assinatura.
 *
 * O ID SAI CURTO (oito caracteres) e isso é uma aposta declarada: ele serve para o olho
 * reconhecer a linha, e `--id` exige o UUID inteiro, que sai no `--json`. Imprimir os 36 na
 * tabela empurraria a mensagem, que é a coluna que se lê de fato, para fora da largura do
 * terminal.
 *
 * A CONTAGEM DE ANTES DO CORTE VEM JUNTO pelo mesmo motivo do `totalAssinaturas` da rota:
 * "50 defeitos" é indistinguível de "50 de 400", e quem lê conclui que viu tudo.
 */
function imprimirDefeitos({ totalDefeitos, itens }, limite) {
  if (!itens.length) {
    process.stdout.write('Nenhum defeito na janela com estes filtros.\n');
    return;
  }
  process.stdout.write(`${totalDefeitos} defeito(s) na janela; mostrando ${itens.length}.\n\n`);
  process.stdout.write(
    `${'estado'.padEnd(10)} ${'ocorr'.padStart(7)}  ${'origem'.padEnd(12)} ${'1ª release'.padEnd(14)} ${'últ. release'.padEnd(14)} ${'página'.padEnd(10)} ${'mensagem'.padEnd(44)} id\n`
  );
  for (const d of itens) {
    process.stdout.write(
      `${cortar(d.estado, 10).padEnd(10)} ${String(d.ocorrencias).padStart(7)}  `
      + `${cortar(d.origem, 12).padEnd(12)} ${cortar(d.primeiraRelease, 14).padEnd(14)} `
      + `${cortar(d.ultimaRelease, 14).padEnd(14)} ${cortar(d.pagina, 10).padEnd(10)} `
      + `${cortar(d.mensagem, 44).padEnd(44)} ${String(d.id).slice(0, 8)}\n`
    );
  }
  if (totalDefeitos > itens.length) {
    process.stdout.write(`\n... e mais ${totalDefeitos - itens.length}, fora do --limite de ${limite}.\n`);
  }
  process.stdout.write('\nDetalhe de um: npm run diag -- defeitos --id <uuid>   (o uuid inteiro sai no --json)\n');
}

/**
 * UM defeito com suas ocorrências, e as MIGALHAS como linha do tempo.
 *
 * A LINHA DO TEMPO É O MOTIVO DE A TELA EXISTIR. A linha agregada responde "o quê e quantas
 * vezes"; a ocorrência responde "em qual aba, em qual página, com qual requisição"; e a
 * migalha responde "o que a pessoa tinha acabado de fazer", que é a única das três que
 * costuma explicar o defeito. Ela sai em ordem CRONOLÓGICA (como o cliente a montou), com o
 * horário fino, porque migalhas de um mesmo gesto caem no mesmo segundo e a ordem é a
 * informação.
 */
function imprimirUmDefeito(d, ocorrencias) {
  process.stdout.write(`${d.id}   [${d.estado}]   ${d.ocorrencias} ocorrência(s)\n`);
  process.stdout.write(`assinatura : ${d.assinatura}\n`);
  process.stdout.write(`mensagem   : ${d.mensagem}\n`);
  process.stdout.write(`origem     : ${d.origem ?? '-'}   página: ${d.pagina ?? '-'}   atlas: ${d.atlasId ?? '-'}\n`);
  process.stdout.write(`release    : primeira ${d.primeiraRelease ?? '-'} → última ${d.ultimaRelease ?? '-'}\n`);
  process.stdout.write(`visto      : ${hora(d.primeiraEm)} → ${hora(d.ultimaEm)}\n`);
  process.stdout.write(`url        : ${d.url ?? '-'}\n`);
  process.stdout.write(`usuário    : ${d.username ?? '(anônimo)'}   sessão: ${d.sessaoId ?? '-'}\n`);
  if (d.estado === 'resolvido' || d.estado === 'regrediu') {
    process.stdout.write(
      `resolvido  : ${hora(d.resolvidoEm)} por ${d.resolvidoPorUsername ?? '?'} na release ${d.resolvidoNaRelease ?? '(não anotada)'}`
      + `${d.resolvidoNoCommit ? ` (commit ${d.resolvidoNoCommit})` : ''}\n`
    );
  }
  if (d.stackBruta) {
    process.stdout.write('\npilha crua (da PRIMEIRA vez; desminifique com: npm run diag -- pilha --id <uuid> --mapas <dir>):\n');
    for (const linha of String(d.stackBruta).split(/\r?\n/).slice(0, 6)) {
      process.stdout.write(`  ${linha}\n`);
    }
  }

  if (!ocorrencias.length) {
    process.stdout.write('\nNenhuma ocorrência guardada. Isto NÃO é "nunca ocorreu": a tabela de ocorrências\n');
    process.stdout.write('nasceu depois da de defeitos, e a poda por idade apaga as duas juntas.\n');
    return;
  }
  process.stdout.write(`\n${ocorrencias.length} ocorrência(s) guardada(s), da mais recente para a mais antiga:\n`);
  for (const o of ocorrencias) {
    process.stdout.write(`\n  ${hora(o.em)}   release ${o.release ?? '-'}   página ${o.pagina ?? '-'}   sessão ${o.sessaoId ?? '-'}\n`);
    if (o.rota || o.statusCode || o.reqId) {
      process.stdout.write(`      rota ${o.rota ?? '-'}   status ${o.statusCode ?? '-'}   req ${o.reqId ?? '-'}\n`);
    }
    const migalhas = Array.isArray(o.migalhas) ? o.migalhas : [];
    if (!migalhas.length) continue;
    process.stdout.write('      migalhas:\n');
    for (const m of migalhas) {
      process.stdout.write(`        ${horaFina(m.t).padEnd(26)} ${cortar(m.tipo, 12).padEnd(12)} ${m.texto ?? ''}\n`);
    }
  }
}

/**
 * A pilha desminificada, quadro a quadro.
 *
 * O QUADRO CRU VAI JUNTO DO RESOLVIDO, indentado embaixo, e não é redundância: é a evidência
 * de onde a resposta veio. Sem ele, um mapeamento errado (coluna deslocada por um, mapa de
 * outro chunk com o mesmo nome) é indistinguível de um certo, e a saída deste comando é
 * justamente o tipo de coisa que se copia para um relatório sem conferir.
 *
 * OS TRÊS MOTIVOS DE NÃO RESOLVER SAEM COM NOMES DIFERENTES (ver `resolverQuadros`), porque
 * "não achei o `.map`" e "achei e a posição não cai em segmento nenhum" mandam procurar
 * coisas opostas: a primeira é build publicada sem mapa, a segunda é coluna ou mapa errados.
 */
function imprimirPilha(quadros) {
  for (const q of quadros) {
    if (q.motivo === 'sem-quadro') {
      process.stdout.write(`${q.bruta}\n`);
      continue;
    }
    if (q.resolvido) {
      // A COLUNA SAI 1-BASED AQUI, e só aqui. O `.map` é 0-based nas duas coordenadas, mas
      // a LINHA já sai 1-based (o formato conta a partir de zero e a referência humana
      // conta a partir de um), então imprimir a coluna crua ao lado dela produziria
      // `arquivo:10:6` com DOIS sistemas de contagem na mesma referência, e um editor abre
      // isso na coluna errada. O `--json` continua 0-based em `colunaOriginal`, porque lá o
      // consumidor é código e a convenção do formato é a que vale; a diferença está escrita
      // no cabeçalho de `scripts/diag/mapa-de-fonte.js`.
      const coluna = q.colunaOriginal + 1;
      process.stdout.write(`  ${q.fonte}:${q.linhaOriginal}:${coluna}${q.nome ? ` (${q.nome})` : ''}\n`);
    } else {
      const marca = q.motivo === 'sem-mapa' ? '[sem mapa]' : '[sem segmento]';
      process.stdout.write(`  ${marca} ${q.arquivo ?? q.url}:${q.linha}:${q.coluna}${q.erroDoMapa ? `  (${q.erroDoMapa})` : ''}\n`);
    }
    process.stdout.write(`      ← ${q.bruta.trim()}\n`);
  }
}

/**
 * A explicação da recusa, ESCRITA UMA VEZ e usada pelas duas saídas.
 *
 * Ela sai no stderr no modo humano e vai dentro do documento no `--json`, e é a mesma string
 * nos dois porque duas redações da mesma recusa divergem no dia em que alguém melhorar uma:
 * é o argumento que este repositório aplica a `denialNotice` no cliente e ao par de frases do
 * 360, e vale igual aqui.
 */
const EXPLICACAO_DA_RECUSA = 'NADA foi resolvido, de propósito: os endereços desta pilha só significam alguma coisa '
  + 'lidos contra o bundle que a produziu. Contra outra build a resolução NÃO falha, ela devolve '
  + 'funções e linhas plausíveis e ERRADAS, que é pior que pilha nenhuma.';

/**
 * O bloco que sai quando NENHUMA build declara a release da pilha.
 *
 * ELE É A PEÇA CENTRAL DO COMANDO, e não um caso de erro. Ver o cabeçalho de
 * `scripts/diag/pilha.js`: resolver contra outra build não falha, devolve nomes e linhas
 * plausíveis e errados, e um relatório assim custa mais que pilha nenhuma. As candidatas vão
 * junto porque elas separam os dois diagnósticos ("digitei o caminho errado" e "a build foi
 * podada"), e a pilha crua vai junto porque ela é o que o operador ainda pode usar.
 */
function imprimirPilhaSemRelease(release, raiz, candidatas, stackBruta) {
  process.stderr.write(`NENHUMA BUILD SOB ${path.resolve(raiz)} DECLARA A RELEASE "${release}".\n`);
  process.stderr.write(`${EXPLICACAO_DA_RECUSA}\n`);
  if (candidatas.length) {
    process.stderr.write(`\nO que há ali (${candidatas.length}):\n`);
    for (const c of candidatas) process.stderr.write(`  ${c.release}   ${c.diretorio}\n`);
  } else {
    process.stderr.write('\nNenhum release.json foi encontrado ali, nem na raiz nem um nível abaixo. Aponte\n');
    process.stderr.write('--mapas para o dist/ de uma build ou para o diretório que contém as builds.\n');
  }
  process.stderr.write('\npilha crua:\n');
  process.stdout.write(`${stackBruta}\n`);
}

/**
 * Busca um defeito pelo id, validando o formato ANTES de ir ao banco.
 *
 * A VALIDAÇÃO É NA BORDA porque o desfecho sem ela é ilegível: `id` é UUID, e um texto que
 * não seja UUID levanta `22P02` no driver, que chega ao terminal como um erro de sintaxe de
 * entrada para tipo uuid, sem relação aparente com o argumento que o operador digitou. É a
 * mesma razão pela qual `audit_trail.target_id` nasceu TEXT (ver `backend/CLAUDE.md`).
 *
 * @returns {Promise<{defeito: Object|null, erro: string|null}>}
 */
async function buscarDefeito(id) {
  if (!id) return { defeito: null, erro: 'Falta --id <uuid>.' };
  if (!UUID.test(id)) return { defeito: null, erro: `--id não é um uuid: "${id}".` };
  // A CONSULTA E O MAPEAMENTO VÊM DO SERVIÇO, como a listagem logo abaixo: `obterDefeito` é
  // a mesma função que a rota usaria, sobre o mesmo mapeador. Enquanto o módulo esteve
  // congelado isto morou fora de `src/`, com uma cópia do SELECT e do mapeamento de colunas;
  // a cópia morreu quando o SQL voltou para casa, e é isso que garante que `defeitos` e
  // `defeitos --id` respondam o MESMO objeto sobre o mesmo defeito, que é a comparação que
  // um agente faz para se orientar.
  //
  // O `abrirBanco()` continua aqui e não é redundante: ele é o que REGISTRA o módulo do
  // banco para `fecharBanco()`, e sem o par o pool fica aberto e o comando pendura o
  // terminal depois de imprimir a resposta inteira.
  await abrirBanco();
  const { obterDefeito } = await import('../src/modules/diag/defeitos.service.js');
  const defeito = await obterDefeito(id);
  if (!defeito) {
    return {
      defeito: null,
      erro: `Nenhum defeito com id ${id}. A poda por idade apaga defeito e ocorrências juntos,`
        + ' então um id que a listagem mostrou minutos atrás pode ter envelhecido.',
    };
  }
  return { defeito, erro: null };
}

/**
 * `defeitos`: a listagem, ou UM defeito com suas ocorrências.
 *
 * A LISTAGEM VEM INTEIRA DE `listarDefeitos` (`src/modules/diag/defeitos.service.js`), a
 * mesma função que serve `GET /diag/defeitos`. Nem o SQL, nem os filtros, nem o mapeamento
 * de colunas são reescritos aqui: uma segunda verdade sobre o que "defeito aberto na janela"
 * significa faria a tela e o comando divergirem no dia em que um dos dois fosse consertado,
 * e o comando é o que um agente lê.
 *
 * @returns {Promise<{codigo: number, estrutura: Object|null}>}
 */
async function comandoDefeitos(op) {
  const limite = op.limite || 50;

  if (op.id !== null) {
    const { defeito, erro } = await buscarDefeito(op.id);
    if (!defeito) {
      process.stderr.write(`${erro}\n`);
      return { codigo: 1, estrutura: null };
    }
    const { listarOcorrencias } = await import('../src/modules/diag/defeitos.service.js');
    const { itens } = await listarOcorrencias(defeito.id);
    return { codigo: 0, estrutura: { defeito, ocorrencias: itens }, imprimir: () => imprimirUmDefeito(defeito, itens) };
  }

  const { listarDefeitos } = await import('../src/modules/diag/defeitos.service.js');
  const r = await listarDefeitos({
    desde: op.desde,
    estado: op.estado,
    origem: op.origem,
    release: op.release,
    pagina: op.pagina,
    novos: op.novos,
    limite,
  });
  const filtros = {
    estado: op.estado, origem: op.origem, release: op.release, pagina: op.pagina, novos: op.novos, limite,
  };
  return {
    codigo: 0,
    estrutura: { totalDefeitos: r.totalDefeitos, itens: r.itens, filtros },
    imprimir: () => imprimirDefeitos(r, limite),
  };
}

/**
 * `pilha`: desminifica `stack_bruta` contra os `.map` da release que a produziu.
 *
 * OS CÓDIGOS DE SAÍDA SÃO TRÊS E SIGNIFICAM COISAS DIFERENTES: 0 resolveu (ainda que alguns
 * quadros fiquem sem mapa), 1 é erro de uso ou defeito inexistente, e 2 é a recusa
 * deliberada, quando nenhuma build sob `--mapas` declara a release. O 2 existe separado
 * justamente para que um roteiro possa distinguir "não deu para responder" de "respondi", em
 * vez de tratar a recusa como falha genérica.
 *
 * @returns {Promise<{codigo: number, estrutura: Object|null}>}
 */
async function comandoPilha(op) {
  const { defeito, erro } = await buscarDefeito(op.id);
  if (!defeito) {
    process.stderr.write(`${erro}\n`);
    return { codigo: 1, estrutura: null };
  }
  if (!defeito.stackBruta) {
    process.stderr.write(`O defeito ${defeito.id} não tem pilha crua (\`stack_bruta\` nula), então não há o que desminificar.\n`);
    process.stderr.write('Ela só é gravada quando o relato do cliente a traz, e fica fixada na PRIMEIRA vez.\n');
    return { codigo: 1, estrutura: null };
  }

  // `primeira_release` É OPCIONAL, e sem ela não há PERGUNTA a fazer ao disco. Cair na
  // recusa genérica produzia a frase 'NENHUMA BUILD ... DECLARA A RELEASE "null"', que
  // manda o operador procurar uma build chamada null; e passar `null` à busca casaria com
  // qualquer `release.json` que também não declarasse a sua, ou seja, resolveria contra uma
  // build arbitrária, que é exatamente o que este comando existe para não fazer. Código 1
  // e não 2: o 2 significa "a build não está aqui", e aqui o que falta é o dado.
  if (!defeito.primeiraRelease) {
    process.stderr.write(`O defeito ${defeito.id} não tem release do primeiro avistamento (\`primeira_release\` nula).\n`);
    process.stderr.write('A pilha crua só pode ser lida contra o bundle que a produziu, e sem esse campo não\n');
    process.stderr.write('há como saber qual foi. Ela é gravada quando o relato traz a release, e relato sem\n');
    process.stderr.write('ela deixa a coluna vazia para sempre: a pilha crua fica fixada no PRIMEIRO avistamento.\n');
    return { codigo: 1, estrutura: null };
  }

  const quadros = analisarPilha(defeito.stackBruta);
  const { diretorio, candidatas } = localizarReleaseDeMapas(op.mapas, defeito.primeiraRelease);
  const cabecalho = {
    defeito: { id: defeito.id, estado: defeito.estado, mensagem: defeito.mensagem, ocorrencias: defeito.ocorrencias },
    release: defeito.primeiraRelease,
    mapas: path.resolve(op.mapas),
    candidatas,
  };

  if (!diretorio) {
    return {
      codigo: 2,
      estrutura: {
        ...cabecalho,
        diretorio: null,
        // A RECUSA É UM CAMPO, e não a ausência de `diretorio`, porque o consumidor do
        // `--json` é um roteiro: ele precisa de algo que se leia como decisão declarada, não
        // de um nulo que se possa interpretar como "não consegui". A explicação vem da mesma
        // constante que o modo humano imprime.
        recusa: { motivo: 'release-nao-encontrada', explicacao: EXPLICACAO_DA_RECUSA },
        stackBruta: defeito.stackBruta,
        quadros,
      },
      imprimir: () => imprimirPilhaSemRelease(defeito.primeiraRelease, op.mapas, candidatas, defeito.stackBruta),
    };
  }

  const resolvidos = resolverQuadros(quadros, diretorio, resolverPosicao);
  return {
    codigo: 0,
    estrutura: { ...cabecalho, diretorio, quadros: resolvidos },
    imprimir: () => {
      process.stdout.write(`# defeito ${defeito.id} [${defeito.estado}] | release ${defeito.primeiraRelease} | ${diretorio}\n\n`);
      imprimirPilha(resolvidos);
    },
  };
}


/**
 * `resolver`, `ignorar`, `reabrir`: os três atos de ciclo de vida, pelo terminal.
 *
 * OS TRÊS CHAMAM A MESMA FUNÇÃO QUE A ROTA CHAMA (`mudarEstadoDoDefeito`,
 * `src/modules/diag/defeitos.service.js`), e isso é a regra deste comando desde o `defeitos`:
 * uma segunda verdade sobre o que "resolver um defeito" significa faria a tela e o terminal
 * divergirem no dia em que um dos dois fosse consertado. Aqui o preço de divergir seria
 * maior que na leitura, porque este caminho ESCREVE: um UPDATE próprio aqui perderia a
 * limpeza das quatro colunas ao reabrir, ou a linha de trilha, ou as duas, e nada ficaria
 * vermelho.
 *
 * A ORDEM DAS RECUSAS É DELIBERADA, e é a mesma de `comandoDeBanco`: o que se confere sem
 * banco vem primeiro. Falta de `--id`, id malformado, verbo desconhecido e falta de `--como`
 * são erros de USO, e cobrá-los antes do pool troca a frase errada ("não consegui abrir o
 * banco", quando o Postgres está fora) pela certa.
 *
 * O `--como` É RESOLVIDO ANTES DO DEFEITO, e não depois. As duas ordens funcionam, e esta é
 * a que erra menos: um operador que digitou o usuário errado descobre isso sem que nada
 * tenha sido lido nem escrito, e a mensagem fala do argumento que ele acabou de digitar.
 *
 * @returns {Promise<{codigo: number, estrutura: Object|null, imprimir?: Function}>}
 */
async function comandoCicloDeVida(op) {
  const estado = ESTADO_DO_VERBO[op.comando];

  if (!op.id) {
    process.stderr.write(`Falta o id do defeito: npm run diag -- ${op.comando} <uuid> --como <usuário>\n`);
    process.stderr.write('O uuid inteiro sai no `npm run diag -- defeitos --json` (a tabela mostra só os 8 primeiros).\n');
    return { codigo: 1, estrutura: null };
  }
  if (!UUID.test(op.id)) {
    process.stderr.write(`--id não é um uuid: "${op.id}".\n`);
    return { codigo: 1, estrutura: null };
  }
  if (!op.como) {
    process.stderr.write('Falta --como <usuário>: este comando ESCREVE e deixa linha na trilha de auditoria,\n');
    process.stderr.write('e `audit_trail.actor_id` é NOT NULL. O terminal não tem sessão, então quem opera\n');
    process.stderr.write('precisa se nomear; sem isso o ato mais consequente deste módulo ficaria sem autor.\n');
    process.stderr.write('Ele NÃO é autenticação (quem tem shell no servidor tem DATABASE_URL): é ATRIBUIÇÃO.\n');
    return { codigo: 1, estrutura: null };
  }

  const { resolverAtorAdministrador, mudarEstadoDoDefeito } = await import('../src/modules/diag/defeitos.service.js');

  const { ator, motivo } = await resolverAtorAdministrador(op.como);
  if (!ator) {
    // AS DUAS RECUSAS TÊM FRASES DIFERENTES porque mandam fazer coisas opostas: conferir o
    // que se digitou, ou pedir a outra pessoa. Colapsá-las numa só ("não pude usar essa
    // conta") economizaria três linhas e devolveria a resposta errada em metade das vezes.
    if (motivo === 'inexistente') {
      process.stderr.write(`Não há conta ATIVA com o usuário "${op.como}".\n`);
      process.stderr.write('Confira o nome; conta desativada também não serve como ator, porque a rota\n');
      process.stderr.write('equivalente a recusaria com 401 antes de qualquer gate de papel.\n');
    } else {
      process.stderr.write(`A conta "${op.como}" existe e NÃO é administrador do sistema.\n`);
      process.stderr.write('O eixo aqui é o papel GLOBAL, e ele não é uma escada: manter o acervo da própria OM\n');
      process.stderr.write('(producer) e ler todo recurso privado (credenciado) não são administrar o sistema.\n');
      process.stderr.write('O comando não pode assinar como administrador um ato que a rota recusaria.\n');
    }
    return { codigo: 1, estrutura: null };
  }

  // A RECUSA DO SERVIÇO VIRA FRASE, e não pilha. Sem este `catch`, um `--commit` longo
  // demais subia até `main().catch`, que imprime "diag falhou:" mais o rastro inteiro: o
  // operador leria um erro de programa onde há um argumento errado. `ValidationError` é a
  // única que se espera aqui, e o CÓDIGO dela é o filtro: qualquer outra coisa (banco fora,
  // defeito de código) continua subindo com a pilha, que é onde ela serve.
  //
  // O FILTRO É `code`, E NÃO `name`, e isso foi MEDIDO em vez de suposto: as subclasses de
  // `AppError` (`src/utils/errors.js`) não escrevem `this.name`, então `err.name` herda
  // `Error.prototype.name` e vale a string "Error" para TODAS elas. Um filtro por `name`
  // rejeitaria a própria recusa que este ramo existe para tratar, e o sintoma seria a pilha
  // crua de volta. `code` é o identificador de máquina, posto pelo construtor de propósito.
  let r;
  try {
    r = await mudarEstadoDoDefeito({
      id: op.id, estado, commit: op.commit, userId: ator.id,
    });
  } catch (err) {
    if (err?.code !== 'VALIDATION_ERROR') throw err;
    process.stderr.write(`${err.message}\n`);
    process.stderr.write('Nada foi alterado.\n');
    return { codigo: 1, estrutura: null };
  }
  if (!r) {
    process.stderr.write(`Nenhum defeito com id ${op.id}. Nada foi alterado.\n`);
    process.stderr.write('A poda por idade apaga defeito e ocorrências juntos, então um id que a listagem\n');
    process.stderr.write('mostrou minutos atrás pode ter envelhecido.\n');
    return { codigo: 1, estrutura: null };
  }

  return {
    codigo: 0,
    estrutura: { defeito: r.item, transicao: { de: r.de, para: r.para }, ator },
    imprimir: () => imprimirTransicao(r, ator),
  };
}

/**
 * O que o terminal mostra depois de um ato de ciclo de vida.
 *
 * O `de` SAI JUNTO DO `para`, e não só o estado final. Um comando que respondesse apenas
 * "resolvido" seria indistinguível quando o defeito JÁ estava resolvido, e essa é
 * exatamente a situação em que o operador precisa saber que não mudou nada (ele acabou de
 * repetir um comando, ou outra pessoa chegou antes). A transição sem efeito sai NOMEADA.
 *
 * A RELEASE ANOTADA SAI SEMPRE QUE HÁ UMA, e a ausência dela também, porque
 * `resolvido_na_release` é a coluna que decide REGRESSÃO. O efeito de resolver SEM ela é o
 * INVERSO do que a leitura natural sugere, e esta linha já afirmou o inverso: NULA, a coluna
 * faz o `IS DISTINCT FROM` do UPSERT ser VERDADEIRO contra qualquer valor, então a próxima
 * ocorrência que TRAGA release reabre o defeito como `regrediu`. Não é que ele congele
 * resolvido, é que ele volta assim que alguém relatar de uma build identificada (ocorrência
 * SEM release não move nada, pelo `AND EXCLUDED.release IS NOT NULL` do mesmo CASE). Quem
 * resolve em desenvolvimento, onde `EBGEO_RELEASE` não existe, precisa saber disso na hora,
 * para não ler a volta do defeito como conserto que não pegou.
 */
function imprimirTransicao(r, ator) {
  const d = r.item;
  process.stdout.write(`${d.id}\n`);
  process.stdout.write(`${cortar(d.mensagem, 100)}\n\n`);
  if (r.de === r.para) {
    process.stdout.write(`estado: ${r.para}  (já estava assim; nada mudou de estado)\n`);
  } else {
    process.stdout.write(`estado: ${r.de} → ${r.para}\n`);
  }
  process.stdout.write(`por    : ${ator.username}\n`);

  if (r.para === EstadoDeDefeito.RESOLVIDO) {
    process.stdout.write(`release: ${d.resolvidoNaRelease ?? '(não anotada)'}`);
    process.stdout.write(`${d.resolvidoNoCommit ? `   commit: ${d.resolvidoNoCommit}` : ''}\n`);
    if (!d.resolvidoNaRelease) {
      process.stdout.write('\nSEM RELEASE ANOTADA, e isso tem consequência: `resolvido_na_release` é a coluna que\n');
      process.stdout.write('decide REGRESSÃO, e o UPSERT compara com `IS DISTINCT FROM`. Com ela NULA, a próxima\n');
      process.stdout.write('ocorrência que TRAGA release reabre este defeito como `regrediu`, porque qualquer valor\n');
      process.stdout.write('é distinto de NULL. É o desfecho conservador certo (sem saber em qual build o conserto\n');
      process.stdout.write('entrou, não dá para afirmar que a ocorrência nova veio da build velha), mas espere ver\n');
      process.stdout.write('o defeito voltar. Ocorrência SEM release não move nada. A release é a do SERVIDOR\n');
      process.stdout.write('(EBGEO_RELEASE), e em desenvolvimento não existe nenhuma.\n');
    }
  }
  if (r.para === EstadoDeDefeito.ABERTO && r.de !== EstadoDeDefeito.ABERTO) {
    process.stdout.write('\nAs quatro colunas de conserto foram LIMPAS (quem, quando, release, commit). É o que\n');
    process.stdout.write('faz "reaberto" significar "esqueça o conserto anterior": deixadas para trás, toda\n');
    process.stdout.write('tela que as mostra diria "resolvido por fulano" ao lado do estado "aberto".\n');
  }
}


/**
 * Quantos defeitos o `resumo` pede ao banco.
 *
 * É o TETO do Joi da rota irmã, e de propósito: o bloco 1 calcula "os cinco maiores" sobre a
 * lista que veio, e quanto mais linhas vierem menos frequente é a discordância entre esse
 * topo e o topo real. Ele não pode ser ilimitado (a tabela cresce com a VARIEDADE de
 * defeitos, que é limitada, mas não é um), e a lista PARCIAL sai declarada na premissa do
 * bloco, que é o que impede o número de mentir quando o corte morde.
 */
const DEFEITOS_DO_RESUMO = 200;

/** O diretório de log a usar: `--dir`, o de `LOG_DIR`, ou o default embutido. */
async function resolverDiretorioDeLog(op) {
  if (op.dir) return op.dir;
  try {
    return (await import('../src/config.js')).default.log.dir;
  } catch {
    return './data/logs';
  }
}

/**
 * `resumo`: UMA tela com os cinco blocos, e o único comando HÍBRIDO.
 *
 * ELE TOLERA A AUSÊNCIA DE CADA FONTE, uma de cada vez, e é isso que o separa dos outros
 * sete. Os cinco de arquivo morrem com `Diretório de log não encontrado` e código 1; os dois
 * de banco morrem com `Não foi possível abrir o banco`. Aqui as duas coisas são NORMAIS: o
 * relatório continua saindo, com os blocos que a fonte viva sustenta, e cada bloco órfão diz
 * por que está vazio em vez de imprimir zero. Um relatório de uma tela que morresse inteiro
 * porque metade dele não pôde ser calculada seria inútil justamente durante o incidente, que
 * é quando uma das duas fontes está fora.
 *
 * A LEITURA É UMA PASSADA SOBRE O DOBRO DA JANELA, e não duas passadas. O bloco 2 compara a
 * janela atual com a ANTERIOR do mesmo tamanho, então o arquivo precisa ser varrido de
 * `agora - 2j` até agora, e cada registro cai num dos dois acumuladores pelo `time`. Duas
 * passadas custariam o dobro de leitura de disco para separar o que uma comparação já separa
 * (o `erros` faz duas passadas por outro motivo, que é precisar de um índice completo ANTES
 * de agregar; aqui não há essa dependência).
 *
 * AS LINHAS DA PREMISSA SÃO AS DA JANELA ATUAL, e não as do dobro. `percorrerRegistros`
 * devolve o total que ele leu, e publicar esse número faria a premissa do relatório dizer o
 * dobro do que os blocos mediram, que é pior que não ter número: ele é justamente o campo
 * que existe para tornar a resposta falsificável.
 *
 * @returns {Promise<void>}
 */
async function comandoResumo(op, janela) {
  const agora = new Date();
  const inicio = agora.getTime() - janela;
  const dir = await resolverDiretorioDeLog(op);
  const ausente = !fs.existsSync(dir);

  let leitura;
  let latencia = [];
  let latenciaAnterior = [];
  let amostras = null;
  let status = null;
  const queriesLentas = { janela: 0, anterior: 0 };

  if (!ausente) {
    const atual = criarResumoDeLatencia();
    const passada = criarResumoDeLatencia();
    const contagem = criarResumoDeStatus();
    const linhasDeAmostra = [];
    let linhasNaJanela = 0;

    const lida = await percorrerRegistros(dir, janela * 2, agora, (reg) => {
      // SEM `time` A LINHA CONTA COMO DA JANELA ATUAL, e não é descuido: `percorrerRegistros`
      // já a deixou passar pelo mesmo critério (ele só corta o que TEM `time` e é antigo), e
      // mandá-la para a janela anterior a colocaria na base de comparação de um período que
      // ela não representa. A direção do erro é conservadora: ela infla o "agora", que é o
      // lado que o operador olha com atenção.
      const naJanela = typeof reg.time !== 'number' || reg.time >= inicio;
      if (!naJanela) {
        passada.ver(reg);
        if (reg.msg === MARCADOR_QUERY_LENTA) queriesLentas.anterior += 1;
        return;
      }
      linhasNaJanela += 1;
      atual.ver(reg);
      contagem.ver(reg);
      if (reg.amostra === MARCADOR_AMOSTRA) linhasDeAmostra.push(reg);
      if (reg.msg === MARCADOR_QUERY_LENTA) queriesLentas.janela += 1;
    });

    leitura = {
      diretorio: path.resolve(dir), ausente: false, arquivos: lida.arquivosLidos, linhas: linhasNaJanela,
    };
    latencia = atual.resultado();
    latenciaAnterior = passada.resultado();
    amostras = resumirAmostras(linhasDeAmostra, {
      intervaloMs: op.intervalo === null ? null : parseIntervalo(op.intervalo),
      agora: agora.getTime(),
      inicio,
    });
    status = contagem.resultado();
  } else {
    leitura = { diretorio: path.resolve(dir), ausente: true, arquivos: 0, linhas: 0 };
  }

  let defeitos = null;
  let defeitosErro = null;
  try {
    await abrirBanco();
    const { listarDefeitos } = await import('../src/modules/diag/defeitos.service.js');
    defeitos = await listarDefeitos({ desde: op.desde, limite: op.limite || DEFEITOS_DO_RESUMO });
  } catch (err) {
    // A MENSAGEM DO DRIVER VIAJA, e não uma frase genérica: "o banco não respondeu" não
    // distingue Postgres fora de `DATABASE_URL` ausente, e as duas pedem coisas opostas.
    defeitosErro = `o banco não respondeu (${err.message})`;
  } finally {
    await fecharBanco();
  }

  const relatorio = montarResumo({
    periodo: { desde: op.desde, desdeMs: janela, inicio, fim: agora.getTime() },
    leitura,
    defeitos,
    defeitosErro,
    latencia,
    latenciaAnterior,
    queriesLentas,
    amostras,
    status,
  });

  if (op.json) {
    escreverJson('resumo', {
      desde: op.desde,
      desdeMs: janela,
      inicio,
      fim: agora.getTime(),
      dir: path.resolve(dir),
      diretorioAusente: ausente,
      arquivos: leitura.arquivos,
      linhas: leitura.linhas,
      banco: defeitosErro === null,
    }, relatorio);
    return;
  }

  process.stdout.write(`# ${path.resolve(dir)} | ${leitura.arquivos} arquivo(s) | desde ${new Date(inicio).toLocaleString('pt-BR')} | ${leitura.linhas} linha(s)\n`);
  imprimirResumo(relatorio);
}

/**
 * O cabeçalho de um bloco: o nome, e a premissa OU o motivo da ausência.
 *
 * ELE É UMA FUNÇÃO SÓ PARA OS CINCO BLOCOS, e é isso que garante a propriedade que o
 * relatório inteiro promete: nenhum bloco pode imprimir contagem sem antes ter passado por
 * aqui, e aqui a ausência de fonte SEMPRE fala. Cinco cabeçalhos escritos à mão seriam cinco
 * chances de esquecer um, e o esquecido imprimiria zero com cara de boa notícia, que é
 * exatamente o defeito que a aba de Diagnóstico já pagou.
 *
 * @returns {boolean} se o bloco tem o que imprimir
 */
function cabecalhoDeBloco(titulo, bloco) {
  process.stdout.write(`\n── ${titulo} ${'─'.repeat(Math.max(0, 66 - titulo.length))}\n`);
  if (!bloco.disponivel) {
    process.stdout.write(`   SEM FONTE: ${bloco.motivo}\n`);
    process.stdout.write('   (nenhum número é impresso aqui de propósito: zero se leria como "nada aconteceu")\n');
    return false;
  }
  const p = bloco.premissa;
  if (p.fonte === 'banco') {
    process.stdout.write(`   premissa: ${p.vistos} de ${p.total} defeito(s) da janela`);
    process.stdout.write(p.parcial ? ', LISTA PARCIAL (o topo é o maior DENTRE OS QUE VIERAM)\n' : '\n');
  } else {
    process.stdout.write(`   premissa: ${p.arquivos} arquivo(s), ${p.linhas} linha(s) na janela\n`);
  }
  return true;
}

/** Um delta de p95, com o sinal explícito e a ausência de base nomeada. */
function deltaLegivel(l) {
  if (l.p95 === null) return '-';
  if (l.delta === null) return `${l.p95}ms  (sem base na janela anterior)`;
  const sinal = l.delta > 0 ? '+' : '';
  const pct = l.deltaPct === null ? '' : ` / ${sinal}${l.deltaPct}%`;
  return `${l.p95}ms  (era ${l.p95Anterior}ms, ${sinal}${l.delta}ms${pct})`;
}

/**
 * O relatório de uma tela, em texto.
 *
 * A ORDEM DOS BLOCOS É A DA PERGUNTA, e não a da fonte: primeiro o que quebrou (defeitos),
 * depois o que está devagar (latência), depois se o processo esteve de pé (saúde), depois se
 * o CLIENTE viu queda (indisponibilidade) e por fim o volume (status). Agrupar por fonte
 * (banco, banco, arquivo, arquivo, arquivo) seria a ordem conveniente para quem escreveu, e
 * separaria os dois blocos que só valem lidos JUNTOS, que são saúde e indisponibilidade.
 */
function imprimirResumo(r) {
  if (cabecalhoDeBloco('DEFEITOS', r.defeitos)) {
    const d = r.defeitos;
    process.stdout.write(`   ${d.novos} novo(s) na janela, ${d.regressoes} regressão(ões)\n`);
    process.stdout.write(`   origem: ${d.porOrigem.servidor} do servidor, ${d.porOrigem.cliente} do navegador, ${d.porOrigem.semOrigem} sem origem declarada\n`);
    if (!d.topo.length) {
      process.stdout.write('   Nenhum defeito na janela.\n');
    } else {
      process.stdout.write('\n');
      for (const t of d.topo) {
        process.stdout.write(
          `   ${String(t.ocorrencias).padStart(6)}x  ${cortar(t.estado, 9).padEnd(9)} ${cortar(t.origem ?? '-', 11).padEnd(11)} `
          + `${cortar(t.mensagem, 44).padEnd(44)} ${String(t.id).slice(0, 8)}\n`
        );
      }
      process.stdout.write('\n   Detalhe de um: npm run diag -- defeitos --id <uuid>   (o uuid inteiro sai no --json)\n');
    }
  }

  if (cabecalhoDeBloco('LATÊNCIA (p95, contra a janela anterior do mesmo tamanho)', r.latencia)) {
    const l = r.latencia;
    if (!l.rotas.length) {
      process.stdout.write('   Nenhuma requisição com duração na janela.\n');
    } else {
      for (const rota of l.rotas) {
        process.stdout.write(`   ${String(rota.n).padStart(7)}x  ${cortar(rota.rota, 34).padEnd(34)} ${deltaLegivel(rota)}\n`);
      }
      process.stdout.write('   (as MAIS CHAMADAS, não as mais lentas: é o que o produto usa que um deploy piora de forma visível)\n');
    }
    process.stdout.write(`   queries lentas: ${l.queriesLentas.janela} na janela, ${l.queriesLentas.anterior} na anterior`);
    process.stdout.write('   (SLOW_QUERY_MS; leia com: diag -- linhas --filtro "db: query lenta")\n');
  }

  if (cabecalhoDeBloco('SAÚDE DO PROCESSO (o que o servidor sabe de si)', r.saude)) {
    const s = r.saude;
    if (s.situacao !== 'medida') {
      process.stdout.write(`   ${s.amostras} amostra(s): "${s.situacao}". NADA se afirma sobre buraco. Detalhe: npm run diag -- saude\n`);
    } else if (s.faltantes === null) {
      process.stdout.write(`   ${s.amostras} amostra(s), mas o INTERVALO não foi estimável: nada se afirma sobre buraco.\n`);
      process.stdout.write('   Isto NÃO é "nada faltou". Detalhe e --intervalo: npm run diag -- saude\n');
    } else {
      const premissa = s.intervaloOrigem === 'informado'
        ? `intervalo informado de ${duracao(s.intervaloMs)}`
        : `intervalo de ${duracao(s.intervaloMs)}, INFERIDO da própria série`;
      process.stdout.write(`   ${s.amostras} amostra(s), ${s.faltantes} faltando de ${s.esperadas} em ${s.buracos} buraco(s), supondo ${premissa}\n`);
      if (s.estimativaFragil) {
        process.stdout.write('   ESTIMATIVA FRÁGIL do intervalo: confirme com --intervalo antes de concluir.\n');
      }
      if (s.maiorBuracoMs !== null) process.stdout.write(`   maior buraco: ${duracao(s.maiorBuracoMs)}\n`);
    }
    process.stdout.write(`   última amostra há ${duracao(s.desdeUltimaMs)}${s.ultimaAtrasada ? '  ATRASADA: o processo pode estar FORA agora' : ''}\n`);
    if (s.discoNaUltima) {
      process.stdout.write(`   disco do log na última amostra: ${s.discoNaUltima.livreMb} MB livres de ${s.discoNaUltima.totalMb} MB (indício, não veredito)\n`);
    }
  }

  if (cabecalhoDeBloco('INDISPONIBILIDADE VISTA PELO CLIENTE', r.indisponivel)) {
    const i = r.indisponivel;
    process.stdout.write(`   ${i.defeitos} assinatura(s) de origem "indisponivel", ${i.ocorrencias} ocorrência(s)\n`);
    // A NOTA SAI SEMPRE, inclusive com zero, e é a única do relatório que sai sobre uma boa
    // notícia. O motivo é que o zero AQUI é o mais fácil de ler errado: o relato de
    // indisponibilidade ENFILEIRA quando o servidor está fora (está fora por definição) e só
    // chega na próxima carga bem-sucedida da página, então uma queda EM CURSO não aparece.
    process.stdout.write('   Zero aqui NÃO prova disponibilidade: o relato dessa tela é enfileirado no cliente e\n');
    process.stdout.write('   só chega na próxima carga bem-sucedida, então uma queda em curso ainda não chegou.\n');
    process.stdout.write('   Lido ao lado da SAÚDE acima, ele desambigua o buraco na série: buraco COM relato é\n');
    process.stdout.write('   queda; buraco SEM relato é, mais provavelmente, o log em arquivo tendo se desligado.\n');
  }

  if (cabecalhoDeBloco('STATUS', r.status)) {
    const s = r.status;
    const faixas = Object.keys(s.porFaixa).sort().map((f) => `${f}: ${s.porFaixa[f]}`).join('   ');
    process.stdout.write(`   ${s.total} requisição(ões)   ${faixas}\n`);
    process.stdout.write(`   ${s.erros} requisição(ões) com erro`);
    process.stdout.write(s.taxaDeErro === null
      ? '   (sem taxa: a janela não teve requisição nenhuma)\n'
      : `   taxa ${s.taxaDeErro}%\n`);
    process.stdout.write('   Detalhe: npm run diag -- erros\n');
  }
}

/**
 * Qual função responde por cada comando de banco.
 *
 * TABELA E NÃO TERNÁRIO. Enquanto eram dois, `op.comando === 'pilha' ? a : b` cabia; com
 * cinco, um encadeamento de ternários faria o comando NOVO cair no ramo `else` de alguém, e
 * o modo de falha é o pior possível: `reabrir` respondendo a listagem de defeitos, com
 * código 0 e nada de errado na tela. A tabela transforma "esqueci de ligar o verbo" num
 * `undefined` que estoura na hora.
 */
const DESPACHO_DE_BANCO = Object.freeze({
  defeitos: comandoDefeitos,
  pilha: comandoPilha,
  resolver: comandoCicloDeVida,
  ignorar: comandoCicloDeVida,
  reabrir: comandoCicloDeVida,
});

/**
 * Roda um dos comandos de banco, decide a saída e FECHA O POOL, sempre.
 *
 * O `finally` NÃO É HIGIENE, É O QUE FAZ O COMANDO TERMINAR: uma conexão de pool aberta
 * segura o loop de eventos, e sem ele o processo imprime a resposta inteira e fica pendurado
 * no terminal, o que se lê como consulta lenta e não como handle esquecido.
 *
 * O CÓDIGO DE SAÍDA VAI EM `process.exitCode`, NUNCA `process.exit()`: o segundo mataria o
 * processo antes de o `pgp.end()` terminar, deixando conexões penduradas no Postgres a cada
 * invocação. Com `exitCode`, o processo sai sozinho quando o último handle fecha, carregando
 * o código.
 *
 * A VALIDAÇÃO DE `--estado` E `--origem` É AQUI, contra os vocabulários importados, e ela
 * RECLAMA em vez de repassar: um valor não reconhecido chega ao SQL como filtro de igualdade
 * e devolve LISTA VAZIA, que se lê como "nenhum defeito assim" quando na verdade é um erro de
 * digitação. É o mesmo argumento de `parseJanela` devolver `null` no que não entende.
 */
async function comandoDeBanco(op, janela) {
  for (const [bandeira, valor, aceitos] of [
    ['--estado', op.estado, ESTADOS_DE_DEFEITO],
    ['--origem', op.origem, ORIGENS_DE_ERRO],
  ]) {
    if (valor !== null && !aceitos.includes(valor)) {
      process.stderr.write(`${bandeira} inválido: "${valor}". Aceitos: ${aceitos.join(', ')}.\n`);
      process.stderr.write('Um valor não reconhecido não filtraria nada, devolveria lista VAZIA e se leria como\n');
      process.stderr.write('"nenhum defeito assim", que é a resposta errada com cara de resposta.\n');
      process.exitCode = 1;
      return;
    }
  }

  // O ESTADO ESCRITO À MÃO É CONFERIDO CONTRA `ESTADOS_MANUAIS`, e não contra o mapa de
  // verbos, e o cinto é redundante de propósito: o mapa não pode ganhar um verbo que escreva
  // `regrediu` sem que esta linha reprove primeiro. É a mesma regra do Joi da rota, e ela
  // vale nas DUAS bordas porque as duas escrevem na mesma coluna.
  const estadoDoVerbo = ESTADO_DO_VERBO[op.comando];
  if (estadoDoVerbo !== undefined && !ESTADOS_MANUAIS.includes(estadoDoVerbo)) {
    process.stderr.write(`O verbo "${op.comando}" escreveria o estado "${estadoDoVerbo}", que NÃO é um ato de\n`);
    process.stderr.write(`administrador. Aceitos à mão: ${ESTADOS_MANUAIS.join(', ')}.\n`);
    process.exitCode = 1;
    return;
  }

  // `--mapas` É ARGUMENTO DE ARQUIVO, então ele é cobrado ANTES do pool: abrir conexão para
  // descobrir que falta uma bandeira é trabalho jogado fora e, pior, com o Postgres fora do ar
  // trocaria a frase certa ("falta --mapas") pela errada ("não consegui abrir o banco").
  if (op.comando === 'pilha' && !op.mapas) {
    process.stderr.write('Falta --mapas <dir>: o diretório da build (com release.json) ou o que contém as builds.\n');
    process.exitCode = 1;
    return;
  }

  // O POOL É ABERTO AQUI, ANTES DO DESPACHO, e não onde ele é usado. Foi um defeito real e
  // ele é o tipo que se descobre pelo sintoma errado: `comandoDefeitos` chegava ao banco pelo
  // `listarDefeitos` do serviço, que importa `database/index.js` por conta própria, então o
  // pool nascia sem `bancoAberto` nunca ter sido preenchido, o `finally` abaixo não fechava
  // nada e o comando imprimia a resposta INTEIRA e ficava pendurado no terminal. Quem usa o
  // pool e quem o fecha precisam ser a mesma decisão, e ela é esta linha.
  try {
    await abrirBanco();
  } catch (err) {
    process.stderr.write(`Não foi possível abrir o banco: ${err.message}\n`);
    process.stderr.write(`\`${op.comando}\` lê as tabelas, e não o log. São CINCO os comandos de banco`
      + ' (defeitos, pilha, resolver, ignorar, reabrir), e os cinco exigem DATABASE_URL e JWT_SECRET.\n');
    process.stderr.write('Para diagnosticar com o Postgres fora: os cinco comandos de log (erros,\n');
    process.stderr.write('lento, status, saude, linhas), ou o `resumo`, que sai com os blocos de banco\n');
    process.stderr.write('cegos e o resto do relatório inteiro.\n');
    process.exitCode = 1;
    return;
  }

  try {
    const r = await DESPACHO_DE_BANCO[op.comando](op);
    process.exitCode = r.codigo;
    if (!r.estrutura) return;
    if (op.json) {
      // `pilha` não tem janela nenhuma (ela responde sobre UMA linha, achada por id), e
      // `null` diz isso melhor que uma janela inventada de 24h que não filtrou coisa alguma.
      // O mesmo vale para os três verbos de ciclo de vida, e a condição já os cobre sem uma
      // linha nova: eles exigem `--id`, então `op.id !== null` é sempre verdadeiro ali.
      const janelaDoComando = op.comando === 'pilha' || op.id !== null
        ? null
        : { desde: op.desde, desdeMs: janela, inicio: Date.now() - janela, fim: Date.now() };
      escreverJson(op.comando, janelaDoComando, r.estrutura);
      return;
    }
    r.imprimir();
  } finally {
    await fecharBanco();
  }
}

async function main() {
  const op = lerArgumentos(process.argv.slice(2));

  if (!COMANDOS.has(op.comando)) {
    ajuda(op.json ? process.stderr : process.stdout);
    process.exit(op.comando ? 1 : 0);
  }

  const janela = parseJanela(op.desde);
  if (janela === null) {
    process.stderr.write(`Janela inválida: "${op.desde}". Use algo como 30m, 24h ou 7d.\n`);
    process.exit(1);
  }

  // Mesmo contrato da janela: forma não reconhecida RECLAMA. Cair no intervalo inferido
  // calado responderia com um número de faltantes sobre uma premissa que ninguém pediu.
  const intervalo = op.intervalo === null ? null : parseIntervalo(op.intervalo);
  if (op.intervalo !== null && intervalo === null) {
    process.stderr.write(`Intervalo inválido: "${op.intervalo}". Use algo como 30s, 5m ou 1h.\n`);
    process.stderr.write('O sufixo é obrigatório: um número nu seria ambíguo com HEALTH_SAMPLE_INTERVAL_MS, que é em ms.\n');
    process.exit(1);
  }

  // Mesmo contrato de `--desde` e `--intervalo`: forma não reconhecida RECLAMA. `parseInt`
  // aceita `12abc` e devolve 12, e devolve NaN em `abc`; os dois, mais o zero, caíam no
  // default calado e faziam o comando cortar a lista num tamanho que ninguém pediu.
  if (op.limiteBruto !== null && !/^[1-9][0-9]*$/.test(String(op.limiteBruto).trim())) {
    process.stderr.write(`Limite inválido: "${op.limiteBruto}". Use um inteiro maior que zero.\n`);
    process.stderr.write('Zero é um número fácil de digitar e não é um limite: ele cairia no default e o\n');
    process.stderr.write('comando cortaria a lista num tamanho que você não pediu, sem dizer nada.\n');
    process.exit(1);
  }

  // O HÍBRIDO SAI ANTES DOS DOIS RAMOS, e é o único que sai. Ele não pode cair no ramo de
  // banco (nunca abriria o log) nem no de arquivo (o `existsSync` abaixo mata o processo com
  // código 1, e para ele diretório ausente é um bloco que se declara cego, não um erro
  // fatal). Ver `comandoResumo`.
  if (op.comando === COMANDO_HIBRIDO) {
    await comandoResumo(op, janela);
    return;
  }

  if (COMANDOS_DE_BANCO.has(op.comando)) {
    // O DESVIO É AQUI, DEPOIS DA JANELA E ANTES DO DIRETÓRIO. Depois da janela porque
    // `defeitos` usa a mesma gramática de `--desde` e o mesmo erro serve aos dois; antes do
    // diretório porque estes dois não leem `.jsonl` nenhum, e cair no `existsSync` de
    // LOG_DIR faria um `diag -- defeitos` morrer por falta de um diretório de log que ele
    // não vai abrir.
    await comandoDeBanco(op, janela);
    return;
  }

  // O config é importado tarde e só quando `--dir` não foi dado: ele exige DATABASE_URL e
  // JWT_SECRET na avaliação do módulo, e um diagnóstico de log não pode depender de o banco
  // estar configurado — a hora em que se lê log é justamente a hora em que algo não está.
  // (A resolução mora em `resolverDiretorioDeLog` porque o `resumo` a usa também, e uma
  // segunda cópia dela divergiria no default embutido.)
  const dir = await resolverDiretorioDeLog(op);

  if (!fs.existsSync(dir)) {
    process.stderr.write(`Diretório de log não encontrado: ${path.resolve(dir)}\n`);
    process.stderr.write('Confira LOG_DIR, ou passe --dir <caminho>.\n');
    process.exit(1);
  }

  const agora = new Date();
  const relatorio = await coletar(op, dir, janela, agora);
  const { arquivosLidos, linhas, inicio } = relatorio.leitura;

  if (op.json) {
    // O CABEÇALHO HUMANO VIRA `janela`, e não some. Ele carrega o diretório resolvido, a
    // contagem de arquivos e a de linhas, que são o que torna a resposta FALSIFICÁVEL: sem
    // eles, um `assinaturas: []` de um diretório errado é indistinguível de uma janela
    // limpa, e o consumidor desta saída (um agente) não tem terminal para desconfiar.
    escreverJson(op.comando, {
      desde: op.desde,
      desdeMs: janela,
      inicio: inicio.getTime(),
      fim: agora.getTime(),
      dir: path.resolve(dir),
      arquivos: arquivosLidos,
      linhas,
    }, relatorio.estrutura(inicio, agora, intervalo));
    return;
  }

  process.stdout.write(`# ${path.resolve(dir)} | ${arquivosLidos} arquivo(s) | desde ${inicio.toLocaleString('pt-BR')} | ${linhas} linha(s)\n\n`);
  relatorio.imprimir(inicio, agora, intervalo);
}

/**
 * O resumo de saúde pronto para o envelope, com o `janela` DELE renomeado.
 *
 * ESTE É O ÚNICO CHOQUE DE NOME DO PRODUTO, e ele era silencioso: `resumirAmostras` devolve
 * um campo `janela` (`{ inicio, fim }`, as pontas que ele recebeu), e o envelope de `--json`
 * tem outro `janela`, com a procedência inteira (diretório, arquivos, linhas). Enquanto o
 * envelope era escrito ANTES do espalhamento, o resumo o SOBRESCREVIA, e o documento de
 * `saude --json` saía sem dizer de qual diretório veio nem quantas linhas leu, ou seja, sem
 * a única metade que o torna falsificável. Nada ficava vermelho.
 *
 * Renomear é melhor que descartar: as duas pontas continuam sendo o que o resumo usou para
 * decidir o que é buraco e o que é desconhecido, e um leitor que compare `janelaDaSerie` com
 * `janela` está fazendo a conferência certa. Quem lança na colisão é `escreverJson`, e foi
 * ele que achou este caso.
 */
function estruturaDeSaude(amostras, opcoes) {
  const { janela: janelaDaSerie, ...resto } = resumirAmostras(amostras, opcoes);
  return { ...resto, janelaDaSerie };
}

/**
 * Uma passada por comando (duas em `erros`), com o acumulador que aquele comando precisa.
 *
 * O DESPACHO É AQUI, ANTES DA LEITURA, e não depois: é o que permite a cada comando reter só
 * o seu. Um leitor único que devolvesse a lista para todos obrigaria os cinco a pagar a
 * memória do mais caro, que é justamente o defeito que saiu.
 *
 * A impressão fica numa função de retorno em vez de acontecer aqui porque o CABEÇALHO (com a
 * contagem de linhas) vem antes do corpo e só se conhece depois da leitura.
 */
async function coletar(op, dir, janela, agora) {
  if (op.comando === 'erros') {
    // PRIMEIRA PASSADA: só os `reqId` que têm linha rica. Ver o `fileoverview`.
    const indice = criarIndiceDeRequisicoesComErro();
    await percorrerRegistros(dir, janela, agora, (reg) => indice.ver(reg));
    const agrupador = criarAgrupadorDeErros(indice.resultado());
    const censo = criarCensoDeEnderecos();
    const leitura = await percorrerRegistros(dir, janela, agora, (reg) => {
      agrupador.ver(reg);
      // O censo é da JANELA, não dos erros: é ele que diz se o endereço é constante no
      // arquivo inteiro, que é o que desambigua um grupo de endereço único.
      censo.ver(reg);
    });
    const grupos = agrupador.grupos();
    const limiteDeErros = op.limite || 20;
    return {
      leitura,
      imprimir: () => imprimirErros(grupos, limiteDeErros, censo.resultado()),
      // O `--limite` É RESPEITADO TAMBÉM AQUI, e a alternativa (mandar tudo, já que JSON não
      // tem largura de terminal) foi recusada: o mesmo comando com os mesmos argumentos tem
      // de responder à mesma pergunta nos dois modos, senão comparar as duas saídas deixa de
      // provar qualquer coisa. O que NÃO se perde é a contagem de antes do corte, que vai
      // ao lado.
      estrutura: () => ({
        totalDeAssinaturas: grupos.length,
        totalDeOcorrencias: grupos.reduce((soma, g) => soma + g.total, 0),
        limite: limiteDeErros,
        assinaturas: grupos.slice(0, limiteDeErros),
        enderecos: censo.resultado(),
      }),
    };
  }

  if (op.comando === 'lento') {
    const resumo = criarResumoDeLatencia({ porRelease: op.porRelease });
    const leitura = await percorrerRegistros(dir, janela, agora, (reg) => resumo.ver(reg));
    const rotas = resumo.resultado();
    const limiteDeRotas = op.limite || 15;
    return {
      leitura,
      imprimir: () => imprimirLento(rotas, limiteDeRotas, op.porRelease),
      estrutura: () => ({
        totalDeRotas: rotas.length,
        limite: limiteDeRotas,
        // O MODO VAI NO DOCUMENTO, e não só na tabela impressa. Sem ele, dois documentos
        // do mesmo comando sobre o mesmo arquivo teriam a mesma forma e contagens de
        // `rotas` diferentes, e nada diria por quê: quem lê o JSON não viu a linha de
        // comando. É a mesma razão pela qual o envelope carrega `comando`.
        porRelease: op.porRelease,
        rotas: rotas.slice(0, limiteDeRotas),
      }),
    };
  }

  if (op.comando === 'status') {
    // `erros` VEM DO ACUMULADOR, e não de um contador aqui fora. Ele era contado neste
    // ponto, com `ehErro` sobre a janela inteira, e a aba mostrou o resultado: 144
    // requisições, 288 erros, taxa de 200%. O argumento inteiro está em
    // `criarResumoDeStatus`; o que importa aqui é que o ponto de uso deixou de ter uma
    // regra própria, porque foi tê-la em TRÊS pontos de uso que produziu a divergência.
    const resumo = criarResumoDeStatus();
    const leitura = await percorrerRegistros(dir, janela, agora, (reg) => resumo.ver(reg));
    const contagem = resumo.resultado();
    return {
      leitura,
      imprimir: () => imprimirStatus(contagem),
      estrutura: () => contagem,
    };
  }

  if (op.comando === 'saude') {
    // O ÚNICO comando que retém registros, e retém só as linhas de AMOSTRA: uma a cada
    // poucos minutos por processo, ou seja, centenas num dia contra centenas de milhares de
    // linhas de requisição. `resumirAmostras` precisa da série inteira (ela mede DISTÂNCIAS
    // entre pontos consecutivos e um percentil sobre elas), e essa série é pequena por
    // construção. Filtrar aqui, e não lá dentro, é o que impede o resto de entrar.
    const amostras = [];
    const leitura = await percorrerRegistros(dir, janela, agora, (reg) => {
      if (reg.amostra === MARCADOR_AMOSTRA) amostras.push(reg);
    });
    return {
      leitura,
      // As DUAS pontas da janela vão junto: o começo, para nomear como DESCONHECIDO o trecho
      // anterior à primeira amostra, e o agora, porque a distância até a última amostra é o
      // sinal do presente. Sem elas o resumo saberia só o que aconteceu entre amostras.
      imprimir: (inicio, fim, intervalo) => imprimirSaude(
        amostras, { intervaloMs: intervalo, agora: fim.getTime(), inicio: inicio.getTime() }
      ),
      // `resumirAmostras` É CHAMADO DE NOVO AQUI, e não reaproveitado do `imprimir`: os dois
      // modos são exclusivos (só um deles roda numa invocação), então não há cálculo em
      // dobro, e amarrar os dois a um resultado compartilhado obrigaria `imprimirSaude` a
      // receber o resumo pronto, mudando a assinatura que
      // `tests/unit/diag-saude-impressao.test.js` exercita pelo comando de verdade.
      estrutura: (inicio, fim, intervalo) => estruturaDeSaude(
        amostras, { intervaloMs: intervalo, agora: fim.getTime(), inicio: inicio.getTime() }
      ),
    };
  }

  // `linhas`: um anel do tamanho do `--limite`, e nada mais. Guardar tudo para mostrar as 50
  // últimas era o caso mais caro de todos, e o mais fácil de não notar.
  const limite = op.limite || 50;
  const anel = new Array(limite);
  let casaram = 0;
  const leitura = await percorrerRegistros(dir, janela, agora, (reg, linha) => {
    if (op.filtro && !linha.includes(op.filtro)) return;
    anel[casaram % limite] = linha;
    casaram += 1;
  });
  const corte = casaram % limite;
  const ultimas = casaram > limite
    ? [...anel.slice(corte, limite), ...anel.slice(0, corte)]
    : anel.slice(0, casaram);
  return {
    leitura,
    imprimir: () => imprimirLinhas(ultimas, casaram, leitura.linhas, op.filtro),
    // AS LINHAS VÃO COMO TEXTO CRU dentro do documento, e não reparseadas em objeto. É a
    // mesma decisão do `--filtro`: o que este comando entrega é o que existe no disco, e
    // reparsear entregaria uma normalização (do escape, principalmente) que nenhum arquivo
    // tem. Quem quiser os objetos tem `jq -R 'fromjson'` sobre elas.
    estrutura: () => ({ casaram, naJanela: leitura.linhas, filtro: op.filtro, linhas: ultimas }),
  };
}

/**
 * Este arquivo é comando E módulo: os testes importam `percorrerRegistros` para medir a
 * leitura sem dirigir o comando inteiro, e sem esta guarda o simples import executaria
 * `main()` com os argumentos do corredor de testes.
 *
 * A COMPARAÇÃO É DE CAMINHO RESOLVIDO, e ela é frouxa quanto à caixa no Windows de
 * propósito: o npm pode entregar o drive em caixa diferente da que `import.meta.url`
 * resolve, e um falso negativo aqui não daria erro nenhum, apenas um comando que não faz
 * nada. Quem vigia isso é `tests/unit/diag-saude-impressao.test.js`, que dirige o comando de
 * verdade por `spawnSync` e ficaria vermelho na hora.
 */
function ehEntrada() {
  const esteArquivo = fileURLToPath(import.meta.url);
  const chamado = process.argv[1] ? path.resolve(process.argv[1]) : '';
  return process.platform === 'win32'
    ? chamado.toLowerCase() === esteArquivo.toLowerCase()
    : chamado === esteArquivo;
}

if (ehEntrada()) {
  main().catch((err) => {
    process.stderr.write(`diag falhou: ${err && err.stack ? err.stack : err}\n`);
    process.exit(1);
  });
}
