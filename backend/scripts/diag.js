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
 * Uso:
 *   npm run diag -- erros [--desde 24h] [--limite 20]
 *   npm run diag -- lento [--desde 24h] [--limite 15]
 *   npm run diag -- status [--desde 1h]
 *   npm run diag -- saude [--desde 24h] [--intervalo 5m]
 *   npm run diag -- linhas [--desde 1h] [--filtro texto] [--limite 50]
 *   (--dir <caminho> para ler um diretório de log que não seja o configurado)
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import {
  parseJanela, parseIntervalo, diasDaJanela, parseLinha, resumirAmostras, ehErro,
  criarAgrupadorDeErros, criarIndiceDeRequisicoesComErro, criarCensoDeEnderecos,
  criarResumoDeLatencia, criarResumoDeStatus, MAX_ENDERECOS_PRINCIPAIS,
} from '../src/utils/diag-consulta.js';
import { MARCADOR_AMOSTRA } from '../src/utils/amostra-de-saude.js';

const COMANDOS = new Set(['erros', 'lento', 'status', 'saude', 'linhas']);

function lerArgumentos(argv) {
  const [comando, ...resto] = argv;
  const op = { comando, desde: '24h', limite: null, filtro: null, dir: null, intervalo: null };
  for (let i = 0; i < resto.length; i += 1) {
    const a = resto[i];
    if (a === '--desde') op.desde = resto[++i];
    else if (a === '--limite') op.limite = parseInt(resto[++i], 10);
    else if (a === '--filtro') op.filtro = resto[++i];
    else if (a === '--dir') op.dir = resto[++i];
    else if (a === '--intervalo') op.intervalo = resto[++i];
  }
  return op;
}

function ajuda() {
  process.stdout.write(`
diag — consulta o log em arquivo do EBGeo

  npm run diag -- erros  [--desde 24h] [--limite 20]   erros agrupados por assinatura
  npm run diag -- lento  [--desde 24h] [--limite 15]   latência por rota (p50/p95/máx)
  npm run diag -- status [--desde 1h]                  contagem por faixa de status
  npm run diag -- saude  [--desde 24h] [--intervalo 5m] buracos na amostra de saúde
  npm run diag -- linhas [--desde 1h] [--filtro texto] despejo cru filtrado

  --dir <caminho>   lê outro diretório de log (default: o de LOG_DIR)
  janela: 30m, 24h, 7d
  --intervalo: 30s, 5m, 1h (sem isto, ele é INFERIDO da própria série)
  --filtro: casa a LINHA COMO ESTÁ NO DISCO, então nome de campo ("time", "msg")
            casa toda linha que o tenha. Procure pelo valor.
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

function imprimirLento(linhas, limite) {
  if (!linhas.length) {
    process.stdout.write('Nenhuma requisição com duração na janela.\n');
    return;
  }
  process.stdout.write('     n     p50     p95     máx  rota\n');
  for (const l of linhas.slice(0, limite)) {
    process.stdout.write(
      `${String(l.n).padStart(6)}  ${String(l.p50).padStart(5)}ms ${String(l.p95).padStart(5)}ms ${String(l.max).padStart(5)}ms  ${l.rota}\n`
    );
  }
}

function imprimirStatus({ total, porFaixa }, erros) {
  process.stdout.write(`${total} requisição(ões) na janela\n`);
  for (const faixa of Object.keys(porFaixa).sort()) {
    const n = porFaixa[faixa];
    process.stdout.write(`  ${faixa}: ${String(n).padStart(6)}  (${((n / total) * 100).toFixed(1)}%)\n`);
  }
  process.stdout.write(`\n${erros} registro(s) de erro. Detalhe: npm run diag -- erros\n`);
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

async function main() {
  const op = lerArgumentos(process.argv.slice(2));

  if (!COMANDOS.has(op.comando)) {
    ajuda();
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

  // O config é importado tarde e só quando `--dir` não foi dado: ele exige DATABASE_URL e
  // JWT_SECRET na avaliação do módulo, e um diagnóstico de log não pode depender de o banco
  // estar configurado — a hora em que se lê log é justamente a hora em que algo não está.
  let dir = op.dir;
  if (!dir) {
    try {
      dir = (await import('../src/config.js')).default.log.dir;
    } catch {
      dir = './data/logs';
    }
  }

  if (!fs.existsSync(dir)) {
    process.stderr.write(`Diretório de log não encontrado: ${path.resolve(dir)}\n`);
    process.stderr.write('Confira LOG_DIR, ou passe --dir <caminho>.\n');
    process.exit(1);
  }

  const agora = new Date();
  const relatorio = await coletar(op, dir, janela, agora);
  const { arquivosLidos, linhas, inicio } = relatorio.leitura;
  process.stdout.write(`# ${path.resolve(dir)} | ${arquivosLidos} arquivo(s) | desde ${inicio.toLocaleString('pt-BR')} | ${linhas} linha(s)\n\n`);
  relatorio.imprimir(inicio, agora, intervalo);
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
    return { leitura, imprimir: () => imprimirErros(grupos, op.limite || 20, censo.resultado()) };
  }

  if (op.comando === 'lento') {
    const resumo = criarResumoDeLatencia();
    const leitura = await percorrerRegistros(dir, janela, agora, (reg) => resumo.ver(reg));
    const rotas = resumo.resultado();
    return { leitura, imprimir: () => imprimirLento(rotas, op.limite || 15) };
  }

  if (op.comando === 'status') {
    const resumo = criarResumoDeStatus();
    let erros = 0;
    const leitura = await percorrerRegistros(dir, janela, agora, (reg) => {
      resumo.ver(reg);
      if (ehErro(reg)) erros += 1;
    });
    const contagem = resumo.resultado();
    return { leitura, imprimir: () => imprimirStatus(contagem, erros) };
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
  return { leitura, imprimir: () => imprimirLinhas(ultimas, casaram, leitura.linhas, op.filtro) };
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
