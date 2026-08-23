// Path: tests/unit/permissao-de-atlas-censo.test.js
//
// O CENSO DA PERMISSÃO POR ATLAS NO CLIENTE, e o buraco que a própria constituição
// declarava.
//
// Até 2026-08-23 a constituição dizia, com todas as letras: "Nenhum censo deste
// repositório cobre o eixo POR ATLAS: a lista fechada `perm === 'write' || perm ===
// 'owner'`, que já causou bug real duas vezes nos dois pacotes, é cobrada por LEITURA e
// nada mais." Havia seis censos no backend e três no frontend, e nenhum dos nove olhava
// para este eixo. A classe estava VIVA: na mesma semana o botão "Tornar dono"
// (`modals/sharing.modal.js`) gateava em `sessionContext.role === 'owner'` e escondia a
// ação do administrador GLOBAL, que o servidor resolve para `owner`. Foi corrigido à mão,
// por leitura, que é justamente o que não escala.
//
// ================= O QUE ESTE ARQUIVO PROÍBE =================================
//
// UMA COISA SÓ, e ela é mecânica: **comparar POSTO por igualdade ou por lista fechada de
// literais, fora do módulo que implementa a escada**. A escada por atlas tem UMA
// implementação sancionada neste repositório, `src/js/projects/permission-levels.js`
// (`PERMISSION_ORDER`, `permissionRank`, `hasAtLeast`, `atlasRoleHasAtLeast`,
// `serverTreatsAsAtlasOwner`, `isGrantablePermission`), e a segunda porta legítima é o
// gate por CAPACIDADE, `checkPermission(GuardAction.X)`, que resolve a tabela de flags de
// `ROLE_PERMISSIONS` por papel em vez de comparar nomes.
//
// A regra mecânica é a de LISTA FECHADA: uma linha de código que cite DOIS OU MAIS
// valores DISTINTOS do vocabulário deste eixo, ligados por `||`, `&&`, um literal de
// array ou um `.includes(`, é uma lista fechada. Só `permission-levels.js` pode escrever
// uma, porque é ele que define a escada. Duas propriedades disso importam:
//
//   - Ela pega a forma do bug NOS DOIS SENTIDOS. A lista fechada do TOPO
//     (`'owner' || 'manager' || 'admin'`) exclui em silêncio o posto que aparecer acima; a
//     do FUNDO (`viewer || commenter`, que estava em `map-lock.controller.js`) é o mesmo
//     defeito virado do avesso e falha ABERTO, porque um papel que este build não conhece
//     não é nenhum dos dois e escapa do bloqueio.
//   - Ela NÃO pega o literal solto. `permission === 'manage'` num gate é um posto exato e
//     pode estar certo (o servidor tem gates de degrau exato) ou errado. Quem decide isso
//     é a CLASSIFICAÇÃO abaixo, uma entrada por sítio, com motivo escrito.
//
// ================= OS DOIS VOCABULÁRIOS, QUE SÃO A ARMADILHA ==================
//
// O eixo por atlas tem DOIS vocabulários, e é daí que vem a divergência de contagem entre
// os documentos da casa (a constituição diz cinco, `.claude/rules/architecture.md` diz
// seis). O contrato do SERVIDOR é `permission`, CINCO valores em escada
// (`read < comment < write < manage < owner`), e é o que a API devolve como
// `user_permission`. O `UserRole` do CLIENTE (`store/sync/session-context.js`) tem SEIS,
// porque `toFrontendRole` (`backend/src/utils/roles.js`) dobra o `admin` GLOBAL para
// dentro da mesma escada antes de o papel chegar aqui.
//
// A varredura casa OS DOIS, porque a mistura é o defeito: uma tela que segura um
// `UserRole` não consegue usar `hasAtLeast` (que fala a escada do servidor) e por isso
// escrevia lista fechada. A ponte é `atlasRoleHasAtLeast`, acrescentada em 2026-08-23.
//
// O `'admin'` NÃO entra na varredura, e a omissão é medida, não descuido: ele é a palavra
// que os DOIS eixos compartilham, e varrê-lo arrastaria para dentro deste censo todo sítio
// de papel GLOBAL (`isAdmin()`, `GlobalRole.ADMIN`, o gate de `admin.html`), que é outro
// assunto e tem censo próprio do lado do servidor. Ele ENTRA, sim, na contagem de tokens
// da regra de lista fechada, aplicada só às linhas que a varredura já achou por outro
// valor: sem isso `role === 'owner' || role === 'admin'` contaria um token e escaparia.
//
// ================= A VARREDURA ================================================
//
// O inventário vem do VERSIONAMENTO (`git ls-files --cached --others --exclude-standard`
// sobre `src/js`), nunca de uma lista de alvos escrita à mão: "conferir um subconjunto e
// tratar como o conjunto" é a classe mais repetida de `docs/livro-razao.md`. As duas
// bandeiras não são detalhe: `git ls-files` puro enumera só o RASTREADO, e o guarda ficava
// cego exatamente onde o trabalho novo aparece, no gate escrito há cinco minutos, que é o
// que ninguém classificou.
//
// ================= FRAGILIDADES ACEITAS =======================================
//
// (a) O inventário precisa de `git`; se o comando falhar, o caso-piso diz isso nessas
//     palavras, porque falha de ambiente lida como regressão custa mais do que o guarda
//     economiza.
// (b) A remoção de comentário é textual, não é um parser: `//` dentro de string literal
//     seria removido junto. O efeito é perder um sítio, não inventar um.
// (c) QUATRO das nove palavras deste vocabulário são inglês corrente (`read`, `comment`,
//     `write`, `manage`), então o censo carrega homônimos declarados, e vai carregar mais.
//     Isso é o preço de uma varredura larga, e é o câmbio certo: um homônimo custa uma
//     entrada com motivo, um gate perdido custa um bug de acesso.
// (d) O alcance é EXISTÊNCIA e FORMA, nunca comportamento. Que o Gestor de fato veja o
//     botão de compartilhar é teste de comportamento, e mora no Playwright. Um censo verde
//     prova apenas que ninguém escreveu uma comparação nova de posto, o que é útil e não é
//     a mesma coisa.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));

