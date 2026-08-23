// Path: tests/unit/permissao-de-atlas-censo.test.js
//
// O CENSO DA PERMISSÃO POR ATLAS NO SERVIDOR, e o buraco que a própria constituição
// declarava.
//
// Até 2026-08-23 a constituição dizia: "Nenhum censo deste repositório cobre o eixo POR
// ATLAS: a lista fechada `perm === 'write' || perm === 'owner'`, que já causou bug real
// duas vezes nos dois pacotes, é cobrada por LEITURA e nada mais." Havia seis censos aqui
// e três no frontend, e nenhum dos nove olhava para este eixo. O irmão deste arquivo é
// `frontend/tests/unit/permissao-de-atlas-censo.test.js`.
//
// ================= O QUE ESTE ARQUIVO MEDE, E O QUE ELE NÃO MEDE =============
//
// A PRIMEIRA COISA MEDIDA foi a que decidiu o RECORTE, e vale mais que o censo: o servidor
// já impõe este eixo por MIDDLEWARE. `requireAtlasPermission(nivel)`
// (`src/middleware/permissions.js`) compara por `PERMISSION_LEVELS`, que é a escada, e
// cerca de quarenta sítios de rota o chamam passando o degrau mínimo. Esses quarenta NÃO
// entram nesta varredura, e a exclusão é deliberada: eles são a forma certa na sua versão
// mais densa, entrariam como quarenta entradas de uma classe só e transformariam o censo
// numa cópia da tabela de rotas, que muda a cada rota nova. Um censo que reprova por
// churn é um censo que alguém desliga.
//
// O QUE SOBRA, e é o que este arquivo cobra: DEZOITO sítios que comparam `permission`
// FORA daquele middleware. Eles existem porque duas decisões do produto vivem abaixo da
// rota: o gate POR OPERAÇÃO do sync (uma requisição carrega N ops, e o degrau de quem
// escreve é conferido op a op) e o gate POR MENSAGEM do socket de colaboração. Nenhum dos
// dois é alcançável por middleware de rota.
//
// ================= O QUE ELE PROÍBE ==========================================
//
// A regra mecânica é a de LISTA FECHADA: uma linha de código que cite DOIS OU MAIS níveis
// DISTINTOS ligados por `||`, `&&`, um literal de array ou um `.includes(` está comparando
// posto por enumeração, e enumeração exclui em silêncio o degrau que aparecer no meio. O
// "distintos" não é zelo: sem ele o `permission === 'comment' && op.target !== 'comment'`
// de `sync.service.js` (o posto de quem escreve E o tipo do que se escreve, homônimos na
// mesma linha) contaria dois e seria falso positivo.
//
// A regra tem uma ALLOWLIST de dois arquivos, cada um com motivo escrito, e ela é fechada:
// entrada nova se justifica aqui, na hora em que nascer.
//
// ================= O QUE ESTE CENSO ACHOU, E O QUE ACONTECEU COM ISSO ========
//
// Ele nasceu com UMA lista fechada viva: `handleSelection` (`src/modules/collab/collab.handlers.js`)
// gateava a emissão de SELEÇÃO por `ws.permission === read || ws.permission === comment`, a mesma
// classe virada do avesso. O `backend/CLAUDE.md` já registrava que foi assim que a presença de
// seleção do co-Gestor tinha sido silenciada uma vez.
//
// Ela foi consertada no mesmo dia, e o MECANISMO é o que vale registrar: a entrada tinha contagem
// EXATA, então o conserto reprovou este arquivo e obrigou quem consertou a passar por este
// cabeçalho, em vez de deixar para trás uma entrada morta apontando para código que mudou. Um piso
// de buracos conhecidos só serve se ele reprovar nas DUAS direções.
//
// Hoje a classe `LISTA_FECHADA_VIVA` existe e está VAZIA, e o zero é asserido em caso próprio, com
// controle de vácuo, porque zero deduzido do silêncio é indistinguível de varredura que parou de
// casar.
//
// ================= FRAGILIDADES ACEITAS ======================================
//
// (a) O inventário precisa de `git`; se o comando falhar, o caso-piso diz isso nessas
//     palavras, porque falha de ambiente lida como regressão custa mais do que o guarda
//     economiza.
// (b) A remoção de comentário é textual, não é um parser.
// (c) O predicado que decide acesso a atlas dentro de SQL (`fn_user_atlas_shares`) está
//     FORA daqui, porque a varredura só olha `.js`. Quem cobra aquele lado é
//     `atlas-shares-eixo-de-grupo-censo.test.js`.
// (d) Alcance é EXISTÊNCIA e FORMA, nunca comportamento. Que o Gestor de fato escreva e o
//     Comentarista de fato não escreva são testes de integração.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

