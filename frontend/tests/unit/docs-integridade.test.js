// Path: tests/unit/docs-integridade.test.js
//
// A documentação é verificada pelo CI, não pela disciplina de quem escreve.
//
// Por que existe: "atualize os docs" como regra cultural sempre falha; o único
// mecanismo que segura frescor é o que QUEBRA O BUILD. E documentação
// desatualizada é pior que documentação ausente, porque engana ativamente — vale
// em dobro com agentes de IA, que tratam a doc como verdade e propagam o erro
// para o código (um humano desconfia de doc velha; um agente não).
//
// Esta sessão produziu a prova: o antigo `99-pendencias-e-desvios.md` documentava
// a permissão por atlas como `owner/write/read` quando o CHECK do banco tem CINCO
// níveis, e foi exatamente esse modelo mental de 3 níveis que silenciou a seleção
// do co-Gestor no `handleSelection`. Nenhum teste pegava isso.
//
// Cobre três classes de podridão:
//   1. caminho de arquivo citado na doc que não existe mais (renomeado/removido);
//   2. link markdown relativo apontando para arquivo inexistente;
//   3. [[wikilink]] apontando para página de wiki inexistente. O Claude Code não
//      tem resolvedor de wikilink (para o agente é texto literal, que ele resolve
//      por grep), então validar o alvo aqui devolve a propriedade que o formato
//      não dá sozinho: renomear uma página quebra o teste, não o silêncio.
//   4. SÍMBOLO citado entre crases que não existe em nenhum lugar do código.
//      Acrescentado em 2026-07-25, e a razão vale mais que a regra: as classes 1 a 3
//      validam o CAMINHO citado e nunca o que ele contém, então uma citação a uma
//      FUNÇÃO inexistente atravessava tudo em silêncio. Foi assim que
//      `.claude/rules/architecture.md` passou meses afirmando que o boot reconecta o
//      último atlas, citando um `reconnectLastAtlas` com zero ocorrências em `src/`,
//      num arquivo carregado como instrução em TODA sessão de agente. A wiki tinha a
//      contradição registrada e pendente; nada quebrava. Na primeira execução esta
//      regra achou dois desses: aquele e o `needsMigration` de
//      `.claude/rules/common-tasks.md`, cuja função real é `detectMigrationNeeded`.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Raiz do MONOREPO, tres niveis acima (frontend/tests/unit/ -> frontend/ -> raiz),
// nao a raiz do pacote: a doc vigiada (docs/, CLAUDE.md, .claude/) e do monorepo.
// Quando o pacote web virou frontend/ em 2026-07-18 isto apontava para frontend/,
// e a lista de documentos silenciosamente zerou. O teste "lista os documentos
// vigiados" existe exatamente para isso e foi ele que acusou.
const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** Documentos sob vigilância: os que orientam humano e agente. */
const ALVOS = [
    'CLAUDE.md',
    'README.md',
    // A CONSTITUIÇÃO ESTEVE FORA DESTA LISTA ATÉ 2026-08-21, e o preço apareceu inteiro de
    // uma vez: o commit que virou cinco ondas de decisão em código mudou o estado de UMA
    // cláusula e deixou 23 dizendo `[em obra]` sobre coisas já entregues, doze delas com uma
    // frase começando em "Hoje" que afirmava o OPOSTO do código. Uma auditoria por seções
    // achou todas. Nenhuma das quatro classes de podridão alcançava o arquivo, porque ele
    // mora na raiz e a raiz não é varrida: `PASTAS` cobre `docs/` e `.claude/`, e `ALVOS` é
    // uma lista escrita à mão. Documento que orienta e não é vigiado envelhece exatamente
    // como este envelheceu, e este envelhece pior que os outros, porque é ele que diz o que
    // o produto DEVE fazer.
    //
    // SAIBA O ALCANCE, que é o de sempre: isto valida CAMINHO, LINK e SÍMBOLO citados. Não
    // valida que uma cláusula `[vigente]` seja verdadeira. Quem faz isso é
    // `frontend/tests/unit/constituicao-estado-das-clausulas.test.js`, e o que ele alcança
    // está escrito lá.
    'CONSTITUICAO.md',
    // Entra pela mesma razão, e com a ressalva registrada mais abaixo sobre documento de
    // trabalho pendente: este é citado pela cláusula 10.1, então precisa existir e precisa
    // que os caminhos que ele cita resolvam.
    'PENDENCIA-TILE-PRIVADO.md',
    // MEMORY.md e livro-razao.md moraram na RAIZ até 2026-08-14, quando o dono
    // pediu os dois dentro de `docs/`. A mudança de uma linha de caminho aqui é o
    // passo que mais fácil se esquece e o único que falha CALADO: a montagem de
    // DOCS filtra por existsSync, então caminho velho não dá erro, some da lista
    // vigiada. Medido no movimento: os dois saíram de DOCS e o teste de tamanho
    // do MEMORY.md (que fazia `if (!existsSync) return`) passou verde sem abrir
    // arquivo nenhum. O teste "todo alvo declarado existe", abaixo, fecha isso.
    'docs/MEMORY.md',
    'docs/livro-razao.md',
    'backend/CLAUDE.md',
    'backend/README.md',
    // A doc da própria SUÍTE estava fora desta lista, e foi a única que apodreceu
    // sem nada ficar vermelho: a auditoria de 2026-08-14 achou nela um roadmap
    // mandando escrever quatro suítes que já existem, um backlog cujo "Top 10"
    // repete o que a seção acima declara concluído, e a afirmação de que
    // `npm test` "roda toda a suíte" quando o vitest.config exclui os dois
    // diretórios de e2e. Documento que orienta agente e não é vigiado envelhece
    // exatamente como este envelheceu.
    'frontend/tests/TESTING.md',
    'frontend/tests/TESTING-BACKLOG.md',
];
// O `PENDENCIAS-INTEGRACAO-MAIN-360.md` esteve aqui até 2026-08-21, e saiu com o
// arquivo. Ele não foi marcado como resolvido: foi APAGADO, e o que sobrou dele
// (as dívidas que continuam abertas) virou entrada em `docs/decisions/decisions-2026.md`.
// A razão está lá por extenso, e é a mesma que este guarda já servia: documento de
// trabalho pendente é o que mais depressa perde sincronia, porque descreve o que ainda
// vai mudar, e conferir código contra ele confirma frase falsa com ar de verificação.
// `.claude/agents` entrou depois: a auditoria de 2026-07-18 achou erro real em
// arquivo de agente (e no extinto launch.json) justamente por estarem fora desta
// lista. Cobertura que para na borda de um diretório é cobertura que não cobre.
const PASTAS = ['docs', '.claude/rules', '.claude/skills', '.claude/agents'];

