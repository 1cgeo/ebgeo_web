// Path: tests/unit/superficies-de-recurso-censo.test.js
//
// O CENSO DAS SUPERFÍCIES DE RECURSO NO CLIENTE — a metade de cá.
//
// O irmão de backend (`backend/tests/unit/superficies-de-recurso-censo.test.js`) cobra
// que toda consulta e toda rota de leitura declarem o predicado que as cobre. Aqui a
// pergunta é a simétrica e é DIFERENTE: no cliente não existe predicado nenhum, existe
// UMA fonte de verdade por família, e o defeito é ler fora dela.
//
// AS TRÊS FONTES, e é só isso que este arquivo mede (eram duas até 2026-09-15, quando D17
// fez o carimbo de escopo de atlas alcançar o tile e a terceira passou a ter consumidor
// fora do 360):
//
//   1. O SINGLETON `config` — o catálogo do deploy, hidratado por `GET /api/config` no
//      boot. Ele é MUTADO por `mergeGrantedIntoBaseline` quando o servidor diz o que
//      mais aquele usuário alcança (por concessão pessoal ou por empréstimo do atlas em
//      foco), e desmutado por `revertGrantedResources` no disconnect. Quem lê o
//      singleton recebe e perde o recurso concedido sem saber que ele existe — que é
//      exatamente o desenho. Quem guarda uma CÓPIA fica com o recurso depois do logout.
//   2. O CACHE DE PROJETOS 360 de `streetview-api.service.js`, que desde a fase F9 é
//      CHAVEADO POR ESCOPO `(usuário, atlas em foco)`.
//   3. O CARIMBO DE ESCOPO DE ATLAS — o `?atlasId=` que diz ao servidor QUAL empréstimo o
//      pedido quer usar. Ele não é transporte de credencial e sim uma das duas entradas do
//      predicado, e é a ÚNICA que o visitante de link público tem. O porquê por extenso
//      está nas classes `DONO_ESCOPO`/`ESCREVE_CARIMBO`/`CARIMBA_ESCOPO`, abaixo.
//
// O MODO DE FALHA QUE ISTO PEGA é o inverso do de servidor, e é mais silencioso: no
// servidor um filtro que falta VAZA; aqui um consumidor que lê fora da fonte fica com
// dado VELHO — o recurso concedido some da tela (parece um bug de UI) ou, pior, o
// recurso emprestado por um atlas continua visível depois de sair dele, e nada fica
// vermelho porque uma lista é uma resposta bem-formada nos dois casos. Na terceira fonte
// o modo de falha é primo: o pedido sem carimbo recebe o subconjunto PÚBLICO, que também é
// resposta bem-formada, e a camada emprestada simplesmente não desenha.
//
// A VARREDURA VEM DO VERSIONAMENTO (`git ls-files -co --exclude-standard src/js`), nunca
// de uma lista escrita aqui: conferir um subconjunto e tratá-lo como o conjunto é a lição
// mais repetida de `docs/livro-razao.md`. As duas bandeiras não são detalhe: `git ls-files`
// puro enumera só o RASTREADO, e o guarda ficava cego exatamente onde o trabalho novo
// aparece — o consumidor escrito há cinco minutos, que é o que ninguém classificou, só
// entrava na varredura depois de um `git add`.
//
// Cada par (arquivo, gatilho) precisa de entrada, e o par existe
// porque três arquivos leem AS DUAS fontes — contá-los uma vez só faria a classe de um
// deles cobrir a do outro.
//
// A COBRANÇA MAIS FORTE DO ARQUIVO não é a classificação, é o caso "todo grupo lido é
// um grupo COBERTO pelo dono do baseline": as chaves de `config` que os consumidores
// leem são coletadas do código e comparadas com o que `atlas-settings.service.js`
// realmente trata. Um grupo novo lido por alguém e não tratado lá é um recurso
// concedido que nunca chega, e um recurso revogado que nunca sai.
//
// O QUE ESTE ARQUIVO NÃO PRENDE: comportamento. Que o cache invalide na troca de escopo
// é `cache-projetos-escopo.test.js`; que o consumidor rebusque no miss é
// `cache-projetos-consumidores.test.js`; que o basemap concedido chegue ao seletor com
// estilo é `basemap-estilo-publicado.test.js` e `recursos-concedidos-overlay.test.js`.
//
// FRAGILIDADE ACEITA: a varredura precisa de `git`; se o comando falhar, o caso-piso diz
// isso nessas palavras, porque falha de ambiente lida como regressão custa mais do que o
// guarda economiza.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));

/** Classes da família `config` (o catálogo do deploy). */
const BASELINE = 'le-o-singleton-config';
const DONO_BASELINE = 'dono-do-baseline';
const SEM_OVERLAY = 'le-config-fora-do-app-do-mapa';
const SEM_EIXO = 'nao-e-catalogo';
/**
 * Toca o catálogo SEM importar o singleton: recebe o documento por argumento, ou o lê de uma
 * resposta de rota. Entrou em 2026-08-31 com o mapa base do mini-mapa do 360.
 *
 * A CLASSE EXISTE PORQUE O DEFEITO QUE O CENSO CAÇA É A CÓPIA, e quem recebe o catálogo por
 * argumento não tem onde guardar uma: ele lê o que lhe deram, no instante da chamada, então o
 * overlay de recurso concedido já entrou ou já saiu quando o valor chega. Exigir dele o import
 * do singleton seria exigir justamente o acoplamento que a forma dispensa.
 *
 * E ELA NÃO É PORTA DOS FUNDOS: a asserção da classe é o ESPELHO da dos outros, e o arquivo
 * aqui classificado tem de NÃO importar o singleton. Um consumidor que passe a importá-lo fica
 * vermelho aqui, e a classificação deixa de ser um lugar onde se estaciona o que incomoda.
 */
const SEM_SINGLETON = 'toca-o-catalogo-sem-o-singleton';

/** Classes da família do cache de projetos 360. */
const CACHE_360 = 'consome-o-cache-de-projetos';
const DONO_CACHE = 'dono-do-cache-de-projetos';
const OUTRO_MODULO = 'homonimo-da-calibracao';

/**
 * Classes da TERCEIRA fonte, que entrou com D17 (2026-09-15): o CARIMBO DE ESCOPO DE ATLAS.
 *
 * POR QUE ELA É UMA FONTE, e não um detalhe de transporte. O que a pessoa enxerga de privado
 * sai de duas entradas do servidor: quem pergunta, e QUAL ATLAS está em foco. A segunda só
 * chega ao servidor se o cliente a escrever no pedido, e ela é a ÚNICA autorização que o
 * visitante de link público tem. Uma superfície que fale com o servidor e esqueça o carimbo
 * não devolve erro: devolve o subconjunto PÚBLICO, que é resposta bem-formada, e o recurso
 * emprestado some da tela sem nada ficar vermelho. Foi assim que o tile passou de 2026-08-29
 * a 2026-09-15 com a cláusula 6.7 aberta, e assim que as catorze rotas de leitura do 360
 * ficaram meses sem escopo enquanto os tiles delas já o tinham.
 *
 * O CENSO É SOBRE O CONJUNTO, não sobre cada chamada: quem toca o carimbo declara por quê,
 * para que a superfície nova nasça classificada em vez de ser descoberta por um usuário que
 * não vê a camada que o atlas lhe empresta.
 */
