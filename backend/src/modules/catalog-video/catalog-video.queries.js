// Path: src/modules/catalog-video/catalog-video.queries.js
//
// QUAL RECURSO É DONO DESTE ARQUIVO DE VÍDEO, e o chamador pode vê-lo?
//
// AS DUAS PERGUNTAS NUMA CONSULTA SÓ, e isso é o desenho e não economia. O predicado de acesso
// tem UMA definição por família (as funções SQL de `008_acesso_a_recurso.sql`, compostas por
// `catalogAuthorizationPredicate` para o catálogo e por `sv360AccessPredicate` para o 360), e a
// regra da casa é que ele viaje DENTRO do `WHERE`: resolver o dono aqui e decidir em JavaScript
// seria a segunda cópia da regra, no ponto em que ela já vazou antes.
//
// LINHA NENHUMA SIGNIFICA AS DUAS COISAS, de propósito: "este arquivo não é de recurso nenhum" e
// "é, e você não o vê" são indistinguíveis para quem pergunta, e a rota responde 404 nos dois.
// Um 403 no segundo caso confirmaria a existência do que o 404 esconde, que é a mesma escada de
// dois degraus já escrita em `setResourceVisibility`.
//
// O `basemaps` FICA DE FORA das três tabelas de catálogo, e não por esquecimento: a cláusula 2.4
// diz que mapa base não tem vídeo de prévia (a superfície dele é o seletor de camada, sem
// cartão), o schema de update recusa `config.previewVideo` para ele e `setCatalogPreviewVideo`
// reafirma com 400. Incluí-lo aqui criaria um caminho de leitura para um dado que nenhuma
// escrita produz.
//
// O EIXO DE OCULTAÇÃO DO 360 VEM JUNTO, e é por isso que o ramo dele usa `sv360AccessPredicate`
// em vez de `fn_can_see_resource` sozinha: um projeto `disabled` some para quem não o mantém,
// e o vídeo de prévia dele tem de sumir pelo mesmo eixo, senão a prévia sobrevive à ocultação
// do recurso que ela previsualiza.

import { catalogAuthorizationPredicate, resourceTypeLiteral } from '../catalog/catalog.queries.js';
import { sv360AccessPredicate } from '../streetview360/sv360.queries.js';

/**
 * Um ramo de catálogo da união: a tabela, o tipo de domínio dela e o predicado completo.
 * @param {string} tabela @param {string} tipo
 * @returns {string}
 */
function ramoDeCatalogo(tabela, tipo) {
  const literal = resourceTypeLiteral(tipo);
  const autorizacao = catalogAuthorizationPredicate({
    alias: 't',
    userParam: '$2::uuid',
    produceTypeExpr: literal,
    atlasParam: '$3::uuid',
    grantTypeExpr: literal,
  });
  return `
    SELECT ${literal} AS tipo, t.id::text AS resource_id, t.access_level
      FROM ${tabela} t
     WHERE t.active = true
       AND t.config->>'previewVideo' = $1
       AND ( t.access_level = 'public' OR ${autorizacao} )`;
}

/**
 * O recurso DONO de uma URL de vídeo de prévia, SE o chamador o enxerga.
 *
 * O `LIMIT 1` não é desempate arbitrário: o nome do arquivo carrega dezesseis bytes aleatórios e
 * cada envio cunha um novo, então duas linhas com a mesma URL seriam um estado impossível. Ele
 * existe para que um estado impossível custe uma resposta, e não uma exceção.
 *
 *   $1 = a URL servida (`${baseUrl}/{token}.{ext}`)
 *   $2 = userId (uuid, nulo para anônimo e para o visitante de link público)
 *   $3 = atlasId em foco (uuid, nulo quando não há), já gateado por `requireAtlasScopeWhenPresent`
 */
export const FIND_RESOURCE_BY_PREVIEW_VIDEO = `
  ${ramoDeCatalogo('tilesets', 'tileset')}
  UNION ALL
  ${ramoDeCatalogo('data_layers', 'data_layer')}
  UNION ALL
  ${ramoDeCatalogo('analysis_layers', 'analysis_layer')}
  UNION ALL
    SELECT 'sv360_project'::text AS tipo, p.id::text AS resource_id, p.access_level
      FROM sv360.projects p
     WHERE p.preview_video = $1
       AND ${sv360AccessPredicate(2, 3, 'p.')}
  LIMIT 1
`;
