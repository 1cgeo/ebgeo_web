// Path: tests/unit/papel-global-censo.test.js
//
// O CENSO DO PAPEL GLOBAL, E A ÚNICA LISTA FECHADA QUE ESTÁ PRESTES A ABRIR.
//
// `users.role` teve dois valores desde 001_core.sql (`user`, `admin`) e ganha um
// terceiro na fase F4 (`curator`, D5). O padrão "lista fechada de papel" já causou
// dois bugs reais neste repositório, nos DOIS pacotes, e sempre na mesma direção:
// alguém escreve `permission === 'write' || permission === 'owner'` e exclui em
// silêncio o nível que está ACIMA. Aqui o risco é o OPOSTO, e é pior: alguém
// escreve `if (role !== 'user')` ou `if (role === 'admin' || role === 'curator')`
// num gate que era de administrador, e o Curador ganha poder de administração do
// sistema sem que nada fique vermelho.
//
// COMO ESTE ARQUIVO FUNCIONA, EM DOIS NÍVEIS.
//
//   A VARREDURA. O inventário vem do VERSIONAMENTO (`git ls-files` sobre `src/`),
//   nunca de uma lista de alvos escrita à mão: "conferir um subconjunto e tratar
//   como o conjunto" é a classe mais repetida de `docs/livro-razao.md`. Toda linha
//   de CÓDIGO (comentário removido antes da varredura) que fale de `role` e cite
//   `'admin'`, mais toda linha com `role IN (`, precisa aparecer no censo abaixo.
//   Sítio novo não classificado reprova.
//
//   O CENSO. Uma entrada por sítio, com motivo escrito, em exatamente uma de TRÊS
//   classes:
//     - PODER: gate de ADMINISTRAÇÃO DO SISTEMA. O curador NÃO entra. Acrescentar
//       o curador aqui é a regressão que este arquivo existe para impedir.
//     - DADO: acesso a DADO. O curador entra (hoje via `fn_has_global_data_access`,
//       que resolve o papel no BANCO, não no JS).
//     - ORG: o eixo `org_role`, por ORGANIZAÇÃO. O valor `'admin'` ali é homônimo e
//       sem parentesco com o papel global, e a classe existe para que ninguém
//       "conserte" um eixo mexendo no outro.
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
/** Eixo POR ORGANIZAÇÃO (`org_role`), que não é o papel global e não conhece curador. */
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
  // ---------------- PODER: administração do sistema. Curador NÃO entra. -------
  {
    arquivo: 'src/middleware/require-admin.js',
    trecho: "if (req.user.role !== 'admin')", n: 1, classe: PODER,
    motivo: 'O gate de administração do sistema. É o sítio que a fase F4 mais precisa NÃO tocar: o curador recebe 403 aqui, e o teste de F4 afirma isso por nome.',
  },
  {
    arquivo: 'src/middleware/permissions.js',
    trecho: "if (req.user?.role === 'admin')", n: 1, classe: PODER,
    motivo: 'Admin global é tratado como dono de QUALQUER atlas em requireAtlasPermission. Curador não vira dono de atlas: ele vê recurso de catálogo, não o conteúdo de projeto alheio.',
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
    trecho: "role: Joi.string().valid('user', 'admin', 'curator')", n: 2, classe: PODER,
    motivo: 'A borda de escrita do papel (criar e editar usuário), e o ÚNICO sítio que a fase F4 mudou: acrescentar o valor aqui é o que dá ao painel do admin o poder de nomear um curador. Continua classificado como PODER porque é a borda que decide quem recebe qual papel, e não um gate de acesso a dado.',
  },
  {
    arquivo: 'src/modules/users/users.service.js',
    trecho: "if (data.role && data.role !== 'admin' && existing.role === 'admin')", n: 1, classe: PODER,
    motivo: 'Detecção de REBAIXAMENTO de admin (revoga sessões). Rebaixar um curador não precisa do mesmo tratamento hoje, porque o papel dele não abre nada que uma sessão viva possa consumir sem passar pelo banco.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.routes.js',
    trecho: "(u.role === 'admin' || ['owner', 'admin', 'editor'].includes(u.org_role))", n: 1, classe: PODER,
    motivo: 'Gate de ESCRITA do 360 (ingestão/calibração). Curador não escreve. Esta é a linha com a forma exata que a armadilha descreve — uma disjunção de papel ao lado de uma lista fechada de org_role — e por isso está nomeada aqui em vez de descoberta depois.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.admin.service.js',
    trecho: "if (user.role === 'admin')", n: 2, classe: PODER,
    motivo: 'Escrita administrativa do 360 (escolher a OM alvo). Curador não escreve.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.admin.service.js',
    trecho: "const isAdmin = user.role === 'admin'", n: 1, classe: PODER,
    motivo: 'Idem, na forma de booleano local para a listagem administrativa.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.write.service.js',
    trecho: "if (user.role === 'admin') return true", n: 1, classe: PODER,
    motivo: 'canWriteProject: escrita de projeto 360. Curador não escreve.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.write.service.js',
    trecho: "const isAdmin = user?.role === 'admin'", n: 1, classe: PODER,
    motivo: 'canWriteProject na forma de booleano local, para a listagem administrativa de escrita. Mesmo eixo da linha acima, e conta separado porque o texto difere.',
  },
  {
    arquivo: 'src/utils/roles.js',
    trecho: "if (globalRole === 'admin') return 'admin'", n: 1, classe: PODER,
    motivo: 'toFrontendRole: o curto-circuito que devolve o papel de CLIENTE. É o sítio mais perigoso do censo inteiro, porque mapear curador para \'admin\' aqui lhe daria a interface de administrador sem passar por nenhum gate de servidor. A fase F4 precisa deixá-lo intocado, e o teste dela afirma isso por nome.',
  },
  {
    arquivo: 'src/database/seed.js',
    trecho: "ON CONFLICT (username) DO UPDATE SET password_hash = $1, role = 'admin'", n: 1, classe: PODER,
    motivo: 'A semente do usuário administrador. Não é gate; é o dado inicial. Fica no censo porque a varredura o alcança e um censo com buraco silencioso não é censo.',
  },

  // -------- ORG: eixo por organização. Não é papel global; curador não aparece. --
  //
  // Estes três entram no censo porque a varredura os alcança (a linha cita
  // `org_role` e `'admin'`), e ficam classificados à parte de propósito: `admin`
  // aqui é o papel DENTRO da OM, um valor de `users.org_role`, homônimo e sem
  // parentesco com o papel global. Confundir os dois eixos é a forma mais provável
  // de alguém "consertar" um deles quebrando o outro.
  {
    arquivo: 'src/modules/streetview360/sv360.write.service.js',
    trecho: "return ['owner', 'admin', 'editor'].includes(user.org_role)", n: 1, classe: ORG,
    motivo: 'canWriteProject, segunda metade: depois de recusar pelo papel global, decide pelo papel na OM dona. Lista fechada de org_role, que é o vocabulário certo neste eixo.',
  },
  {
    arquivo: 'src/modules/users/users.schemas.js',
    trecho: 'org_role: Joi.string().valid(', n: 2, classe: ORG,
    motivo: 'A borda de escrita do papel DE ORGANIZAÇÃO (criar e editar usuário). Curador é papel global e não tem nada a fazer nesta lista; acrescentá-lo aqui seria o erro de eixo que esta classe existe para tornar visível.',
  },

  // ---------------- DADO: acesso a dado. Curador entra. -----------------------
  {
    // UMA entrada para as QUATRO ocorrências, e não duas de dois, porque os dois
    // textos são ANINHADOS: `SELECT EXISTS (SELECT 1 FROM users WHERE id =` contém
    // o outro, então dois padrões encavalados contariam a mesma linha duas vezes e
    // a soma nunca fecharia. Padrão de censo precisa ser disjunto.
    arquivo: 'src/modules/nomes/nomes.queries.js',
    trecho: "EXISTS (SELECT 1 FROM users WHERE id =", n: 4, classe: DADO,
    motivo: 'Gazetteer, nas duas formas (o EXISTS embutido no WHERE e o escalar is_admin): o SQL resolve o papel a partir do UUID, no banco, que é exatamente a forma que fn_has_global_data_access copia. Zona privada de nomes é DADO, então o curador deveria enxergá-la — e hoje NÃO enxerga, porque este eixo continua o antigo. Ver a nota de alcance no fim do arquivo.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.service.js',
    trecho: "if (user.role === 'admin') return true", n: 1, classe: DADO,
    motivo: 'isProjectReadable: LEITURA de projeto 360. A fase F6 troca este eixo por fn_has_global_data_access, e é aqui que o curador passa a enxergar o 360 privado.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.service.js',
    trecho: "const isAdmin = user?.role === 'admin'", n: 7, classe: DADO,
    motivo: 'As SETE cópias que viram $1::boolean nas queries de leitura do 360. A contagem está escrita porque é ela que impede que F6 converta seis e esqueça a sétima — o booleano TRUE curto-circuita a disjunção inteira, então a cópia esquecida não erra: ela abre.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.service.js',
    trecho: "if (user?.role === 'admin')", n: 1, classe: DADO,
    motivo: 'Leitura administrativa de foto por nome. Mesmo eixo das sete acima, forma diferente.',
  },
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