/** Coleta recursivamente os .md das pastas vigiadas, ignorando node_modules. */
function coletarMarkdown(dir, acc = []) {
    const abs = join(RAIZ, dir);
    if (!existsSync(abs)) return acc;
    for (const nome of readdirSync(abs)) {
        if (nome === 'node_modules') continue;
        const rel = `${dir}/${nome}`;
        if (statSync(join(RAIZ, rel)).isDirectory()) coletarMarkdown(rel, acc);
        else if (nome.endsWith('.md')) acc.push(rel);
    }
    return acc;
}

// Set: `docs/` é varrido inteiro por PASTAS, então um ALVO que mora lá dentro
// entraria duas vezes e seria checado em dobro. Declarar o alvo mesmo assim é de
// propósito: PASTAS garante que o arquivo é lido enquanto estiver em `docs/`,
// ALVOS garante que ele está NAQUELE caminho, que é o que o resto do corpus (e o
// teto de tamanho do MEMORY.md) aponta.
const DOCS = [...new Set([...ALVOS.filter((f) => existsSync(join(RAIZ, f))), ...PASTAS.flatMap((p) => coletarMarkdown(p))])];

/**
 * Caminhos de código citados em backticks: `frontend/src/js/store/store.js`,
 * `backend/src/config.js:290-292`. Exige uma extensão conhecida para não
 * confundir com nomes de conceito, e ignora globs/placeholders (`*`, `<`, `{`).
 *
 * O sufixo `:linha` é OPCIONAL e capturado à parte, de propósito. Sem ele a
 * regex exigia a crase logo após a extensão, então toda citação no formato
 * `arquivo:linha` escapava da checagem: 1116 citações não verificadas contra
 * 210 verificadas, e `arquivo:linha` é justamente o formato que o
 * `docs/wiki/wiki-schema.md` manda usar. O teste passava verde medindo a
 * minoria. Só o caminho é validado; o número da linha não dá para verificar
 * aqui, e fingir que dá seria o mesmo erro de novo.
 *
 * O PREFIXO não é uma lista fechada, e essa é a segunda lição do mesmo arquivo.
 * A versão anterior aceitava só `frontend|backend|src|tests|docs|scripts|deploy|public`,
 * então as 53 citações que ainda usavam os prefixos pré-monorepo `ebgeo_backend/`
 * e `ebgeo_web/` não casavam, não eram coletadas e não eram verificadas — o mesmo
 * defeito estrutural do sufixo, agora no começo da string. `docs/wiki/ack-idempotencia.md`
 * chegou a ter as duas formas na MESMA linha, com metade guardada. Lista fechada
 * silencia o que não conhece, então aqui a regra é inversa: colete QUALQUER token
 * com cara de caminho e extensão conhecida, e deixe a existência do arquivo ser a
 * asserção. Prefixo desconhecido passa a falhar em vez de escapar, e a próxima
 * renomeação de pasta acusa em vez de silenciar.
 */
const RE_CAMINHO =
    /`([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+\.(?:js|cjs|mjs|json|sql|css|md|yml|sh))(?::\d+(?:[\s,-]*\d+)*)?`/g;

