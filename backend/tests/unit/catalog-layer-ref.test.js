// Path: tests/unit/catalog-layer-ref.test.js
//
// AS DUAS PEÇAS PURAS DA FASE F11, e a razão de existirem separadas do serviço.
//
// 1. `catalog-layer.ref.js` — resolve a REFERÊNCIA de uma camada de catálogo (o id prefixado que
//    o cliente minta) para o par (tipo de recurso, id de recurso). É a única peça que sabe que
//    `analysis-declividade` aponta para a linha `declividade` de `analysis_layers`, e é ela que
//    responde NULL para o hillshade, que é a armadilha central da fase: `CATALOG_ITEM_TYPES` tem
//    um terceiro tipo que NÃO é recurso de catálogo, e aplicar o predicado a ele tira o relevo
//    sombreado do mapa de todo mundo.
//
// 2. `catalog.queries.js` — a COMPOSIÇÃO dos três braços de autorização, numa definição só. Ela
//    tem teste próprio porque o censo de superfícies deixou de ver `fn_granted_resource_ids`
//    escrito nas consultas (elas agora chamam o builder), e um guarda que passou a apontar para
//    o nome do builder precisa de alguém que afirme o que o builder EMITE. Sem este arquivo,
//    apagar um braço lá dentro deixaria as duas suítes verdes até alguém medir comportamento.
//
// Puros, sem banco, e é por isso que estão em `tests/unit/`.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  catalogLayerResourceRef, catalogRefKey,
  CATALOG_LAYER_ID_PREFIX, CATALOG_LAYER_DEFINITION_KEYS,
} from '../../src/modules/catalog/catalog-layer.ref.js';
import { catalogAuthorizationPredicate, resourceTypeLiteral } from '../../src/modules/catalog/catalog.queries.js';
import { RESOURCE_TYPES } from '../../src/modules/resource-access/resource-access.types.js';

describe('F11 — a referência de uma camada de catálogo', () => {
  it('resolve os DOIS tipos que são recurso de catálogo, pelo prefixo do cliente', () => {
    assert.deepEqual(
      catalogLayerResourceRef('analysis-declividade', 'analysis_layer'),
      { resourceType: 'analysis_layer', resourceId: 'declividade' },
    );
    assert.deepEqual(
      catalogLayerResourceRef('data-rodovias-federais', 'data_layer'),
      { resourceType: 'data_layer', resourceId: 'rodovias-federais' },
    );
  });

  it('o HILLSHADE não resolve, e é a armadilha (i) da fase', () => {
    // A camada de relevo é EMBUTIDA: sem linha em `analysis_layers`, `data_layers`, `basemaps` ou
    // `tilesets`, e sem tipo de concessão. Se ela resolvesse, o snapshot passaria a lhe aplicar o
    // predicado e o relevo sombreado sumiria do mapa de todo usuário.
    assert.equal(catalogLayerResourceRef('hillshade', 'hillshade'), null);
    assert.equal(CATALOG_LAYER_ID_PREFIX.hillshade, undefined, 'e ele não pode ganhar prefixo');
    assert.deepEqual(Object.keys(CATALOG_LAYER_ID_PREFIX).sort(), ['analysis_layer', 'data_layer']);
  });

  it('a SEGUNDA defesa: o tipo certo com o id errado tampouco resolve', () => {
    // A colisão real: a migração 003 semeou uma linha `analysis_layers` cujo id é literalmente
    // 'hillshade'. Uma junção por id nu casaria com ela. Exigir o prefixo é o que impede — e
    // exigir o TIPO sozinho não bastaria, porque a linha existe e o tipo casaria.
    assert.equal(catalogLayerResourceRef('hillshade', 'analysis_layer'), null);
    assert.equal(catalogLayerResourceRef('data-x', 'analysis_layer'), null, 'prefixo do outro tipo');
    assert.equal(catalogLayerResourceRef('analysis-', 'analysis_layer'), null, 'resto vazio');
  });

  it('entrada sem tipo, sem id ou de forma legada devolve null em vez de levantar', () => {
    // A forma legada de array e as linhas antigas chegam sem `type`. Levantar aqui abortaria o
    // snapshot inteiro; devolver null as deixa passar verbatim, que é o comportamento certo.
    for (const [id, tipo] of [
      [undefined, undefined], ['analysis-x', undefined], [null, 'analysis_layer'],
      [42, 'analysis_layer'], ['analysis-x', 42], ['legacy-a', 'wms'],
    ]) {
      assert.equal(catalogLayerResourceRef(id, tipo), null, `(${String(id)}, ${String(tipo)})`);
    }
  });

  it('os dois tipos são MESMO tipos de recurso do sistema, não um terceiro vocabulário', () => {
    // A coincidência entre `CATALOG_ITEM_TYPES` (frontend) e o CHECK de
    // `resource_grants.resource_type` é o que permite usar a mesma palavra dos dois lados. Ela é
    // afirmada aqui: se um dia divergirem, este caso fica vermelho antes de o predicado começar a
    // consultar um tipo que o banco recusa.
    const tipos = Object.keys(CATALOG_LAYER_ID_PREFIX);
    assert.equal(tipos.length, 2, 'guarda: mapa vazio daria zero asserções e verde vazio');
    for (const tipo of tipos) {
      assert.ok(RESOURCE_TYPES.includes(tipo), `${tipo} precisa ser um tipo de recurso`);
    }
  });

  it('a chave de junção separa tipo de id sem ambiguidade', () => {
    assert.notEqual(
      catalogRefKey('analysis_layer', 'a b'),
      catalogRefKey('analysis_layer a', 'b'),
      'a chave não pode colidir por deslocamento do separador',
    );
  });

  it('só nome e config são DEFINIÇÃO; o resto é referência ou estado local', () => {
    assert.deepEqual([...CATALOG_LAYER_DEFINITION_KEYS].sort(), ['config', 'name']);
    // A DISCRIMINAÇÃO que importa: `type`, `visible`, `status` e `styleOverrides` NÃO podem entrar
    // aqui. `type` é a metade da referência; os outros três são estado por atlas, e retirá-los
    // apagaria o trabalho do usuário a cada snapshot.
    for (const chave of ['id', 'type', 'visible', 'status', 'styleOverrides', 'opacity']) {
      assert.ok(!CATALOG_LAYER_DEFINITION_KEYS.includes(chave), `${chave} não é definição`);
    }
  });
});

