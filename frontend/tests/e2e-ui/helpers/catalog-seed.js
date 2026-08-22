// Path: e2e-ui/helpers/catalog-seed.js

/**
 * RECURSO DE CATÁLOGO REAL para os specs de 3D e 360, escrito no Postgres descartável.
 *
 * POR QUE ISTO EXISTE. A borda de escrita do sync recusa uma op que REFERENCIA um recurso que o
 * autor não enxerga (`unseenResourceDenialReason`, `backend/src/modules/sync/sync.service.js`), e
 * "linha ausente" conta como não enxerga, por decisão escrita na própria consulta
 * (`canSeeCatalogResource`: NO ROW MEANS REFUSE). Enquanto os specs inventavam o id do recurso, o
 * servidor devolvia `rejected` com motivo e a entidade nunca chegava ao par: TREZE specs vermelhos
 * com a mesma causa, e nenhum deles falando dela (o teste morre num `expect.poll` que expira, e o
 * toast que carrega o motivo não tem quem o veja num navegador sem tela).
 *
 * POR QUE POR SQL, E NÃO PELA ROTA. `POST /api/v1/tilesets` exige papel global de produtor, que
 * só se concede escrevendo em `users`; e um projeto 360 não tem rota de criação nenhuma (ele
 * nasce da ingestão, fora de banda). Os dois caminhos passariam pelo banco de todo jeito, então
 * o INSERT direto é o mais curto e o mais honesto sobre o que está fazendo.
 *
 * O RECURSO NASCE PÚBLICO de propósito: o que estes specs medem é a CONVERGÊNCIA da op entre dois
 * clientes, não a privacidade. Quem mede a privacidade é o censo de superfícies dos dois pacotes.
 *
 * A CONEXÃO É A DE `db.js`, e nunca uma segunda. Abrir um pool próprio aqui custou uma medição: o
 * `pgp.end()` que `accounts.js` chamava derrubava TODOS os pools do processo, e não só os da
 * instância que o chamou, então criar uma conta no meio da rodada matava esta conexão e a chamada
 * seguinte voltava "Connection pool of the database object has been destroyed". Os dois pontos de
 * fechamento agora usam `conn.$pool.end()`, mas a regra fica: uma conexão só, e a de `db.js`.
 */

import { createDb } from './db.js';

/** Organização semeada pela migração 001, dona dos recursos que criamos aqui. */
const ORG_PADRAO = '00000000-0000-0000-0000-000000000001';

/** A conexão compartilhada de `db.js`, resolvida a cada chamada (ela pode ter sido fechada). */
function conectar(dbName) {
    return createDb(dbName).raw;
}

/**
 * Cria um tileset PÚBLICO e ativo, e devolve o id que a op deve referenciar.
 *
 * @param {string} dbName - `readState().dbName`.
 * @param {{id?: string, name?: string}} [opts]
 * @returns {Promise<string>} O id do tileset.
 */
export async function seedTileset(dbName, { id, name = 'Tileset de teste' } = {}) {
    const tilesetId = id ?? `tileset-e2e-${Math.random().toString(36).slice(2, 10)}`;
    await conectar(dbName).none(
        `INSERT INTO tilesets (id, name, description, config, active, access_level)
         VALUES ($1, $2, 'semeado pelo e2e', '{}'::jsonb, true, 'public')
         ON CONFLICT (id) DO UPDATE SET active = true, access_level = 'public'`,
        [tilesetId, name],
    );
    return tilesetId;
}

/**
 * Cria um projeto 360 PÚBLICO com uma foto, e devolve o `original_name` dela, que é a forma
 * pela qual `streetview360_data.photo_name` referencia o projeto (`RESOLVE_SV360_REFS`).
 *
 * @param {string} dbName - `readState().dbName`.
 * @param {{photoName?: string, slug?: string}} [opts]
 * @returns {Promise<{photoName: string, projectId: string, slug: string}>}
 */
export async function seedSv360Photo(dbName, { photoName, slug } = {}) {
    const sufixo = Math.random().toString(36).slice(2, 10);
    const nomeFoto = photoName ?? `foto-e2e-${sufixo}.jpg`;
    const slugProjeto = slug ?? `projeto-e2e-${sufixo}`;
    const conn = conectar(dbName);
    const projeto = await conn.one(
        `INSERT INTO sv360.projects (organization_id, slug, name, db_filename, status, access_level)
         VALUES ($1, $2, $3, $4, 'enabled', 'public')
         RETURNING id`,
        [ORG_PADRAO, slugProjeto, `Projeto 360 ${sufixo}`, `${slugProjeto}.db`],
    );
    await conn.none(
        `INSERT INTO sv360.photos (id, project_id, original_name, sequence_number, lat, lon)
         VALUES ($1, $2, $3, 1, -22.9, -43.2)`,
        [`foto-${sufixo}`, projeto.id, nomeFoto],
    );
    return { photoName: nomeFoto, projectId: projeto.id, slug: slugProjeto };
}
