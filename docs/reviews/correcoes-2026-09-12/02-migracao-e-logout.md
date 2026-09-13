# Preservação da main e saída voluntária com pendências

Commit conferido: `8a561bef`. A proteção contra escritores atrasados foi ampliada depois em [descarte remoto](05-contratos-descarte-e-camada.md).

## Problemas e correções

Atualizar diretamente os bancos que a main ainda conhece expunha a migração a interrupções e a gravações de abas antigas. A transição agora copia o acervo para um namespace exclusivo, conserva os originais e persiste inventário, hashes, progresso e destino. O registro do atlas muda somente após cópia e migração verificadas. IDs de conversão são preparados de forma retomável, com preservação de imagens e referências.

Uma aba antiga conhecida impede o prosseguimento. Escritas tardias na origem são detectadas e encaminhadas à recuperação em outro atlas. Falhas abrem recuperação com exportação dos registros brutos/binários, inclusive quando a API está indisponível. Resíduos remotos não são automaticamente adotados como dados locais.

Para o logout voluntário, o usuário escolheu descartar em vez de preservar para reenvio futuro. O aviso permite cancelar ou confirmar. A intenção de descarte fica registrada antes da limpeza, abrangendo caches remotos do navegador; atlas locais ficam excluídos. Reabertura após limpeza interrompida não libera a fila abandonada. O logout não exclui conteúdo confirmado no servidor.

Entradas: `frontend/src/js/store/migration/legacy-transition.js`, `frontend/src/js/store/migration/recovery-archive.js`, `frontend/src/js/session/confirm-logout.js` e `frontend/src/js/store/remote-atlas.api.js`.

## Evidência e limites

O [registro de migração](../execucao-correcao-migracao-2026-09-12.md) documenta 78 cenários de retomada em 39 pontos de escrita. Há [ensaios com dados externos](../teste-dados-externos-2026-09-12.md) e [troca dos builds reais na mesma origem](../perfil-real-main-integracao-2026-09-12.md). O [registro de saída](../2026-09-12-saida-com-pendencias.md) registra raiz aprovada com 12.137 testes frontend, 5.009 backend e 201 contratos, além dos cenários de navegador e controle negativo.

Isso não certifica todos os builds antigos ou navegadores da rede. Web Locks é necessário para a transição; sua disponibilidade precisa ser conferida na origem interna efetiva. Trocar HTTP por HTTPS não transfere IndexedDB automaticamente. Quota injetada não equivale a disco realmente cheio. A pausa transacional entre todas as abas continua [pendente](../fechamento/05-abas-e-recuperacao.md).
