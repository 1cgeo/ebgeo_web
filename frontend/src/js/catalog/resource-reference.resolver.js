// Path: js/catalog/resource-reference.resolver.js

/**
 * @fileoverview Quem responde "este id é público?" para a poda de saída.
 *
 * DUAS FONTES, E NENHUMA DELAS É A REDE. O singleton `config` diz o que existe no
 * catálogo alcançável por este usuário (o público do deploy MAIS o privado que o servidor
 * somou), e `isPrivateResource` diz qual metade é privada. A interseção é a resposta:
 * está no `config` e não é privado -> `public`; é privado -> `private`; não está no
 * `config` -> `unknown`, porque o cliente não sabe distinguir "não existe" de "existe e
 * não é meu", e as duas saem pela mesma porta.
 *
 * A RECUSA DE RODAR ÀS CEGAS É PARTE DA FUNÇÃO, e não um detalhe de robustez. A soma dos
 * recursos privados (`refreshVisibleResources`) é BEST-EFFORT por desenho: ela engole o
 * próprio erro e devolve `false`, porque uma falha ali não pode derrubar o login. Se a
 * poda rodasse depois de uma soma que falhou, todo recurso privado LEGÍTIMO cairia em
 * `unknown` (o `config` não teria as linhas somadas), e a cópia sairia sem o acervo a que
 * o usuário tem direito — num caminho IRREVERSÍVEL, porque o `.ebgeo` já foi baixado e o
 * atlas local já foi criado. Por isso: com sessão viva e soma nunca realizada, esta
 * função LANÇA, e o chamador não cria slot nenhum. Sem sessão não há o que somar, e aí a
 * ausência é o estado correto (o visitante anônimo só alcança o catálogo público).
 *
 * O 360 NÃO É RESOLVÍVEL AQUI, e isso é decisão registrada, não buraco: a referência
 * gravada é o NOME DA FOTO e não existe mapa local foto -> projeto. Resolver por rede foi
 * recusado pelo dono (degrada fechado e apagaria 360 público por acidente de rede numa
 * exportação grande), e carregar o projeto junto da referência resolveria só o dado novo.
 * Fica a saída 3: `views360` responde sempre `unknown`, o 360 sai inteiro, e o aviso ao
 * usuário diz isso. O `fileoverview` de `private-reference-pruner.js` guarda o mesmo
 * registro do lado de quem executa.
 */

import config from '../config.js';
import { RefVerdict } from './private-reference-pruner.js';
import { RESOURCE_REF_GROUP } from './resource-reference.registry.js';
import { _grantedScope, isPrivateResource, retryVisibleResources } from '../store/sync/resource-access.service.js';
import { sessionContext } from '../store/sync/session-context.js';

/**
 * Erro de pré-condição da poda: a soma nunca aconteceu e há sessão viva.
 *
 * Subclasse nomeada para que o chamador possa distinguir esta recusa de um defeito
 * qualquer e dizer ao usuário o que fazer (reconectar), em vez de mostrar "erro ao
 * exportar".
 */
export class ResourceSumMissingError extends Error {
    constructor() {
        super('A lista de recursos privados ainda não foi carregada nesta sessão. '
            + 'Reconecte ao servidor antes de exportar ou salvar como local.');
        this.name = 'ResourceSumMissingError';
    }
}

/**
 * Os ids que o `config` lista, por grupo. UMA leitura por grupo, no instante da
 * construção: o resolver devolvido é síncrono e não volta ao singleton, e isso é
 * deliberado — a poda inteira precisa ver o mesmo retrato do catálogo do começo ao fim.
 * @returns {Object<string, Set<string>>}
 */
function idsDoCatalogo() {
    const ids = (lista) => new Set((Array.isArray(lista) ? lista : []).map((i) => String(i?.id)));
    return {
        [RESOURCE_REF_GROUP.BASEMAPS]: new Set(Object.keys(config.basemaps ?? {})),
        [RESOURCE_REF_GROUP.TILESETS]: ids(config.tilesets),
        [RESOURCE_REF_GROUP.DATA_LAYERS]: ids(config.dataLayers?.layers),
        [RESOURCE_REF_GROUP.ANALYSIS_LAYERS]: ids(config.analysisLayers?.layers),
    };
}