// ============================================================================
// AS CLASSES
// ============================================================================

/** Gate pela HIERARQUIA: o literal é o ARGUMENTO de um predicado da escada. */
const ESCADA = 'gate-por-hierarquia';
/** O módulo que DEFINE a escada. Único que pode escrever lista fechada. */
const DONO_DA_ESCADA = 'dono-da-escada';
/** O arquivo que declara o vocabulário do CLIENTE e a tabela de flags por papel. */
const VOCABULARIO = 'vocabulario-do-cliente';
/** Partição de POSSE (dono ou não), por identidade. Não é comparação de posto. */
const POSSE = 'particao-de-posse';
/** Valor PADRÃO estagiado num payload, que falha fechado. Não é gate. */
const PADRAO = 'valor-padrao-de-entrada';
/** A palavra casou e não é permissão nenhuma. */
const HOMONIMO = 'homonimo';

/** Motivos que se repetem, escritos uma vez. */
const ARG_DA_ESCADA = 'O literal é o ARGUMENTO do predicado da escada, e não um termo de comparação: '
    + 'é o POSTO MÍNIMO que a ação exige. É a forma certa, e ela precisa estar no censo justamente '
    + 'para que a forma errada não se confunda com ela na hora de classificar.';
const QUEDA_PARA_LEITURA = 'Filtro do valor ESTAGIADO na caixa de criação antes de virar chamada de '
    + 'API, derivado de `isGrantablePermission` (todo degrau abaixo de `owner`) e não de um array '
    + 'local. Não é gate: falha para o degrau MAIS BAIXO, então um valor irreconhecível nunca '
    + 'escala. Até 2026-08-23 eram DUAS cópias do array `[read, comment, write, manage]` escritas à '
    + 'mão, aqui e no gêmeo, nenhuma derivada de `PERMISSION_ORDER`.';
const DONO_DA_TRANSFERENCIA = 'O handler de `atlas_owner_changed`, e a comparação é de IDENTIDADE, '
    + 'não de posto: quem virou dono é quem o servidor nomeou, e quem PERDE o posto é o ex-dono e '
    + 'mais ninguém. Rebaixar por hierarquia aqui seria errado, porque o administrador GLOBAL chega '
    + 'como `admin` e não perde nada quando o dono muda. É a dispensa que exige mais cuidado do '
    + 'censo: ela se parece com um gate e não é um.';

/**
 * @typedef {Object} Entrada
 * @property {string} arquivo - Relativo a `frontend/`.
 * @property {string} trecho - Pedaço CONTIDO na linha. `''` significa "toda linha varrida
 *   deste arquivo", usado só nos dois donos de vocabulário, onde entrada por linha seria
 *   uma tabela de enum copiada para dentro de um teste.
 * @property {number} n - Sítios esperados naquele arquivo com aquele trecho.
 * @property {string} classe
 * @property {string} motivo
 */

