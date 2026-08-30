// Path: tests/unit/superficies-de-recurso-censo.test.js
//
// O CENSO DAS SUPERFÍCIES DE RECURSO: por onde um recurso SAI, e o que o recorta.
//
// POR QUE ELE EXISTE. O pior defeito que este branch encontrou em si mesmo não foi um
// predicado errado — foi um predicado AUSENTE numa superfície que ninguém estava
// medindo. Duas vezes seguidas, e a segunda depois de a primeira ter sido "resolvida":
//
//   1. O tile MVT passou verde por uma fase inteira porque a suíte media privacidade na
//      LISTAGEM e nunca no tile. A camada de linha (a trajetória) chegou a desenhar o
//      caminho de um projeto privado enquanto os pontos já sumiam.
//   2. As CINCO rotas de foto (`/photos/:uuid`, `/photos/by-name/:nome`,
//      `/photos/:uuid/image`, `/photos/nearest`, `/photos/:uuid/nearby`) entregavam
//      metadado e BYTES de projeto `enabled + private` a qualquer um — e `/photos/nearest`
//      os entregava POR COORDENADA, sem identificador nenhum. As quatro consultas por
//      trás delas não tinham `sv360AccessPredicate` NENHUM, e o comentário de
//      `isProjectReadable` afirmava, em voz alta, que "nenhuma linha chega a esta função
//      sem ter passado por ele [o SQL]". A afirmação era falsa e nada ficava vermelho:
//      uma foto entregue é uma resposta bem-formada.
//
// A lição é sempre a mesma e é a mais repetida de `docs/livro-razao.md`: conferir um
// subconjunto e tratá-lo como o conjunto. Este arquivo troca a conferência à mão pelo
// INVENTÁRIO, e o inventário vem do VERSIONAMENTO (`git ls-files -co
// --exclude-standard`), nunca de uma lista de alvos escrita aqui — uma lista escrita à
// mão envelhece na primeira superfície nova, que é exatamente o caso que ela precisaria
// pegar. As duas bandeiras não são detalhe: `git ls-files` puro enumera só o RASTREADO,
// e o guarda ficava cego exatamente onde o trabalho novo aparece — a consulta escrita há
// cinco minutos, que é a que ninguém classificou, só entrava na varredura depois de um
// `git add`.
//
// QUATRO VARREDURAS INDEPENDENTES, e a independência é o ponto:
//
//   1. CONSULTA — toda linha de código (comentário removido antes) que TOCA uma tabela
//      de recurso (`sv360.projects`/`sv360.photos`, as quatro tabelas
//      de catálogo, inclusive por interpolação `FROM ${...}`) ou que chama um dos
//      resolvedores de leitura do 360. Cada achado é atribuído à UNIDADE que o contém
//      (a função ou a constante SQL declarada acima dele), e cada unidade precisa de
//      entrada com classe. Pega CONSULTA nova.
//   2. ROTA DE LEITURA — todo `router.get(` de todo `*.routes.js`. Pega ROTA nova que
//      REUSA uma consulta antiga, que é o caso que a varredura 1 sozinha perde.
//   3. CABEÇALHO DE CACHE — toda linha com `Cache-Control` ou uma chamada de
//      `setImmutableHeaders`. Pega o vazamento pela porta dos fundos: uma resposta que
//      passou a depender de concessão ou de empréstimo e continua marcada `public`, que
//      um cache compartilhado repõe para quem não a alcança. Foi um defeito REAL: a
//      imagem de um projeto `enabled + private` saía `public, max-age=1ano, immutable`.
//   4. REGIME DE CACHE POR SUPERFÍCIE ESCOPADA — toda rota classificada
//      `recurso-com-filtro` na varredura 2 precisa DECLARAR seu regime, e a declaração
//      é conferida contra o CORPO do handler que a rota monta.
//
// POR QUE A VARREDURA 4 EXISTE, e ela é a correção de um cego da própria varredura 3.
// A varredura 3 é de PRESENÇA: ela acha `Cache-Control` e `setImmutableHeaders(` e
// exige que cada achado esteja classificado. Um cabeçalho AUSENTE não casa com nada, e
// portanto é INVISÍVEL para ela — um censo que só vê o que existe não pode cobrar o que
// falta. Isso não é hipótese: era exatamente o estado pré-F9 das rotas JSON do 360
// (nenhum `Cache-Control`, cache heurístico autorizado num corpo que varia por
// concessão e por empréstimo), e continuou sendo o estado das listagens de catálogo e
// do payload aditivo de `/resource-access/visible` DEPOIS de a F9 ter fechado o 360 —
// verde nas duas rodadas, porque a ausência não tinha como ficar vermelha.
//
// A varredura 4 inverte o ônus: quem manda no conjunto é a lista de superfícies
// ESCOPADAS (as `recurso-com-filtro` da varredura 2), e cada uma precisa dizer o que
// faz de cache. Quem não diz REPROVA. Um buraco continua podendo existir, mas agora só
// como `sem-cabecalho-declarado`, com o RISCO por escrito e dentro de um TETO — e se o
// código fechar o buraco sem o censo acompanhar, isso também fica vermelho.
//
// O ALCANCE DELA, que é estreito de propósito e precisa estar escrito: ela prende a
// LIGAÇÃO rota -> handler -> marcador -> `Cache-Control`, por texto, e não o cabeçalho
// que sai no fio. Que a imagem de projeto privado saia `private` é comportamento e mora
// em `tests/integration/sv360-cache-scope.test.js` e `sv360-tiles-cache-scope.test.js`.
//
// AS CLASSES DA VARREDURA 1, e por que a classe importa mais que a contagem. A contagem
// diz que algo mudou; a classe diz o que a mudança SIGNIFICA, e é ela que transforma
// "apareceu uma consulta nova" em "apareceu uma consulta nova sem predicado nenhum numa
// tabela de recurso", que é a frase que faz alguém parar.
//
//   - SQL       — o recorte das linhas vive NO SQL desta unidade. A entrada nomeia o
//                 fragmento (`predicado`), e o teste confere que ele está mesmo no bloco.
//   - DERIVADO  — a unidade não recorta nada; o chamador já resolveu o alvo por uma
//                 unidade SQL. A entrada NOMEIA essa unidade, e um caso confere que ela
//                 existe no censo E é da classe SQL. É o que impede "derivado" de virar
//                 um carimbo: uma cadeia que aponta para o vazio reprova.
//   - JS        — a decisão é feita em JavaScript, nesta unidade. Só o eixo de `status`
//                 do 360 mora aqui, e de propósito (ver o JSDoc de `isProjectReadable`).
//   - ESCRITA   — caminho de escrita, não de leitura. A entrada nomeia o gate, e o teste
//                 confere que ele existe no MESMO módulo.
//   - PUBLICO   — sem filtro, POR DESENHO. O motivo precisa conter a palavra RISCO: uma
//                 isenção sem o risco escrito é a mesma coisa que uma lacuna, com uma
//                 linha a mais.
//   - NAO-RECURSO — o padrão casou e o alvo não é recurso de catálogo/360/3D. A classe
//                 existe porque a varredura é DELIBERADAMENTE larga (`FROM ${...}` casa
//                 qualquer tabela interpolada): estreitar o padrão para evitar o falso
//                 positivo esconderia junto o verdadeiro.
//
// FRAGILIDADES ACEITAS. (a) O inventário precisa de `git`; se o comando falhar, o
// caso-piso diz isso nessas palavras, porque falha de ambiente lida como regressão custa
// mais do que o guarda economiza. (b) A remoção de comentário é textual, não é um
// parser: `//` dentro de string literal cai junto, e a direção do erro é PERDER um sítio,
// nunca inventar um. (c) A varredura só olha `.js` sob `src/` — os predicados em si
// (`fn_has_global_data_access`, `fn_can_produce_resource`, `fn_granted_resource_ids`)
// moram em `.sql` de migração e são cobrados por `resource-access-funcoes.test.js`, por
// introspecção. (d) A unidade é atribuída pela declaração ANTERIOR mais próxima, então
// renomear uma função quebra a entrada — o que é o comportamento desejado, e não um
// custo: quem renomeia relê a classe.
//
// O QUE ESTE ARQUIVO NÃO PRENDE, e precisa estar escrito: COMPORTAMENTO. Que a foto
// privada 404 para o forasteiro é `tests/integration/sv360-foto-privada.test.js`; que o
// basemap privado some do `/api/config` é `basemap-quinto-tipo.test.js`; que o MVT não
// desenha o privado é `sv360-privado.test.js`; que o empréstimo alcança o HTTP é
// `sv360-emprestimo-http.test.js`. Um censo verde com aqueles ausentes prova só que
// ninguém abriu porta nova sem declarar — o que é útil, e não é a mesma coisa.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

// --- classes da varredura 1 (consulta) --------------------------------------
const SQL = 'sql-recorta-a-linha';
const DERIVADO = 'derivado-de-unidade-sql';
const JS = 'decidido-no-js';
const ESCRITA = 'caminho-de-escrita';
const PUBLICO = 'publico-por-desenho';
const NAO_RECURSO = 'nao-e-recurso';

// --- classes da varredura 2 (rota de leitura) -------------------------------
const R_FILTRADA = 'recurso-com-filtro';
const R_PUBLICA = 'recurso-publico-por-desenho';
const R_OUTRA = 'nao-serve-recurso';

// --- classes da varredura 3 (cache) -----------------------------------------
const C_CONDICIONAL = 'escopo-decidido-por-resposta';
const C_PRIVADO = 'privado-sempre';
const C_PUBLICO_FIXO = 'publico-fixo';
const C_SEM = 'sem-cache';
// A classe que só a varredura 4 usa: a superfície escopada que não emite cabeçalho
// nenhum. Ela existe para que a AUSÊNCIA tenha nome, teto e RISCO escrito, em vez de
// ser o silêncio que a varredura de presença produzia.
const C_AUSENTE = 'sem-cabecalho-declarado';

// --- fragmentos de predicado que se repetem ---------------------------------
const P_360 = 'sv360AccessPredicate(';
const P_CATALOGO = 'accessPredicate(';
// A COMPOSIÇÃO dos três braços de autorização de catálogo (papel global, produção, concessão),
// que desde a fase F11 tem UMA definição — `catalog/catalog.queries.js` — em vez de estar
// escrita à mão em cada consulta. Ela é fragmento de builder como `P_360`, e não nome de função
// SQL como `P_CONCESSAO`: quem carrega a regra agora é a chamada.
const P_CATALOGO_AUTZ = 'catalogAuthorizationPredicate(';
const P_PRODUCAO = 'fn_can_produce_resource';

// --- unidades SQL citadas por várias entradas DERIVADO ----------------------
const U_SLUG = 'src/modules/streetview360/sv360.queries.js::GET_PROJECT_BY_SLUG';
const U_FOTO = 'src/modules/streetview360/sv360.queries.js::GET_PHOTO_BY_ID';

// --- motivos que se repetem, escritos uma vez -------------------------------
const DERIVA_DO_SLUG = 'Consulta de detalhe de UM projeto já resolvido: o chamador passou por '
  + 'GET_PROJECT_BY_SLUG, que carrega o predicado inteiro, e um projeto fora do alcance morre em '
  + '404 antes desta linha rodar. Repetir o predicado aqui seria uma segunda definição da regra.';
const DERIVA_DA_FOTO = 'Consulta ancorada numa foto já resolvida por GET_PHOTO_BY_ID, que desde a '
  + 'fase F9 carrega o predicado inteiro. Antes dela esta cadeia inteira estava descoberta, e era '
  + 'o buraco mais fundo do módulo.';
const INGESTAO_360 = 'Escrita do pipeline de ingestão/exclusão de projeto 360. Quem autoriza é '
  + 'loadWritableProject (administrador ou o PRODUTOR daquela OM), no serviço do mesmo módulo; '
  + 'empréstimo e concessão autorizam LER e nunca escrever.';
const CONFIG_PUBLICO = 'Monta o `GET /api/config`, que é o documento de BOOT e precisa ser o mesmo '
  + 'para todo chamador (o memo de documento único depende disso). Chama `listCatalog` SEM '
  + '`visibleTo`, e o `accessPredicate` fecha por padrão: sem principal, só o público. O RISCO é '
  + 'o inverso do usual — não vaza, ESCONDE: o recurso concedido não aparece aqui e chega ao '
  + 'cliente pelo payload aditivo de `GET /resource-access/visible`.';

/**
 * @typedef {Object} EntradaDeConsulta
 * @property {string} arquivo - Relativo a `backend/`.
 * @property {string} unidade - Função ou constante SQL que contém o contato.
 * @property {number} n - Quantas linhas de contato aquela unidade tem.
 * @property {SQL|DERIVADO|JS|ESCRITA|PUBLICO|NAO_RECURSO} classe
 * @property {string} [predicado] - Fragmento (SQL/JS), unidade de origem (DERIVADO) ou gate (ESCRITA).
 * @property {string} motivo
 */

