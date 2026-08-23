// Path: tests/unit/forma-3d-borda.test.js
//
// A BORDA DE ESCRITA DO EIXO DE FORMA DE 3D.
//
// O eixo (`config.forma3d`, quatro valores) so e uma enumeracao FECHADA se existir um lugar onde
// o quinto valor morre. Esse lugar e o Joi de `catalog.schemas.js`, e este arquivo e o que prova
// que ele morre la -- em 422, na borda, antes de virar linha gravada que nenhum visualizador sabe
// desenhar. Enquanto a forma era decidida por exclusao (`type = 'glb'`, `viewer <> 'firstPerson'`)
// nao havia borda nenhuma: qualquer texto no `config` era aceito e o cliente adivinhava.
//
// O QUE ESTE ARQUIVO NAO COBRA, e vale saber antes de ler o verde: ele mede o SCHEMA, nao a rota.
// Que o schema esteja pendurado nas quatro rotas de escrita e propriedade do
// `makeCatalogRouter`, medida pelos testes de integracao do catalogo. Um verde aqui com o
// `validate()` removido da rota seria verde -- por isso o ultimo caso abre o arquivo de rotas e
// exige que os dois schemas continuem sendo usados.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSchema, updateSchema, schemasDeEscrita } from '../../src/modules/catalog/catalog.schemas.js';
import { CAMPO_FORMA_3D, FORMAS_3D } from '../../src/modules/catalog/forma-3d.js';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Um corpo de criacao valido, com o `config` que o chamador quiser. */
const criacaoCom = (config) => ({ id: 'modelo-x', name: 'Modelo X', config });