// ============================================================================
// AS CLASSES
// ============================================================================

/** Compara UM degrau exato, e o degrau exato é a regra do produto ali. */
const DEGRAU_EXATO = 'degrau-exato';
/** Traduz a escada para outro vocabulário. Não decide acesso. */
const TRADUCAO = 'traducao-de-vocabulario';
/** Allowlist de validação na borda, que falha fechada. Não é gate. */
const VALIDACAO = 'validacao-de-entrada';
/** A palavra casou e não é permissão nenhuma. */
const HOMONIMO = 'homonimo';
/** Lista fechada REAL, ainda de pé, com a correção escrita ao lado. */
const LISTA_FECHADA_VIVA = 'lista-fechada-viva';

const NEGA_LEITOR = 'O leitor (`read`) é o único degrau que não escreve nada, e a comparação é do '
  + 'DEGRAU EXATO de propósito: não é "abaixo de write", é "o piso da escada". Todo degrau acima '
  + 'passa sem enumeração, então acrescentar um nível entre `read` e `comment` não muda esta linha.';

/**
 * @typedef {Object} Entrada
 * @property {string} arquivo - Relativo a `backend/`.
 * @property {string} trecho - Pedaço CONTIDO na linha; disjunto dos demais do mesmo arquivo.
 * @property {number} n
 * @property {string} classe
 * @property {string} motivo
 */