/**
 * Constrói o resolver SÍNCRONO que a poda de saída consome.
 *
 * A FUNÇÃO É ASSÍNCRONA E O RESOLVER NÃO: o `await` está aqui só para a tentativa única de
 * refazer a soma, antes de desistir. Depois disso a poda inteira roda contra um retrato
 * fixo do catálogo, síncrono do começo ao fim.
 *
 * POR QUE A TENTATIVA, e ela não é robustez decorativa. `disconnect()` (`sync-engine.js`)
 * apaga a soma e dispara a substituta sem `await`, engolindo o erro dela. Um usuário
 * CONECTADO que saísse do atlas e clicasse em "Exportar" no instante seguinte — ou depois
 * de uma re-soma que falhou por rede, e aí para sempre naquela sessão — recebia
 * "Reconecte ao servidor", que é um diagnóstico falso: ele está conectado. A recusa
 * continua existindo, e continua sendo a decisão certa quando não há soma; o que muda é
 * que ela deixa de ser disparada por uma janela de corrida cuja única consequência
 * registrada era um `.catch(() => {})`.
 *
 * @returns {Promise<(grupo: string, id: string) => string>} `(grupo, id) => RefVerdict`.
 * @throws {ResourceSumMissingError} Com sessão viva e nenhuma soma bem-sucedida, INCLUSIVE
 *   depois da tentativa.
 */
export async function construirResolverDeSaida() {
    if (sessionContext.isAuthenticated() && _grantedScope() === undefined) {
        await retryVisibleResources();
        if (_grantedScope() === undefined) throw new ResourceSumMissingError();
    }

    const conhecidos = idsDoCatalogo();

    return function resolverDeSaida(grupo, id) {
        if (grupo === RESOURCE_REF_GROUP.VIEWS_360) return RefVerdict.UNKNOWN;
        if (isPrivateResource(grupo, id)) return RefVerdict.PRIVATE;
        const doGrupo = conhecidos[grupo];
        if (!doGrupo) return RefVerdict.UNKNOWN;
        return doGrupo.has(String(id)) ? RefVerdict.PUBLIC : RefVerdict.UNKNOWN;
    };
}

/**
 * O nome de exibição de um recurso perdido, quando o cliente já o tem, ou null.
 *
 * A DECISÃO SOBRE O AVISO, escrita aqui porque é aqui que ela é implementável: o aviso
 * CONTA tudo e NOMEIA só o que já está no `config`. Um nome que o cliente já carrega não é
 * informação nova para quem está exportando (o documento é dele), e um id cru — que para o
 * 360 é o nome do arquivo da foto — não diz nada a ninguém, então nomear o irresolúvel
 * seria despejar metadado sem ganho de compreensão. Contagem por superfície é o que o
 * servidor registra na trilha; nome nenhum sai do cliente.
 *
 * @param {string} grupo
 * @param {string} id
 * @returns {string|null}
 */
export function nomeDeRecursoConhecido(grupo, id) {
    const alvo = String(id);
    if (grupo === RESOURCE_REF_GROUP.BASEMAPS) return config.basemaps?.[alvo]?.name ?? null;
    const lista = grupo === RESOURCE_REF_GROUP.TILESETS ? config.tilesets
        : (grupo === RESOURCE_REF_GROUP.DATA_LAYERS ? config.dataLayers?.layers
            : (grupo === RESOURCE_REF_GROUP.ANALYSIS_LAYERS ? config.analysisLayers?.layers : null));
    if (!Array.isArray(lista)) return null;
    return lista.find((i) => String(i?.id) === alvo)?.name ?? null;
}

/**
 * Rótulo em pt-BR de cada superfície, para o aviso ao usuário.
 *
 * Escrito em termos do que a pessoa VÊ (uma camada, um marcador, um slide), e não em
 * termos do documento: quem está exportando não sabe o que é `cesium3d.viewsheds`.
 */
const ROTULO_DE_SUPERFICIE = Object.freeze({
    'mapa.baseLayer': 'camada de base (volta para a padrão)',
    'mapa.catalogLayers': 'camada(s) de catálogo',
    'cesium3d.cameraPositions': 'posição(ões) de câmera 3D',
    'cesium3d.markers': 'marcador(es) 3D',
    'cesium3d.measurements': 'medição(ões) 3D',
    'cesium3d.viewsheds': 'bacia(s) de visada 3D',
    'sv360.orientations': 'orientação(ões) de foto 360',
    'sv360.markers': 'marcador(es) em foto 360',
    'briefing.slide.modelId': 'slide(s) com modelo 3D (viram slide de mapa)',
    'briefing.slide.photoId': 'slide(s) com foto 360 (viram slide de mapa)',
    // SÓ O SERVIDOR ANOTA ESTA, e ela chegou aqui quando o relato de poda do CLONE passou a ser
    // mostrado. Ela é de `atlas.settings`, superfície que existe apenas do lado do servidor (o
    // cliente a recebe no snapshot e nunca a persiste), e é id ÚNICO, não lista: cai de volta
    // para o padrão em vez de esvaziar.
    'settings.default_basemap': 'mapa base padrão do atlas (volta para o padrão)',
});

