// Path: src/modules/config/config.admin.schemas.js
import Joi from 'joi';

/**
 * Editable config sections for the admin "Sistema" tab. The headline fields keep their TYPE checks,
 * but each section is `.unknown(true)` so an admin can also override the advanced keys not surfaced
 * as form fields (map2d.terrainSource/hillshade/bounds, map3d.initialCamera/providers/bounds,
 * streetView360 sources, the global enabled flags, …) via the "Avançado (JSON)" editor. At least one
 * section must be present.
 *
 * Unknown TOP-LEVEL keys are rejected (422) — basemaps/tilesets/layers have their own /resources
 * CRUD and must not be injected through here. That takes `.prefs({ stripUnknown: false })`, because
 * the `validate` middleware runs every schema with `stripUnknown: true`: this comment claimed
 * rejection while the middleware quietly DELETED the offending section and answered 200. The editor
 * is free-form JSON and a mistyped section name ("map2D", "feature") is the likeliest mistake there
 * is, so the admin was told the save worked while half the payload was discarded.
 *
 * The preference is set on the TOP-LEVEL object only in effect: each section declares `.unknown(true)`
 * explicitly, which outranks `stripUnknown` in Joi, so the advanced keys inside a KNOWN section still
 * pass through untouched (verified: `{ app: { title, advKey } , bogus: {} }` errors on `bogus` while
 * keeping `advKey`).
 */