/** @type {Entrada[]} */
const CENSO = [
  // ---------------- a lista fechada que sobrou de pé: NENHUMA ---------------
  //
  // Aqui morava a única entrada `LISTA_FECHADA_VIVA` do pacote, o gate de EMISSÃO de seleção
  // (`handleSelection`) escrito como `ws.permission === 'read' || ws.permission === 'comment'`.
  // Ela foi consertada no mesmo dia em que este censo nasceu, e o mecanismo funcionou como
  // projetado: a contagem exata reprovou o conserto e obrigou a passar por este cabeçalho.
  //
  // A correção NÃO foi a espelhada do original. Trocar por `< write` teria a mesma leitura e o
  // mesmo defeito de fundo: `PERMISSION_LEVELS[valor desconhecido]` é `undefined`, toda comparação
  // contra ele é falsa, e a forma negativa transforma isso em PASSAGEM. A forma escrita é a
  // positiva (`!(... >= write)`), que transforma o desconhecido em RECUSA. É a mesma razão que o
  // `fileoverview` de `sync.service.js` dá para o `isEditor` dele, e é o que separa fail-closed de
  // fail-open num código que lê igual.
  //
  // A classe fica declarada e VAZIA de propósito: a próxima lista fechada tem onde entrar, e a
  // contagem abaixo prova que ela está vazia em vez de deixar isso implícito.

  // ---------------- degrau exato: o piso da escada --------------------------
  {
    arquivo: 'src/modules/collab/collab.handlers.js', trecho: "if (ws.permission === 'read')", n: 2,
    classe: DEGRAU_EXATO,
    motivo: `${NEGA_LEITOR} As duas cópias são \`handleOperation\` (recusa a op com FORBIDDEN) e o `
      + 'irmão dela no mesmo arquivo. A contagem separa as duas do gate de seleção acima, que é a '
      + 'linha com a forma proibida.',
  },
  {
    arquivo: 'src/modules/collab/collab.rooms.js', trecho: "client.permission === 'read'", n: 1,
    classe: DEGRAU_EXATO,
    motivo: `${NEGA_LEITOR} Aqui a decisão é de ENTREGA e não de escrita: o broadcast pode pular os `
      + 'leitores quando o remetente pede (`skipReadOnly`).',
  },
  {
    arquivo: 'src/modules/collab/collab.rooms.js', trecho: "client.permission !== 'read'", n: 1,
    classe: DEGRAU_EXATO,
    motivo: 'A negação do anterior, no ramo que decide se um lote com comentário pode ir para '
      + 'aquele cliente. Entra separada porque a negação é o lado que se esquece de acompanhar '
      + 'quando a partição muda, e as duas juntas precisam cobrir a sala inteira.',
  },
  {
    arquivo: 'src/modules/sync/sync.service.js', trecho: "if (permission !== 'read')", n: 1,
    classe: DEGRAU_EXATO,
    motivo: `${NEGA_LEITOR} No snapshot: quem não é leitor recebe também o que só quem escreve `
      + 'precisa ver.',
  },
  {
    arquivo: 'src/modules/sync/sync.service.js', trecho: "if (permission === 'read')", n: 2,
    classe: DEGRAU_EXATO,
    motivo: `${NEGA_LEITOR} Duas cópias: \`operationDenialReason\` (recusa toda escrita do leitor, `
      + 'op a op) e `pullOperations` (o leitor não recebe operação de comentário no replay). São o '
      + 'gate POR OPERAÇÃO, que é justamente o que middleware de rota não alcança.',
  },
  {
    arquivo: 'src/modules/sync/sync.service.js',
    trecho: "if (permission === 'comment' && op.target !== 'comment')", n: 1, classe: DEGRAU_EXATO,
    motivo: 'O degrau `comment` só escreve COMENTÁRIO, e esta linha é a razão de a regra de lista '
      + 'fechada contar tokens DISTINTOS: os dois `comment` dela são homônimos sem parentesco, um é '
      + 'o posto de quem escreve e o outro é o tipo do que se escreve. Contando repetição, ela '
      + 'seria o falso positivo que faz alguém desligar o censo.',
  },
  {
    arquivo: 'src/modules/sync/sync.service.js', trecho: "permission !== 'owner'", n: 1,
    classe: DEGRAU_EXATO,
    motivo: 'Virar `locked` num mapa exige `owner` ESTRITO, e é o único gate deste servidor que '
      + 'pede o topo da escada numa operação de sync. Degrau exato de propósito: nem o Gestor '
      + 'promovido tranca um mapa. É o gate que a constituição nomeia ao dizer que dos quatro '
      + 'campos chamados `locked` só `maps.locked` tem dono.',
  },

  // ---------------- tradução de vocabulário ---------------------------------
  {
    arquivo: 'src/utils/roles.js', trecho: 'if (permission ===', n: 4, classe: TRADUCAO,
    motivo: '`toFrontendRole`: a ÚNICA tradução da escada de cinco valores do servidor para o '
      + '`UserRole` de seis do cliente, que difere só por dobrar o `admin` GLOBAL para dentro dela. '
      + 'Cadeia de degraus exatos, exaustiva e com `viewer` como default, então ela não enumera '
      + 'nada: é a definição do mapeamento. O inverso mora em `ROLE_TO_PERMISSION` '
      + '(`frontend/src/js/projects/permission-levels.js`) e os dois precisam andar juntos.',
  },

  // ---------------- validação de entrada ------------------------------------
  {
    arquivo: 'src/modules/sharing/sharing.schemas.js',
    trecho: "const GRANTABLE_PERMISSIONS = ['read', 'comment', 'write', 'manage']", n: 1,
    classe: VALIDACAO,
    motivo: 'A allowlist do Joi para o nível de um share: os quatro degraus CONCEDÍVEIS, sem '
      + '`owner`, que não é um share e sim a coluna `atlas.owner_id`. É uma lista fechada por '
      + 'construção e legítima, porque validação de borda tem de ser enumeração fechada para falhar '
      + 'FECHADA: um valor fora dela vira 422, nunca acesso. É por isso que este arquivo está na '
      + 'allowlist da regra, e o espelho dela no cliente é `GRANTABLE_PERMISSIONS`, lá DERIVADO de '
      + '`PERMISSION_ORDER`.',
  },

  // ---------------- homônimos -----------------------------------------------
  {
    arquivo: 'src/modules/collab/collab.handlers.js',
    trecho: "(op?.entityType || op?.target) === 'comment'", n: 1, classe: HOMONIMO,
    motivo: 'O `entityType`/`target` da OPERAÇÃO de comentário espacial, não o degrau `comment` da '
      + 'escada. Homônimo dos mais perigosos de ler ao contrário, porque os dois convivem na mesma '
      + 'linha de `sync.service.js`.',
  },
  {
    arquivo: 'src/modules/collab/collab.rooms.js', trecho: "!== 'comment'", n: 1, classe: HOMONIMO,
    motivo: 'O mesmo `entityType`, ao separar as ops de comentário do resto do lote antes do '
      + 'broadcast. Homônimo.',
  },
  {
    arquivo: 'src/modules/sync/sync.service.js', trecho: "o.entityType !== 'comment'", n: 1,
    classe: HOMONIMO,
    motivo: 'O mesmo `entityType`, filtrando o replay do leitor. Homônimo.',
  },
  {
    arquivo: 'src/modules/sync/sync.service.js', trecho: "if (target === 'comment')", n: 1,
    classe: HOMONIMO,
    motivo: 'O mesmo `entityType`, agora roteando a aplicação da op para `applyCommentOp`, que tem '
      + 'gate de AUTORIA próprio. Homônimo.',
  },
];