describe('Borda de escrita do catalogo: o eixo `forma3d`', () => {
  it('piso: sao QUATRO valores e eles sao os esperados', () => {
    // Sem este piso, "os valores validos passam" seria verde sobre uma lista vazia.
    assert.equal(FORMAS_3D.length, 4, 'o eixo mudou de tamanho sem este piso acompanhar');
    assert.deepEqual([...FORMAS_3D], ['tiles3d', 'glb', 'pointcloud', 'indoor']);
    assert.equal(CAMPO_FORMA_3D, 'forma3d');
  });

  it('os QUATRO valores passam na criacao, e o valor sobrevive a validacao', () => {
    assert.equal(FORMAS_3D.length, 4, 'guarda: laco sobre colecao vazia nao asserta nada');
    const resultados = FORMAS_3D.map((forma) => {
      const { error, value } = createSchema.validate(criacaoCom({ [CAMPO_FORMA_3D]: forma }));
      return { forma, erro: error ? error.message : null, gravado: value?.config?.[CAMPO_FORMA_3D] ?? null };
    });
    assert.equal(resultados.length, 4);
    assert.deepEqual(
      resultados.filter((r) => r.erro).map((r) => `${r.forma}: ${r.erro}`), [],
      'valor legitimo do eixo recusado na borda'
    );
    // A segunda metade: passar na validacao e uma coisa, CHEGAR ao valor validado e outra. Um
    // `.strip()` ou um `.forbidden()` mal posto aceitaria o corpo e gravaria o config sem o campo.
    assert.deepEqual(resultados.map((r) => r.gravado), [...FORMAS_3D]);
  });

  it('os QUATRO valores passam na atualizacao', () => {
    assert.equal(FORMAS_3D.length, 4);
    const recusados = FORMAS_3D
      .map((forma) => ({ forma, error: updateSchema.validate({ config: { [CAMPO_FORMA_3D]: forma } }).error }))
      .filter((r) => r.error)
      .map((r) => `${r.forma}: ${r.error.message}`);
    assert.deepEqual(recusados, [], 'valor legitimo do eixo recusado no update');
  });

  it('um QUINTO valor REPROVA, nas duas rotas de escrita', () => {
    // O caso que da sentido a todos os outros: sem ele, "os quatro passam" tambem seria o
    // comportamento de um schema que aceita qualquer string.
    const criacao = createSchema.validate(criacaoCom({ [CAMPO_FORMA_3D]: 'holograma' }));
    assert.ok(criacao.error, 'a criacao aceitou uma forma que nao existe');
    assert.match(criacao.error.message, /forma3d/, 'a mensagem precisa nomear o campo culpado');

    const atualizacao = updateSchema.validate({ config: { [CAMPO_FORMA_3D]: 'holograma' } });
    assert.ok(atualizacao.error, 'o update aceitou uma forma que nao existe');
    assert.match(atualizacao.error.message, /forma3d/);
  });

  it('a comparacao e EXATA: nem case, nem espaco, nem tipo errado passam', () => {
    // Joi nao apara nem normaliza aqui de proposito: o valor vai para o JSONB e e comparado por
    // igualdade estrita do outro lado, entao ' glb' gravado seria uma forma que nao existe.
    const invalidos = [' glb', 'glb ', 'GLB', 'Tiles3D', '', 1, true, null, ['glb']];
    const aceitos = invalidos
      .filter((v) => !createSchema.validate(criacaoCom({ [CAMPO_FORMA_3D]: v })).error)
      .map((v) => JSON.stringify(v));
    assert.deepEqual(aceitos, [], 'variante malformada do valor aceita na borda');
  });

  it('o `config` continua LIVRE nas outras chaves, e a ausencia do campo continua valida', () => {
    // As quatro tabelas compartilham este schema e o shape de cada `config` e diferente. Apertar
    // o objeto inteiro quebraria basemap, camada de dados e camada de analise de uma vez.
    const livre = createSchema.validate(criacaoCom({
      url: '/3d/quartel/tileset.json',
      locate: { lon: -53.8, lat: -29.7, height: 1200 },
      style: { version: 8, sources: {}, layers: [] },
      qualquerCoisa: [1, 2, 3],
    }));
    assert.equal(livre.error, undefined, 'chave desconhecida do config passou a reprovar');

    // Linha SEM o campo continua valida, e isso tem prazo: e o que mantem de pe a derivacao de
    // compatibilidade do cliente. Torna-la obrigatoria e o ato que a aposenta.
    assert.equal(createSchema.validate(criacaoCom({})).error, undefined);
    assert.equal(updateSchema.validate({ name: 'So o nome' }).error, undefined);
  });

  it('o default do `config` na criacao continua sendo o objeto vazio', () => {
    const { error, value } = createSchema.validate({ id: 'x', name: 'X' });
    assert.equal(error, undefined);
    assert.deepEqual(value.config, {}, 'o default sumiu ao trocar Joi.object() pelo schema do config');
  });

  it('os dois schemas continuam pendurados nas rotas de escrita', () => {
    // A metade que o teste de schema sozinho nao cobre: um schema perfeito que ninguem chama.
    //
    // A FIACAO MUDOU DE FORMA em 2026-08-23 e a propriedade nao: as rotas deixaram de citar
    // `createSchema`/`updateSchema` direto e passam pela fabrica `schemasDeEscrita(table)`,
    // porque o mapa base recusa `previewVideo` (clausula 2.4) e as outras tres o aceitam.
    // Continuar exigindo o nome antigo faria este guarda reprovar uma fiacao correta.
    const rotas = fs.readFileSync(path.join(RAIZ, 'src/modules/catalog/catalog.routes.js'), 'utf8');
    assert.match(rotas, /schemasDeEscrita\(table\)/, 'as rotas deixaram de resolver o schema por tabela');
    assert.match(rotas, /validate\(\{ body: escrita\.create \}\)/, 'a rota de criacao deixou de validar o corpo');
    assert.match(rotas, /body: escrita\.update/, 'a rota de atualizacao deixou de validar o corpo');
  });

  it('a fabrica devolve schema DIFERENTE para o mapa base, e igual para os outros tres', () => {
    // Sem esta discriminacao, uma fabrica que devolvesse sempre o mesmo par passaria no caso
    // acima e a clausula 2.4 voltaria a nao ter imposicao nenhuma no servidor.
    const base = schemasDeEscrita('basemaps');
    const tileset = schemasDeEscrita('tilesets');
    assert.notEqual(base.create, tileset.create, 'o mapa base precisa de schema proprio');
    assert.equal(tileset.create, createSchema, 'as outras tres continuam no schema comum');
    assert.equal(tileset.update, updateSchema);

    const comVideo = { id: 'x', name: 'X', config: { previewVideo: 'https://a/b.webm' } };
    assert.ok(base.create.validate(comVideo).error, 'o mapa base tem de recusar o video de previa');
    assert.equal(tileset.create.validate(comVideo).error, undefined, 'o tileset tem de aceitar');
  });
});
