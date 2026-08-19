// Path: tests/unit/papel-global-censo.test.js
//
// O CENSO DO PAPEL GLOBAL, E A ÚNICA LISTA FECHADA QUE JÁ ABRIU.
//
// `users.role` teve dois valores até a fase de papéis globais (`user`, `admin`) e hoje tem
// QUATRO: `user`, `producer`, `credenciado`, `admin`. Eles NÃO são uma escada —
// nenhum contém o outro, e compará-los por ordem é proibido. O padrão "lista fechada
// de papel" já causou dois bugs reais neste repositório, nos DOIS pacotes, e sempre
// na mesma direção: alguém escreve `permission === 'write' || permission === 'owner'`
// e exclui em silêncio o nível que está ACIMA. Aqui o risco é o OPOSTO, e é pior:
// alguém escreve `if (role !== 'user')` ou `if (role === 'admin' || role ===
// 'credenciado')` num gate que era de administrador, e um papel que não administra
// nada ganha administração do sistema sem que nada fique vermelho.
//
// COMO ESTE ARQUIVO FUNCIONA, EM DOIS NÍVEIS.
//
//   A VARREDURA. O inventário vem do VERSIONAMENTO (`git ls-files -co
//   --exclude-standard` sobre `src/`), nunca de uma lista de alvos escrita à mão:
//   "conferir um subconjunto e tratar como o conjunto" é a classe mais repetida de
//   `docs/livro-razao.md`. As duas bandeiras não são detalhe: `git ls-files` puro
//   enumera só o RASTREADO, e o guarda ficava cego exatamente onde o trabalho novo
//   aparece — a comparação de papel escrita há cinco minutos, que é a que ninguém
//   classificou, só entrava na varredura depois de um `git add`. Toda linha
//   de CÓDIGO (comentário removido antes da varredura) que fale de `role` e cite
//   `'admin'`, mais toda linha com `role IN (`, precisa aparecer no censo abaixo.
//   Sítio novo não classificado reprova.
//
//   O CENSO. Uma entrada por sítio, com motivo escrito, em exatamente uma de QUATRO
//   classes:
//     - PODER: gate de ADMINISTRAÇÃO DO SISTEMA. Nem o credenciado nem o produtor
//       entram. Acrescentar qualquer um deles aqui é a regressão que este arquivo
//       existe para impedir.
//     - DADO: acesso a DADO. O credenciado entra (hoje via `fn_has_global_data_access`,
//       que resolve o papel no BANCO, não no JS).
//     - PRODUCAO: gate de MANUTENÇÃO DE ACERVO, por OM. Quem passa é o administrador
//       ou o PRODUTOR daquela OM (`users.producer_org_id`). O credenciado NÃO entra:
//       ele lê todo recurso privado e não escreve nada.
//     - ORG: o eixo `org_role`, por ORGANIZAÇÃO. O valor `'admin'` ali é homônimo e
//       sem parentesco com o papel global, e a classe existe para que ninguém
//       "conserte" um eixo mexendo no outro.
//
//   POR QUE A CLASSE `PRODUCAO` NASCEU SEPARADA, e não como mais uma entrada em
//   PODER. Os quatro papéis NÃO são uma escada, e o produtor é o que mais convida ao
//   erro: ele ESCREVE, e "escreve" é a palavra que faz alguém supor autoridade.
//   Enfiá-lo em PODER apagaria exatamente a distinção que este arquivo existe para
//   manter — administrar o sistema e manter o acervo de uma OM são poderes
//   diferentes, e quem tem o segundo não pode herdar o primeiro por classificação.
//
// POR QUE A CLASSE IMPORTA MAIS QUE A CONTAGEM. A contagem sozinha só diz que algo
// mudou. A classe diz o que a mudança significa, e é ela que transforma "apareceu
// uma comparação nova" em "apareceu uma comparação nova num gate de poder", que é
// a frase que faz alguém parar.
//
// FRAGILIDADES ACEITAS. (a) O inventário precisa de `git`; se o comando falhar, o
// caso-piso diz isso nessas palavras, porque falha de ambiente lida como regressão
// custa mais do que o guarda economiza. (b) A remoção de comentário é textual (não
// é um parser), então `//` dentro de string literal é removido junto: o efeito é
// perder um sítio, não inventar um, e nenhum sítio de hoje tem essa forma. (c) Um
// papel escrito por concatenação sai da varredura, que é a direção para onde uma
// migração vai de qualquer jeito.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Classificação de um sítio de comparação de papel. */
const PODER = 'poder-de-admin';
const DADO = 'acesso-a-dado';
/** Manutenção de ACERVO por OM: administrador ou produtor daquela OM. Credenciado não. */
const PRODUCAO = 'escopo-de-producao';
/** Eixo POR ORGANIZAÇÃO (`org_role`), que não é o papel global e não conhece credenciado. */
const ORG = 'eixo-de-organizacao';