/** @type {Entrada[]} */
const CENSO = [
    // ============ os dois donos de vocabulário ==============================
    {
        arquivo: 'src/js/projects/permission-levels.js', trecho: '', n: 9, classe: DONO_DA_ESCADA,
        motivo: 'A ÚNICA implementação da escada por atlas neste repositório: a ordem, os rótulos '
            + 'pt-BR, o subconjunto concedível e a tradução do `UserRole` de seis valores do cliente '
            + 'para os cinco do servidor (`ROLE_TO_PERMISSION`, o inverso exato de `toFrontendRole`). '
            + 'É o único arquivo autorizado a escrever uma lista fechada, porque é ele que a define, '
            + 'e o único da varredura com ZERO imports por contrato, que é o que o mantém carregável '
            + 'em `atlas.html`, página que boota sem a store.',
    },
    {
        arquivo: 'src/js/store/sync/session-context.js', trecho: '', n: 17, classe: VOCABULARIO,
        motivo: 'Declara o `UserRole` (o vocabulário de SEIS valores do cliente) e a tabela '
            + '`ROLE_PERMISSIONS`, que é de FLAGS por papel e NÃO tem ordem: gatear a partir dela '
            + 'obriga a comparar por igualdade, que é a forma proibida. O caminho legítimo que sai '
            + 'daqui é `checkPermission(GuardAction.X)`, no `permission-guard.js`, que consulta a '
            + 'flag e nunca o nome. As linhas varridas são a declaração do enum, as chaves da tabela '
            + 'e o default `VIEWER` de sessão pela metade, que é a degradação fechada certa. Ele NÃO '
            + 'é dispensado da regra de lista fechada: um `||` de dois papéis escrito aqui reprova.',
    },

    // ============ gates pela hierarquia (a forma certa) =====================
    {
        arquivo: 'src/js/account/account.control.js',
        trecho: "atlasRoleHasAtLeast(sessionContext.role, 'manage')", n: 1, classe: ESCADA,
        motivo: `${ARG_DA_ESCADA} Item "Compartilhar" do menu da conta. Era `
            + "`role === 'owner' || role === 'manager' || role === 'admin'`, corrigido em "
            + '2026-08-23. O posto do servidor é `manage` em todo `sharing.routes.js`.',
    },
    {
        arquivo: 'src/js/account/account.control.js',
        trecho: 'isGrantablePermission(member.permission)', n: 1, classe: ESCADA,
        motivo: QUEDA_PARA_LEITURA,
    },
    {
        arquivo: 'src/js/projects/projects-page.js',
        trecho: 'isGrantablePermission(member.permission)', n: 1, classe: ESCADA,
        motivo: `${QUEDA_PARA_LEITURA} Este é o gêmeo: a MESMA função, para o mesmo diálogo de `
            + 'criação, na página que não tem a store. As duas continuam separadas porque os '
            + 'clientes HTTP e os toasts são outros, mas a lista de níveis agora é uma só.',
    },
    {
        arquivo: 'src/js/sidebar/tabs/maps.tab.js',
        trecho: "atlasRoleHasAtLeast(sessionContext.role, 'manage')", n: 1, classe: ESCADA,
        motivo: `${ARG_DA_ESCADA} O \`canManage\` que a aba de mapas passa ao modal de `
            + 'configurações do atlas (`PATCH /atlas/:atlasId/settings`, posto `manage`). Era uma '
            + 'lista fechada oito linhas abaixo de `_canRenameAtlas`, cujo `fileoverview` de nove '
            + 'linhas explica por que não se escreve uma. Corrigido em 2026-08-23.',
    },
    {
        arquivo: 'src/js/locking/map-lock.controller.js',
        trecho: "atlasRoleHasAtLeast(sessionContext.role, 'write')", n: 1, classe: ESCADA,
        motivo: '`isReadOnly()`, escrito como a AUSÊNCIA de `write`. Era `role === UserRole.VIEWER '
            + '|| role === UserRole.COMMENTER`, uma lista fechada do FUNDO, que falhava ABERTO: um '
            + 'papel desconhecido não era nenhum dos dois e destrancava o cadeado. O gêmeo deste '
            + 'arquivo, `canToggleLock`, virou `serverTreatsAsAtlasOwner` e saiu da varredura por '
            + 'não citar literal nenhum, que é o destino certo de um predicado nomeado.',
    },
    {
        arquivo: 'src/js/projects/atlas-drive.js', trecho: 'hasAtLeast(permission, ', n: 3,
        classe: ESCADA,
        motivo: `${ARG_DA_ESCADA} As três capacidades do cartão do atlas no seletor (escrever, `
            + 'gerir, transferir posse), sobre o `user_permission` cru que a API devolve. São o '
            + 'exemplo canônico da forma certa neste repositório.',
    },
    {
        arquivo: 'src/js/projects/atlas-drive.js', trecho: "getPermissionLabel('owner')", n: 1,
        classe: ESCADA,
        motivo: 'RÓTULO, não gate: o texto pt-BR do degrau, resolvido pela mesma fonte que a escada, '
            + 'para que a tela nunca chame um nível por um nome que outra tela não usa.',
    },
    {
        arquivo: 'src/js/modals/sharing.modal.core.js', trecho: 'isGrantablePermission(group?.permission)',
        n: 1, classe: ESCADA,
        motivo: 'Nível corrente de um SHARE DE GRUPO no seletor, com queda para `read` quando o '
            + 'servidor manda algo que esta versão não conhece (`owner` inclusive, que não é '
            + 'concedível). Queda para o degrau mais baixo é a direção fechada.',
    },
    {
        arquivo: 'src/js/modals/sharing.modal.core.js', trecho: 'isGrantablePermission(share?.permission)',
        n: 1, classe: ESCADA,
        motivo: 'O mesmo para o share de PESSOA. As duas entradas ficam separadas porque os dois '
            + 'alvos de share (`user_id` e `group_id`) são eixos distintos do lado do servidor, e '
            + 'uma correção num não alcança o outro.',
    },
    {
        arquivo: 'src/js/modals/create-atlas.modal.js',
        trecho: 'isGrantablePermission(member?.permission)', n: 1, classe: ESCADA,
        motivo: 'Nível corrente do membro ESTAGIADO na criação do atlas (nada foi ao servidor '
            + 'ainda). Cai para `write`, e não para `read`, porque aqui o padrão da tela é Edição: '
            + 'ver a entrada de `DEFAULT_GRANT_PERMISSION` deste mesmo arquivo.',
    },
    {
        arquivo: 'src/js/modals/create-atlas.modal.js',
        trecho: 'isGrantablePermission(permission) ? permission', n: 1, classe: ESCADA,
        motivo: 'A escrita do nível estagiado, mesmo filtro da leitura acima. Entram separadas '
            + 'porque são leitura e escrita da mesma lista, e um filtro só de leitura deixaria a '
            + 'estrutura aceitar em memória o que a tela recusa desenhar.',
    },

    // ============ valores padrão (não são gate) =============================
    {
        arquivo: 'src/js/modals/sharing.modal.core.js', trecho: "const DEFAULT_GRANT_PERMISSION = 'read'",
        n: 1, classe: PADRAO,
        motivo: 'O nível com que uma pessoa recém-escolhida na busca ENTRA na lista: Leitura. Não é '
            + 'comparação, é política de produto ("a permissão padrão abaixa, nunca eleva"). Está '
            + 'no censo porque a varredura o alcança, e um censo com buraco silencioso não é censo.',
    },
    {
        arquivo: 'src/js/modals/create-atlas.modal.js',
        trecho: "const DEFAULT_GRANT_PERMISSION = 'write'", n: 1, classe: PADRAO,
        motivo: 'O gêmeo do anterior, e ele DIVERGE de propósito: quem se acrescenta a um atlas que '
            + 'está sendo CRIADO é convidado a colaborar, então o padrão é Edição. As duas entradas '
            + 'existem para que a divergência fique declarada em vez de parecer descuido.',
    },

    // ============ partição de posse (identidade, não posto) =================
    {
        arquivo: 'src/js/projects/atlas-drive.js', trecho: "user_permission === 'owner'", n: 2,
        classe: POSSE,
        motivo: 'A aba "Meus" do seletor e a autoria do cartão ("por Você"). É uma PARTIÇÃO binária '
            + 'de posse, não um degrau da escada: `hasAtLeast(perm, "owner")` daria a mesma resposta '
            + 'hoje e diria outra coisa, porque a pergunta não é "alcança o topo?", é "este atlas é '
            + 'meu?". Um Gestor com `manage` não é dono e não pode aparecer em "Meus".',
    },
    {
        arquivo: 'src/js/projects/atlas-drive.js', trecho: "user_permission !== 'owner'", n: 1,
        classe: POSSE,
        motivo: 'O complemento exato da linha acima, a aba "Compartilhados". Entra separada porque a '
            + 'negação é o lado que se esquece de acompanhar quando a partição muda, e as duas '
            + 'juntas precisam cobrir a lista inteira.',
    },
    {
        arquivo: 'src/js/store/sync/sync-engine.js', trecho: "role: 'owner'", n: 1, classe: POSSE,
        motivo: 'Eleva o papel local no instante em que o snapshot chega, e só quando o `ownerId` do '
            + 'atlas é o próprio usuário: comparação de IDENTIDADE contra `atlas.owner_id`, seguida '
            + 'de uma ATRIBUIÇÃO do valor de topo. Não há posto a comparar. O `connected` do '
            + 'WebSocket reconfirma o papel logo depois e resolve todos os outros.',
    },
    {
        arquivo: 'src/js/store/sync/sync-engine.js', trecho: "updateRole('owner')", n: 1,
        classe: POSSE, motivo: DONO_DA_TRANSFERENCIA,
    },
    {
        arquivo: 'src/js/store/sync/sync-engine.js', trecho: "sessionContext.role === 'owner'", n: 1,
        classe: POSSE,
        motivo: `${DONO_DA_TRANSFERENCIA} Este é o termo que decide o REBAIXAMENTO, e é o sítio que `
            + 'um censo desatento "corrigiria" para hierarquia: trocar por '
            + '`atlasRoleHasAtLeast(role, "owner")` rebaixaria o administrador global a `manager` '
            + 'toda vez que qualquer atlas trocasse de dono.',
    },
    {
        arquivo: 'src/js/store/sync/sync-engine.js', trecho: "updateRole('manager')", n: 1,
        classe: POSSE,
        motivo: `${DONO_DA_TRANSFERENCIA} O ex-dono cai para co-Gestor, que é o que o servidor grava `
            + 'na mesma transação da transferência (`atlas.service.js` insere um share `manage` para '
            + 'ele). Atribuição, não comparação.',
    },

    // ============ homônimos =================================================
    {
        arquivo: 'src/js/comment_tool/comment-overlay.js', trecho: "this.type = 'comment'", n: 1,
        classe: HOMONIMO,
        motivo: 'O `type` de FERRAMENTA da sobreposição de comentários, que dirige o chip de '
            + 'ferramenta ativa e a exclusividade mútua do tool manager. Nada a ver com o degrau '
            + '`comment` da escada. Este arquivo gateia de verdade em outro ponto, e ali usa '
            + '`checkPermission(GuardAction.CREATE_COMMENT)`, que é a forma certa e não cita '
            + 'literal nenhum, então nem aparece nesta varredura.',
    },
    {
        arquivo: 'src/js/toolbar/components/active-tool-chip.js', trecho: "'comment',", n: 1,
        classe: HOMONIMO,
        motivo: 'O mesmo `type` de ferramenta, do outro lado: a lista de ferramentas que o chip '
            + 'sabe rotular. Homônimo puro.',
    },
    {
        arquivo: 'src/js/store/sync/operation-types.js', trecho: "COMMENT: 'comment'", n: 1,
        classe: HOMONIMO,
        motivo: 'O `entityType` de OPERAÇÃO de sync do comentário espacial. Homônimo do degrau, e '
            + 'dos mais perigosos de ler ao contrário, porque os dois convivem na MESMA linha do '
            + 'servidor (`permission === "comment" && op.target !== "comment"`), onde um é o posto '
            + 'de quem escreve e o outro é o que está sendo escrito.',
    },
    {
        arquivo: 'src/js/phone/phone-feature-editor.js', trecho: "READ: 'read'", n: 1,
        classe: HOMONIMO,
        motivo: 'Modo de VISUALIZAÇÃO do editor de feição no celular (`read`/`edit`/`move`). '
            + 'Homônimo do degrau mais baixo da escada, e sem parentesco: ele descreve a tela, não '
            + 'quem a abriu.',
    },
];