/**
 * A ALLOWLIST DA REGRA DE LISTA FECHADA, com motivo por arquivo.
 *
 * Fechada de propósito: allowlist sem beneficiário é como um guarda volta a abrir sozinho.
 */
const PODEM_ENUMERAR = new Map([
  ['src/middleware/permissions.js',
    'DEFINE a escada (`PERMISSION_LEVELS`) e valida no MOUNT que o degrau pedido existe. '
    + 'Enumerar é o trabalho dele.'],
  ['src/modules/sharing/sharing.schemas.js',
    'Allowlist de validação Joi na borda, que falha FECHADA (422). Ver a entrada do censo.'],
]);

// ============================================================================
// A VARREDURA
// ============================================================================

/**
 * Remove comentário de bloco e de linha, preservando a contagem de linhas.
 *
 * A NORMALIZAÇÃO DE CRLF NÃO É COSMÉTICA: em regex de JavaScript `\r` é TERMINADOR DE
 * LINHA, então um `//` no fim de uma linha CRLF não seria removido e o censo passaria a
 * cobrar classificação de prosa. É o defeito que `papel-global-censo.test.js` já pagou.
 * @param {string} src
 * @returns {string}
 */
function semComentarios(src) {
  const normalizado = src.replace(/\r\n?/g, '\n');
  const semBloco = normalizado.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  return semBloco.split('\n').map((linha) => linha.replace(/\/\/.*/, '')).join('\n');
}

const lerCodigo = (arquivo) => semComentarios(fs.readFileSync(path.join(RAIZ, arquivo), 'utf8'));

/**
 * O INVENTÁRIO: rastreado MAIS não rastreado não ignorado. `git ls-files` puro enumera só
 * o índice, e o gate escrito há cinco minutos é o que ninguém classificou ainda.
 * @param {string} [pathspec] - Relativo à raiz do pacote.
 * @returns {string[]}
 */
function arquivosDoInventario(pathspec = 'src') {
  return execFileSync(
    'git', ['ls-files', '--cached', '--others', '--exclude-standard', pathspec],
    { cwd: RAIZ, encoding: 'utf8' },
  ).split('\n').map((s) => s.trim()).filter((s) => s.endsWith('.js'));
}