// ============================================================================
// O CENSO
// ============================================================================
//
// `arquivo` é relativo a `backend/`. `trecho` é um pedaço CONTIDO na linha, não a
// linha inteira e não um prefixo dela: várias das comparações moram no meio de uma
// chamada (`await svc.x(req.user.id, req.user.role === 'admin')`), e casar por
// prefixo deixaria essas de fora — foi o que aconteceu na primeira escrita deste
// arquivo. Em troca, os trechos precisam ser DISJUNTOS entre si dentro do mesmo
// arquivo, senão um padrão aninhado conta a mesma linha duas vezes.
//
// `n` é o número de sítios esperados naquele arquivo com aquele trecho, e existe
// porque `sv360.service.js` tem SETE cópias da mesma linha: sem a contagem, apagar
// seis delas passaria verde. É a metade do guarda que discrimina remoção; a lista
// sozinha só discrimina acréscimo.

/**
 * @typedef {Object} EntradaDoCenso
 * @property {string} arquivo
 * @property {string} trecho
 * @property {number} n
 * @property {PODER|DADO} classe
 * @property {string} motivo
 */

/** @type {EntradaDoCenso[]} */
const CENSO = [
  // ---------------- PODER: administração do sistema. Credenciado NÃO entra. -------
  {
    arquivo: 'src/middleware/require-admin.js',
    trecho: "if (req.user.role !== 'admin')", n: 1, classe: PODER,
    motivo: 'O gate de administração do sistema. É o sítio que a fase F4 mais precisa NÃO tocar: o credenciado recebe 403 aqui, e o teste de F4 afirma isso por nome.',
  },
  {
    arquivo: 'src/middleware/permissions.js',
    trecho: "if (req.user?.role === 'admin')", n: 1, classe: PODER,
    motivo: 'Admin global é tratado como dono de QUALQUER atlas em requireAtlasPermission. Credenciado não vira dono de atlas: ele vê recurso de catálogo, não o conteúdo de projeto alheio.',
  },
  {
    arquivo: 'src/middleware/resource-access.js',
    trecho: "AND u.role = 'admin') AS administra", n: 1, classe: PODER,
    motivo: 'GRANT_REVOKER_ACTOR: o ramo CURINGA de revogar concessão de terceiro, com a subárvore junto. Era `fn_has_global_data_access` (classe DADO, que inclui o credenciado) e virou papel de ADMINISTRAÇÃO na fase F9: ver todo recurso privado e desfazer a concessão de outra pessoa são poderes diferentes. O credenciado continua revogando o que ELE concedeu, por `granted_by`, que não pergunta papel nenhum.',
  },
  {
    arquivo: 'src/modules/atlas/atlas.controller.js',
    trecho: "req.user.role === 'admin'", n: 2, classe: PODER,
    motivo: 'Lixeira global de atlas (listar e restaurar apagados de outros). É administração, não catálogo.',
  },
  {
    arquivo: 'src/modules/collab/collab.gateway.js',
    trecho: "if (payload.role === 'admin')", n: 1, classe: PODER,
    motivo: 'Autorização do socket de colaboração: admin entra em qualquer atlas. Mesmo raciocínio de permissions.js, e o gate vive nos DOIS por decisão registrada no próprio arquivo.',
  },
  {
    arquivo: 'src/modules/users/users.schemas.js',
    trecho: "role: Joi.string().valid('user', 'producer', 'credenciado', 'admin')", n: 2, classe: PODER,
    motivo: 'A borda de escrita do papel (criar e editar usuário), e o lugar onde ele NASCE: é o único sítio que cita os quatro valores. Continua classificado como PODER porque é a borda que decide quem recebe qual papel, e não um gate de acesso a dado. Os quatro NÃO são uma escada: `credenciado` lê todo recurso privado e não escreve nada, `producer` escreve só o acervo da própria OM.',
  },
  {
    arquivo: 'src/modules/users/users.service.js',
    trecho: "if (data.role && data.role !== 'admin' && existing.role === 'admin')", n: 1, classe: PODER,
    motivo: 'Detecção de REBAIXAMENTO de admin (revoga sessões). Rebaixar um credenciado não precisa do mesmo tratamento hoje, porque o papel dele não abre nada que uma sessão viva possa consumir sem passar pelo banco.',
  },
  {
    arquivo: 'src/utils/roles.js',
    trecho: "if (globalRole === 'admin') return 'admin'", n: 1, classe: PODER,
    motivo: 'toFrontendRole: o curto-circuito que devolve o papel de CLIENTE. É o sítio mais perigoso do censo inteiro, porque mapear credenciado para \'admin\' aqui lhe daria a interface de administrador sem passar por nenhum gate de servidor. A fase F4 precisa deixá-lo intocado, e o teste dela afirma isso por nome.',
  },
  {
    arquivo: 'src/database/seed.js',
    trecho: "ON CONFLICT (username) DO UPDATE SET password_hash = $1, role = 'admin'", n: 1, classe: PODER,
    motivo: 'A semente do usuário administrador. Não é gate; é o dado inicial. Fica no censo porque a varredura o alcança e um censo com buraco silencioso não é censo.',
  },

  // ------- PRODUCAO: manutenção de acervo por OM. Admin ou produtor daquela OM. -----
  //
  // OS QUATRO SÍTIOS DESTA CLASSE ERAM PODER até esta fase, e a mudança não é de
  // rótulo: enquanto a escrita do 360 e a do catálogo eram `requireAdmin`, "não passa
  // em requireAdmin" e "não escreve acervo" eram a MESMA asserção, então uma classe
  // só bastava. Com o gate virando "administrador OU produtor" as duas frases se
  // separaram, e um papel pode falhar na primeira e passar na segunda — que é
  // exatamente o que o produtor faz. Manter esses sítios em PODER diria que quem
  // mantém o acervo de uma OM administra o sistema, que é a promoção silenciosa que
  // este arquivo inteiro existe para impedir.
  //
  // O QUE MUDA NA VARREDURA: um arquivo de PRODUCAO PODE falar de `producer` (é o
  // assunto dele) e NÃO PODE falar de `credenciado` — o papel que lê tudo e não
  // escreve nada não tem o que fazer num gate de escrita. É uma cobrança a mais, não
  // a mesma com outro nome.
  {
    arquivo: 'src/modules/streetview360/sv360.routes.js',
    trecho: "(u.role === 'admin' || Boolean(u.producer_org_id))", n: 1, classe: PRODUCAO,
    motivo: 'Pré-filtro de ESCRITA do 360 (ingestão), que recusa antes do multer streamar até 2 GiB. A lista fechada de `org_role` que morava aqui saiu: ela deixava passar qualquer conta que se dissesse editora de qualquer OM, porque a lotação é auto-declarada. Repare que o segundo termo pergunta por ESCOPO (`Boolean(u.producer_org_id)`), não pelo nome do papel: o crachá é o escopo, e ele só um administrador concede.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.admin.service.js',
    trecho: "if (user.role === 'admin')", n: 2, classe: PRODUCAO,
    motivo: 'Ingestão e carga de projeto 360 para escrita (`resolveUploadOrgId`, `loadWritableProject`): o administrador escolhe a OM alvo, o produtor fica preso à dele. Credenciado não escreve nem uma nem outra, e é por isso que este arquivo é varrido contra o literal `credenciado`.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.admin.service.js',
    trecho: "const isAdmin = user.role === 'admin'", n: 1, classe: PRODUCAO,
    motivo: 'A mesma decisão na forma de booleano local, para a listagem ADMINISTRATIVA do 360. Ela recusa cedo quem não administra nem produz; quem recorta as linhas é `fn_can_produce_resource` no SQL, e não este booleano — a lição das sete cópias que a fase F6 removeu.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.write.service.js',
    trecho: "if (user.role === 'admin') return true", n: 1, classe: PRODUCAO,
    motivo: 'canWriteProject: escrita de projeto 360. O segundo braço compara `user.producer_org_id` com a OM do projeto, e o eixo `organization_id` + `org_role` que morava ali SAIU inteiro nesta fase — ele autorizava por lotação auto-declarada. Credenciado não escreve.',
  },

  // -------- ORG: eixo por organização. Não é papel global; credenciado não aparece. --
  //
  // Estes três entram no censo porque a varredura os alcança (a linha cita
  // `org_role` e `'admin'`), e ficam classificados à parte de propósito: `admin`
  // aqui é o papel DENTRO da OM, um valor de `users.org_role`, homônimo e sem
  // parentesco com o papel global. Confundir os dois eixos é a forma mais provável
  // de alguém "consertar" um deles quebrando o outro.
  // A SEGUNDA METADE DE `canWriteProject` SAIU, e a entrada dela com ela: o eixo
  // `organization_id` + `org_role` deixou de autorizar escrita de 360. Quem decide
  // agora é `producer_org_id`, que não é homônimo de nada e por isso não aparece
  // nesta classe. A classe fica de pé pela borda de escrita do org_role abaixo, que
  // continua existindo como dado de exibição.
  {
    arquivo: 'src/modules/users/users.schemas.js',
    trecho: 'org_role: Joi.string().valid(', n: 2, classe: ORG,
    motivo: 'A borda de escrita do papel DE ORGANIZAÇÃO (criar e editar usuário). Credenciado é papel global e não tem nada a fazer nesta lista; acrescentá-lo aqui seria o erro de eixo que esta classe existe para tornar visível.',
  },

  // ---------------- DADO: acesso a dado. Credenciado entra. -----------------------
  {
    // UMA entrada para as DUAS ocorrências, e não duas de uma, porque os textos são
    // ANINHADOS quando a forma escalar existe: `SELECT EXISTS (SELECT 1 FROM users
    // WHERE id =` contém o outro, e dois padrões encavalados contariam a mesma linha
    // duas vezes. Padrão de censo precisa ser disjunto.
    //
    // ERAM QUATRO ATÉ A F15, e as duas que saíram eram a forma escalar `is_admin` de
    // `CATALOGO_SELECT` e `CATALOGO_COUNT` — o segundo catálogo de modelo 3D, que foi
    // REMOVIDO em vez de unificado. Este piso decrescente é o que provou a remoção:
    // ele ficou vermelho dizendo "esperava 4, achei 2" no commit que apagou as duas
    // consultas, que é exatamente o serviço que um censo com contagem presta.
    arquivo: 'src/modules/nomes/nomes.queries.js',
    trecho: "EXISTS (SELECT 1 FROM users WHERE id =", n: 2, classe: DADO,
    motivo: 'Gazetteer (BUSCA e FEICOES): o SQL resolve o papel a partir do UUID, no banco, que é exatamente a forma que fn_has_global_data_access copia. Zona privada de nomes é DADO, então o credenciado deveria enxergá-la — e hoje NÃO enxerga, porque este eixo continua o antigo. Ver a nota de alcance no fim do arquivo.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.service.js',
    trecho: "if (user.role === 'admin') return true", n: 1, classe: DADO,
    motivo: 'isProjectReadable, e SÓ o eixo de `status`: `disabled` oculta de todo mundo fora da OM dona, inclusive do credenciado. O eixo de PRIVACIDADE saiu daqui na fase F6 e mora no SQL (sv360AccessPredicate), que é onde ele pode consultar concessão e empréstimo sem uma segunda cópia da regra.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.service.js',
    trecho: "if (user?.role === 'admin')", n: 1, classe: PODER,
    motivo: 'publicProjectView: acrescenta `db_filename` e `organization_id` ao payload, que são o vocabulário da SUPERFÍCIE ADMINISTRATIVA (ela gerencia os stores em disco por nome). Reclassificado de DADO para PODER na fase F6: não é acesso ao projeto, é a visão de administração dele, e o credenciado não a recebe.',
  },
  // AS SETE CÓPIAS DE `const isAdmin = user?.role === 'admin'` EM sv360.service.js
  // SAÍRAM NA FASE F6, e a contagem que morava aqui foi o que cobrou a conversão
  // completa: converter seis e esquecer a sétima não daria erro, daria ABERTURA (o
  // booleano TRUE curto-circuitava a disjunção inteira). Hoje as cinco consultas de
  // leitura recebem o UUID e o SQL resolve o papel sozinho.
];

