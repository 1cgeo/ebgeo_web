// Path: tests/unit/sv360-orientation.test.js
// The two ebgeo_360 unit suites of the orientation library, merged into one
// file: `tests/unit/orientation.test.js` (quaternion pose, branch master) and
// `tests/unit/orientation-texture.test.js` (the indoor tool's YXZ angles
// re-expressed as the ZXY the viewers apply). Both were already written for
// `node:test`; the only edits are the import path, the merge, and pinning both
// files on `node:assert/strict` (the texture suite used the loose `node:assert`).
//
// Pure math, no database and no server: this file is safe to run on its own
// with `node --test tests/unit/sv360-orientation.test.js`.

import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseQuaternion,
  quaternionToMeshRotation,
  quaternionToHeading,
  resolveMeshRotation,
  eulerZXYToMatrix,
  eulerYXZToMatrix,
  eulerYXZToZXY,
  matrixToQuaternion,
  textureRotationToMeshRotation,
} from '../../src/modules/streetview360/sv360.orientation.js';

/** Asserts two angles in degrees are equal modulo 360, within a tolerance. */
function assertAngleClose(actual, expected, tolerance = 1e-6) {
  // Signed shortest angular difference, in (-180, 180]
  const diff = ((((actual - expected) % 360) + 540) % 360) - 180;
  assert.ok(
    Math.abs(diff) < tolerance,
    `expected ${actual} to equal ${expected} (mod 360), differed by ${diff}`
  );
}

describe('parseQuaternion', () => {
  it('accepts the [w, x, y, z] array order used by scanner CSVs', () => {
    const q = parseQuaternion([1, 0, 0, 0]);
    assert.deepEqual(q, { w: 1, x: 0, y: 0, z: 0 });
  });

  it('accepts w/x/y/z objects', () => {
    assert.deepEqual(parseQuaternion({ w: 1, x: 0, y: 0, z: 0 }), { w: 1, x: 0, y: 0, z: 0 });
  });

  it('accepts the qw/qx/qy/qz spelling from CSV headers', () => {
    assert.deepEqual(parseQuaternion({ qw: 1, qx: 0, qy: 0, qz: 0 }), { w: 1, x: 0, y: 0, z: 0 });
  });

  it('normalizes a non-unit quaternion', () => {
    const q = parseQuaternion([2, 0, 0, 0]);
    assert.equal(q.w, 1);
  });

  it('rejects unusable input instead of guessing', () => {
    assert.equal(parseQuaternion(null), null);
    assert.equal(parseQuaternion([1, 0, 0]), null);
    assert.equal(parseQuaternion([0, 0, 0, 0]), null);
    assert.equal(parseQuaternion({ w: 1, x: 0, y: 0 }), null);
    assert.equal(parseQuaternion({ w: 'a', x: 0, y: 0, z: 0 }), null);
    assert.equal(parseQuaternion([1, 0, 0, NaN]), null);
  });
});

