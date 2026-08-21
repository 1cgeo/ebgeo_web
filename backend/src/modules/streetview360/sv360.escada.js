// Path: src/modules/streetview360/sv360.escada.js
/**
 * @module streetview360/sv360.escada
 * @description A escada da pirâmide de tiles: quantos níveis, e a grade de cada um.
 *
 * ESTA CONTA EXISTE DUAS VEZES NESTE REPOSITÓRIO, DE PROPÓSITO, e a duplicação é o
 * preço de os dois pacotes serem independentes: aqui, para o servidor conferir a faixa
 * de um pedido antes de tocar o disco, e em
 * `frontend/src/js/street_view_tool/pyramid-math.js`, para o cliente saber quais tiles
 * pedir. Se as duas discordarem, o sintoma é tile faltando na tela e 404 no log, nunca
 * um erro que aponte para a causa. O guarda contra isso é
 * `backend/tests/unit/escada-espelha-o-cliente.test.js`, que roda as duas
 * implementações sobre os mesmos casos e exige o mesmo número; ele leva asserção
 * ABSOLUTA junto, porque comparar sozinho deixaria passar duas cópias erradas do mesmo
 * jeito. Mesmo desenho do par de projetores do 360/calibração.
 *
 * O DADO GRAVADO MANDA NO DESCRITOR CALCULADO, e esta é a lição que a origem pagou
 * caro: a regra de PARADA da escada morava só no código, então mudá-la reinterpretava
 * em silêncio todo o acervo já escrito — 98.854 das 99.035 fotos passaram a ser lidas
 * com uma escada diferente da que as produziu. Por isso `max_level` e `razao` são
 * colunas (migração `011_sv360_piramide.sql`) e por isso a função abaixo os RECEBE em vez de deduzi-los.
 */

/** Razão entre um nível e o próximo, quando a gravada não disser outra coisa. */
export const RAZAO_PADRAO = 2;

/**
 * Reconstrói a escada de uma pirâmide JÁ GRAVADA.
 *
 * Divide `maxLevel` vezes a partir do nativo, então a escada sai igual à que produziu
 * aquele dado, qualquer que tenha sido a regra de parada em vigor no dia. O nível 0 é o
 * mais grosso e `maxLevel` é o nativo.
 *
 * @param {number} width - largura nativa em pixels
 * @param {number} height - altura nativa em pixels
 * @param {number} tileSize - lado do tile em pixels
 * @param {number} razao - fator entre um nível e o próximo
 * @param {number} maxLevel - `photo_pyramids.max_level`, o nível nativo
 * @returns {Array<{level:number,width:number,height:number,cols:number,rows:number}>} a escada
 */
export function escadaGravada(width, height, tileSize, razao, maxLevel) {
  const r = Number.isFinite(razao) && razao > 1 ? razao : RAZAO_PADRAO;
  const n = Number.isFinite(maxLevel) && maxLevel >= 0 ? Math.floor(maxLevel) : 0;
  const escada = [{ width, height }];
  let w = width;
  let h = height;
  for (let i = 0; i < n; i++) {
    w = Math.max(1, Math.round(w / r));
    h = Math.max(1, Math.round(h / r));
    escada.push({ width: w, height: h });
  }
  escada.reverse();
  return escada.map((nivel, level) => ({
    level,
    width: nivel.width,
    height: nivel.height,
    cols: Math.ceil(nivel.width / tileSize),
    rows: Math.ceil(nivel.height / tileSize),
  }));
}

/**
 * A grade de UM nível: quantas colunas e quantas linhas ele tem.
 *
 * É o que a rota do tile pergunta para decidir 404 ANTES de abrir o SQLite. Sem essa
 * conferência, um nível fora da escada custaria uma leitura de disco por pedido, e um
 * cliente distraído (ou um varredor) faria disso um caminho barato de trabalho inútil
 * no worker.
 *
 * Devolve `null` para nível fora da escada, e a distinção entre `null` e uma grade
 * vazia importa: `null` é "este nível não existe" (404), nunca "existe e está vazio".
 *
 * @param {{width:number,height:number,tileSize:number,razao:number,maxLevel:number}} descritor - o descritor gravado
 * @param {number} level - nível pedido
 * @returns {{colunas:number,linhas:number}|null} a grade, ou null se o nível não existe
 */
export function gradeDoNivel(descritor, level) {
  if (!descritor || !Number.isInteger(level) || level < 0) return null;
  const { width, height, tileSize, razao, maxLevel } = descritor;
  // `> 0`, e não apenas finito: zero é um número perfeitamente finito, e uma dimensão
  // zero produziria uma grade de zero colunas — um nível que o descritor anuncia e que
  // não tem tile nenhum. O CHECK da migração `011_sv360_piramide.sql` impede isso no banco; aqui a guarda
  // vale para o descritor que chegar por outro caminho.
  if (!(width > 0) || !(height > 0) || !(tileSize > 0)) return null;
  if (level > maxLevel) return null;

  const escada = escadaGravada(width, height, tileSize, razao, maxLevel);
  const nivel = escada[level];
  return nivel ? { colunas: nivel.cols, linhas: nivel.rows } : null;
}
