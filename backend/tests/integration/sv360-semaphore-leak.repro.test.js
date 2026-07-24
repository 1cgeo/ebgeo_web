// Regressão: o permit do semáforo de BLOB vazava quando o cliente abortava
// enquanto ESPERAVA NA FILA do `acquire()`.
//
// `getPhotoImage` (sv360.controller.js) fazia `await sem.acquire()` PRIMEIRO e só
// então registrava `res.on('finish'|'close', release)`. Sob contenção o acquire
// estaciona na fila por tempo ilimitado, e um cliente que aborta nessa janela faz
// o `res` emitir 'close' ANTES de existir listener. O evento não é reemitido, e
// `res.end()` sobre socket destruído retorna sem emitir 'finish' — o permit ficava
// retido para sempre. `SV360_MAX_INFLIGHT` abortos desses penduram o serviço de
// fotos até o processo reiniciar, sem 429, sem 503 e sem log.
//
// Este é o GÊMEO do defeito de `assets3d.controller.js`, achados #15 e #24 de
// `bugs-backend.md`. O relatório descrevia os dois sítios; a auditoria paralela
// corrigiu o de assets3d e apontou este como idêntico e não coberto. Mesmo bloco
// de fix, mesma forma de teste.
//
// A suíte roda com SV360_MAX_INFLIGHT=1 para que um único vazamento seja fatal.
// A contenção é produzida pelo PRÓPRIO teste tomando o permit (o semáforo é
// exportado), e não por timing de cliente: no Windows/libuv o 'finish' dispara
// mesmo com o peer tendo lido poucos bytes, então tentar segurar o permit por
// backpressure faria o teste passar vazio.
//
// CONTROLE NEGATIVO: mover os listeners de volta para DEPOIS do `await
// sem.acquire()` derruba o primeiro teste (a rota nunca mais responde) e o
// segundo em cascata, porque a capacidade queimada nunca volta.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import net from 'node:net';
import { once } from 'node:events';
import Database from 'better-sqlite3';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';

// Precisa valer ANTES de o config ser lido pelo app: import dinâmico abaixo.
process.env.SV360_MAX_INFLIGHT = '1';

const supertest = (await import('supertest')).default;
const { setupTestEnv, teardownTestEnv } = await import('../helpers/setup.js');
const config = (await import('../../src/config.js')).default;
const { closeStore } = await import('../../src/modules/streetview360/sv360.blobstore.js');
const { sem } = await import('../../src/modules/streetview360/sv360.controller.js');

const NS = Buffer.from('1b671a64-40d5-491e-99b0-da01ff1f3341'.replace(/-/g, ''), 'hex');
function uuidv5(name) {
    const h = crypto.createHash('sha1').update(NS).update(Buffer.from(name, 'utf8')).digest();
    h[6] = (h[6] & 0x0f) | 0x50;
    h[8] = (h[8] & 0x3f) | 0x80;
    const x = h.subarray(0, 16).toString('hex');
    return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

const SLUG = 'proj-sem-leak-sv360';
const DB_FILENAME = `${SLUG}.db`;
const blob = Buffer.from('RIFFxxxxWEBP-leak-repro-bytes!');
const photoId = uuidv5(`default/${SLUG}/leak.jpg`);
const ROTA = `/api/v1/sv360/photos/${photoId}/image`;

describe('StreetView 360 — cliente que aborta na fila não pode queimar o permit', () => {
    let app, db, dbPath, server, porta;

    before(async () => {
        const env = await setupTestEnv();
        app = env.app;
        db = env.db;

        const org = await db.query("SELECT id FROM public.organizations WHERE slug = 'default'");
        const proj = await db.query(
            `INSERT INTO sv360.projects (organization_id, slug, name, center_lat, center_long, db_filename, status, photo_count)
             VALUES ($1, $2, 'Leak', -23, -46, $3, 'enabled', 1) RETURNING id`,
            [org.rows[0].id, SLUG, DB_FILENAME],
        );
        await db.query(
            `INSERT INTO sv360.photos
               (id, project_id, original_name, sequence_number, lat, lon, full_size_bytes, preview_size_bytes)
             VALUES ($1, $2, 'leak.jpg', 1, -23, -46, $3, $3)`,
            [photoId, proj.rows[0].id, blob.length],
        );

        mkdirSync(config.sv360.dbDir, { recursive: true });
        dbPath = path.join(config.sv360.dbDir, DB_FILENAME);
        if (existsSync(dbPath)) rmSync(dbPath, { force: true });
        const sdb = new Database(dbPath);
        sdb.exec('CREATE TABLE images (photo_id TEXT PRIMARY KEY, full_webp BLOB, preview_webp BLOB)');
        sdb.prepare('INSERT INTO images VALUES (?,?,?)').run(photoId, blob, blob);
        sdb.close();

        // Servidor real: só com socket cru dá para abortar a conexão no meio.
        server = app.listen(0);
        await once(server, 'listening');
        porta = server.address().port;
    });

    after(async () => {
        await closeStore();
        for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, `${dbPath}-journal`]) {
            if (f && existsSync(f)) rmSync(f, { force: true });
        }
        if (server) await new Promise((r) => server.close(r));
        await teardownTestEnv();
    });

    it('aborta enquanto espera na fila e o serviço continua respondendo', async () => {
        // 1) O teste toma o único permit: a próxima requisição estaciona no acquire.
        await sem.acquire();

        // 2) Requisição que fica parada na fila, abortada por socket cru.
        const sock = net.connect(porta, '127.0.0.1');
        await once(sock, 'connect');
        sock.write(`GET ${ROTA} HTTP/1.1\r\nHost: localhost\r\n\r\n`);
        await new Promise((r) => setTimeout(r, 150)); // chega ao acquire e para
        sock.destroy();
        await new Promise((r) => setTimeout(r, 150)); // 'close' cai na janela sem listener

        // 3) Devolve o permit do teste. Se o abortado tivesse queimado o dele, a
        //    capacidade seria zero e a rota nunca mais responderia.
        sem.release();

        const resp = await supertest(app).get(ROTA).timeout({ deadline: 8000 });
        assert.equal(resp.status, 200, 'a rota deve seguir servindo após o abort na fila');
        assert.equal(Buffer.from(resp.body).length, blob.length);
    });

    it('requisição normal continua liberando o permit', async () => {
        for (let i = 0; i < 3; i++) {
            const r = await supertest(app).get(ROTA).timeout({ deadline: 8000 });
            assert.equal(r.status, 200, `requisição ${i + 1} deveria passar`);
        }
    });
});