describe('quaternionToMeshRotation', () => {
  it('maps the identity quaternion to no rotation', () => {
    const r = quaternionToMeshRotation([1, 0, 0, 0], { frame: 'y-up' });
    assertAngleClose(r.mesh_rotation_x, 0);
    assertAngleClose(r.mesh_rotation_y, 0);
    assertAngleClose(r.mesh_rotation_z, 0);
  });

  it('returns null for an unusable quaternion rather than a silent zero', () => {
    assert.equal(quaternionToMeshRotation(null), null);
    assert.equal(quaternionToMeshRotation([0, 0, 0, 0]), null);
  });

  it('round-trips Euler -> quaternion -> Euler in the viewer frame', () => {
    // This is the strong test: it validates the ZXY extraction independently of
    // any convention choice, because both ends use the viewer's own order.
    const cases = [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 90, z: 0 },
      { x: 0, y: 175.6, z: 0 },   // a real museum value
      { x: 9.2, y: 0, z: 1.0 },   // the santa_cruz tilt reference
      { x: 4.2, y: 330, z: 1.3 }, // tilt combined with the project's yaw
      { x: -12, y: -45, z: 7 },
    ];

    for (const c of cases) {
      const q = matrixToQuaternion(eulerZXYToMatrix(c.x, c.y, c.z));
      const r = quaternionToMeshRotation(q, { frame: 'y-up' });

      assertAngleClose(r.mesh_rotation_x, c.x, 1e-6);
      assertAngleClose(r.mesh_rotation_y, c.y, 1e-6);
      assertAngleClose(r.mesh_rotation_z, c.z, 1e-6);
    }
  });

  it('produces a pure yaw for a rotation about the survey up axis', () => {
    // A z-up instrument panning 90 degrees must become yaw only, with the
    // panorama staying level. If the basis change were wrong this leaks into
    // pitch or roll, which is the failure mode worth catching.
    const half = (45 * Math.PI) / 180;
    const q = { w: Math.cos(half), x: 0, y: 0, z: Math.sin(half) };

    const r = quaternionToMeshRotation(q, { frame: 'z-up' });

    assert.ok(Math.abs(r.mesh_rotation_x) < 1e-9, `pitch leaked: ${r.mesh_rotation_x}`);
    assert.ok(Math.abs(r.mesh_rotation_z) < 1e-9, `roll leaked: ${r.mesh_rotation_z}`);
    assert.ok(Math.abs(r.mesh_rotation_y) > 1e-6, 'expected a non-zero yaw');
  });

  it('keeps a level instrument level regardless of how far it panned', () => {
    for (const yawDeg of [0, 30, 90, 175.6, 270, 359]) {
      const half = (yawDeg * Math.PI) / 360;
      const q = { w: Math.cos(half), x: 0, y: 0, z: Math.sin(half) };
      const r = quaternionToMeshRotation(q, { frame: 'z-up' });

      assert.ok(Math.abs(r.mesh_rotation_x) < 1e-9, `pitch leaked at yaw ${yawDeg}`);
      assert.ok(Math.abs(r.mesh_rotation_z) < 1e-9, `roll leaked at yaw ${yawDeg}`);
    }
  });

  it('turns a tilt of the survey frame into a non-zero tilt of the sphere', () => {
    // Tip the instrument about its east axis; the sphere must tilt too.
    const half = (5 * Math.PI) / 360;
    const q = { w: Math.cos(half), x: Math.sin(half), y: 0, z: 0 };

    const r = quaternionToMeshRotation(q, { frame: 'z-up' });
    const tilt = Math.hypot(r.mesh_rotation_x, r.mesh_rotation_z);

    assert.ok(Math.abs(tilt - 5) < 1e-6, `expected a 5 degree tilt, got ${tilt}`);
  });
});

describe('quaternionToHeading', () => {
  it('normalizes into [0, 360)', () => {
    const q = matrixToQuaternion(eulerZXYToMatrix(0, -45, 0));
    const heading = quaternionToHeading(q, { frame: 'y-up' });

    assert.ok(heading >= 0 && heading < 360, `heading out of range: ${heading}`);
    assertAngleClose(heading, 315);
  });

  it('returns null when there is no usable pose', () => {
    assert.equal(quaternionToHeading(undefined), null);
  });
});

describe('resolveMeshRotation', () => {
  it('lets explicit angles win, so the hand-calibrated archive is never overwritten', () => {
    const camera = {
      mesh_rotation_y: 175.6,
      mesh_rotation_x: -1.3,
      orientation: [1, 0, 0, 0],
    };

    const r = resolveMeshRotation(camera);

    assert.equal(r.source, 'explicit');
    assert.equal(r.mesh_rotation_y, 175.6);
    assert.equal(r.mesh_rotation_x, -1.3);
    assert.equal(r.mesh_rotation_z, 0);
  });

  it('uses the quaternion when no angle was given', () => {
    const q = matrixToQuaternion(eulerZXYToMatrix(0, 90, 0));
    const r = resolveMeshRotation({ orientation: q }, { frame: 'y-up' });

    assert.equal(r.source, 'quaternion');
    assertAngleClose(r.mesh_rotation_y, 90);
  });

  it('falls back to the historical defaults when there is neither', () => {
    const r = resolveMeshRotation({ lat: -30, lon: -51 });

    assert.equal(r.source, 'default');
    assert.equal(r.mesh_rotation_y, 180);
    assert.equal(r.mesh_rotation_x, 0);
    assert.equal(r.mesh_rotation_z, 0);
  });

  it('falls back to the defaults when the quaternion is malformed', () => {
    const r = resolveMeshRotation({ orientation: [0, 0, 0, 0] });

    assert.equal(r.source, 'default');
    assert.equal(r.mesh_rotation_y, 180);
  });

  it('tolerates missing camera metadata', () => {
    const r = resolveMeshRotation(undefined);

    assert.equal(r.source, 'default');
    assert.equal(r.mesh_rotation_y, 180);
  });
});

