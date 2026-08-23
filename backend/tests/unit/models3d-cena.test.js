// Path: tests/unit/models3d-cena.test.js
// A CENA CAMINHÁVEL do lado da produção: o layout que ela precisa ter, a assinatura que
// permite conferi-la depois, e a conversão do endereço público para o caminho local.
//
// A ASSINATURA É O QUE A CENA NÃO GANHAVA DE GRAÇA. Um `.3dtiles` carrega dentro de si o
// cabeçalho que o identifica; uma pasta não carrega nada. Estes casos prendem as três
// propriedades que fazem a assinatura valer: ela não depende da ORDEM em que o disco
// devolveu os arquivos, ela inclui o CAMINHO (senão um arquivo renomeado passa), e ela
// muda quando aparece arquivo A MAIS (que a contagem pegaria, mas o conjunto de hashes
// sozinho não).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  assinaturaDoManifesto,
  validarLayoutDeCena,
  caminhoLocalDaCena,
  CENA_OBRIGATORIOS,
  CENA_ESPERADOS,
} from '../../src/modules/models3d/models3d.scene.js';

const A = { rel: 'cena.sog', sha256: 'aaaa' };
const B = { rel: 'voxel/voxel.bin', sha256: 'bbbb' };
const C = { rel: 'itens/1.jpg', sha256: 'cccc' };

describe('models3d — assinatura do manifesto de uma cena', () => {
  it('não depende da ordem em que o disco devolveu os arquivos', () => {
    // `readdir` não promete ordem. Sem ordenar, a mesma pasta daria assinaturas diferentes
    // em duas máquinas, e a verificação acusaria divergência onde não há.
    assert.equal(
      assinaturaDoManifesto([A, B, C]),
      assinaturaDoManifesto([C, A, B]),
    );
  });

  it('muda quando o CONTEÚDO de um arquivo muda', () => {
    assert.notEqual(
      assinaturaDoManifesto([A, B]),
      assinaturaDoManifesto([A, { ...B, sha256: 'bbbc' }]),
    );
  });

  it('muda quando um arquivo é RENOMEADO, com os mesmos bytes', () => {
    // O caminho entra no hash junto com o conteúdo. Só os bytes não bastam: mover o splat
    // de lugar mantém o conjunto de hashes e quebra a cena.
    assert.notEqual(
      assinaturaDoManifesto([A, B]),
      assinaturaDoManifesto([{ ...A, rel: 'cena2.sog' }, B]),
    );
  });

  it('muda quando aparece arquivo A MAIS', () => {
    assert.notEqual(
      assinaturaDoManifesto([A, B]),
      assinaturaDoManifesto([A, B, C]),
    );
  });

  it('a lista vazia tem assinatura estável, e não estoura', () => {
    assert.equal(assinaturaDoManifesto([]), assinaturaDoManifesto([]));
    assert.match(assinaturaDoManifesto([]), /^[0-9a-f]{64}$/);
  });
});

describe('models3d — o layout que o visualizador exige', () => {
  it('aceita a pasta com os três obrigatórios, e avisa o que falta de vitrine', () => {
    const v = validarLayoutDeCena([...CENA_OBRIGATORIOS, 'itens/1.jpg']);
    assert.equal(v.ok, true);
    assert.deepEqual(v.avisos, [...CENA_ESPERADOS]);
  });

  it('recusa, nomeando o arquivo, quando falta qualquer obrigatório', () => {
    // Sem esta asserção o laço abaixo passaria verde com a lista vazia.
    assert.equal(CENA_OBRIGATORIOS.length, 3);
    for (const alvo of CENA_OBRIGATORIOS) {
      const v = validarLayoutDeCena(CENA_OBRIGATORIOS.filter((f) => f !== alvo));
      assert.equal(v.ok, false, `sem ${alvo} deveria recusar`);
      assert.match(v.motivo, new RegExp(alvo.replace('/', '\\/')));
    }
  });

  it('sem o octree a recusa é obrigatória, e não aviso', () => {
    // É o modo de falha que este portão fecha: sem colisão a cena abre bonita e o
    // visitante atravessa parede, sem nada no console.
    const v = validarLayoutDeCena(['cena.sog', 'voxel/voxel-meta.json']);
    assert.equal(v.ok, false);
    assert.match(v.motivo, /voxel\.bin/);
  });
});

describe('models3d — do endereço público ao caminho local', () => {
  const assets3d = { baseUrl: '/api/v1/assets3d', dir: path.join('C:', 'dados', 'assets3d') };

  it('resolve a pasta servida por esta rota', () => {
    const local = caminhoLocalDaCena('/api/v1/assets3d/primeira-pessoa/museu', assets3d);
    assert.equal(local, path.join(assets3d.dir, 'primeira-pessoa', 'museu'));
  });

  it('tolera a barra final do endereço', () => {
    assert.equal(
      caminhoLocalDaCena('/api/v1/assets3d/primeira-pessoa/museu/', assets3d),
      path.join(assets3d.dir, 'primeira-pessoa', 'museu'),
    );
  });

  it('devolve null quando o endereço NÃO é servido por este processo', () => {
    // Um deploy pode publicar a mesma pasta pelo nginx sob outro prefixo. Adivinhar um
    // caminho local ali faria a verificação reprovar uma cena sadia.
    assert.equal(caminhoLocalDaCena('/3d/primeira-pessoa/museu', assets3d), null);
    assert.equal(caminhoLocalDaCena('https://outro/assets3d/x', assets3d), null);
    assert.equal(caminhoLocalDaCena('', assets3d), null);
    assert.equal(caminhoLocalDaCena(null, assets3d), null);
  });

  it('recusa travessia, em vez de resolvê-la para fora do diretório', () => {
    assert.equal(caminhoLocalDaCena('/api/v1/assets3d/../../etc', assets3d), null);
    assert.equal(caminhoLocalDaCena('/api/v1/assets3d/a/../b', assets3d), null);
  });
});
