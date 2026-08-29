// Path: js/map/credencial-de-tile.js
/**
 * @fileoverview O `transformRequest` que faz a credencial VIAJAR nos tiles do MapLibre.
 *
 * ELE EXISTE POR UM CASO QUE O COOKIE NÃO COBRE. Desde 2026-08-29 o login emite o cookie
 * de sessão, e ele resolve o transporte para quem TEM sessão: o MapLibre monta o pedido
 * sem `credentials`, o Fetch aplica o default `same-origin`, e o cookie viaja sozinho.
 * Sobram dois casos, e o primeiro é decisão de produto:
 *
 *   1. O VISITANTE DE LINK PÚBLICO. O token dele é EFÊMERO e mora só em memória, por
 *      contrato do cliente (`apiClient.setEphemeralToken`): ele não tem cookie, e um
 *      cookie para ele seria pior, porque cookie é por navegador e não por aba, e
 *      sobrescreveria a sessão de quem estivesse logado noutra aba. A cláusula 6.3 da
 *      constituição diz que o empréstimo do atlas alcança esse visitante, e a 6.6 exige
 *      que a tela avise o dono ao publicar o link. Sem este arquivo, a 6.3 fica escrita e
 *      não vale na tela: o visitante não veria a camada privada que o atlas lhe empresta.
 *
 *   2. O DEPLOY CROSS-ORIGIN. Com o serviço noutra origem, `sameSite: 'strict'` retém o
 *      cookie e nem `credentials: 'include'` adiantaria. É a mesma razão pela qual
 *      `sv360TransformRequest` nasceu, e este arquivo generaliza aquele.
 *
 * DUAS BASES, UMA REGRA. Ele carimba em URL do serviço 360 e em URL do servidor de tiles,
 * e a comparação é por ORIGEM e por FRONTEIRA DE CAMINHO, nunca por prefixo de string: com
 * o serviço em `https://tiles.example.mil.br/tiles`, um `startsWith` casaria
 * `https://tiles.example.mil.br.evil.com/tiles` e mandaria o token para o atacante.
 * `URL.origin` responde esquema, host e porta, e não se deixa enganar por nenhum dos dois.
 *
 * A FRONTEIRA DE CAMINHO É A OUTRA METADE: no deploy same-origin o app inteiro divide uma
 * origem, então a origem sozinha carimbaria o token em todo tile de basemap e em toda
 * faixa de glifo que o mesmo host serve. `/tiles` casa, `/tiles/rodovias` casa,
 * `/tilesextra` não.
 *
 * SÍNCRONO, porque o `transformRequest` do MapLibre é. Ele lê o token da memória
 * (`apiClient.getAccessToken()`) em vez de `authHeader()`, que aguardaria uma renovação.
 * Isso não custa nada aqui: o token é lido no instante do PEDIDO, não no da criação do
 * mapa, e o boot restaura a sessão do `localStorage` antes de `createMap()`.
 *
 * O QUE ELE NÃO ALCANÇA, e precisa ficar dito: `img.src` e `<video src>`. Não há API para
 * carimbar cabeçalho neles, e é por isso que o cookie continua sendo o transporte do
 * `img.src` da cena indoor. Para o visitante de link público, que não tem cookie, aquelas
 * fotos seguem sem desenhar.
 *
 * UM RETORNO FALSO É O "DEIXE COMO ESTÁ" DO MAPLIBRE: ele cai de volta em `{ url }`. Então
 * um tile de basemap, uma faixa de glifo ou uma chamada WMS sai daqui intocada.
 */
import config from '../config.js';
import { apiClient } from '@store/sync/api-client.js';

/**
 * Uma base configurada como `URL`, ou `null` quando ela não existe.
 *
 * @param {string|undefined} bruto
 * @returns {URL|null}
 */
function base(bruto) {
    if (typeof bruto !== 'string' || bruto === '') return null;
    try {
        return new URL(bruto, window.location.origin);
    } catch {
        return null;
    }
}

/** As bases que recebem a credencial, lidas do `/api/config` a cada chamada. */
function basesCredenciadas() {
    return [
        base(config.streetView360?.serviceUrl),
        base(config.services?.tileServerUrl),
    ].filter(Boolean);
}

/**
 * Se a URL cai sob alguma das bases credenciadas, por ORIGEM e por FRONTEIRA DE CAMINHO.
 *
 * @param {string} url - A URL já substituída que o MapLibre vai pedir.
 * @returns {boolean}
 */
export function ehUrlCredenciada(url) {
    if (typeof url !== 'string' || url === '') return false;

    let alvo;
    try {
        alvo = new URL(url, window.location.origin);
    } catch {
        return false;
    }
    // `origin` é a string opaca "null" para `blob:` e `data:`, que não é origem http(s)
    // nenhuma e portanto nunca casa uma base.
    if (alvo.origin === 'null') return false;

    return basesCredenciadas().some((b) => {
        if (alvo.origin !== b.origin) return false;
        const raiz = b.pathname.replace(/\/+$/, '');
        if (raiz === '') return true;
        return alvo.pathname === raiz || alvo.pathname.startsWith(`${raiz}/`);
    });
}

/**
 * O `transformRequest` a passar a toda construção de mapa que precise ver dado privado.
 *
 * @param {string} url - A URL que o MapLibre quer.
 * @returns {{url: string, headers: Object}|undefined}
 */
export function credencialDeTile(url) {
    if (!ehUrlCredenciada(url)) return undefined;
    const token = apiClient?.getAccessToken?.();
    if (!token) return undefined;
    return { url, headers: { Authorization: `Bearer ${token}` } };
}
