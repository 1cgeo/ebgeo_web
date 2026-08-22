// Path: tests/unit/sv360-folder-import.test.js
//
// AS TRÊS COISAS QUE O CONVERSOR DE PASTA DECIDE SOZINHO, e que ninguém confere depois.
//
// `sv360-folder-import.js` transforma o acervo 360 em pasta (JPG + JSON) no par de SQLite
// que o importador consome, e três decisões dele nascem aqui e não têm segunda chance:
// o ID da foto, a geometria das ligações e o que fazer com um alvo que aponta para fora.
//
// O ID FOI MEDIDO ERRADO UMA VEZ, e é a razão deste arquivo existir. A primeira versão
// gravou o NOME da foto como id; as 657 fotos entraram no Postgres, o import reportou
// sucesso, e nenhuma imagem saía pela API: `GET /photos/:uuid/image` valida o parâmetro
// como GUID e devolvia 422 para todas. Nada ficou vermelho, porque nada media o id.
//
// O VETOR DO UUID É EXTERNO, DE PROPÓSITO. Verificar o v5 contra um valor que este mesmo
// código produziu seria chancelar a própria saída. O par usado é o exemplo publicado da
// norma (namespace DNS + "python.org"), que existe em documentação de terceiros e não
// depende de uma linha deste repositório.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  uuidV5, distanciaEmMetros, azimuteEmGraus, lerMetadados,
} from '../../scripts/sv360-folder-import.js';

const NS_DNS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

