// Path: js/store/sync/overwrite-notice.js

/**
 * @fileoverview QUANDO AVISAR que a edição de alguém substituiu a sua, e o que dizer.
 *
 * ZERO IMPORTS: ele é consultado de dentro do caminho de aplicação de op remota, que é quente.
 *
 * ================= O QUE JÁ FOI CONSERTADO, E O QUE FALTAVA ==================
 *
 * O defeito GRAVE deste assunto era outro e já saiu: o autor que VENCIA no servidor continuava
 * exibindo o valor do perdedor, por até trinta segundos, e o conserto foi de atomicidade
 * (`resolveLocalEdit`, `lastRemoteAppliedVersion`, `serializeGuardedApply`), com repro próprio.
 *
 * O que sobrou é o SINAL, e ele é sobre o caso oposto: quem PERDEU converge para o valor do
 * colega, corretamente e em silêncio. A pessoa vê a própria cor, largura ou texto trocar sozinho.
 * O modelo de conflito não muda (LWW por ordem de chegada, decisão registrada); o que muda é que
 * ela passa a saber que houve um colega, e qual.
 *
 * ================= A JANELA, E POR QUE ELA EXISTE ============================
 *
 * Só avisa quando a op remota toca entidade que ESTA pessoa editou nos últimos segundos. Sem a
 * janela, todo movimento de um colega em qualquer feição viraria toast, e numa sessão de várias
 * pessoas isso é ruído contínuo que ensina a ignorar avisos. Com ela, o aviso só aparece onde a
 * pessoa tinha uma expectativa: ela mexeu, e o valor dela não é mais o que está na tela.
 *
 * O ESTADO É UM MAPA COM PODA, e não um mapa que só cresce: um atlas grande editado por horas
 * acumularia uma entrada por entidade tocada. A poda é preguiçosa (roda na escrita) porque não há
 * momento natural para varrer, e um timer seria mais um relógio para limpar.
 */

/** Quanto tempo depois da própria edição um atropelo ainda merece aviso. */
export const OVERWRITE_WINDOW_MS = 15_000;

/**
 * Quantas entradas o mapa pode guardar antes de a poda valer a pena. Bem acima do número de
 * entidades que uma pessoa toca em quinze segundos; só existe para o caso patológico.
 */
const PODA_A_PARTIR_DE = 256;

/** @type {Map<string, number>} entityId -> instante da última edição LOCAL. */
const editadosLocalmente = new Map();

/**
 * Registra que ESTA pessoa acabou de editar uma entidade.
 * @param {string} entityId
 * @param {number} agora - Milissegundos (injetado, para o teste não depender do relógio).
 */
export function noteLocalEdit(entityId, agora) {
    if (!entityId || !Number.isFinite(agora)) return;
    if (editadosLocalmente.size >= PODA_A_PARTIR_DE) {
        for (const [id, quando] of editadosLocalmente) {
            if (agora - quando > OVERWRITE_WINDOW_MS) editadosLocalmente.delete(id);
        }
    }
    editadosLocalmente.set(entityId, agora);
}

/**
 * Esta pessoa editou esta entidade dentro da janela?
 * @param {string} entityId
 * @param {number} agora
 * @returns {boolean}
 */
export function editedRecentlyLocally(entityId, agora) {
    const quando = editadosLocalmente.get(entityId);
    if (quando === undefined || !Number.isFinite(agora)) return false;
    return agora - quando <= OVERWRITE_WINDOW_MS;
}

/** Esquece tudo. Chamado ao trocar de atlas: id de entidade não é único entre atlas. */
export function clearLocalEditMarks() {
    editadosLocalmente.clear();
}

/**
 * A frase do atropelo, ou null quando não há o que dizer.
 *
 * NULL SEM NOME, e isso é decisão e não borda: o valor do aviso é dizer QUEM, porque é isso que
 * transforma "a tela mudou sozinha" em "o Cap. Silva está trabalhando aqui". Um toast anônimo
 * ("alguém alterou isto") gasta a atenção da pessoa sem dar a informação que a faria agir, que é
 * falar com o colega.
 *
 * @param {string|null|undefined} authorName - Nome de quem escreveu, vindo da presença.
 * @returns {string|null}
 */
export function overwriteNotice(authorName) {
    const nome = typeof authorName === 'string' ? authorName.trim() : '';
    if (!nome) return null;
    return `${nome} alterou depois de você o item que você acabou de editar. `
        + 'O que está na tela agora é a versão do servidor.';
}