/** @type {EntradaDeConsulta[]} */
const CENSO_CONSULTA = [
  // ================= catálogo: as quatro tabelas por uma fábrica só ==========
  {
    arquivo: 'src/modules/catalog/catalog.service.js', unidade: 'listCatalog', n: 2, classe: SQL,
    predicado: P_CATALOGO,
    motivo: 'A listagem crua de qualquer das quatro tabelas. O predicado é semi-join (uma consulta, '
      + 'não uma por linha) e FECHA POR PADRÃO: sem principal devolve só o público, então esquecer '
      + 'de passar `visibleTo` degrada para MENOS dado e nunca para vazamento.',
  },
  {
    arquivo: 'src/modules/catalog/catalog.service.js', unidade: 'getCatalogItem', n: 2, classe: SQL,
    predicado: P_CATALOGO,
    motivo: 'O MESMO gate da listagem, e não por simetria estética: a rota por id é `auth` e mais '
      + 'nada, então um recurso privado vazava por aqui pelo id depois de sumir da lista. 404 e '
      + 'não 403, senão o próprio 403 confirma a existência.',
  },
  {
    arquivo: 'src/modules/catalog/catalog.controller.js', unidade: 'list', n: 1, classe: DERIVADO,
    predicado: 'src/modules/catalog/catalog.service.js::listCatalog',
    motivo: 'O controller só monta o `visibleTo` (principal + atlas em foco + tipo de recurso) e '
      + 'entrega ao serviço; quem recorta é a consulta. O `?? null` do tipo existe para que um mapa '
      + 'que perca uma entrada degrade para menos dado.',
  },
  {
    arquivo: 'src/modules/catalog/catalog.controller.js', unidade: 'get', n: 1, classe: DERIVADO,
    predicado: 'src/modules/catalog/catalog.service.js::getCatalogItem',
    motivo: 'Idem `list`, para o item por id. Os dois compartilham `visibleTo`, que é o único lugar '
      + 'onde a tabela vira tipo de recurso.',
  },
  {
    arquivo: 'src/modules/catalog/catalog.service.js', unidade: 'createCatalogItem', n: 2,
    classe: ESCRITA, predicado: P_PRODUCAO,
    motivo: 'A sonda de id duplicado do CREATE, que também gateia a RESSURREIÇÃO de um id '
      + 'soft-deletado: o id de catálogo é um slug GLOBAL, então sem este gate o produtor de uma OM '
      + 'sairia dono da linha que outra apagou, por sobrescrita.',
  },
  {
    arquivo: 'src/modules/catalog/catalog.service.js', unidade: 'updateCatalogItem', n: 2,
    classe: ESCRITA, predicado: P_PRODUCAO,
    motivo: 'O gate FINO do UPDATE, e ele mora no `WHERE` da própria escrita e não numa leitura '
      + 'anterior: ler o dono e depois escrever deixa uma janela entre as duas consultas. Zero '
      + 'linha vira 404, nunca 403, para que a rota não vire oráculo de inventário. A SEGUNDA '
      + 'linha de contato é a subconsulta `FROM ${t} … FOR UPDATE` que colhe os valores '
      + 'ANTERIORES para o de-para da trilha: ela não é uma segunda superfície de leitura, é a '
      + 'MESMA linha que o UPDATE vai sobrescrever, travada no mesmo statement — e por isso ela '
      + 'não carrega predicado próprio, o gate do UPDATE responde pelas duas.',
  },
  {
    arquivo: 'src/modules/catalog/catalog.service.js', unidade: 'deleteCatalogItem', n: 1,
    classe: ESCRITA, predicado: P_PRODUCAO,
    motivo: 'O mesmo gate no `WHERE` do soft-delete. Ele devolve a linha (id e nome) porque o '
      + '`target_name` da trilha é a única coisa que ainda diz o que era aquele id depois que ele '
      + 'sumiu das listagens.',
  },
  {
    arquivo: 'src/modules/catalog/catalog.service.js', unidade: 'setCatalogPreviewVideo', n: 2,
    classe: ESCRITA, predicado: P_PRODUCAO,
    motivo: 'Grava (ou apaga) `config.previewVideo` com a URL do vídeo hospedado, e o gate é o '
      + 'MESMO `fn_can_produce_resource` no `WHERE` das outras escritas do módulo. As DUAS linhas '
      + 'de contato são o `UPDATE ${t}` e a subconsulta `FROM ${t} … FOR UPDATE` que colhe o '
      + '`config` anterior para o de-para; ela não é leitura própria, é a linha que o UPDATE trava.',
  },
  {
    arquivo: 'src/modules/catalog/catalog.service.js', unidade: 'transferCatalogItemOwner', n: 1,
    classe: ESCRITA, predicado: 'requireAdmin',
    motivo: 'Transfere a OM dona (só-admin): o gate NÃO é de produção, é `requireAdmin` na rota '
      + '(`catalog.routes.js`), porque mover acervo entre OMs é ato de sistema. Por isso o `WHERE` '
      + 'casa por id, sem `fn_can_produce_resource` — quem chega já passou pelo administrador.',
  },
  {
    arquivo: 'src/modules/catalog/catalog.queries.js', unidade: 'catalogAuthorizationPredicate', n: 1,
    classe: SQL, predicado: P_PRODUCAO,
    motivo: 'A FÁBRICA do predicado de leitura do catálogo: papel global OU produção OU concessão. '
      + 'Ela não toca tabela nenhuma por nome (quem interpola é o chamador), e por isso ficou fora '
      + 'da varredura enquanto o CONTATO só reconhecia `FROM ${...}`. É a definição de onde as '
      + 'unidades de listagem derivam, e a única cópia da regra.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.queries.js', unidade: 'sv360AccessPredicate', n: 1,
    classe: SQL, predicado: P_PRODUCAO,
    motivo: 'O irmão do 360, composto do mesmo jeito e pela mesma razão de ser função e não '
      + 'constante (o número do placeholder muda por consulta). Ele é o predicado que as consultas '
      + 'de projeto e de tile injetam; uma segunda cópia dele é a dívida que o schema `ng` já paga.',
  },
  {
    arquivo: 'src/modules/resource-access/resource-access.queries.js', unidade: 'setCatalogAccessLevel',
    n: 1, classe: ESCRITA, predicado: P_PRODUCAO,
    motivo: 'A ESCRITA DE VISIBILIDADE do catálogo (público/privado), que desde 2026-08-20 é do '
      + 'produtor e não só do administrador. O gate fino está no `WHERE`, como nos outros dois '
      + 'caminhos de escrita de catálogo. Ela era INVISÍVEL para a varredura porque interpola a '
      + 'tabela num `UPDATE ${...}` e o irmão do 360 só era visto por nomear `sv360.projects`: a '
      + 'decisão de qual OM é a linha estava censada num tipo de recurso e ausente nos outros quatro.',
  },
  {
    arquivo: 'src/middleware/resource-access.js', unidade: 'producesResource', n: 1,
    classe: SQL, predicado: P_PRODUCAO,
    motivo: 'O wrapper do eixo de PRODUÇÃO usado pelos gates de repasse e de manutenção. Ele não '
      + 'reimplementa nada: é a mesma função SQL que gateia o `WHERE` de toda escrita de catálogo. '
      + 'Levanta para tipo fora da whitelist, e é por isso que o chamador roda DEPOIS do Joi da rota.',
  },
  {
    arquivo: 'src/middleware/resource-access.js', unidade: 'CATALOG_PRODUCER_ACTOR', n: 1,
    classe: SQL, predicado: P_PRODUCAO,
    motivo: 'O ator de uma escrita de catálogo, resolvido NO BANCO numa consulta só: `produz_este` '
      + 'sobre a linha apontada pela rota, mais o escopo lido de `users` e nunca do token, porque '
      + '`flexibleAuth` não reconcilia e um produtor rebaixado carregaria o crachá por até 15 min.',
  },

  // ================= /api/config: o documento de boot ========================
  {
    arquivo: 'src/modules/config/config.service.js', unidade: 'listBasemaps', n: 1, classe: PUBLICO,
    motivo: CONFIG_PUBLICO,
  },
  {
    arquivo: 'src/modules/config/config.service.js', unidade: 'listBasemapStyles', n: 1,
    classe: PUBLICO,
    motivo: `${CONFIG_PUBLICO} Esta é a superfície que o basemap privado vaza se alguém filtrar só a `
      + 'metadata: o `style` do MapLibre carrega as URLs de tile e de glifo, e sai por uma chave '
      + 'separada. RISCO medido e fechado em `resource-access-visible.test.js`.',
  },
  {
    arquivo: 'src/modules/config/config.service.js', unidade: 'listAnalysisLayers', n: 1,
    classe: PUBLICO, motivo: CONFIG_PUBLICO,
  },
  {
    arquivo: 'src/modules/config/config.service.js', unidade: 'listDataLayers', n: 1,
    classe: PUBLICO, motivo: CONFIG_PUBLICO,
  },
  {
    arquivo: 'src/modules/config/config.service.js', unidade: 'listTilesets', n: 1,
    classe: PUBLICO, motivo: CONFIG_PUBLICO,
  },

  // ================= acesso a recurso privado ================================
  {
    arquivo: 'src/modules/resource-access/resource-access.queries.js', unidade: 'listVisiblePrivate',
    n: 1, classe: SQL, predicado: P_CATALOGO_AUTZ,
    motivo: 'O payload ADITIVO (`GET /resource-access/visible`): lista SÓ o que é `private` e o '
      + 'chamador alcança. A ausência do termo `public` é deliberada e é o que o separa da listagem '
      + 'crua — somar o público aqui duplicaria o que o /api/config já entregou. Os três braços de '
      + 'autorização deixaram de estar escritos aqui na fase F11 e vêm do builder compartilhado.',
  },
  {
    arquivo: 'src/modules/resource-access/resource-access.queries.js', unidade: 'originColumns',
    n: 1, classe: DERIVADO,
    predicado: 'src/modules/resource-access/resource-access.queries.js::listVisiblePrivate',
    motivo: 'As TRÊS COLUNAS DE PROCEDÊNCIA do payload aditivo (papel, produção, concessão). Elas '
      + 'não recortam linha nenhuma: quem recorta é o predicado do WHERE das duas consultas que as '
      + 'incluem, e elas são a DECOMPOSIÇÃO daquele mesmo predicado por parâmetro — a concessão sai '
      + 'chamando `fn_granted_resource_ids` com `p_atlas_id` NULO, que é o que desliga o braço de '
      + 'empréstimo sem escrever uma segunda regra. O que sobra (linha no resultado sem nenhuma das '
      + 'três colunas) só pode ter vindo do empréstimo, e o serviço a nomeia por eliminação. Elas '
      + 'aparecem na varredura porque citam `fn_can_produce_resource`, que é o gatilho certo: um '
      + 'braço novo de autorização precisa nascer com coluna aqui, senão vira `emprestimo` calado.',
  },
  {
    arquivo: 'src/modules/resource-access/resource-access.queries.js',
    unidade: 'LIST_VISIBLE_PRIVATE_360', n: 1, classe: SQL, predicado: P_360,
    motivo: 'O mesmo payload aditivo para o 360, que tem predicado próprio porque carrega o eixo de '
      + '`status` junto (um projeto `disabled` não entra nem para quem tem concessão).',
  },
  {
    arquivo: 'src/modules/resource-access/resource-access.queries.js',
    unidade: 'getCatalogAccessLevel', n: 1, classe: ESCRITA, predicado: 'requireResourceMaintainer',
    motivo: 'Lê o `access_level` atual de uma linha de catálogo para a rota que o MUDA '
      + '(PATCH /:type/:id/visibility). Não recorta nada e não precisa: quem recorta é o gate da '
      + 'rota (que recusa quem não mantém acervo nenhum) mais o `fn_can_produce_resource` do '
      + 'WHERE da própria escrita. O gate deixou de ser `requireAdmin` em 2026-08-20: marcar '
      + 'público ou privado é MANUTENÇÃO do acervo da OM, não administração do sistema.',
  },
  {
    arquivo: 'src/modules/resource-access/resource-access.queries.js', unidade: 'SET_360_ACCESS_LEVEL',
    n: 2, classe: ESCRITA, predicado: 'requireResourceMaintainer',
    motivo: 'A escrita do eixo de privacidade de um projeto 360. Ela é a única do módulo que toca '
      + '`sv360.projects`, e é escrita. O gate GROSSO está na rota e o FINO no próprio WHERE '
      + '(`fn_can_produce_resource` sobre a linha), que é o que devolve 404 — e não 403 — para o '
      + 'projeto de outra OM, sem virar oráculo de inventário.',
  },
  {
    arquivo: 'src/modules/resource-access/resource-access.queries.js', unidade: 'GET_360_ACCESS_LEVEL',
    n: 1, classe: ESCRITA, predicado: 'requireResourceMaintainer',
    motivo: 'A leitura do valor anterior, para a auditoria da mesma rota de escrita registrar de-para. '
      + 'Não é superfície de leitura de recurso: devolve uma coluna e nenhum conteúdo, e sai pelo '
      + 'mesmo gate da escrita que ela acompanha.',
  },

  {
    arquivo: 'src/modules/resource-access/resource-access.queries.js',
    unidade: 'CLASSIFY_RESOURCE_REFS', n: 5, classe: SQL, predicado: 'fn_can_see_resource',
    motivo: 'A classificacao em LOTE das referencias de um atlas, para a poda do CLONE e do '
      + 'IMPORT: uma linha por referencia, julgada pelo MESMO predicado composto que o gate '
      + 'pontual e a borda de escrita usam. As cinco linhas de contato sao os cinco ramos do '
      + 'UNION que trazem o `access_level` de cada tabela — o predicado nao e reimplementado, '
      + 'ele e chamado. Duas decisoes moram nela: o atlas em foco e NULO (o clone nao copia '
      + '`atlas_resources`, entao o que a origem emprestava nao pode viajar) e a linha AUSENTE '
      + 'vira `private` por COALESCE, para que "nao existe" e "nao posso ver" continuem '
      + 'indistinguiveis em vez de virarem oraculo de existencia.',
  },
  {
    arquivo: 'src/modules/resource-access/resource-access.queries.js',
    unidade: 'RESOLVE_SV360_REFS', n: 2, classe: JS, predicado: 'sv360.projects',
    motivo: 'A TRADUCAO das referencias 360 (nome de foto, slug, nome de projeto, id da foto de '
      + 'entrada) para o id do projeto. Ela NAO recorta acesso, e a ausencia do predicado e '
      + 'deliberada: filtrar aqui faria a referencia de projeto invisivel sumir ANTES da '
      + 'classificacao, e o resultado ficaria indistinguivel de "nao existe" — o que apagaria a '
      + 'contagem do relatorio. Quem decide visibilidade e `CLASSIFY_RESOURCE_REFS`, na linha '
      + 'seguinte. O desempate ESPELHA `GET_PHOTO_BY_NAME` nos tres termos que ela tem (lapide '
      + 'de `deleted_photos`, OM do chamador, projeto `enabled`), e o espelho e o ponto: por um '
      + 'tempo esta consulta desempatava so por `enabled` mais `created_at`, enquanto o servidor '
      + 'de fotos punha a OM primeiro e excluia lapide — dois projetos `enabled` com foto '
      + 'homonima faziam a referencia ser classificada contra um projeto e servida por outro, '
      + 'nos dois sentidos. O `created_at` sobrevive como ultimo criterio porque esta classifica '
      + 'em lote e precisa ser deterministica.',
  },
  {
    arquivo: 'src/modules/resource-access/resource-access.queries.js',
    unidade: 'RECURSOS_VIVOS', n: 5, classe: PUBLICO,
    motivo: 'O fragmento que dá NOME ao recurso nas duas listagens de concessão por ATOR (o que eu '
      + 'concedi, o que eu recebi). Ele é uma união das cinco tabelas SEM predicado de acesso '
      + 'nenhum, e a ausência é deliberada: aquelas duas rotas respondem sobre a AUTORIA e o '
      + 'BENEFÍCIO de uma linha de `resource_grants`, não sobre a visibilidade do recurso — um '
      + 'concedente que perdeu o acesso continua precisando ver e revogar o que deu. O RISCO é '
      + 'exato e precisa ficar escrito: usado FORA de uma junção com uma concessão do próprio '
      + 'chamador, ele entrega o nome de todo recurso privado do sistema. As duas consultas que o '
      + 'usam o junta por INNER JOIN contra `resource_grants` já filtrada pelo ator, e o INNER é '
      + 'também o que tira da lista o recurso MORTO (catálogo `active = false`, 360 hard-deletado), '
      + 'que de outro modo apareceria como se estivesse vivo.',
  },
  {
    arquivo: 'src/modules/resource-access/resource-access.queries.js',
    unidade: 'RECURSOS_COM_NIVEL_DE_ACESSO', n: 2, classe: PUBLICO,
    motivo: 'O fragmento que dá NOME e MARCA DE ACESSO ao recurso na listagem do que um atlas '
      + 'EMPRESTA (`GET /atlas/:atlasId/resources`). Ele une as cinco tabelas SEM predicado de '
      + 'acesso e SEM `active`, e as duas ausências são deliberadas: aquela rota responde sobre o '
      + 'VÍNCULO (`atlas_resources`), não sobre a visibilidade do recurso, e um item soft-deletado '
      + 'que continua emprestado precisa aparecer NOMEADO, senão ele fica indistinguível do '
      + 'empréstimo órfão. Ele nasceu para a cláusula 6.6: ao ativar o link público, a tela nomeia '
      + 'os privados que o atlas empresta, porque o empréstimo ao visitante foi MANTIDO e o que '
      + 'resolve é o consentimento informado — e uma lista de ids não nomeia nada. O RISCO é '
      + 'exato: usado FORA de uma junção com `atlas_resources` do atlas em foco, ele entrega o '
      + 'nome e o nível de acesso de todo recurso do sistema. O único consumidor o junta por LEFT '
      + 'JOIN contra os empréstimos VIVOS de UM atlas, e a rota é `auth` estrito mais '
      + '`requireAtlasPermission(\'read\')`. O que ele acrescenta ao que já saía por ali é o NOME '
      + 'de um recurso que o leitor pode não enxergar; o empréstimo em si já entrega o recurso a '
      + 'quem abre o atlas (ramo D4 de `fn_granted_resource_ids`), então a diferença real é o '
      + 'vínculo cujo braço D4 morreu — que é justamente o que a tela precisa nomear para que '
      + 'alguém o desfaça.',
  },
  {
    arquivo: 'src/modules/resource-access/resource-access.queries.js',
    unidade: 'LIST_SHAREABLE_OF_ACTOR', n: 1, classe: SQL,
    predicado: 'fn_produced_private_resource_ids',
    motivo: 'O campo `shareable` do payload aditivo: os pares (tipo, id) que este ator pode '
      + 'REPASSAR. Ele não serve o recurso, serve a AFORDÂNCIA — e é por isso que entra no censo '
      + 'como consulta de acesso: um braço largo demais aqui acende o botão "Compartilhar" sobre '
      + 'o que o ator não pode ceder, e o 403 vira a explicação depois do clique. São dois braços '
      + 'disjuntos: concessão viva de nível `view_share` (pessoal ou por grupo) e PRODUÇÃO, esta '
      + 'última por uma função SQL própria que devolve só o PRIVADO da OM do ator. O papel global '
      + 'fica FORA dos dois, de propósito: quem concede de raiz não tem linha para listar, e o '
      + 'cliente já sabe disso por outro caminho.',
  },

  // ================= o snapshot de sync: a camada de catálogo no mapa ========
  {
    arquivo: 'src/modules/sync/sync.queries.js', unidade: 'catalogDefinitionsOf', n: 1, classe: SQL,
    predicado: P_CATALOGO_AUTZ,
    motivo: 'A REIDRATAÇÃO da definição de uma camada de catálogo posta num mapa (fase F11). A linha '
      + 'de `catalog_layers` guarda referência e estado local; nome e `config` (a URL inclusive) vêm '
      + 'DAQUI, pelo predicado do CHAMADOR, na leitura. Enquanto a definição era uma cópia no JSONB, '
      + 'ela saía no snapshot para chamador ANÔNIMO em atlas `is_public`, sem atravessar gate nenhum. '
      + 'Só os DOIS tipos que são recurso de catálogo aparecem: `hillshade` é embutido e não tem linha.',
  },
  {
    arquivo: 'src/modules/sync/sync.queries.js', unidade: 'canSeeCatalogResource', n: 1,
    classe: ESCRITA, predicado: 'unseenResourceDenialReason',
    motivo: 'O gate de ESCRITA de referência de CATÁLOGO: quem cria ou atualiza precisa ENXERGAR o '
      + 'recurso referenciado. Endurecimento, não a defesa principal (essa é a leitura acima), e pela '
      + 'mesma razão de `assertCanSeeResource` no empréstimo: sem ele um co-Gestor referencia por '
      + 'adivinhação de id um recurso que não pode abrir. Recusa POR OPERAÇÃO, nunca por lote. '
      + 'Ele serviu SÓ a camada de catálogo até 2026-08-21, quando o gate passou a ser uma tabela '
      + 'de extratores por `op.target` e ele passou a responder também pelo `tileset_id` do 3D, '
      + 'pelo `model_id` do slide e pelo `base_layer` do mapa — as quatro tabelas de catálogo, uma '
      + 'consulta só.',
  },
  {
    arquivo: 'src/modules/sync/sync.queries.js', unidade: 'CAN_SEE_SV360_REF', n: 1,
    classe: ESCRITA, predicado: 'unseenResourceDenialReason',
    motivo: 'A metade 360 do MESMO gate de escrita, e ela existe separada por uma razão de dado, '
      + 'não de estilo: a referência que o atlas guarda é NOME DE FOTO (ou slug, ou nome de '
      + 'projeto, ou id da foto de entrada), nunca o id que `fn_can_see_resource` julga. A tradução '
      + 'vem de `RESOLVE_SV360_REFS`, COMPOSTA aqui em vez de reescrita, porque uma segunda cópia '
      + 'do desempate classificaria a referência contra um projeto e a serviria por outro — defeito '
      + 'já pago nesta casa. O `atlasId` da ROTA viaja até o predicado, e essa é a diferença que '
      + 'separa este gate da classificação do CLONE (`CLASSIFY_RESOURCE_REFS`, que passa '
      + '`NULL::uuid` de propósito): na cópia o recurso SAI do atlas, no sync ele FICA, então o '
      + 'empréstimo conta.',
  },

  // O SEGUNDO CATÁLOGO DE MODELO 3D SAIU DAQUI, e a ausência é o registro: `ng.catalogo_3d`
  // tinha um eixo de acesso PARALELO (`users.role = admin` direto mais `ng.model_permissions`,
  // nunca `fn_has_global_data_access` nem `resource_grants`), duplicado verbatim entre
  // `CATALOGO_SELECT` e `CATALOGO_COUNT`. Ele foi REMOVIDO na F15 em vez de unificado: a
  // tabela não tinha consumidor no frontend, as duas tabelas de permissão dela não tinham
  // escritor nenhum em `src/` (o filtro existia e era inalcançável), e o catálogo de modelo
  // 3D que o app usa sempre foi `public.tilesets`. Duas entradas de censo a menos porque duas
  // superfícies a menos.

  // ================= 360: leitura ============================================
  {
    arquivo: 'src/modules/streetview360/sv360.queries.js', unidade: 'LIST_PROJECTS', n: 1,
    classe: SQL, predicado: P_360,
    motivo: 'A listagem de projetos 360, a superfície mais visível do módulo e a primeira a receber '
      + 'o predicado. Ela foi por muito tempo a ÚNICA medida, e é por isso que este censo existe.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.queries.js', unidade: 'GET_PROJECT_BY_SLUG', n: 1,
    classe: SQL, predicado: P_360,
    motivo: 'O projeto por slug, e a raiz de NOVE consultas derivadas (floors, photos, map, runs, '
      + 'review-stats por projeto, miniatura). Perder o predicado aqui abre as nove de uma vez.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.queries.js', unidade: 'GET_PHOTO_BY_ID', n: 2,
    classe: SQL, predicado: P_360,
    motivo: 'O metadado da foto por uuid. Ganhou o predicado na fase F9: antes dela um projeto '
      + '`enabled + private` entregava a foto a quem soubesse o identificador, porque quem decidia '
      + 'era `isProjectReadable`, que só conhece o eixo de `status`.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.queries.js', unidade: 'GET_PHOTO_BY_NAME', n: 2,
    classe: SQL, predicado: P_360,
    motivo: 'A foto pelo nome original. O predicado entra no WHERE e o desempate por OM preferida '
      + 'continua no ORDER BY: são coisas diferentes, e um nome que colide entre um projeto privado '
      + 'e um público prova a diferença.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.pyramid.queries.js', unidade: 'GET_PHOTO_PYRAMID', n: 2,
    classe: SQL, predicado: P_360,
    motivo: 'A SEGUNDA porta para o mesmo pixel: desde que a origem aposentou `full_webp`, a '
      + 'panorâmica chega em pirâmide de tiles, e esta consulta é o descritor da escada mais o '
      + 'caminho do {slug}_tiles.db. Ela nasce com o predicado porque a lição já foi paga uma vez '
      + 'neste módulo: o predicado do MVT passou verde ao ser revertido, já que a suíte media '
      + 'privacidade na listagem e nunca no tile.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.pyramid.queries.js', unidade: 'COUNT_PROJECT_PYRAMIDS', n: 1,
    classe: ESCRITA, predicado: 'requireUploadCapability',
    motivo: 'Conferência de INGESTÃO, não superfície de leitura: conta as pirâmides que o banco '
      + 'tem para foto VIVA do projeto, DENTRO da transação do merge, e reprova quando o número '
      + 'não bate com o que foi lido do SQLite enviado. É o caminho independente da escrita: '
      + '`gravarPiramides` sabe quantas mandou gravar, e conferir por esse número confirmaria a '
      + 'si mesmo. Roda atrás do upload de bundle e do ETL, que são administrador ou produtor da '
      + 'OM, e nunca responde a chamador anônimo. Não recorta por leitor porque não entrega dado: '
      + 'devolve uma contagem sobre o projeto que o próprio chamador está subindo. Esta entrada '
      + 'afirmou que ela rodava atrás do upload enquanto ela não tinha chamador NENHUM, de '
      + '2026-08-22 a 2026-08-23.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.queries.js', unidade: 'NEARBY_PHOTOS', n: 2,
    classe: SQL, predicado: P_360,
    motivo: 'A busca ESPACIAL de fotos, que alimenta `/photos/nearest`. Sem predicado ela dispensava '
      + 'até o identificador: bastava um par lon/lat perto do acervo restrito para recebê-lo.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.queries.js', unidade: 'TILES_PHOTOS', n: 2,
    classe: SQL, predicado: P_360,
    motivo: 'O feed GeoJSON legado dos tiles. Continua servido para anônimo de propósito, com o '
      + 'filtro embutido no SQL e limite obrigatório de features.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.queries.js', unidade: 'REVIEW_STATS_ALL_PROJECTS',
    n: 2, classe: SQL, predicado: P_360,
    motivo: 'Os contadores de revisão de TODOS os projetos: agregado, mas ainda assim revela quais '
      + 'projetos existem e o tamanho de cada um. Agregado sem predicado é vazamento com aritmética.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.tiles.queries.js', unidade: 'MVT_TILE', n: 4,
    classe: SQL, predicado: P_360,
    motivo: 'O tile vetorial, e ele gateia DUAS camadas (pontos e a trajetória sintetizada). É a '
      + 'superfície onde o defeito-mãe deste censo aconteceu: a suíte media privacidade na listagem '
      + 'e o tile passava verde. A CTE `visible_projects` avalia o predicado UMA vez por projeto.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.queries.js', unidade: 'GET_TARGETS_FOR_PHOTO', n: 1,
    classe: DERIVADO, predicado: U_FOTO, motivo: DERIVA_DA_FOTO,
  },
  {
    arquivo: 'src/modules/streetview360/sv360.queries.js', unidade: 'GET_ALL_TARGETS_FOR_PHOTO',
    n: 1, classe: DERIVADO, predicado: U_FOTO,
    motivo: `${DERIVA_DA_FOTO} Esta variante inclui os links OCULTOS, e é opt-in: o visualizador `
      + 'continua recebendo exatamente o array que sempre recebeu.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.queries.js', unidade: 'NEARBY_UNLINKED_PHOTOS', n: 2,
    classe: DERIVADO, predicado: U_FOTO,
    motivo: `${DERIVA_DA_FOTO} Ela é confinada ao MESMO projeto da foto de origem, então resolver a `
      + 'origem resolve o alcance inteiro.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.queries.js', unidade: 'LIST_PROJECT_FLOORS', n: 1,
    classe: DERIVADO, predicado: U_SLUG, motivo: DERIVA_DO_SLUG,
  },
  {
    arquivo: 'src/modules/streetview360/sv360.queries.js', unidade: 'LIST_PHOTOS_BY_PROJECT', n: 1,
    classe: DERIVADO, predicado: U_SLUG, motivo: DERIVA_DO_SLUG,
  },
  {
    arquivo: 'src/modules/streetview360/sv360.queries.js', unidade: 'PROJECT_CALIBRATION_PHOTOS',
    n: 1, classe: DERIVADO, predicado: U_SLUG, motivo: DERIVA_DO_SLUG,
  },
  {
    arquivo: 'src/modules/streetview360/sv360.queries.js', unidade: 'REVIEW_STATS_BY_PROJECT', n: 1,
    classe: DERIVADO, predicado: U_SLUG, motivo: DERIVA_DO_SLUG,
  },
  {
    arquivo: 'src/modules/streetview360/sv360.queries.js', unidade: 'MAP_PHOTOS_BY_PROJECT', n: 1,
    classe: DERIVADO, predicado: U_SLUG, motivo: DERIVA_DO_SLUG,
  },
  {
    arquivo: 'src/modules/streetview360/sv360.queries.js', unidade: 'RUNS_BY_PROJECT', n: 1,
    classe: DERIVADO, predicado: U_SLUG, motivo: DERIVA_DO_SLUG,
  },

  // ================= 360: o serviço ==========================================
  {
    arquivo: 'src/modules/streetview360/sv360.service.js', unidade: 'isProjectReadable', n: 1,
    classe: JS, predicado: "project.status === 'enabled'",
    motivo: 'O eixo de `status` (OCULTAÇÃO), e SÓ ele. O eixo de PRIVACIDADE saiu daqui na fase F6 '
      + 'e mora no SQL, porque decidi-lo no JS custaria uma consulta por chamada nos caminhos mais '
      + 'quentes e criaria uma segunda definição da regra. A frase "nenhuma linha chega aqui sem ter '
      + 'passado pelo SQL" já foi FALSA por quatro consultas, e é essa a razão deste censo.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.service.js', unidade: 'enforceProjectReadable', n: 2,
    classe: JS, predicado: 'isProjectReadable(',
    motivo: 'O invólucro que transforma "não legível" em 404 e nunca em 403, para que um projeto '
      + 'oculto seja indistinguível de inexistente. Não acrescenta eixo nenhum ao que a função '
      + 'acima decide.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.service.js', unidade: 'resolveReadableProject', n: 2,
    classe: DERIVADO, predicado: U_SLUG,
    motivo: 'O ÚNICO caminho de resolução de projeto por slug do serviço: ele passa o principal e o '
      + 'atlas em foco à consulta filtrada e só depois reaplica o eixo de status. Um chamador que '
      + 'esquece o `atlasId` devolve 404 para um panorama que o atlas legitimamente empresta.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.service.js', unidade: 'getProject', n: 1,
    classe: DERIVADO, predicado: U_SLUG, motivo: DERIVA_DO_SLUG,
  },
  {
    arquivo: 'src/modules/streetview360/sv360.service.js', unidade: 'listProjectFloors', n: 1,
    classe: DERIVADO, predicado: U_SLUG, motivo: DERIVA_DO_SLUG,
  },
  {
    arquivo: 'src/modules/streetview360/sv360.service.js', unidade: 'projectCalibrationPhotos', n: 1,
    classe: DERIVADO, predicado: U_SLUG, motivo: DERIVA_DO_SLUG,
  },
  {
    arquivo: 'src/modules/streetview360/sv360.service.js', unidade: 'projectMap', n: 1,
    classe: DERIVADO, predicado: U_SLUG, motivo: DERIVA_DO_SLUG,
  },
  {
    arquivo: 'src/modules/streetview360/sv360.service.js', unidade: 'projectRuns', n: 1,
    classe: DERIVADO, predicado: U_SLUG, motivo: DERIVA_DO_SLUG,
  },
  {
    arquivo: 'src/modules/streetview360/sv360.service.js', unidade: 'resolveThumbnailPath', n: 1,
    classe: DERIVADO, predicado: U_SLUG,
    motivo: `${DERIVA_DO_SLUG} A miniatura é BYTE, não metadado, então o escopo de cache dela `
      + 'também depende dos dois eixos — ver a varredura de cabeçalho.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.service.js', unidade: 'getPhoto', n: 1,
    classe: DERIVADO, predicado: U_FOTO, motivo: DERIVA_DA_FOTO,
  },
  {
    arquivo: 'src/modules/streetview360/sv360.service.js', unidade: 'photoByName', n: 1,
    classe: DERIVADO, predicado: 'src/modules/streetview360/sv360.queries.js::GET_PHOTO_BY_NAME',
    motivo: `${DERIVA_DA_FOTO} A OM preferida do chamador viaja junto, e ela é ORDENAÇÃO: quem `
      + 'autoriza é o predicado no WHERE, e o desempate só escolhe entre as linhas que ele deixou passar.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.service.js', unidade: 'getPhotoPyramidMeta', n: 1,
    classe: DERIVADO,
    predicado: 'src/modules/streetview360/sv360.pyramid.queries.js::GET_PHOTO_PYRAMID',
    motivo: `${DERIVA_DA_FOTO} Serve as DUAS rotas da pirâmide (descritor e tile), então o gate `
      + 'roda uma vez por pedido de tile também, e não só na abertura da foto.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.service.js', unidade: 'nearby', n: 1,
    classe: DERIVADO, predicado: 'src/modules/streetview360/sv360.queries.js::NEARBY_PHOTOS',
    motivo: 'O filtro de `status` roda no JS, POR LINHA, sobre o resultado de uma consulta que já '
      + 'aplicou o eixo de privacidade no SQL. Repare no limite declarado: o corte das 100 mais '
      + 'próximas acontece ANTES do filtro de JS.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.service.js', unidade: 'nearbyUnlinkedPhotos', n: 1,
    classe: DERIVADO, predicado: U_FOTO, motivo: DERIVA_DA_FOTO,
  },

  // ================= 360: escrita e administração ============================
  {
    arquivo: 'src/modules/streetview360/sv360.admin.queries.js', unidade: 'LIST_PROJECTS_ADMIN',
    n: 2, classe: SQL, predicado: P_PRODUCAO,
    motivo: 'A listagem ADMINISTRATIVA do 360, e ela recorta por PRODUÇÃO e não por acesso a dado, '
      + 'de propósito: quem mantém o acervo vê o que mantém, e o credenciado, que lê todo recurso '
      + 'privado, não aparece aqui porque não escreve nada.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.admin.queries.js', unidade: 'GET_PROJECT_FOR_ADMIN',
    n: 1, classe: ESCRITA, predicado: 'loadWritableProject', motivo: INGESTAO_360,
  },
  {
    arquivo: 'src/modules/streetview360/sv360.admin.queries.js',
    unidade: 'CHECK_PHOTO_IDS_IN_OTHER_PROJECT', n: 2, classe: ESCRITA, predicado: 'loadWritableProject',
    motivo: `${INGESTAO_360} Esta detecta colisão de id de foto entre projetos, que é o que impede um `
      + 'manifesto de sequestrar a foto de outra OM.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.admin.queries.js', unidade: 'UPSERT_PROJECT', n: 1,
    classe: ESCRITA, predicado: 'loadWritableProject', motivo: INGESTAO_360,
  },
  {
    arquivo: 'src/modules/streetview360/sv360.admin.queries.js', unidade: 'CHECK_SLUG_IN_ORG', n: 1,
    classe: ESCRITA, predicado: 'requireAdmin',
    motivo: 'Guarda de colisão da transferência de OM (só-admin): confere se a OM destino já tem '
      + 'um projeto com o mesmo slug, para dar 409 em vez de violar o `UNIQUE(org, slug)`. O gate é '
      + '`requireAdmin` (`sv360.routes.js`), o mesmo da escrita que ela precede.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.admin.queries.js', unidade: 'TRANSFER_PROJECT_OWNER', n: 1,
    classe: ESCRITA, predicado: 'requireAdmin',
    motivo: 'Move `organization_id` do projeto (só-admin). Troca de coluna: o `db_filename` NÃO '
      + 'muda, e as leituras resolvem o arquivo por ele, então nada em disco se renomeia. Gate '
      + '`requireAdmin` na rota.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.admin.queries.js', unidade: 'PURGE_PROJECT_TARGETS',
    n: 2, classe: ESCRITA, predicado: 'loadWritableProject', motivo: INGESTAO_360,
  },
  {
    arquivo: 'src/modules/streetview360/sv360.admin.queries.js', unidade: 'PURGE_PROJECT_PHOTOS',
    n: 1, classe: ESCRITA, predicado: 'loadWritableProject', motivo: INGESTAO_360,
  },
  {
    arquivo: 'src/modules/streetview360/sv360.admin.queries.js', unidade: 'INSERT_PHOTO', n: 1,
    classe: ESCRITA, predicado: 'loadWritableProject', motivo: INGESTAO_360,
  },
  {
    arquivo: 'src/modules/streetview360/sv360.admin.queries.js', unidade: 'UPDATE_PROJECT_STATUS',
    n: 1, classe: ESCRITA, predicado: 'loadWritableProject', motivo: INGESTAO_360,
  },
  {
    arquivo: 'src/modules/streetview360/sv360.admin.queries.js', unidade: 'UPDATE_PROJECT_METADATA',
    n: 1, classe: ESCRITA, predicado: 'loadWritableProject',
    motivo: `${INGESTAO_360} Esta grava o METADADO editável do projeto (hoje só o vídeo de `
      + 'prévia), que `sv360.projects` guarda em coluna porque não tem `config` JSONB como as '
      + 'quatro tabelas de catálogo. Ela é escrita e não leitura: nada aqui recorta linha para '
      + 'ninguém, o recorte é o mesmo `loadWritableProject` que gateia status e exclusão.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.admin.queries.js',
    unidade: 'PURGE_TOMBSTONES_BY_PROJECT', n: 1, classe: ESCRITA, predicado: 'loadWritableProject',
    motivo: INGESTAO_360,
  },
  {
    arquivo: 'src/modules/streetview360/sv360.admin.queries.js', unidade: 'DELETE_PROJECT', n: 1,
    classe: ESCRITA, predicado: 'loadWritableProject', motivo: INGESTAO_360,
  },
  {
    arquivo: 'src/modules/streetview360/sv360.admin.service.js', unidade: 'loadWritableProject',
    n: 1, classe: ESCRITA, predicado: 'producer_org_id',
    motivo: 'O gate de escrita do 360 em pessoa: carrega o projeto por slug para ADMINISTRAR e '
      + 'aplica a escada 404→403. O administrador escolhe a OM alvo, o produtor fica preso à dele, '
      + 'e o eixo de lotação auto-declarada saiu inteiro na fase F6.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.write.service.js', unidade: 'enforceProjectWritable',
    n: 1, classe: ESCRITA, predicado: 'canWriteProject',
    motivo: 'A escada da escrita de calibração: primeiro `isProjectReadable` (404, para um projeto '
      + 'oculto continuar indistinguível de inexistente) e só depois a capacidade de escrita (403). '
      + 'Empréstimo e concessão não entram: eles autorizam LER.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.write.queries.js', unidade: 'GET_PHOTO_FOR_WRITE',
    n: 2, classe: ESCRITA, predicado: 'enforceProjectWritable',
    motivo: 'A carga da foto para escrita, e ela deliberadamente NÃO exclui tombstone, para que a '
      + 'posse ainda resolva. Quem autoriza é o gate do serviço irmão, no mesmo módulo.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.write.queries.js', unidade: 'CHECK_TARGET_SAME_PROJECT',
    n: 2, classe: ESCRITA, predicado: 'enforceProjectWritable',
    motivo: 'Confina a criação de link ao MESMO projeto, que é o que impede um alvo de atravessar '
      + 'para o acervo de outra OM. Roda depois do gate de escrita.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.write.queries.js', unidade: 'BATCH_RESET_REVIEWED',
    n: 1, classe: ESCRITA, predicado: 'enforceProjectWritable',
    motivo: 'Limpa a marca de revisão de todas as fotos vivas de um projeto já autorizado para '
      + 'escrita. Escreve, não lê.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.write.queries.js', unidade: 'GET_RUN_FOR_WRITE', n: 1,
    classe: ESCRITA, predicado: 'enforceProjectWritable',
    motivo: 'Resolve a corrida de captura até o projeto dono para que o mesmo gate de escrita possa '
      + 'ser aplicado a ela. Sem esta linha a rota por runId não teria projeto contra o que gatear.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.write.service.js', unidade: 'buildCalibrationUpdate',
    n: 1, classe: ESCRITA, predicado: 'CALIBRATION_COLUMN_WHITELIST',
    motivo: 'UPDATE dinâmico cujos NOMES DE COLUNA vêm só de uma whitelist e nunca das chaves do '
      + 'corpo; os valores são parametrizados. É a regra de SQL dinâmico da casa, aplicada.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.write.service.js', unidade: 'buildBatchRotationUpdate',
    n: 1, classe: ESCRITA, predicado: 'enforceProjectWritable',
    motivo: 'O mesmo UPDATE, aplicado ao lote de um projeto ou de uma corrida já autorizados. '
      + 'Escreve, não lê.',
  },

  // ================= os DOIS índices de regime, e a consulta que os alimenta ==
  {
    arquivo: 'src/modules/catalog/catalog.tables.js', unidade: 'SELECT_LINHAS_DE_CATALOGO', n: 1,
    classe: PUBLICO,
    motivo: 'A consulta que inverte CAMINHO -> RECURSO, e ela lê as quatro '
      + 'tabelas SEM filtro nenhum, de propósito e nos dois sentidos: sem `active` (porque apagar '
      + 'um tileset privado não pode publicar os bytes dele) e sem princípio (porque o índice é '
      + 'construído uma vez para TODOS os chamadores, e é justamente isso que permite decidir o '
      + 'regime de uma requisição de asset sem consultar o banco). O RISCO é o de qualquer '
      + 'estrutura sem recorte: ela carrega em memória o id, o nível de acesso e o caminho de todo '
      + 'recurso de catálogo, e um chamador futuro que a EXPONHA (uma rota de diagnóstico, um log) '
      + 'entregaria o inventário privado inteiro. Hoje ela tem um leitor só, `regimeDoCaminho`, que '
      + 'devolve um booleano e o par (tipo, id) daquele caminho — nunca a lista. Quem decide o '
      + 'acesso continua sendo `fn_can_see_resource`, em `assets3d-acesso.js` e em `tile-access.js`. '
      + 'ELA MOROU DENTRO DE `assets3d-regime.js` ATÉ 2026-08-29, e saiu quando nasceu o SEGUNDO '
      + 'consumidor (`tile-regime.js`, o índice do prefixo de tiles): uma segunda cópia divergiria '
      + 'na primeira tabela de catálogo nova, e o índice esquecido trataria as linhas dela como '
      + '"caminho que ninguém reivindica" — que é a resposta que os dois decidem de forma OPOSTA, '
      + 'porque o do 3D a lê como pública e o do tile a recusa.',
  },

  // ================= acervo 3D convertido: registro por linha de comando =====
  {
    arquivo: 'src/modules/models3d/models3d.queries.js', unidade: 'LIST_MODELS_3D', n: 1,
    classe: PUBLICO,
    motivo: 'A varredura que monta o ÍNDICE EM MEMÓRIA de modelo -> arquivo, sem filtro nenhum e '
      + 'de propósito: ele é construído UMA vez para TODOS os chamadores, e é exatamente isso que '
      + 'permite decidir a requisição de um tile sem consultar o banco (o Cesium abre uma por tile '
      + 'por LOD). O RISCO é o mesmo do índice de regime: a estrutura carrega em memória o id e o '
      + 'endereço de todo modelo, e um chamador futuro que a EXPONHA entregaria o inventário. Ela '
      + 'traz `active` justamente para que a rota trate o não publicado como inexistente; quem '
      + 'decide ACESSO continua sendo `fn_can_see_resource`, por caminho, em `assets3d-acesso.js`.',
  },
  {
    arquivo: 'src/modules/models3d/models3d.queries.js', unidade: 'GET_MODEL_3D', n: 1,
    classe: PUBLICO,
    motivo: 'A ficha de produção de UM modelo (arquivo, token, contagens), lida por roteiro de '
      + 'linha de comando: o importador pergunta "este id já está tomado" e o verificador pergunta '
      + '"qual arquivo devo abrir". Sem predicado porque um modelo privado que respondesse "não '
      + 'existe" faria a importação seguinte sobrescrevê-lo em silêncio. O RISCO é montar rota '
      + 'sobre ela: a resposta confirma a existência e revela o endereço em disco.',
  },
  {
    arquivo: 'src/modules/models3d/models3d.queries.js', unidade: 'LIST_MODELS_3D_COM_PONTO', n: 1,
    classe: PUBLICO,
    motivo: 'A lista que a REMEDIÇÃO percorre para comparar o ponto do catálogo com o medido no '
      + 'arquivo. Mesmo chamador de linha de comando, mesmo motivo para não filtrar: um modelo '
      + 'privado deslocado precisa ser remedido como qualquer outro. O RISCO é o mesmo dos dois '
      + 'acima, e some junto com eles se alguém publicar isto numa rota.',
  },
  {
    arquivo: 'src/modules/models3d/models3d.queries.js', unidade: 'GET_SCENE_3D', n: 1,
    classe: PUBLICO,
    motivo: 'A ficha de produção de uma CENA caminhável, o outro tipo que este serviço publica: '
      + 'ela não é 3D Tiles, mora numa pasta e abre por outro visualizador. Lida pelo verificador '
      + 'para saber ONDE estão os bytes e QUAL assinatura eles deveriam ter. Sem predicado pela '
      + 'razão dos irmãos acima. O RISCO é o mesmo e é maior num ponto: a resposta traz o caminho '
      + 'público da pasta inteira, então expô-la numa rota entregaria o endereço de todo arquivo '
      + 'da cena de uma vez. O acesso dela é decidido por caminho, como o do modelo, e o índice de '
      + 'regime a alcança porque indexa `config.basePath` como pasta.',
  },
  {
    arquivo: 'src/modules/models3d/models3d.queries.js', unidade: 'LIST_SCENES_3D', n: 1,
    classe: PUBLICO,
    motivo: 'A mesma leitura, em lote, para conferir todas as cenas instaladas de uma vez. RISCO '
      + 'idêntico ao de `LIST_MODELS_3D`: ela devolve o inventário INTEIRO, privado e inativo '
      + 'inclusive, sem predicado nenhum, então ligá-la a uma rota entregaria a lista completa do '
      + 'acervo a quem chamasse. O que a mantém inofensiva é o chamador ser um só e de linha de '
      + 'comando: `scripts/models3d-verificar-lote.js`. Esta entrada afirmou que esse chamador '
      + 'existia enquanto ele NÃO existia (de 2026-08-22 a 2026-08-23), e nesse intervalo o lote '
      + 'se calava sobre as cenas, que ele não alcança por varrer o diretório de `.3dtiles` (uma '
      + 'cena é uma PASTA). Censo que descreve errado o que censa é a falha que este arquivo existe '
      + 'para impedir.',
  },
  {
    arquivo: 'src/modules/models3d/models3d.queries.js', unidade: 'UPSERT_TILESET_3D', n: 1,
    classe: PUBLICO,
    motivo: 'A escrita da linha de catálogo de um modelo `.3dtiles`, e ela NÃO tem gate de produção '
      + 'porque o único chamador é um roteiro de LINHA DE COMANDO (`scripts/models3d-adotar.js`), '
      + 'que roda com acesso ao banco e sem ator autenticado. Medido, tentar passar pelo serviço de '
      + 'catálogo era pior: `getCatalogItem` aplica o predicado de visibilidade, então readotar um '
      + 'modelo PRIVADO lia 404, caía no create e devolvia "já existe" ao operador que republicava '
      + 'o próprio modelo. O RISCO é montar rota HTTP sobre esta constante: ela escreve `tilesets` '
      + 'sem olhar OM produtora nem papel, e uma rota que a chamasse deixaria qualquer autenticado '
      + 'sobrescrever a linha de outra OM. Os dois eixos de acesso ficam FORA do SET, então nem o '
      + 'CLI rebaixa a público um modelo que alguém fechou.',
  },
  {
    arquivo: 'src/modules/models3d/models3d.queries.js', unidade: 'REMEDIR_TILESET_3D', n: 1,
    classe: PUBLICO,
    motivo: 'A remedição escreve no `config` do catálogo as DUAS medidas do envelope geodésico e o '
      + 'ponto de navegação, e ela existe porque reconverter um modelo para consertar um metadado '
      + 'custa horas (o Silo Oreste Ceretta ficou 3.657 m ao sul do lugar dele enquanto o ponto ia '
      + 'à mão). Sem gate pelo mesmo motivo do upsert acima: o único chamador é o roteiro de linha '
      + 'de comando. O RISCO é o mesmo, e aqui é menor por construção: ela mescla (`||`) só medida, '
      + 'nunca `access_level`, `owner_org_id` nem `active`.',
  },
  {
    arquivo: 'src/modules/models3d/models3d.queries.js', unidade: 'CATALOG_ROW_EXISTS', n: 1,
    classe: PUBLICO,
    motivo: 'A sonda de existência que decide entre "criado" e "atualizado" na adoção, sem predicado '
      + 'de visibilidade e de propósito: a pergunta é "este id está tomado", e o id de catálogo é um '
      + 'slug GLOBAL. Com predicado, um modelo privado responderia "não existe" e a importação '
      + 'seguinte o sobrescreveria em silêncio. O RISCO é o de qualquer sonda sem recorte: ela '
      + 'confirma a existência de um id que o chamador não pode ver, e por isso o único chamador é '
      + 'de linha de comando. Expor isto numa rota daria um oráculo de inventário.',
  },

  // ================= as contagens que nascem em 2026-08-24 ==================
  {
    arquivo: 'src/modules/catalog/catalog.service.js', unidade: 'countAtlasReferences', n: 2,
    classe: SQL, predicado: 'fn_can_produce_resource',
    motivo: 'Conta quantos ATLAS guardam uma referência a um item de catálogo, para a confirmação '
      + 'de exclusão dizer o número. A EXISTÊNCIA do item é recortada pelo mesmo predicado do '
      + 'DELETE que esta leitura precede, então linha de outra OM devolve 404 e não uma contagem: '
      + 'sem isso a rota viraria um oráculo de existência sobre o acervo alheio. O corpo é só '
      + 'quantidade por superfície, e nenhum id ou nome de atlas atravessa, o que importa porque a '
      + 'LISTA de atlas que citam um recurso é metadado de quem o usa.',
  },
  {
    arquivo: 'src/modules/organizations/organizations.queries.js',
    unidade: 'ORGANIZATION_DEACTIVATION_IMPACT', n: 5, classe: NAO_RECURSO,
    motivo: 'Toca as tabelas de recurso apenas para CONTAR linhas por owner_org_id (e por '
      + 'organization_id no 360, que lá é a própria OM produtora). Nenhum id, nome ou config sai '
      + 'no corpo: a resposta são três inteiros, para a confirmação de desativação de OM dizer o '
      + 'que o ato derruba. Não há superfície de conteúdo a recortar, e quem a fecha é '
      + '`requireAdmin` na rota, porque a contagem revela o efetivo e o acervo de uma OM.',
  },

  // ================= o padrão largo que casou outra coisa ====================
  {
    arquivo: 'src/modules/maps/maps.service.js', unidade: 'mergeMaps', n: 1, classe: NAO_RECURSO,
    motivo: 'FALSO POSITIVO DECLARADO, e ele fica aqui em vez de sumir por um padrão mais estreito. '
      + 'A interpolação é sobre as tabelas de SUB-ENTIDADE de mapa (KEYED_SINGLETONS), que são '
      + 'conteúdo colaborativo de atlas e são gateadas por `requireAtlasPermission`, não por '
      + '`resource_grants`. O padrão `FROM ${...}` casa qualquer tabela interpolada de propósito: '
      + 'estreitá-lo para evitar este falso positivo esconderia junto uma interpolação de catálogo.',
  },
  {
    arquivo: 'src/modules/atlas/atlas.service.js', unidade: 'cunharIdsOcupados', n: 1,
    classe: NAO_RECURSO,
    motivo: 'FALSO POSITIVO DECLARADO, irmão do de `mergeMaps`. A interpolação percorre '
      + '`TABELA_POR_SUPERFICIE`, uma constante do módulo com as OITO tabelas de entidade de atlas '
      + '(maps, layers, groups, features, briefings, slides e as duas de 3D/360 de mapa), nenhuma '
      + 'delas de catálogo, de projeto 360 ou de modelo 3D. A consulta lê SÓ a coluna `id`, e só '
      + 'dos ids que o próprio payload de import trouxe, para saber quais já estão ocupados e '
      + 'recunhá-los. Nada dela sai no corpo: o que volta ao cliente é a CONTAGEM `remappedIds` no '
      + 'summary. Não há superfície de conteúdo a recortar.',
  },
];