/** Links markdown relativos: [texto](caminho.md) ou (./x.js), sem URL nem âncora pura. */
const RE_LINK = /\]\((\.{0,2}\/?[A-Za-z0-9._/-]+\.(?:md|js|sql|json|sh|yml))(?:#[^)]*)?\)/g;

/**
 * Links markdown para DIRETÓRIO: `[guias](backend/docs/implementado/)`. A regex de
 * arquivo acima exige extensão conhecida, então link para pasta nunca era checado —
 * e o único link markdown morto de todo o corpus vigiado era exatamente desse tipo,
 * apontando para um diretório de guias que a wiki absorveu e que deixou de existir.
 * Mesma classe do prefixo e do sufixo: o que a regra não casa, ela abençoa.
 */
const RE_LINK_DIR = /\]\((\.{0,2}\/?(?:[A-Za-z0-9._-]+\/)+)\)/g;

/** Wikilinks: [[slug]] — não resolvem no Claude Code. */
const RE_WIKILINK = /\[\[([^\]]+)\]\]/g;

/** Caminhos que existem como referência histórica/externa e não devem falhar. */
const ISENTOS = new Set([
    'src/js/store/sync/diag/trace-core.js', // citado como caminho conceitual em prosa de arquitetura
    // Variante ILUSTRATIVA de path traversal em `docs/wiki/assets3d-distribuicao.md`,
    // ao lado de `aman//x.json`: é a string de entrada que o exemplo discute, não um
    // arquivo. Só aparece porque a coleta passou a ser ampla — e é o único
    // falso-positivo que a inversão produziu em 65 páginas.
    './aman/x.json',
]);

/**
 * Raízes contra as quais uma citação pode resolver, além do próprio diretório do
 * documento que cita.
 *
 * Isto é o par necessário da coleta ampla: agora que a regex junta QUALQUER token
 * com cara de caminho, ela também junta citação legitimamente relativa a um módulo
 * — a constituição manda o comentário da linha 1 ser relativo ao `src/` do pacote
 * (`js/draw_tools/...`), e as skills citam `store/store-errors.js` no mesmo dialeto.
 * Sem estas raízes, inverter a regex trocaria um falso-negativo por uma enxurrada
 * de falso-positivo, e um teste que grita demais é desligado, o que dá no mesmo.
 *
 * A propriedade que importa continua de pé: caminho que não existe sob NENHUMA
 * raiz real falha. É por isso que `ebgeo_backend/...` e `ebgeo_web/...`, os
 * prefixos do layout pré-monorepo, são pegos.
 */
const RAIZES_DE_RESOLUCAO = ['', 'backend', 'frontend', 'backend/src', 'frontend/src', 'frontend/src/js'];

// ---------------------------------------------------------------------------
// Símbolo citado na doc que não existe no código (classe 4)
// ---------------------------------------------------------------------------

/** Arquivos de código indexados. Custo medido: ~0,6 s para 1288 arquivos. */
const FONTES_DE_CODIGO = [
    ...['frontend/src', 'backend/src'].flatMap((d) => coletarPorExtensao(d, ['.js', '.css', '.html', '.sql'])),
    ...['frontend/tests', 'backend/tests'].flatMap((d) => coletarPorExtensao(d, ['.js'])),
    // Sem estas raízes o guarda acusa símbolo que existe: TEST_DB_NAME mora em
    // backend/scripts/ e manualChunks em frontend/vite.config.js. Guarda que aponta
    // para o lugar errado treina o leitor a ignorá-lo, que é como um guarda morre.
    ...['frontend/scripts', 'backend/scripts', 'scripts', 'deploy'].flatMap((d) =>
        coletarPorExtensao(d, ['.js', '.mjs', '.yml', '.yaml', '.sh', '.conf'])
    ),
    // `playwright.config.js` entrou em 2026-08-18 pela mesma razão dos três acima: o
    // guarda acusava `reuseExistingServer`, opção REAL e citada por um registro do
    // livro-razão, só porque o único arquivo que a declara ficava fora do índice.
    ...['frontend/vite.config.js', 'frontend/vitest.config.js', 'frontend/eslint.config.js',
        'frontend/playwright.config.js', 'backend/eslint.config.js'],
].filter((f) => existsSync(join(RAIZ, f)));

function coletarPorExtensao(dir, exts, acc = []) {
    const abs = join(RAIZ, dir);
    if (!existsSync(abs)) return acc;
    for (const nome of readdirSync(abs)) {
        if (['node_modules', 'coverage', 'dist', 'vendors'].includes(nome)) continue;
        const rel = `${dir}/${nome}`;
        if (statSync(join(RAIZ, rel)).isDirectory()) coletarPorExtensao(rel, exts, acc);
        else if (exts.some((e) => nome.endsWith(e))) acc.push(rel);
    }
    return acc;
}

/**
 * COMENTÁRIO NÃO CONTA COMO EXISTÊNCIA, e esta linha é a mais importante do bloco.
 *
 * Sem ela o guarda se auto-satisfaz: escrever "`fooBar` não existe" num comentário
 * de código põe `fooBar` no índice, e o guarda passa a afirmar que ele existe. Não é
 * hipótese. Ao documentar a correção dos dois primeiros achados desta regra no
 * comentário DESTE arquivo, os dois sumiram da lista de pendurados. Comentário é
 * 21% dos tokens do repositório (44285 para 34824 ao removê-los), então o efeito é
 * material, não de borda. É a classe `verificacao-fantasma` do livro-razão na sua
 * forma mais traiçoeira: o verificador abençoando exatamente o que devia acusar.
 */