const DONO_ESCOPO = 'dono-do-escopo-de-atlas';
const ESCREVE_CARIMBO = 'escreve-o-carimbo-na-url';
const CARIMBA_ESCOPO = 'carimba-o-escopo-no-pedido';

/** Motivos que se repetem, escritos uma vez. */
const LE_TILESETS = 'Lê `config.tilesets` do singleton, que é onde o modelo 3D concedido aparece e '
    + 'de onde ele some no disconnect. Guardar uma cópia local desta lista é o defeito que a classe '
    + 'existe para tornar visível: a cópia sobreviveria ao logout.';
const MISS_BUSCA = 'Consome o cache de projetos 360, que é chaveado por escopo desde a F9: no miss '
    + 'ele precisa REBUSCAR, porque ler o miss como "não existe 360" mostra tela vazia a cada troca '
    + 'de atlas. Qual é a forma exigida de cada um está em `cache-projetos-consumidores.test.js`.';

/**
 * @typedef {Object} Entrada
 * @property {string} arquivo - Relativo a `frontend/`.
 * @property {'catalogo'|'projetos'} gatilho
 * @property {number} n - Linhas de contato naquele arquivo, naquele gatilho.
 * @property {string} classe
 * @property {string} motivo
 */

/** @type {Entrada[]} */
const CENSO = [
    { arquivo: 'src/js/session/uso-do-barramento.js', gatilho: 'catalogo', n: 3, classe: BASELINE, motivo: 'Telemetry validates resource IDs against the current catalog; it keeps no catalog copy.' },
    // ================= o dono de cada fonte ==================================
    {
        arquivo: 'src/js/store/sync/atlas-settings.service.js', gatilho: 'catalogo', n: 53,
        classe: DONO_BASELINE,
        motivo: 'O dono do baseline: captura a disponibilidade do deploy, soma o que o servidor '
            + 'concedeu (`mergeGrantedIntoBaseline`), interseca com a restrição do atlas e desfaz a '
            + 'soma no disconnect (`revertGrantedResources`). É o único arquivo que pode mutar as '
            + 'listas de `config`, e é contra ele que todo grupo lido por outro arquivo é cobrado.',
    },
    {
        arquivo: 'src/js/street_view_tool/streetview-api.service.js', gatilho: 'projetos', n: 3,
        classe: DONO_CACHE,
        motivo: 'O dono do cache de projetos 360 e da guarda de escopo (`adoptCurrentScope`): é ele '
            + 'que transforma carimbo divergente em miss, e é por isso que nenhum consumidor precisa '
            + 'saber que escopo existe. A resposta em voo é estampada com o escopo lido ANTES do '
            + 'request, então uma troca durante a chamada vira miss e nunca rótulo errado.',
    },

    // ================= consumidores do singleton `config` ====================
    {
        arquivo: 'src/js/street_view_tool/mini-mapa-base.js', gatilho: 'catalogo', n: 5,
        classe: SEM_SINGLETON,
        motivo: 'O mapa base do MINI-MAPA do visualizador 360, que desde 2026-08-31 sai do '
            + 'catálogo em vez de um estilo OSM escrito à mão neste diretório (decisão do dono). '
            + 'As cinco leituras são de duas naturezas e nenhuma é de URL: `config.basemaps` para '
            + 'a lista de habilitados por prioridade e para a faixa de zoom da linha escolhida, e '
            + '`config.basemapStyles` para o estilo de um id que o cliente não traz embutido. '
            + 'A superfície é a MESMA do seletor principal, e por construção: o mini-mapa delega '
            + 'a `resolveBasemapStyle` e a `firstStyledBasemap`, então um mapa base privado '
            + 'concedido resolve aqui pelo mesmo caminho aditivo, e um id que o visitante não '
            + 'alcança cai no mesmo fallback. O que ele NÃO faz é listar: o mini-mapa não é um '
            + 'seletor, então nada aqui expõe nome de recurso a quem não o tem.',
    },
    {
        arquivo: 'src/js/admin/config-tab.js', gatilho: 'catalogo', n: 1,
        classe: SEM_SINGLETON,
        motivo: 'A aba de configuração do administrador, que desde 2026-08-31 monta o seletor de '
            + 'mapa base do mini-mapa do 360 a partir de `config.basemaps` do documento EFETIVO, e '
            + 'desde 2026-09-23 o do mapa base inicial, com a MESMA lista. '
            + 'Uma leitura só, e de LISTA, o que a torna a única entrada deste censo cujo alcance '
            + 'é decidido pela rota e não pelo arquivo: `GET /config/admin` é `requireAdmin`, e o '
            + 'administrador lê todo recurso por cláusula 2.7 da constituição.',
    },
    {
        arquivo: 'src/js/config.helpers.js', gatilho: 'catalogo', n: 7, classe: BASELINE,
        motivo: 'Os ajudantes de basemap (`getEnabledBasemaps`, `getValidBasemapFallback`, '
            + '`validateBasemapsConfig`) e a checagem de tilesets. É a superfície do BASEMAP, que '
            + 'virou o quinto tipo de recurso concedível na migração 021: o basemap privado '
            + 'concedido entra por aqui, e o estilo dele viaja numa segunda chave.',
    },
    {
        arquivo: 'src/js/baselayers/base-layer.control.js', gatilho: 'catalogo', n: 6,
        classe: BASELINE,
        motivo: 'O seletor de camada base, que resolve o estilo por demanda contra '
            + '`config.basemapStyles`. Montar a tabela de estilos no construtor (como fazia antes da '
            + 'F9) faz o clique num basemap concedido cair silenciosamente noutra camada, porque o '
            + 'concedido chega DEPOIS do boot. A TERCEIRA leitura entrou em 2026-08-24 e é de '
            + 'NOME, não de estilo: quando o basemap pedido não resolve, `switchLayer` acusa a '
            + 'falha nomeando a camada (`config.basemaps[layer].name`) antes de cair no fallback. '
            + 'Ela é o oposto de um vazamento: é o que faz a queda silenciosa descrita acima '
            + 'deixar de ser silenciosa. Nomear é possível AQUI e só aqui, porque quem pediu '
            + 'ainda está na variável, antes da reatribuição. A QUARTA entrou em 2026-08-31 com '
            + 'a faixa de zoom por mapa base (`_applyBasemapZoom`), e é de NÚMERO: `minzoom` e '
            + '`maxzoom` da linha de catálogo, que viram `setMinZoom`/`setMaxZoom` da câmera. Ela '
            + 'lê o mesmo objeto `config.basemaps[id]` das outras, e o que ela expõe a um '
            + 'visitante é a faixa de um mapa base que ele JÁ está vendo, depois do fallback: '
            + 'quem não alcança o basemap privado nunca chega a esta linha com o id dele. '
            + 'A QUINTA entrou em 2026-09-04 e a SEXTA em 2026-09-23, e são as únicas que não '
            + 'rodam dentro do controle: `initialBaseStyle()` e `initialBaseLayer()` são funções '
            + 'de módulo, chamadas por `map_sig.js` e pelo construtor para o mapa nascer com a '
            + 'MESMA base que o controle assume. Desde 2026-09-23 o id delas é a base padrão que o '
            + 'administrador escolhe (`config.map2d.defaultBasemap`), e não mais uma constante. '
            + 'Elas não ampliam superfície nenhuma, porque são a mesma resolução do seletor '
            + '(`resolveBasemapStyle` e `firstStyledBasemap` sobre `STYLE_MAP` mais '
            + '`config.basemapStyles`, contra a lista de `getEnabledBasemaps`): uma base padrão '
            + 'privada só nasce para quem já a tem no catálogo, e quem não a tem nasce no primeiro '
            + 'mapa base oferecido. O que elas fecham é a divergência entre o estilo com que o mapa '
            + 'NASCE e o que a troca de base assume, que fazia a primeira troca preservar a base '
            + 'velha inteira por cima da nova.',
    },
    {
        arquivo: 'src/js/3d_models_viewer_tool/add_3d_models_viewer_control.js', gatilho: 'catalogo', n: 3,
        classe: BASELINE,
        motivo: LE_TILESETS
            + ' A TERCEIRA leitura entrou em 2026-08-24 e é a mesma forma já declarada para '
            + '`map_3d.js` e `base-layer.control.js`: leitura de NOME, para que a cena 3D que não '
            + 'abre possa ser acusada nomeando-a. O caminho que ela cobre é estreito e vale '
            + 'registrar, porque não é o que se supõe: `openFirstPersonViewer` engole toda falha '
            + 'de carga e já fala por conta própria, então o `catch` do controle só enxerga o '
            + '`import()` do chunk falhando (troca de deploy sob aba aberta, rede fora). Era essa '
            + 'a porta 100% muda, nas quatro entradas da cena.',
    },
    {
        arquivo: 'src/js/3d_models_viewer_tool/map_3d.js', gatilho: 'catalogo', n: 5,
        classe: BASELINE,
        motivo: LE_TILESETS
            + ' A QUARTA leitura entrou em 2026-08-24 e é de NOME, não de estilo nem de URL: '
            + 'quando o modelo não carrega, `openViewerWithTileset` acusa a falha nomeando-o '
            + 'antes de relançar. É a mesma forma já declarada acima para '
            + '`base-layer.control.js`, e o oposto de um vazamento: sem ela o tileset privado '
            + 'emprestado a um visitante de link público some da cena sem uma palavra. O modelo '
            + '3D tem DOIS caminhos de falha e este cobre um; o outro (todos os filhos `.b3dm` '
            + 'recusados enquanto a raiz responde 200) não passa por aqui, não rejeita nada e só '
            + 'existe como evento `tileFailed`, que não lê o catálogo. A QUINTA entrou em '
            + '2026-09-22, no MESMO `catch`, e é a mesma leitura de NOME: o toast deixou de dizer '
            + '"Erro ao carregar modelo 3D" e passou a usar a frase do painel '
            + '(`layerLoadFailureNotice`), para que toast e painel não digam duas coisas sobre a '
            + 'mesma falha. Lê o singleton no instante do erro e não guarda nada.',
    },
    { arquivo: 'src/js/3d_models_viewer_tool/components/panel-shared-3d.js', gatilho: 'catalogo', n: 1, classe: BASELINE, motivo: LE_TILESETS },
    { arquivo: 'src/js/features_tab/models3d-section.component.js', gatilho: 'catalogo', n: 2, classe: BASELINE, motivo: LE_TILESETS },
    {
        arquivo: 'src/js/first_person_3d_tool/scene-config.service.js', gatilho: 'catalogo', n: 1,
        classe: BASELINE,
        motivo: `${LE_TILESETS} Aqui a leitura é uma PARTIÇÃO da mesma lista (as cenas de primeira `
            + 'pessoa são os tilesets com `viewer` próprio), e não uma segunda fonte.',
    },
    { arquivo: 'src/js/search/feature-search.control.js', gatilho: 'catalogo', n: 2, classe: BASELINE, motivo: LE_TILESETS },
    {
        arquivo: 'src/js/search/search-bar.search-providers.js', gatilho: 'catalogo', n: 2,
        classe: BASELINE,
        motivo: `${LE_TILESETS} A busca é a superfície mais fácil de esquecer, porque ela não desenha `
            + 'nada: o resultado aparece numa lista, e um modelo concedido ausente dali parece '
            + '"não achei" e não "não recebi".',
    },
    {
        arquivo: 'src/js/briefing/editor/briefing-editor.control.js', gatilho: 'catalogo', n: 5,
        classe: BASELINE,
        motivo: `${LE_TILESETS} A quinta leitura é de 2026-09-20 e é de \`config.basemaps\`: o seletor de `
            + 'mapa base do slide nomeia a base salva do mapa, lida do mesmo singleton que o seletor '
            + 'do mapa lê, de modo que uma base concedida aparece nos dois e uma retirada some dos dois.',
    },
    {
        arquivo: 'src/js/briefing/validation/reference-validator.js', gatilho: 'catalogo', n: 2,
        classe: BASELINE,
        motivo: `${LE_TILESETS} Aqui a consequência do miss é ativa e não passiva: o validador marca `
            + 'como QUEBRADA toda referência de slide cujo modelo ele não encontrar.',
    },
    {
        arquivo: 'src/js/catalog/catalog.service.js', gatilho: 'catalogo', n: 3, classe: BASELINE,
        motivo: 'O catálogo, que é a tela onde o recurso concedido PRECISA aparecer com o selo de '
            + 'privado e o botão de compartilhar. Lê as três famílias de array (tilesets, camadas de '
            + 'dados e de análise) do singleton.',
    },
    {
        arquivo: 'src/js/terrain/analysis-layers.manager.js', gatilho: 'catalogo', n: 10,
        classe: BASELINE,
        motivo: 'O gerente das camadas de ANÁLISE: liga/desliga a categoria inteira e monta cada '
            + 'camada a partir de `config.analysisLayers`. É por aqui que uma camada de análise '
            + 'concedida vira fonte no mapa.',
    },
    {
        arquivo: 'src/js/terrain/data-layers.manager.js', gatilho: 'catalogo', n: 5, classe: BASELINE,
        motivo: 'O gêmeo do anterior para as camadas de DADOS. Os dois entram separados porque as '
            + 'duas famílias têm chaves distintas em `config` e nada garante que uma correção numa '
            + 'alcance a outra.',
    },
    {
        arquivo: 'src/js/catalog/catalog-layer.ref.js', gatilho: 'catalogo', n: 3, classe: BASELINE,
        motivo: 'O RESOLVEDOR de referência de camada de catálogo, e ele fechou o buraco que esta '
            + 'linha declarava até a F11. O mapa guardava uma CÓPIA da linha de catálogo (URL '
            + 'inclusive) dentro de `catalogLayers`, e a cópia viajava no snapshot de sync até '
            + 'chamador ANÔNIMO de atlas com link público (o teto declarado aqui dizia "todo '
            + 'membro" e era menor que o real). Hoje o mapa guarda referência mais estado por '
            + 'atlas, e nome, `config` e legenda são resolvidos AQUI, contra o singleton, a cada '
            + 'leitura: o recurso que o overlay não somou simplesmente não resolve, e a camada cai '
            + 'no estado "indisponível" que a UI já tinha. Guardar cópia é justamente o que a '
            + 'classe existe para tornar visível, e este arquivo é quem a impede.',
    },
    {
        arquivo: 'src/js/store/map.operations.js', gatilho: 'catalogo', n: 1, classe: BASELINE,
        motivo: 'Confere se o basemap gravado num mapa continua habilitado antes de aplicá-lo. Lê o '
            + 'singleton, então um basemap que saiu do alcance (revogado, ou atlas trocado) degrada '
            + 'para o fallback em vez de tentar desenhar um estilo que não chega mais.',
    },
    {
        arquivo: 'src/js/modals/atlas-settings.modal.js', gatilho: 'catalogo', n: 4, classe: BASELINE,
        motivo: 'A aba de RESTRIÇÃO do atlas, onde o Gestor escolhe o subconjunto do catálogo que o '
            + 'atlas oferece. Ela lê o singleton para saber o que existe e grava só a allowlist: as '
            + 'duas coisas se cruzam em `intersectAvailability`, e a restrição nunca HABILITA o que '
            + 'o baseline não tinha.',
    },

    // ================= consumidores do cache de projetos 360 =================
    { arquivo: 'src/js/catalog/catalog.service.js', gatilho: 'projetos', n: 1, classe: CACHE_360, motivo: MISS_BUSCA },
    { arquivo: 'src/js/briefing/validation/reference-validator.js', gatilho: 'projetos', n: 1, classe: CACHE_360, motivo: MISS_BUSCA },
    { arquivo: 'src/js/modals/atlas-settings.modal.js', gatilho: 'projetos', n: 1, classe: CACHE_360, motivo: MISS_BUSCA },
    { arquivo: 'src/js/search/search-bar.search-providers.js', gatilho: 'projetos', n: 1, classe: CACHE_360, motivo: MISS_BUSCA },
    {
        arquivo: 'src/js/street_view_tool/streetview_markers.js', gatilho: 'projetos', n: 2,
        classe: CACHE_360,
        motivo: 'A camada de marcadores 2D do 360, e o arquivo que um censo por NOME apaga por '
            + 'engano: ele não tem nada a ver com a tabela `streetview_markers`, que a migração 021 '
            + 'removeu por não ter consumidor nenhum. `loadMarkers` chama `fetchProjects()` direto, '
            + 'e a única leitura do cache é o caminho de emergência, onde nulo é a degradação certa.',
    },

    {
        arquivo: 'src/js/catalog/resource-reference.resolver.js', gatilho: 'catalogo', n: 9,
        classe: BASELINE,
        motivo: 'Quem responde "este id é público?" para a PODA DE SAÍDA (o `.ebgeo` e o "Salvar '
            + 'como local"). Lê os quatro grupos do singleton no instante em que o resolver é '
            + 'construído — uma vez, e o resolver devolvido não volta ao singleton, para que a '
            + 'poda inteira veja o mesmo retrato do começo ao fim. É o consumidor com a '
            + 'consequência mais cara de um miss: a regra é KEEP-LIST, então um recurso que o '
            + 'overlay não somou vira `unknown` e SAI da cópia, num caminho irreversível. É por '
            + 'isso que ele se recusa a rodar quando a soma nunca aconteceu com sessão viva. '
            + 'A NONA linha, de 2026-09-22, é FALSO POSITIVO declarado e não uma leitura: a chave '
            + "`'settings.basemaps'` da tabela de rótulos (`ROTULO_DE_SUPERFICIE`), que é o id de "
            + 'SUPERFÍCIE que o relatório de poda do servidor anota, escrito como o servidor o '
            + 'escreve. As cinco listas de `atlas.settings` entraram na tabela no mesmo dia, e só '
            + 'esta casa o gatilho, porque as outras quatro se chamam `available_*`. O par '
            + '(arquivo, gatilho) é único, então a colisão entra na contagem desta entrada em vez '
            + 'de ganhar classe própria.',
    },

    // ================= o que casou o padrão e é outra coisa ==================
    {
        arquivo: 'src/js/catalog/resource-reference.registry.js', gatilho: 'catalogo', n: 4,
        classe: SEM_EIXO,
        motivo: 'FALSO POSITIVO DECLARADO, e são QUATRO colisões de nome dentro do próprio '
            + 'inventário, nenhuma delas leitura de catálogo: duas são IDS DE SUPERFÍCIE '
            + '(`mapa.analysisLayers`, declarada NÃO-REFERÊNCIA porque o campo homônimo do '
            + 'documento de mapa é do domínio de GRADE, e `settings.basemaps`, que é o nome da '
            + 'allowlist por atlas) e duas são CITAÇÕES em prosa de `config.tilesets`, escritas '
            + 'para explicar contra o quê o CLIENTE resolve aquelas referências. O arquivo tem '
            + 'zero imports por contrato, então não lê singleton nenhum, e é isso que a '
            + 'discriminação deste censo mede.',
    },
    {
        arquivo: 'src/js/calibration/project-map.js', gatilho: 'catalogo', n: 1, classe: SEM_OVERLAY,
        motivo: 'A página `calibracao.html` lê `config.basemapStyles` para desenhar o mapa de '
            + 'projeto, e ela boota SEM a store e sem o motor de sync — então o overlay de recursos '
            + 'concedidos nunca roda ali, por construção. A consequência está declarada e não é '
            + 'buraco de acesso: o estúdio de calibração vê só o catálogo público, o que é menos '
            + 'dado e nunca mais.',
    },
    {
        arquivo: 'src/js/import_export/local-atlas-to-server.js', gatilho: 'catalogo', n: 1,
        classe: SEM_EIXO,
        motivo: 'FALSO POSITIVO DECLARADO: a chave `analysisLayers` aqui é do DADO DO MAPA que está '
            + 'sendo enviado, não do singleton `config` — o arquivo nem importa o singleton, e é isso '
            + 'que o caso de discriminação mede. O padrão casa a chave e não a origem de propósito: '
            + 'estreitá-lo para evitar este falso positivo esconderia junto um consumidor de verdade.',
    },
    {
        arquivo: 'src/js/projects/local-atlas-notices.js', gatilho: 'catalogo', n: 1,
        classe: SEM_EIXO,
        motivo: 'FALSO POSITIVO DECLARADO, e o padrão casou uma CHAVE DE TABELA DE RÓTULO: '
            + '`settings.basemaps` é o id de uma superfície do relatório de poda do servidor, '
            + 'escrito aqui como chave de `ROTULO_DE_PODA` para que a frase do envio diga '
            + '"camadas de base do catálogo" em vez de imprimir o identificador cru. Entrou em '
            + '2026-09-07, quando a frase passou a ler `summary.prunedResourceRefs`. O que o '
            + 'módulo recebe do servidor é `{superfície: número}`, isto é, CONTAGEM e nunca id de '
            + 'recurso, e o arquivo não importa o singleton `config` nem poderia: ele é folha de '
            + '`atlas.html`, que boota sem a store e sem `initServices()`. É a discriminação deste '
            + 'censo que mede isso.',
    },
    {
        arquivo: 'src/js/projects/send-local-to-server.service.js', gatilho: 'catalogo', n: 1,
        classe: SEM_EIXO,
        motivo: 'FALSO POSITIVO DECLARADO, e o irmão exato de `local-atlas-to-server.js`: a chave '
            + '`analysisLayers` é do DADO DO MAPA que está sendo lido do IndexedDB, não do '
            + 'singleton `config`. O arquivo não importa o singleton, e não pode: ele roda em '
            + '`atlas.html`, que boota sem a store e sem `initServices()`. A poda de referência '
            + 'privada de catálogo deste caminho acontece adiante, dentro de '
            + '`buildServerImportPayload`.',
    },
    {
        arquivo: 'src/js/calibration/api.js', gatilho: 'projetos', n: 1, classe: OUTRO_MODULO,
        motivo: 'HOMÔNIMO, não consumidor: a página de calibração tem cliente HTTP próprio, sem '
            + 'cache nenhum, e não importa o serviço do 360. Desde 2026-08-23 ela compartilha UMA '
            + 'coisa com ele, e só uma: o carimbo de escopo de atlas (`stampAtlasOnUrl`, de '
            + '`tile-scope.js`, folha de zero imports), para que não nasça uma segunda noção de '
            + 'escopo naquela página. Está no censo justamente para que a colisão de nome fique '
            + 'declarada em vez de descoberta por quem for mexer no cache.',
    },
    {
        arquivo: 'src/js/calibration/app.js', gatilho: 'projetos', n: 1, classe: OUTRO_MODULO,
        motivo: 'Chama o `fetchProjects` da linha acima, o da calibração, e não o do 360 do mapa. '
            + 'Mesma razão de inclusão: um censo com homônimo silencioso engana quem o lê.',
    },

    // ================= a terceira fonte: o carimbo de escopo de atlas ========
    {
        arquivo: 'src/js/store/sync/resource-scope.js', gatilho: 'escopo', n: 1,
        classe: DONO_ESCOPO,
        motivo: 'O DONO: ele guarda a identidade do escopo sob o qual o servidor decidiu o que '
            + 'este cliente enxerga, e `currentResourceAtlasId` é a metade que quem precisa MANDAR '
            + 'o atlas ao servidor lê. Quem o escreve é `resource-access.service.js`, e só ele, '
            + 'para que o carimbo e o payload aditivo não possam discordar. Folha de ZERO imports '
            + 'por contrato, porque o leitor dele mora em chunk lazy.',
    },
    {
        arquivo: 'src/js/street_view_tool/tile-scope.js', gatilho: 'escopo', n: 3,
        classe: ESCREVE_CARIMBO,
        motivo: 'A RECEITA: `stampAtlasOnUrl` é o único lugar que decide COMO `?atlasId=` é '
            + 'escrito numa URL, e `stampAtlasOnTiles` a aplica a um spec de fonte do MapLibre. '
            + 'Ele mora sob `street_view_tool/` por história (o MVT do 360 foi o primeiro '
            + 'chamador) e é geral: desde D17 (2026-09-15) o tile do servidor de tiles passa por '
            + 'ele também. Um segundo `?atlasId=` escrito à mão em qualquer lugar é o defeito '
            + 'voltando, porque a regra espalhada por N sítios falha no sítio que ninguém lembrou.',
    },
    {
        arquivo: 'src/js/store/sync/assets3d-request.js', gatilho: 'escopo', n: 3,
        classe: ESCREVE_CARIMBO,
        motivo: 'A SEGUNDA receita, e ela é deliberadamente MAIS ESTREITA que a de cima: '
            + '`escoparUrlDeAsset` recusa endereço de outra ORIGEM, porque no acervo 3D um '
            + 'endereço cross-origin significa TERCEIRO (o `config.url` de catálogo é texto livre '
            + 'digitado por um produtor). A de cima carimba qualquer origem de propósito, porque '
            + 'lá o endereço vem do `/api/config` e nomeia serviço nosso. Duas funções, dois '
            + 'contratos, e trocá-las de lugar vaza ou apaga: está escrito nos dois cabeçalhos.',
    },
    {
        arquivo: 'src/js/map/credencial-de-tile.js', gatilho: 'escopo', n: 3,
        classe: CARIMBA_ESCOPO,
        motivo: 'O `transformRequest` do MapLibre, e a superfície que D17 (2026-09-15) fechou: o '
            + 'tile das DUAS bases credenciadas (o serviço 360 e o servidor de tiles) passou a '
            + 'levar o atlas em foco, sem o que o ramo de empréstimo do predicado do servidor '
            + 'nunca é exercido e a camada que só ele alcança aparece na lista sem desenhar. O '
            + 'carimbo é INDEPENDENTE do cabeçalho de credencial e vale sem sessão, porque é ele '
            + 'que alcança o visitante de link público. Ele NÃO vai a host de terceiro nem a '
            + 'glifo do mesmo host: a comparação é por origem mais fronteira de caminho.',
    },
    {
        arquivo: 'src/js/street_view_tool/streetview-api.service.js', gatilho: 'escopo', n: 6,
        classe: CARIMBA_ESCOPO,
        motivo: 'As catorze rotas de leitura do 360 do mapa, todas montadas por uma função só. É '
            + 'a superfície que ensinou a lição desta fonte: o servidor honrava `?atlasId=` desde '
            + '2026-08-18 e o cliente o escrevia SÓ nos tiles, então o mapa provava que existia '
            + 'uma panorâmica emprestada (um ponto na camada 2D) e todo o resto a recusava.',
    },
    {
        arquivo: 'src/js/street_view_tool/tile-loader.js', gatilho: 'escopo', n: 4,
        classe: CARIMBA_ESCOPO,
        motivo: 'A pirâmide de tiles da panorâmica: o descritor e cada URL resolvida contra ele. '
            + 'O escopo é lido A CADA USO e nunca congelado no load do módulo, porque este '
            + 'arquivo é cópia declarada do `ebgeo_360` e sobrevive a trocas de atlas. É um dos '
            + 'seis trechos de adaptação listados em `.claude/rules/common-tasks.md`.',
    },
    {
        arquivo: 'src/js/first_person_3d_tool/scene-config.service.js', gatilho: 'escopo', n: 3,
        classe: CARIMBA_ESCOPO,
        motivo: 'Os assets da cena caminhável (Gaussian splatting), buscados por `fetch` nosso. '
            + 'Aqui o carimbo é a metade que o cabeçalho não cobre e vice-versa: o `?atlasId=` '
            + 'cobre o EMPRÉSTIMO e sobrevive a um `<img>`; o cabeçalho cobre o papel global e a '
            + 'concessão pessoal, e não sobrevive a endereço de outra origem.',
    },
    {
        arquivo: 'src/js/catalog/components/preview-video.modal.js', gatilho: 'escopo', n: 2,
        classe: CARIMBA_ESCOPO,
        motivo: 'A prévia em vídeo do item de catálogo. `<video src>` é buscado pelo NAVEGADOR, '
            + 'que não carrega `Authorization`, então o `?atlasId=` é a única autorização que '
            + 'atravessa para o recurso emprestado. Desde D14 (2026-09-14) aquele arquivo tem '
            + 'gate de verdade, e sem o carimbo o gate recusa quem só tem o empréstimo.',
    },
    {
        arquivo: 'src/js/catalog/endereco-da-miniatura.js', gatilho: 'escopo', n: 2,
        classe: CARIMBA_ESCOPO,
        motivo: 'A MINIATURA do item de catálogo, lida pelo cartão (catálogo e aba de restrição do '
            + 'atlas) e pelo popup do marcador 3D. `<img src>` é buscado pelo NAVEGADOR, sem '
            + 'cabeçalho, e a miniatura de um modelo privado é CAMPO DE ARQUIVO do índice de regime de '
            + '`/api/v1/assets3d`, então o colega que só tem o empréstimo levava 404 e via o desenho '
            + 'padrão enquanto o modelo abria (relato do dono, 2026-09-22). Data URL e outra origem '
            + 'saem intactos, porque a receita é `escoparUrlDeAsset`.',
    },
    {
        arquivo: 'src/js/session/erro-telemetria.js', gatilho: 'escopo', n: 2,
        classe: CARIMBA_ESCOPO,
        motivo: 'O relato de erro carrega o atlas em foco como CONTEXTO, e não como autorização: '
            + 'é o único desta classe que manda o escopo para uma rota que não serve recurso '
            + 'nenhum. Está no censo por isso, e não apesar disso: ele recebe o leitor como '
            + 'PARÂMETRO com valor padrão, que é a forma que um gatilho exigindo parêntese não '
            + 'veria, e é a razão de o gatilho casar a referência nua.',
    },
    {
        arquivo: 'src/js/calibration/api.js', gatilho: 'escopo', n: 3,
        classe: CARIMBA_ESCOPO,
        motivo: 'O cliente HTTP do estúdio de calibração, que carimba pela MESMA função do mapa '
            + 'para que não nasça uma segunda noção de escopo naquela página. Hoje o valor ali é '
            + 'SEMPRE nulo (a calibração não monta atlas), e isso é de propósito: o dia em que '
            + 'ela abrir um atlas, o carimbo já está no lugar certo.',
    },
    {
        arquivo: 'src/js/calibration/project-map.js', gatilho: 'escopo', n: 5,
        classe: CARIMBA_ESCOPO,
        motivo: 'O mapa de projeto e o minimapa do estúdio, que buscam o descritor de tiles e as '
            + 'imagens dele. A armadilha registrada ali é de URL relativa: `new URL(\'tiles/0/0/0\', '
            + 'base)` NÃO herda a query da base, então cada endereço resolvido precisa do carimbo '
            + 'outra vez, e é por isso que este arquivo tem cinco linhas e não duas.',
    },
];