/**
 * @typedef {Object} EntradaDeRota
 * @property {string} arquivo
 * @property {string} rota - `GET caminho`, como a varredura a encontra.
 * @property {R_FILTRADA|R_PUBLICA|R_OUTRA} classe
 * @property {string} gate - Símbolo que precisa aparecer na declaração da rota (ou num `router.use`).
 * @property {string} motivo
 */

const CONTEUDO_DE_ATLAS = 'Conteúdo colaborativo de atlas, não recurso de catálogo: o alcance é '
  + 'decidido pela escada de permissão do atlas (read < comment < write < manage < owner), nunca '
  + 'por concessão de recurso. Um recurso emprestado a este atlas não sai por aqui.';
const SO_ADMIN = 'Superfície de ADMINISTRAÇÃO do sistema, atrás de `requireAdmin`. Não serve recurso '
  + 'de catálogo, 360 nem 3D, e o credenciado (que lê todo recurso privado) leva 403 aqui.';
const IDENTIDADE = 'Superfície de IDENTIDADE, sobre a própria conta ou o cadastro de apoio '
  + '(organizações, postos). Não serve recurso de catálogo, 360 nem 3D.';
const LEITURA_360 = 'Leitura do 360 sob `flexibleAuth` (anônimo é caso normal). O recorte mora no '
  + 'SQL, e o `?atlasId=` opcional passa por `requireAtlasScopeWhenPresent`, que roda o '
  + '`requireAtlasPermission(read)` de verdade: saber o UUID do atlas não autoriza nada.';

