// Path: src/modules/sharing/public-url.js
//
// O ENDEREÇO do link público de um atlas: a base que o administrador configurou mais o parâmetro
// que o cliente consome no boot (`?atlasPublico=`, lido por `openPublicAtlasFromUrl`).
//
// POR QUE ELE É COMPOSTO NO SERVIDOR. Até 2026-09-20 a tela de compartilhamento mostrava e copiava
// o TOKEN cru (32 caracteres hexadecimais), que não é endereço de nada: quem o recebia por
// mensagem não tinha onde colar. A alternativa era compor no cliente a partir de
// `window.location`, e ela não serve por um motivo de implantação (o dono pediu base
// configurável, com o servidor principal como padrão): o atlas é
// publicado de dentro de uma rede (servidor secundário, VPN, host de homologação) e o link é lido
// de FORA dela, então a origem de quem publica é justamente a que o destinatário não alcança. A
// base é fato de implantação, como `app.urlServidorPrincipal`, e mora no mesmo lugar
// (`app.urlBaseLinkPublico`: padrão do env `URL_BASE_LINK_PUBLICO`, override pelo painel).
//
// `publicLink` CONTINUA SENDO O TOKEN, e `publicUrl` é campo NOVO ao lado dele: `GET
// /atlas/public/:link`, a trilha (que guarda só a impressão do token) e as suítes leem o token.
//
// FOLHA de zero imports, para ser testável sem banco.

/** O parâmetro de URL que o boot do mapa consome. Espelha `frontend/src/js/deep-link/`. */
export const PUBLIC_LINK_PARAM = 'atlasPublico';

/**
 * Compõe a URL pública de um atlas.
 *
 * A BASE PODE TER CAMINHO (`https://host/ebgeo`), e ele é preservado: a barra final é normalizada
 * para exatamente uma, porque `https://host/ebgeo?atlasPublico=` cairia noutro recurso do nginx.
 * Query e fragmento da base são DESCARTADOS: a base é onde o app mora, não um estado dele.
 *
 * `null` EM TODA ENTRADA RUIM (sem token, base vazia, base que não é http/https, base que não
 * analisa). O chamador cai então no token cru, que é o comportamento anterior: um endereço
 * montado sobre base inválida seria um link que parece certo e não abre.
 *
 * @param {string|null|undefined} base - `app.urlBaseLinkPublico` do documento efetivo.
 * @param {string|null|undefined} token - `atlas.public_link`.
 * @returns {string|null}
 */
export function composePublicUrl(base, token) {
  if (typeof token !== 'string' || token.trim() === '') return null;
  if (typeof base !== 'string' || base.trim() === '') return null;

  let url;
  try {
    url = new URL(base.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const caminho = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${caminho}/?${PUBLIC_LINK_PARAM}=${encodeURIComponent(token.trim())}`;
}