describe('F11 — o predicado de autorização de catálogo, numa definição só', () => {
  const completo = catalogAuthorizationPredicate({
    alias: 't',
    userParam: '$1::uuid',
    produceTypeExpr: '$2::text',
    atlasParam: '$3::uuid',
    grantTypeExpr: '$4::text',
  });

  it('emite os TRÊS braços, cada um chamando a função SQL que o define', () => {
    // O predicado mora no SQL (migrações 017/019) e este builder só o COMPÕE. Cada braço é
    // cobrado por nome porque apagar um é a falha silenciosa desta camada: a consulta continua
    // válida, devolve menos (ou mais) linhas, e nenhuma suíte de sintaxe reclama.
    assert.match(completo, /fn_has_global_data_access\(\$1::uuid\)/, 'papel global');
    assert.match(completo, /fn_can_produce_resource\(\$1::uuid, \$2::text, t\.id\)/, 'produção');
    assert.match(completo, /fn_granted_resource_ids\(\$1::uuid, \$3::uuid, \$4::text\)/, 'concessão/empréstimo');
    assert.equal((completo.match(/\bOR\b/g) || []).length, 2, 'três braços, dois OR');
  });

  it('a concessão é SEMI-JOIN, nunca uma chamada por linha', () => {
    // R8: `fn_can_see_resource` por linha custaria uma consulta por linha. O `IN (SELECT ...)` é
    // avaliado uma vez porque não referencia a linha.
    assert.match(completo, /t\.id IN \(SELECT resource_id/);
    assert.ok(!completo.includes('fn_can_see_resource'), 'o escalar não entra na listagem');
  });

  it('sem atlas em foco, o braço de concessão NÃO é montado (e é degradar, não vazar)', () => {
    const parcial = catalogAuthorizationPredicate({
      alias: 't', userParam: '$1::uuid', produceTypeExpr: '$2::text',
    });
    assert.ok(!parcial.includes('fn_granted_resource_ids'), 'sem o braço de concessão');
    // A DISCRIMINAÇÃO: os outros dois continuam. Sem esta linha, "o braço some" também seria o que
    // se mede num builder que devolvesse string vazia — o que abriria tudo, não fecharia.
    assert.match(parcial, /fn_has_global_data_access/);
    assert.match(parcial, /fn_can_produce_resource/);
  });

  it('o alias é respeitado, para que o builder sirva a consultas com outra tabela', () => {
    const outro = catalogAuthorizationPredicate({
      alias: 'al', userParam: '$9::uuid', produceTypeExpr: `'analysis_layer'::text`,
      atlasParam: '$8::uuid', grantTypeExpr: `'analysis_layer'::text`,
    });
    assert.match(outro, /fn_can_produce_resource\(\$9::uuid, 'analysis_layer'::text, al\.id\)/);
    assert.match(outro, /al\.id IN \(SELECT resource_id/);
  });

  it('o literal de tipo passa pela whitelist: um tipo inventado LEVANTA', () => {
    // O valor vai INTERPOLADO no SQL. A whitelist é o que impede que um dia ele venha de um
    // request; levantar (e não devolver string) é o que torna o erro impossível de ignorar.
    assert.equal(resourceTypeLiteral('analysis_layer'), `'analysis_layer'::text`);
    assert.throws(() => resourceTypeLiteral("x'; DROP TABLE users; --"), /Unknown resource type/);
    assert.throws(() => resourceTypeLiteral('hillshade'), /Unknown resource type/);
  });
});
