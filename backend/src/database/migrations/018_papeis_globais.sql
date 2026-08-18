-- 018_papeis_globais.sql
--
-- Os QUATRO papéis globais de `users.role` e o escopo de PRODUÇÃO que um deles
-- carrega. Substitui a versão anterior desta migração (018_user_role_curator.sql),
-- que introduzia um terceiro valor 'curator'.
--
-- POR QUE A 018 FOI REESCRITA EM VEZ DE CORRIGIDA POR UMA 019. Migração é
-- forward-only porque um banco de produção já a aplicou; este branch não foi
-- aplicado em lugar nenhum, então a 018 nunca existiu fora daqui e reescrevê-la é
-- mais honesto do que deixar um degrau que cria um valor para o degrau seguinte
-- apagar. O que NÃO se pode assumir é que nenhum banco de DESENVOLVIMENTO rodou a
-- versão antiga: o `UPDATE` defensivo abaixo existe exatamente para esse caso, e é
-- barato o suficiente para não precisar de certeza.
--
-- OS QUATRO VALORES NÃO SÃO UMA ESCADA. 'user', 'producer', 'credenciado' e
-- 'admin' não se contêm: nenhum deles é "o de cima" de outro, e comparar papel
-- global por ordem (>=, índice em array, ROLE_ORDER) é erro de leitura, não
-- otimização. A versão anterior deste arquivo dizia "um perfil ENTRE `user` e
-- `admin`", que é justamente a leitura de escada que o desenho recusa. O eixo POR
-- ATLAS (read < comment < write < manage < owner) É uma escada, é gateado pela
-- hierarquia, e não compartilha uma palavra com este.
--
--   user         quem entra e usa. Sem nada de global.
--   producer     MANTÉM o que a OM dele produziu (catálogo e projetos 360 daquela
--                OM). Escopo em `producer_org_id`. Escreve, e só dentro do escopo.
--   credenciado  LÊ todo recurso privado do sistema e NÃO ESCREVE NADA. Não passa
--                em requireAdmin, não vira dono de atlas, não edita catálogo, não
--                abre lixeira global, não vira 'admin' em toFrontendRole.
--   admin        administra o sistema.
--
-- O risco desta fase é o INVERSO do usual em gate de permissão: não é excluir o
-- nível de cima com uma lista fechada, é alguém escrever `if (role !== 'user')`
-- num gate de PODER e promover o credenciado ou o produtor em silêncio.
-- `backend/tests/unit/papel-global-censo.test.js` classifica cada sítio e reprova
-- o que aparecer sem classificação.
--
-- ISTO É DDL DESTRUTIVA pela definição de `tests/unit/migrations-higiene.test.js`
-- (o padrão `DROP CONSTRAINT`), e por isso EXIGE uma linha em EXCECOES_DESTRUTIVAS
-- naquele arquivo, NO MESMO COMMIT. Esquecer deixa a suíte vermelha com uma
-- mensagem que não parece ter relação nenhuma com permissões.

-- ---------------------------------------------------------------------------
-- 1. O CHECK dos quatro papéis
-- ---------------------------------------------------------------------------
--
-- A ORDEM DAS TRÊS LINHAS ABAIXO É O CONTRATO, não estilo. O `UPDATE` precisa
-- rodar com o CHECK JÁ DERRUBADO: enquanto o constraint antigo estiver de pé ele
-- aceita 'curator' e recusa 'credenciado', então converter antes de derrubar
-- falha com 23514 sobre o valor NOVO, que é a mensagem mais confusa possível.
-- Postgres não tem ALTER CONSTRAINT para expressão de CHECK, então a janela sem
-- constraint é inevitável; ela dura o que dura esta transação.
ALTER TABLE users DROP CONSTRAINT users_role_check;

