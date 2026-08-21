// Path: src/modules/streetview360/sv360.pyramid.queries.js
/**
 * @module streetview360/sv360.pyramid.queries
 * @description SQL da PIRÂMIDE DE TILES de uma foto 360 (a panorâmica servida em
 * pedaços, em vez de um WebP inteiro).
 *
 * DUAS COISAS NESTE MÓDULO SE CHAMAM "TILE", E ELAS NÃO TÊM PARENTESCO. Leia esta
 * distinção antes de mexer em qualquer arquivo com `tile` no nome:
 *
 *   - `sv360.tiles.queries.js` (o vizinho) é o MVT da CAMADA DE PONTOS do mapa 2D:
 *     `/tiles/{z}/{x}/{y}.pbf`, com as camadas `fotos` e `fotos_linha`, endereçado em
 *     coordenada de mapa web (z/x/y do MapLibre);
 *   - ESTE arquivo é a pirâmide de UMA panorâmica: `/photos/:uuid/tiles/:level/:x/:y`,
 *     endereçada dentro da própria imagem equirretangular (nível/coluna/linha da
 *     escada), e nada dela tem a ver com o mapa.
 *
 * Confundir os dois é o erro barato de cometer, e uma varredura por `tiles` pega os
 * dois lados. O par de cabeçalhos existe para que ninguém precise deduzir qual é qual.
 *
 * O PREDICADO DE ACESSO É O MESMO DA IMAGEM, e isso não é simetria estética. Um
 * recurso sai por muitas portas, e o predicado numa consulta não protege as outras: a
 * pior falha que esta linha de trabalho encontrou em si mesma foi um predicado de
 * privacidade do MVT do 360 passar verde ao ser REVERTIDO, porque a suíte media
 * privacidade na listagem e nunca no tile. Aqui nascem DUAS portas novas (o descritor
 * e o tile), e as duas passam por `sv360AccessPredicate` mais `enforceProjectReadable`,
 * exatamente como `GET_PHOTO_SIZES`.
 */

import { sv360AccessPredicate } from './sv360.queries.js';

// O DESCRITOR da escada de uma foto, com o bastante para o gate e para o ETag.
//
// `built_at` e `total_bytes` entram porque juntos formam a assinatura do descritor: uma
// regeração muda os dois, e é assim que o cliente descobre que a escada mudou. `razao` e
// `max_level` viajam porque são CONTRATO — a grade sai de (width, height, tile_size,
// razao), e recalcular a escada pela regra de hoje sobre um banco escrito ontem já errou
// 98.854 das 99.035 fotos na origem.
//
// As três colunas de projeto (db_filename, status, access_level) vêm junto pelo mesmo
// motivo de `GET_PHOTO_SIZES`: o controller decide o ESCOPO DE CACHE por dois eixos, e um
// sozinho já errou (`disabled` oculta, `private` restringe, e um `enabled + private`
// viajou marcado `public, immutable`).
//   $1 = photo id (TEXT uuid v5), $2 = userId (uuid, nullable), $3 = atlasId (uuid, nullable)
export const GET_PHOTO_PYRAMID = `
  SELECT py.tile_size, py.max_level, py.width, py.height, py.quality,
         py.tile_count, py.total_bytes, py.built_at, py.razao,
         pr.db_filename, pr.organization_id, pr.status AS project_status,
         pr.access_level
  FROM sv360.photo_pyramids py
  JOIN sv360.photos p ON p.id = py.photo_id
  JOIN sv360.projects pr ON pr.id = p.project_id
  WHERE py.photo_id = $1
    AND NOT EXISTS (SELECT 1 FROM sv360.deleted_photos d WHERE d.photo_id = p.id)
    AND ${sv360AccessPredicate(2, 3, 'pr.')}
`;

// Quais fotos de um projeto têm pirâmide. É a pergunta da CONFERÊNCIA de ingestão, e ela
// chega por projeto, nunca por foto.
//
// A guarda que isto serve vem da origem, e ela é por FOTO VIVA, não por arquivo existir:
// o script que aposentou os blobs de lá pula o projeto cuja pirâmide não cobre toda foto
// viva. Conferir "o arquivo de tiles existe" deixaria entrar projeto com metade das fotos
// sem nenhuma fonte de pixel, e o sintoma apareceria longe, como foto que não pinta.
//   $1 = project id (uuid)
export const COUNT_PROJECT_PYRAMIDS = `
  SELECT count(*)::int AS com_piramide
  FROM sv360.photo_pyramids py
  JOIN sv360.photos p ON p.id = py.photo_id
  WHERE p.project_id = $1
    AND NOT EXISTS (SELECT 1 FROM sv360.deleted_photos d WHERE d.photo_id = p.id)
`;

// Grava (ou regrava) o descritor de uma foto. Regerar SUBSTITUI: a relação é 1-para-1 e
// não há versão acumulada, então quem precisa saber que a escada mudou compara `built_at`
// e `total_bytes`, que são a assinatura do ETag.
//   $1..$10 na ordem das colunas
export const UPSERT_PHOTO_PYRAMID = `
  INSERT INTO sv360.photo_pyramids
    (photo_id, tile_size, max_level, width, height, quality, tile_count, total_bytes, built_at, razao)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  ON CONFLICT (photo_id) DO UPDATE SET
    tile_size   = EXCLUDED.tile_size,
    max_level   = EXCLUDED.max_level,
    width       = EXCLUDED.width,
    height      = EXCLUDED.height,
    quality     = EXCLUDED.quality,
    tile_count  = EXCLUDED.tile_count,
    total_bytes = EXCLUDED.total_bytes,
    built_at    = EXCLUDED.built_at,
    razao       = EXCLUDED.razao
`;
