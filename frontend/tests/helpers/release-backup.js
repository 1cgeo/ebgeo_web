// Exercise pg_dump/pg_restore and binary-file restoration on disposable databases only.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify, isDeepStrictEqual } from 'node:util';
import { mkdir, cp, readdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { readState } from '../e2e-ui/state.js';
import { pgPromise, appDbUrl, dropDatabase, killPid } from '../e2e-ui/backend.js';
import { BACKEND_DIR, OBITO_FILE, STATE_FILE } from '../e2e-ui/constants.js';

const run = promisify(execFile);

async function files(directory, base = directory) {
    const result = {};
    for (const item of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, item.name);
        if (item.isDirectory()) Object.assign(result, await files(path, base));
        else result[path.slice(base.length + 1)] = createHash('sha256').update(await readFile(path)).digest('hex');
    }
    return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}

async function tables(db, pgp) {
    const rows = await db.any("SELECT schemaname, tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY schemaname,tablename");
    const result = {};
    for (const row of rows) {
        const name = pgp.as.name(row.schemaname) + '.' + pgp.as.name(row.tablename);
        result[name] = await db.one(`SELECT count(*)::int AS rows, md5(coalesce(string_agg(to_jsonb(t)::text, '' ORDER BY to_jsonb(t)::text), '')) AS hash FROM ${name} t`);
    }
    return result;
}