/** @type {EntradaDeRota[]} */
const CENSO_ROTA = [
  // ---------------- atlas ---------------------------------------------------
  { arquivo: 'src/modules/atlas/atlas.routes.js', rota: 'GET /', classe: R_OUTRA, gate: 'auth', motivo: CONTEUDO_DE_ATLAS },
  { arquivo: 'src/modules/atlas/atlas.routes.js', rota: 'GET /trash', classe: R_OUTRA, gate: 'auth', motivo: CONTEUDO_DE_ATLAS },
  // A busca do administrador no acervo inteiro devolve LINHAS DE ATLAS, não recurso de catálogo:
  // mesmo conteúdo das demais listagens deste módulo, com o recorte trocado (o sistema todo, em
  // vez de posse ou share). Quem a fecha é `requireAdmin` mais o piso de dois caracteres do
  // schema, que é o que impede a rota de virar despejo do acervo.
  { arquivo: 'src/modules/atlas/atlas.routes.js', rota: 'GET /admin/search', classe: R_OUTRA, gate: 'requireAdmin', motivo: CONTEUDO_DE_ATLAS },
  { arquivo: 'src/modules/atlas/atlas.routes.js', rota: 'GET /overview', classe: R_OUTRA, gate: 'auth', motivo: CONTEUDO_DE_ATLAS },
  { arquivo: 'src/modules/atlas/atlas.routes.js', rota: 'GET /presence', classe: R_OUTRA, gate: 'auth', motivo: CONTEUDO_DE_ATLAS },
  { arquivo: 'src/modules/atlas/atlas.routes.js', rota: 'GET /:atlasId', classe: R_OUTRA, gate: 'requireAtlasPermission', motivo: CONTEUDO_DE_ATLAS },
  { arquivo: 'src/modules/atlas/atlas.routes.js', rota: 'GET /:atlasId/settings', classe: R_OUTRA, gate: 'requireAtlasPermission', motivo: CONTEUDO_DE_ATLAS },
  {
    arquivo: 'src/modules/atlas/atlas.routes.js', rota: 'GET /public/:link', classe: R_OUTRA,
    gate: 'publicLinkLimiter',
    motivo: 'A porta do visitante de LINK PÚBLICO: troca um link por um token confinado àquele '
      + 'atlas. Não serve recurso; é ela que dá ao visitante o crachá com que ele pode, depois, '
      + 'alcançar o que aquele atlas empresta.',
  },
  {
    arquivo: 'src/modules/atlas/atlas.routes.js', rota: 'GET /:atlasId/resources', classe: R_OUTRA,
    gate: 'requireAtlasPermission',
    motivo: 'Devolve o INVENTÁRIO emprestado ao atlas a quem tem `read`, inclusive os itens que '
      + 'aquele leitor não enxerga — e isso é deliberado e documentado na rota: a lista é o '
      + 'inventário do atlas, não o conteúdo do recurso. Nenhum byte de recurso sai por aqui, e '
      + 'quem quiser o conteúdo passa pela superfície do recurso, que filtra. DESDE 2026-08-29 '
      + 'ela devolve TAMBÉM `name` e `access_level` de cada item, e esta linha dizia "os IDS" '
      + 'antes disso: os dois campos alimentam a cláusula 6.6 (ao ativar o link público, a tela '
      + 'NOMEIA os privados que o atlas empresta), e o que eles acrescentam é METADADO, não '
      + 'conteúdo. Nulos no empréstimo órfão, que continua na lista de propósito.',
  },

  // ---------------- catálogo ------------------------------------------------
  {
    arquivo: 'src/modules/catalog/catalog.routes.js', rota: 'GET /', classe: R_FILTRADA, gate: 'requireAtlasScopeWhenPresent',
    motivo: 'A listagem crua de qualquer das quatro tabelas de catálogo, montada quatro vezes por '
      + '`createCatalogRouter`. O recorte é o `accessPredicate` do serviço, e o `?atlasId=` traz o '
      + 'braco de emprestimo, GATEADO: `fn_granted_resource_ids` casa `ar.atlas_id` e nao confere '
      + 'participacao, entao sem o gate saber o UUID de um atlas entregava o que ele empresta.',
  },
  {
    arquivo: 'src/modules/catalog/catalog.routes.js', rota: 'GET /:id', classe: R_FILTRADA, gate: 'requireAtlasScopeWhenPresent',
    motivo: 'O item por id, com o MESMO gate da listagem e 404 (nunca 403) para o que o chamador não '
      + 'enxerga. Foi a rota que vazava recurso privado pelo id depois de ele sumir da lista.',
  },
  {
    arquivo: 'src/modules/catalog/catalog.routes.js', rota: 'GET /:id/references', classe: R_FILTRADA,
    gate: 'produtor',
    motivo: 'Quantos atlas guardam uma referência a este recurso, para a confirmação de exclusão '
      + 'dizer o número. A EXISTÊNCIA é gateada por fn_can_produce_resource dentro do WHERE, igual '
      + 'ao DELETE que ela precede, então linha de outra OM devolve 404 e não uma contagem. O corpo '
      + 'é só quantidade por superfície: nenhum nome ou id de atlas atravessa, o que importa porque '
      + 'a lista de atlas que citam um recurso seria metadado de quem o usa.',
  },

  // ---------------- vídeo de prévia hospedado --------------------------------
  {
    arquivo: 'src/modules/catalog-video/catalog-video.routes.js', rota: 'GET /:file', classe: R_PUBLICA,
    gate: 'flexibleAuth',
    motivo: 'Serve os bytes do vídeo de prévia hospedado, PÚBLICO-POR-URL: o nome do arquivo carrega '
      + 'um token de 16 bytes aleatórios, e a URL só chega a quem VÊ o recurso (config público, ou o '
      + 'payload aditivo do privado). O RISCO é o de um link de capacidade: quem tem a URL busca o '
      + 'arquivo, como no link público de atlas. Não há gate por recurso aqui de propósito, porque o '
      + 'token é o segredo; um gate por tipo exigiria mapear o arquivo de volta ao recurso, e o '
      + 'vídeo de prévia não justifica isso.',
  },

  // ---------------- config: o documento de boot ------------------------------
  {
    arquivo: 'src/modules/config/config.routes.js', rota: 'GET /', classe: R_PUBLICA, gate: 'router',
    motivo: 'O documento de BOOT, público e sem autenticação por contrato congelado: o app é '
      + 'fail-fast nele e roda anônimo. O RISCO é o de qualquer coisa publicada — tudo o que entra '
      + 'aqui é mundial —, e o que o contém é o `accessPredicate` fechar por padrão: sem principal, '
      + 'só recurso `public` entra no payload.',
  },
  { arquivo: 'src/modules/config/config.routes.js', rota: 'GET /admin', classe: R_OUTRA, gate: 'requireAdmin', motivo: SO_ADMIN },

  // ---------------- acesso a recurso privado ---------------------------------
  {
    arquivo: 'src/modules/resource-access/resource-access.routes.js', rota: 'GET /visible',
    classe: R_FILTRADA, gate: 'requireAtlasScopeWhenPresent',
    motivo: 'O payload ADITIVO: o que o chamador enxerga de PRIVADO, por concessão pessoal ou por '
      + 'empréstimo do atlas em foco. É a superfície que existe justamente porque o /api/config é '
      + 'um documento único e público.',
  },
  {
    arquivo: 'src/modules/resource-access/resource-access.routes.js', rota: 'GET /grants/issued',
    classe: R_FILTRADA, gate: 'auth',
    motivo: 'O inventário do que ESTE chamador concedeu. Não serve o recurso, mas serve o NOME dele '
      + '(o cartão precisa dizer de que acesso se trata), então o corpo carrega nome de recurso '
      + 'privado e varia por chamador. O recorte não é um middleware e sim a CONSULTA: '
      + '`granted_by = $1` sobre o id do token, sem parâmetro por onde apontar para terceiro.',
  },
  {
    arquivo: 'src/modules/resource-access/resource-access.routes.js', rota: 'GET /grants/received',
    classe: R_FILTRADA, gate: 'auth',
    motivo: 'O espelho da de cima: o que ESTE chamador recebeu, pelos DOIS caminhos (direto e por '
      + 'grupo). O recorte mora na consulta e é termo a termo o dos braços de concessão de '
      + '`fn_granted_resource_ids`, prazo e vida do concedente inclusive, para que ela não liste '
      + 'como vivo um acesso que o predicado de leitura já não entrega.',
  },
  {
    arquivo: 'src/modules/resource-access/resource-access.routes.js', rota: 'GET /:type/:id/grants',
    classe: R_OUTRA, gate: 'requireResourceShare',
    motivo: 'Metadado de COMPARTILHAMENTO (quem concedeu a quem, e até quando), não o recurso. Sai '
      + 'só para quem pode compartilhar aquele recurso, que é uma autoridade mais estreita que vê-lo.',
  },
  {
    arquivo: 'src/modules/resource-access/resource-access.routes.js',
    rota: 'GET /:type/:id/lending-atlases', classe: R_OUTRA, gate: 'requireResourceShare',
    motivo: 'QUANTOS atlas emprestam este recurso, e nada mais: um inteiro. Não serve o recurso e '
      + 'não serve nem a identidade dos atlas — o serviço conta a lista e descarta os ids, porque '
      + 'quem pode compartilhar um recurso não herda por isso o direito de enumerar os projetos '
      + 'alheios que o usam. O gate é o MESMO da listagem de concessões logo acima, e a razão é a '
      + 'comparação: aquela nomeia pessoas e grupos, esta devolve um número, então barrar aqui quem '
      + 'passa lá seria recortar o que entrega estritamente menos.',
  },

  // ---------------- grupo de acesso -------------------------------------------
  // Nenhuma das TRÊS serve recurso: elas servem o VOCABULÁRIO de quem recebe. O eixo
  // do módulo deixou de ser papel global e passou a ser POSSE em 2026-08-20, e o
  // desenho das três está por extenso no cabeçalho de `access-groups.routes.js`.
  {
    arquivo: 'src/modules/access-groups/access-groups.routes.js', rota: 'GET /',
    classe: R_OUTRA, gate: 'auth',
    motivo: 'Os grupos que o CHAMADOR administra (id, nome, descrição e duas contagens), sem nomear '
      + 'pessoa nenhuma. `auth` sozinho porque o recorte mora na CONSULTA: a resposta já é, por '
      + 'construção, o que ele administra (`fn_can_administer_group`), e o administrador do '
      + 'sistema vê todos pelo ramo curinga. É ela que alimenta o seletor do modal de '
      + 'compartilhar, e recortá-la é a metade visível da regra do coletivo próprio — a outra '
      + 'metade é o mesmo predicado dentro do `WHERE` de `GET_ADDRESSABLE_LIVE_GROUP`, sem o qual '
      + 'restringir a listagem seria só obscuridade.',
  },
  {
    arquivo: 'src/modules/access-groups/access-groups.routes.js', rota: 'GET /participating',
    classe: R_OUTRA, gate: 'auth',
    motivo: 'Os grupos de que o chamador PARTICIPA, com o nome do DONO e nada mais. Ela existe '
      + 'porque, com a listagem acima recortada por posse, quem foi posto num grupo por outra '
      + 'pessoa deixaria de ver em lugar nenhum um mecanismo que decide o acesso dele a recurso '
      + 'privado. NÃO devolve roster nem contagens: quem participa vê QUE participa e a quem '
      + 'reclamar, não quem mais está dentro nem o tamanho do acervo que o grupo recebeu.',
  },
  {
    arquivo: 'src/modules/access-groups/access-groups.routes.js', rota: 'GET /:groupId/members',
    classe: R_OUTRA, gate: 'requireGroupAuthority',
    motivo: 'O roster de pessoas de um grupo, e por isso ele fica do lado FECHADO junto com a '
      + 'escrita: nome de grupo é vocabulário organizacional e serve ao seletor; quem está dentro '
      + 'dele o seletor não precisa saber, e a contagem que `LIST_GROUPS` já devolve basta para a '
      + 'tela dizer "Estado-Maior (12)". O gate deixou de ser papel global e passou a ser posse: '
      + 'o dono vivo, ou o administrador do sistema, com 404 (nunca 403) para o resto.',
  },

  // ---------------- gazetteer e modelos 3D ------------------------------------
  {
    arquivo: 'src/modules/nomes/nomes.routes.js', rota: 'GET /busca', classe: R_FILTRADA,
    gate: 'validate',
    motivo: 'A busca do gazetteer, contrato congelado de array nu. Ela entra no censo SEM filtro de '
      + 'acesso, e isso é DECLARAÇÃO e não omissão: o eixo de privacidade do gazetteer '
      + '(access_level mais as zonas geográficas) foi REMOVIDO em 2026-08-19 por ser sistema '
      + 'antigo, com API de admin e nenhuma tela. Busca de topônimo não tem restrição. Quem for '
      + 'reintroduzir filtro aqui está ressuscitando aquilo.',
  },
  {
    arquivo: 'src/modules/nomes/assets3d.routes.js', rota: 'GET /*', classe: R_FILTRADA,
    gate: 'gateDeAsset3d',
    motivo: 'OS BYTES do modelo 3D. Era a entrada PÚBLICA deste censo, com o RISCO escrito («a '
      + 'descoberta é gateada pelo catálogo autenticado», que com tileset privado é segurança por '
      + 'obscuridade), e a fase F11 a fechou: o regime segue o RECURSO e não a rota. Modelo público '
      + 'continua 200 sem credencial e `public, immutable`; modelo privado passa por '
      + '`gateDeAsset3d`, que compõe `requireAtlasPermission(read)` para o `?atlasId=` e '
      + '`fn_can_see_resource` para o recurso, e responde 404. O que resta aberto está NOMEADO em '
      + '`assets3d-regime.js` e não é alcançável por esta rota: o prefixo de catálogo servido por '
      + 'nginx (`/3d/…`). O segundo catálogo, que era o outro buraco nomeado ali, deixou de '
      + 'existir na F15.',
  },

  // ---------------- 360 -------------------------------------------------------
  { arquivo: 'src/modules/streetview360/sv360.routes.js', rota: 'GET /projects', classe: R_FILTRADA, gate: 'requireAtlasScopeWhenPresent', motivo: LEITURA_360 },
  { arquivo: 'src/modules/streetview360/sv360.routes.js', rota: 'GET /projects/:slug', classe: R_FILTRADA, gate: 'requireAtlasScopeWhenPresent', motivo: LEITURA_360 },
  { arquivo: 'src/modules/streetview360/sv360.routes.js', rota: 'GET /projects/review-stats', classe: R_FILTRADA, gate: 'requireAtlasScopeWhenPresent', motivo: LEITURA_360 },
  { arquivo: 'src/modules/streetview360/sv360.routes.js', rota: 'GET /projects/:slug/floors', classe: R_FILTRADA, gate: 'requireAtlasScopeWhenPresent', motivo: LEITURA_360 },
  { arquivo: 'src/modules/streetview360/sv360.routes.js', rota: 'GET /projects/:slug/photos', classe: R_FILTRADA, gate: 'requireAtlasScopeWhenPresent', motivo: LEITURA_360 },
  { arquivo: 'src/modules/streetview360/sv360.routes.js', rota: 'GET /projects/:slug/map', classe: R_FILTRADA, gate: 'requireAtlasScopeWhenPresent', motivo: LEITURA_360 },
  { arquivo: 'src/modules/streetview360/sv360.routes.js', rota: 'GET /projects/:slug/runs', classe: R_FILTRADA, gate: 'requireAtlasScopeWhenPresent', motivo: LEITURA_360 },
  {
    arquivo: 'src/modules/streetview360/sv360.routes.js', rota: 'GET /tiles/:z/:x/:y.pbf',
    classe: R_FILTRADA, gate: 'requireAtlasScopeWhenPresent',
    motivo: `${LEITURA_360} O tile gateia DUAS camadas, e a de linha já desenhou a trajetória de um `
      + 'projeto privado enquanto os pontos sumiam.',
  },
  { arquivo: 'src/modules/streetview360/sv360.routes.js', rota: 'GET /tiles/fotos.geojson', classe: R_FILTRADA, gate: 'requireAtlasScopeWhenPresent', motivo: LEITURA_360 },
  {
    arquivo: 'src/modules/streetview360/sv360.routes.js', rota: 'GET /thumbnails/:slug.webp',
    classe: R_FILTRADA, gate: 'requireAtlasScopeWhenPresent',
    motivo: `${LEITURA_360} Ela serve BYTES, então o escopo de cache dela também é decidido pelos `
      + 'dois eixos, e não só por `status`.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.routes.js', rota: 'GET /photos/:uuid',
    classe: R_FILTRADA, gate: 'requireAtlasScopeWhenPresent',
    motivo: `${LEITURA_360} Uma das CINCO rotas de foto que não tinham eixo de privacidade nenhum `
      + 'até a fase F9.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.routes.js', rota: 'GET /photos/by-name/:nome',
    classe: R_FILTRADA, gate: 'requireAtlasScopeWhenPresent',
    motivo: `${LEITURA_360} O nome colide entre projetos, então o predicado precisa estar no WHERE e `
      + 'não no desempate.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.routes.js', rota: 'GET /photos/:uuid/tiles.json',
    classe: R_FILTRADA, gate: 'requireAtlasScopeWhenPresent',
    motivo: `${LEITURA_360} O descritor da pirâmide: diz que a foto existe, o tamanho nativo dela e `
      + 'quantos níveis tem. Sem predicado, seria um oráculo de existência do acervo restrito, '
      + 'mesmo sem entregar um pixel.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.routes.js', rota: 'GET /photos/:uuid/tiles/:level/:x/:y',
    classe: R_FILTRADA, gate: 'requireAtlasScopeWhenPresent',
    motivo: `${LEITURA_360} Esta serve os BYTES, como a de imagem: desde a poda dos blobs na origem, `
      + 'é por aqui que a panorâmica inteira sai, um tile por vez.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.routes.js', rota: 'GET /photos/nearest',
    classe: R_FILTRADA, gate: 'requireAtlasScopeWhenPresent',
    motivo: `${LEITURA_360} Esta é a que dispensa identificador: a resposta vem de um par lon/lat, `
      + 'então sem predicado bastava clicar perto do acervo restrito para recebê-lo.',
  },
  { arquivo: 'src/modules/streetview360/sv360.routes.js', rota: 'GET /photos/:uuid/nearby', classe: R_FILTRADA, gate: 'requireAtlasScopeWhenPresent', motivo: LEITURA_360 },
  {
    arquivo: 'src/modules/streetview360/sv360.routes.js', rota: 'GET /admin/projects',
    classe: R_FILTRADA, gate: 'auth',
    motivo: 'A listagem ADMINISTRATIVA do 360, recortada por PRODUÇÃO (`fn_can_produce_resource`) e '
      + 'não por acesso a dado — quem mantém o acervo vê o que mantém. `auth` estrito, não '
      + '`flexibleAuth`.',
  },

  // ---------------- conteúdo de atlas ----------------------------------------
  { arquivo: 'src/modules/briefings/briefings.routes.js', rota: 'GET /', classe: R_OUTRA, gate: 'requireAtlasPermission', motivo: CONTEUDO_DE_ATLAS },
  { arquivo: 'src/modules/briefings/briefings.routes.js', rota: 'GET /:briefingId', classe: R_OUTRA, gate: 'requireAtlasPermission', motivo: CONTEUDO_DE_ATLAS },
  { arquivo: 'src/modules/images/images.routes.js', rota: 'GET /', classe: R_OUTRA, gate: 'requireAtlasPermission', motivo: CONTEUDO_DE_ATLAS },
  { arquivo: 'src/modules/images/images.routes.js', rota: 'GET /:imageId', classe: R_OUTRA, gate: 'requireAtlasPermission', motivo: CONTEUDO_DE_ATLAS },
  // AS DUAS ESTIVERAM CLASSIFICADAS AQUI POR ENGANO, e o engano é o caso que este censo existe
  // para pegar: elas eram `SELECT *` sobre `maps`, e `maps.catalog_layers` carregava a CÓPIA da
  // linha de catálogo (`config.source.url` inclusive) que a F11 tirou da leitura do snapshot mas
  // não daqui — a reidratação mora dentro de `getAtlasSnapshot` e estas rotas não passam por lá.
  // Medido em banco limpo: membro com share `read` e visitante de link público recebiam a URL de
  // camada privada pelas duas, e por uma terceira que este censo nem enxerga, porque a varredura
  // 2 só lê `router.get(` — `POST /:atlasId/maps/:mapId/duplicate` (`atlas.routes.js`), que
  // devolve a linha do mapa novo como corpo.
  //
  // A correção foi ESTRUTURAL, não um filtro nas respostas: a coluna saiu do schema, e as
  // três consultas passaram a listar colunas explicitamente. Um filtro protegeria as rotas que
  // alguém lembrou e deixaria a coluna de pé para a próxima consulta sobre `maps`.
  // São DOIS os pares de comportamento, e a divisão é de propósito:
  // `tests/integration/catalog-layer-coluna-legada.test.js` mede a saída da coluna pelo lado do
  // schema e da materialização, e alcança as TRÊS superfícies, a que não cabe neste censo
  // inclusive; `tests/integration/catalog-layer-rota-de-mapas.repro.test.js` reproduz a SONDA,
  // com os principais dela (visitante anônimo de link público e membro com share `read`) e a
  // coluna replantada e carregada, que é o que faz o caso ficar vermelho contra o código antigo.
  { arquivo: 'src/modules/maps/maps.routes.js', rota: 'GET /', classe: R_OUTRA, gate: 'requireAtlasPermission', motivo: CONTEUDO_DE_ATLAS },
  { arquivo: 'src/modules/maps/maps.routes.js', rota: 'GET /:mapId', classe: R_OUTRA, gate: 'requireAtlasPermission', motivo: CONTEUDO_DE_ATLAS },
  { arquivo: 'src/modules/sharing/sharing.routes.js', rota: 'GET /', classe: R_OUTRA, gate: 'requireAtlasPermission', motivo: CONTEUDO_DE_ATLAS },
  {
    arquivo: 'src/modules/sync/sync.routes.js', rota: 'GET /:version', classe: R_FILTRADA,
    gate: 'requireAtlasPermission',
    motivo: `${CONTEUDO_DE_ATLAS} E DESDE A FASE F11 ELA TAMBÉM SERVE RECURSO, com filtro: as camadas `
      + 'de catálogo do mapa viajam como REFERÊNCIA, e o snapshot reidrata a definição (nome e '
      + '`config`, URL inclusive) pelo predicado do chamador. Este buraco esteve NOMEADO aqui por uma '
      + 'fase, e o teto declarado estava errado por baixo: dizia "a todo membro", quando o alcance '
      + 'real era o visitante de link público — `resolvePermission` devolve `read` para userId NULO em '
      + 'atlas `is_public`, e a op nunca passava perto de um gate de recurso. O par de comportamento '
      + 'é `tests/integration/sync-catalog-layer-privado.test.js`. '
      + 'A ROTA TEM DOIS RAMOS, e por uma fase só um estava fechado. Com `version = 0` (ou atrás de '
      + '`min_version`) ela devolve o SNAPSHOT, que reidrata; com version > 0 ela devolve o LOG DE '
      + 'OPERAÇÕES, que `INSERT_OPERATION` grava com a carga do cliente verbatim e que a reidratação '
      + 'nunca vê. O teto declarado aqui até a F12 dizia que só a linha PRÉ-PREFIXO restava, e estava '
      + 'errado por baixo de novo: o ramo incremental entregava a definição em qualquer formato, o '
      + 'ATUAL inclusive, que é o caso comum. E ele não é exótico — `ws-client.js` dispara '
      + '`requestSync(lastVersion)` e o log não expira sozinho (a limpeza só é alcançável por rota de '
      + 'administrador). A F12 fechou os dois: a definição é PODADA na saída do log '
      + '(`sync/catalog-layer-op.js`, no pull incremental e no relay), e a resolução da referência '
      + 'passou a ler os TRÊS carregadores do cliente (prefixo do id, `originalId`, `config.id`), '
      + 'preservando a referência ao podar — que era o que faltava para a linha pré-prefixo. Pares de '
      + 'comportamento: `tests/unit/catalog-layer-op-poda.test.js` e o último caso de '
      + '`tests/integration/catalog-layer-cadeia-de-vazamento.test.js`. NÃO HÁ TETO DECLARADO AQUI.',
  },

  {
    arquivo: 'src/modules/debug/debug.routes.js', rota: 'GET /trace', classe: R_OUTRA,
    gate: 'requireAtlasPermission',
    motivo: 'O anel do SyncLedger, montado só com o tracer ligado e NUNCA em produção (conjunção no '
      + 'ponto de montagem). É diagnóstico por atlas, gateado por atlas, e não serve recurso.',
  },

  // ---------------- administração e identidade -------------------------------
  {
    arquivo: 'src/modules/audit/audit.routes.js', rota: 'GET /', classe: R_OUTRA, gate: 'requireAuditReader',
    motivo: 'A trilha de auditoria, e ela DEIXOU DE SER só-admin em 2026-08-21: o gate tem dois '
      + 'ramos (administrador, irrestrito; produtor, RECORTADO na própria OM) e o recorte é imposto '
      + 'no serviço a partir de `req.auditScope`, nunca lido da query string. Continua R_OUTRA '
      + 'porque não serve recurso de catálogo, 360 nem 3D — ela serve o REGISTRO de atos sobre eles, '
      + 'e por isso não entra em CENSO_REGIME (aquela lista é bicondicional com as rotas '
      + '`recurso-com-filtro`, e pôr esta ali exigiria reclassificá-la como se servisse recurso, o '
      + 'que trocaria uma prosa sem guarda por uma classificação errada). A resposta passou a VARIAR '
      + 'por chamador, então o controller marca escopo de cache, como as listagens de catálogo — e '
      + 'ISSO NÃO É PROSA: o cabeçalho `private` é asserido, com a discriminação de uma rota vizinha '
      + 'que não o marca, em `tests/integration/auditoria-gate.test.js`. Sem aquele caso, apagar o '
      + '`marcarEscopoJson` do controller reporia a trilha do administrador para um produtor num '
      + 'cache compartilhado e a suíte inteira continuaria verde (medido).',
  },
  {
    arquivo: 'src/modules/diag/diag.routes.js', rota: 'GET /erros', classe: R_OUTRA, gate: 'requireAdmin',
    motivo: `${SO_ADMIN} O que ela serve é AGREGAÇÃO do log em arquivo (assinatura, contagem, `
      + 'percentil), e o diretório é decidido pelo servidor: não existe `?dir=`, justamente para que '
      + 'a rota não vire leitor de arquivo arbitrário atrás de um gate de administrador.',
  },
  { arquivo: 'src/modules/diag/diag.routes.js', rota: 'GET /lento', classe: R_OUTRA, gate: 'requireAdmin', motivo: SO_ADMIN },
  { arquivo: 'src/modules/diag/diag.routes.js', rota: 'GET /status', classe: R_OUTRA, gate: 'requireAdmin', motivo: SO_ADMIN },
  {
    arquivo: 'src/modules/diag/diag.routes.js', rota: 'GET /erros-cliente', classe: R_OUTRA, gate: 'requireAdmin',
    motivo: `${SO_ADMIN} Serve \`client_errors\`, a telemetria de erro do NAVEGADOR. As linhas não `
      + 'carregam id de catálogo, 360 nem 3D: carregam mensagem, pilha e a página em que o defeito '
      + 'apareceu. O `atlas_id` que elas guardam é contexto sem FK, não referência de recurso.',
  },
  { arquivo: 'src/modules/sync/sync.routes.js', rota: 'GET /admin/stats', classe: R_OUTRA, gate: 'requireAdmin', motivo: SO_ADMIN },
  { arquivo: 'src/modules/users/users.routes.js', rota: 'GET /', classe: R_OUTRA, gate: 'requireAdmin', motivo: SO_ADMIN },
  { arquivo: 'src/modules/users/users.routes.js', rota: 'GET /:userId', classe: R_OUTRA, gate: 'requireAdmin', motivo: SO_ADMIN },
  { arquivo: 'src/modules/auth/auth.routes.js', rota: 'GET /me', classe: R_OUTRA, gate: 'auth', motivo: IDENTIDADE },
  {
    arquivo: 'src/modules/auth/auth.routes.js', rota: 'GET /tile-access', classe: R_OUTRA,
    gate: 'requireTileAccess',
    motivo: 'O `auth_request` do nginx para as rotas do servidor de tiles (cláusula 10.7). Ele '
      + 'continua R_OUTRA porque NÃO SERVE recurso nenhum: a resposta é vazia nos dois desfechos, '
      + 'e quem entrega os bytes é o servidor de tiles, atrás do proxy, sem passar por este '
      + 'processo. O que ele faz é DECIDIR, e desde 2026-08-29 ele decide POR RECURSO: recebe o '
      + 'caminho pedido em `X-Original-URI`, resolve-o contra o índice de catálogo '
      + '(`tile-regime.js`) e, quando a linha é privada, chama o MESMO `fn_can_see_resource` do '
      + 'resto do acervo, memoizado por (chamador, empréstimo, recurso). '
      + 'ESTE MOTIVO DESCREVIA O DESENHO ANTERIOR ATÉ AQUELA DATA, e a diferença é grande o '
      + 'bastante para ficar registrada: ele dizia que o endpoint "responde sobre a CREDENCIAL e '
      + 'nunca sobre a CAMADA", que "não recebe o caminho do tile" e que "um usuário comum com '
      + 'chave viva alcança os bytes de uma camada privada que o catálogo não lhe mostra". As três '
      + 'frases eram verdadeiras e deixaram de ser; a última foi MEDIDA em '
      + '`dev/tile-privado/scripts/confere-martin-nginx.sh` antes de o dono decidir fechar. '
      + 'DUAS PROPRIEDADES QUE NÃO SE ADIVINHAM. O caminho que NENHUMA linha de catálogo '
      + 'reivindica é RECUSADO, invertendo a regra do irmão do 3D, onde ele é público: aqui o '
      + 'endereço é texto livre digitado à mão e serão centenas de camadas, então um erro de '
      + 'digitação numa linha privada publicaria os bytes em silêncio. E a linha PÚBLICA é '
      + 'liberada SEM CREDENCIAL NENHUMA, o que devolve o visitante anônimo e o cache de borda '
      + 'do público. Comportamento em `tests/integration/tile-access-auth-request.test.js`.',
  },
  { arquivo: 'src/modules/users/users.routes.js', rota: 'GET /me', classe: R_OUTRA, gate: 'auth', motivo: IDENTIDADE },
  {
    arquivo: 'src/modules/users/users.routes.js', rota: 'GET /me/api-keys', classe: R_OUTRA, gate: 'auth',
    motivo: `${IDENTIDADE} É a lista das chaves de API da própria conta, e ela NÃO devolve o segredo `
      + '(`LIST_API_KEYS` não seleciona a coluna): o valor sai uma vez, na resposta da emissão. Uma '
      + 'listagem que o devolvesse faria de toda leitura de perfil um vazamento de credencial.',
  },
  {
    arquivo: 'src/modules/users/users.routes.js', rota: 'GET /:userId/api-keys', classe: R_OUTRA, gate: 'requireAdmin',
    motivo: `${SO_ADMIN} Mesma listagem sem segredo da rota de auto-serviço, para a contenção de `
      + 'incidente: o administrador vê e revoga a chave alheia, e não emite nenhuma.',
  },
  {
    arquivo: 'src/modules/users/users.routes.js', rota: 'GET /search', classe: R_OUTRA, gate: 'auth',
    motivo: `${IDENTIDADE} É a busca que alimenta o seletor de beneficiário ao conceder acesso, e o `
      + 'escopo dela é cobrado por `users-search-scope.test.js`.',
  },
  { arquivo: 'src/modules/organizations/organizations.routes.js', rota: 'GET /', classe: R_OUTRA, gate: 'auth', motivo: IDENTIDADE },
  { arquivo: 'src/modules/organizations/organizations.routes.js', rota: 'GET /:id', classe: R_OUTRA, gate: 'auth', motivo: IDENTIDADE },
  {
    arquivo: 'src/modules/organizations/organizations.routes.js', rota: 'GET /:id/deactivation-impact',
    classe: R_OUTRA, gate: 'requireAdmin',
    motivo: 'Três contagens sobre a OM (contas lotadas, contas que produzem por ela, itens de '
      + 'catálogo que ela mantém), para a confirmação de desativação dizer o que o ato derruba. '
      + 'Toca as tabelas de recurso apenas para CONTAR linhas de owner_org_id/organization_id: '
      + 'nenhum id, nome ou config de recurso sai no corpo, então não há superfície de conteúdo a '
      + 'recortar. O que a fecha é requireAdmin.',
  },
  { arquivo: 'src/modules/ranks/ranks.routes.js', rota: 'GET /', classe: R_OUTRA, gate: 'auth', motivo: IDENTIDADE },
  { arquivo: 'src/modules/ranks/ranks.routes.js', rota: 'GET /:id', classe: R_OUTRA, gate: 'auth', motivo: IDENTIDADE },
];

