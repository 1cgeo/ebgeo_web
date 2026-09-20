// Path: js/admin/presenca-panel.js
import { apiClient } from '@store/sync/api-client.js';
import { card, sectionHeader } from '@js/admin/admin-dom.js';

export function montarPresenca(container) {
    const sec = document.createElement('section');
    sec.className = 'admin-uso__section';
    sec.dataset.testid = 'admin-presenca';
    sec.appendChild(sectionHeader('Agora no EBGeo'));
    const corpo = card();
    const numeros = document.createElement('div');
    numeros.className = 'admin-presenca__numeros';
    const logged = document.createElement('p');
    const anon = document.createElement('p');
    logged.dataset.testid = 'admin-presenca-logados';
    anon.dataset.testid = 'admin-presenca-deslogados';
    // OS TRÊS NASCEM COM TEXTO, e isto é estado de CARREGANDO e não enfeite: a consulta é
    // assíncrona e, enquanto ela não volta, três parágrafos vazios deixam um cartão branco de
    // uns cem pixels entre o título da aba e o resto. Ele reaparece a cada remontagem da aba
    // de Usuários, isto é, depois de salvar, aprovar, desativar e reativar.
    logged.textContent = 'Consultando…';
    anon.textContent = '';
    numeros.append(logged, anon);
    // A REGIÃO VIVA FICA NOS NÚMEROS, que são o que muda, e NÃO no carimbo de hora. Com
    // `role="status"` no relógio, o leitor de tela interrompia a leitura da tabela a cada
    // quinze segundos para anunciar a hora, para sempre, enquanto a aba estivesse aberta.
    numeros.setAttribute('aria-live', 'polite');
    const situacao = document.createElement('p');
    situacao.className = 'admin-uso__hint';
    // DOIS BLOCOS SAÍRAM EM 2026-09-20, por decisão do dono. Um era a linha de PENDÊNCIAS
    // (quantos navegadores têm operação na fila, a maior idade, em quantos a verificação não
    // respondeu, quantas falhas de coleta); o outro era a nota que explicava a regra de
    // contagem (aba do mesmo navegador conta uma vez, pessoa em navegadores diferentes conta
    // mais de uma, atualização a cada 15 s). O painel é montado por DUAS abas, Usuários e Uso,
    // então a poda vale nas duas.
    //
    // O QUE A PENDÊNCIA CONTAVA NÃO SE PERDEU do servidor: `getPresencaAgora` continua
    // devolvendo os quatro campos, e o comando de diagnóstico continua alcançando. O que saiu
    // é a exibição, que era a linha mais densa de uma seção de duas contagens.
    corpo.append(numeros, situacao);
    sec.appendChild(corpo);
    container.appendChild(sec);
    let vivo = true;
    let emVoo = false;
    const atualizar = async () => {
        if (!vivo || emVoo) return;
        emVoo = true;
        try {
            // MÉTODO PÚBLICO, e não `_request`: o envelope da API (o desembrulho do `{data}`, o
            // cabeçalho de autenticação, o tempo limite e a repetição depois do 401) é contrato do
            // cliente, e uma tela que o alcança por dentro carrega uma cópia dele que nada mantém
            // em dia. O `d = r?.data ?? r` que morava aqui era o sintoma: a tela não sabia se o
            // desembrulho já tinha acontecido.
            const d = await apiClient.getPresencaAgora();
            if (!vivo) return;
            logged.textContent = `${d.logados} ${d.logados === 1 ? 'usuário logado' : 'usuários logados'}`;
            anon.textContent = `${d.deslogados} ${d.deslogados === 1 ? 'navegador deslogado' : 'navegadores deslogados'}`;
            situacao.textContent = `Atualizado às ${new Date(d.atualizadoEm).toLocaleTimeString('pt-BR')}.`;
        } catch {
            if (vivo) {
                // A MESMA FORMA DA FRASE DE SUCESSO (número primeiro, rótulo depois), porque as
                // duas caem no mesmo lugar, no mesmo corpo de 1,4rem: inverter a ordem no ramo
                // de falha fazia a linha parecer outro campo.
                logged.textContent = 'Presença indisponível';
                anon.textContent = '';
                situacao.textContent = 'Não foi possível atualizar a presença. Nova tentativa automática em 15 segundos.';
            }
        } finally { emVoo = false; }
    };
    atualizar();
    const timer = setInterval(atualizar, 15000);
    return () => { vivo = false; clearInterval(timer); };
}