/**
 * O cabeçalho de cada NATUREZA de perda, na ordem em que o aviso as mostra.
 *
 * AS DUAS SAEM PELA MESMA PORTA E NÃO SÃO A MESMA NOTÍCIA, e é por isso que o relatório
 * carrega o veredito por perda desde sempre (`RefVerdict`) enquanto o aviso o ignorava.
 * "Restrito" é uma afirmação sobre o ACESSO de quem exporta, e ela é falsa para o visitante
 * ANÔNIMO: sem sessão nada é privado para este cliente (`isPrivateResource` responde `false`
 * para tudo), então cem por cento do que ele perde é `unknown`. Dizer a ele que perdeu
 * recurso restrito é ensinar errado o modelo de acesso do produto na única tela em que ele o
 * encontra, e ainda por cima com cara de acusação.
 */
const CABECALHO_DE_NATUREZA = Object.freeze({
    [RefVerdict.PRIVATE]: 'Por restrição de acesso:',
    [RefVerdict.UNKNOWN]: 'Por não dar para confirmar, fora do servidor, que é público:',
});

/**
 * A nota do 360, escrita só quando há 360 na lista do desconhecido.
 *
 * ELA É A METADE QUE FALTAVA DO AVISO. O 360 responde `unknown` SEMPRE, por decisão
 * registrada (a referência gravada é o nome da foto, e o mapa foto -> projeto só existe no
 * servidor), então uma foto PÚBLICA sai igual. Sem esta linha, quem exporta lê a contagem de
 * 360 dentro de uma lista de perdas e conclui que tocou em algo restrito.
 */
const NOTA_360 = 'Toda foto 360 entra nesta lista, inclusive a pública.';

/** @private Uma linha do aviso: contagem, rótulo em pt-BR e até três nomes. */
function linhaDePerda(superficie, quantos, nomes) {
    const rotulo = ROTULO_DE_SUPERFICIE[superficie] ?? superficie;
    const amostra = nomes.slice(0, 3).join(', ');
    const resto = nomes.length > 3 ? ` e mais ${nomes.length - 3}` : '';
    return `• ${quantos} ${rotulo}${nomes.length ? ` (${amostra}${resto})` : ''}`;
}

/** @private Os nomes que o `config` sabe resolver, agrupados por superfície. */
function nomesPorSuperficieDe(nomeados) {
    const mapa = new Map();
    for (const perda of nomeados) {
        const nome = nomeDeRecursoConhecido(perda?.grupo, perda?.id);
        if (!nome) continue;
        if (!mapa.has(perda.superficie)) mapa.set(perda.superficie, new Set());
        mapa.get(perda.superficie).add(nome);
    }
    return mapa;
}

/**
 * @private A lista ÚNICA, sem separar naturezas: o aviso de antes desta divisão.
 *
 * É o desfecho de todo relatório que não traz veredito por perda, e o principal deles não é
 * legado: o relatório do SERVIDOR (`descreverPerdasDoServidor`) manda só contagem por
 * superfície, de propósito. Inventar uma natureza ali seria afirmar o que ninguém mediu.
 */
function listaUnica(relatorio, nomesPorSuperficie) {
    const linhas = [];
    for (const [superficie, quantos] of Object.entries(relatorio.porSuperficie ?? {})) {
        linhas.push(linhaDePerda(superficie, quantos, [...(nomesPorSuperficie.get(superficie) ?? [])]));
    }
    return linhas.join('\n');
}

/**
 * O texto do aviso de perda, ou null quando não se perdeu nada.
 *
 * CONTA TUDO E NOMEIA O QUE DÁ: cada superfície entra com a contagem, e os nomes que o
 * `config` já carrega vão entre parênteses, com teto de três mais "e mais N". Id cru nunca
 * aparece — ele não informa quem lê e, no caso do 360, é o nome do arquivo da foto.
 *
 * E SEPARA AS DUAS NATUREZAS, quando o relatório as traz: o restrito de quem exporta em um
 * bloco, o não classificável no outro, cada um com o seu porquê. A divisão é TUDO OU NADA —
 * ou toda perda traz veredito conhecido, ou o aviso volta à lista única —, porque um bloco
 * "por restrição" que contivesse metade das perdas restritas mentiria por omissão, que é
 * pior do que a lista indiferenciada que ele substitui.
 *
 * @param {{porSuperficie: Object<string, number>, nomeados: Array, total: number}} relatorio
 * @returns {string|null}
 */