/**
 * @typedef {Object} EntradaDeCache
 * @property {string} arquivo
 * @property {string} trecho - Pedaço CONTIDO na linha; disjunto dos outros do mesmo arquivo.
 * @property {number} n
 * @property {C_CONDICIONAL|C_PRIVADO|C_PUBLICO_FIXO|C_SEM} classe
 * @property {string} motivo
 */

/** @type {EntradaDeCache[]} */
const CENSO_CACHE = [
  {
    arquivo: 'src/modules/streetview360/sv360.controller.js',
    trecho: "isPublic ? 'no-cache' : 'private, no-cache'", n: 1,
    classe: C_CONDICIONAL,
    motivo: 'O DESCRITOR da pirâmide, e o único regime deste módulo que NÃO é imutável: a escada se '
      + 'regera, então pregá-lo por um ano deixaria o cliente pedindo tiles de uma pirâmide que não '
      + 'existe mais. `no-cache` guarda e revalida, então em regime normal continua custando um 304. '
      + 'Os dois eixos (status + access_level) decidem `public` vs `private`, como na imagem.',
  },
  {
    arquivo: 'src/modules/config/config.controller.js', trecho: "'Cache-Control', 'no-cache'", n: 1,
    classe: C_SEM,
    motivo: 'O documento de boot é público e memoizado no servidor, mas o cliente precisa revalidar: '
      + 'um `/api/config` velho num navegador é um app apontando para catálogo que mudou.',
  },
  {
    arquivo: 'src/modules/atlas/atlas.controller.js',
    trecho: "'Cache-Control', 'private, no-cache'", n: 1, classe: C_PRIVADO,
    motivo: 'A revalidação de `GET /atlas/overview`. `private` SEMPRE, e não por eixo nenhum: o '
      + 'corpo é o acervo de projetos daquela conta, resolvido dentro da consulta pelo predicado de '
      + 'alcance, então não existe versão pública desta resposta para um cache compartilhado guardar. '
      + 'O `Vary: Authorization` da linha seguinte é o cinto do mesmo suspensório, para o proxy que '
      + 'ignora `private`. `no-cache` é "guarde e revalide", nunca "não guarde": é ele que faz o '
      + 'navegador mandar o `If-None-Match` que vira 304. E o 304 é o conserto, porque a resposta '
      + 'cheia carrega toda capa como data URI base64 (medido: 27,4 MB com 200 atlas de capa de '
      + '100 kB) e serializar isso trava o laço de eventos do processo inteiro.',
  },
  {
    arquivo: 'src/modules/images/images.controller.js',
    trecho: "'private, max-age=31536000, immutable'", n: 1, classe: C_PRIVADO,
    motivo: 'Imagem de atlas: sempre `private`, porque o alcance dela é a permissão do atlas e nunca '
      + 'o público. Imutável porque o id da imagem é imutável.',
  },
  {
    arquivo: 'src/modules/nomes/assets3d.controller.js', trecho: 'function setImmutableHeaders(',
    n: 1, classe: C_CONDICIONAL,
    motivo: 'Os bytes do modelo 3D. Esta entrada era `publico-fixo` e saía `public, immutable` sem '
      + 'eixo de acesso nenhum, porque a rota inteira era pública; a fase F11 fez o regime seguir o '
      + 'RECURSO. Modelo público continua `public, immutable`, que é o que torna o streaming por LOD '
      + 'viável; modelo privado sai `private, immutable` com `Vary`, cacheável no navegador e nunca '
      + 'num cache compartilhado. Mesmo desenho de `sv360.controller.js`, que tomou a decisão antes.',
  },
  {
    arquivo: 'src/modules/nomes/assets3d.controller.js',
    trecho: "'Cache-Control', privado ? IMMUTABLE_PRIVADO : IMMUTABLE", n: 1, classe: C_CONDICIONAL,
    motivo: 'A linha que grava o cabeçalho da entrada acima, e a que carrega a condição. Entra '
      + 'separada porque a contagem é o que discrimina remoção: apagar o ramo sem apagar a função '
      + 'devolveria o `public` fixo sem que nada mais mudasse de forma.',
  },
  {
    arquivo: 'src/modules/nomes/assets3d.controller.js', trecho: 'setImmutableHeaders(res, meta.etag',
    n: 1, classe: C_CONDICIONAL,
    motivo: 'A chamada no ramo do SQLite, que passa adiante o `privado` decidido por `gateDeAsset3d`. '
      + 'Sem esse argumento o ramo continuaria público, e o 304 deste caminho é justamente o que um '
      + 'cache compartilhado reporia para o chamador seguinte.',
  },
  {
    arquivo: 'src/modules/nomes/assets3d.controller.js',
    trecho: 'if (!documento) return setImmutableHeaders(', n: 1, classe: C_CONDICIONAL,
    motivo: 'A delegação do TILE de um modelo ao mesmo decisor imutável dos outros dois ramos, com '
      + 'o mesmo `privado`. Entra no censo porque é aqui que o tile poderia perder o eixo sem que a '
      + 'função delegada mudasse: passar `false` (ou omitir o argumento, que tem default) devolveria '
      + '`public, immutable` por um ano a um tile de modelo privado.',
  },
  {
    arquivo: 'src/modules/nomes/assets3d.controller.js',
    trecho: "privado ? 'private, no-cache' : 'public, no-cache'", n: 1, classe: C_CONDICIONAL,
    motivo: 'O DOCUMENTO de um modelo servido a partir de um `.3dtiles` POR MODELO, a camada que '
      + 'absorveu o serviço do repositório `ebgeo_3d`. É o único conteúdo desta rota que NÃO é '
      + 'imutável: uma reimportação troca a árvore inteira, e `immutable` deixaria o cliente '
      + 'pedindo por um ano tiles de uma geração que morreu. `no-cache` guarda e revalida, e o '
      + 'ETag derivado do token de geração faz a revalidação custar um 304 sem abrir o arquivo. '
      + 'O eixo público/privado continua sendo o do RECURSO, decidido por `gateDeAsset3d`.',
  },
  {
    arquivo: 'src/modules/nomes/assets3d.controller.js', trecho: 'setImmutableHeaders(res, fmeta.etag',
    n: 1, classe: C_CONDICIONAL,
    motivo: 'A chamada no ramo do FILESYSTEM, com o mesmo argumento e a mesma razão. As duas entram '
      + 'porque os dois ramos servem o mesmo recurso e um deles esquecer o eixo é invisível no outro.',
  },
  {
    arquivo: 'src/utils/cache-scope.js', trecho: "'private, no-cache'", n: 1,
    classe: C_CONDICIONAL,
    motivo: 'A ÚNICA definição de escopo de cache para resposta JSON que variou por chamador, e ela '
      + 'serve TRÊS superfícies: as rotas JSON do 360, as quatro listagens de catálogo e o payload '
      + 'aditivo de /resource-access/visible. Nenhuma das três emitia Cache-Control, o que autoriza '
      + 'cache heurístico — aceitável enquanto o corpo era igual para todos, e não depois que ele '
      + 'varia por concessão e por empréstimo. Nasceu no 360 e saiu de lá quando o mesmo buraco '
      + 'apareceu nas outras duas: uma terceira cópia da regra é como este defeito volta. '
      + '`no-cache` e não `no-store`, para preservar a revalidação pelo ETag do corpo.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.controller.js', trecho: '`private, max-age=${maxAge}`',
    n: 1, classe: C_CONDICIONAL,
    motivo: 'O ramo PRIVADO dos tiles: quando há principal OU atlas em foco, o corpo embute papel, '
      + 'escopo de produção e empréstimo, e um cache compartilhado o reporia para um anônimo.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.controller.js', trecho: '`public, max-age=${maxAge}`',
    n: 1, classe: C_CONDICIONAL,
    motivo: 'O ramo PÚBLICO do mesmo par. Ele existe porque o tile anônimo sem atlas em foco é '
      + 'idêntico para todo mundo, e é o que mantém o caminho anônimo barato.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.controller.js', trecho: 'function setImmutableHeaders(',
    n: 1, classe: C_CONDICIONAL,
    motivo: 'O decisor de escopo dos BYTES (imagem e miniatura), e ele tem DOIS eixos desde a fase '
      + 'F9: `status === enabled` sozinho marcava `public, immutable` a imagem de um projeto '
      + '`enabled + private`. Um recurso restrito entregue a cache compartilhado por um ano.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.controller.js',
    trecho: 'isPublic ? IMMUTABLE_PUBLIC : IMMUTABLE_PRIVATE', n: 2, classe: C_CONDICIONAL,
    motivo: 'A linha em que os dois eixos viram um cabeçalho. Entra separada da função porque é o '
      + 'ponto exato onde a conjunção pode virar disjunção sem ninguém notar. São DUAS ocorrências '
      + 'desde 2026-08-20, e o texto delas é idêntico de propósito: `setImmutableHeaders` serve a '
      + 'imagem e a miniatura, `setTileHeaders` serve o tile da pirâmide. Duas portas para o mesmo '
      + 'pixel, mesma regra de escopo; se um dia divergirem, é aqui que a contagem avisa.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.controller.js',
    trecho: "setImmutableHeaders(res, etag, 'image/webp'", n: 1, classe: C_CONDICIONAL,
    motivo: 'A chamada do caminho da MINIATURA do projeto, que é byte e por isso segue o mesmo '
      + 'regime da imagem.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.controller.js', trecho: "'no-store'", n: 2, classe: C_SEM,
    motivo: 'Os caminhos de ERRO do serviço de tile: nada do que eles devolvem pode ser guardado, '
      + 'porque a divergência entre Postgres e o arquivo SQLite é transitória e um 404 cacheado a '
      + 'tornaria permanente para aquele cliente. São DOIS desde o tiles-only (2026-08-29): o '
      + 'tile ausente, e o tile FORA DA ESCADA — este último é o único que não vem de divergência, '
      + 'e mesmo assim não se cacheia, porque a escada muda numa regeração e um 404 pregado no '
      + 'navegador sobreviveria à pirâmide nova. (A imagem inteira ausente saiu com a rota.)',
  },
  {
    arquivo: 'src/modules/catalog-video/catalog-video.controller.js',
    trecho: "'public, max-age=31536000, immutable'", n: 1, classe: C_PUBLICO_FIXO,
    motivo: 'O vídeo de prévia hospedado sai `public, immutable`, e é FIXO de propósito, não por '
      + 'descuido: o arquivo é público-por-URL (o token de 16 bytes no nome é a capacidade), então '
      + 'não há eixo de acesso a seguir como na imagem 360 ou no modelo 3D. O RISCO é o do link de '
      + 'capacidade — um cache compartilhado repõe o vídeo a quem tiver a URL —, e ele é aceito '
      + 'porque a URL só chega a quem já vê o recurso, e o conteúdo é uma prévia, não dado sensível. '
      + 'O token torna o arquivo único, então imutável é correto.',
  },
];

