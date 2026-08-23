// Path: src/modules/models3d/models3d.header.js
// O CABEÇALHO DE UM `.3dtiles`, e a regra que decide se ele pode ser adotado.
//
// Todo `.3dtiles` carrega uma tabela `meta` chave-valor com o que o registro de produção
// precisa: id, token de geração, contagem, medidas do envelope. Ela existe para que o
// arquivo se identifique SEM o catálogo — um modelo copiado solto para outra máquina
// continua dizendo o que é — e é dela que a adoção lê.
//
// POR QUE A VALIDAÇÃO É UMA FUNÇÃO PURA, separada da leitura: ela é a única coisa aqui
// que pode estar errada de um jeito caro. Adotar um arquivo cujo cabeçalho diz outro id
// publica o conteúdo de um modelo sob o nome de outro; adotar um arquivo cuja contagem
// não bate publica uma importação interrompida no meio. As duas recusas têm teste, e
// teste que precisasse de um SQLite no disco para existir seria teste que ninguém
// escreve.
import Database from 'better-sqlite3';

/** Sem estes campos, registrar seria adivinhar. */
export const CAMPOS_OBRIGATORIOS = Object.freeze(['id', 'buildToken', 'builtAt', 'tileCount']);

/**
 * Lê a tabela `meta` e conta os tiles de um `.3dtiles`.
 *
 * Abre em modo somente leitura e fecha sempre: este caminho roda em CLI, ao lado de um
 * serviço que pode estar servindo o mesmo arquivo.
 * @param {string} caminho - caminho absoluto do arquivo
 * @returns {{meta: Object<string,string>, tilesNoArquivo: number}}
 */
export function lerCabecalho(caminho) {
  const db = new Database(caminho, { readonly: true, fileMustExist: true });
  try {
    const meta = {};
    for (const r of db.prepare('SELECT key, value FROM meta').iterate()) meta[r.key] = r.value;
    const { n } = db.prepare("SELECT COUNT(*) AS n FROM media WHERE key LIKE '%.glb'").get();
    return { meta, tilesNoArquivo: n };
  } finally {
    db.close();
  }
}

/**
 * Decide se um arquivo pode ser adotado, e diz por que não quando não pode.
 *
 * @param {Object} cabecalho - saída de lerCabecalho()
 * @param {string} idPeloNome - o nome do arquivo sem a extensão
 * @returns {{ok: true}|{ok: false, motivo: string}}
 */
export function validarCabecalho({ meta, tilesNoArquivo }, idPeloNome) {
  const faltando = CAMPOS_OBRIGATORIOS.filter((k) => !meta?.[k]);
  if (faltando.length) return { ok: false, motivo: `cabeçalho sem ${faltando.join(', ')}` };

  // O ID DO CABEÇALHO MANDA, e o do nome do arquivo confere. Divergência aqui significa
  // arquivo renomeado à mão, e adotar pelo nome poria o conteúdo de um modelo sob o id
  // de outro — que é a URL pública, a chave da allowlist por atlas e a referência que
  // um briefing salvo guarda.
  if (meta.id !== idPeloNome) {
    return { ok: false, motivo: `o cabeçalho diz id "${meta.id}"` };
  }

  // A CONTAGEM DO CABEÇALHO CONTRA A DO ARQUIVO. Divergência denuncia importação
  // interrompida no meio da conversão, e um modelo pela metade não se publica: ele
  // carrega em tela com buracos, sem erro nenhum.
  if (Number(meta.tileCount) !== tilesNoArquivo) {
    return {
      ok: false,
      motivo: `o cabeçalho diz ${meta.tileCount} tiles e o arquivo tem ${tilesNoArquivo}`,
    };
  }

  return { ok: true };
}

/**
 * Converte o cabeçalho na linha de `a3d.models`.
 *
 * @param {Object} cabecalho - saída de lerCabecalho()
 * @param {string} dbFilename - o nome do arquivo, guardado e não derivado do id
 * @param {number} bytes - tamanho do arquivo em disco
 * @returns {Object} parâmetros nomeados de UPSERT_MODEL_3D
 */
export function linhaDeProducao({ meta, tilesNoArquivo }, dbFilename, bytes) {
  const num = (v) => (v == null || v === '' ? null : Number(v));
  return {
    modelId: meta.id,
    dbFilename,
    modelType: meta.modelType || '3dtiles',
    tilesVersion: meta.tilesVersion || '1.1',
    geometryCodec: meta.geometry || 'draco',
    textureCodec: meta.texture || 'ktx2-etc1s',
    textureQuality: num(meta.textureQuality) ?? 200,
    tileCount: tilesNoArquivo,
    jsonCount: num(meta.jsonCount) ?? 0,
    totalBytes: bytes,
    sourceBytes: num(meta.sourceBytes),
    source: meta.source || null,
    sourceVersion: meta.sourceVersion || null,
    capturedAt: meta.capturedAt || null,
    buildToken: meta.buildToken,
    builtAt: meta.builtAt,
    groundHeight: num(meta.groundHeight),
    minHeight: num(meta.minHeight),
  };
}

