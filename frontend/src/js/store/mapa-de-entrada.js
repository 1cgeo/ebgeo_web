// Path: js/store/mapa-de-entrada.js

/**
 * @fileoverview QUAL MAPA O BOOT ABRE, e com que IDENTIFICADOR ele o chama.
 *
 * O DEFEITO QUE ESTE ARQUIVO EXISTE PARA CONSERTAR (relatado pelo dono em 2026-08-30): copiar
 * um atlas de SERVIDOR para local ("Salvar como local") e abrir a cópia fazia o mapa aparecer
 * chamado `fbeae0b2-fc32-4add-91df-a858815cf11e`. Trocar de mapa pela lista corrigia, e é essa
 * assimetria que aponta a causa.
 *
 * A CAUSA. Mapa de atlas de servidor é chaveado por UUID no IndexedDB, e o nome de exibição
 * mora DENTRO do documento. A cópia para local é banco a banco (`copyAtlasDatabases`), então as
 * chaves UUID viajam inteiras: um atlas local pode ter todos os mapas chaveados por UUID, o que
 * o produto não vê acontecer de outra forma (o `Principal` local é chaveado por NOME). No boot,
 * `initializeRepository` escolhe o mapa ativo entre `mapStore().keys()` — CHAVES — e devolve
 * essa chave, que `store.js` grava como se fosse o nome corrente. Toda tela que lê
 * `getCurrentMapNameSync()` passa a mostrar o UUID cru. A lista de mapas escapava porque
 * `getAllMapNamesStore` já resolve chave→nome, com um comentário que descreve exatamente este
 * sintoma; era o boot que estava fora daquela rede.
 *
 * O SEGUNDO DEFEITO, que estava escondido atrás do primeiro: `initializeRepository` compara o
 * ajuste `lastActiveMap` (que `setCurrentMapName` grava como NOME) com a lista de CHAVES. Num
 * atlas todo chaveado por UUID a comparação nunca casa, o ramo cai em `keys[0]` e o boot abre
 * um mapa ARBITRÁRIO — não o último em que a pessoa estava. Quem só olha o rótulo errado não
 * percebe que o mapa também é outro.
 *
 * POR QUE A DECISÃO MORA AQUI, E NÃO EM `initializeRepository`. Resolver chave→nome exige o
 * `mapResolver`, e ele só fica pronto DEPOIS do repositório (`awaitMapResolverReady`, em
 * `store.js`), porque é do repositório que ele lê os documentos. Então a escolha final não pode
 * acontecer lá dentro: ela pertence à costura entre as duas coisas. Este módulo é essa decisão,
 * PURA — recebe as duas funções do resolvedor por parâmetro em vez de importá-lo — e por isso é
 * testável em node sem store, sem IndexedDB e sem singleton.
 */

/**
 * O mapa que o boot deve abrir, pelo NOME de exibição.
 *
 * A ORDEM DOS RAMOS É O CONTRATO, e cada um responde a um defeito:
 *
 * 1. O PREFERIDO VENCE, quando o resolvedor o conhece. É o `lastActiveMap`, gravado por
 *    `setCurrentMapName` como nome; sem este ramo, o atlas chaveado por UUID abre em `keys[0]`
 *    porque a comparação contra chaves nunca casa. Ele vem antes da chave escolhida pelo
 *    repositório justamente porque aquela escolha JÁ é o palpite de quem não conseguiu casar.
 * 2. A CHAVE RESOLVIDA, que é o conserto do rótulo: UUID vira o nome de dentro do documento.
 * 3. A CHAVE CRUA, quando o resolvedor não a conhece. Melhor um identificador feio do que
 *    `undefined`, que viraria um mapa vazio sem nome nenhum.
 *
 * `isKnown` é consultado ANTES de `resolveToName` no ramo 1 de propósito: `resolveToName`
 * devolve a entrada de volta quando não acha (é a política dele), então usá-lo como teste de
 * existência aceitaria um nome de mapa que foi APAGADO e abriria um mapa que não existe.
 *
 * @param {Object} entrada
 * @param {string|null|undefined} entrada.chave - O que `initializeRepository` escolheu (chave de
 *   armazenamento: UUID em atlas de servidor ou copiado dele, nome no atlas local comum).
 * @param {string|null|undefined} entrada.preferido - O ajuste `lastActiveMap` (um NOME).
 * @param {(v: string) => boolean} entrada.isKnown - `mapResolver.isKnown`.
 * @param {(v: string) => string} entrada.resolveToName - `mapResolver.resolveToName`.
 * @returns {string|null|undefined} O nome de exibição, ou a chave crua se ela não resolver.
 */
export function escolherMapaDeEntrada({ chave, preferido, isKnown, resolveToName }) {
    if (preferido && typeof isKnown === 'function' && isKnown(preferido)) {
        // Um `preferido` que seja UUID (ajuste antigo, ou gravado por outro caminho) também
        // passa por aqui, e sai como nome: o ramo devolve exibição, nunca chave.
        return typeof resolveToName === 'function' ? resolveToName(preferido) : preferido;
    }
    if (!chave) return chave;
    if (typeof resolveToName !== 'function') return chave;
    return resolveToName(chave) || chave;
}