/** Os CINCO degraus do servidor, entre aspas. */
const VOCABULARIO = /'(read|comment|write|manage|owner)'|"(read|comment|write|manage|owner)"/;
const TOKENS = /'(read|comment|write|manage|owner)'|"(read|comment|write|manage|owner)"/g;
/** O que faz da citação uma COMPARAÇÃO (e não uma coluna de SQL ou um valor de retorno). */
const COMPARACAO = /(===|!==|==|!=)|\.includes\(|\[\s*'|case\s+'/;
/** O que faz da comparação uma COMPOSIÇÃO. */
const COMPOSICAO = /\|\||&&|\[|\.includes\s*\(/;

/**
 * DOIS OU MAIS degraus DISTINTOS na mesma linha, compostos.
 * @param {string} linha
 * @returns {boolean}
 */
function ehListaFechada(linha) {
  if (!COMPOSICAO.test(linha)) return false;
  return new Set([...linha.matchAll(TOKENS)].map((m) => m[0])).size >= 2;
}

/**
 * Todo sítio que compare `permission` fora de `requireAtlasPermission`.
 * @param {string[]} arquivos
 * @returns {Array<{arquivo: string, n: number, texto: string, fechada: boolean}>}
 */
function sitios(arquivos) {
  const achados = [];
  for (const arquivo of arquivos) {
    lerCodigo(arquivo).split('\n').forEach((linha, i) => {
      if (!VOCABULARIO.test(linha)) return;
      // O middleware é a forma CERTA na sua versão mais densa: quarenta rotas o chamam, e
      // enfiá-las aqui trocaria o censo por uma cópia da tabela de rotas.
      if (/requireAtlasPermission\s*\(/.test(linha)) return;
      if (!COMPARACAO.test(linha)) return;
      achados.push({ arquivo, n: i + 1, texto: linha.trim(), fechada: ehListaFechada(linha) });
    });
  }
  return achados;
}

/** Os sítios sem entrada no censo, no formato de mensagem de erro. */
function naoClassificados(achados) {
  return achados
    .filter((a) => !CENSO.some((e) => e.arquivo === a.arquivo && a.texto.includes(e.trecho)))
    .map((a) => `${a.arquivo}:${a.n} ${a.texto}`);
}

/** As listas fechadas fora da allowlist e fora da entrada declarada, como erro. */
function listasFechadasIlegais(achados) {
  const declaradas = new Set(
    CENSO.filter((e) => e.classe === LISTA_FECHADA_VIVA).map((e) => `${e.arquivo}\t${e.trecho}`),
  );
  return achados
    .filter((a) => a.fechada)
    .filter((a) => !PODEM_ENUMERAR.has(a.arquivo))
    .filter((a) => ![...declaradas].some((d) => {
      const [arq, trecho] = d.split('\t');
      return a.arquivo === arq && a.texto.includes(trecho);
    }))
    .map((a) => `${a.arquivo}:${a.n} ${a.texto}`);
}

describe('Censo da permissão por atlas no servidor', () => {
  it('piso: o inventário vem do git e alcança os gates que não são de rota', () => {
    let arquivos;
    try {
      arquivos = arquivosDoInventario();
    } catch (err) {
      assert.fail(
        `o inventário deste censo vem de \`git ls-files\` e o comando FALHOU (${err.message}). `
        + 'Isto é falha de ambiente, não regressão de código: rode dentro do repositório.',
      );
    }
    assert.ok(arquivos.length >= 100, `esperava >= 100 arquivos versionados em src/, achei ${arquivos.length}`);
    assert.ok(arquivos.includes('src/middleware/permissions.js'), 'a varredura precisa alcançar o dono da escada');
    assert.ok(arquivos.includes('src/modules/sync/sync.service.js'), 'e o gate POR OPERAÇÃO do sync');

    // O piso é a contagem MEDIDA, não uma folga: folga é onde um sítio some sem ninguém ver.
    // Se o eixo encolher de propósito, baixe o número COM A RAZÃO, que é o que aconteceu aqui.
    //
    // Nasceu 19 em 2026-08-23 e caiu para 18 no mesmo dia: o gate de emissão de seleção do socket
    // era a única lista fechada viva do pacote, foi consertado para comparar por PERMISSION_LEVELS,
    // e a linha corrigida não cita literal nenhum do vocabulário, logo saiu da varredura. Um sítio a
    // menos aqui é, neste caso, um gate a mais escrito pela forma certa.
    const achados = sitios(arquivos);
    assert.ok(achados.length >= 18, `esperava >= 18 sítios, achei ${achados.length}`);

    // A OUTRA METADE DO INVENTÁRIO: `--others` SEM `--exclude-standard` arrastaria
    // `node_modules/` inteiro. A medição é sobre o PACOTE, porque em `src/` não há nada
    // ignorado e medir ali seria vácuo.
    assert.ok(fs.existsSync(path.join(RAIZ, 'node_modules')), 'sem `node_modules` a medição é vácua');
    const doPacote = arquivosDoInventario('.');
    assert.deepEqual(
      doPacote.filter((a) => /(^|[/])(node_modules|coverage|dist|data)[/]/.test(a)), [],
      '`--exclude-standard` deixou entrar arquivo ignorado no inventário',
    );
  });

  it('o middleware é de fato o caminho majoritário (o recorte desta varredura é medido)', () => {
    // SEM ISTO O RECORTE SERIA UMA AFIRMAÇÃO. A varredura pula `requireAtlasPermission(`, e
    // essa exclusão só é honesta enquanto ele for o caminho principal: no dia em que os
    // gates de rota deixassem de existir, este censo estaria pulando o vazio e cobrando
    // classificação só das exceções, com cara de cobertura completa.
    const arquivos = arquivosDoInventario();
    let porMiddleware = 0;
    for (const arquivo of arquivos) {
      for (const linha of lerCodigo(arquivo).split('\n')) {
        if (/requireAtlasPermission\s*\(/.test(linha) && VOCABULARIO.test(linha)) porMiddleware += 1;
      }
    }
    assert.ok(
      porMiddleware >= 35,
      `esperava >= 35 gates por \`requireAtlasPermission\`, achei ${porMiddleware}: o recorte desta `
      + 'varredura pressupõe que o middleware seja o caminho principal deste eixo',
    );
    assert.ok(
      porMiddleware > sitios(arquivos).length,
      'o middleware precisa ser MAIORIA sobre as comparações à mão, senão a exclusão dele deste '
      + 'censo esconde mais do que declara',
    );
  });

  it('todo sítio de permissão por atlas está no censo, com classe e motivo', () => {
    const achados = sitios(arquivosDoInventario());
    assert.ok(achados.length >= 18);

    assert.deepEqual(
      naoClassificados(achados), [],
      'sítio de permissão POR ATLAS fora do censo (`backend/tests/unit/permissao-de-atlas-censo.test.js`). '
      + `Classifique-o em '${DEGRAU_EXATO}' (compara UM degrau, e o degrau exato é a regra ali), `
      + `'${TRADUCAO}' (mapeia a escada para outro vocabulário), `
      + `'${VALIDACAO}' (allowlist de borda, que falha fechada) ou `
      + `'${HOMONIMO}' (a palavra não é permissão), com motivo escrito. `
      + 'Gate de ROTA se escreve com `requireAtlasPermission` e não entra nesta varredura.',
    );
  });

  it('NENHUMA lista fechada de degraus fora da allowlist e da entrada declarada', () => {
    const achados = sitios(arquivosDoInventario());

    assert.deepEqual(
      listasFechadasIlegais(achados), [],
      'LISTA FECHADA de permissão de atlas. Dois ou mais degraus citados na mesma linha, ligados '
      + 'por `||`, `&&`, array ou `.includes(`, é a forma que exclui em silêncio o nível que '
      + 'aparecer no meio. Gate por rota: `requireAtlasPermission`. Gate abaixo da rota: compare '
      + 'por `PERMISSION_LEVELS` (`src/middleware/permissions.js`).',
    );

    // DISCRIMINAÇÃO: a varredura de fato ACHA lista fechada, senão este caso estaria medindo um
    // predicado que nunca casa nada. Era DUAS e passou a ser UMA quando `handleSelection` foi
    // consertada; a que fica é a allowlist Joi de `sharing.schemas.js`, que é legítima e falha
    // fechada com 422.
    //
    // ATENÇÃO ao que isto quer dizer: a única lista fechada que sobrou no pacote é a allowlist, e
    // ela vive num arquivo só. Se alguém a reescrever (por derivação a partir de
    // `PERMISSION_LEVELS`, por exemplo, que seria uma melhoria), este número vai a ZERO e a regra
    // passa a ser um predicado sem nenhuma amostra viva, ou seja, cobertura vazia com cara de
    // verde. Nesse dia a discriminação tem de mudar de fonte, e a fixture
    // `tests/fixtures/censo-permissao-de-atlas/` é onde ela deve passar a morar, porque fixture
    // não some por refatoração de produção.
    const fechadas = achados.filter((a) => a.fechada);
    assert.equal(
      fechadas.length, 1,
      `esperava exatamente 1 lista fechada declarada, achei ${fechadas.length}: `
      + fechadas.map((a) => `${a.arquivo}:${a.n}`).join(', '),
    );
  });

  it('não há lista fechada VIVA, e o zero é asserido em vez de implícito', () => {
    // PISO DECRESCENTE, com contagem EXATA e não mínima. Nasceu em 1 (o gate de emissão de seleção
    // do socket) e desceu para 0 no mesmo dia, porque o mecanismo funcionou: consertar a entrada
    // reprovou aqui e obrigou a passar pelo cabeçalho, que é exatamente o que ele existe para
    // fazer. O piso NÃO pode voltar a subir sem alguém escrever o motivo lá em cima.
    //
    // O zero é ASSERIDO, e não deduzido do silêncio. Um censo que só verificasse a lista declarada
    // ficaria mudo depois que ela esvaziasse, e é aí que a próxima entraria sem ninguém notar: quem
    // cobra o código inteiro é a regra de lista fechada, e o que este caso cobra é que ela não
    // tenha nenhuma exceção de pé.
    const vivas = CENSO.filter((e) => e.classe === LISTA_FECHADA_VIVA);
    assert.equal(
      vivas.length, 0,
      'uma lista fechada voltou ao censo: se ela é dívida aceita, escreva o motivo e a correção no '
      + 'cabeçalho e suba o piso aqui; se é defeito, conserte em vez de classificar. '
      + vivas.map((e) => `${e.arquivo}:${e.trecho}`).join(', '),
    );

    // Controle de vácuo: o zero acima só significa alguma coisa enquanto a classe existe e a regra
    // que a alimenta continua discriminando. Sem isto, apagar a constante deixaria o caso verde.
    assert.equal(typeof LISTA_FECHADA_VIVA, 'string', 'a classe sumiu: o zero deixou de medir algo');
    assert.ok(
      CENSO.some((e) => e.classe === DEGRAU_EXATO),
      'o censo ficou sem entrada nenhuma de comparação por degrau: a varredura provavelmente parou '
      + 'de casar, e um censo vazio passa verde sem verificar nada',
    );
  });

  it('a contagem por entrada bate: apagar um sítio é tão vermelho quanto acrescentar', () => {
    const achados = sitios(arquivosDoInventario());
    const divergentes = CENSO
      .map((e) => ({
        ...e,
        vistos: achados.filter((a) => a.arquivo === e.arquivo && a.texto.includes(e.trecho)).length,
      }))
      .filter((e) => e.vistos !== e.n)
      .map((e) => `${e.arquivo} :: "${e.trecho}" esperava ${e.n}, achei ${e.vistos}`);
    assert.deepEqual(divergentes, [], 'a contagem do censo divergiu do código');

    const chaves = CENSO.map((e) => `${e.arquivo}\t${e.trecho}`);
    assert.equal(new Set(chaves).size, chaves.length, 'duas entradas com a mesma chave se cobrem');
  });

  it('toda entrada tem classe válida e motivo escrito, e a allowlist tem beneficiário', () => {
    const classes = [DEGRAU_EXATO, TRADUCAO, VALIDACAO, HOMONIMO, LISTA_FECHADA_VIVA];
    const ruins = CENSO
      .filter((e) => !classes.includes(e.classe) || !e.motivo || e.motivo.length < 60)
      .map((e) => `${e.arquivo} :: ${e.trecho}`);
    assert.deepEqual(ruins, [], 'entrada de censo sem classe válida ou sem motivo escrito');

    // ALLOWLIST SEM BENEFICIÁRIO é como um guarda volta a abrir sozinho: se o arquivo saiu
    // do repositório, ou deixou de enumerar, a dispensa dele precisa sair junto.
    const arquivos = new Set(arquivosDoInventario());
    const orfas = [...PODEM_ENUMERAR.keys()].filter((a) => !arquivos.has(a));
    assert.deepEqual(orfas, [], 'a allowlist da regra guarda arquivo que não existe mais');
    assert.equal(PODEM_ENUMERAR.size, 2, 'a allowlist tem DOIS arquivos; um terceiro passa por aqui');
    const semMotivo = [...PODEM_ENUMERAR.entries()]
      .filter(([, motivo]) => motivo.length < 60)
      .map(([arquivo]) => arquivo);
    assert.deepEqual(semMotivo, [], 'dispensa da allowlist sem motivo escrito');
  });

  it('a varredura REPROVA um gate novo não classificado (provado com fixture)', () => {
    // AS MESMAS FUNÇÕES dos casos acima, apontadas para uma fixture com as DUAS formas que
    // este arquivo distingue: a lista fechada canônica e o literal solto num gate.
    const fixture = 'tests/fixtures/censo-permissao-de-atlas/gate-nao-classificado.js';
    const achados = sitios([fixture]);
    assert.equal(achados.length, 2, 'a fixture precisa produzir os dois sítios');

    const acusados = naoClassificados(achados);
    assert.equal(acusados.length, 2, `esperava 2 acusados, achei: ${acusados.join(' | ')}`);
    assert.ok(acusados.every((a) => a.includes('gate-nao-classificado.js')));

    // E A DISCRIMINAÇÃO ENTRE AS DUAS REGRAS: só a primeira é lista fechada. Uma regra que
    // acusasse as duas seria uma regra que acusa tudo.
    const fechadas = listasFechadasIlegais(achados);
    assert.equal(fechadas.length, 1, `esperava 1 lista fechada, achei: ${fechadas.join(' | ')}`);
    assert.match(fechadas[0], /permission === 'write' \|\| permission === 'owner'/);

    // E sobre o código REAL, as duas funções não acusam ninguém.
    const reais = sitios(arquivosDoInventario());
    assert.deepEqual(naoClassificados(reais), []);
    assert.deepEqual(listasFechadasIlegais(reais), []);
  });

  it('o inventário ENXERGA arquivo NOVO ainda não rastreado (provado, não afirmado)', () => {
    // O CEGO QUE ESTE CASO FECHA é de CONJUNTO: `git ls-files` sozinho enumera o índice,
    // então o gate escrito há cinco minutos ficava fora da varredura até alguém dar
    // `git add`. Ele nasce aqui e morre no `finally`, longe de `src/`.
    const dir = 'tests/fixtures/censo-permissao-de-atlas';
    const relativo = `${dir}/tmp-nao-rastreado.js`;
    const abs = path.join(RAIZ, relativo);
    fs.writeFileSync(abs, [
      `// Path: ${relativo}`,
      '// Temporário: criado e apagado pelo controle negativo deste censo.',
      "export const podeGerir = (p) => p === 'manage' || p === 'owner';",
      '',
    ].join('\n'));

    try {
      // CONTROLE: o git precisa CONCORDAR que ele não está rastreado, e precisa enxergar a
      // fixture RASTREADA do mesmo pathspec. Sem este par, o caso passaria verde num mundo
      // em que alguém tivesse dado `git add` no temporário.
      const soRastreados = execFileSync('git', ['ls-files', dir], { cwd: RAIZ, encoding: 'utf8' });
      assert.ok(!soRastreados.includes('tmp-nao-rastreado'), 'a fixture temporária não pode estar rastreada');
      assert.ok(soRastreados.includes('gate-nao-classificado.js'), 'o pathspec precisa alcançar a fixture rastreada');

      const inventario = arquivosDoInventario(dir);
      assert.ok(inventario.includes(relativo), 'o inventário precisa enxergar o arquivo NÃO RASTREADO');
      assert.ok(
        inventario.includes(`${dir}/gate-nao-classificado.js`),
        'e o rastreado precisa continuar dentro: a correção SOMA, não troca',
      );

      const achados = sitios(inventario);
      assert.ok(naoClassificados(achados).some((a) => a.includes('tmp-nao-rastreado')));
      assert.ok(listasFechadasIlegais(achados).some((a) => a.includes('tmp-nao-rastreado')));
    } finally {
      fs.rmSync(abs, { force: true });
    }
  });
});