/** O único arquivo que pode escrever uma lista fechada, porque é ele que define a escada. */
const DONO_DO_VOCABULARIO = 'src/js/projects/permission-levels.js';

// ============================================================================
// A VARREDURA
// ============================================================================

/**
 * Remove comentário de bloco e de linha, preservando a contagem de linhas.
 *
 * A NORMALIZAÇÃO DE CRLF NÃO É COSMÉTICA: os arquivos deste repositório terminam em
 * `\r\n`, e em regex de JavaScript `\r` é TERMINADOR DE LINHA, então `.` não o casa. Sem
 * ela a remoção de comentário rodaria devolvendo o texto intacto, sem erro, e o censo
 * passaria a cobrar classificação de linhas que são prosa.
 * @param {string} src
 * @returns {string}
 */
function semComentarios(src) {
    const normalizado = src.replace(/\r\n?/g, '\n');
    const semBloco = normalizado.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
    return semBloco.split('\n').map((linha) => linha.replace(/\/\/.*/, '')).join('\n');
}

const lerCodigo = (arquivo) => semComentarios(readFileSync(path.join(RAIZ, arquivo), 'utf8'));

/**
 * O INVENTÁRIO: rastreado MAIS não rastreado não ignorado.
 *
 * `git ls-files src/js` sozinho lista só o que já passou por `git add`, e o ponto cego que
 * isso abre fica no pior lugar possível: o gate escrito há cinco minutos é o que ninguém
 * classificou, e era o único que a varredura não via.
 * @param {string} [pathspec] - Relativo a `frontend/`.
 * @returns {string[]} Caminhos relativos, só `.js`.
 */