// ---------------------------------------------------------------------------
// From ebgeo_360 tests/unit/orientation-texture.test.js, verbatim below.
// ---------------------------------------------------------------------------

/** Largest absolute difference between two 3x3 matrices. */
function maxDiff(a, b) {
  let worst = 0;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      worst = Math.max(worst, Math.abs(a[i][j] - b[i][j]));
    }
  }
  return worst;
}

test('a conversao PRESERVA a rotacao, nao os numeros', () => {
  // Valores reais do lote: textureRotationX de -17 a 26, Z de -30 a 23.
  const cases = [
    [13, 0, -2], [9, 0, -5], [26, 0, 23], [-17, 0, -30], [16, 0, -8], [15, 0, 1],
  ];

  for (const [x, y, z] of cases) {
    const conv = eulerYXZToZXY(x, y, z);
    const same = maxDiff(
      eulerYXZToMatrix(x, y, z),
      eulerZXYToMatrix(conv.mesh_rotation_x, conv.mesh_rotation_y, conv.mesh_rotation_z)
    );
    assert.ok(same < 1e-9, `YXZ(${x},${y},${z}) nao reproduziu em ZXY: ${same}`);
  }
});

test('copiar os numeros crus aplica OUTRA rotacao', () => {
  // Este e o teste que REPROVA o estado anterior: se a conversao fosse
  // desnecessaria, ler os mesmos numeros como ZXY daria a mesma rotacao.
  // Um par X/Z tipico do lote difere o bastante para ser visivel na tela.
  const [x, y, z] = [26, 0, 23];
  const crua = maxDiff(eulerYXZToMatrix(x, y, z), eulerZXYToMatrix(x, y, z));

  assert.ok(crua > 0.05, `esperava divergencia visivel entre as convencoes, deu ${crua}`);
});

test('X e Z zerados sao o ponto fixo das duas convencoes', () => {
  // Sem inclinacao nao ha o que reordenar. Se este falhar, a conversao esta
  // adicionando rotacao onde nao havia.
  const conv = eulerYXZToZXY(0, 0, 0);
  assert.equal(Math.abs(conv.mesh_rotation_x) < 1e-12, true);
  assert.equal(Math.abs(conv.mesh_rotation_y) < 1e-12, true);
  assert.equal(Math.abs(conv.mesh_rotation_z) < 1e-12, true);
});

/** Transposta de uma matriz de rotacao, que e a sua inversa. */
function transposta(m) {
  return [
    [m[0][0], m[1][0], m[2][0]],
    [m[0][1], m[1][1], m[2][1]],
    [m[0][2], m[1][2], m[2][2]],
  ];
}