/** As chaves de `config` que o dono do baseline PRECISA tratar. */
const DONO_DO_BASELINE = 'src/js/store/sync/atlas-settings.service.js';

// ============================================================================
// A VARREDURA
// ============================================================================

/** Remove comentário de bloco e de linha (o `\r` do CRLF entra na normalização). */
function semComentarios(src) {
    const normalizado = src.replace(/\r\n?/g, '\n');
    const semBloco = normalizado.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
    return semBloco.split('\n').map((linha) => linha.replace(/\/\/.*/, '')).join('\n');
}

const lerCodigo = (arquivo) => semComentarios(readFileSync(path.join(RAIZ, arquivo), 'utf8'));

/**
 * O INVENTÁRIO: rastreado MAIS não rastreado não ignorado.
 *
 * `git ls-files src/js` sozinho lista só o que já passou por `git add`, e o ponto cego
 * que isso abre fica no pior lugar possível: o arquivo que a fase corrente acabou de
 * escrever é o que ainda não foi classificado, e era o único que a varredura não via. O
 * censo respondia verde sobre um inventário que não continha o trabalho novo.
 *
 * `--others --exclude-standard` acrescenta o NÃO RASTREADO e mantém fora o IGNORADO
 * (`node_modules/`, `dist/`, `test-results/`, `coverage/`). As duas metades são MEDIDAS —
 * a segunda pelo caso-piso, a primeira pelo controle negativo do fim deste arquivo.
 * @param {string} [pathspec] - Relativo a `frontend/`.
 * @returns {string[]} Caminhos relativos, só `.js`.
 */