function semComentarios(texto, arquivo) {
    let t = texto.replace(/\/\*[\s\S]*?\*\//g, ' ');
    // `//` só quando não vem colado num `:`, para poupar http:// dentro de string.
    t = t.replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    if (arquivo.endsWith('.sql')) t = t.replace(/--[^\n]*/g, ' ');
    return t;
}

/**
 * Identificador citado sozinho entre crases. TRÊS formas: camelCase com maiúscula
 * interna (`reconnectLastAtlas`), SCREAMING_SNAKE (`ATLAS_SCHEMA_VERSION`) e
 * snake_case minúsculo COM pelo menos um underscore (`fn_user_zone_geoms`,
 * `access_level`). O que fica de fora é a palavra sozinha (`atlas`, `owner`), que é
 * prosa, e o underscore é justamente o que separa uma da outra.
 *
 * A TERCEIRA FORMA ENTROU EM 2026-08-19 e é `fn_*`, o prefixo das funções SQL desta
 * casa. Ela existe porque o guarda era CEGO a snake_case, e o vocabulário de banco é
 * todo snake_case: uma página citava `fn_user_can_see_model`, função que NUNCA
 * existiu, e passava verde há meses.
 *
 * POR QUE `fn_*` E NÃO SNAKE_CASE INTEIRO, que é a forma óbvia e foi MEDIDA antes de
 * ser recusada: snake_case genérico acusa 21 símbolos, e 20 deles são legítimos,
 * porque pertencem a OUTROS sistemas (catálogos do Postgres, diretivas do nginx, DSL
 * de busca citada como alternativa recusada, nome de branch). Um achado real para
 * vinte alarmes é a razão pela qual uma regra vira ruído e alguém a desliga, e as
 * regras próprias deste repositório foram todas compradas com zero falso positivo,
 * pagando em falso negativo. `fn_` é convenção que a casa POSSUI, então nenhum
 * sistema externo colide com ela.
 *
 * O QUE ISSO DEIXA PASSAR, dito para não ser lido como cobertura: nome de tabela e de
 * coluna em crase continua invisível ao guarda. Fechar isso exige distinguir "não
 * existe aqui" de "existe em outro sistema", e não há sinal estrutural para isso.
 *
 * E o controle negativo desta regra tem de usar um nome `fn_*`: o anterior injetava
 * `fnUserZoneGeoms`, camelCase, a única grafia que a regra JÁ pegava, e por isso
 * provava que ela dispara sem provar que ela alcança o que a doc de fato cita.
 */
const RE_SIMBOLO = /`([a-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*|[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+|fn_[a-z0-9_]+)`/g;

/**
 * Símbolos que a doc cita DE PROPÓSITO sem que existam. Cada entrada carrega o
 * motivo, e a lista é útil por si: é o registro dos nomes que as pessoas acreditam
 * existir. Acrescentar uma entrada tem que ser uma decisão, não um reflexo.
 */
const SIMBOLO_INEXISTENTE_DE_PROPOSITO = new Map([
    ['reconnectLastAtlas', 'nome que quatro fontes usavam para um boot que nunca existiu; ver sessao-boot-e-ciclo-de-vida'],
    ['needsMigration', 'nome errado da função real detectMigrationNeeded; a regra cita os dois para quem procurar pelo errado achar'],
    ['migrateToV21', 'contra-exemplo deliberado: o nome real leva underscore (migrateToV2_1)'],
    ['pendingOperations', 'object store de um guia absorvido; a doc diz explicitamente que não existe'],
    ['pendingSince', 'campo do mesmo guia absorvido, idem'],
    ['isOwner', 'gate sugerido por guia absorvido e errado; a página existe para dizer que não se gateia assim'],
    ['hasMore', 'campo de paginação que a busca de usuários NÃO tem, e é esse o ponto do parágrafo'],
    ['COOKIE_SECRET', 'env var que deploy-backend.md registra como inexistente (configurá-la é no-op)'],
    ['USE_HTTPS', 'idem'],
    ['terminationGracePeriodSeconds', 'chave de manifesto do orquestrador, externa a este repositório'],
    ['SQLITE_BUSY', 'código de erro do SQLite, externo'],
    ['formatProject', 'formatador do serviço 360 LEGADO (1cgeo/ebgeo_360), externo a este repositório: é dele que /sv360/projects herda o shape público, e nomeá-lo é o ponto do parágrafo'],
    ['UPPER_SNAKE', 'marcador de convenção de nomenclatura, não um símbolo'],
    ['WIDGET_CREATED', 'evento ilustrativo do exemplo da skill store-op'],
    ['logXxxOperation', 'família de funções (logFeatureOperation, logMapOperation, ...), o Xxx é curinga'],
    ['manualChunks', 'opção depreciada do Rollup que o vite.config.js DEIXOU de usar em 2026-08-05 (trocada por codeSplitting.groups + entriesAware quando admin.html virou um segundo entry); a doc a nomeia justamente para dizer que não está mais lá'],
    ['showProjectPickerModal', 'export que sumiu em 2026-08-05, quando o seletor de projetos deixou de ser modal e virou atlas.html; a doc o nomeia para dizer o que deixou de existir na mudança'],
    ['ROLE_ORDER', 'contra-exemplo deliberado: os quatro papéis globais NÃO formam escada, e a constituição do backend nomeia essa constante inexistente justamente para dizer que comparar papel global por ordem é erro de leitura (o CHECK de `users.role`, na baseline de identidade)'],
    ['CATALOGO_SELECT', 'a consulta de listagem do SEGUNDO catálogo de modelo 3D (schema ng), removida em 2026-08-19 junto com a tabela, a rota e as duas tabelas de permissão que ninguém escrevia. A entrada de decisão que a nomeia é registro histórico: ela existe para dizer que o predicado estava duplicado verbatim entre esta e a irmã, e que foi por causa dessa dívida que o eixo de acesso a recurso nasceu com o predicado em função SQL. Apagar o nome falsificaria o registro; ver catalogo-3d'],
    ['CATALOGO_COUNT', 'a consulta de contagem irmã da acima, removida no mesmo commit e citada pelo mesmo motivo'],
    ['requireGlobalDataAccess', 'o gate de papel global de DADO que administrava grupo de acesso entre 2026-08-19 e 2026-08-20, removido quando o grupo virou entidade de usuário com dono (a autoridade passou a ser posse, por fn_can_administer_group). A entrada de decisão que o nomeia é registro histórico: ela existe para dizer qual era o desenho anterior e por que ele foi superado, e apagar o nome falsificaria o registro; ver grupo-de-acesso'],
    ['createSession', 'escritor de `active_sessions` removido em 2026-07-25, quando se mediu que a tabela nunca tivera um SELECT. A entrada de decisão que o nomeia é registro histórico: ela existe para dizer o que foi retirado e por quê, e apagar o nome falsificaria o registro. A tabela em si saiu do schema em 2026-08-23; ver presenca-colaborativa'],
    ['deleteSession', 'o par do acima, removido no mesmo commit e citado pelo mesmo motivo'],
    ['updateData', 'método da GeoJSONSource do MapLibre 5.18 (aplica um diff em vez de reenviar a coleção). Externo, e o livro-razão o nomeia justamente para registrar que este projeto NÃO o usa: as 293 chamadas de setData reenviam o array inteiro'],
]);

// ---------------------------------------------------------------------------
// Em-dash na prosa (classe 5)
// ---------------------------------------------------------------------------

/** O caractere, escrito por escape para não se acusar sozinho na leitura. */
const EM_DASH = '—';

/**
 * ALCANCE DO GUARDA DE EM-DASH, e ele é ESTREITO de propósito.
 *
 * A convenção "sem em-dash na prosa" mora na constituição desde sempre e era LETRA
 * MORTA: nenhum teste procurava o caractere, e uma varredura em 2026-08-23 achou ~63
 * ocorrências no corpus, INCLUSIVE nos arquivos que o agente carrega como instrução em
 * toda sessão. Regra de estilo sem guarda não é regra, é preferência declarada, e esta
 * tinha a agravante de ser citada como se fosse cumprida.
 *
 * O alcance são os documentos de INSTRUÇÃO: as duas constituições de método
 * (`CLAUDE.md` e `backend/CLAUDE.md`), as regras de `.claude/rules/` e tudo sob `docs/`.
 *
 * O QUE FICA DE FORA, medido no dia em que este guarda nasceu, para ninguém concluir do
 * verde mais do que ele diz: `.claude/skills/**` (25 ocorrências), `.claude/agents/**`
 * (11), `frontend/tests/TESTING.md` (8), `frontend/tests/TESTING-BACKLOG.md` (28) e
 * `PENDENCIA-TILE-PRIVADO.md` (3). Nenhum deles foi limpo, e alargar o alcance sem
 * limpar antes deixaria o guarda vermelho no dia em que nasceu, que é como um guarda
 * novo morre. `README.md` e `CONSTITUICAO.md` estão limpos hoje e mesmo assim ficaram de
 * fora, porque o recorte foi decidido pelo dono; incluí-los é uma linha, quando quiser.
 */
const ALCANCE_EM_DASH = DOCS.filter(
    (d) => d === 'CLAUDE.md'
        || d === 'backend/CLAUDE.md'
        || d.startsWith('docs/')
        || d.startsWith('.claude/rules/')
);

/**
 * O texto de um markdown sem o que NÃO é prosa.
 *
 * Três isenções, e cada uma existe porque o em-dash ali dentro é conteúdo alheio, não
 * escolha tipográfica de quem escreve: bloco de código cercado (o texto é código, e
 * mudá-lo mudaria o que o exemplo afirma), span entre crases (mesma razão, e é onde a
 * casa cita verbatim uma mensagem de erro ou um trecho de arquivo) e URL, incluindo o
 * alvo de link markdown, onde o caractere é endereço e trocá-lo quebra o link.
 *
 * O que isso deixa passar: citação verbatim escrita SEM crase, que nesta casa é rara
 * porque a convenção de citação já pede crase. Prefira crase a uma isenção nova.
 */
function semCodigoNemUrl(texto) {
    return texto
        .replace(/^```[\s\S]*?^```/gm, ' ')
        .replace(/``[^\n]*?``/g, ' ')
        .replace(/`[^`\n]*`/g, ' ')
        .replace(/\]\([^)\n]*\)/g, ' ')
        .replace(/https?:\/\/\S+/g, ' ');
}

describe('integridade da documentação', () => {
    it('lista os documentos vigiados (guarda contra a lista esvaziar em silêncio)', () => {
        expect(DOCS.length).toBeGreaterThan(10);
    });

    it('todo documento declarado em ALVOS existe no caminho declarado', () => {
        // A montagem de DOCS filtra por existsSync, e filtro NÃO é verificação:
        // renomear ou mover um alvo tira o documento da vigilância sem nada ficar
        // vermelho. O guarda continua verde vigiando um conjunto menor, que é o
        // modo de falha mais caro que este arquivo tem, porque o sintoma é a
        // AUSÊNCIA de sintoma. Foi exatamente o que aconteceu ao mover MEMORY.md e
        // livro-razao.md para `docs/` em 2026-08-14: dois alvos evaporaram da
        // lista e a suíte passou 8/8. Aqui a lista é asserida, não filtrada.
        const ausentes = ALVOS.filter((f) => !existsSync(join(RAIZ, f)));
        expect(
            ausentes,
            'alvo declarado que não existe: o documento foi movido/renomeado e saiu da'
                + ` vigilância em silêncio. Corrija o caminho em ALVOS:\n${ausentes.join('\n')}`
        ).toEqual([]);
        expect(DOCS, 'alvo declarado fora de DOCS: a montagem da lista quebrou').toEqual(
            expect.arrayContaining(ALVOS)
        );
    });

    it('todo caminho de arquivo citado em backticks existe', () => {
        const quebrados = [];
        for (const doc of DOCS) {
            const texto = readFileSync(join(RAIZ, doc), 'utf8');
            for (const m of texto.matchAll(RE_CAMINHO)) {
                const alvo = m[1];
                if (ISENTOS.has(alvo)) continue;
                const resolve = RAIZES_DE_RESOLUCAO.some((r) => existsSync(join(RAIZ, r, alvo)))
                    || existsSync(join(dirname(join(RAIZ, doc)), alvo));
                if (resolve) continue;
                quebrados.push(`${doc} → \`${alvo}\``);
            }
        }
        expect(quebrados, `caminhos citados que não existem mais:\n${quebrados.join('\n')}`).toEqual([]);
        // O PISO, e ele existe porque este caso é do tipo que passa VAZIO: se `DOCS` viesse
        // vazio, ou se `RE_CAMINHO` deixasse de casar, `quebrados` seria `[]` e o verde não
        // provaria nada.
        expect(DOCS.length).toBeGreaterThan(50);
    // TETO DE TEMPO EXPLÍCITO, como o irmão de símbolos abaixo. Este caso faz um `existsSync`
    // por raiz de resolução por citação, e passou de 5 s (o default do vitest) quando
    // `CONSTITUICAO.md` entrou na vigilância em 2026-08-21, sob máquina carregada. Guarda que
    // reprova por RELÓGIO em vez de por conteúdo ensina a ignorar o próprio vermelho.
    }, 30000);

    it('todo link markdown relativo aponta para um arquivo existente', () => {
        const quebrados = [];
        for (const doc of DOCS) {
            const texto = readFileSync(join(RAIZ, doc), 'utf8');
            const base = dirname(join(RAIZ, doc));
            for (const m of texto.matchAll(RE_LINK)) {
                const alvo = resolve(base, m[1]);
                if (!existsSync(alvo)) quebrados.push(`${doc} → ${m[1]}`);
            }
            for (const m of texto.matchAll(RE_LINK_DIR)) {
                const alvo = resolve(base, m[1]);
                if (!existsSync(alvo)) quebrados.push(`${doc} → ${m[1]} (diretório)`);
            }
        }
        expect(quebrados, `links markdown quebrados:\n${quebrados.join('\n')}`).toEqual([]);
    });

    it('todo [[wikilink]] resolve para uma página da wiki', () => {
        // O Claude Code NÃO resolve wikilink nativamente: para o agente é texto
        // literal, que ele acaba resolvendo por grep. Validar o ALVO aqui devolve
        // a propriedade que o formato não dá sozinho — renomear ou remover uma
        // página quebra o teste em vez de deixar um link morto em silêncio.
        const wiki = join(RAIZ, 'docs/wiki');
        if (!existsSync(wiki)) return;
        const paginas = new Set(
            readdirSync(wiki)
                .filter((f) => f.endsWith('.md'))
                .map((f) => f.replace(/\.md$/, ''))
        );
        const quebrados = [];
        for (const doc of DOCS) {
            const texto = readFileSync(join(RAIZ, doc), 'utf8');
            for (const m of texto.matchAll(RE_WIKILINK)) {
                const slug = m[1].split('|')[0].trim();
                if (!paginas.has(slug)) quebrados.push(`${doc} → [[${slug}]]`);
            }
        }
        expect(
            quebrados,
            `wikilinks apontando para páginas inexistentes:\n${quebrados.slice(0, 25).join('\n')}`
        ).toEqual([]);
    });

    // O TETO DE TEMPO É EXPLÍCITO, e não é folga preventiva: sem ele este caso reprovava
    // por `Test timed out in 5000ms` exatamente na rodada que mais importa. Ele lê ~1300
    // arquivos de código de forma síncrona, e o custo depende do cache de arquivo do SO:
    // com o cache quente são ~0,5 s (medido seis vezes sob a suíte inteira em paralelo:
    // 493, 535, 588, 602, 621 e 868 ms), mas na PRIMEIRA rodada depois de uma escrita em
    // `frontend/src` o cache está frio e ele estoura os 5 s do padrão. Reproduzido: seis
    // ciclos de "reescreve um arquivo de src, roda a suíte" deram vermelho na rodada 1 e
    // verde nas cinco seguintes, sem nada mudar entre elas. Ou seja, o guarda reprovava o
    // laço editar-e-verificar, que é o único laço que este repositório roda, e o vermelho
    // não dizia nada sobre a documentação. O que se mede aqui é o símbolo pendurado, nunca
    // a duração; o teto abaixo é limite para "travou", não para "demorou".
    it('todo símbolo citado entre crases existe em algum lugar do código', () => {
        // As outras regras validam o CAMINHO citado e nunca o que ele contém, então
        // uma citação a uma FUNÇÃO inexistente atravessava tudo em silêncio. Esta
        // fecha isso. O índice é de tokens, não de definições: a pergunta que ela
        // responde é "esse nome aparece em algum código?", que é fraca de propósito.
        // Fraca e suficiente: os dois achados reais na primeira execução eram nomes
        // que não apareciam em lugar NENHUM, e ambos moravam em arquivo de regra
        // carregado como instrução em toda sessão de agente.
        const tokens = new Set();
        for (const f of FONTES_DE_CODIGO) {
            // O arquivo pode SUMIR entre a listagem (feita no load do módulo) e esta leitura,
            // e some de verdade: `superficies-de-recurso-censo.test.js` escreve um
            // `tmp-nao-rastreado.js` sob `tests/fixtures/` e o apaga no `finally`, e o Vitest
            // roda os arquivos de teste em paralelo. Medido: 1 vermelho em 7 rodadas da suíte
            // inteira, um ENOENT que não tinha nada a ver com documentação. Pular o que sumiu
            // erra para o lado ESTRITO (o índice fica menor, então símbolo pendurado continua
            // sendo acusado), que é o único lado em que pular é seguro.
            let bruto;
            try {
                bruto = readFileSync(join(RAIZ, f), 'utf8');
            } catch (err) {
                if (err.code === 'ENOENT') continue;
                throw err;
            }
            const texto = semComentarios(bruto, f);
            for (const m of texto.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) tokens.add(m[0]);
        }
        for (const p of ['package.json', 'frontend/package.json', 'backend/package.json']) {
            if (!existsSync(join(RAIZ, p))) continue;
            for (const m of readFileSync(join(RAIZ, p), 'utf8').matchAll(/[A-Za-z_$][A-Za-z0-9_$-]*/g)) tokens.add(m[0]);
        }
        expect(tokens.size, 'índice de símbolos vazio: a coleta quebrou e o teste passaria vazio').toBeGreaterThan(10000);

        const pendurados = [];
        for (const doc of DOCS) {
            const texto = readFileSync(join(RAIZ, doc), 'utf8');
            for (const m of texto.matchAll(RE_SIMBOLO)) {
                const simbolo = m[1];
                if (tokens.has(simbolo) || SIMBOLO_INEXISTENTE_DE_PROPOSITO.has(simbolo)) continue;
                pendurados.push(`${doc} → \`${simbolo}\``);
            }
        }
        expect(
            pendurados,
            'símbolos citados na doc que não existem no código. Corrija o nome, ou, se a doc'
                + ' cita o nome JUSTAMENTE para dizer que ele não existe, declare-o em'
                + ` SIMBOLO_INEXISTENTE_DE_PROPOSITO com o motivo:\n${[...new Set(pendurados)].join('\n')}`
        ).toEqual([]);
    }, 30000);

    it('slug de wikilink é ASCII, sem acento', () => {
        // O slug é nome de arquivo; acento dentro de [[..]] diverge do arquivo
        // real e quebra a resolução por grep que o agente faz.
        const comAcento = [];
        for (const doc of DOCS) {
            const texto = readFileSync(join(RAIZ, doc), 'utf8');
            for (const m of texto.matchAll(RE_WIKILINK)) {
                // Faixa ASCII IMPRIMÍVEL: evita caractere de controle na própria
                // regex (que o eslint barra) e é o que um slug pode conter.
                if (/[^ -~]/.test(m[1])) comAcento.push(`${doc} → [[${m[1]}]]`);
            }
        }
        expect(comAcento, `wikilink com caractere não-ASCII:\n${comAcento.join('\n')}`).toEqual([]);
    });

    it('nenhum em-dash na prosa dos documentos de instrução', () => {
        const achados = [];
        for (const doc of ALCANCE_EM_DASH) {
            const linhas = semCodigoNemUrl(readFileSync(join(RAIZ, doc), 'utf8')).split('\n');
            linhas.forEach((linha, i) => {
                if (linha.includes(EM_DASH)) achados.push(`${doc}:${i + 1}`);
            });
        }
        expect(
            achados,
            'em-dash na prosa (a constituição pede vírgula, parênteses, dois-pontos ou frase'
                + ` separada). Se o caractere é código ou URL, ponha-o entre crases:\n${achados.join('\n')}`
        ).toEqual([]);

        // O PISO: com a lista limpa este caso é `[] === []`, exatamente a "cobertura vazia
        // passa verde" da constituição. Dois pisos o discriminam. O primeiro é o alcance:
        // se `DOCS` ou o filtro quebrarem, a varredura não lê arquivo nenhum e passa.
        expect(
            ALCANCE_EM_DASH.length,
            'o alcance do guarda de em-dash esvaziou: o filtro ou a montagem de DOCS quebrou'
        ).toBeGreaterThan(60);
        expect(ALCANCE_EM_DASH, 'as duas constituições de método saíram do alcance').toEqual(
            expect.arrayContaining(['CLAUDE.md', 'backend/CLAUDE.md'])
        );

        // O segundo é o CONTROLE POSITIVO, rodando a MESMA função de limpeza contra texto
        // que contém as duas formas: a proibida (prosa) e as três isentas. Sem ele, uma
        // limpeza que passasse a apagar o documento inteiro daria o mesmo verde.
        const PROSA_SUJA = `Uma frase de prosa ${EM_DASH} com travessão no meio.`;
        expect(
            semCodigoNemUrl(PROSA_SUJA).includes(EM_DASH),
            'a varredura parou de enxergar em-dash em prosa'
        ).toBe(true);

        const SO_ISENTOS = [
            '```',
            `const x = 1; // travessão ${EM_DASH} dentro de bloco cercado`,
            '```',
            `span de crase \`a ${EM_DASH} b\` e crase dupla \`\`c ${EM_DASH} d\`\``,
            `link [texto](http://exemplo/a${EM_DASH}b) e URL nua https://exemplo/x${EM_DASH}y`,
        ].join('\n');
        expect(
            semCodigoNemUrl(SO_ISENTOS).includes(EM_DASH),
            'falso positivo: a limpeza deixou de isentar código, span de crase ou URL'
        ).toBe(false);
    });

    it('MEMORY.md cabe no que o Claude Code realmente carrega', () => {
        // Limite duro: 200 linhas OU 25KB, o que vier primeiro; o excedente é
        // DESCARTADO EM SILÊNCIO na próxima carga. Falhar aqui é melhor que
        // perder memória sem aviso.
        //
        // O `if (!existsSync(arq)) return` que havia aqui era um segundo silêncio,
        // e mais traiçoeiro que o de ALVOS: ao mover o arquivo para `docs/` em
        // 2026-08-14 este teste passou VERDE sem abrir arquivo nenhum, ou seja,
        // reportava sucesso medindo o vazio. Agora a ausência é a primeira falha.
        const arq = join(RAIZ, 'docs/MEMORY.md');
        expect(existsSync(arq), 'docs/MEMORY.md não existe: o teto não mediu nada').toBe(true);
        const texto = readFileSync(arq, 'utf8');
        expect(texto.split('\n').length, 'MEMORY.md acima de 200 linhas: o excedente é descartado').toBeLessThanOrEqual(200);
        expect(Buffer.byteLength(texto, 'utf8'), 'MEMORY.md acima de 25KB: o excedente é descartado').toBeLessThanOrEqual(25 * 1024);
    });

    it('CLAUDE.md fica abaixo do teto de 200 linhas recomendado', () => {
        // Arquivo mais longo consome mais contexto E reduz a aderência (doc
        // oficial). O que o agente consegue derivar lendo o código não deve morar
        // aqui; o que fica é armadilha, racional e convenção que diverge do
        // default da ferramenta.
        const texto = readFileSync(join(RAIZ, 'CLAUDE.md'), 'utf8');
        const linhas = texto.split('\n').length;
        expect(linhas, `CLAUDE.md com ${linhas} linhas; alvo <= 200 (mova detalhe para .claude/rules com paths:)`).toBeLessThanOrEqual(200);
    });
});
