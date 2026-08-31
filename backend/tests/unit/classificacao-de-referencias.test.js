// Path: tests/unit/classificacao-de-referencias.test.js
// A COLETA e a APLICAÇÃO da poda de cópia, sem banco.
//
// O que se mede aqui é a metade PURA: que par (tipo, id) sai de cada linha do atlas e de
// cada trecho de um payload de import, e o que o aplicador faz com o veredito. O predicado
// em si não é assunto deste arquivo — ele é SQL e tem uma definição só, provada contra o
// banco em `clone-poda-por-destinatario.test.js` e `import-poda-referencia-privada.test.js`.
//
// O PISO de cada caso é a mesma pergunta: a coleta devolve um conjunto NÃO VAZIO e
// EXATAMENTE o esperado. Sem o "não vazio", uma coleta quebrada (que devolvesse nada)
// passaria em toda asserção de "não confundiu tipos".

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ResourcePruner,
  refsFromCollectedRows,
  refsFromImportPayload,
  refsFromSettings,
} from '../../src/modules/atlas/atlas-resource-prune.js';
import { resourceRefKey } from '../../src/modules/atlas/resource-reference.registry.js';

const chave = (t, i) => resourceRefKey(t, i);

describe('coleta de referências de recurso', () => {
  it('as linhas do atlas viram pares (a lista BRUTA pode repetir; quem deduplica é o classificador)', () => {
    // O TÍTULO JÁ MENTIU AQUI, e a prosa errada é a semente da próxima "correção" que
    // quebra tudo: ele dizia "conjunto DISTINTO" e "o par tem de continuar único depois da
    // tradução", enquanto a asserção logo abaixo afirma `{tileset, PCL}` DUAS vezes. O
    // comportamento está certo — esta função é tradução linha a linha, e quem colapsa
    // duplicata é `classifyResourceRefs`, no `Map` de distintos.
    const refs = refsFromCollectedRows([
      { origem: 'mapa.baseLayer', ref: 'osm', tipo: null },
      { origem: 'cesium3d', ref: 'PCL', tipo: null },
      // O MESMO tileset citado por câmera e por marcador, que é o caso que produz a
      // duplicata: as duas linhas viajam, e nenhuma das duas se perde.
      { origem: 'briefing.slide.modelId', ref: 'PCL', tipo: null },
      { origem: 'sv360', ref: 'foto-001.jpg', tipo: null },
      { origem: 'briefing.slide.photoId', ref: 'projeto-a', tipo: null },
      { origem: 'mapa.catalogLayers', ref: 'data-rodovias', tipo: 'data_layer' },
      { origem: 'mapa.catalogLayers', ref: 'analysis-declividade', tipo: 'analysis_layer' },
    ]);

    assert.ok(refs.length > 0, 'PISO: a coleta não pode devolver vazio');
    assert.deepEqual(refs, [
      { type: 'basemap', resourceId: 'osm' },
      { type: 'tileset', resourceId: 'PCL' },
      { type: 'tileset', resourceId: 'PCL' },
      { type: 'sv360_project', resourceId: 'foto-001.jpg' },
      { type: 'sv360_project', resourceId: 'projeto-a' },
      { type: 'data_layer', resourceId: 'rodovias' },
      { type: 'analysis_layer', resourceId: 'declividade' },
    ]);
  });

  it('a chave é o PAR: o mesmo id em dois tipos são duas referências', () => {
    // O id de catálogo é um slug GLOBAL POR TABELA, então nada impede um basemap e um
    // tileset chamados 'terreno'. Chavear por id só faria a visibilidade de um decidir a do
    // outro, o que é exatamente meia regra a mais e meia regra a menos.
    const refs = refsFromCollectedRows([
      { origem: 'mapa.baseLayer', ref: 'terreno', tipo: null },
      { origem: 'cesium3d', ref: 'terreno', tipo: null },
    ]);
    assert.equal(refs.length, 2);
    assert.notEqual(chave('basemap', 'terreno'), chave('tileset', 'terreno'));
  });

  it('camada de catálogo sem NENHUM carrier de referência produz ZERO referências', () => {
    // `hillshade` não tem linha em catálogo nenhum: é estático, injetado pelo deploy.
    // Tratá-lo como recurso tiraria o relevo sombreado do mapa de todo mundo. As outras
    // duas linhas são entradas sem prefixo E sem payload: não há de onde tirar um id.
    assert.deepEqual(refsFromCollectedRows([
      { origem: 'mapa.catalogLayers', ref: 'hillshade', tipo: 'hillshade', payload: { type: 'hillshade' } },
      { origem: 'mapa.catalogLayers', ref: 'sem-prefixo', tipo: 'data_layer', payload: null },
      { origem: 'mapa.catalogLayers', ref: 'legado', tipo: null, payload: null },
    ]), []);
  });

  it('camada LEGADA (id sem prefixo, referência em `originalId`) É colhida quando o payload vem junto', () => {
    // O DEFEITO QUE ESTE CASO PRENDE, e ele era perda de dado, não vazamento. A coleta do
    // clone chamava `catalogLayerRef` SEM o documento, então toda entrada pré-prefixo
    // devolvia null e nada era classificado; mas `manterCatalogLayer` recebe `data`, ACHAVA
    // a referência e perguntava por uma chave que ninguém tinha classificado. Fecha-fechado
    // → a camada morria no clone MESMO SENDO PÚBLICA. O caso anterior consagrava o defeito:
    // ele listava esta forma junto do hillshade e afirmava `[]`.
    assert.deepEqual(refsFromCollectedRows([
      {
        origem: 'mapa.catalogLayers',
        ref: 'legado-1',
        tipo: 'data_layer',
        payload: { type: 'data_layer', originalId: 'rodovias' },
      },
      {
        origem: 'mapa.catalogLayers',
        ref: 'legado-2',
        tipo: 'analysis_layer',
        payload: { type: 'analysis_layer', config: { id: 'declividade' } },
      },
    ]), [
      { type: 'data_layer', resourceId: 'rodovias' },
      { type: 'analysis_layer', resourceId: 'declividade' },
    ]);
  });

  it('a coleta e a APLICAÇÃO concordam sobre a mesma linha legada', () => {
    // A ASSIMETRIA ERA O DEFEITO, então a prova tem de pôr as duas metades lado a lado: o
    // que a coleta produz é exatamente o que o aplicador vai perguntar.
    const linha = {
      id: 'legado-1',
      data: { type: 'data_layer', originalId: 'rodovias' },
    };
    const colhidas = refsFromCollectedRows([
      { origem: 'mapa.catalogLayers', ref: linha.id, tipo: linha.data.type, payload: linha.data },
    ]);
    assert.deepEqual(colhidas, [{ type: 'data_layer', resourceId: 'rodovias' }]);

    // PÚBLICA: com a coleta certa, o veredito existe e a camada SOBREVIVE.
    const visivel = new ResourcePruner(new Map([[chave('data_layer', 'rodovias'), true]]));
    assert.equal(visivel.manterCatalogLayer(linha), true);
    assert.deepEqual(visivel.report, {});

    // DISCRIMINAÇÃO: a mesma linha, com o veredito NEGATIVO, cai. Sem esta metade, um
    // `manterCatalogLayer` que devolvesse `true` sempre passaria acima.
    const invisivel = new ResourcePruner(new Map([[chave('data_layer', 'rodovias'), false]]));
    assert.equal(invisivel.manterCatalogLayer(linha), false);
    assert.deepEqual(invisivel.report, { 'mapa.catalogLayers': 1 });
  });

  it('`model_3d` como camada de catálogo é referência de TILESET, pelos dois carriers legados', () => {
    // A interface atual não cunha camada de catálogo desse tipo, mas documento antigo
    // carrega, e o cliente o resolve contra `config.tilesets` até hoje
    // (`resolveCatalogLayerDefinition`). Deixar de fora só aqui faria as duas podas
    // discordarem sobre o mesmo documento.
    assert.deepEqual(refsFromCollectedRows([
      { origem: 'mapa.catalogLayers', ref: 'x', tipo: 'model_3d', payload: { type: 'model_3d', originalId: 'PCL' } },
      { origem: 'mapa.catalogLayers', ref: 'y', tipo: 'model_3d', payload: { type: 'model_3d', config: { id: 'BDGEX' } } },
      // DISCRIMINAÇÃO: sem carrier nenhum não há referência, e o `id` da entrada NÃO serve
      // de referência (o tipo não cunha prefixo), exatamente como no cliente.
      { origem: 'mapa.catalogLayers', ref: 'z', tipo: 'model_3d', payload: { type: 'model_3d' } },
    ]), [
      { type: 'tileset', resourceId: 'PCL' },
      { type: 'tileset', resourceId: 'BDGEX' },
    ]);
  });

  it('as SEIS entradas de `atlas.settings` viram pares, cada uma no seu tipo', () => {
    // A FAMÍLIA QUE O INVENTÁRIO POR NOME DE CAMPO NÃO ENXERGAVA. Sem esta coleta, o
    // aplicador perguntaria por chaves nunca classificadas e podaria a allowlist inteira.
    assert.deepEqual(refsFromSettings({
      basemaps: ['osm', 'restrito-base'],
      default_basemap: 'osm',
      available_data_layers: ['rodovias'],
      available_analysis_layers: ['declividade'],
      available_3d_models: ['PCL'],
      available_360_views: ['projeto-a'],
      // DISCRIMINAÇÃO: chave vizinha que NÃO é referência de catálogo nenhuma.
      bounds_2d: [[-45, -23], [-42, -21]],
      features: { map_3d: true },
    }), [
      { type: 'basemap', resourceId: 'osm' },
      { type: 'basemap', resourceId: 'restrito-base' },
      { type: 'data_layer', resourceId: 'rodovias' },
      { type: 'analysis_layer', resourceId: 'declividade' },
      { type: 'tileset', resourceId: 'PCL' },
      { type: 'sv360_project', resourceId: 'projeto-a' },
      { type: 'basemap', resourceId: 'osm' },
    ]);

    // E um documento sem nenhuma das seis não produz nada.
    assert.deepEqual(refsFromSettings({ bounds_2d: null }), []);
    assert.deepEqual(refsFromSettings(null), []);
  });

  it('o payload de import produz a MESMA lista de pares que as linhas do atlas', () => {
    // Duas coletas e um classificador: as fontes são de naturezas diferentes (JSON contra
    // linhas), mas o que elas produzem tem de ser intercambiável, senão a poda de entrada e
    // a de cópia divergem sobre o mesmo atlas.
    const refs = refsFromImportPayload({
      maps: [{
        base_layer: 'osm',
        cesium3dData: [{ tileset_id: 'PCL' }, { tileset_id: null }],
        streetview360Data: [{ photo_name: 'foto-001.jpg' }, { photo_name: null }],
        catalog_layers: [
          { id: 'data-rodovias', type: 'data_layer' },
          { id: 'hillshade', type: 'hillshade' },
        ],
      }],
      briefings: [{ slides: [{ model_id: 'PCL', photo_id: 'projeto-a' }, { mode: '2d' }] }],
    });

    assert.ok(refs.length > 0, 'PISO: a coleta do payload não pode devolver vazio');
    assert.deepEqual(refs, [
      { type: 'basemap', resourceId: 'osm' },
      { type: 'tileset', resourceId: 'PCL' },
      { type: 'sv360_project', resourceId: 'foto-001.jpg' },
      { type: 'data_layer', resourceId: 'rodovias' },
      { type: 'tileset', resourceId: 'PCL' },
      { type: 'sv360_project', resourceId: 'projeto-a' },
    ]);
  });

  it('o payload de import colhe a referência que mora DENTRO de `data`, não só a da coluna', () => {
    // O SNAPSHOT DEIXA O JSONB VENCER: `sync.service.js` monta
    // `{tilesetId: item.tileset_id, ...item.data}`. Um `.ebgeo` escrito à mão com a coluna
    // NULA e o id dentro de `data` atravessava a poda inteira e voltava a sair no snapshot,
    // servido a `read` — que é textualmente o modelo de ameaça do cabeçalho do podador.
    const refs = refsFromImportPayload({
      maps: [{
        cesium3dData: [{ tileset_id: null, data: { tilesetId: 'SECRETO' } }],
        streetview360Data: [{ photo_name: null, data: { photoName: 'foto-privada.jpg' } }],
      }],
    });
    assert.deepEqual(refs, [
      { type: 'tileset', resourceId: 'SECRETO' },
      { type: 'sv360_project', resourceId: 'foto-privada.jpg' },
    ]);

    // DISCRIMINAÇÃO: linha sem referência em lugar nenhum continua não produzindo par.
    assert.deepEqual(refsFromImportPayload({
      maps: [{ cesium3dData: [{ tileset_id: null, data: { cor: 'azul' } }] }],
    }), []);
  });

  it('o payload de import colhe as referências de `atlas.settings`', () => {
    const refs = refsFromImportPayload({
      atlas: { settings: { available_3d_models: ['PCL'], default_basemap: 'osm' } },
      maps: [],
    });
    assert.deepEqual(refs, [
      { type: 'tileset', resourceId: 'PCL' },
      { type: 'basemap', resourceId: 'osm' },
    ]);
  });
});