/**
 * @typedef {Object} EntradaDeRegime
 * @property {string} arquivo - O `*.routes.js`, como na varredura 2.
 * @property {string} rota - `GET caminho`, idem.
 * @property {string} handler - O nome que a rota monta; conferido contra a declaração.
 * @property {string} controller - O arquivo que DECLARA o handler (relativo a `backend/`).
 * @property {C_CONDICIONAL|C_PRIVADO|C_PUBLICO_FIXO|C_SEM|C_AUSENTE} classe
 * @property {string} [marcador] - Trecho exigido no CORPO do handler (proibido em C_AUSENTE).
 * @property {string} [motivo] - Obrigatório em C_AUSENTE, e precisa conter a palavra RISCO.
 */

const SV360_ROTAS = 'src/modules/streetview360/sv360.routes.js';
const SV360_CTRL = 'src/modules/streetview360/sv360.controller.js';
const M_JSON = 'marcarEscopoJson(';
const M_TILE = 'marcarEscopoDeTile(';
const M_BYTES = 'setImmutableHeaders(';
// A pirâmide NÃO usa `setImmutableHeaders`, e a divergência é de natureza, não de estilo.
// O descritor é metadado MUTÁVEL: a escada se regera, então ele sai `no-cache` (guarde e
// revalide) com validador, e nunca `immutable` — pregá-lo por um ano deixaria o cliente
// pedindo tiles de uma pirâmide que não existe mais. O TILE, esse sim, é imutável de
// verdade. Os dois decidem `public` vs `private` pelos MESMOS dois eixos da imagem
// (status + access_level), que é o que esta varredura cobra.
const M_PIRAMIDE_DESCRITOR = 'setPyramidDescriptorHeaders(';
const M_PIRAMIDE_TILE = 'setTileHeaders(';

/** Uma rota JSON do 360, que são onze e têm todas o mesmo regime. */
const json360 = (rota, handler) => ({
  arquivo: SV360_ROTAS, rota, handler, controller: SV360_CTRL, classe: C_CONDICIONAL, marcador: M_JSON,
});

/** @type {EntradaDeRegime[]} */
const CENSO_REGIME = [
  // ---------------- 360: JSON ------------------------------------------------
  json360('GET /projects', 'listProjects'),
  json360('GET /projects/:slug', 'getProject'),
  json360('GET /projects/review-stats', 'reviewStats'),
  json360('GET /projects/:slug/floors', 'getProjectFloors'),
  json360('GET /projects/:slug/photos', 'getProjectPhotos'),
  json360('GET /projects/:slug/map', 'getProjectMap'),
  json360('GET /projects/:slug/runs', 'getProjectRuns'),
  json360('GET /photos/:uuid', 'getPhoto'),
  json360('GET /photos/by-name/:nome', 'getPhotoByName'),
  json360('GET /photos/nearest', 'nearestPhoto'),
  json360('GET /photos/:uuid/nearby', 'nearbyPhotos'),

  // ---------------- 360: tiles e bytes ---------------------------------------
  {
    arquivo: SV360_ROTAS, rota: 'GET /tiles/:z/:x/:y.pbf', handler: 'mvtTile',
    controller: SV360_CTRL, classe: C_CONDICIONAL, marcador: M_TILE,
  },
  {
    arquivo: SV360_ROTAS, rota: 'GET /tiles/fotos.geojson', handler: 'tilesGeojson',
    controller: SV360_CTRL, classe: C_CONDICIONAL, marcador: M_TILE,
  },
  {
    arquivo: SV360_ROTAS, rota: 'GET /thumbnails/:slug.webp', handler: 'getThumbnail',
    controller: SV360_CTRL, classe: C_CONDICIONAL, marcador: M_BYTES,
  },
  {
    arquivo: SV360_ROTAS, rota: 'GET /photos/:uuid/tiles.json', handler: 'getPhotoPyramid',
    controller: SV360_CTRL, classe: C_CONDICIONAL, marcador: M_PIRAMIDE_DESCRITOR,
  },
  {
    arquivo: SV360_ROTAS, rota: 'GET /photos/:uuid/tiles/:level/:x/:y', handler: 'getPhotoTile',
    controller: SV360_CTRL, classe: C_CONDICIONAL, marcador: M_PIRAMIDE_TILE,
  },

  // ---------------- catálogo e payload aditivo -------------------------------
  {
    arquivo: 'src/modules/catalog/catalog.routes.js', rota: 'GET /', handler: 'list',
    controller: 'src/modules/catalog/catalog.controller.js', classe: C_CONDICIONAL, marcador: M_JSON,
  },
  {
    arquivo: 'src/modules/catalog/catalog.routes.js', rota: 'GET /:id', handler: 'get',
    controller: 'src/modules/catalog/catalog.controller.js', classe: C_CONDICIONAL, marcador: M_JSON,
  },
  {
    arquivo: 'src/modules/resource-access/resource-access.routes.js', rota: 'GET /visible',
    handler: 'visible', controller: 'src/modules/resource-access/resource-access.controller.js',
    classe: C_CONDICIONAL, marcador: M_JSON,
  },
  {
    arquivo: 'src/modules/resource-access/resource-access.routes.js', rota: 'GET /grants/issued',
    handler: 'grantsIssued', controller: 'src/modules/resource-access/resource-access.controller.js',
    classe: C_CONDICIONAL, marcador: M_JSON,
  },
  {
    arquivo: 'src/modules/resource-access/resource-access.routes.js', rota: 'GET /grants/received',
    handler: 'grantsReceived', controller: 'src/modules/resource-access/resource-access.controller.js',
    classe: C_CONDICIONAL, marcador: M_JSON,
  },

  {
    arquivo: 'src/modules/sync/sync.routes.js', rota: 'GET /:version', handler: 'pullOperations',
    controller: 'src/modules/sync/sync.controller.js', classe: C_CONDICIONAL, marcador: M_JSON,
  },

  // ---------------- os bytes do 3D ------------------------------------------
  {
    arquivo: 'src/modules/nomes/assets3d.routes.js', rota: 'GET /*', handler: 'serveAsset',
    controller: 'src/modules/nomes/assets3d.controller.js', classe: C_CONDICIONAL,
    marcador: 'setImmutableHeaders(',
  },

  // ---------------- os buracos, nomeados e com teto --------------------------
  {
    arquivo: 'src/modules/nomes/nomes.routes.js', rota: 'GET /busca', handler: 'busca',
    controller: 'src/modules/nomes/nomes.controller.js', classe: C_AUSENTE,
    motivo: 'A busca do gazetteer NÃO varia mais por chamador: o eixo de acesso do gazetteer saiu '
      + 'em 2026-08-19 e o corpo é o mesmo para todos, anônimo inclusive. O RISCO de cache '
      + 'heurístico que esta entrada nomeava morreu com ele, porque não há resposta escopada a '
      + 'repor. Continua sem `Cache-Control` por não ter ganho um, e isso agora é escolha de '
      + 'desempenho, não de segurança.',
  },
  {
    arquivo: SV360_ROTAS, rota: 'GET /admin/projects', handler: 'listProjects',
    controller: 'src/modules/streetview360/sv360.admin.controller.js', classe: C_AUSENTE,
    motivo: 'A listagem ADMINISTRATIVA do 360, recortada por PRODUÇÃO (`fn_can_produce_resource`): o '
      + 'corpo depende da OM do produtor e sai sem `Cache-Control`. O RISCO é o mesmo das três acima, '
      + 'com alcance menor (é `auth` estrito, então nenhum anônimo chega), e é o que a mantém como '
      + 'buraco declarado e não como isenção.',
  },
  {
    arquivo: 'src/modules/catalog/catalog.routes.js', rota: 'GET /:id/references',
    handler: 'references', controller: 'src/modules/catalog/catalog.controller.js',
    classe: C_AUSENTE,
    motivo: 'A contagem de atlas que referenciam um item de catálogo varia por chamador, porque a '
      + 'EXISTÊNCIA do item é recortada por `fn_can_produce_resource` (a mesma linha responde 404 '
      + 'para uma OM e uma contagem para outra), e sai sem `Cache-Control`. O RISCO é o da '
      + 'listagem administrativa do 360, logo acima, e menor em conteúdo: o corpo são inteiros por '
      + 'superfície, sem id nem nome de atlas, então um cache heurístico compartilhado vazaria '
      + 'QUANTIDADE e não identidade. É `auth` mais `produtor`, então nenhum anônimo chega. Fica '
      + 'como buraco declarado, e não como isenção, pela mesma razão das acima.',
  },
];

// ============================================================================
// AS VARREDURAS
// ============================================================================

/**
 * Remove comentário de bloco e de linha, preservando a contagem de linhas.
 *
 * A NORMALIZAÇÃO DE CRLF NÃO É COSMÉTICA: os arquivos deste repositório terminam em
 * `\r\n`, e em regex de JavaScript o `\r` é TERMINADOR DE LINHA, então `.` não o casa
 * e um `/\/\/.*$/` sem a flag `m` simplesmente não casa nada — a remoção rodaria e
 * devolveria o texto intacto, sem erro. É o molde de `papel-global-censo.test.js`, e
 * aquele arquivo cometeu esse defeito na primeira escrita.
 */
function semComentarios(src) {
  const normalizado = src.replace(/\r\n?/g, '\n');
  const semBloco = normalizado.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  return semBloco.split('\n').map((linha) => linha.replace(/\/\/.*/, '')).join('\n');
}

/**
 * O INVENTÁRIO: rastreado MAIS não rastreado não ignorado.
 *
 * `git ls-files src` sozinho lista só o que já passou por `git add`, e o ponto cego que
 * isso abre fica no pior lugar possível: o arquivo que a fase corrente acabou de
 * escrever é o que ainda não foi classificado, e era o único que a varredura não via. O
 * censo respondia verde sobre um inventário que não continha o trabalho novo — cobertura
 * vazia com cara de aprovação.
 *
 * `--others --exclude-standard` acrescenta o NÃO RASTREADO e mantém fora o IGNORADO
 * (`node_modules/`, `coverage/`, `data/`). As duas metades são MEDIDAS — a segunda pelo
 * caso-piso, a primeira pelo controle negativo do fim deste arquivo.
 * @param {string} [pathspec] - Relativo à raiz do pacote.
 * @returns {string[]} Caminhos relativos, só `.js`.
 */
function arquivosDoInventario(pathspec = 'src') {
  return execFileSync(
    'git', ['ls-files', '--cached', '--others', '--exclude-standard', pathspec],
    { cwd: RAIZ, encoding: 'utf8' }
  ).split('\n').map((s) => s.trim()).filter((s) => s.endsWith('.js'));
}

const lerCodigo = (arquivo) => semComentarios(fs.readFileSync(path.join(RAIZ, arquivo), 'utf8'));

/**
 * CONTATO COM UMA TABELA DE RECURSO. Larga de propósito: `FROM ${...}` casa qualquer
 * tabela interpolada, e é o preço de não perder uma interpolação de catálogo. O falso
 * positivo que isso produz fica DECLARADO no censo, com a classe NAO-RECURSO.
 */