function arquivosVersionados() {
  const saida = execFileSync('git', ['ls-files', 'src'], { cwd: RAIZ, encoding: 'utf8' });
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

describe('Censo do papel global (fase F0 de recursos privados)', () => {
  it('piso: o inventário vem do git e alcança o backend inteiro', () => {
    let arquivos;
    try {
      arquivos = arquivosVersionados();
    } catch (err) {
      assert.fail(
        `o inventário deste censo vem de \`git ls-files\` e o comando FALHOU (${err.message}). `
        + 'Isto é falha de ambiente, não regressão de código: rode dentro do repositório.'
      );
    }
    assert.ok(arquivos.length >= 100, `esperava >= 100 arquivos versionados em src/, achei ${arquivos.length}`);
    assert.ok(arquivos.includes('src/middleware/require-admin.js'), 'a varredura precisa alcançar o gate de admin');
  });

  it('todo sítio de comparação de papel global está no censo, com classe e motivo', () => {
    const achados = sitios(arquivosVersionados());

    // Guarda de discriminação: censo comparado contra varredura vazia passaria
    // verde sem verificar nada.
    assert.ok(achados.length >= 30, `esperava >= 20 sítios, achei ${achados.length}`);

    const naoClassificados = achados
      .filter((a) => !CENSO.some((e) => e.arquivo === a.arquivo && a.texto.includes(e.trecho)))
      .map((a) => `${a.arquivo}:${a.n} ${a.texto}`);

    assert.deepEqual(
      naoClassificados, [],
      'sítio de comparação de papel global fora do censo. Classifique-o em '
      + `'${PODER}' (gate de administração — curador NÃO entra), '${DADO}' (acesso a dado — curador entra) `
      + `ou '${ORG}' (eixo por organização, homônimo e sem parentesco), com motivo escrito.`
    );
  });

  it('a contagem por entrada bate: apagar uma cópia é tão vermelho quanto acrescentar', () => {
    const achados = sitios(arquivosVersionados());
    assert.ok(achados.length >= 30);

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
    assert.ok(CENSO.length >= 18, `esperava >= 15 entradas no censo, achei ${CENSO.length}`);
    const ruins = CENSO
      .filter((e) => ![PODER, DADO, ORG].includes(e.classe) || !e.motivo || e.motivo.length < 40)
      .map((e) => `${e.arquivo} :: ${e.trecho}`);
    assert.deepEqual(ruins, [], 'entrada de censo sem classe válida ou sem motivo escrito');
  });

  it('o valor `curator` NÃO entrou em nenhum gate de PODER', () => {
    // O RISCO DESTA FASE É O INVERSO DO USUAL. A lista fechada de papel costuma
    // errar por EXCLUIR o nível de cima; aqui o perigo é alguém escrever
    // `role === 'admin' || role === 'curator'` num gate de administração e promover
    // o curador em silêncio. Esta varredura é independente do censo: ela olha o
    // CÓDIGO dos arquivos classificados como PODER e cobra que `curator` só apareça
    // na borda de ESCRITA do papel, que é onde ele nasce.
    const deEscritaDePapel = 'src/modules/users/users.schemas.js';
    const arquivosDePoder = [...new Set(CENSO.filter((e) => e.classe === PODER).map((e) => e.arquivo))]
      .filter((a) => a !== deEscritaDePapel);
    assert.ok(arquivosDePoder.length >= 8, `esperava >= 8 arquivos de poder, achei ${arquivosDePoder.length}`);

    const contaminados = arquivosDePoder
      .filter((a) => /'curator'|"curator"/.test(semComentarios(fs.readFileSync(path.join(RAIZ, a), 'utf8'))))
      .map((a) => `${a} cita 'curator' num arquivo classificado como gate de PODER`);
    assert.deepEqual(contaminados, [], 'o curador não pode aparecer em gate de administração do sistema');

    // Discriminação: a borda de escrita CITA o valor, senão o papel seria
    // inalcançável por API e este caso passaria verde num sistema sem curador.
    assert.match(
      semComentarios(fs.readFileSync(path.join(RAIZ, deEscritaDePapel), 'utf8')),
      /'curator'/,
      'a borda de escrita do papel precisa aceitar `curator`, senão ninguém pode nomear um'
    );
  });

  it('os gates de PODER continuam sendo maioria e nomeiam require-admin', () => {
    const poder = CENSO.filter((e) => e.classe === PODER);
    const dado = CENSO.filter((e) => e.classe === DADO);
    assert.ok(poder.length >= 10, `esperava >= 10 entradas de poder, achei ${poder.length}`);
    assert.ok(dado.length >= 4, `esperava >= 4 entradas de dado, achei ${dado.length}`);
    assert.ok(
      poder.some((e) => e.arquivo === 'src/middleware/require-admin.js'),
      'require-admin.js é o gate de poder por excelência e precisa estar classificado como tal'
    );
  });

  // ALCANCE DESTE GUARDA, que é estreito de propósito. Ele prende a EXISTÊNCIA e a
  // CLASSE de cada sítio, não o comportamento. Que o curador realmente receba 403 em
  // `requireAdmin`, não vire dono em `requireAtlasPermission` e não vire 'admin' em
  // `toFrontendRole` são três testes de COMPORTAMENTO, e são o coração da fase F4.
  // Um censo verde com aqueles três ausentes prova apenas que ninguém escreveu uma
  // comparação nova — o que é útil e não é a mesma coisa.
  //
  // E ele não migra nada: o gazetteer (`nomes.queries.js`) continua com o eixo
  // ANTIGO, resolvendo só `role = 'admin'`, então o curador NÃO vê zona privada de
  // nomes hoje. Está classificado como DADO porque é o que ele é; a unificação é
  // trabalho próprio, com o repro do bug que a causar, nunca por arrumação.
});
