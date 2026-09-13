# Handoff: proteção de dados e fechamento do EBGeo

Posição de 12/09/2026. Branch de trabalho: `integracao_backend`. Base documental anterior a este handoff: `acaa438b`.

**O candidato ainda não está pronto para lançamento.** As correções abaixo foram implementadas e registradas, mas o plano completo continua pendente. O responsável pediu para interromper novas implementações por limite disponível e deixar documentos para retomada. Este handoff organiza essa passagem de trabalho; não autoriza deploy nem marca pendências como concluídas.

## Contexto e leitura inicial

O objetivo é migrar da main em produção para a integração com backend sem perder dados locais antigos e com sincronização remota segura. O usuário informou que a produção corresponde à main e que protocolo e domínio serão mantidos. A main conferida no dia foi `8b611113aa73c3faedc967ccf77132604255ea8d`; confirmar novamente antes da homologação final. O servidor está em rede interna, sem acesso por esta sessão. Nenhuma implantação foi realizada.

Para retomar:

1. Ler as regras de trabalho em [CLAUDE.md](CLAUDE.md) e as regras do produto em [CONSTITUICAO.md](CONSTITUICAO.md). Para backend, consultar também [backend/CLAUDE.md](backend/CLAUDE.md).
2. Consultar o [índice das correções do dia](docs/reviews/correcoes-2026-09-12/README.md), conferido contra o histórico Git.
3. Consultar o [índice das pendências](docs/reviews/fechamento/README.md) e o [plano completo de fechamento](docs/reviews/plano-fechamento-lancamento.md). Cada documento de pendência informa escopo, evidência atual, arquivos, correção proposta e critérios de aceite.
4. Escolher o próximo bloco respeitando as dependências. Atualizar sua evidência após implementar e testar; não repetir como pendente o que já foi corrigido.

## Correções realizadas

Os documentos são retrospectivas, com problemas, comportamento corrigido, commits, testes registrados e limites. A escrita deles não repetiu os testes do produto.

| Assunto | Documento | Commit |
| --- | --- | --- |
| Opção administrativa de sombreamento e validação de tipo | [Sombreamento do relevo](docs/reviews/correcoes-2026-09-12/01-sombreamento.md) | `d2f956e8` |
| Cópia verificada da main, recuperação e confirmação de descarte no logout | [Migração e logout](docs/reviews/correcoes-2026-09-12/02-migracao-e-logout.md) | `8a561bef` |
| Presença, uso, último login, atlas por dono e consolidação das migrações | [Monitoramento e bases](docs/reviews/correcoes-2026-09-12/03-monitoramento-e-bases.md) | `fa0f0218` |
| Diário, recibos, replay, gerações e conflitos de feições | [Recuperação do sync](docs/reviews/correcoes-2026-09-12/04-recuperacao-do-sync.md) | `f8e109ea` |
| Escritores antigos após descarte, 24 falhas de contrato e camada padrão remota | [Contratos, descarte e camada](docs/reviews/correcoes-2026-09-12/05-contratos-descarte-e-camada.md) | `e70ccf3c` |
| Protocolo obrigatório e preservação de filas incompatíveis | [Protocolo e filas antigas](docs/reviews/correcoes-2026-09-12/06-protocolo-e-filas-antigas.md) | `b26f4e66` |
| Dependências npm corrigidas e instalação limpa | [Dependências](docs/reviews/correcoes-2026-09-12/07-dependencias.md) | `b26f4e66` |
| Intenções de briefing e slides antes da gravação, com materialização atômica | [Briefings e slides](docs/reviews/correcoes-2026-09-12/08-briefings-e-slides.md) | `d2f6c516` |
| Diário no mapa de destino e identidade textual preservada no replay | [Catálogo](docs/reviews/correcoes-2026-09-12/09-catalogo.md) | `d0c99dea` |

O sombreamento pertence a um commit anterior à sequência desta colaboração, com atribuição própria no Git. O commit `d08ccea6` criou os documentos de pendências; `acaa438b` criou a retrospectiva das correções.

## Necessidades de fechamento

Todas as frentes abaixo continuam impedindo a conclusão do lançamento. A numeração dos documentos desdobra as nove etapas do plano original, separando uploads de indicadores/administração.

