-- AS CHAVES DA SONDA, com UUID fixo para que o roteiro de curl seja copiável.
--
-- ELAS SÓ EXISTEM NESTE AMBIENTE. A cópia do `ebgeo_zero` não as tem; elas nascem
-- aqui, depois da restauração, e o banco vive num volume do compose.
--
-- POR QUE UMA LINHA POR TERMO DO PREDICADO. `FIND_USER_BY_API_KEY` cobra prazo,
-- revogação individual, conta ativa, OM ativa e corte de sessão na MESMA consulta.
-- Uma sonda com uma chave só mede "abre ou não abre" e não diz por qual termo; com
-- uma linha por termo, cada recusa tem um par positivo do lado (a chave viva do
-- mesmo dono), que é o que separa "recusou" de "não achou".
--
-- OS DOIS USUÁRIOS DE SONDA NASCEM AQUI em vez de eu desativar `pedro`: mexer no
-- estado de uma conta real do banco copiado faria a sonda mudar o ambiente que ela
-- mede. O `password_hash` é lixo declarado; ninguém entra por estas contas.

-- Conta desativada, dona de uma chave que fora isso seria viva.
INSERT INTO users (username, password_hash, nome, role, is_active, email_verified)
VALUES ('sonda_inativa', 'nao-e-um-hash-ninguem-entra-por-aqui', 'Sonda: conta desativada', 'user', false, true)
ON CONFLICT (username) DO NOTHING;

-- Conta cortada em massa (sessions_valid_from posterior ao nascimento da chave).
INSERT INTO users (username, password_hash, nome, role, is_active, email_verified, sessions_valid_from)
VALUES ('sonda_cortada', 'nao-e-um-hash-ninguem-entra-por-aqui', 'Sonda: sessão cortada', 'user', true, true, NOW() - INTERVAL '30 minutes')
ON CONFLICT (username) DO NOTHING;

INSERT INTO api_keys (api_key, user_id, label, scope, created_at, expires_at, revoked_at)
SELECT v.chave::uuid, u.id, v.rotulo, v.escopo, v.nascimento, v.prazo, v.revogada
FROM (VALUES
    -- VIVA, escopo `tiles`. É a chave que o roteiro usa como par positivo.
    ('aaaaaaaa-0000-4000-8000-000000000001', 'pedro',         'sonda: viva escopo tiles', 'tiles',
     NOW() - INTERVAL '1 hour',   NOW() + INTERVAL '80 days',  NULL::timestamptz),
    -- VIVA, escopo `full`. Prova que o gate do tile aceita os DOIS escopos do
    -- vocabulário: o predicado é "está no vocabulário", não "é igual a tiles".
    ('aaaaaaaa-0000-4000-8000-000000000002', 'diniz',         'sonda: viva escopo full',  'full',
     NOW() - INTERVAL '1 hour',   NOW() + INTERVAL '80 days',  NULL),
    -- VENCIDA. Nasceu há 200 dias com prazo de 190: dentro do teto de um ano do
    -- CHECK, e morta há dez.
    ('aaaaaaaa-0000-4000-8000-000000000003', 'pedro',         'sonda: vencida',           'tiles',
     NOW() - INTERVAL '200 days', NOW() - INTERVAL '10 days',  NULL),
    -- REVOGADA individualmente, com as outras chaves do mesmo dono intactas, que é
    -- a amarra 3 inteira.
    ('aaaaaaaa-0000-4000-8000-000000000004', 'pedro',         'sonda: revogada',          'tiles',
     NOW() - INTERVAL '1 hour',   NOW() + INTERVAL '80 days',  NOW() - INTERVAL '5 minutes'),
    -- Conta desativada.
    ('aaaaaaaa-0000-4000-8000-000000000005', 'sonda_inativa', 'sonda: conta desativada',  'tiles',
     NOW() - INTERVAL '1 hour',   NOW() + INTERVAL '80 days',  NULL),
    -- Corte de sessão em massa: a chave nasceu ANTES do carimbo.
    ('aaaaaaaa-0000-4000-8000-000000000006', 'sonda_cortada', 'sonda: sessão cortada',    'tiles',
     NOW() - INTERVAL '1 hour',   NOW() + INTERVAL '80 days',  NULL)
) AS v(chave, dono, rotulo, escopo, nascimento, prazo, revogada)
JOIN users u ON u.username = v.dono
ON CONFLICT (api_key) DO NOTHING;

-- O que ficou de pé, para o log da subida dizer em voz alta.
SELECT k.api_key, u.username, k.label, k.scope,
       (k.revoked_at IS NULL AND k.expires_at > NOW() AND u.is_active
        AND (u.sessions_valid_from IS NULL OR k.created_at > u.sessions_valid_from)) AS deve_abrir
FROM api_keys k JOIN users u ON u.id = k.user_id
ORDER BY k.label;