/**
 * Converte o cabeçalho no `config` JSONB da linha de catálogo.
 *
 * DUAS COISAS QUE NÃO SE ADIVINHAM. A `url` de um GLB aponta o PRÓPRIO arquivo
 * (`model.glb`, sempre esse nome) porque o cliente o abre por `Model.fromGltfAsync`,
 * enquanto o 3D Tiles aponta o `tileset.json` e resolve a árvore inteira relativa a ele.
 * E `height` é a altura de CÂMERA — o chão medido mais 500 m —, não a do chão: é a
 * posição de onde o "ir para" enquadra o modelo.
 *
 * `heightOffset` SIGNIFICA COISAS DIFERENTES nas duas formas, e essa é a armadilha. Numa
 * ÁRVORE ele sai 0 sempre: com o terreno no ar o ajuste é zero, e um valor que não seja 0
 * nem `-minHeight` denuncia ajuste no olho, que é o que enterra modelo (o contorno da
 * máquina sem terreno é publicar `-minHeight`, e quem faz isso é quem opera aquela
 * máquina, nunca a adoção). Num GLB ele é a ALTURA DE PLANTIO, informada pelo operador na
 * importação, porque não há envelope para medir.
 *
 * @param {Object} cabecalho - saída de lerCabecalho()
 * @param {Object} opcoes
 * @param {string} opcoes.baseUrl - prefixo público da rota de bytes
 * @param {string} opcoes.forma3d - uma das quatro formas declaradas
 * @returns {Object}
 */
export function configDeCatalogo({ meta }, { baseUrl, forma3d }) {
  const num = (v) => (v == null || v === '' ? null : Number(v));
  const glb = (meta.modelType || '3dtiles') === 'glb';
  const config = {
    forma3d,
    url: `${baseUrl}/m/${meta.id}/${glb ? 'model.glb' : 'tileset.json'}`,
    heightOffset: 0,
  };

  const chao = num(meta.groundHeight);
  const base = num(meta.minHeight);
  if (chao != null) config.groundHeight = +chao.toFixed(1);
  if (base != null) config.minHeight = +base.toFixed(1);

  // A ALTURA DE CÂMERA do "ir para" tem duas contas, e a diferença não é estética. Numa
  // ÁRVORE são 500 m acima do chão medido, para enquadrar um conjunto que pode ter
  // centenas de metros de lado; num GLB são 300 m acima do ponto de plantio, porque o
  // objeto é único e 500 m o deixariam longe demais para reconhecê-lo.
  const lon = num(meta.lon);
  const lat = num(meta.lat);
  const alturaGlb = num(meta.height);
  if (lon != null && lat != null) {
    let altura = 1000;
    if (glb && alturaGlb != null) altura = +(alturaGlb + 300).toFixed(1);
    else if (chao != null) altura = +(chao + 500).toFixed(1);
    config.locate = { lon, lat, height: altura };
  }

  if (meta.local) config.local = meta.local;
  if (meta.capturedAt) config.data_captura = meta.capturedAt;
  if (meta.description) config.description = meta.description;
  if (meta.keywords) {
    try {
      const lista = JSON.parse(meta.keywords);
      if (Array.isArray(lista) && lista.length) config.keywords = lista;
    } catch {
      // Cabeçalho com keywords ilegível não impede a adoção: o campo é de vitrine.
    }
  }

  // ONDE PLANTAR, só no GLB. Sem `position` o Cesium o põe no centro da Terra, então o
  // campo sai mesmo quando os outros faltam.
  if (glb) {
    const plon = num(meta.positionLon);
    const plat = num(meta.positionLat);
    if (plon != null && plat != null) config.position = { lon: plon, lat: plat };

    // NUM GLB O `heightOffset` NÃO É AJUSTE, é a altura em que o modelo é plantado: não há
    // envelope para medir, e o operador a informou na importação. É por isso que o zero
    // fixo do caso de árvore não vale aqui.
    if (alturaGlb != null) config.heightOffset = alturaGlb;

    const rot = {};
    for (const [campo, chave] of [['rotHeading', 'heading'], ['rotPitch', 'pitch'], ['rotRoll', 'roll']]) {
      const v = num(meta[campo]);
      if (v != null && v !== 0) rot[chave] = v;
    }
    if (Object.keys(rot).length) config.rotation = rot;

    // Escala 1 não se publica: é o default do cliente, e emiti-la convidaria a mexer nela.
    const escala = num(meta.scale);
    if (escala != null && escala !== 1) config.scale = escala;
  }

  return config;
}
