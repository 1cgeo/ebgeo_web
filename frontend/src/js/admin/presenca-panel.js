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
    numeros.append(logged, anon);
    const situacao = document.createElement('p');
    situacao.className = 'admin-uso__hint';
    situacao.setAttribute('role', 'status');
    const sync = document.createElement('p');
    sync.dataset.testid = 'admin-presenca-pendencias';
    const detalhe = document.createElement('p');
    detalhe.className = 'admin-uso__hint';
    detalhe.textContent = 'Contas distintas logadas e navegadores deslogados com página visível nos últimos 90 segundos. '
        + 'Várias abas do mesmo navegador contam uma vez. Pessoas usando navegadores diferentes podem contar mais de uma vez. Atualização a cada 15 segundos.';
    corpo.append(numeros, situacao, sync, detalhe);
    sec.appendChild(corpo);
    container.appendChild(sec);
    let vivo = true;
    let emVoo = false;
    const atualizar = async () => {
        if (!vivo || emVoo) return;
        emVoo = true;
        try {
            const r = await apiClient._request('GET', '/uso/agora');
            if (!vivo) return;
            const d = r?.data ?? r;
            logged.textContent = `${d.logados} ${d.logados === 1 ? 'usuário logado' : 'usuários logados'}`;
            anon.textContent = `${d.deslogados} ${d.deslogados === 1 ? 'navegador deslogado' : 'navegadores deslogados'}`;
            situacao.textContent = `Atualizado às ${new Date(d.atualizado_em).toLocaleTimeString('pt-BR')}.`;
            const idade = d.maior_idade_pendente_ms == null ? 'não informada' : `${Math.ceil(Number(d.maior_idade_pendente_ms) / 60000)} min`;
            sync.textContent = `${d.navegadores_com_pendencias} navegadores com ${d.pendentes} operações pendentes. `
                + `Maior idade: ${idade}. Verificação indisponível em ${d.pendencias_desconhecidas} navegadores. `
                + `Falhas de coleta observadas nas páginas ativas: ${d.falhas_coleta}.`;
        } catch {
            if (vivo) {
                logged.textContent = 'Logados: indisponível';
                anon.textContent = 'Deslogados: indisponível';
                sync.textContent = '';
                situacao.textContent = 'Não foi possível atualizar a presença. Nova tentativa automática em 15 segundos.';
            }
        } finally { emVoo = false; }
    };
    atualizar();
    const timer = setInterval(atualizar, 15000);
    return () => { vivo = false; clearInterval(timer); };
}
