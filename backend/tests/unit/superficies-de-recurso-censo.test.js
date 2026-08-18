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
// INVENTÁRIO, e o inventário vem do VERSIONAMENTO (`git ls-files`), nunca de uma lista
// de alvos escrita aqui — uma lista escrita à mão envelhece na primeira superfície nova,
// que é exatamente o caso que ela precisaria pegar.
//
// TRÊS VARREDURAS INDEPENDENTES, e a independência é o ponto:
//
//   1. CONSULTA — toda linha de código (comentário removido antes) que TOCA uma tabela
//      de recurso (`sv360.projects`/`sv360.photos`, `ng.catalogo_3d`, as quatro tabelas
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

// --- fragmentos de predicado que se repetem ---------------------------------
const P_360 = 'sv360AccessPredicate(';
const P_CATALOGO = 'accessPredicate(';
const P_PRODUCAO = 'fn_can_produce_resource';
const P_CONCESSAO = 'fn_granted_resource_ids';
const P_3D = 'ng.model_permissions';

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
    arquivo: 'src/modules/catalog/catalog.service.js', unidade: 'createCatalogItem', n: 1,
    classe: ESCRITA, predicado: P_PRODUCAO,
    motivo: 'A sonda de id duplicado do CREATE, que também gateia a RESSURREIÇÃO de um id '
      + 'soft-deletado: o id de catálogo é um slug GLOBAL, então sem este gate o produtor de uma OM '
      + 'sairia dono da linha que outra apagou, por sobrescrita.',
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
    n: 1, classe: SQL, predicado: P_CONCESSAO,
    motivo: 'O payload ADITIVO (`GET /resource-access/visible`): lista SÓ o que é `private` e o '
      + 'chamador alcança. A ausência do termo `public` é deliberada e é o que o separa da listagem '
      + 'crua — somar o público aqui duplicaria o que o /api/config já entregou.',
  },
  {
    arquivo: 'src/modules/resource-access/resource-access.queries.js',
    unidade: 'LIST_VISIBLE_PRIVATE_360', n: 1, classe: SQL, predicado: P_360,
    motivo: 'O mesmo payload aditivo para o 360, que tem predicado próprio porque carrega o eixo de '
      + '`status` junto (um projeto `disabled` não entra nem para quem tem concessão).',
  },
  {
    arquivo: 'src/modules/resource-access/resource-access.queries.js',
    unidade: 'getCatalogAccessLevel', n: 1, classe: ESCRITA, predicado: 'requireAdmin',
    motivo: 'Lê o `access_level` atual de uma linha de catálogo para a rota que o MUDA '
      + '(PATCH /:type/:id/visibility). Não recorta nada e não precisa: a rota é `requireAdmin`, e '
      + 'tornar público um recurso é decisão de administração, nunca de quem o enxerga.',
  },
  {
    arquivo: 'src/modules/resource-access/resource-access.queries.js', unidade: 'SET_360_ACCESS_LEVEL',
    n: 1, classe: ESCRITA, predicado: 'requireAdmin',
    motivo: 'A escrita do eixo de privacidade de um projeto 360, gateada por `requireAdmin` na rota. '
      + 'Ela é a única do módulo que toca `sv360.projects`, e é escrita.',
  },
  {
    arquivo: 'src/modules/resource-access/resource-access.queries.js', unidade: 'GET_360_ACCESS_LEVEL',
    n: 1, classe: ESCRITA, predicado: 'requireAdmin',
    motivo: 'A leitura do valor anterior, para a auditoria da mesma rota de escrita registrar de-para. '
      + 'Não é superfície de leitura de recurso: devolve uma coluna e nenhum conteúdo.',
  },

  // ================= catálogo 3D (schema ng): um eixo PARALELO ===============
  {
    arquivo: 'src/modules/nomes/nomes.queries.js', unidade: 'CATALOGO_SELECT', n: 1, classe: SQL,
    predicado: P_3D,
    motivo: 'O gazetteer de modelos 3D recorta as linhas, e recorta por um eixo DIFERENTE do resto '
      + 'da casa: resolve `users.role = admin` direto (não `fn_has_global_data_access`) e permissão '
      + 'por `ng.model_permissions` (não `resource_grants`), então não conhece credenciado, produtor '
      + 'nem empréstimo. Está classificado como o que É; unificar é trabalho próprio, com o repro do '
      + 'bug que o causar, nunca por arrumação.',
  },
  {
    arquivo: 'src/modules/nomes/nomes.queries.js', unidade: 'CATALOGO_COUNT', n: 1, classe: SQL,
    predicado: P_3D,
    motivo: 'A contagem da paginação, com o predicado DUPLICADO verbatim da consulta acima. As duas '
      + 'entram separadas de propósito: divergirem faria a paginação prometer páginas que a listagem '
      + 'não entrega, e é o tipo de defeito que só aparece na última página.',
  },

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
    arquivo: 'src/modules/streetview360/sv360.queries.js', unidade: 'GET_PHOTO_SIZES', n: 2,
    classe: SQL, predicado: P_360,
    motivo: 'A fonte O(1) do ETag e o caminho do {slug}.db, ou seja, a porta dos BYTES da imagem. '
      + 'Era a mais grave das quatro: sem predicado ela entregava o WebP inteiro, e ainda o marcava '
      + '`public, max-age=1ano, immutable`.',
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
    arquivo: 'src/modules/streetview360/sv360.service.js', unidade: 'getPhotoImageMeta', n: 1,
    classe: DERIVADO, predicado: 'src/modules/streetview360/sv360.queries.js::GET_PHOTO_SIZES',
    motivo: `${DERIVA_DA_FOTO} Ela devolve TAMBÉM o `
      + '`access_level`, porque o escopo de cache da imagem tem dois eixos e um deles não estava '
      + 'sendo consultado.',
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
    n: 1, classe: SQL, predicado: P_PRODUCAO,
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

  // ================= o padrão largo que casou outra coisa ====================
  {
    arquivo: 'src/modules/maps/maps.service.js', unidade: 'mergeMaps', n: 1, classe: NAO_RECURSO,
    motivo: 'FALSO POSITIVO DECLARADO, e ele fica aqui em vez de sumir por um padrão mais estreito. '
      + 'A interpolação é sobre as tabelas de SUB-ENTIDADE de mapa (KEYED_SINGLETONS), que são '
      + 'conteúdo colaborativo de atlas e são gateadas por `requireAtlasPermission`, não por '
      + '`resource_grants`. O padrão `FROM ${...}` casa qualquer tabela interpolada de propósito: '
      + 'estreitá-lo para evitar este falso positivo esconderia junto uma interpolação de catálogo.',
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
    motivo: 'Devolve os IDS emprestados ao atlas a quem tem `read`, inclusive os de recursos que '
      + 'aquele leitor não enxerga — e isso é deliberado e documentado na rota: a lista é o '
      + 'inventário do atlas, não o conteúdo do recurso. Nenhum byte de recurso sai por aqui, e '
      + 'quem quiser o conteúdo passa pela superfície do recurso, que filtra.',
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
    arquivo: 'src/modules/resource-access/resource-access.routes.js', rota: 'GET /:type/:id/grants',
    classe: R_OUTRA, gate: 'requireResourceShare',
    motivo: 'Metadado de COMPARTILHAMENTO (quem concedeu a quem, e até quando), não o recurso. Sai '
      + 'só para quem pode compartilhar aquele recurso, que é uma autoridade mais estreita que vê-lo.',
  },

  // ---------------- gazetteer e modelos 3D ------------------------------------
  {
    arquivo: 'src/modules/nomes/nomes.routes.js', rota: 'GET /catalogo3d', classe: R_FILTRADA,
    gate: 'auth',
    motivo: 'O catálogo de modelos 3D do schema `ng`, recortado no SQL por um eixo PARALELO '
      + '(`ng.model_permissions` + `users.role`), que não conhece credenciado, produtor nem '
      + 'empréstimo. Está declarado como o que é, e a unificação é trabalho próprio.',
  },
  {
    arquivo: 'src/modules/nomes/nomes.routes.js', rota: 'GET /busca', classe: R_FILTRADA,
    gate: 'validate',
    motivo: 'A busca do gazetteer, com filtro de ZONA embutido no SQL e contrato congelado de array '
      + 'nu. Não é recurso de catálogo, mas é dado com eixo de acesso próprio e entra no censo por '
      + 'isso: um censo com buraco declarado por comodidade não é censo.',
  },
  {
    arquivo: 'src/modules/nomes/nomes.routes.js', rota: 'GET /feicoes', classe: R_FILTRADA,
    gate: 'auth',
    motivo: 'As edificações do gazetteer, pelo mesmo eixo de zona da busca. Mesma justificativa de '
      + 'inclusão.',
  },
  {
    arquivo: 'src/modules/nomes/assets3d.routes.js', rota: 'GET /*', classe: R_PUBLICA, gate: 'router',
    motivo: 'OS BYTES do tileset 3D, servidos SEM autenticação nenhuma. O RISCO está aberto e é '
      + 'conhecido: o comentário da rota diz que "a descoberta é gateada pelo catálogo autenticado", '
      + 'o que com tileset PRIVADO é segurança por obscuridade — a `url` viaja no payload aditivo e '
      + 'quem a receber legitimamente pode repassar o caminho. Fica NOMEADO aqui para não passar '
      + 'por coberto; fechá-lo é trabalho próprio, com o repro do vazamento que o causar.',
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
    arquivo: 'src/modules/streetview360/sv360.routes.js', rota: 'GET /photos/:uuid/image',
    classe: R_FILTRADA, gate: 'requireAtlasScopeWhenPresent',
    motivo: `${LEITURA_360} Esta serve os BYTES do WebP, e era a mais grave das cinco: entregava a `
      + 'imagem e ainda a marcava `public, max-age=1ano, immutable`.',
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
  { arquivo: 'src/modules/maps/maps.routes.js', rota: 'GET /', classe: R_OUTRA, gate: 'requireAtlasPermission', motivo: CONTEUDO_DE_ATLAS },
  { arquivo: 'src/modules/maps/maps.routes.js', rota: 'GET /:mapId', classe: R_OUTRA, gate: 'requireAtlasPermission', motivo: CONTEUDO_DE_ATLAS },
  { arquivo: 'src/modules/sharing/sharing.routes.js', rota: 'GET /', classe: R_OUTRA, gate: 'requireAtlasPermission', motivo: CONTEUDO_DE_ATLAS },
  {
    arquivo: 'src/modules/sync/sync.routes.js', rota: 'GET /:version', classe: R_OUTRA,
    gate: 'requireAtlasPermission',
    motivo: `${CONTEUDO_DE_ATLAS} O snapshot carrega \`maps.catalog_layers\`, que guarda a `
      + 'CONFIGURAÇÃO ORIGINAL de uma camada de catálogo acrescentada ao mapa (URL inclusive). Um '
      + 'Gestor que enxerga uma camada privada e a põe no mapa a entrega a todo membro, FORA do '
      + 'braço de empréstimo. Está nomeado aqui em vez de coberto; fechá-lo é trabalho próprio.',
  },
  {
    arquivo: 'src/modules/debug/debug.routes.js', rota: 'GET /trace', classe: R_OUTRA,
    gate: 'requireAtlasPermission',
    motivo: 'O anel do SyncLedger, montado só com o tracer ligado e NUNCA em produção (conjunção no '
      + 'ponto de montagem). É diagnóstico por atlas, gateado por atlas, e não serve recurso.',
  },

  // ---------------- administração e identidade -------------------------------
  { arquivo: 'src/modules/audit/audit.routes.js', rota: 'GET /', classe: R_OUTRA, gate: 'requireAdmin', motivo: SO_ADMIN },
  { arquivo: 'src/modules/sync/sync.routes.js', rota: 'GET /admin/stats', classe: R_OUTRA, gate: 'requireAdmin', motivo: SO_ADMIN },
  { arquivo: 'src/modules/users/users.routes.js', rota: 'GET /', classe: R_OUTRA, gate: 'requireAdmin', motivo: SO_ADMIN },
  { arquivo: 'src/modules/users/users.routes.js', rota: 'GET /:userId', classe: R_OUTRA, gate: 'requireAdmin', motivo: SO_ADMIN },
  { arquivo: 'src/modules/zones/zones.routes.js', rota: 'GET /', classe: R_OUTRA, gate: 'requireAdmin', motivo: SO_ADMIN },
  { arquivo: 'src/modules/zones/zones.routes.js', rota: 'GET /:id', classe: R_OUTRA, gate: 'requireAdmin', motivo: SO_ADMIN },
  { arquivo: 'src/modules/zones/zones.routes.js', rota: 'GET /:id/permissions', classe: R_OUTRA, gate: 'requireAdmin', motivo: SO_ADMIN },
  { arquivo: 'src/modules/auth/auth.routes.js', rota: 'GET /me', classe: R_OUTRA, gate: 'auth', motivo: IDENTIDADE },
  { arquivo: 'src/modules/users/users.routes.js', rota: 'GET /me', classe: R_OUTRA, gate: 'auth', motivo: IDENTIDADE },
  {
    arquivo: 'src/modules/users/users.routes.js', rota: 'GET /search', classe: R_OUTRA, gate: 'auth',
    motivo: `${IDENTIDADE} É a busca que alimenta o seletor de beneficiário ao conceder acesso, e o `
      + 'escopo dela é cobrado por `users-search-scope.test.js`.',
  },
  { arquivo: 'src/modules/organizations/organizations.routes.js', rota: 'GET /', classe: R_OUTRA, gate: 'auth', motivo: IDENTIDADE },
  { arquivo: 'src/modules/organizations/organizations.routes.js', rota: 'GET /:id', classe: R_OUTRA, gate: 'auth', motivo: IDENTIDADE },
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
    arquivo: 'src/modules/config/config.controller.js', trecho: "'Cache-Control', 'no-cache'", n: 1,
    classe: C_SEM,
    motivo: 'O documento de boot é público e memoizado no servidor, mas o cliente precisa revalidar: '
      + 'um `/api/config` velho num navegador é um app apontando para catálogo que mudou.',
  },
  {
    arquivo: 'src/modules/images/images.controller.js',
    trecho: "'private, max-age=31536000, immutable'", n: 1, classe: C_PRIVADO,
    motivo: 'Imagem de atlas: sempre `private`, porque o alcance dela é a permissão do atlas e nunca '
      + 'o público. Imutável porque o id da imagem é imutável.',
  },
  {
    arquivo: 'src/modules/nomes/assets3d.controller.js', trecho: 'function setImmutableHeaders(',
    n: 1, classe: C_PUBLICO_FIXO,
    motivo: 'Os bytes do tileset 3D saem `public, immutable` SEM eixo de acesso nenhum, porque a '
      + 'rota inteira é pública. É coerente com a rota, e o RISCO é o mesmo dela: um tileset privado '
      + 'cujo caminho vaze é reposto por qualquer cache compartilhado pelo ano seguinte.',
  },
  {
    arquivo: 'src/modules/nomes/assets3d.controller.js', trecho: "'Cache-Control', IMMUTABLE", n: 1,
    classe: C_PUBLICO_FIXO,
    motivo: 'A linha que grava o cabeçalho da entrada acima, com o mesmo RISCO. Entra separada porque a contagem é o '
      + 'que discrimina remoção, e apagar a chamada sem apagar a função passaria despercebido.',
  },
  {
    arquivo: 'src/modules/nomes/assets3d.controller.js', trecho: 'setImmutableHeaders(res, meta.etag',
    n: 1, classe: C_PUBLICO_FIXO,
    motivo: 'A chamada no caminho do metadado do tileset. Mesmo regime publico da rota e mesmo RISCO: quem tiver o caminho recebe.',
  },
  {
    arquivo: 'src/modules/nomes/assets3d.controller.js', trecho: 'setImmutableHeaders(res, fmeta.etag',
    n: 1, classe: C_PUBLICO_FIXO,
    motivo: 'A chamada no caminho dos BYTES do arquivo do tileset. Mesmo regime publico e mesmo RISCO, agora sobre o conteudo em si.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.controller.js', trecho: "'private, no-cache'", n: 1,
    classe: C_CONDICIONAL,
    motivo: 'As rotas JSON do 360 passaram a marcar escopo quando a resposta DEPENDEU de quem pediu. '
      + 'Elas não emitiam Cache-Control nenhum, o que autoriza cache heurístico — aceitável enquanto '
      + 'o corpo era igual para todos, e não depois que ele varia por concessão e por empréstimo. '
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
    trecho: 'isPublic ? IMMUTABLE_PUBLIC : IMMUTABLE_PRIVATE', n: 1, classe: C_CONDICIONAL,
    motivo: 'A linha em que os dois eixos viram um cabeçalho. Entra separada da função porque é o '
      + 'ponto exato onde a conjunção pode virar disjunção sem ninguém notar.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.controller.js',
    trecho: "setImmutableHeaders(res, etag, 'image/webp'", n: 1, classe: C_CONDICIONAL,
    motivo: 'A chamada do caminho da MINIATURA do projeto, que é byte e por isso segue o mesmo '
      + 'regime da imagem.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.controller.js', trecho: 'setImmutableHeaders(res, d.etag',
    n: 1, classe: C_CONDICIONAL,
    motivo: 'A chamada do caminho da IMAGEM da foto, o WebP em si. É a resposta mais cara do módulo '
      + 'e a que mais interessa a um cache — e por isso a que menos pode errar de escopo.',
  },
  {
    arquivo: 'src/modules/streetview360/sv360.controller.js', trecho: "'no-store'", n: 1, classe: C_SEM,
    motivo: 'O caminho de erro do serviço de blob: nada do que ele devolve pode ser guardado, porque '
      + 'a divergência entre Postgres e o {slug}.db é transitória e um 404 cacheado a tornaria '
      + 'permanente para aquele cliente.',
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

function arquivosVersionados() {
  return execFileSync('git', ['ls-files', 'src'], { cwd: RAIZ, encoding: 'utf8' })
    .split('\n').map((s) => s.trim()).filter((s) => s.endsWith('.js'));
}

const lerCodigo = (arquivo) => semComentarios(fs.readFileSync(path.join(RAIZ, arquivo), 'utf8'));

/**
 * CONTATO COM UMA TABELA DE RECURSO. Larga de propósito: `FROM ${...}` casa qualquer
 * tabela interpolada, e é o preço de não perder uma interpolação de catálogo. O falso
 * positivo que isso produz fica DECLARADO no censo, com a classe NAO-RECURSO.
 */
const CONTATO = [
  /\b(?:FROM|JOIN|INTO|UPDATE)\s+sv360\.(?:projects|photos)\b/i,
  /\b(?:FROM|JOIN|INTO|UPDATE)\s+ng\.catalogo_3d\b/i,
  /\b(?:FROM|JOIN|INTO|UPDATE)\s+(?:tilesets|data_layers|analysis_layers|basemaps)\b/i,
  /\bFROM\s+\$\{/,
  /\b(?:listCatalog|getCatalogItem)\(/,
  /\b(?:isProjectReadable|enforceProjectReadable|resolveReadableProject)\(/,
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

const arquivosDeRota = () => arquivosVersionados().filter((a) => a.endsWith('.routes.js'));

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

describe('Censo das superfícies de recurso (fase F9)', () => {
  // ==========================================================================
  // PISO
  // ==========================================================================
  it('piso: o inventário vem do git e alcança os módulos que servem recurso', () => {
    let arquivos;
    try {
      arquivos = arquivosVersionados();
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
  });

  // ==========================================================================
  // VARREDURA 1 — CONSULTA
  // ==========================================================================
  it('toda unidade que toca uma tabela de recurso está no censo, com classe e motivo', () => {
    const unidades = unidadesDeContato(arquivosVersionados());
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
    const unidades = unidadesDeContato(arquivosVersionados());
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
    const unidades = unidadesDeContato(arquivosVersionados());
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
    const unidades = unidadesDeContato(arquivosVersionados());

    const doJs = CENSO_CONSULTA.filter((e) => e.classe === JS);
    assert.ok(doJs.length >= 2, `esperava >= 2 unidades decididas no JS, achei ${doJs.length}`);
    const jsQuebradas = doJs.filter((e) => {
      const u = unidades.get(`${e.arquivo}::${e.unidade}`);
      return !u || !e.predicado || !u.bloco.includes(e.predicado);
    }).map((e) => `${e.arquivo} :: ${e.unidade}`);
    assert.deepEqual(jsQuebradas, [], 'unidade JS sem o trecho de decisão que declara');

    const deEscrita = CENSO_CONSULTA.filter((e) => e.classe === ESCRITA);
    assert.ok(deEscrita.length >= 10, `esperava >= 10 unidades de escrita, achei ${deEscrita.length}`);
    const versionados = arquivosVersionados();
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

    const publicas = CENSO_ROTA.filter((e) => e.classe === R_PUBLICA);
    assert.ok(publicas.length >= 2, 'a classe pública precisa estar em uso, senão não discrimina nada');
    const semRisco = publicas.filter((e) => !e.motivo.includes('RISCO'))
      .map((e) => `${e.arquivo} :: ${e.rota}`);
    assert.deepEqual(semRisco, [], 'rota pública por desenho precisa dizer qual é o RISCO');
  });

  it('as QUINZE rotas de leitura do 360 têm TODAS o gate de escopo de atlas', () => {
    // A COBRANÇA COLETIVA, e ela existe porque o modo de falha desta família é ficar
    // PARA TRÁS, nunca quebrar: quando o eixo de empréstimo foi ligado, as rotas de foto
    // não entraram, e a ausência delas não deu erro nenhum — deu 404 num panorama que o
    // atlas legitimamente empresta, que é indistinguível de "não existe".
    const doSv360 = CENSO_ROTA.filter(
      (e) => e.arquivo === 'src/modules/streetview360/sv360.routes.js'
    );
    const deLeitura = doSv360.filter((e) => e.rota !== 'GET /admin/projects');
    assert.equal(
      deLeitura.length, 15,
      `as rotas de leitura do 360 sao quinze; o censo lista ${deLeitura.length}`
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
    const achados = sitiosDeCache(arquivosVersionados());
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

    const fixas = CENSO_CACHE.filter((e) => e.classe === C_PUBLICO_FIXO);
    assert.ok(fixas.length >= 1, 'a classe pública fixa precisa estar em uso');
    const semRisco = fixas.filter((e) => !e.motivo.includes('RISCO'))
      .map((e) => `${e.arquivo} :: ${e.trecho}`);
    assert.deepEqual(semRisco, [], 'cabeçalho público fixo precisa dizer qual é o RISCO');

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
    assert.deepEqual(consultasNaoClassificadas(unidadesDeContato(arquivosVersionados())), []);
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
});