const CONTATO = [
  /\b(?:FROM|JOIN|INTO|UPDATE)\s+sv360\.(?:projects|photos)\b/i,
  // O QUALIFICADOR DE SCHEMA É OPCIONAL, e essa metade faltava: `JOIN public.tilesets` não
  // casava, então uma consulta que qualificasse o schema ficava INVISÍVEL para o censo. O
  // buraco foi medido em 2026-08-23, quando três consultas de `models3d` (as que juntam o
  // registro de produção com a linha de catálogo) passaram sem classificação. Escrever
  // `public.` é estilo, não semântica: quem decide o que a consulta alcança é a tabela, e
  // o censo tem de vê-la das duas formas.
  /\b(?:FROM|JOIN|INTO|UPDATE)\s+(?:public\.)?(?:tilesets|data_layers|analysis_layers|basemaps)\b/i,
  /\bFROM\s+\$\{/,
  /\b(?:listCatalog|getCatalogItem)\(/,
  /\b(?:isProjectReadable|enforceProjectReadable|resolveReadableProject)\(/,
  // A LISTAGEM DO EIXO DE PRODUÇÃO entrou em 2026-08-20 e seria INVISÍVEL para as
  // duas linhas de cima: ela não nomeia tabela nenhuma (a função SQL o faz por ela) e
  // não interpola `FROM ${`. Somar o nome tem colateral zero — ele nasceu neste
  // commit e tem exatamente um chamador em `src/`.
  /\bfn_produced_private_resource_ids\(/,
  // O GATE FINO DE PRODUÇÃO, acrescentado em 2026-08-21 depois de uma revisão medir o
  // buraco: `setCatalogAccessLevel` escreve `UPDATE ${table}`, e nenhum dos padrões
  // acima alcança uma tabela interpolada num UPDATE (o `FROM ${` só pega leitura). O
  // irmão do 360 era visto porque nomeia `sv360.projects` por extenso — isto é, a
  // decisão de qual OM é a linha estava censada num tipo de recurso e invisível nos
  // outros quatro. Casar pelo nome do PREDICADO alcança a escrita interpolada sem
  // arrastar as escritas de entidade colaborativa (`sync.service.js`, `maps.service.js`)
  // que um `/UPDATE \$\{/ ` traria junto e que não são superfície de recurso.
  /\bfn_can_produce_resource\(/,
];

/**
 * DECLARAÇÃO DE UNIDADE: função ou constante SQL, NUNCA variável local.
 *
 * A restrição foi medida, não escolhida. Com `const` genérico, sete chamadas de
 * `enforceProjectReadable` espalhadas por sete funções de `sv360.service.js` caíam
 * todas numa "unidade" chamada `project` (o nome do `const` mais próximo), e o censo
 * deixava de distinguir a foto do projeto do mapa. Com esta lista, cada uma cai na
 * função a que pertence.
 */
const DECL = [
  /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*=/,
  /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/,
];

/**
 * Todo contato com tabela de recurso, agrupado por unidade.
 * @param {string[]} arquivos - Caminhos relativos a `backend/`.
 * @returns {Map<string, {arquivo: string, unidade: string, n: number, bloco: string, linhas: number[]}>}
 */
function unidadesDeContato(arquivos) {
  const achadas = new Map();
  for (const arquivo of arquivos) {
    const linhas = lerCodigo(arquivo).split('\n');
    const marcas = [];
    linhas.forEach((linha, i) => {
      for (const d of DECL) {
        const m = d.exec(linha);
        if (m) { marcas.push({ nome: m[1], i }); break; }
      }
    });
    linhas.forEach((linha, i) => {
      if (!CONTATO.some((re) => re.test(linha))) return;
      let ini = 0; let unidade = '(topo)';
      for (const m of marcas) { if (m.i <= i) { ini = m.i; unidade = m.nome; } else break; }
      let fim = linhas.length;
      for (const m of marcas) if (m.i > ini) { fim = m.i; break; }
      const chave = `${arquivo}::${unidade}`;
      if (!achadas.has(chave)) {
        achadas.set(chave, {
          arquivo, unidade, n: 0, linhas: [], bloco: linhas.slice(ini, fim).join('\n'),
        });
      }
      const alvo = achadas.get(chave);
      alvo.n += 1;
      alvo.linhas.push(i + 1);
    });
  }
  return achadas;
}

/** As unidades sem entrada no censo, no formato de mensagem de erro. */
function consultasNaoClassificadas(unidades) {
  return [...unidades.values()]
    .filter((u) => !CENSO_CONSULTA.some((e) => e.arquivo === u.arquivo && e.unidade === u.unidade))
    .map((u) => `${u.arquivo}:${u.linhas.join(',')} :: ${u.unidade}`);
}

const arquivosDeRota = () => arquivosDoInventario().filter((a) => a.endsWith('.routes.js'));

/**
 * Toda rota de LEITURA, com o texto da própria declaração e os middlewares de router.use.
 * @param {string[]} arquivos
 * @returns {{arquivo: string, rota: string, linha: number, bloco: string}[]}
 */
function rotasDeLeitura(arquivos) {
  const achadas = [];
  for (const arquivo of arquivos) {
    const src = lerCodigo(arquivo);
    const usos = [...src.matchAll(/router\.use\([^)]*\)/g)].map((m) => m[0]).join('\n');
    const re = /router\.get\(\s*(['"`])([^'"`]*)\1/g;
    let m = re.exec(src);
    while (m !== null) {
      const resto = src.slice(m.index);
      // Até a PRÓXIMA declaração de rota, que é o fim seguro do bloco: as declarações
      // multi-linha (a maioria das do 360) precisam entrar inteiras.
      const prox = resto.slice(1).search(/\brouter\.(get|post|put|patch|delete|use)\(/);
      const bloco = prox === -1 ? resto : resto.slice(0, prox + 1);
      achadas.push({
        arquivo,
        rota: `GET ${m[2]}`,
        linha: src.slice(0, m.index).split('\n').length,
        bloco: `${bloco}\n${usos}`,
      });
      m = re.exec(src);
    }
  }
  return achadas;
}

/** As rotas de leitura sem entrada no censo. */
function rotasNaoClassificadas(achadas) {
  return achadas
    .filter((a) => !CENSO_ROTA.some((e) => e.arquivo === a.arquivo && e.rota === a.rota))
    .map((a) => `${a.arquivo}:${a.linha} ${a.rota}`);
}

/** Toda linha que decide cache, por arquivo e linha. */
function sitiosDeCache(arquivos) {
  const achados = [];
  for (const arquivo of arquivos) {
    lerCodigo(arquivo).split('\n').forEach((linha, i) => {
      if (/Cache-Control|setImmutableHeaders\(/.test(linha)) {
        achados.push({ arquivo, n: i + 1, texto: linha.trim() });
      }
    });
  }
  return achados;
}

/**
 * O CORPO de uma declaração de topo (`function X`, `const X =`), da linha que a declara
 * até a próxima declaração de topo.
 *
 * Deliberadamente textual, e o limite é o mesmo do resto do arquivo: não é um parser. A
 * direção do erro é levar corpo A MAIS (até a próxima declaração), nunca de menos, o que
 * mantém a checagem de marcador conservadora e a de buraco estrita.
 * @param {string} codigo - Já sem comentário.
 * @param {string} nome
 * @returns {string|null}
 */
function corpoDeclarado(codigo, nome) {
  const linhas = codigo.split('\n');
  const abre = new RegExp(`^(?:export )?(?:const|function|async function) ${nome}[ (=]`);
  const topo = /^(?:export )?(?:const|let|function|async function|class) /;
  const inicio = linhas.findIndex((l) => abre.test(l));
  if (inicio === -1) return null;
  let fim = linhas.length;
  for (let i = inicio + 1; i < linhas.length; i += 1) {
    if (topo.test(linhas[i])) { fim = i; break; }
  }
  return linhas.slice(inicio, fim).join('\n');
}

/**
 * Qualquer forma de emitir cabeçalho de cache, larga de propósito.
 *
 * Ela só é usada na direção "este buraco ainda está aberto?", onde o falso POSITIVO
 * custa uma releitura e o falso NEGATIVO deixa o censo descrevendo um sistema que já
 * mudou. O nome `marcarEscopo` entra porque é como as duas peças da casa se chamam.
 */
const EMITE_CACHE = /Cache-Control|setImmutableHeaders[(]|marcarEscopo/;

/**
 * Os problemas de regime de cache, no formato de mensagem de erro.
 *
 * Recebe o censo, as rotas achadas e as fontes por caminho, para que o controle negativo
 * possa apontar a MESMA função para uma fixture.
 * @param {EntradaDeRegime[]} censo
 * @param {Map<string, {bloco: string}>} rotasPorChave
 * @param {Map<string, string>} fontes - caminho -> código sem comentário.
 * @returns {string[]}
 */
function regimesQuebrados(censo, rotasPorChave, fontes) {
  const problemas = [];
  for (const e of censo) {
    const chave = `${e.arquivo} :: ${e.rota}`;
    const rota = rotasPorChave.get(chave);
    if (!rota) { problemas.push(`${chave} não existe mais como rota de leitura`); continue; }
    if (!rota.bloco.includes(`.${e.handler}`)) {
      problemas.push(`${chave} declara o handler '${e.handler}', ausente da declaração da rota`);
      continue;
    }
    const codigo = fontes.get(e.controller);
    if (codigo === undefined) {
      problemas.push(`${chave} aponta para o controller '${e.controller}', que não está no inventário`);
      continue;
    }
    const corpo = corpoDeclarado(codigo, e.handler);
    if (corpo === null) {
      problemas.push(`${chave} nomeia o handler '${e.handler}', que ${e.controller} não declara`);
      continue;
    }
    if (e.classe === C_AUSENTE) {
      // A DIREÇÃO INVERSA, e ela é metade do valor desta varredura: um buraco fechado no
      // código e não acompanhado pelo censo faz o censo descrever um sistema que não
      // existe mais, e é assim que uma lacuna volta a ser invisível — desta vez por
      // estar declarada.
      if (EMITE_CACHE.test(corpo)) {
        problemas.push(`${chave} está declarada como '${C_AUSENTE}' e o corpo de ${e.handler} JÁ emite cache`);
      } else if (codigo.includes('Cache-Control')) {
        problemas.push(`${chave} está declarada como '${C_AUSENTE}' e ${e.controller} JÁ escreve Cache-Control`);
      }
      continue;
    }
    if (!e.marcador) { problemas.push(`${chave} declara o regime '${e.classe}' e não nomeia marcador`); continue; }
    if (!corpo.includes(e.marcador)) {
      problemas.push(`${chave} declara o marcador '${e.marcador}', ausente do corpo de ${e.handler} em ${e.controller}`);
      continue;
    }
    // E O MARCADOR PRECISA MESMO ESCREVER O CABEÇALHO. Sem esta última perna, bastaria
    // nomear uma função de nome sugestivo para a rota passar coberta, que é o carimbo
    // que a classe DERIVADO da varredura 1 já teve de aprender a recusar.
    const nome = e.marcador.replace('(', '');
    const emite = [...fontes.values()].some((texto) => {
      const def = corpoDeclarado(texto, nome);
      return def !== null && def.includes('Cache-Control');
    });
    if (!emite) {
      problemas.push(`${chave} declara o marcador '${e.marcador}', que não escreve Cache-Control em lugar nenhum`);
    }
  }
  return problemas;
}

describe('Censo das superfícies de recurso (fase F9)', () => {
  // ==========================================================================
  // PISO
  // ==========================================================================
  it('piso: o inventário vem do git e alcança os módulos que servem recurso', () => {
    let arquivos;
    try {
      arquivos = arquivosDoInventario();
    } catch (err) {
      assert.fail(
        `o inventário deste censo vem de \`git ls-files\` e o comando FALHOU (${err.message}). `
        + 'Isto é falha de ambiente, não regressão de código: rode dentro do repositório.'
      );
    }
    assert.ok(arquivos.length >= 100, `esperava >= 100 arquivos em src/, achei ${arquivos.length}`);
    for (const alvo of [
      'src/modules/catalog/catalog.service.js',
      'src/modules/config/config.service.js',
      'src/modules/streetview360/sv360.queries.js',
      'src/modules/streetview360/sv360.tiles.queries.js',
      'src/modules/nomes/nomes.queries.js',
      'src/modules/resource-access/resource-access.queries.js',
    ]) {
      assert.ok(arquivos.includes(alvo), `a varredura precisa alcançar ${alvo}`);
    }

    const unidades = unidadesDeContato(arquivos);
    assert.ok(unidades.size >= 50, `esperava >= 50 unidades de contato, achei ${unidades.size}`);
    const rotas = rotasDeLeitura(arquivosDeRota());
    assert.ok(rotas.length >= 50, `esperava >= 50 rotas de leitura, achei ${rotas.length}`);
    const cache = sitiosDeCache(arquivos);
    assert.ok(cache.length >= 10, `esperava >= 10 sítios de cache, achei ${cache.length}`);

    // A OUTRA METADE DO INVENTÁRIO: `--others` SEM `--exclude-standard` arrastaria
    // `node_modules/` inteiro para dentro do censo, e um censo com dezenas de milhares
    // de arquivos de terceiro é um censo que ninguém fecha. A medição é sobre o PACOTE,
    // e não sobre `src/`, porque em `src/` não há nada ignorado: medir ali seria vácuo.
    assert.ok(
      fs.existsSync(path.join(RAIZ, 'node_modules')),
      'sem `node_modules` no disco esta medição não prova nada: instale as dependências'
    );
    const doPacote = arquivosDoInventario('.');
    assert.ok(doPacote.length >= 100, `esperava >= 100 arquivos .js no pacote, achei ${doPacote.length}`);
    const lixo = doPacote.filter((a) => /(^|[/])(node_modules|coverage|dist|data)[/]/.test(a));
    assert.deepEqual(lixo, [], '`--exclude-standard` deixou entrar arquivo ignorado no inventário');
  });

  // ==========================================================================
  // VARREDURA 1 — CONSULTA
  // ==========================================================================
  it('toda unidade que toca uma tabela de recurso está no censo, com classe e motivo', () => {
    const unidades = unidadesDeContato(arquivosDoInventario());
    assert.ok(unidades.size >= 50, 'guarda: censo comparado contra varredura vazia passaria verde');

    assert.deepEqual(
      consultasNaoClassificadas(unidades), [],
      'consulta que toca uma tabela de recurso e está FORA do censo. Classifique-a em '
      + `'${SQL}' (com o fragmento em \`predicado\`), '${DERIVADO}' (com a unidade SQL de origem), `
      + `'${JS}', '${ESCRITA}' (com o gate do módulo), '${PUBLICO}' (motivo com a palavra RISCO) `
      + `ou '${NAO_RECURSO}', sempre com motivo escrito.`
    );
  });

  it('a contagem por unidade bate: apagar um predicado é tão vermelho quanto acrescentar consulta', () => {
    const unidades = unidadesDeContato(arquivosDoInventario());
    assert.ok(unidades.size >= 50);

    const divergentes = CENSO_CONSULTA
      .map((e) => {
        const u = unidades.get(`${e.arquivo}::${e.unidade}`);
        return { ...e, vistos: u ? u.n : 0 };
      })
      .filter((e) => e.vistos !== e.n)
      .map((e) => `${e.arquivo} :: ${e.unidade} esperava ${e.n} linha(s), achei ${e.vistos}`);

    assert.deepEqual(
      divergentes, [],
      'a contagem do censo divergiu do código: ou a unidade sumiu/foi renomeada, ou o número de '
      + 'linhas de contato dela mudou. Um censo que descreve unidades inexistentes deixa de '
      + 'descrever as que existem.'
    );

    const chaves = CENSO_CONSULTA.map((e) => `${e.arquivo}::${e.unidade}`);
    assert.equal(new Set(chaves).size, chaves.length, 'unidade duplicada no censo de consulta');
  });

  it('toda unidade SQL carrega DE FATO o predicado que declara', () => {
    // ESTE É O CASO QUE TRANSFORMA O CENSO EM GUARDA. Sem ele, "classe SQL" seria uma
    // opinião escrita ao lado do código, e foi exatamente uma opinião dessas (o
    // comentário de `isProjectReadable` afirmando que o SQL cobria tudo) que deixou as
    // quatro consultas de foto abertas por uma fase inteira.
    const unidades = unidadesDeContato(arquivosDoInventario());
    const doSql = CENSO_CONSULTA.filter((e) => e.classe === SQL);
    assert.ok(doSql.length >= 15, `esperava >= 15 unidades SQL, achei ${doSql.length}`);

    const quebradas = doSql.flatMap((e) => {
      const u = unidades.get(`${e.arquivo}::${e.unidade}`);
      if (!u) return [`${e.arquivo} :: ${e.unidade} não existe mais`];
      if (!e.predicado) return [`${e.arquivo} :: ${e.unidade} é SQL e não nomeia predicado`];
      if (!u.bloco.includes(e.predicado)) {
        return [`${e.arquivo} :: ${e.unidade} declara '${e.predicado}' e o bloco NÃO o contém`];
      }
      return [];
    });
    assert.deepEqual(
      quebradas, [],
      'unidade classificada como SQL sem o predicado que declara. Se o predicado saiu, a unidade '
      + 'mudou de classe e o censo precisa dizer para qual — e o teste de comportamento que a '
      + 'cobria precisa ficar vermelho junto.'
    );
  });

  it('toda unidade DERIVADO aponta para uma unidade que existe e é SQL', () => {
    // A CADEIA NÃO PODE APONTAR PARA O VAZIO, senão "derivado" vira carimbo: bastaria
    // escrever a palavra ao lado de uma consulta nova e ela passaria coberta.
    const derivadas = CENSO_CONSULTA.filter((e) => e.classe === DERIVADO);
    assert.ok(derivadas.length >= 15, `esperava >= 15 unidades derivadas, achei ${derivadas.length}`);

    const porChave = new Map(CENSO_CONSULTA.map((e) => [`${e.arquivo}::${e.unidade}`, e]));
    const quebradas = derivadas.flatMap((e) => {
      const origem = porChave.get(e.predicado ?? '');
      if (!origem) return [`${e.arquivo} :: ${e.unidade} deriva de '${e.predicado}', que não está no censo`];
      if (origem.classe !== SQL) {
        return [`${e.arquivo} :: ${e.unidade} deriva de '${e.predicado}', que é '${origem.classe}' e não SQL`];
      }
      return [];
    });
    assert.deepEqual(quebradas, [], 'cadeia de derivação quebrada');

    // DISCRIMINAÇÃO: as origens citadas são POUCAS e nomeadas. Sem esta linha, "toda
    // derivada aponta para uma SQL" também seria verdade num censo onde cada derivada
    // apontasse para si mesma por engano de cópia.
    const origens = new Set(derivadas.map((e) => e.predicado));
    assert.ok(origens.size >= 3, `esperava >= 3 raízes distintas, achei ${origens.size}`);
    assert.ok(
      origens.has(U_SLUG) && origens.has(U_FOTO),
      'as duas raízes do 360 (projeto por slug e foto por id) precisam ser citadas por nome'
    );
  });

  it('unidade JS nomeia o eixo que decide, e ESCRITA nomeia um gate do próprio módulo', () => {
    const unidades = unidadesDeContato(arquivosDoInventario());

    const doJs = CENSO_CONSULTA.filter((e) => e.classe === JS);
    assert.ok(doJs.length >= 2, `esperava >= 2 unidades decididas no JS, achei ${doJs.length}`);
    const jsQuebradas = doJs.filter((e) => {
      const u = unidades.get(`${e.arquivo}::${e.unidade}`);
      return !u || !e.predicado || !u.bloco.includes(e.predicado);
    }).map((e) => `${e.arquivo} :: ${e.unidade}`);
    assert.deepEqual(jsQuebradas, [], 'unidade JS sem o trecho de decisão que declara');

    const deEscrita = CENSO_CONSULTA.filter((e) => e.classe === ESCRITA);
    assert.ok(deEscrita.length >= 10, `esperava >= 10 unidades de escrita, achei ${deEscrita.length}`);
    const versionados = arquivosDoInventario();
    const escritaQuebradas = deEscrita.flatMap((e) => {
      if (!e.predicado) return [`${e.arquivo} :: ${e.unidade} é ESCRITA e não nomeia gate`];
      const dir = path.posix.dirname(e.arquivo);
      const doModulo = versionados.filter((a) => path.posix.dirname(a) === dir);
      const achou = doModulo.some((a) => lerCodigo(a).includes(e.predicado));
      return achou ? [] : [`${e.arquivo} :: ${e.unidade} nomeia o gate '${e.predicado}', ausente de ${dir}`];
    });
    assert.deepEqual(
      escritaQuebradas, [],
      'unidade de ESCRITA cujo gate não existe no próprio módulo: ou o gate mudou de nome, ou o '
      + 'caminho de escrita ficou sem gate nenhum'
    );
  });

  it('toda entrada tem classe válida e motivo escrito, e a isenção declara o RISCO', () => {
    assert.ok(CENSO_CONSULTA.length >= 50, `esperava >= 50 entradas, achei ${CENSO_CONSULTA.length}`);
    const classes = [SQL, DERIVADO, JS, ESCRITA, PUBLICO, NAO_RECURSO];
    const ruins = CENSO_CONSULTA
      .filter((e) => !classes.includes(e.classe) || !e.motivo || e.motivo.length < 60)
      .map((e) => `${e.arquivo} :: ${e.unidade}`);
    assert.deepEqual(ruins, [], 'entrada sem classe válida ou sem motivo escrito');

    // A PALAVRA "RISCO" É OBRIGATÓRIA na isenção, e não é formalidade: uma superfície
    // sem filtro cujo motivo não diz o que pode acontecer é uma lacuna com uma linha a
    // mais. Foi assim que `assets3d` sobreviveu descrito como "gateado pelo catálogo".
    const publicas = CENSO_CONSULTA.filter((e) => e.classe === PUBLICO);
    assert.ok(publicas.length >= 5, `esperava >= 5 superfícies públicas por desenho, achei ${publicas.length}`);
    const semRisco = publicas.filter((e) => !e.motivo.includes('RISCO'))
      .map((e) => `${e.arquivo} :: ${e.unidade}`);
    assert.deepEqual(semRisco, [], 'superfície pública por desenho precisa dizer qual é o RISCO');

    // E nenhuma entrada pode declarar predicado sem que a classe o use.
    const semUso = CENSO_CONSULTA
      .filter((e) => [PUBLICO, NAO_RECURSO].includes(e.classe) && e.predicado)
      .map((e) => `${e.arquivo} :: ${e.unidade}`);
    assert.deepEqual(semUso, [], 'entrada sem filtro não pode declarar predicado');
  });

  // ==========================================================================
  // VARREDURA 2 — ROTA DE LEITURA
  // ==========================================================================
  it('toda rota de LEITURA está no censo, com classe, gate e motivo', () => {
    const achadas = rotasDeLeitura(arquivosDeRota());
    assert.ok(achadas.length >= 50, 'guarda: censo comparado contra varredura vazia passaria verde');

    assert.deepEqual(
      rotasNaoClassificadas(achadas), [],
      'rota de LEITURA fora do censo. Esta varredura é independente da de consulta de propósito: '
      + 'ela pega a rota NOVA que reusa uma consulta ANTIGA, que é o caso que a outra perde. '
      + `Classifique-a em '${R_FILTRADA}', '${R_PUBLICA}' (motivo com a palavra RISCO) ou `
      + `'${R_OUTRA}', sempre com o gate e o motivo.`
    );

    const orfas = CENSO_ROTA
      .filter((e) => !achadas.some((a) => a.arquivo === e.arquivo && a.rota === e.rota))
      .map((e) => `${e.arquivo} :: ${e.rota}`);
    assert.deepEqual(orfas, [], 'entrada de censo sem rota correspondente (renomeada ou removida)');

    const chaves = CENSO_ROTA.map((e) => `${e.arquivo} :: ${e.rota}`);
    assert.equal(new Set(chaves).size, chaves.length, 'rota duplicada no censo');
  });

  it('o gate declarado por cada rota está DE FATO na declaração dela', () => {
    // O QUE ISTO PEGA, e a varredura de classe sozinha não pega: a rota que PERDE o
    // middleware. `requireAtlasScopeWhenPresent` some de uma das dezesseis rotas do 360 e
    // aquele `?atlasId=` passa a autorizar por si — saber o UUID vira o modelo de
    // segurança. É uma linha apagada, sem erro nenhum.
    const achadas = rotasDeLeitura(arquivosDeRota());
    assert.ok(achadas.length >= 50);
    const porChave = new Map(achadas.map((a) => [`${a.arquivo} :: ${a.rota}`, a]));

    const semGate = CENSO_ROTA.flatMap((e) => {
      const a = porChave.get(`${e.arquivo} :: ${e.rota}`);
      if (!a) return [];
      if (!e.gate) return [`${e.arquivo} :: ${e.rota} não nomeia gate`];
      return a.bloco.includes(e.gate)
        ? []
        : [`${e.arquivo} :: ${e.rota} declara o gate '${e.gate}', ausente da declaração`];
    });
    assert.deepEqual(semGate, [], 'rota cujo gate declarado não está na declaração dela');

    const ruins = CENSO_ROTA
      .filter((e) => ![R_FILTRADA, R_PUBLICA, R_OUTRA].includes(e.classe)
        || !e.motivo || e.motivo.length < 60)
      .map((e) => `${e.arquivo} :: ${e.rota}`);
    assert.deepEqual(ruins, [], 'entrada de rota sem classe válida ou sem motivo escrito');

    // SOBROU UMA. A outra era o `/assets3d`, fechada na fase F11, e o piso de `>= 2` foi
    // trocado pela afirmação que ele aproximava: qual rota é a pública, pelo nome. Um piso
    // numérico aqui teria o efeito perverso de premiar a próxima superfície sem filtro.
    const publicas = CENSO_ROTA.filter((e) => e.classe === R_PUBLICA);
    assert.deepEqual(
      publicas.map((e) => `${e.arquivo} :: ${e.rota}`),
      [
        // O vídeo de prévia hospedado, PÚBLICO-POR-URL: o token no nome do arquivo é a
        // capacidade, e a URL só chega a quem vê o recurso (decisão do dono, 2026-08-29). O
        // RISCO está escrito na entrada de CENSO_ROTA acima; entrar aqui é o ato deliberado.
        'src/modules/catalog-video/catalog-video.routes.js :: GET /:file',
        'src/modules/config/config.routes.js :: GET /',
      ],
      'as rotas de leitura públicas por desenho são o documento de boot e o vídeo hospedado; '
      + 'qualquer outra precisa ser classificada de novo, com o RISCO escrito'
    );
    const semRisco = publicas.filter((e) => !e.motivo.includes('RISCO'))
      .map((e) => `${e.arquivo} :: ${e.rota}`);
    assert.deepEqual(semRisco, [], 'rota pública por desenho precisa dizer qual é o RISCO');
  });

  it('as DEZESSETE rotas de leitura do 360 têm TODAS o gate de escopo de atlas', () => {
    // A COBRANÇA COLETIVA, e ela existe porque o modo de falha desta família é ficar
    // PARA TRÁS, nunca quebrar: quando o eixo de empréstimo foi ligado, as rotas de foto
    // não entraram, e a ausência delas não deu erro nenhum — deu 404 num panorama que o
    // atlas legitimamente empresta, que é indistinguível de "não existe".
    const doSv360 = CENSO_ROTA.filter(
      (e) => e.arquivo === 'src/modules/streetview360/sv360.routes.js'
    );
    const deLeitura = doSv360.filter((e) => e.rota !== 'GET /admin/projects');
    // Eram QUINZE até 2026-08-20, quando a pirâmide de tiles acrescentou duas (o descritor
    // e o tile). O número é conferido de propósito, e não derivado: derivá-lo faria uma
    // rota nova entrar na contagem sozinha, que é exatamente o descuido que esta cobrança
    // existe para impedir.
    assert.equal(
      deLeitura.length, 16,
      `as rotas de leitura do 360 sao dezesseis; o censo lista ${deLeitura.length}`
    );
    const semEscopo = deLeitura
      .filter((e) => e.gate !== 'requireAtlasScopeWhenPresent')
      .map((e) => e.rota);
    assert.deepEqual(
      semEscopo, [],
      'rota de leitura do 360 sem `requireAtlasScopeWhenPresent`: ou ela não recebe `?atlasId=` (e '
      + 'o empréstimo não a alcança), ou recebe sem gate (e o UUID do atlas vira senha)'
    );

    // DISCRIMINAÇÃO: a rota administrativa NÃO tem esse gate, e não deve ter — ela é
    // `auth` estrito e recorta por produção. Sem esta linha, "todas têm o gate" também
    // seria o que se mede num censo que classificou tudo igual.
    const admin = doSv360.find((e) => e.rota === 'GET /admin/projects');
    assert.ok(admin, 'a listagem administrativa do 360 precisa estar no censo');
    assert.notEqual(admin.gate, 'requireAtlasScopeWhenPresent');
  });

  // ==========================================================================
  // VARREDURA 3 — CABEÇALHO DE CACHE
  // ==========================================================================
  it('toda decisão de cache está no censo, e nenhuma resposta escopada sai `public` fixo', () => {
    const achados = sitiosDeCache(arquivosDoInventario());
    assert.ok(achados.length >= 10, `esperava >= 10 sítios de cache, achei ${achados.length}`);

    const naoClassificados = achados
      .filter((a) => !CENSO_CACHE.some((e) => e.arquivo === a.arquivo && a.texto.includes(e.trecho)))
      .map((a) => `${a.arquivo}:${a.n} ${a.texto}`);
    assert.deepEqual(
      naoClassificados, [],
      'decisão de cache fora do censo. É o guarda da porta dos fundos: uma resposta que passou a '
      + 'depender de concessão ou de empréstimo e continua `public` é reposta por um cache '
      + `compartilhado a quem não a alcança. Classifique em '${C_CONDICIONAL}', '${C_PRIVADO}', `
      + `'${C_PUBLICO_FIXO}' (motivo com a palavra RISCO) ou '${C_SEM}'.`
    );

    const divergentes = CENSO_CACHE
      .map((e) => ({
        ...e,
        vistos: achados.filter((a) => a.arquivo === e.arquivo && a.texto.includes(e.trecho)).length,
      }))
      .filter((e) => e.vistos !== e.n)
      .map((e) => `${e.arquivo} :: "${e.trecho}" esperava ${e.n}, achei ${e.vistos}`);
    assert.deepEqual(divergentes, [], 'a contagem do censo de cache divergiu do código');

    const ruins = CENSO_CACHE
      .filter((e) => ![C_CONDICIONAL, C_PRIVADO, C_PUBLICO_FIXO, C_SEM].includes(e.classe)
        || !e.motivo || e.motivo.length < 60)
      .map((e) => `${e.arquivo} :: ${e.trecho}`);
    assert.deepEqual(ruins, [], 'entrada de cache sem classe válida ou sem motivo escrito');

    // A CLASSE `publico-fixo` FICOU VAZIA NA FASE F11, e a troca desta linha é o registro
    // disso. Ela cobrava `>= 1` para que a classe discriminasse alguma coisa, e as quatro
    // entradas que a habitavam eram as do `/assets3d` — as últimas respostas do backend que
    // saíam `public, immutable` sem olhar para o recurso. Manter o piso obrigaria alguém a
    // reabrir um buraco para satisfazer o censo. O que entra no lugar não é menos: é a
    // afirmação ESPECÍFICA que o piso servia de proxy para, e ela nomeia o arquivo.
    const fixas = CENSO_CACHE.filter((e) => e.classe === C_PUBLICO_FIXO);
    const semRisco = fixas.filter((e) => !e.motivo.includes('RISCO'))
      .map((e) => `${e.arquivo} :: ${e.trecho}`);
    assert.deepEqual(semRisco, [], 'cabeçalho público fixo precisa dizer qual é o RISCO');

    const doAssets3d = CENSO_CACHE.filter(
      (e) => e.arquivo === 'src/modules/nomes/assets3d.controller.js'
    );
    // SEIS DESDE A ABSORÇÃO DO `ebgeo_3d`: as quatro do acervo servido por caminho (a função
    // imutável, a linha que a condiciona e as duas chamadas, SQLite e sistema de arquivos) mais
    // as duas da camada por MODELO — a delegação do tile ao mesmo decisor e a linha do
    // `tileset.json`, que é o único conteúdo não imutável desta rota.
    assert.equal(doAssets3d.length, 6, `esperava as 6 decisões de cache do /assets3d, achei ${doAssets3d.length}`);
    assert.deepEqual(
      doAssets3d.filter((e) => e.classe !== C_CONDICIONAL).map((e) => e.trecho), [],
      'nenhuma resposta do /assets3d pode ter escopo de cache FIXO: um modelo pode virar privado a '
      + 'qualquer momento, e o cabeçalho precisa acompanhar — é a mesma compra que a F9 fez no 360'
    );

    // O 360 SERVE RECURSO RESTRITO E NENHUM CABEÇALHO DELE PODE SER `public` FIXO. É a
    // afirmação que a fase F9 comprou: os dois eixos decidem, sempre.
    const doSv360 = CENSO_CACHE.filter(
      (e) => e.arquivo === 'src/modules/streetview360/sv360.controller.js'
    );
    assert.ok(doSv360.length >= 6, `esperava >= 6 decisões de cache no 360, achei ${doSv360.length}`);
    assert.deepEqual(
      doSv360.filter((e) => e.classe === C_PUBLICO_FIXO).map((e) => e.trecho), [],
      'nenhuma resposta do 360 pode ter escopo de cache FIXO: um projeto pode virar privado a '
      + 'qualquer momento, e o cabeçalho precisa acompanhar'
    );
  });

  // ==========================================================================
  // VARREDURA 4 — REGIME DE CACHE DA SUPERFÍCIE ESCOPADA
  // ==========================================================================
  it('toda superfície ESCOPADA declara seu regime de cache, e não declarar REPROVA', () => {
    // O CEGO QUE ESTA VARREDURA FECHA. A varredura 3 é de PRESENÇA: ela acha o cabeçalho
    // e cobra classificação. Um cabeçalho AUSENTE não casa com nada e é invisível para
    // ela — e essa é a razão de as rotas JSON do 360 terem passado uma fase inteira sem
    // `Cache-Control`, e de as listagens de catálogo e o payload aditivo terem passado
    // MAIS uma depois disso. Aqui quem manda no conjunto é a lista de rotas escopadas, e
    // não a lista de cabeçalhos encontrados.
    const escopadas = CENSO_ROTA.filter((e) => e.classe === R_FILTRADA)
      .map((e) => `${e.arquivo} :: ${e.rota}`);
    assert.ok(escopadas.length >= 20, `esperava >= 20 superfícies escopadas, achei ${escopadas.length}`);

    const declaradas = CENSO_REGIME.map((e) => `${e.arquivo} :: ${e.rota}`);
    assert.equal(new Set(declaradas).size, declaradas.length, 'rota duplicada no censo de regime');

    assert.deepEqual(
      escopadas.filter((k) => !declaradas.includes(k)), [],
      'superfície ESCOPADA sem regime de cache declarado. Toda resposta que varia por chamador '
      + `precisa dizer o que faz: '${C_CONDICIONAL}', '${C_PRIVADO}', '${C_SEM}' (com o marcador que `
      + `o escreve) ou '${C_AUSENTE}' (buraco, com o RISCO escrito e dentro do teto). Ausência de `
      + 'declaração é vermelho, e não silêncio.'
    );
    assert.deepEqual(
      declaradas.filter((k) => !escopadas.includes(k)), [],
      'entrada de regime para uma rota que não é (ou não é mais) `recurso-com-filtro`: ou a rota '
      + 'mudou de classe na varredura 2, ou o caminho está escrito diferente'
    );
  });

  it('o regime declarado bate com o CORPO do handler, nas duas direções', () => {
    // AS DUAS DIREÇÕES, e as duas importam. Declarar um regime que o handler não cumpre é
    // o defeito original (o censo afirma um cabeçalho que não existe); declarar buraco
    // num handler que já emite é o defeito espelho (o censo descreve um sistema que
    // mudou, e a lacuna volta a ser invisível, agora por estar escrita).
    const inventario = arquivosDoInventario();
    const fontes = new Map(inventario.map((a) => [a, lerCodigo(a)]));
    const rotas = rotasDeLeitura(arquivosDeRota());
    assert.ok(rotas.length >= 50, 'guarda: regime conferido contra varredura vazia passaria verde');
    const porChave = new Map(rotas.map((a) => [`${a.arquivo} :: ${a.rota}`, a]));

    assert.deepEqual(
      regimesQuebrados(CENSO_REGIME, porChave, fontes), [],
      'regime de cache declarado que o código não cumpre'
    );
  });

  it('os buracos de cache têm RISCO escrito, teto, e nenhuma escopada sai `public` fixo', () => {
    const buracos = CENSO_REGIME.filter((e) => e.classe === C_AUSENTE);
    assert.ok(buracos.length >= 1, 'a classe precisa estar em uso, senão ela não discrimina nada');

    const semRisco = buracos.filter((e) => !e.motivo || !e.motivo.includes('RISCO'))
      .map((e) => `${e.arquivo} :: ${e.rota}`);
    assert.deepEqual(
      semRisco, [],
      'buraco de cache sem o RISCO escrito é a mesma coisa que cabeçalho ausente, com uma linha a mais'
    );

    // O TETO. Sem ele, a saída fácil para uma superfície nova sem cabeçalho seria
    // declará-la buraco e seguir em frente — que é como a ausência sobreviveu invisível
    // por duas fases.
    assert.ok(
      buracos.length <= 4,
      `os buracos de cache são 4 (as três do gazetteer e a listagem administrativa do 360) e não `
      + `podem crescer sem decisão; achei ${buracos.length}`
    );

    // E A AFIRMAÇÃO CENTRAL: resposta que variou por chamador NUNCA sai com escopo
    // público fixo. Ela é o simétrico do caso da varredura 3, agora do lado da rota.
    assert.deepEqual(
      CENSO_REGIME.filter((e) => e.classe === C_PUBLICO_FIXO).map((e) => e.rota), [],
      'superfície escopada não pode declarar cabeçalho `public` fixo: um cache compartilhado a '
      + 'reporia para quem não a alcança'
    );

    const ruins = CENSO_REGIME
      .filter((e) => ![C_CONDICIONAL, C_PRIVADO, C_PUBLICO_FIXO, C_SEM, C_AUSENTE].includes(e.classe)
        || (e.classe === C_AUSENTE && e.marcador)
        || (e.classe !== C_AUSENTE && !e.marcador))
      .map((e) => `${e.arquivo} :: ${e.rota}`);
    assert.deepEqual(ruins, [], 'entrada de regime com classe inválida, ou buraco que declara marcador');
  });

  // ==========================================================================
  // O CONTROLE NEGATIVO — provado, não afirmado
  // ==========================================================================
  it('a varredura REPROVA uma CONSULTA nova não classificada (provado com fixture)', () => {
    // A MESMA FUNÇÃO dos casos acima, apontada para uma fixture que toca `sv360.projects`
    // sem predicado e sem entrada no censo. Sem isto, "o censo pega superfície nova" seria
    // uma afirmação do guarda sobre o guarda — e um censo cuja varredura deixasse de casar
    // qualquer coisa passaria todos os outros casos verdes, comparando vazio com vazio.
    const fixture = 'tests/fixtures/censo-superficies/exemplo-nao-classificado.queries.js';
    const unidades = unidadesDeContato([fixture]);
    assert.deepEqual(
      [...unidades.values()].map((u) => u.unidade), ['SUPERFICIE_SEM_CLASSIFICACAO'],
      'a varredura precisa ENXERGAR a consulta da fixture; se ela deixar de casar, os outros casos '
      + 'deste arquivo passam verdes sem verificar nada'
    );

    const acusadas = consultasNaoClassificadas(unidades);
    assert.equal(acusadas.length, 1, 'a consulta da fixture precisa ser ACUSADA como não classificada');
    assert.match(acusadas[0], /SUPERFICIE_SEM_CLASSIFICACAO/);

    // E a DISCRIMINAÇÃO, sem a qual "acusa" também seria o comportamento de uma função
    // que acusa tudo: a mesma função, sobre o código REAL, não acusa ninguém.
    assert.deepEqual(consultasNaoClassificadas(unidadesDeContato(arquivosDoInventario())), []);
  });

  it('a varredura REPROVA uma ROTA de leitura nova não classificada (provado com fixture)', () => {
    const fixture = 'tests/fixtures/censo-superficies/exemplo-nao-classificado.routes.js';
    const achadas = rotasDeLeitura([fixture]);
    assert.deepEqual(
      achadas.map((a) => a.rota), ['GET /rota-de-leitura-sem-classificacao'],
      'a varredura de rota precisa ENXERGAR a rota da fixture'
    );

    const acusadas = rotasNaoClassificadas(achadas);
    assert.equal(acusadas.length, 1, 'a rota da fixture precisa ser ACUSADA');
    assert.match(acusadas[0], /GET \/rota-de-leitura-sem-classificacao/);

    assert.deepEqual(rotasNaoClassificadas(rotasDeLeitura(arquivosDeRota())), []);
  });

  it('a varredura 4 REPROVA a superfície escopada SEM cabeçalho (provado com fixture)', () => {
    // O CONTROLE DO CEGO 2, e ele é o mais importante deste arquivo, porque prova uma
    // AUSÊNCIA. A fixture tem duas rotas escopadas de comportamento conhecido: uma cujo
    // handler não emite cabeçalho nenhum e outra cujo handler emite. As CINCO pernas
    // abaixo medem que a MESMA função usada nos casos reais acusa as combinações erradas
    // e deixa passar as certas — sem o par, "acusa" também seria o comportamento de uma
    // função que acusa tudo.
    const rotas = 'tests/fixtures/censo-superficies/exemplo-sem-regime-de-cache.routes.js';
    const semCtrl = 'tests/fixtures/censo-superficies/exemplo-sem-regime-de-cache.controller.js';
    const comCtrl = 'tests/fixtures/censo-superficies/exemplo-com-regime-de-cache.controller.js';
    const achadas = rotasDeLeitura([rotas]);
    assert.deepEqual(
      achadas.map((a) => a.rota),
      ['GET /rota-escopada-sem-cabecalho', 'GET /rota-escopada-com-cabecalho'],
      'a varredura precisa ENXERGAR as duas rotas da fixture; se ela deixar de casar, este caso '
      + 'passa verde sem verificar nada'
    );
    const porChave = new Map(achadas.map((a) => [`${rotas} :: ${a.rota}`, a]));
    const fontes = new Map([semCtrl, comCtrl].map((a) => [a, lerCodigo(a)]));

    // A MEDIÇÃO DO CEGO, e ela cabe em duas linhas: a varredura 3 (PRESENÇA) não acha
    // NADA no controller sem cabeçalho — não há linha para casar —, então ela não teria
    // o que classificar e passaria verde sobre exatamente a superfície que está
    // desprotegida; no irmão COM cabeçalho ela acha. É a diferença entre ver o que existe
    // e cobrar o que falta, e é a razão de a varredura 4 existir.
    assert.deepEqual(
      sitiosDeCache([semCtrl]), [],
      'a varredura de PRESENÇA não pode achar nada no handler sem cabeçalho: é justamente isso que '
      + 'a torna cega, e se ela passar a achar algo aqui esta medição deixou de medir o cego'
    );
    assert.ok(
      sitiosDeCache([comCtrl]).length >= 1,
      'e ela precisa achar no irmão COM cabeçalho, senão o silêncio acima seria só uma varredura quebrada'
    );

    const semCabecalho = {
      arquivo: rotas, rota: 'GET /rota-escopada-sem-cabecalho', handler: 'semCabecalho',
      controller: semCtrl,
    };
    const comCabecalho = {
      arquivo: rotas, rota: 'GET /rota-escopada-com-cabecalho', handler: 'comCabecalho',
      controller: comCtrl,
    };
    const marcador = 'marcarEscopoDaFixture(';

    // 1. O CEGO EM PESSOA: a rota escopada declara um regime e o handler não emite nada.
    //    A varredura de PRESENÇA não tinha como ver isto — não há linha para casar.
    const acusado = regimesQuebrados(
      [{ ...semCabecalho, classe: C_CONDICIONAL, marcador }], porChave, fontes
    );
    assert.equal(acusado.length, 1, `esperava UMA acusação, achei: ${acusado.join(' | ')}`);
    assert.match(acusado[0], /ausente do corpo de semCabecalho/);

    // 2. DISCRIMINAÇÃO: a MESMA rota, declarada como buraco, NÃO é acusada. É o que
    //    separa "a ausência é vermelha" de "tudo é vermelho".
    assert.deepEqual(
      regimesQuebrados([{ ...semCabecalho, classe: C_AUSENTE, motivo: 'RISCO conhecido' }], porChave, fontes),
      []
    );

    // 3. A DIREÇÃO INVERSA: buraco declarado sobre um handler que JÁ emite é acusado.
    const buracoFechado = regimesQuebrados(
      [{ ...comCabecalho, classe: C_AUSENTE, motivo: 'RISCO conhecido' }], porChave, fontes
    );
    assert.equal(buracoFechado.length, 1, `esperava UMA acusação, achei: ${buracoFechado.join(' | ')}`);
    assert.match(buracoFechado[0], /JÁ emite cache|JÁ escreve Cache-Control/);

    // 4. E o par correto passa, com a resolução marcador -> `Cache-Control` exercida.
    assert.deepEqual(
      regimesQuebrados([{ ...comCabecalho, classe: C_CONDICIONAL, marcador }], porChave, fontes), []
    );

    // 5. E o carimbo recusado: marcador que existe no corpo e não escreve cabeçalho
    //    nenhum (`res.json(` está no corpo e não escreve cabeçalho). Sem esta perna,
    //    bastaria nomear uma função sugestiva ao lado da rota para ela passar coberta.
    const carimbo = regimesQuebrados(
      [{ ...comCabecalho, classe: C_CONDICIONAL, marcador: 'res.json(' }], porChave, fontes
    );
    assert.equal(carimbo.length, 1, `esperava UMA acusação, achei: ${carimbo.join(' | ')}`);
    assert.match(carimbo[0], /não escreve Cache-Control/);
  });

  it('o inventário ENXERGA arquivo NOVO ainda não rastreado (provado, não afirmado)', () => {
    // O CONTROLE DO CEGO 1, e ele não é de classificação: é de CONJUNTO. `git ls-files`
    // sozinho enumera o índice, então a consulta escrita há cinco minutos — a que
    // ninguém classificou ainda — ficava fora da varredura até alguém dar `git add`, e o
    // censo passava verde sem tê-la olhado. Provar a correção exige um arquivo que EXISTA
    // e NÃO esteja rastreado: ele nasce aqui e morre no `finally`.
    const dir = 'tests/fixtures/censo-superficies';
    const relativo = `${dir}/tmp-nao-rastreado.queries.js`;
    const abs = path.join(RAIZ, relativo);
    fs.writeFileSync(abs, [
      `// Path: ${relativo}`,
      '// Temporário: criado e apagado pelo controle negativo deste censo.',
      'export const TMP_SUPERFICIE_NAO_RASTREADA = `SELECT id FROM sv360.projects`;',
      '',
    ].join('\n'));

    try {
      // CONTROLE: o git precisa CONCORDAR que ele não está rastreado, e precisa enxergar
      // a fixture RASTREADA do mesmo pathspec. Sem este par, o caso passaria verde num
      // mundo em que alguém tivesse dado `git add` no temporário.
      const soRastreados = execFileSync('git', ['ls-files', dir], { cwd: RAIZ, encoding: 'utf8' });
      assert.ok(!soRastreados.includes('tmp-nao-rastreado'), 'a fixture temporária não pode estar rastreada');
      assert.ok(
        soRastreados.includes('exemplo-nao-classificado.queries.js'),
        'o pathspec precisa alcançar a fixture rastreada'
      );

      const inventario = arquivosDoInventario(dir);
      assert.ok(
        inventario.includes(relativo),
        'o inventário precisa enxergar o arquivo NÃO RASTREADO: é ele que representa o trabalho da '
        + 'fase corrente, e era exatamente o que `git ls-files` sozinho deixava de fora'
      );
      assert.ok(
        inventario.includes(`${dir}/exemplo-nao-classificado.queries.js`),
        'e o rastreado precisa continuar dentro: a correção SOMA, não troca'
      );

      // E A CADEIA INTEIRA, que é o que transforma "o inventário vê" em "o guarda pega":
      // o arquivo novo é varrido e a consulta dele é ACUSADA, pela MESMA função dos casos
      // acima.
      const acusadas = consultasNaoClassificadas(unidadesDeContato(inventario));
      assert.ok(
        acusadas.some((a) => a.includes('TMP_SUPERFICIE_NAO_RASTREADA')),
        `a consulta do arquivo não rastreado precisa ser ACUSADA; acusadas: ${acusadas.join(' | ')}`
      );
    } finally {
      fs.rmSync(abs, { force: true });
    }
  });
});
