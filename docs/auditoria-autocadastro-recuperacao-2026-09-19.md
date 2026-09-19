# Auditoria de autocadastro e recuperação de senha : 19/09/2026

Escopo: formulário, API, persistência, confirmação de e-mail, reenvio, configuração em runtime e
“Esqueci minha senha”. PostgreSQL real e Chromium com backend real em bancos descartáveis.
Não houve acesso à intranet nem envio de mensagens reais. A migração local foi aplicada sem apagar o banco.

## Achados corrigidos

| Achado | Consequência anterior | Proteção e evidência |
| --- | --- | --- |
| Alta: confirmação sem vínculo ao destinatário | Link enviado ao endereço antigo confirmava outro endereço corrigido pelo administrador. | Snapshot `email_at_issue`; comparação atômica com o endereço atual e conta ativa. Reenvio após correção testado. |
| Alta: código de senha sobrevivia à mudança da conta | Código continuava a trocar a senha após alteração do e-mail, perda da confirmação ou revogação de sessões. | Resgate exige endereço confirmado e corte de sessões iguais aos da emissão. |
| Média: emissão concorrente de recuperação | Dois pedidos simultâneos deixavam dois códigos utilizáveis. | Lock da conta, substituição transacional e mesma ordem de locks no resgate. Dois pedidos concorrentes deixam um código; dois resgates produzem um sucesso e uma recusa. |
| Média: falha na substituição do código | O código anterior era consumido antes de a gravação do substituto falhar. | Rollback preserva o código anterior; teste injeta erro real no INSERT. |
| Média: diferenças de resposta denunciavam conta existente | Reenvio/recuperação retornavam 500 apenas para a conta encontrada quando falhava a emissão. | Falha específica da emissão é registrada internamente; resposta externa permanece uniforme. Não há garantia de tempo constante. |
| Média: cadastros concorrentes com mesmo usuário/e-mail | Ambos passavam na pré-checagem; o perdedor recebia erro de unicidade em vez da resposta uniforme. | Índices únicos arbitram `INSERT ... ON CONFLICT DO NOTHING`; a API mantém 201 sem revelar se criou. Uma conta, inclusive com diferença de caixa. |
| Média: posto inexistente distinguia nome livre de ocupado | A FK falhava apenas no ramo que criava a conta. | Posto ativo é validado antes de consultar unicidade; ambos os casos recebem a mesma recusa. A OM padrão também é validada quando omitida no pedido. |
| Média: truncamento de senha pelo bcrypt | Senhas diferentes além de 72 bytes eram aceitas como se todo o conteúdo fosse significativo. | Autocadastro e recuperação recusam mais de 72 bytes UTF-8 no servidor e no formulário; teste inclui acentos. Login legado não mudou. |
| Média: ativação pelo painel sem configuração de envio | Override habilitava autocadastro em produção sem os requisitos exigidos no boot. | Painel recusa ativação; configuração efetiva também neutraliza override antigo. Teste em processo com `NODE_ENV=production`, sem SMTP. |
| Baixa: confirmação/reenvio de conta desativada | Conta desativada ainda recebia confirmação e podia ter seu e-mail marcado como verificado. | Ambas as operações verificam atividade; resposta de reenvio continua genérica. |
| Baixa: ausência das listas de posto/OM | Fallback textual enviava nomes para campos UUID, tornando o cadastro impossível. | Seletores indisponíveis e mensagem de orientação, com envio bloqueado. |
| Baixa: resposta atrasada após cancelar cadastro | Callback abria um novo diálogo depois de o operador sair do fluxo. | Retorno tardio respeita o fechamento. O pedido já enviado pode ter criado a conta. |
| Baixa: interface prometia entrega de e-mail | Mensagem afirmava envio mesmo com operação de entrega best-effort. | Texto explica o próximo passo sem afirmar entrega efetiva. |

## Controles preservados e exercitados

- Autocadastro nasce `user`, sem escopo de produção; campos forjados de administrador e confirmação
  não concedem privilégios. OM continua autodeclarada e não autoriza recursos.
- Login de conta pendente é recusado. Cadastro, confirmação e login foram percorridos no navegador.
- Código de recuperação tem prazo curto, uso único e finalidade própria: não confirma e-mail;
  link de confirmação não redefine senha. Expiração não troca a senha.