function arquivosDoInventario(pathspec = 'src/js') {
    return execFileSync(
        'git',
        ['ls-files', '--cached', '--others', '--exclude-standard', pathspec],
        { cwd: RAIZ, encoding: 'utf8' },
    ).split('\n').map((s) => s.trim()).filter((s) => s.endsWith('.js'));
}

/**
 * O GATILHO: os NOVE valores exclusivos deste eixo (cinco do servidor, mais os quatro
 * nomes que só o `UserRole` do cliente tem), entre aspas, ou uma referência ao símbolo
 * `UserRole.X`. O `'admin'` fica de fora de propósito: ver o cabeçalho.
 */
const GATILHO = /'(read|comment|write|manage|owner|viewer|commenter|editor|manager)'|"(read|comment|write|manage|owner|viewer|commenter|editor|manager)"|\bUserRole\.[A-Z_]+/;

/**
 * OS TOKENS DA REGRA DE LISTA FECHADA, aplicados só a linhas que o gatilho já achou. Aqui
 * o `'admin'` ENTRA, porque `role === 'owner' || role === 'admin'` é uma lista fechada de
 * dois e sem ele contaria um.
 */
const TOKENS = /'(read|comment|write|manage|owner|viewer|commenter|editor|manager|admin)'|"(read|comment|write|manage|owner|viewer|commenter|editor|manager|admin)"|\bUserRole\.[A-Z_]+/g;

