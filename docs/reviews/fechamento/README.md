# Trabalho restante para o lançamento

Posição de 12/09/2026, branch `integracao_backend`, após `d0c99dea`. A pedido do responsável, a implementação foi interrompida para conservar limite e registrar as próximas tarefas. **Nenhum item abaixo está concluído por ter sido documentado. O candidato ainda não está liberado.**

Este índice desdobra o [plano autorizado](../plano-fechamento-lancamento.md). O [registro de execução](../execucao-fechamento-lancamento.md) contém resultados, falhas intermediárias e limites dos três checkpoints implementados. Não refazer como pendentes os contratos já corrigidos, a camada padrão criada pelo servidor, o diário de briefings/slides ou o diário e a identidade de catálogo.

## Ordem de retomada

| Documento | Prioridade | Dependência para encerrar |
| --- | --- | --- |
| [01. Compatibilidade restante](01-compatibilidade.md) | Bloqueia lançamento | Contrato atual e inventário das exceções |
| [02. Persistência dos demais produtores](02-persistencia.md) | Bloqueia lançamento | 01; aproveitar os diários existentes |
| [03. Conflitos e resolução](03-conflitos.md) | Bloqueia lançamento | 01 e 02 |
| [04. Comandos compostos](04-comandos-compostos.md) | Bloqueia lançamento | 02 e 03 |
| [05. Abas, logout e recuperação](05-abas-e-recuperacao.md) | Bloqueia lançamento | 02 a 04 |
| [06. Uploads duráveis](06-uploads.md) | Bloqueia lançamento | 02, 03 e 05 |
| [07. Indicadores e administração](07-indicadores-e-administracao.md) | Bloqueia lançamento | 03, 05 e 06 |
| [08. Segurança restante](08-seguranca.md) | Bloqueia lançamento | Inventariar desde o início; encerrar após as mudanças |
| [09. Homologação e migração](09-homologacao-e-migracao.md) | Bloqueia lançamento | 01 a 08 |
| [10. Liberação interna e retorno](10-liberacao-interna.md) | Bloqueia lançamento | 09 e responsável na rede interna |

## Base e regras de continuidade

- Main e origin/main conferidos nesta execução: `8b611113aa73c3faedc967ccf77132604255ea8d`. O usuário informou que a produção corresponde à main; confirmar novamente antes do ensaio final.
- Checkpoints: `b26f4e66` (protocolo, filas antigas e dependências npm), `d2f6c51` (briefings/slides), `d0c99dea` (catálogo). Não houve publicação no servidor interno.
- Última validação completa: 12.247 testes frontend, 5.054 backend e 201 contratos; lint e build aprovados. O catálogo passou duas vezes no navegador com backend real. Isso valida o checkpoint, não os itens restantes.
- A coluna textual do histórico pertence à base lógica de sync. Bancos existentes precisam da transição aditiva registrada na execução antes de rodar esse backend; não apagar banco nem reescrever histórico automaticamente.
- Logout voluntário confirmado descarta pendências remotas abrangidas pelo aviso. F5, queda de conexão, expiração ou troca de atlas não autorizam descarte. Não reenviar trabalho descartado no login seguinte.
- Nunca atualizar o conteúdo sob um ID que pode já ter chegado ao servidor, nem inventar uma base atual para uma edição antiga.
- Ensaios usam cópias de `_ebgeo_dados_teste`. A origem interna conserva protocolo e domínio; no ensaio local, conservar também a porta para reproduzir a mesma origem.

Cada documento deve ser atualizado com commit, testes, resultado observável e limitações quando executado. Para lógica: lint e teste completos da raiz em comandos separados; build antes da suíte que inspeciona dist; suites com banco em sequência. UI exige Playwright com backend real e inspeção da captura. Controles negativos devem restaurar as fontes. A preparação experimental de posição/mapa-base ficou apenas em arquivo temporário, não foi aplicada ao repositório e não é implementação aproveitável sem nova revisão.