function arquivosDoInventario(pathspec = 'src/js') {
    return execFileSync(
        'git',
        ['ls-files', '--cached', '--others', '--exclude-standard', pathspec],
        { cwd: RAIZ, encoding: 'utf8' }
    ).split('\n').map((s) => s.trim()).filter((s) => s.endsWith('.js'));
}

/**
 * As cinco chaves de catálogo de `config`, o par de nomes do cache de projetos, e os quatro
 * nomes do carimbo de escopo.
 *
 * O TERCEIRO CASA A REFERÊNCIA NUA, e não só a chamada, ao contrário do segundo: um consumidor
 * pode receber o leitor de escopo como VALOR e chamá-lo depois (é o que
 * `session/erro-telemetria.js` faz, por parâmetro com valor padrão), e um gatilho que exigisse
 * o parêntese não o veria. O preço é que a linha de `import` também conta, e isso é justo: um
 * arquivo que importa o carimbo é um arquivo que fala escopo com o servidor.
 */
const GATILHOS = {
    catalogo: /\.(tilesets|dataLayers|analysisLayers|basemaps|basemapStyles)\b/,
    projetos: /getCachedProjects\(|fetchProjects\(/,
    escopo: /\b(?:stampAtlasOnUrl|stampAtlasOnTiles|escoparUrlDeAsset|currentResourceAtlasId)\b/,
};

/** A mesma lista do gatilho de catalogo, global, para colher QUAIS grupos a linha le. */
const CHAVES_DE_CATALOGO = /\.(tilesets|dataLayers|analysisLayers|basemaps|basemapStyles)\b/g;

/**
 * Todo contato com uma das duas fontes, por (arquivo, gatilho).
 * @param {string[]} arquivos
 * @returns {Map<string, {arquivo: string, gatilho: string, n: number, linhas: number[], chaves: Set<string>}>}
 */
function contatos(arquivos) {
    const achados = new Map();
    for (const arquivo of arquivos) {
        lerCodigo(arquivo).split('\n').forEach((linha, i) => {
            for (const [gatilho, re] of Object.entries(GATILHOS)) {
                if (!re.test(linha)) continue;
                const chave = `${arquivo}\t${gatilho}`;
                if (!achados.has(chave)) {
                    achados.set(chave, { arquivo, gatilho, n: 0, linhas: [], chaves: new Set() });
                }
                const alvo = achados.get(chave);
                alvo.n += 1;
                alvo.linhas.push(i + 1);
                for (const m of linha.matchAll(CHAVES_DE_CATALOGO)) alvo.chaves.add(m[1]);
            }
        });
    }
    return achados;
}

/** Os pares sem entrada no censo, no formato de mensagem de erro. */
function naoClassificados(achados) {
    return [...achados.values()]
        .filter((a) => !CENSO.some((e) => e.arquivo === a.arquivo && e.gatilho === a.gatilho))
        .map((a) => `${a.arquivo}:${a.linhas.join(',')} (${a.gatilho})`);
}

describe('Censo das superfícies de recurso no cliente (fase F9)', () => {
    it('piso: o inventário vem do git e alcança as duas fontes', () => {
        let arquivos;
        try {
            arquivos = arquivosDoInventario();
        } catch (err) {
            throw new Error(
                `o inventário deste censo vem de \`git ls-files\` e o comando FALHOU (${err.message}). `
                + 'Isto é falha de ambiente, não regressão de código: rode dentro do repositório.'
            );
        }
        expect(arquivos.length).toBeGreaterThanOrEqual(300);
        expect(arquivos).toContain(DONO_DO_BASELINE);
        expect(arquivos).toContain('src/js/street_view_tool/streetview-api.service.js');

        const achados = contatos(arquivos);
        expect(achados.size).toBeGreaterThanOrEqual(20);

        // A OUTRA METADE DO INVENTÁRIO: `--others` SEM `--exclude-standard` arrastaria
        // `node_modules/` e `dist/` inteiros para dentro do censo. A medição é sobre o
        // PACOTE, e não sobre `src/js`, porque ali não há nada ignorado: medir naquele
        // recorte seria vácuo.
        expect(existsSync(path.join(RAIZ, 'node_modules')), 'sem `node_modules` no disco a medição é vácua').toBe(true);
        const doPacote = arquivosDoInventario('.');
        expect(doPacote.length).toBeGreaterThanOrEqual(300);
        expect(doPacote.filter((a) => /(^|[/])(node_modules|dist|coverage|test-results)[/]/.test(a))).toEqual([]);
    });

    it('o inventário ENXERGA arquivo NOVO ainda não rastreado (provado, não afirmado)', () => {
        // O CEGO QUE ESTE CASO FECHA, e ele não é de classificação: é de CONJUNTO.
        // `git ls-files` sozinho enumera o índice, então o consumidor escrito há cinco
        // minutos — que é justamente o que ninguém classificou — ficava fora da varredura
        // até alguém dar `git add`, e o censo passava verde sem tê-lo olhado. Provar a
        // correção exige um arquivo que EXISTA e NÃO esteja rastreado: ele nasce aqui e
        // morre no `finally`. Fica em `tests/fixtures/`, longe de `src/js`, para não
        // aparecer no inventário de nenhum outro guarda enquanto existe.
        const dir = 'tests/fixtures/censo-superficies';
        const relativo = `${dir}/tmp-nao-rastreado.js`;
        const abs = path.join(RAIZ, relativo);
        writeFileSync(abs, [
            `// Path: ${relativo}`,
            '// Temporário: criado e apagado pelo controle negativo deste censo.',
            'export const listar = () => config.tilesets;',
            '',
        ].join('\n'));

        try {
            // CONTROLE: o git precisa CONCORDAR que ele não está rastreado, e precisa
            // enxergar a fixture RASTREADA do mesmo pathspec. Sem este par, o caso passaria
            // verde num mundo em que alguém tivesse dado `git add` no temporário.
            const soRastreados = execFileSync('git', ['ls-files', dir], { cwd: RAIZ, encoding: 'utf8' });
            expect(soRastreados).not.toContain('tmp-nao-rastreado');
            expect(soRastreados).toContain('consumidor-nao-classificado.js');

            const inventario = arquivosDoInventario(dir);
            expect(inventario, 'o inventário precisa enxergar o arquivo NÃO RASTREADO').toContain(relativo);
            expect(inventario, 'e o rastreado precisa continuar dentro: a correção SOMA, não troca')
                .toContain(`${dir}/consumidor-nao-classificado.js`);

            // E A CADEIA INTEIRA, que é o que transforma "o inventário vê" em "o guarda
            // pega": o arquivo novo é varrido e o consumidor dele é ACUSADO, pela MESMA
            // função do caso de classificação acima.
            const acusados = naoClassificados(contatos(inventario));
            expect(acusados.some((a) => a.includes('tmp-nao-rastreado'))).toBe(true);

            // DISCRIMINAÇÃO: a mesma função, sobre o código REAL, não acusa ninguém.
            expect(naoClassificados(contatos(arquivosDoInventario()))).toEqual([]);
        } finally {
            rmSync(abs, { force: true });
        }
    });

    it('todo par (arquivo, fonte) está no censo, com classe e motivo', () => {
        const achados = contatos(arquivosDoInventario());
        expect(achados.size).toBeGreaterThanOrEqual(20);

        expect(naoClassificados(achados)).toEqual([]);
    });

    it('a contagem por entrada bate: apagar uma leitura é tão vermelho quanto acrescentar', () => {
        const achados = contatos(arquivosDoInventario());
        const divergentes = CENSO
            .map((e) => {
                const a = achados.get(`${e.arquivo}\t${e.gatilho}`);
                return { ...e, vistos: a ? a.n : 0 };
            })
            .filter((e) => e.vistos !== e.n)
            .map((e) => `${e.arquivo} (${e.gatilho}) esperava ${e.n}, achei ${e.vistos}`);
        expect(divergentes).toEqual([]);

        const chaves = CENSO.map((e) => `${e.arquivo}\t${e.gatilho}`);
        expect(new Set(chaves).size).toBe(chaves.length);
    });

    it('todo consumidor do catálogo lê o SINGLETON, e o falso positivo declarado não lê', () => {
        // O QUE ISTO PEGA: a cópia. O overlay de recursos concedidos muta o singleton, e
        // some no disconnect; quem tiver guardado uma cópia daquele array continua com o
        // recurso depois do logout, sem erro nenhum e sem nada vermelho.
        const doSingleton = CENSO.filter((e) => [BASELINE, DONO_BASELINE, SEM_OVERLAY].includes(e.classe));
        expect(doSingleton.length).toBeGreaterThanOrEqual(15);

        const semImport = doSingleton
            .filter((e) => !lerCodigo(e.arquivo).includes("config.js'"))
            .map((e) => e.arquivo);
        expect(semImport).toEqual([]);

        // O ESPELHO, e é ele que impede a classe nova de virar porta dos fundos: quem foi
        // classificado como "toca o catálogo SEM o singleton" tem de continuar sem ele. No
        // dia em que um destes importar `config.js`, a classificação está errada e este caso
        // diz qual arquivo é.
        const comImport = CENSO
            .filter((e) => e.classe === SEM_SINGLETON)
            .filter((e) => lerCodigo(e.arquivo).includes("config.js'"))
            .map((e) => e.arquivo);
        expect(comImport).toEqual([]);
        expect(CENSO.filter((e) => e.classe === SEM_SINGLETON).length).toBeGreaterThan(0);

        // DISCRIMINAÇÃO, e sem ela "todos importam" seria só o que se mede numa lista em
        // que todo arquivo importa tudo: o falso positivo declarado NÃO importa o
        // singleton, e é exatamente por isso que ele não é um consumidor.
        const falsoPositivo = CENSO.find((e) => e.classe === SEM_EIXO);
        expect(falsoPositivo).toBeTruthy();
        expect(lerCodigo(falsoPositivo.arquivo)).not.toContain("config.js'");
    });

    it('todo GRUPO de catálogo lido por um consumidor é tratado pelo dono do baseline', () => {
        // A COBRANÇA MAIS FORTE DO ARQUIVO. As chaves não vêm escritas aqui: são colhidas
        // das linhas que a varredura achou. Um grupo novo que alguém passe a ler e que o
        // overlay não trate é um recurso concedido que NUNCA CHEGA (e um revogado que
        // nunca sai) — falha silenciosa, na direção de mostrar dado velho.
        const achados = contatos(arquivosDoInventario());
        const consumidores = CENSO.filter((e) => e.classe === BASELINE);
        expect(consumidores.length).toBeGreaterThanOrEqual(14);

        const lidas = new Set();
        for (const e of consumidores) {
            const a = achados.get(`${e.arquivo}\tcatalogo`);
            if (a) for (const c of a.chaves) lidas.add(c);
        }
        expect(lidas.size).toBeGreaterThanOrEqual(4);

        const dono = lerCodigo(DONO_DO_BASELINE);
        const semTratamento = [...lidas].filter((c) => !dono.includes(c)).sort();
        expect(semTratamento).toEqual([]);
    });

    it('todo consumidor do cache de projetos também está no censo irmão, que cobra a FORMA', () => {
        // ANTI-DERIVA ENTRE OS DOIS CENSOS. Este arquivo prende a EXISTÊNCIA do consumidor;
        // `cache-projetos-consumidores.test.js` prende a FORMA da leitura (miss que rebusca).
        // Sem esta ponte, um consumidor novo poderia entrar num censo e faltar no outro, e
        // os dois passariam verdes.
        const irmao = readFileSync(
            path.join(RAIZ, 'tests/unit/cache-projetos-consumidores.test.js'), 'utf8'
        );
        const doCache = CENSO.filter((e) => [CACHE_360, DONO_CACHE, OUTRO_MODULO].includes(e.classe));
        expect(doCache.length).toBeGreaterThanOrEqual(7);

        const ausentes = doCache
            .filter((e) => !irmao.includes(e.arquivo.replace('src/js/', '')))
            .map((e) => e.arquivo);
        expect(ausentes).toEqual([]);
    });

    it('toda entrada tem classe válida e motivo escrito', () => {
        const classes = [BASELINE, DONO_BASELINE, SEM_OVERLAY, SEM_EIXO, SEM_SINGLETON,
            CACHE_360, DONO_CACHE, OUTRO_MODULO,
            DONO_ESCOPO, ESCREVE_CARIMBO, CARIMBA_ESCOPO];
        const ruins = CENSO
            .filter((e) => !classes.includes(e.classe) || !e.motivo || e.motivo.length < 60)
            .map((e) => `${e.arquivo} (${e.gatilho})`);
        expect(ruins).toEqual([]);

        // Cada fonte tem UM dono, e exatamente um: dois donos é o começo de duas verdades.
        expect(CENSO.filter((e) => e.classe === DONO_BASELINE)).toHaveLength(1);
        expect(CENSO.filter((e) => e.classe === DONO_CACHE)).toHaveLength(1);
        expect(CENSO.filter((e) => e.classe === DONO_ESCOPO)).toHaveLength(1);
    });

    it('as DUAS receitas do carimbo continuam folhas, e o dono do escopo também', () => {
        // O ESPELHO DA TERCEIRA FONTE, e ele não é estilo. Os três arquivos declaram, cada
        // um no próprio cabeçalho, que não importam nada, e a razão é a mesma nos três: os
        // leitores deles moram em chunk lazy e em página que boota sem a store, então um
        // import aqui arrasta o cliente HTTP, o contexto de sessão ou a store inteira atrás
        // de uma pergunta de uma linha. É a propriedade que permite ao carimbo ser UM só
        // para o mapa, para o 360, para o 3D e para a calibração; perdê-la é o começo da
        // segunda cópia, que é o defeito que esta fonte inteira existe para impedir.
        //
        // `resource-scope.js` é zero imports LITERAL. Os outros dois têm import próprio de
        // biblioteca nenhuma: `tile-scope.js` é zero também, e `assets3d-request.js` importa
        // só dentro do próprio store (é ele que precisa do token), então a asserção dele é a
        // mais fraca de propósito e mede o que ele promete: nada de fora de `store/sync/`.
        const folhas = ['src/js/store/sync/resource-scope.js', 'src/js/street_view_tool/tile-scope.js'];
        for (const arquivo of folhas) {
            const imports = lerCodigo(arquivo).match(/^\s*import[\s{'"]/gm) ?? [];
            expect(imports, `${arquivo} precisa continuar sem import nenhum`).toEqual([]);
        }
        const doAsset = [...lerCodigo('src/js/store/sync/assets3d-request.js').matchAll(/from '([^']+)'/g)]
            .map((m) => m[1]);
        expect(doAsset.length, 'a medição de `assets3d-request.js` seria vácua sem import nenhum')
            .toBeGreaterThan(0);
        expect(doAsset.filter((e) => !e.startsWith('./'))).toEqual([]);
    });

    it('a varredura REPROVA um consumidor novo não classificado (provado com fixture)', () => {
        // A MESMA FUNÇÃO dos casos acima, apontada para uma fixture que lê `config.tilesets`
        // e não está no censo. Sem isto, "o censo pega consumidor novo" seria uma afirmação
        // do guarda sobre o guarda.
        const fixture = 'tests/fixtures/censo-superficies/consumidor-nao-classificado.js';
        const achados = contatos([fixture]);
        expect([...achados.values()].map((a) => a.gatilho)).toEqual(['catalogo']);

        const acusados = naoClassificados(achados);
        expect(acusados).toHaveLength(1);
        expect(acusados[0]).toContain('consumidor-nao-classificado.js');

        // E a discriminação: a mesma função, sobre o código REAL, não acusa ninguém.
        expect(naoClassificados(contatos(arquivosDoInventario()))).toEqual([]);
    });
});
