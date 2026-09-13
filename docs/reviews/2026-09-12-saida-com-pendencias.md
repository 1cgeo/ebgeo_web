# Saída voluntária com pendências

Implementado no branch `integracao_backend` no commit `8a561bef`, conforme a decisão do usuário de confirmar o descarte em vez de criar um atlas de recuperação na saída voluntária. A proteção contra escritores atrasados foi ampliada em `e70ccf3c`; veja a [retrospectiva dessa continuação](correcoes-2026-09-12/05-contratos-descarte-e-camada.md). Não houve implantação no servidor interno.

O aviso cobre as filas dos atlas remotos registrados neste navegador, inclusive atlas fechados e abertos em outras abas. Cancelar mantém a sessão e os dados. Confirmar registra a intenção de descarte, anuncia a desmontagem às outras abas e limpa os namespaces remotos. Atlas locais, inclusive recuperações anteriormente adotadas como locais, são excluídos dessa operação. O servidor recebe logout, sem exclusão de atlas ou de conteúdo sincronizado.

Contagem desconhecida exige confirmação. O registro durável do descarte impede que uma limpeza interrompida deixe uma fila antiga pronta para reenvio na próxima abertura. Uma falha ao preparar o mapa vazio também não interrompe a tentativa de limpeza dos namespaces remotos. A política de expiração e perda involuntária de sessão continua separada.

## Validação local

- `npm run lint`: aprovado nos dois pacotes; os últimos ajustes dos testes de navegador também passaram pelo ESLint.
- `npm test` da raiz: 12.137 testes do frontend, 5.009 do backend e 201 de contrato aprovados. A suíte do frontend foi repetida após o último ajuste de produção e permaneceu aprovada.
- Cinco cenários de navegador aprovados: cancelar/confirmar com remoto montado; cancelar/confirmar após trocar para local; sair pela lista com pendência em outra aba; limpeza do mapa remoto sincronizado; preservação do mapa local. Os dois primeiros verificam também a reentrada sem reaparecimento ou envio do ponto descartado.
- Dois cenários adicionais aprovados: descarte do remoto inativo e falha de quota na criação de registro local. O segundo encontrou e verificou a correção da limpeza em `finally`.
- Controle negativo: desabilitar temporariamente a marca de descarte faz falhar os testes de veto antigo e reabertura após limpeza interrompida; restaurar a implementação faz passar os 81 testes direcionados.
- Aviso capturado em Playwright e inspecionado visualmente.

Os testes usam navegador e backend locais com bancos de teste descartáveis. O servidor de produção na rede interna não foi acessado.

Arquivos centrais: `frontend/src/js/session/confirm-logout.js`, `frontend/src/js/store/remote-atlas.api.js`, controle de conta e entradas de atlas, administração e calibração. Decisão registrada em `docs/decisions/decisions-2026.md`.