describe('uuidV5: o id que a rota de imagem aceita', () => {
  it('bate com o vetor publicado da norma (namespace DNS + "python.org")', () => {
    assert.equal(uuidV5(NS_DNS, 'python.org'), '886313e1-3b8a-5372-9b90-0c9aee199e5d');
  });

  it('é determinístico: o mesmo par devolve o mesmo id', () => {
    const a = uuidV5(NS_DNS, 'multicaptura/FOTO_0001');
    const b = uuidV5(NS_DNS, 'multicaptura/FOTO_0001');
    assert.equal(a, b);
  });

  it('separa por nome E por namespace (dois projetos não colidem)', () => {
    const emA = uuidV5(NS_DNS, 'projetoA/FOTO_0001');
    const emB = uuidV5(NS_DNS, 'projetoB/FOTO_0001');
    assert.notEqual(emA, emB, 'o slug entra no nome, então o mesmo arquivo em dois projetos difere');
  });

  it('carrega versão 5 e variante RFC 4122, que é o que o validador da rota exige', () => {
    const id = uuidV5(NS_DNS, 'qualquer');
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('distanciaEmMetros: a régua que ordena a fila de uma direção', () => {
  it('um grau de latitude no equador dá ~111,19 km', () => {
    const d = distanciaEmMetros({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });
    assert.ok(Math.abs(d - 111195) < 200, `esperado ~111195 m, veio ${d}`);
  });

  it('o mesmo ponto dá zero, e não NaN (a raiz de um negativo por arredondamento)', () => {
    const d = distanciaEmMetros({ lat: -29.98, lon: -50.21 }, { lat: -29.98, lon: -50.21 });
    assert.equal(d, 0);
  });

  it('é simétrica', () => {
    const a = { lat: -29.98, lon: -50.21 };
    const b = { lat: -29.99, lon: -50.22 };
    assert.ok(Math.abs(distanciaEmMetros(a, b) - distanciaEmMetros(b, a)) < 1e-6);
  });

  it('atravessa o antimeridiano pelo caminho curto', () => {
    const d = distanciaEmMetros({ lat: 0, lon: 179.9 }, { lat: 0, lon: -179.9 });
    assert.ok(d < 25000, `deveria ser ~22 km pelo caminho curto, veio ${d}`);
  });
});

describe('azimuteEmGraus: a direção em que o marcador é desenhado', () => {
  it('norte é 0 e leste é 90', () => {
    assert.ok(Math.abs(azimuteEmGraus({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })) < 0.001);
    assert.ok(Math.abs(azimuteEmGraus({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }) - 90) < 0.001);
  });

  it('sul é 180 e oeste é 270 (a volta é [0,360), nunca negativa)', () => {
    assert.ok(Math.abs(azimuteEmGraus({ lat: 0, lon: 0 }, { lat: -1, lon: 0 }) - 180) < 0.001);
    const oeste = azimuteEmGraus({ lat: 0, lon: 0 }, { lat: 0, lon: -1 });
    assert.ok(oeste >= 0 && oeste < 360, `fora de [0,360): ${oeste}`);
    assert.ok(Math.abs(oeste - 270) < 0.001);
  });
});

describe('lerMetadados: o que entra, o que vira id e o que é descartado', () => {
  /**
   * Monta uma pasta METADATA temporária com os JSON dados.
   * @param {Array<Object>} arquivos
   * @returns {string} caminho da pasta
   */
  const pastaCom = (arquivos) => {
    const raiz = mkdtempSync(join(tmpdir(), 'sv360-folder-'));
    const meta = join(raiz, 'METADATA');
    mkdirSync(meta);
    arquivos.forEach((conteudo, i) => {
      writeFileSync(join(meta, `f${i}.json`), JSON.stringify(conteudo), 'utf8');
    });
    return meta;
  };

  it('cunha o id como UUID e guarda o nome do acervo à parte', () => {
    const meta = pastaCom([
      { camera: { id: 'FOTO_A', img: 'FOTO_A', lat: -29.98, lon: -50.21, ele: 10, heading: 90 }, targets: [] },
    ]);
    try {
      const { fotos } = lerMetadados(meta, 'proj');
      assert.equal(fotos.length, 1);
      assert.equal(fotos[0].nome, 'FOTO_A');
      assert.equal(fotos[0].id, uuidV5('6ba7b811-9dad-11d1-80b4-00c04fd430c8', 'proj/FOTO_A'));
      assert.equal(fotos[0].arquivoImagem, 'FOTO_A.jpg');
    } finally {
      rmSync(meta, { recursive: true, force: true });
    }
  });

  it('as ligações saem em ID, nunca em nome, senão o importador não casa nada', () => {
    const meta = pastaCom([
      { camera: { id: 'A', lat: 0, lon: 0, heading: 0 }, targets: [{ id: 'B', next: true }] },
      { camera: { id: 'B', lat: 0, lon: 1, heading: 0 }, targets: [] },
    ]);
    try {
      const { fotos, ligacoes } = lerMetadados(meta, 'proj');
      const porNome = new Map(fotos.map((f) => [f.nome, f.id]));
      assert.equal(ligacoes.length, 1);
      assert.equal(ligacoes[0].source_id, porNome.get('A'));
      assert.equal(ligacoes[0].target_id, porNome.get('B'));
      assert.equal(ligacoes[0].is_next, 1);
      // A geometria é derivada, e é o que ordena a fila de uma direção.
      assert.ok(Math.abs(ligacoes[0].bearing_deg - 90) < 0.001, 'B está a leste de A');
      assert.ok(ligacoes[0].distance_m > 111000, 'um grau de longitude no equador');
    } finally {
      rmSync(meta, { recursive: true, force: true });
    }
  });

  it('alvo para foto ausente é DESCARTADO e CONTADO (o acervo cita outras campanhas)', () => {
    const meta = pastaCom([
      { camera: { id: 'A', lat: 0, lon: 0 }, targets: [{ id: 'FORA_1' }, { id: 'FORA_2' }] },
    ]);
    try {
      const { ligacoes, alvosOrfaos } = lerMetadados(meta, 'proj');
      assert.equal(ligacoes.length, 0);
      assert.equal(alvosOrfaos, 2, 'os dois foram contados, não engolidos');
    } finally {
      rmSync(meta, { recursive: true, force: true });
    }
  });

  it('foto sem coordenada finita é ignorada, e não vira linha com NaN', () => {
    const meta = pastaCom([
      { camera: { id: 'BOA', lat: -29.98, lon: -50.21 }, targets: [] },
      { camera: { id: 'SEM_LAT', lon: -50.21 }, targets: [] },
      { camera: { id: 'NAN', lat: Number.NaN, lon: -50.21 }, targets: [] },
    ]);
    try {
      const { fotos } = lerMetadados(meta, 'proj');
      assert.equal(fotos.length, 1);
      assert.equal(fotos[0].nome, 'BOA');
    } finally {
      rmSync(meta, { recursive: true, force: true });
    }
  });

  it('`heading` ausente vira 0, que é o default da coluna, e não `undefined`', () => {
    const meta = pastaCom([{ camera: { id: 'A', lat: 0, lon: 0 }, targets: [] }]);
    try {
      const { fotos } = lerMetadados(meta, 'proj');
      assert.equal(fotos[0].heading, 0);
      assert.equal(fotos[0].ele, null, 'elevação ausente é NULL, coluna que aceita nulo');
    } finally {
      rmSync(meta, { recursive: true, force: true });
    }
  });
});
