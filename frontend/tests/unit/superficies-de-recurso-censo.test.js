// Path: tests/unit/superficies-de-recurso-censo.test.js
//
// O CENSO DAS SUPERFÍCIES DE RECURSO NO CLIENTE — a metade de cá.
//
// O irmão de backend (`backend/tests/unit/superficies-de-recurso-censo.test.js`) cobra
// que toda consulta e toda rota de leitura declarem o predicado que as cobre. Aqui a
// pergunta é a simétrica e é DIFERENTE: no cliente não existe predicado nenhum, existe
// UMA fonte de verdade por família, e o defeito é ler fora dela.
//
// AS DUAS FONTES, e é só isso que este arquivo mede:
//
//   1. O SINGLETON `config` — o catálogo do deploy, hidratado por `GET /api/config` no
//      boot. Ele é MUTADO por `mergeGrantedIntoBaseline` quando o servidor diz o que
//      mais aquele usuário alcança (por concessão pessoal ou por empréstimo do atlas em
//      foco), e desmutado por `revertGrantedResources` no disconnect. Quem lê o
//      singleton recebe e perde o recurso concedido sem saber que ele existe — que é
//      exatamente o desenho. Quem guarda uma CÓPIA fica com o recurso depois do logout.
//   2. O CACHE DE PROJETOS 360 de `streetview-api.service.js`, que desde a fase F9 é
//      CHAVEADO POR ESCOPO `(usuário, atlas em foco)`.
//
// O MODO DE FALHA QUE ISTO PEGA é o inverso do de servidor, e é mais silencioso: no
// servidor um filtro que falta VAZA; aqui um consumidor que lê fora da fonte fica com
// dado VELHO — o recurso concedido some da tela (parece um bug de UI) ou, pior, o
// recurso emprestado por um atlas continua visível depois de sair dele, e nada fica
// vermelho porque uma lista é uma resposta bem-formada nos dois casos.
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

/** Classes da família do cache de projetos 360. */
const CACHE_360 = 'consome-o-cache-de-projetos';
const DONO_CACHE = 'dono-do-cache-de-projetos';
const OUTRO_MODULO = 'homonimo-da-calibracao';

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
        arquivo: 'src/js/config.helpers.js', gatilho: 'catalogo', n: 7, classe: BASELINE,
        motivo: 'Os ajudantes de basemap (`getEnabledBasemaps`, `getValidBasemapFallback`, '
            + '`validateBasemapsConfig`) e a checagem de tilesets. É a superfície do BASEMAP, que '
            + 'virou o quinto tipo de recurso concedível na migração 021: o basemap privado '
            + 'concedido entra por aqui, e o estilo dele viaja numa segunda chave.',
    },
    {
        arquivo: 'src/js/baselayers/base-layer.control.js', gatilho: 'catalogo', n: 3,
        classe: BASELINE,
        motivo: 'O seletor de camada base, que resolve o estilo por demanda contra '
            + '`config.basemapStyles`. Montar a tabela de estilos no construtor (como fazia antes da '
            + 'F9) faz o clique num basemap concedido cair silenciosamente noutra camada, porque o '
            + 'concedido chega DEPOIS do boot. A TERCEIRA leitura entrou em 2026-08-24 e é de '
            + 'NOME, não de estilo: quando o basemap pedido não resolve, `switchLayer` acusa a '
            + 'falha nomeando a camada (`config.basemaps[layer].name`) antes de cair no fallback. '
            + 'Ela é o oposto de um vazamento: é o que faz a queda silenciosa descrita acima '
            + 'deixar de ser silenciosa. Nomear é possível AQUI e só aqui, porque quem pediu '
            + 'ainda está na variável, antes da reatribuição.',
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
        arquivo: 'src/js/3d_models_viewer_tool/map_3d.js', gatilho: 'catalogo', n: 4,
        classe: BASELINE,
        motivo: LE_TILESETS
            + ' A QUARTA leitura entrou em 2026-08-24 e é de NOME, não de estilo nem de URL: '
            + 'quando o modelo não carrega, `openViewerWithTileset` acusa a falha nomeando-o '
            + 'antes de relançar. É a mesma forma já declarada acima para '
            + '`base-layer.control.js`, e o oposto de um vazamento: sem ela o tileset privado '
            + 'emprestado a um visitante de link público some da cena sem uma palavra. O modelo '
            + '3D tem DOIS caminhos de falha e este cobre um; o outro (todos os filhos `.b3dm` '
            + 'recusados enquanto a raiz responde 200) não passa por aqui, não rejeita nada e só '
            + 'existe como evento `tileFailed`, que não lê o catálogo.',
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
    { arquivo: 'src/js/briefing/editor/briefing-editor.control.js', gatilho: 'catalogo', n: 4, classe: BASELINE, motivo: LE_TILESETS },
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
        arquivo: 'src/js/catalog/resource-reference.resolver.js', gatilho: 'catalogo', n: 8,
        classe: BASELINE,
        motivo: 'Quem responde "este id é público?" para a PODA DE SAÍDA (o `.ebgeo` e o "Salvar '
            + 'como local"). Lê os quatro grupos do singleton no instante em que o resolver é '
            + 'construído — uma vez, e o resolver devolvido não volta ao singleton, para que a '
            + 'poda inteira veja o mesmo retrato do começo ao fim. É o consumidor com a '
            + 'consequência mais cara de um miss: a regra é KEEP-LIST, então um recurso que o '
            + 'overlay não somou vira `unknown` e SAI da cópia, num caminho irreversível. É por '
            + 'isso que ele se recusa a rodar quando a soma nunca aconteceu com sessão viva.',
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

/** As cinco chaves de catálogo de `config`, e o par de nomes do cache de projetos. */
const GATILHOS = {
    catalogo: /\.(tilesets|dataLayers|analysisLayers|basemaps|basemapStyles)\b/,
    projetos: /getCachedProjects\(|fetchProjects\(/,
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
        const classes = [BASELINE, DONO_BASELINE, SEM_OVERLAY, SEM_EIXO, CACHE_360, DONO_CACHE, OUTRO_MODULO];
        const ruins = CENSO
            .filter((e) => !classes.includes(e.classe) || !e.motivo || e.motivo.length < 60)
            .map((e) => `${e.arquivo} (${e.gatilho})`);
        expect(ruins).toEqual([]);

        // Cada fonte tem UM dono, e exatamente um: dois donos é o começo de duas verdades.
        expect(CENSO.filter((e) => e.classe === DONO_BASELINE)).toHaveLength(1);
        expect(CENSO.filter((e) => e.classe === DONO_CACHE)).toHaveLength(1);
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