| Ordem | Documento | Resultado ainda necessário |
| --- | --- | --- |
| 01 | [Compatibilidade](docs/reviews/fechamento/01-compatibilidade.md) | Cobrir exceções estruturais, janelas de edição e revisão das filas antigas |
| 02 | [Persistência](docs/reviews/fechamento/02-persistencia.md) | Diário e recuperação em todos os produtores, incluindo mapas, camadas, grupos, 3D/360 e configurações |
| 03 | [Conflitos](docs/reviews/fechamento/03-conflitos.md) | Revisões das demais entidades e painel persistente de resolução |
| 04 | [Comandos compostos](docs/reviews/fechamento/04-comandos-compostos.md) | Atomicidade ou recuperação explícita de importação, transferência, conversão e undo/redo |
| 05 | [Abas e recuperação](docs/reviews/fechamento/05-abas-e-recuperacao.md) | Barreira durável entre abas, logout, troca de atlas e ativação segura de gerações |
| 06 | [Uploads](docs/reviews/fechamento/06-uploads.md) | Blobs duráveis, retry deduplicado e referências acessíveis aos colaboradores |
| 07 | [Indicadores e administração](docs/reviews/fechamento/07-indicadores-e-administracao.md) | Estado completo das pendências, diagnóstico de falta de progresso e validação da presença |
| 08 | [Segurança](docs/reviews/fechamento/08-seguranca.md) | Concluir vendors, WASM, runtime, autorização e classificação de riscos |
| 09 | [Homologação e migração](docs/reviews/fechamento/09-homologacao-e-migracao.md) | Repetir a matriz final e a troca main para candidato na mesma origem |
| 10 | [Liberação interna](docs/reviews/fechamento/10-liberacao-interna.md) | Backup restaurável, infraestrutura real, piloto e retorno validados na rede interna |

O próximo trabalho de código estava na persistência das configurações de mapa. Foram identificadas gravações de posição e mapa-base anteriores ao diário, inclusive limpeza de posição legada sem ID que pode deixar de emitir exclusão. A preparação ficou somente em arquivo temporário e não entrou no produto; retomar pelo documento 02 e pelo código vigente, sem aplicar um rascunho antigo às cegas.

## Decisões que precisam ser preservadas

- Logout voluntário confirmado descarta as pendências remotas abrangidas pelo aviso. Cancelar mantém o trabalho. Atlas locais e dados já confirmados no servidor não são apagados pela saída.
- Queda de conexão, F5, suspensão, expiração de autenticação e troca de atlas não autorizam descarte. Não reenviar no próximo login o trabalho que o usuário descartou explicitamente.
- Não inventar uma revisão atual para uma edição antiga nem modificar o conteúdo sob um ID de operação que pode já ter chegado ao servidor.
- Protocolo 2 não significa proteção de conflitos em todas as entidades. Fila vazia não comprova convergência nem disponibilidade dos uploads.
- O diário de briefings/slides e catálogo está implementado. As 24 falhas de contrato foram resolvidas. A camada padrão remota já nasce no servidor. As pendências são as ampliações descritas acima.

## Schema, dados de teste e ambiente

As migrações foram consolidadas antes da primeira implantação do backend. Um banco antigo de desenvolvimento não pode ser tratado como instalação nova nem ter seu histórico reescrito automaticamente. Consultar a [organização das migrações](backend/src/database/migrations/README.md).

O catálogo acrescentou a coluna textual de identidade ao histórico de operações. Bancos existentes precisam da transição aditiva documentada no [registro de fechamento](docs/reviews/execucao-fechamento-lancamento.md), após backup, antes de rodar o backend correspondente. Essa transição não foi executada no servidor interno.

Os dados fornecidos ficam em C:\Users\diniz\OneDrive\Desktop\Desenvolvimento\_ebgeo_dados_teste. Usar somente cópias nos ensaios. Conservar protocolo, domínio e porta no ensaio de atualização para reproduzir a mesma origem. A disponibilidade de Web Locks precisa ser validada na origem interna efetiva; mudar HTTP para HTTPS não transfere o IndexedDB anterior.

## Evidências e verificação de continuidade

Última suíte completa registrada, no checkpoint de catálogo: **12.247 testes frontend, 5.054 backend e 201 contratos aprovados**, sem falhas/skips; lint e build aprovados. O cenário de catálogo com dois navegadores passou duas vezes e a captura foi inspecionada. Isso valida aquele checkpoint, não o fechamento inteiro. Os documentos posteriores passaram nos testes de integridade documental; não são nova homologação do produto.

Os registros detalhados preservam também falhas intermediárias, controles negativos e limitações:

- [Execução da migração](docs/reviews/execucao-correcao-migracao-2026-09-12.md), [dados externos](docs/reviews/teste-dados-externos-2026-09-12.md) e [perfil real da main](docs/reviews/perfil-real-main-integracao-2026-09-12.md).
- [Implementação do monitoramento](docs/reviews/2026-09-12-implementacao-monitoramento.md).
- [Execução do sincronismo remoto](docs/reviews/execucao-correcao-atlas-remoto.md).
- [Execução do fechamento](docs/reviews/execucao-fechamento-lancamento.md) e [inventário de dependências](docs/reviews/dependencias-lancamento-inventario.json).

Após mudar lógica, executar lint e teste completos da raiz em comandos separados, além dos ensaios pertinentes. Não executar build junto de testes que inspecionam dist. Suítes que usam banco devem rodar em sequência. UI exige Playwright com backend real e inspeção da captura. Verificar código de saída; não tomar o anúncio de início de uma etapa como conclusão. Controles negativos devem restaurar as fontes. Registrar commit, resultado e pendências reais em cada entrega.