/** O que transforma uma citação em COMPOSIÇÃO: disjunção, conjunção, array, pertinência. */
const COMPOSICAO = /\|\||&&|\[|\.includes\s*\(/;

/**
 * É esta linha uma LISTA FECHADA de postos?
 *
 * DOIS OU MAIS tokens DISTINTOS, compostos. O "distintos" não é zelo: sem ele o
 * `permission === 'comment' && op.target !== 'comment'` do servidor (posto de quem escreve
 * E tipo do que se escreve) contaria dois e viraria falso positivo, e falso positivo é o
 * que faz alguém desligar um censo.
 * @param {string} linha
 * @returns {boolean}
 */
function ehListaFechada(linha) {
    if (!COMPOSICAO.test(linha)) return false;
    return new Set([...linha.matchAll(TOKENS)].map((m) => m[0])).size >= 2;
}

/**
 * Todo sítio deste eixo, por arquivo e linha.
 * @param {string[]} arquivos
 * @returns {Array<{arquivo: string, n: number, texto: string, fechada: boolean}>}
 */
function sitios(arquivos) {
    const achados = [];
    for (const arquivo of arquivos) {
        lerCodigo(arquivo).split('\n').forEach((linha, i) => {
            if (!GATILHO.test(linha)) return;
            achados.push({
                arquivo, n: i + 1, texto: linha.trim(), fechada: ehListaFechada(linha),
            });
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

/** As listas fechadas fora do dono da escada, no formato de mensagem de erro. */
function listasFechadasIlegais(achados) {
    return achados
        .filter((a) => a.fechada && a.arquivo !== DONO_DO_VOCABULARIO)
        .map((a) => `${a.arquivo}:${a.n} ${a.texto}`);
}

describe('Censo da permissão por atlas no cliente', () => {
    it('piso: o inventário vem do git e alcança as telas que gateiam por atlas', () => {
        let arquivos;
        try {
            arquivos = arquivosDoInventario();
        } catch (err) {
            throw new Error(
                `o inventário deste censo vem de \`git ls-files\` e o comando FALHOU (${err.message}). `
                + 'Isto é falha de ambiente, não regressão de código: rode dentro do repositório.',
            );
        }
        expect(arquivos.length).toBeGreaterThanOrEqual(300);
        expect(arquivos).toContain(DONO_DO_VOCABULARIO);
        expect(arquivos).toContain('src/js/store/sync/session-context.js');
        expect(arquivos).toContain('src/js/modals/sharing.modal.js');

        // O piso é a contagem MEDIDA, não uma folga: folga é onde um sítio some sem
        // ninguém ver. Se o eixo encolher de propósito, baixe o número com a razão ao lado.
        const achados = sitios(arquivos);
        expect(achados.length).toBeGreaterThanOrEqual(45);

        // A OUTRA METADE DO INVENTÁRIO: `--others` SEM `--exclude-standard` arrastaria
        // `node_modules/` e `dist/` inteiros. A medição é sobre o PACOTE, porque em
        // `src/js` não há nada ignorado e medir ali seria vácuo.
        expect(existsSync(path.join(RAIZ, 'node_modules')), 'sem `node_modules` no disco a medição é vácua').toBe(true);
        const doPacote = arquivosDoInventario('.');
        expect(doPacote.filter((a) => /(^|[/])(node_modules|dist|coverage|test-results)[/]/.test(a))).toEqual([]);
    });

    it('todo sítio de permissão por atlas está no censo, com classe e motivo', () => {
        const achados = sitios(arquivosDoInventario());
        expect(achados.length).toBeGreaterThanOrEqual(45);

        expect(
            naoClassificados(achados),
            'sítio de permissão POR ATLAS fora do censo. Classifique-o em '
            + `'${ESCADA}' (o literal é o POSTO MÍNIMO passado a um predicado de `
            + '`projects/permission-levels.js`), '
            + `'${POSSE}' (partição dono/não-dono por identidade), `
            + `'${PADRAO}' (valor padrão estagiado, que falha fechado) ou `
            + `'${HOMONIMO}' (a palavra não é permissão), com motivo escrito. `
            + 'Se for um gate novo, use `atlasRoleHasAtLeast` ou `checkPermission`, nunca `===`.',
        ).toEqual([]);
    });

    it('NENHUMA lista fechada de postos fora do módulo que define a escada', () => {
        // A COBRANÇA MECÂNICA DESTE ARQUIVO, e a que pega a forma exata do bug que já
        // embarcou duas vezes. Ela é independente da classificação: mesmo um sítio
        // devidamente classificado reprova aqui se for escrito como lista fechada.
        const achados = sitios(arquivosDoInventario());

        expect(
            listasFechadasIlegais(achados), [
                'LISTA FECHADA de permissão de atlas fora de `projects/permission-levels.js`.',
                'Dois ou mais níveis citados na mesma linha, ligados por `||`, `&&`, array ou',
                '`.includes(`, é a forma que exclui em silêncio o degrau que aparecer no meio',
                '(a do TOPO) ou deixa passar o papel desconhecido (a do FUNDO).',
                'Use `atlasRoleHasAtLeast(role, "manage")`, `hasAtLeast(permission, "write")`,',
                '`serverTreatsAsAtlasOwner(role)` ou `checkPermission(GuardAction.X)`.',
            ].join(' '),
        ).toEqual([]);

        // DISCRIMINAÇÃO: o dono da escada de fato escreve listas fechadas, senão esta
        // varredura estaria medindo um predicado que nunca casa nada.
        const doDono = achados.filter((a) => a.arquivo === DONO_DO_VOCABULARIO && a.fechada);
        expect(
            doDono.length,
            'o dono da escada precisa conter pelo menos uma lista de níveis: é ele que a define',
        ).toBeGreaterThanOrEqual(1);
    });

    it('a contagem por entrada bate: apagar um sítio é tão vermelho quanto acrescentar', () => {
        const achados = sitios(arquivosDoInventario());
        const divergentes = CENSO
            .map((e) => {
                const vistos = achados
                    .filter((a) => a.arquivo === e.arquivo && a.texto.includes(e.trecho)).length;
                return { ...e, vistos };
            })
            .filter((e) => e.vistos !== e.n)
            .map((e) => `${e.arquivo} :: "${e.trecho}" esperava ${e.n}, achei ${e.vistos}`);
        expect(divergentes, 'a contagem do censo divergiu do código').toEqual([]);

        // Entrada MORTA reprova junto: um arquivo que saiu da varredura e continua no
        // censo é a dispensa que sobrevive ao beneficiário, que é como um guarda volta a
        // abrir sozinho. O caso acima já cobre isso (`vistos` seria 0), e esta linha
        // afirma o par (arquivo, trecho) único, para que duas entradas não se cubram.
        const chaves = CENSO.map((e) => `${e.arquivo}\t${e.trecho}`);
        expect(new Set(chaves).size).toBe(chaves.length);
    });

    it('toda entrada tem classe válida e motivo escrito', () => {
        const classes = [ESCADA, DONO_DA_ESCADA, VOCABULARIO, POSSE, PADRAO, HOMONIMO];
        const ruins = CENSO
            .filter((e) => !classes.includes(e.classe) || !e.motivo || e.motivo.length < 60)
            .map((e) => `${e.arquivo} :: ${e.trecho}`);
        expect(ruins).toEqual([]);

        // Cada vocabulário tem UM dono, e exatamente um: dois donos é o começo de duas
        // escadas, que é o defeito que o backend já pagou em `fn_user_atlas_shares`.
        expect(CENSO.filter((e) => e.classe === DONO_DA_ESCADA)).toHaveLength(1);
        expect(CENSO.filter((e) => e.classe === VOCABULARIO)).toHaveLength(1);

        // A dispensa por ARQUIVO INTEIRO (`trecho: ''`) é a mais forte que este censo
        // concede, e por isso é fechada: só os dois donos de vocabulário a recebem.
        const porArquivoInteiro = CENSO.filter((e) => e.trecho === '').map((e) => e.arquivo);
        expect(porArquivoInteiro.sort()).toEqual([
            'src/js/projects/permission-levels.js',
            'src/js/store/sync/session-context.js',
        ]);
    });

    it('os gates classificados como ESCADA de fato chamam a escada', () => {
        // Sem isto, `ESCADA` seria um rótulo que qualquer linha poderia receber. A
        // cobrança é sobre o ARQUIVO: ele precisa importar `permission-levels.js`, que é a
        // única implementação sancionada da hierarquia neste repositório.
        const daEscada = [...new Set(CENSO.filter((e) => e.classe === ESCADA).map((e) => e.arquivo))];
        expect(daEscada.length).toBeGreaterThanOrEqual(6);

        const semImport = daEscada
            .filter((a) => !lerCodigo(a).includes("projects/permission-levels.js'"))
            .map((a) => `${a} foi classificado como gate por hierarquia e não importa a escada`);
        expect(semImport).toEqual([]);

        // DISCRIMINAÇÃO: os homônimos NÃO a importam, e é exatamente por isso que não são
        // gates. Sem esta metade, "todos importam" seria o que se mede num conjunto em que
        // todo arquivo importa tudo.
        const homonimos = [...new Set(CENSO.filter((e) => e.classe === HOMONIMO).map((e) => e.arquivo))];
        expect(homonimos.length).toBeGreaterThanOrEqual(3);
        const importam = homonimos.filter((a) => lerCodigo(a).includes("projects/permission-levels.js'"));
        expect(importam).toEqual([]);
    });

    it('o inventário ENXERGA arquivo NOVO ainda não rastreado (provado, não afirmado)', () => {
        // O CEGO QUE ESTE CASO FECHA é de CONJUNTO, não de classificação: `git ls-files`
        // sozinho enumera o índice, então o gate escrito há cinco minutos ficava fora da
        // varredura até alguém dar `git add`. Provar a correção exige um arquivo que EXISTA
        // e NÃO esteja rastreado: ele nasce aqui e morre no `finally`. Fica em
        // `tests/fixtures/`, longe de `src/js`, para não aparecer no inventário de nenhum
        // outro guarda enquanto existe.
        const dir = 'tests/fixtures/censo-permissao-de-atlas';
        const relativo = `${dir}/tmp-nao-rastreado.js`;
        const abs = path.join(RAIZ, relativo);
        writeFileSync(abs, [
            `// Path: ${relativo}`,
            '// Temporário: criado e apagado pelo controle negativo deste censo.',
            "export const podeGerir = (p) => p === 'manage' || p === 'owner';",
            '',
        ].join('\n'));

        try {
            // CONTROLE: o git precisa CONCORDAR que ele não está rastreado, e precisa
            // enxergar a fixture RASTREADA do mesmo pathspec. Sem este par, o caso passaria
            // verde num mundo em que alguém tivesse dado `git add` no temporário.
            const soRastreados = execFileSync('git', ['ls-files', dir], { cwd: RAIZ, encoding: 'utf8' });
            expect(soRastreados).not.toContain('tmp-nao-rastreado');
            expect(soRastreados).toContain('gate-nao-classificado.js');

            const inventario = arquivosDoInventario(dir);
            expect(inventario, 'o inventário precisa enxergar o arquivo NÃO RASTREADO').toContain(relativo);
            expect(inventario, 'e o rastreado precisa continuar dentro: a correção SOMA, não troca')
                .toContain(`${dir}/gate-nao-classificado.js`);

            // E A CADEIA INTEIRA, pelas MESMAS funções dos casos acima: o sítio do arquivo
            // novo é acusado como não classificado E como lista fechada.
            const achados = sitios(inventario);
            expect(naoClassificados(achados).some((a) => a.includes('tmp-nao-rastreado'))).toBe(true);
            expect(listasFechadasIlegais(achados).some((a) => a.includes('tmp-nao-rastreado'))).toBe(true);
        } finally {
            rmSync(abs, { force: true });
        }
    });

    it('a varredura REPROVA um gate novo não classificado (provado com fixture)', () => {
        // AS MESMAS FUNÇÕES dos casos acima, apontadas para uma fixture com as DUAS formas
        // que este arquivo distingue: a lista fechada canônica e o literal solto num gate.
        const fixture = 'tests/fixtures/censo-permissao-de-atlas/gate-nao-classificado.js';
        const achados = sitios([fixture]);
        expect(achados).toHaveLength(2);

        const acusados = naoClassificados(achados);
        expect(acusados).toHaveLength(2);
        expect(acusados.every((a) => a.includes('gate-nao-classificado.js'))).toBe(true);

        // E A DISCRIMINAÇÃO ENTRE AS DUAS REGRAS: só a primeira função é lista fechada. Uma
        // regra que acusasse as duas seria uma regra que acusa tudo.
        const fechadas = listasFechadasIlegais(achados);
        expect(fechadas).toHaveLength(1);
        expect(fechadas[0]).toContain("permission === 'write' || permission === 'owner'");

        // E sobre o código REAL, as duas funções não acusam ninguém.
        const reais = sitios(arquivosDoInventario());
        expect(naoClassificados(reais)).toEqual([]);
        expect(listasFechadasIlegais(reais)).toEqual([]);
    });
});