export async function verifyServerBackup({ atlasId, credentials, snapshot, outputDir }) {
    const state = readState();
    assert.match(state.dbName, /^ebgeo_ui_e2e_/);
    const restoredName = 'ebgeo_release_restore_' + Date.now();
    const pgp = pgPromise();
    const admin = pgp(appDbUrl('postgres'));
    const source = pgp(appDbUrl(state.dbName));
    const binaryRoot = join(BACKEND_DIR, 'data/ui-e2e-images');
    const restoredImages = resolve(outputDir, 'restored-images');
    let restored, child;
    try {
        await mkdir(outputDir, { recursive: true });
        // No writer remains while the relational and file parts are copied.
        assert.equal((await fetch(state.baseUrl + '/api/v1/health')).status, 200);
        killPid(state.pid);
        await writeFile(STATE_FILE, JSON.stringify({ ...state, stoppedForBackup: true }));
        for (let i = 0; i < 40; i++) {
            try { await fetch(state.baseUrl + '/api/v1/health'); } catch { break; }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        const before = await tables(source, pgp);
        const imageHashes = await files(binaryRoot);
        assert.ok(Object.keys(imageHashes).length > 0, 'backup precisa conter imagens reais');
        await cp(binaryRoot, join(outputDir, 'backup-images'), { recursive: true });
        await cp(join(outputDir, 'backup-images'), restoredImages, { recursive: true });
        assert.deepEqual(await files(restoredImages), imageHashes);
        const { server_version_num: version } = await source.one('SHOW server_version_num');
        const bin = process.env.PG_BIN || `C:/Program Files/PostgreSQL/${Math.floor(Number(version) / 10000)}/bin`;
        const connection = new URL(appDbUrl(state.dbName));
        const env = { ...process.env, PGPASSWORD: decodeURIComponent(connection.password) };
        const hostArgs = ['-h', connection.hostname, '-p', connection.port || '5432', '-U', decodeURIComponent(connection.username)];
        const dump = resolve(outputDir, 'database.dump');
        await run(join(bin, 'pg_dump.exe'), [...hostArgs, '-d', state.dbName, '-Fc', '-f', dump], { env, windowsHide: true });
        await admin.none(`CREATE DATABASE ${pgp.as.name(restoredName)}`);
        // PostGIS extension creation requires the local test superuser.
        const superUrl = new URL(process.env.SUPERUSER_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres');
        await run(join(bin, 'pg_restore.exe'), ['-h', superUrl.hostname, '-p', superUrl.port || '5432', '-U', decodeURIComponent(superUrl.username),
            '-d', restoredName, '--exit-on-error', dump], { env: { ...process.env, PGPASSWORD: decodeURIComponent(superUrl.password) }, windowsHide: true });
        restored = pgp(appDbUrl(restoredName));
        assert.deepEqual(await tables(restored, pgp), before);
        // Stored image paths may be absolute or relative to the backend working
        // directory. Rebase both forms so this restore cannot read the source.
        const storedImages = await restored.any('SELECT id, storage_path FROM images');
        for (const image of storedImages) {
            const suffix = relative(binaryRoot, resolve(BACKEND_DIR, image.storage_path));
            assert.ok(!isAbsolute(suffix) && !suffix.startsWith('..'), 'imagem deve pertencer ao diretório de teste');
            await restored.none('UPDATE images SET storage_path=$2 WHERE id=$1', [image.id, join(restoredImages, suffix)]);
        }
        child = spawn(process.execPath, ['src/index.js'], { cwd: BACKEND_DIR, windowsHide: true, stdio: 'ignore',
            env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: appDbUrl(restoredName), PORT: '3913',
                JWT_SECRET: 'ui-e2e-secret-key-which-is-well-over-32-chars', IMAGES_DIR: restoredImages } });
        const base = 'http://127.0.0.1:3913/api/v1';
        let ready = false;
        for (let i = 0; i < 100; i++) {
            try { if ((await fetch(base + '/health')).ok) { ready = true; break; } } catch { /* starting */ }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        assert.ok(ready, 'backend restaurado precisa iniciar');
        const login = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: credentials.username, password: credentials.password }) });
        assert.equal(login.status, 200);
        const body = await login.json();
        const token = body.data.accessToken;
        assert.ok(token);
        const headers = { Authorization: `Bearer ${token}` };
        const pull = await fetch(base + `/atlas/${atlasId}/sync/0`, { headers });
        assert.equal(pull.status, 200);
        const after = (await pull.json()).data.snapshot;
        // Maps/briefings tied on created_at, groups, group-feature joins and features
        // (GET_ATLAS_FEATURES has no ORDER BY) have no transport order.
        // Compare those collections by identity. atlas.mapOrder, layer ordering,
        // geometry coordinates, every feature property and group membership remain exact.
        const byMapId = value => ({ ...value,
            briefings: [...value.briefings].sort((a, b) => a.id.localeCompare(b.id)),
            maps: Object.fromEntries(value.maps.map(map => [map.id,
            { ...map,
                features: Object.fromEntries(Object.entries(map.features).map(([type, features]) =>
                    [type, [...features].sort((a, b) => a.properties.id.localeCompare(b.properties.id))])),
                groups: [...map.groups].sort((a, b) => a.id.localeCompare(b.id)),
                groupFeatures: [...map.groupFeatures].sort((a, b) =>
                    a.group_id.localeCompare(b.group_id) || a.feature_id.localeCompare(b.feature_id)) }
        ])) });
        const actual = byMapId(after), expected = byMapId(snapshot);
        await writeFile(join(outputDir, 'source-snapshot.json'), JSON.stringify(snapshot));
        await writeFile(join(outputDir, 'restored-snapshot.json'), JSON.stringify(after));
        assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort());
        assert.equal(after.maps.length, snapshot.maps.length);
        for (const key of Object.keys(expected)) {
            if (key === 'maps') {
                assert.deepEqual(Object.keys(actual.maps).sort(), Object.keys(expected.maps).sort());
                for (const id of Object.keys(expected.maps)) {
                    assert.ok(isDeepStrictEqual(actual.maps[id], expected.maps[id]), `snapshot restaurado divergiu no mapa ${id}`);
                }
            } else {
                assert.deepEqual(actual[key], expected[key]);
            }
        }
        const imageRows = await restored.any('SELECT id, content_hash FROM images WHERE atlas_id=$1', [atlasId]);
        assert.ok(imageRows.length > 0, 'atlas restaurado deve referenciar imagens');
        for (const image of imageRows) {
            const response = await fetch(base + `/atlas/${atlasId}/images/${image.id}`, { headers });
            assert.equal(response.status, 200, `imagem ${image.id} do backup`);
            const bytes = Buffer.from(await response.arrayBuffer());
            assert.ok(bytes.byteLength > 0);
            assert.equal(createHash('sha256').update(bytes).digest('hex'), image.content_hash);
        }
        const report = { tablesCompared: Object.keys(before).length,
            rowsCompared: Object.values(before).reduce((n, table) => n + table.rows, 0),
            binaryFilesCompared: Object.keys(imageHashes).length, rebasedImagePaths: storedImages.length, restoredImagesServed: imageRows.length,
            snapshotIdenticalByIdentity: true, unorderedTransportCollections: ['maps', 'briefings', 'groups', 'groupFeatures', 'featuresByType'],
            postgresMajor: Math.floor(Number(version) / 10000), databaseDumpBytes: (await readFile(dump)).byteLength };
        await writeFile(join(outputDir, 'backup-report.json'), JSON.stringify(report, null, 2));
        return report;
    } finally {
        if (child) killPid(child.pid);
        await restored?.$pool.end();
        await source.$pool.end();
        await admin.$pool.end();
        await dropDatabase(restoredName);
        // This specific process was intentionally stopped above for a consistent backup.
        try {
            const exit = JSON.parse(await readFile(OBITO_FILE, 'utf8'));
            if (exit.pid === state.pid) await unlink(OBITO_FILE);
        } catch { /* no exit record */ }
    }
}
