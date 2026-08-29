// Path: src/modules/nomes/caminho-de-recurso.js
/**
 * @fileoverview COMO UM CAMINHO SERVIDO VIRA UMA LINHA DE CATÁLOGO — a parte pura, e a
 * única cópia dela.
 *
 * POR QUE ESTE ARQUIVO EXISTE. Estas quatro funções nasceram dentro de
 * `assets3d-regime.js`, para decidir a que linha pertence um caminho sob
 * `/api/v1/assets3d/*`. Em 2026-08-29 o mesmo problema apareceu para o prefixo do
 * servidor de tiles (`tile-regime.js`), e a saída barata seria copiá-las. Duas cópias
 * divergem: a lição do dobramento de barra invertida e a do case-folding abaixo custaram
 * um vazamento medido cada uma, e uma cópia que não as recebesse repetiria os dois
 * defeitos num prefixo diferente, com o mesmo desfecho e sem nenhum sinal.
 *
 * MÓDULO FOLHA, por contrato: o único import é `node:path`. Ele é lido por dois índices
 * de regime e por teste de node puro, e um import daqui para o banco ou para a
 * configuração faria a decisão de caminho arrastar meia aplicação.
 *
 * O QUE ELE NÃO DECIDE: nada sobre acesso. Ele responde "qual entrada do índice este
 * caminho casa"; quem responde "e daí" é o gate de cada rota.
 */
import path from 'node:path';

/**
 * @param {*} bruto
 * @returns {string} O caminho sem barra inicial, sem segmentos `.`/`..`, sem barras
 *   repetidas e sem barra invertida fingindo não ser separador.
 *
 * A BARRA INVERTIDA É DOBRADA EM TODO HOST, não só no Windows, e a razão é que este
 * índice e o ramo que serve os bytes não podem discordar sobre o que um caminho É. O ramo
 * de sistema de arquivos resolve com `path.resolve`, cujo conjunto de separadores é o do
 * HOST, então no Windows `priv\tileset.json` lê-se como `priv/tileset.json` e é servido,
 * enquanto um índice que normalizasse só no estilo POSIX via um segmento opaco, não casava
 * linha nenhuma e chamava aquilo de público. Medido: aquela grafia entregou um tileset
 * privado a um chamador anônimo, com `public, immutable`. Dobrar aqui é independente de
 * host por construção e erra FECHADO — um nome de arquivo legítimo do Linux contendo barra
 * invertida só pode ser julgado MAIS privado do que é, nunca menos.
 */
export function normalizarRel(bruto) {
  const semQuery = String(bruto ?? '').split('?')[0].split('#')[0];
  let decodificado = semQuery;
  try {
    decodificado = decodeURIComponent(semQuery);
  } catch {
    // Um escape malformado não é um caminho que se possa normalizar. Manter a forma crua
    // só pode falhar em CASAR, e um caminho que nenhuma linha reivindica é decidido pelo
    // regime de cada índice.
  }
  return path.posix.normalize(`/${decodificado.replace(/\\/g, '/')}`).replace(/^\/+/, '');
}

/**
 * A forma em que os caminhos são COMPARADOS: normalizada e depois com caixa dobrada.
 *
 * O dobramento de caixa é a outra metade da mesma lição da barra invertida. `path.resolve`
 * é tão insensível a caixa quanto o sistema de arquivos do host, então no Windows e no
 * macOS `PRIV/tileset.json` serve os bytes de `priv/tileset.json`, e um índice comparando
 * strings exatas não casava linha nenhuma e respondia "público" — o modelo privado, a um
 * chamador anônimo, com um ano inteiro de cache compartilhado. Decidir o regime pela
 * semântica do host seria uma regra verdadeira na máquina de quem desenvolve e falsa no
 * deploy, que é exatamente como um filtro acaba aplicado a um ramo e não ao outro.
 *
 * A DIREÇÃO DO ERRO É O PONTO: dobrar só pode fazer MAIS grafias resolverem para uma linha
 * privada. O único caso que isso custa é duas linhas de catálogo cujos caminhos difiram
 * SÓ na caixa, uma pública e outra privada, em que a pública seria gateada e seus leitores
 * anônimos recusados. Isso é colisão de catálogo, já resolvida para `private` pelo
 * desempate de `ordenarEntradas`, e uma recusa errada se recupera de um jeito que uma
 * divulgação errada não.
 *
 * @param {string} rel - Um caminho já normalizado.
 * @returns {string}
 */
export function chaveDeCasamento(rel) {
  return rel.toLowerCase();
}

/**
 * Ordena as entradas do índice: a MAIS ESPECÍFICA primeiro, e a PRIVADA primeiro no empate.
 *
 * O desempate é a metade que falha fechado. Duas linhas reivindicando o mesmo caminho é
 * um erro de cadastro, e a leitura segura de um erro é a restritiva. Sem ele, bastaria
 * cadastrar uma linha PÚBLICA com o endereço de uma fonte privada para abri-la, o que
 * transformaria o cadastro de catálogo num caminho de escalação de acesso.
 *
 * Precomputa `chave` aqui e não por requisição: o casamento roda em todo pedido de tile e
 * o índice muda só numa escrita de catálogo, então dobrar a caixa do índice inteiro a cada
 * pedido poria o custo exatamente do lado que este desenho mantém vazio.
 *
 * @param {Array<{alvo: string, privado: boolean}>} entradas - Mutada e devolvida.
 * @returns {Array} As mesmas entradas, ordenadas e com `chave` preenchida.
 */
export function ordenarEntradas(entradas) {
  entradas.sort((a, b) => (b.alvo.length - a.alvo.length) || (Number(b.privado) - Number(a.privado)));
  for (const e of entradas) e.chave = chaveDeCasamento(e.alvo);
  return entradas;
}

/**
 * A entrada a que um caminho servido pertence, ou `null`.
 *
 * O laço vive aqui, numa cópia só, e os índices o exportam para o teste chamar. Ele já foi
 * reimplementado dentro de um teste, que é o arranjo em que o casador e a própria
 * verificação dele divergem na mesma edição: dobrar a caixa do índice enquanto o teste
 * seguia comparando strings cruas teria deixado o teste verde sobre um casador que não
 * casava nada.
 *
 * @param {Array<{chave: string, arquivo: boolean}>} indice - Já ordenado.
 * @param {string} rel - O caminho servido, como a rota o recebeu.
 * @returns {object|null}
 */
export function acharEntrada(indice, rel) {
  const alvo = chaveDeCasamento(normalizarRel(rel));
  for (const e of indice) {
    const casa = e.arquivo ? alvo === e.chave : (alvo === e.chave || alvo.startsWith(`${e.chave}/`));
    if (casa) return e;
  }
  return null;
}