export function descreverPerdas(relatorio) {
    if (!relatorio || relatorio.total === 0) return null;

    const nomeados = Array.isArray(relatorio.nomeados) ? relatorio.nomeados : [];
    const nomesPorSuperficie = nomesPorSuperficieDe(nomeados);

    // A NATUREZA VEM DE `nomeados` E A CONTAGEM CONTINUA VINDO DE `porSuperficie`: as duas
    // são escritas na mesma passada por `anotar` (`private-reference-pruner.js`), então
    // discordarem é sinal de relatório de outra procedência, e não de defeito a contornar.
    const porChave = new Map();
    const nomesPorChave = new Map();
    const superficiesVistas = [];
    let classificadas = 0;
    let temFoto360 = false;

    for (const perda of nomeados) {
        const veredito = perda?.veredito;
        if (veredito !== RefVerdict.PRIVATE && veredito !== RefVerdict.UNKNOWN) continue;
        classificadas += 1;

        const superficie = perda.superficie;
        const chave = `${veredito}|${superficie}`;
        if (!porChave.has(chave)) superficiesVistas.push(superficie);
        porChave.set(chave, (porChave.get(chave) ?? 0) + 1);

        const nome = nomeDeRecursoConhecido(perda.grupo, perda.id);
        if (nome) {
            if (!nomesPorChave.has(chave)) nomesPorChave.set(chave, new Set());
            nomesPorChave.get(chave).add(nome);
        }
        if (veredito === RefVerdict.UNKNOWN && perda.grupo === RESOURCE_REF_GROUP.VIEWS_360) {
            temFoto360 = true;
        }
    }

    if (classificadas !== relatorio.total) return listaUnica(relatorio, nomesPorSuperficie);

    // A ordem de superfície é a de `porSuperficie`, e o que sobrar entra depois: nenhuma
    // perda contada pode sumir da tela por não ter lugar na ordem.
    const ordem = [...Object.keys(relatorio.porSuperficie ?? {})];
    for (const superficie of superficiesVistas) {
        if (!ordem.includes(superficie)) ordem.push(superficie);
    }

    const secoes = [];
    for (const natureza of [RefVerdict.PRIVATE, RefVerdict.UNKNOWN]) {
        const linhas = [];
        for (const superficie of ordem) {
            const chave = `${natureza}|${superficie}`;
            const quantos = porChave.get(chave);
            if (!quantos) continue;
            linhas.push(linhaDePerda(superficie, quantos, [...(nomesPorChave.get(chave) ?? [])]));
        }
        if (linhas.length === 0) continue;
        if (natureza === RefVerdict.UNKNOWN && temFoto360) linhas.push(NOTA_360);
        secoes.push([CABECALHO_DE_NATUREZA[natureza], ...linhas].join('\n'));
    }

    if (secoes.length === 0) return listaUnica(relatorio, nomesPorSuperficie);
    return secoes.join('\n\n');
}

/**
 * O texto de perda a partir do relatório que o SERVIDOR devolve, ou null quando nada foi podado.
 *
 * POR QUE UMA SEGUNDA PORTA, E NÃO UM SEGUNDO TEXTO. As duas podas existem e são diferentes (fora
 * do servidor a regra é keep-list, dentro dele é por destinatário, decidida em SQL), mas o que a
 * pessoa precisa ler é o mesmo: quanta coisa e de que tipo ficou de fora. O que muda é só a FORMA
 * do relatório, então o que se adapta é a forma, e a frase continua tendo uma implementação só.
 *
 * O servidor manda `{ superfície: contagem }` (`pruner.report`, `atlas-resource-prune.js`), sem
 * ids e sem nomes, e isso é deliberado lá: o resumo volta ao cliente e vai para a trilha, e o nome
 * de um recurso privado é metadado do recurso. Por isso a saída aqui nunca traz nomes entre
 * parênteses, ao contrário do caminho de exportação, onde eles vêm do `config` local — e pelo
 * mesmo motivo ela nunca separa "restrito" de "não classificável": sem `nomeados` não há
 * veredito por perda, e a poda de LÁ é por destinatário, não keep-list.
 *
 * @param {Object|null|undefined} pruneReport - `{ [superficie]: number }`.
 * @returns {string|null}
 */
export function descreverPerdasDoServidor(pruneReport) {
    if (!pruneReport || typeof pruneReport !== 'object') return null;
    const porSuperficie = {};
    let total = 0;
    for (const [superficie, quantos] of Object.entries(pruneReport)) {
        const n = Number(quantos);
        if (!Number.isFinite(n) || n <= 0) continue;
        porSuperficie[superficie] = n;
        total += n;
    }
    if (total === 0) return null;
    // `nomeados` vazio de propósito: o servidor não manda ids, e inventar nomes aqui seria
    // afirmar o que ninguém mediu.
    return descreverPerdas({ total, porSuperficie, nomeados: [] });
}