describe('aplicação da poda de cópia', () => {
  /** Só o basemap 'osm' e o tileset 'PCL' são visíveis. */
  const visiveis = new Map([
    [chave('basemap', 'osm'), true],
    [chave('tileset', 'PCL'), true],
    [chave('tileset', 'SECRETO'), false],
    [chave('sv360_project', 'foto-privada.jpg'), false],
  ]);

  it('o basemap invisível volta ao PADRÃO e o visível fica', () => {
    const p = new ResourcePruner(visiveis);
    assert.equal(p.baseLayer('osm'), 'osm');
    assert.ok(p.vazio, 'PISO: nada podado enquanto tudo é visível');

    assert.equal(p.baseLayer('bdgex'), 'carta-topografica');
    assert.deepEqual(p.report, { 'mapa.baseLayer': 1 });
  });

  it('o relatório distingue os QUATRO coletores 3D pelo data_type', () => {
    // Eles são quatro superfícies no registro e uma tabela só no banco. Colapsá-las faria o
    // aviso ao usuário e a trilha dizerem coisas diferentes sobre o mesmo fato.
    const p = new ResourcePruner(visiveis);
    for (const tipo of ['camera_position', 'marker', 'measurement', 'viewshed']) {
      assert.equal(p.manterCesium3d({ data_type: tipo, tileset_id: 'SECRETO' }), false);
    }
    assert.deepEqual(p.report, {
      'cesium3d.cameraPositions': 1,
      'cesium3d.markers': 1,
      'cesium3d.measurements': 1,
      'cesium3d.viewsheds': 1,
    });
  });

  it('linha SEM referência nenhuma sobrevive, e não entra no relatório', () => {
    const p = new ResourcePruner(visiveis);
    assert.equal(p.manterCesium3d({ data_type: 'measurement', tileset_id: null }), true);
    assert.equal(p.manterSv360({ data_type: 'marker', photo_name: null }), true);
    assert.ok(p.vazio);
  });

  it('a referência dentro de `data` é julgada como a da coluna', () => {
    // A METADE DE APLICAÇÃO do caso de coleta acima: não basta colher o id do JSONB, o
    // aplicador tem de PERGUNTAR por ele, senão a linha é mantida e o id sai no snapshot.
    const p = new ResourcePruner(visiveis);
    assert.equal(p.manterCesium3d({ data_type: 'marker', tileset_id: null, data: { tilesetId: 'SECRETO' } }), false);
    assert.equal(p.manterSv360({ data_type: 'marker', photo_name: null, data: { photoName: 'foto-privada.jpg' } }), false);
    assert.deepEqual(p.report, { 'cesium3d.markers': 1, 'sv360.markers': 1 });

    // DISCRIMINAÇÃO: com o id VISÍVEL dentro de `data`, a linha sobrevive — a leitura do
    // JSONB não pode virar "toda linha com `data` cai".
    const q = new ResourcePruner(visiveis);
    assert.equal(q.manterCesium3d({ data_type: 'marker', tileset_id: null, data: { tilesetId: 'PCL' } }), true);
    assert.ok(q.vazio);
  });

  it('o slide é REBAIXADO, nunca apagado, e só o modo que a referência exigia cai', () => {
    const p = new ResourcePruner(visiveis);

    assert.deepEqual(
      p.slide({ mode: '3d', model_id: 'SECRETO', photo_id: null }),
      { mode: '2d', model_id: null, photo_id: null }
    );
    // DISCRIMINAÇÃO: um slide 3D cujo modelo o destinatário VÊ continua 3D.
    assert.deepEqual(
      p.slide({ mode: '3d', model_id: 'PCL', photo_id: null }),
      { mode: '3d', model_id: 'PCL', photo_id: null }
    );
    // E um slide 2D que carregava um modelo perde a referência sem mudar de modo.
    assert.deepEqual(
      p.slide({ mode: '2d', model_id: 'SECRETO', photo_id: null }),
      { mode: '2d', model_id: null, photo_id: null }
    );
    assert.deepEqual(p.report, { 'briefing.slide.modelId': 2 });
  });

  it('`settings` perde os ids invisíveis e MANTÉM os visíveis', () => {
    const p = new ResourcePruner(visiveis);
    const saida = p.settings({
      basemaps: ['osm', 'bdgex'],
      default_basemap: 'osm',
      available_3d_models: ['PCL', 'SECRETO'],
      bounds_2d: [[-45, -23], [-42, -21]],
    });

    assert.deepEqual(saida.basemaps, ['osm']);
    assert.deepEqual(saida.available_3d_models, ['PCL']);
    // O padrão continua visível, então continua lá: a poda não pode zerar o que sobreviveu.
    assert.equal(saida.default_basemap, 'osm');
    // E o que NÃO é referência de catálogo atravessa intacto.
    assert.deepEqual(saida.bounds_2d, [[-45, -23], [-42, -21]]);
    assert.deepEqual(p.report, { 'settings.basemaps': 1, 'settings.available_3d_models': 1 });
  });

  it('lista que ESVAZIA desliga a categoria, porque lista vazia significa SEM restrição', () => {
    // A ARMADILHA INTEIRA DESTA SUPERFÍCIE. `intersectAvailability` (no cliente) trata
    // `[]` como "o atlas não restringe", então escrever a lista vazia depois de podar tudo
    // ALARGARIA a cópia — o oposto do que a poda existe para fazer. O honesto é desligar a
    // categoria.
    const p = new ResourcePruner(visiveis);
    const saida = p.settings({
      available_3d_models: ['SECRETO'],
      available_360_views: ['foto-privada.jpg'],
      features: { map_3d: true, panoramic_images: true, data_layers: true },
    });

    assert.deepEqual(saida.available_3d_models, []);
    assert.equal(saida.features.map_3d, false);
    assert.equal(saida.features.panoramic_images, false);
    // DISCRIMINAÇÃO: a categoria que ninguém podou NÃO foi desligada de carona.
    assert.equal(saida.features.data_layers, true);
    assert.deepEqual(p.report, {
      'settings.available_3d_models': 1,
      'settings.available_360_views': 1,
    });
  });

  it('`default_basemap` invisível vira null, e a cópia intacta não é mutada', () => {
    const p = new ResourcePruner(visiveis);
    const entrada = { basemaps: [], default_basemap: 'bdgex' };
    const saida = p.settings(entrada);

    assert.equal(saida.default_basemap, null);
    assert.deepEqual(p.report, { 'settings.default_basemap': 1 });
    // NÃO MUTA A ENTRADA: o documento de origem é lido de novo pela auditoria e pelo
    // caminho de imagens, e um objeto mutado no meio do clone é defeito sem sintoma local.
    assert.equal(entrada.default_basemap, 'bdgex');
  });

  it('`settings` sem nenhuma das seis chaves atravessa sem perda', () => {
    // PISO da direcão oposta: um podador que zerasse `settings` por precaução apagaria
    // `bounds_2d`, `features` e o registro de ícones do atlas inteiro.
    const p = new ResourcePruner(new Map());
    const entrada = { features: { map_3d: true }, bounds_2d: null, customIcons: [{ id: 'a' }] };
    assert.deepEqual(p.settings(entrada), entrada);
    assert.ok(p.vazio);
  });

  it('referência AUSENTE do mapa de visibilidade fecha FECHADO', () => {
    // O mapa vem de uma consulta; uma linha que ela não devolveu é uma pergunta sem
    // resposta, e a resposta segura para uma pergunta sem resposta é "não vê".
    const p = new ResourcePruner(new Map());
    assert.equal(p.manterCesium3d({ data_type: 'marker', tileset_id: 'QUALQUER' }), false);
    assert.equal(p.baseLayer('osm'), 'carta-topografica');
  });
});