- Redefinição encerra sessões existentes e gera trilha de auditoria na mesma transação.
- Erro de rede no cadastro conserva os campos. Repetir após perda da resposta não duplica a conta.
- Perder a resposta da redefinição pode deixar a senha já alterada. O código usado é recusado;
  solicitar outro permite concluir o fluxo e entrar com a nova senha. A interface limpa os segredos após sucesso confirmado.
- Limites de requisição, gates de configuração e construção dos links com origem confiável têm
  regressões existentes executadas na suíte geral. Não se prometeu aprovação administrativa no autocadastro.

## Migração e operação

Aplicar as migrações incrementais **017 e 018 antes de subir o código atualizado**. Elas acrescentam
colunas e não apagam usuários, senhas, atlas ou imagens. Não há backfill com o e-mail atual: isso
inventaria que o link histórico foi enviado a ele e manteria a vulnerabilidade.

Links de confirmação e códigos de recuperação emitidos antes da atualização, sem snapshot,
passam a ser recusados. Quem ainda não confirmou usa **Reenviar** no cadastro/login; quem precisa
redefinir a senha solicita outro código em **Esqueci minha senha**. Contas já confirmadas continuam
entrando normalmente. Tokens de troca de e-mail têm finalidade própria e não dependem destas colunas.

## Evidência de teste

- `backend/tests/integration/self-registration-audit.test.js`: corrida de unicidade, destinatário,
  conta desativada, token legado, privilégios e limite em bytes.
- `backend/tests/integration/password-recovery-audit.test.js`: seis reproduções negativas antes
  do conserto; vínculo à conta, concorrência, rollback e limite em bytes depois dele.
- `backend/tests/integration/self-registration-production-config.test.js`: processo de produção
  recusa ativação sem entrega e neutraliza override persistido.
- `frontend/tests/e2e-ui/browser-account-recovery-audit.spec.js`: rede perdida/atrasada,
  listas ausentes, limite em bytes e recuperação completa. Controle negativo do formulário antigo
  reproduziu três falhas; capturas dos estados de erro/sucesso inspecionadas visualmente.
- `frontend/tests/e2e-ui/browser-signup.spec.js`: cadastro, confirmação, login e senhas divergentes.

Validação: `npm run lint` aprovado; suíte geral do backend com **5.337 testes aprovados**;
**63 testes dirigidos** aprovados incluindo as verificações adicionais de produção/migração;
contratos frontend/backend com **250 testes aprovados**; Chromium com **7 cenários aprovados**.
O controle negativo final retirou apenas a proteção de conflito e a validação de posto:
as duas corridas voltaram a produzir 409/201, e o posto inexistente voltou a distinguir
nome livre (409) de ocupado (201). Restauradas as proteções, os nove casos de autocadastro passaram.
Frontend: **13.418 testes**, com as expectativas antigas de formulário/limite de senha atualizadas;
as quatro suítes afetadas passaram também em rodada dirigida de **37 testes**.

## Limites e riscos residuais

- Entrega real depende de SMTP, DNS, autenticação do relay e caixa postal. Não foi verificada na
  intranet, conforme escopo autorizado. Não existe fila durável de e-mail/retry de entrega: falhas
  de SMTP são registradas e o operador precisa pedir novo envio. Falha de SMTP após substituir
  um código pode deixar somente o código novo válido, embora a mensagem não tenha chegado.
- Resposta uniforme não significa tempo constante: conta encontrada executa operações adicionais
  e pode aguardar SMTP. Limitação de requisições reduz abuso, mas permanece canal temporal.
- Tokens são UUIDs aleatórios de uso único, mantidos em claro na tabela de credenciais. Uma conta
  de banco com leitura dessa tabela pode obter códigos válidos; hash dos tokens seria proteção
  adicional. Logs de desenvolvimento deliberadamente contêm os links/códigos, ao contrário de produção.
- A regra de reserva indefinida de nomes/e-mails pendentes foi mantida por decisão expressa da
  cláusula 10.6. Também foi mantida a política de senha mínima de seis caracteres. Esta auditoria
  não certifica toda a autenticação nem substitui ensaio operacional do serviço de e-mail.
- O teto em bytes foi aplicado aos dois fluxos auditados. Outros fluxos de definição de senha
  (por exemplo, criação administrativa) ainda precisam da mesma revisão de política.

Referência de critérios: [OWASP : Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html),
especialmente resposta uniforme, finalidade, expiração e uso único. Os achados acima vêm das
reproduções no EBGeo; não se afirma conformidade integral com o guia.