-- Defensivo, e no-op no caminho normal: em banco novo esta linha afeta zero
-- linhas. Ela existe para o banco de desenvolvimento que rodou a 018 antiga e tem
-- alguém marcado 'curator'. A conversão é 1:1 de propósito — 'credenciado' é o
-- MESMO papel com o nome que o dono escolheu, não um papel novo com semântica
-- parecida —, então converter é preservar a intenção de quem marcou, e não
-- adivinhar. O valor 'curator' morre aqui: o CHECK novo o recusa, e é isso que
-- torna esta migração uma SUBSTITUIÇÃO e não um alargamento.
UPDATE users SET role = 'credenciado' WHERE role = 'curator';

ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('user','producer','credenciado','admin'));

-- ---------------------------------------------------------------------------
-- 2. O escopo de produção
-- ---------------------------------------------------------------------------
--
-- UMA OM SÓ, e é decisão de produto, não limitação técnica: quem mantém o que
-- várias OMs produzem é administrador. Uma tabela de junção (usuário x OM)
-- caberia no schema e foi recusada porque transformaria "quem produz isto?" numa
-- pergunta com resposta plural, e o gate de escrita precisa de resposta única.
--
-- NÃO EXPIRA, e a assimetria com `resource_grants.expires_at` (019) é deliberada:
-- concessão de acesso é favor e caduca; ser produtor é FUNÇÃO, e função se tira
-- por ato de administração, não por relógio. Um `expires_at` aqui faria a OM
-- perder o mantenedor do próprio acervo num aniversário que ninguém marcou.
--
-- É `REFERENCES organizations(id)` e não uma cópia do slug porque a OM pode ser
-- renomeada, e porque o gate de produção compara ESTE valor com a coluna dona do
-- recurso (`owner_org_id` / `sv360.projects.organization_id`), que também é FK.
ALTER TABLE users ADD COLUMN producer_org_id UUID REFERENCES organizations(id);

-- O BICONDICIONAL: crachá sem escopo e escopo sem crachá são os DOIS estados
-- impossíveis, e um CHECK unidirecional só pegaria um deles.
--
--   (producer, OM)      OK   -- produtor com escopo
--   (producer, NULL)    NÃO  -- crachá sem escopo: produz o quê, de quem?
--   (user, OM)          NÃO  -- escopo sem crachá: sobra de rebaixamento, e é o
--                            --   estado perigoso, porque o dia em que alguém
--                            --   promover essa conta de volta ela reencontra um
--                            --   escopo que ninguém reviu
--   (user, NULL)        OK
--
-- Repare que o bicondicional é sobre 'producer', NÃO sobre "não é user":
-- (admin, OM) e (credenciado, OM) também são recusados. Admin não tem escopo
-- porque alcança todos, e credenciado não escreve nada — dar escopo a qualquer um
-- dos dois seria escrever uma segunda resposta para "quem produz por esta OM".
--
-- NENHUM DOS DOIS LADOS PODE SER NULL, então o CHECK nunca degrada para o
-- "desconhecido = passa" do SQL: `role` é NOT NULL e `IS NOT NULL` devolve
-- booleano sempre. Um CHECK que pode dar NULL é um CHECK que aprova em silêncio.
--
-- CUSTO CONHECIDO, e é da borda de escrita, não daqui: um UPDATE parcial (mudar
-- `role` sem limpar `producer_org_id`, ou o inverso) bate aqui com 23514, que o
-- `errorHandler` não mapeia e devolve como 500. O espelho deste bicondicional no
-- Joi de `users.schemas.js` é o que transforma isso em 422 com nome de campo, e
-- é trabalho da fase de aplicação.
ALTER TABLE users ADD CONSTRAINT users_producer_scope_check
  CHECK ((role = 'producer') = (producer_org_id IS NOT NULL));

-- Índice PARCIAL no lado pequeno, como os de 017: produtores são poucos e a
-- pergunta que a tela de administração faz é "quem produz por esta OM?".
-- O gate de escrita não usa este índice — ele resolve o usuário pela PK.
CREATE INDEX idx_users_producer_org ON users(producer_org_id)
  WHERE producer_org_id IS NOT NULL;