// ============================================================================
// A VARREDURA
// ============================================================================

/**
 * Remove comentário de bloco e de linha, preservando a contagem de linhas.
 *
 * A NORMALIZAÇÃO DE CRLF NÃO É COSMÉTICA, e a ausência dela é o defeito que este
 * arquivo cometeu na primeira escrita. Os arquivos deste repositório terminam em
 * `\r\n`; ao cortar por `\n` cada linha ainda carrega o `\r` final. Em regex de
 * JavaScript `\r` é TERMINADOR DE LINHA, então `.` não o casa e um `/\/\/.*$/`
 * sem a flag `m` simplesmente NÃO CASA NADA: a remoção de comentário rodava e
 * devolvia o texto intacto, sem erro, e o censo passava a cobrar classificação de
 * três linhas que eram comentário. Verificador que quebra calado.
 */
function semComentarios(src) {
  const normalizado = src.replace(/\r\n?/g, '\n');
  const semBloco = normalizado.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  return semBloco
    .split('\n')
    .map((linha) => linha.replace(/\/\/.*/, ''))
    .join('\n');
}

/**
 * O INVENTÁRIO: rastreado MAIS não rastreado não ignorado.
 *
 * `git ls-files src` sozinho lista só o que já passou por `git add`, e o ponto cego
 * que isso abre fica no pior lugar possível: o arquivo que a fase corrente acabou de
 * escrever é o que ainda não foi classificado, e era o único que a varredura não via.
 * O censo respondia verde sobre um inventário que não continha o trabalho novo.
 *
 * `--others --exclude-standard` acrescenta o NÃO RASTREADO e mantém fora o IGNORADO
 * (`node_modules/`, `coverage/`, `data/`). As duas metades são MEDIDAS — a segunda
 * pelo caso-piso, a primeira pelo controle negativo que vem logo depois dele.
 * @param {string} [pathspec] - Relativo à raiz do pacote.
 * @returns {string[]} Caminhos relativos, só `.js`.
 */