export const configOverridesSchema = Joi.object({
  app: Joi.object({
    title: Joi.string().max(100),
    tutorialUrl: Joi.string().max(500).allow(''),
    // O par do aviso de servidor secundário (2026-09-03). O padrão vem do env
    // (`AVISO_SERVIDOR_SECUNDARIO` e `URL_SERVIDOR_PRINCIPAL`, lidos no BOOT) e o override
    // vence sobre ele na fusão, o que dá ao administrador um jeito de desligar a tela sem
    // reiniciar o processo.
    //
    // DECLARAR NÃO CRIA A CAPACIDADE, dá BORDA a ela: este objeto é `.unknown(true)`, então o
    // editor "Avançado (JSON)" já gravava as duas chaves, sem checagem nenhuma. Um `"sim"`
    // digitado ali virava string no documento efetivo, e o cliente lê a chave por `=== true`,
    // então a tela ficaria desligada em silêncio, com o painel mostrando o valor salvo. Agora
    // morre em 422 na borda, que é a mesma recusa que o parse do env faz.
    avisoServidorSecundario: Joi.boolean(),
    urlServidorPrincipal: Joi.string().uri().max(500),
  }).unknown(true),
  features: Joi.object({
    map_3d: Joi.boolean(),
    imagens_panoramicas: Joi.boolean(),
    grid: Joi.boolean(),
    apisearch: Joi.boolean(),
    // Runtime self-registration toggle (2026-08-29). Overrides the ALLOW_SELF_REGISTRATION env
    // default; the served `features.self_registration` and the `/auth/register` gate both read
    // the merged value. `password_reset_email` is NOT here: it mirrors SMTP config, frozen at boot.
    self_registration: Joi.boolean(),
  }).unknown(true),
  // A FAIXA DE ZOOM DA APLICAÇÃO SAIU DAQUI em 2026-08-31, por decisão do dono: ela é fixa em
  // [2, 21] (`config.static.js`, `MAP2D_BASE`) e o único nível ajustável passou a ser o do MAPA
  // BASE, na linha de catálogo dele.
  //
  // `forbidden()` E NÃO OMISSÃO, e a diferença aqui é a que decide se a norma existe: este
  // objeto é `.unknown(true)`, então apenas apagar as duas linhas as deixaria passar como
  // qualquer chave desconhecida e gravá-las em `config_settings`, que é DEEP-MERGE sobre o
  // documento montado, e portanto voltaria a derrubar o valor fixo, em silêncio e para sempre.
  // Valor fixo que um documento gravado derruba não é fixo. É o mesmo gesto de
  // `catalog.schemas.js` com `previewVideo`, e pela mesma razão.
  //
  // Sem `.messages()`: a tradução das falhas de validação é feita no EDGE, por tipo de erro
  // (`utils/validation-messages.js`), e um texto escrito aqui seria descartado ali.
  //
  // Some junto o `.custom('min<=max')`, que ficou sem o que cruzar: as duas pontas que ele
  // comparava não entram mais no documento de override.
  map2d: Joi.object({
    minZoom: Joi.any().forbidden(),
    maxZoom: Joi.any().forbidden(),
    maxPitch: Joi.number().min(0).max(85),
    globe_projection: Joi.boolean(),
    // O NÍVEL DE DETALHE DOS TILES COM A CÂMERA INCLINADA (2026-09-04). Declarar não cria a
    // capacidade, dá BORDA a ela: este objeto é `.unknown(true)`, então o editor "Avançado
    // (JSON)" já gravava a chave sem checagem nenhuma, e um `[1, 10]` salvo ali pedia cerca
    // de doze vezes os tiles do padrão a 60 graus de inclinação, em toda máquina, para
    // sempre. O cliente recusa o mesmo par com aviso no console (`map/tile-lod.js`), e a
    // recusa aqui é a que impede o valor de existir.
    //
    // `null` é resposta de primeira classe, e é o que `config.static.js` serve: mantém o
    // padrão do MapLibre, `(9.314, 3)`, que é o mais leve. O piso de 2 no primeiro valor é o
    // ponto em que a queda do zoom rumo ao horizonte para de existir.
    //
    // `ordered` e não `items`: as duas posições têm regras diferentes, e um par de três
    // números não é um par. Sem `.messages()`, como as vizinhas: a tradução é do edge.
    sourceTileLodParams: Joi.array()
      .ordered(Joi.number().min(2).required(), Joi.number().min(1).required())
      .allow(null),
    // A BASE PREFERIDA COM O TERRENO LIGADO (2026-09-05), e o recorte que ela cobre. Declarar
    // não cria a capacidade, dá BORDA a ela: `map2d` é `.unknown(true)`, então o editor
    // "Avançado (JSON)" já gravava as duas chaves sem checagem nenhuma.
    //
    // O QUE O ID NÃO CHECA é se ele EXISTE no catálogo, e a omissão é a MESMA de
    // `streetView360.miniMapBasemap`, por escrito ali: o catálogo muda por outra rota, então
    // um mapa base apagado depois deixaria a configuração inválida sem que ninguém salvasse
    // nada. Quem resolve é o cliente, que só troca para um id presente em
    // `BaseLayerControl.availableBasemaps` e ignora os outros. O que se checa aqui é a FORMA:
    // um id é um slug de catálogo (`VARCHAR(100)`), e `null` desliga.
    terrainPreferredBasemap: Joi.string().trim().max(100).allow('', null),
    // `.custom()` E NÃO SÓ QUATRO BORDAS SOLTAS, pela mesma razão de `catalog.schemas.js`: a
    // inversão (`oeste > leste`, `sul > norte`) é a única falha que nenhuma das quatro posições
    // vê sozinha, e é a que produz o pior estado. O cliente recusa a caixa invertida INTEIRA
    // (`terrain-basemap.model.js`, que não trata antimeridiano porque nada no produto trata),
    // então gravá-la desligaria a troca em silêncio, com o painel exibindo o valor salvo. Sem
    // `.messages()`, como as vizinhas: a tradução é do edge.
    terrainPreferredBasemapBounds: Joi.array()
      .ordered(
        Joi.number().min(-180).max(180).required(),
        Joi.number().min(-90).max(90).required(),
        Joi.number().min(-180).max(180).required(),
        Joi.number().min(-90).max(90).required(),
      )
      .custom((valor, helpers) => {
        const [oeste, sul, leste, norte] = valor;
        return oeste > leste || sul > norte ? helpers.error('any.invalid') : valor;
      }, 'oeste<=leste e sul<=norte')
      .allow(null),
  }).unknown(true),
  map3d: Joi.object({
    viewer: Joi.object().pattern(Joi.string(), Joi.boolean()).unknown(true),
  }).unknown(true),
  services: Joi.object({
    tileServerUrl: Joi.string().max(500).allow(''),
  }).unknown(true),
  // `search` não tem mais `apiUrl`: o gazetteer É este backend (GET /nomes/busca),
  // e o cliente deriva a rota da própria base da API. Ligar/desligar continua em
  // `features.apisearch`. Mantido como objeto aberto para não quebrar payloads antigos.
  search: Joi.object().unknown(true),
  // `miniMapBasemap` é DECLARADA, e o objeto continua `.unknown(true)` para não fechar o que
  // o editor "Avançado (JSON)" já aceitava. Declarar dá borda ao campo que o painel passou a
  // oferecer: um id de mapa base é um slug de catálogo (`VARCHAR(100)`), e um valor gordo ou
  // não-texto morre aqui em 422, em vez de virar `setStyle` de um id que não existe.
  //
  // O QUE ELA NÃO CHECA é se o id EXISTE, e a omissão é deliberada: o catálogo muda por outra
  // rota, então um mapa base apagado depois deixaria a configuração inválida sem que ninguém
  // salvasse nada. Quem resolve isso é o cliente, caindo no fallback, que é a mesma resposta
  // que ele já dá para um mapa base que sumiu do seletor principal.
  streetView360: Joi.object({
    miniMapBasemap: Joi.string().trim().max(100).allow(''),
  }).unknown(true),
  analysisLayers: Joi.object().unknown(true),
  dataLayers: Joi.object().unknown(true),
  assets3dBaseUrl: Joi.string().max(500).allow(''),
}).min(1).prefs({ stripUnknown: false });
