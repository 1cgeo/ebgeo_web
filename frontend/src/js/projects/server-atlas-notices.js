// Path: js/projects/server-atlas-notices.js

/**
 * @module projects/server-atlas-notices
 * @description O QUE A TELA DIZ QUANDO CRIAR UM ATLAS DE SERVIDOR FALHA. Pura: sem DOM, sem
 * toast, sem leitura de armazenamento. A página chama e entrega o resultado ao serviço de toast.
 *
 * O ACHADO QUE ELE FECHA, e ele é do tipo que nenhum teste pegaria: `CreateAtlasModal._handleCreate`
 * (`@modals/create-atlas.modal.js`) envolve a chamada do dono num `catch` VAZIO, de propósito, para
 * manter o diálogo aberto na falha. O `onCreate` de `projects-page.js` chamava
 * `apiClient.createAtlas` sem tratar nada, então TODA falha de criação era silenciosa: o botão
 * ficava clicável, o diálogo continuava ali e nenhuma palavra aparecia. O caminho de IMPORTAR e o
 * de CLONAR já mostravam a frase do servidor (`showError(error?.message ...)`); só o de criar não.
 * Isso passou a importar em 14/09/2026, quando `POST /atlas` ganhou a cota por conta (decisão D12):
 * o servidor passou a ter algo específico a dizer, e a tela não tinha onde dizê-lo.
 *
 * A REGRA É "A FRASE DO SERVIDOR VENCE", e ela não é preguiça. Uma recusa de cota carrega os dois
 * números e a ação que libera vaga, escrita ao lado da regra que recusou
 * (`backend/src/modules/atlas/atlas-quota.js`); qualquer moldura que esta função inventasse por
 * cima diria menos. A moldura própria só entra onde o servidor NÃO falou: sem status nenhum quem
 * "falou" foi o navegador, e o que ele diz é `Failed to fetch`, a frase que já chegou crua à tela
 * uma vez neste produto.
 *
 * NUNCA SILENCIOSA: entrada que não é erro, erro sem mensagem e erro sem status produzem frase
 * mesmo assim. Um botão que não faz nada é indistinguível de um botão quebrado.
 */

// Do ARQUIVO e sem imports próprios: é a definição única desta casa para "por que o pedido
// falhou". Escrever aqui um segundo `if (status === 401)` seria mais uma cópia da mesma regra.
import { classifyRequestFailure, RequestFailure } from '@utils/request-failure.js';

/** Último recurso: a frase que um erro sem nada aproveitável ainda produz. */
const RECUSA_GENERICA = 'Não foi possível criar o atlas. Tente de novo.';

/** Texto não vazio, ou `null`. */
function texto(valor) {
    const t = typeof valor === 'string' ? valor.trim() : '';
    return t.length > 0 ? t : null;
}

/**
 * A frase de uma falha ao criar um atlas de servidor.
 *
 * @param {*} error - o erro de `apiClient.createAtlas` (um `ApiError`, com `status` e `code`)
 * @returns {string} uma frase pt-BR, sempre não vazia
 */
export function createServerAtlasFailureNotice(error) {
    const classe = classifyRequestFailure(error);
    const doServidor = texto(error?.message);

    // Sem status: não houve resposta. A mensagem do navegador não serve como frase de produto.
    if (classe === RequestFailure.NETWORK) {
        return 'Não foi possível falar com o servidor. Confira a conexão e tente de novo.';
    }
    // A credencial respondeu por si mesma. O texto do servidor aqui é genérico ("Faça login para
    // continuar"), e o que a pessoa precisa saber é que o atlas NÃO foi criado.
    if (classe === RequestFailure.CREDENTIAL) {
        return 'Sua sessão terminou. Entre de novo e crie o atlas outra vez.';
    }

    // Todo o resto: o servidor falou, e a frase dele é mais específica que qualquer moldura.
    // É por aqui que a recusa de cota (429 `QUOTA_EXCEEDED`) chega inteira, com os dois números.
    // O eco "HTTP nnn", que o cliente inventa quando a resposta não trouxe mensagem, NÃO é frase
    // do servidor: é texto de console, e o status continua no erro para quem abrir o console.
    if (doServidor && !/^HTTP \d{3}$/.test(doServidor)) return doServidor;

    return RECUSA_GENERICA;
}