function arquivosDoInventario(pathspec = 'src') {
  const saida = execFileSync(
    'git', ['ls-files', '--cached', '--others', '--exclude-standard', pathspec],
    { cwd: RAIZ, encoding: 'utf8' }
  );
  return saida.split('\n').map((s) => s.trim()).filter((s) => s.endsWith('.js'));
}

/** Todo sítio de comparação de papel global, por arquivo e linha. */
function sitios(arquivos) {
  const achados = [];
  for (const arquivo of arquivos) {
    const bruto = fs.readFileSync(path.join(RAIZ, arquivo), 'utf8');
    semComentarios(bruto).split('\n').forEach((linha, i) => {
      // `/role/i` SEM limite de palavra, e isso foi medido, não escolhido: com
      // `\brole\b` o sítio mais perigoso de todos escapava — `toFrontendRole`
      // compara `globalRole === 'admin'`, e em "globalRole" o "Role" vem colado
      // num caractere de palavra, então a borda nunca casa. O controle negativo
      // desta fase (injetar `globalRole === 'curator'` em `roles.js`) passou VERDE
      // com a versão anterior desta linha: a varredura tinha um buraco exatamente
      // na função que decide se alguém é 'admin' para o cliente. O preço de
      // afrouxar é varrer também o eixo `org_role`, que é por organização e não
      // global — daí a terceira classe.
      const falaDePapel = /role/i.test(linha) && /'admin'|"admin"/.test(linha);
      const listaSql = /\brole\s+IN\s*\(/i.test(linha);
      if (falaDePapel || listaSql) achados.push({ arquivo, n: i + 1, texto: linha.trim() });
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

describe('Censo do papel global (fase F0 de recursos privados)', () => {
  it('piso: o inventário vem do git e alcança o backend inteiro', () => {
    let arquivos;
    try {
      arquivos = arquivosDoInventario();
    } catch (err) {
      assert.fail(
        `o inventário deste censo vem de \`git ls-files\` e o comando FALHOU (${err.message}). `
        + 'Isto é falha de ambiente, não regressão de código: rode dentro do repositório.'
      );
    }
    assert.ok(arquivos.length >= 100, `esperava >= 100 arquivos versionados em src/, achei ${arquivos.length}`);
    assert.ok(arquivos.includes('src/middleware/require-admin.js'), 'a varredura precisa alcançar o gate de admin');

    // A OUTRA METADE DO INVENTÁRIO: `--others` SEM `--exclude-standard` arrastaria
    // `node_modules/` inteiro para dentro do censo. A medição é sobre o PACOTE, e não
    // sobre `src/`, porque em `src/` não há nada ignorado: medir ali seria vácuo.
    assert.ok(
      fs.existsSync(path.join(RAIZ, 'node_modules')),
      'sem `node_modules` no disco esta medição não prova nada: instale as dependências'
    );
    const doPacote = arquivosDoInventario('.');
    assert.ok(doPacote.length >= 100, `esperava >= 100 arquivos .js no pacote, achei ${doPacote.length}`);
    const lixo = doPacote.filter((a) => /(^|[/])(node_modules|coverage|dist|data)[/]/.test(a));
    assert.deepEqual(lixo, [], '`--exclude-standard` deixou entrar arquivo ignorado no inventário');
  });

  it('o inventário ENXERGA arquivo NOVO ainda não rastreado (provado, não afirmado)', () => {
    // O CEGO QUE ESTE CASO FECHA, e ele não é de classificação: é de CONJUNTO.
    // `git ls-files` sozinho enumera o índice, então o arquivo escrito há cinco minutos
    // — que é justamente o que ninguém classificou — ficava fora da varredura até
    // alguém dar `git add`, e o censo passava verde sem tê-lo olhado. Provar a correção
    // exige um arquivo que EXISTA e NÃO esteja rastreado: ele nasce aqui e morre no
    // `finally`. Fica em `tests/fixtures/` de propósito, longe de `src/`, para não
    // aparecer no inventário dos outros censos enquanto existe.
    const dir = 'tests/fixtures';
    const relativo = `${dir}/tmp-nao-rastreado-papel-global.js`;
    const abs = path.join(RAIZ, relativo);
    fs.writeFileSync(abs, [
      `// Path: ${relativo}`,
      '// Temporário: criado e apagado pelo controle negativo de `papel-global-censo.test.js`.',
      "export const podeAdministrar = (u) => u.globalRole === 'admin';",
      '',
    ].join('\n'));

    try {
      // CONTROLE: o git precisa CONCORDAR que ele não está rastreado, e precisa
      // enxergar um arquivo rastreado no mesmo pathspec. Sem este par, o caso passaria
      // verde num mundo em que alguém tivesse dado `git add` no temporário.
      const soRastreados = execFileSync('git', ['ls-files', dir], { cwd: RAIZ, encoding: 'utf8' });
      assert.ok(
        !soRastreados.includes('tmp-nao-rastreado-papel-global'),
        'a fixture temporária não pode estar rastreada, senão este caso não distingue os dois modos'
      );
      assert.ok(
        soRastreados.includes('exemplo-nao-classificado.routes.js'),
        'o pathspec precisa alcançar pelo menos uma fixture RASTREADA'
      );

      const inventario = arquivosDoInventario(dir);
      assert.ok(
        inventario.includes(relativo),
        'o inventário precisa enxergar o arquivo NÃO RASTREADO: é ele que representa o trabalho da '
        + 'fase corrente, e era exatamente o que `git ls-files` sozinho deixava de fora'
      );
      assert.ok(
        inventario.some((a) => a.includes('exemplo-nao-classificado')),
        'e o rastreado precisa continuar dentro: a correção SOMA, não troca'
      );

      // E A CADEIA INTEIRA, que é o que transforma "o inventário vê" em "o guarda
      // pega": o arquivo novo é varrido e o sítio dele é ACUSADO, pela MESMA função do
      // caso de classificação acima.
      const acusados = naoClassificados(sitios(inventario));
      assert.ok(
        acusados.some((a) => a.includes('tmp-nao-rastreado-papel-global')),
        `o sítio do arquivo não rastreado precisa ser ACUSADO; acusados: ${acusados.join(' | ')}`
      );

      // DISCRIMINAÇÃO: a MESMA função, sobre o código REAL, não acusa ninguém — sem
      // isto, "acusa" também seria o comportamento de uma função que acusa tudo.
      assert.deepEqual(naoClassificados(sitios(arquivosDoInventario())), []);
    } finally {
      fs.rmSync(abs, { force: true });
    }
  });

  it('todo sítio de comparação de papel global está no censo, com classe e motivo', () => {
    const achados = sitios(arquivosDoInventario());

    // Guarda de discriminação: censo comparado contra varredura vazia passaria
    // verde sem verificar nada. O piso caiu de 30 para 20 na fase F6, quando NOVE
    // sítios saíram de uma vez — as sete cópias de `const isAdmin = ...` de
    // `sv360.service.js` mais duas irmãs — porque o predicado de leitura do 360
    // deixou de receber um booleano do JS e passou a resolver o papel no banco.
    // Um piso que não acompanha a redução vira uma reprovação que não é regressão.
    assert.ok(achados.length >= 20, `esperava >= 20 sítios, achei ${achados.length}`);

    assert.deepEqual(
      naoClassificados(achados), [],
      'sítio de comparação de papel global fora do censo. Classifique-o em '
      + `'${PODER}' (gate de administração — nem credenciado nem produtor entram), `
      + `'${DADO}' (acesso a dado — credenciado entra), `
      + `'${PRODUCAO}' (manutenção de acervo por OM — admin ou produtor daquela OM) `
      + `ou '${ORG}' (eixo por organização, homônimo e sem parentesco), com motivo escrito.`
    );
  });

  it('a contagem por entrada bate: apagar uma cópia é tão vermelho quanto acrescentar', () => {
    const achados = sitios(arquivosDoInventario());
    assert.ok(achados.length >= 20);

    const divergentes = CENSO
      .map((e) => {
        const vistos = achados.filter((a) => a.arquivo === e.arquivo && a.texto.includes(e.trecho)).length;
        return { ...e, vistos };
      })
      .filter((e) => e.vistos !== e.n)
      .map((e) => `${e.arquivo} :: "${e.trecho}" esperava ${e.n}, achei ${e.vistos}`);

    assert.deepEqual(divergentes, [], 'a contagem do censo divergiu do código');
  });

  it('toda entrada do censo tem motivo escrito e classe válida', () => {
    // Piso ajustado na fase F6, quando duas entradas saíram (as sete cópias do
    // booleano de leitura do 360 e a irmã dela na escrita). Os pisos deste arquivo
    // são guardas de "a varredura rodou", não metas — quando o código encolhe de
    // propósito, quem não acompanha é o piso.
    assert.ok(CENSO.length >= 15, `esperava >= 15 entradas no censo, achei ${CENSO.length}`);
    const ruins = CENSO
      .filter((e) => ![PODER, DADO, PRODUCAO, ORG].includes(e.classe) || !e.motivo || e.motivo.length < 40)
      .map((e) => `${e.arquivo} :: ${e.trecho}`);
    assert.deepEqual(ruins, [], 'entrada de censo sem classe válida ou sem motivo escrito');
  });

  it('os papéis `credenciado` e `producer` NÃO entraram em nenhum gate de PODER', () => {
    // O RISCO DESTA FASE É O INVERSO DO USUAL. A lista fechada de papel costuma
    // errar por EXCLUIR o nível de cima; aqui o perigo é alguém escrever
    // `role === 'admin' || role === 'credenciado'` num gate de administração e
    // promover em silêncio um papel que, por definição, não escreve nada. Esta
    // varredura é independente do censo: ela olha o CÓDIGO dos arquivos
    // classificados como PODER e cobra que os papéis novos só apareçam na borda de
    // ESCRITA do papel, que é onde eles nascem.
    // A BORDA DE ESCRITA DO PAPEL SÃO DOIS ARQUIVOS, e o segundo entrou por um
    // limite do Joi, não por comodidade: o CHECK bicondicional de `producer_org_id`
    // depende do estado EFETIVO da conta (corpo parcial + linha existente), e o
    // schema só enxerga o corpo. `users.service.js` cita `'producer'` para decidir
    // se o escopo é obrigatório ou precisa ser limpo — regra de integridade do par
    // (papel, escopo), nunca um gate de administração.
    const deEscritaDePapel = 'src/modules/users/users.schemas.js';
    const bordaDeEscrita = [deEscritaDePapel, 'src/modules/users/users.service.js'];
    const arquivosDePoder = [...new Set(CENSO.filter((e) => e.classe === PODER).map((e) => e.arquivo))]
      .filter((a) => !bordaDeEscrita.includes(a));
    // Piso ajustado quando a classe PRODUCAO nasceu e levou TRÊS arquivos consigo
    // (`sv360.routes.js`, `sv360.admin.service.js`, `sv360.write.service.js`). Eles
    // continuam varridos, e por uma regra MAIS estreita: lá o `producer` é o assunto
    // e o `credenciado` continua proibido. Piso que não acompanha uma separação
    // deliberada vira reprovação que não é regressão.
    assert.ok(arquivosDePoder.length >= 6, `esperava >= 6 arquivos de poder, achei ${arquivosDePoder.length}`);

    // DOIS VALORES VARRIDOS, e não um. `credenciado` não pode aparecer em gate de
    // administração pelo motivo original (ele lê dado e não administra nada), e
    // `producer` pelo motivo simétrico: ele mantém o acervo da OM dele, e uma
    // disjunção `role === 'admin' || role === 'producer'` num gate de sistema
    // promoveria todo produtor a administrador em silêncio — que é exatamente a
    // regressão que este caso existe para impedir, com o papel novo no lugar do
    // antigo. Os gates que legitimamente falam de produção saíram desta lista com a
    // classe PRODUCAO e são cobrados no caso seguinte.
    const contaminados = arquivosDePoder
      .filter((a) => /'credenciado'|"credenciado"|'producer'|"producer"/
        .test(semComentarios(fs.readFileSync(path.join(RAIZ, a), 'utf8'))))
      .map((a) => `${a} cita um papel novo num arquivo classificado como gate de PODER`);
    assert.deepEqual(contaminados, [], 'credenciado e produtor não podem aparecer em gate de administração do sistema');

    // Discriminação: a borda de escrita CITA os valores, senão os papéis seriam
    // inalcançáveis por API e este caso passaria verde num sistema sem eles.
    const bordaDoPapel = semComentarios(fs.readFileSync(path.join(RAIZ, deEscritaDePapel), 'utf8'));
    assert.match(
      bordaDoPapel, /'credenciado'/,
      'a borda de escrita do papel precisa aceitar `credenciado`, senão ninguém pode nomear um'
    );
    assert.match(
      bordaDoPapel, /'producer'/,
      'a borda de escrita do papel precisa aceitar `producer`, senão ninguém pode nomear um'
    );
  });

  it('o `credenciado` NÃO entrou em nenhum gate de PRODUÇÃO — ele lê e não escreve', () => {
    // A COBRANÇA QUE A CLASSE NOVA TRAZ, e que a antiga não tinha como fazer. Num
    // arquivo de PRODUCAO o literal `producer` é o assunto (ele PRECISA aparecer), e
    // é justamente por isso que a varredura de PODER não serve aqui: ela reprovaria o
    // uso legítimo. O que continua proibido é `credenciado`, porque escrita de acervo
    // é escrita, e o papel que lê tudo não escreve nada.
    const arquivosDeProducao = [...new Set(CENSO.filter((e) => e.classe === PRODUCAO).map((e) => e.arquivo))];
    assert.ok(
      arquivosDeProducao.length >= 3,
      `esperava >= 3 arquivos de produção, achei ${arquivosDeProducao.length}`
    );

    const contaminados = arquivosDeProducao
      .filter((a) => /'credenciado'|"credenciado"/
        .test(semComentarios(fs.readFileSync(path.join(RAIZ, a), 'utf8'))))
      .map((a) => `${a} cita o credenciado num gate de ESCRITA de acervo`);
    assert.deepEqual(contaminados, [], 'o credenciado não escreve — nem catálogo, nem 360');

    // DISCRIMINAÇÃO: os mesmos arquivos falam de escopo de PRODUÇÃO. Sem esta linha,
    // "nenhum cita credenciado" também seria verdade num conjunto de arquivos que não
    // decide nada — que é como esta varredura passaria verde depois de alguém apagar
    // o eixo inteiro.
    const semEscopo = arquivosDeProducao
      .filter((a) => !/producer_org_id/
        .test(semComentarios(fs.readFileSync(path.join(RAIZ, a), 'utf8'))));
    assert.deepEqual(semEscopo, [], 'um gate de produção que não menciona `producer_org_id` não é um gate de produção');
  });

  it('os gates de PODER continuam sendo maioria e nomeiam require-admin', () => {
    const poder = CENSO.filter((e) => e.classe === PODER);
    const dado = CENSO.filter((e) => e.classe === DADO);
    const producao = CENSO.filter((e) => e.classe === PRODUCAO);
    // Piso baixado de 10 para 8 quando QUATRO entradas migraram para a classe
    // PRODUCAO. A soma das duas classes é a que não pode encolher: o eixo não
    // diminuiu, ele se separou em dois.
    assert.ok(poder.length >= 8, `esperava >= 8 entradas de poder, achei ${poder.length}`);
    assert.ok(producao.length >= 4, `esperava >= 4 entradas de produção, achei ${producao.length}`);
    assert.ok(
      poder.length + producao.length >= 12,
      `poder + produção não pode encolher: achei ${poder.length + producao.length}`
    );
    // Duas, e não quatro: a fase F6 tirou do JS o eixo de leitura do 360 e o pôs no
    // SQL. É a direção certa — quanto menos decisão de acesso a dado no JS, melhor —
    // e o piso acompanha em vez de cobrar de volta o que se acabou de remover.
    assert.ok(dado.length >= 2, `esperava >= 2 entradas de dado, achei ${dado.length}`);
    assert.ok(
      poder.some((e) => e.arquivo === 'src/middleware/require-admin.js'),
      'require-admin.js é o gate de poder por excelência e precisa estar classificado como tal'
    );
  });

  // ALCANCE DESTE GUARDA, que é estreito de propósito. Ele prende a EXISTÊNCIA e a
  // CLASSE de cada sítio, não o comportamento. Que o credenciado realmente receba 403
  // em `requireAdmin`, não vire dono em `requireAtlasPermission`, não escreva
  // catálogo e não vire 'admin' em `toFrontendRole` são testes de COMPORTAMENTO, e
  // moram em `tests/integration/papel-credenciado.test.js`; o simétrico do produtor
  // mora em `papel-produtor-catalogo.test.js` e `papel-produtor-nao-administra.test.js`.
  // Um censo verde com aqueles ausentes prova apenas que ninguém escreveu uma
  // comparação nova — o que é útil e não é a mesma coisa.
  //
  // E UMA PERDA DE ALCANCE QUE PRECISA ESTAR ESCRITA: a varredura só olha `.js` sob
  // `src/`. O predicado que hoje carrega a garantia de produção é
  // `fn_can_produce_resource`, que mora num `.sql` de migração e portanto está FORA
  // deste censo. É o preço de mover a decisão para o banco (que é a direção certa), e
  // quem cobra aquele lado é `resource-access-funcoes.test.js`, por introspecção.
  //
  // E ele não migra nada: o gazetteer (`nomes.queries.js`) continua com o eixo
  // ANTIGO, resolvendo só `role = 'admin'`, então o credenciado NÃO vê zona privada de
  // nomes hoje. Está classificado como DADO porque é o que ele é; a unificação é
  // trabalho próprio, com o repro do bug que a causar, nunca por arrumação.
});