/** Aplica a matriz a um vetor. */
function aplica(m, v) {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

/** Angulo em graus entre dois vetores unitarios. */
function anguloEntre(a, b) {
  const d = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  return (Math.acos(d) * 180) / Math.PI;
}

const VERTICAL = [0, 1, 0];

/**
 * Teto de desvio para chamar um horizonte de nivelado, em graus.
 *
 * Nao e 0 porque `acos` perto de 1 e mal condicionado: um erro de 1e-16 no
 * produto escalar vira ~1e-6 grau no angulo. E folgado o bastante para o
 * ponto flutuante e apertado o bastante para o defeito: um pixel de uma
 * equirretangular de 7680 de largura vale 0,047 grau, quatro ordens de
 * grandeza acima disto.
 */
const NIVELADO_GRAUS = 1e-6;

/**
 * A normal do horizonte da imagem, no referencial CRU dos pixels.
 *
 * O operador girou a esfera ate o horizonte da imagem cair sobre o anel
 * horizontal da grade de referencia da ferramenta. Isso e o mesmo que dizer
 * que a rotacao dela leva esta normal para a vertical.
 */
function normalDoHorizonte(tx, ty, tz) {
  return aplica(transposta(eulerYXZToMatrix(tx, ty, tz)), VERTICAL);
}

/**
 * Quanto o horizonte da imagem sai da horizontal, em graus, sob uma orientacao
 * de esfera. Zero e nivelado.
 */
function desvioDoHorizonte(orientacao, tx, ty, tz) {
  return anguloEntre(aplica(orientacao, normalDoHorizonte(tx, ty, tz)), VERTICAL);
}

/** Camera real do lote: o par calibrado a mao, mais o 60 de fabrica. */
const CAMERA_LOTE = {
  mesh_rotation_y: 60,
  meshRotationY: 60,
  textureRotation: 0,
  textureRotationX: 15,
  textureRotationZ: 1,
};

test('a orientacao transposta NIVELA o horizonte da imagem', () => {
  // O criterio e o do operador: o horizonte da imagem tem de ficar na
  // horizontal. Nao adianta comparar contra uma matriz alvo escolhida por mim,
  // porque o alvo errado passa no proprio teste.
  const casos = [[15, 1], [16, -8], [26, 23], [-17, -30], [9, -5], [0, 0]];

  for (const [tx, tz] of casos) {
    const r = resolveMeshRotation({ ...CAMERA_LOTE, textureRotationX: tx, textureRotationZ: tz });
    const orientacao = eulerZXYToMatrix(r.mesh_rotation_x, r.mesh_rotation_y, r.mesh_rotation_z);
    const desvio = desvioDoHorizonte(orientacao, tx, 0, tz);

    assert.ok(desvio < NIVELADO_GRAUS, `(${tx}, ${tz}) deixou o horizonte ${desvio.toExponential(2)}° fora`);
  }
});

test('o YAW vem do metadado, nao do neutro historico', () => {
  // O lote entrega mesh_rotation_y = 60, e e ele que manda. Este caso reprova
  // as duas tentativas anteriores, que fixavam 180.
  const r = resolveMeshRotation(CAMERA_LOTE);

  assert.ok(
    Math.abs(r.mesh_rotation_y - 60) < 5,
    `esperava yaw perto de 60, veio ${r.mesh_rotation_y.toFixed(2)}`
  );
});

test('sem mesh_rotation_y no metadado, cai no neutro de 180', () => {
  const semYaw = { textureRotation: 0, textureRotationX: 15, textureRotationZ: 1 };
  const r = resolveMeshRotation(semYaw);

  assert.ok(
    Math.abs(r.mesh_rotation_y - 180) < 5,
    `esperava o padrao 180, veio ${r.mesh_rotation_y.toFixed(2)}`
  );
});

test('o yaw nao estraga o nivelamento, qualquer que seja', () => {
  // O ponto que demorei a entender: nivelar e UMA restricao, e o yaw e um grau
  // de liberdade que ela nao toca. Toda base tem de nivelar igual.
  for (const base of [0, 60, 90, 180, 270, 359]) {
    for (const [tx, tz] of [[15, 1], [26, 23], [-17, -30]]) {
      const r = resolveMeshRotation({
        mesh_rotation_y: base, textureRotation: 0, textureRotationX: tx, textureRotationZ: tz,
      });
      const M = eulerZXYToMatrix(r.mesh_rotation_x, r.mesh_rotation_y, r.mesh_rotation_z);
      const desvio = desvioDoHorizonte(M, tx, 0, tz);

      assert.ok(desvio < NIVELADO_GRAUS, `base ${base}, (${tx}, ${tz}): horizonte ${desvio.toExponential(2)}° fora`);
    }
  }
});

test('multiplicar o yaw pela DIREITA desnivela', () => {
  // Caso que reprova a segunda tentativa. Cresce com a inclinacao, entao os
  // extremos do lote entram: um lote quase nivelado esconderia o defeito.
  //
  //  tx    tz | pela direita
  //  15     1 |      30,07°
  //  26    23 |      68,35°
  // -17   -30 |      68,17°
  for (const [tx, tz] of [[15, 1], [26, 23], [-17, -30], [16, -8], [9, -5]]) {
    const conv = eulerYXZToZXY(tx, 0, tz);
    const pelaDireita = eulerZXYToMatrix(
      conv.mesh_rotation_x, conv.mesh_rotation_y + 180, conv.mesh_rotation_z
    );

    assert.ok(
      desvioDoHorizonte(pelaDireita, tx, 0, tz) > 5,
      `(${tx}, ${tz}): o yaw pela direita deveria desnivelar`
    );
  }
});

test('a base de 60 muda os angulos de inclinacao, e isso e esperado', () => {
  // A decomposicao ZXY reparte a MESMA rotacao de outro jeito conforme o yaw.
  // Um teste que exigisse x igual a -15 estaria travando a base errada.
  const com60 = resolveMeshRotation(CAMERA_LOTE);
  const com180 = resolveMeshRotation({ ...CAMERA_LOTE, mesh_rotation_y: 180 });

  assert.ok(
    Math.abs(com60.mesh_rotation_x - com180.mesh_rotation_x) > 1,
    'os angulos de inclinacao deveriam diferir entre as duas bases'
  );
  // E as duas nivelam.
  for (const r of [com60, com180]) {
    const M = eulerZXYToMatrix(r.mesh_rotation_x, r.mesh_rotation_y, r.mesh_rotation_z);
    assert.ok(desvioDoHorizonte(M, 15, 0, 1) < NIVELADO_GRAUS);
  }
});

test('com yaw 180 e sem inclinacao, o centro da imagem vai para +X', () => {
  const r = resolveMeshRotation({
    mesh_rotation_y: 180, textureRotation: 0, textureRotationX: 0, textureRotationZ: 0,
  });
  const M = eulerZXYToMatrix(r.mesh_rotation_x, r.mesh_rotation_y, r.mesh_rotation_z);

  assert.ok(anguloEntre(aplica(M, [-1, 0, 0]), [1, 0, 0]) < NIVELADO_GRAUS);
});

test('a inclinacao calibrada a mao nao vira zero', () => {
  // O ramo explicito sozinho lia o mesh_rotation_y e devolvia x e z zerados.
  const r = resolveMeshRotation(CAMERA_LOTE);
  assert.ok(Math.abs(r.mesh_rotation_x) > 1, `pitch perdido: ${r.mesh_rotation_x}`);
  assert.ok(Math.abs(r.mesh_rotation_z) > 0.5, `roll perdido: ${r.mesh_rotation_z}`);
});

test('o yaw sai normalizado em 0 a 360', () => {
  const r = resolveMeshRotation(CAMERA_LOTE);
  assert.ok(r.mesh_rotation_y >= 0 && r.mesh_rotation_y < 360, `fora de faixa: ${r.mesh_rotation_y}`);
});

test('foto sem textureRotation segue o caminho antigo', () => {
  const camera = { mesh_rotation_y: 187, mesh_rotation_x: 2, mesh_rotation_z: -1 };
  const r = resolveMeshRotation(camera);

  assert.equal(r.source, 'explicit');
  assert.equal(r.mesh_rotation_y, 187);
  assert.equal(r.mesh_rotation_x, 2);
  assert.equal(r.mesh_rotation_z, -1);
});

test('textureRotationToMeshRotation devolve null fora do lote indoor', () => {
  assert.equal(textureRotationToMeshRotation({ mesh_rotation_y: 180 }), null);
  assert.equal(textureRotationToMeshRotation(null), null);
});
