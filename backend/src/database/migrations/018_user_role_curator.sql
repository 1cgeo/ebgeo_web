-- 018_user_role_curator.sql
--
-- Alarga o CHECK de `users.role` com um terceiro valor, 'curator' (D5): o papel
-- GLOBAL que enxerga todo recurso privado do catálogo sem ser administrador do
-- sistema.
--
-- POR QUE UM VALOR DE `role` E NÃO UM EIXO NOVO. Um marcador em tabela à parte
-- seria estritamente mais reversível (nenhuma DDL destrutiva), e foi recusado
-- porque criaria duas respostas para "o que este usuário é": o pedido do dono é
-- um perfil ENTRE `user` e `admin`, que é o eixo de papel. O custo está aceito e
-- nomeado na decisão.
--
-- O QUE ESTE VALOR NÃO DÁ. Curador não é administrador. Ele não passa em
-- `requireAdmin`, não vira dono de atlas em `requireAtlasPermission`, não abre a
-- lixeira global, não escreve catálogo nem projeto 360, e não vira 'admin' em
-- `toFrontendRole`. Os quatro gates continuam comparando `=== 'admin'` e é assim
-- que eles têm de continuar: o risco desta fase é o INVERSO do usual — não é
-- excluir o nível de cima, é alguém escrever `if (role !== 'user')` num gate de
-- poder e promover o curador em silêncio. `backend/tests/unit/papel-global-censo.test.js`
-- classifica cada sítio e reprova o que aparecer sem classificação.
--
-- ALARGAR UM CHECK É COMPATÍVEL PARA TRÁS: todo valor aceito antes continua
-- aceito, então nenhuma linha e nenhum escritor existente é afetado. É o mesmo
-- alargamento de 007_audit_zone_actions.sql, e não uma redefinição. O constraint
-- precisa ser derrubado e recriado porque Postgres não tem ALTER CONSTRAINT para
-- expressão de CHECK.
--
-- ISTO É DDL DESTRUTIVA pela definição de `tests/unit/migrations-higiene.test.js`
-- (o padrão `DROP CONSTRAINT`), e por isso EXIGE uma linha nova em
-- EXCECOES_DESTRUTIVAS naquele arquivo, NO MESMO COMMIT. Esquecer deixa a suíte
-- vermelha com uma mensagem que não parece ter relação nenhuma com permissões.

ALTER TABLE users DROP CONSTRAINT users_role_check;

ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('user','admin','curator'));
