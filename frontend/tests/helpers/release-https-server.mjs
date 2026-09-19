// Local-only production-bundle rehearsal. No deploy directory or production services.
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, statSync, createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, extname, sep } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'ebgeo-release-tls-'));
const openssl = process.env.OPENSSL_BIN || 'C:/Program Files/Git/usr/bin/openssl.exe';
const key = join(temp, 'key.pem'), cert = join(temp, 'cert.pem');
execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key,
    '-out', cert, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'],
{ stdio: 'ignore', windowsHide: true });
const root = resolve('dist');
if (!existsSync(join(root, 'release.json'))) throw new Error('Build de produção obrigatório.');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
    '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.jpg': 'image/jpeg' };
const server = https.createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (req, res) => {
    // Seed legacy IndexedDB on a real, settled HTTPS document before loading the app.
    if (req.url === '/__seed__') {
        res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
        res.end('<!doctype html><html><body data-testid="legacy-seed"></body></html>');
        return;
    }
    if (req.url.startsWith('/api/')) {
        const upstream = http.request({ hostname: '127.0.0.1', port: 3912, path: req.url,
            method: req.method, headers: req.headers }, reply => {
            res.writeHead(reply.statusCode, reply.headers); reply.pipe(res);
        });
        upstream.on('error', () => { res.writeHead(502); res.end(); });
        req.pipe(upstream);
        return;
    }
    const pathname = decodeURIComponent(new URL(req.url, 'https://localhost').pathname);
    const file = resolve(root, '.' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname));
    if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) {
        res.writeHead(404); res.end(); return;
    }
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream',
        'Cache-Control': extname(file) === '.html' || pathname === '/release.json' ? 'no-cache' : 'public, max-age=31536000, immutable' });
    createReadStream(file).pipe(res);
});
server.on('upgrade', (req, socket, head) => {
    const target = net.connect(3912, '127.0.0.1', () => {
        target.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`);
        for (let i = 0; i < req.rawHeaders.length; i += 2) target.write(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`);
        target.write('\r\n');
        if (head.length) target.write(head);
        target.pipe(socket); socket.pipe(target);
    });
    target.on('error', () => socket.destroy());
    socket.on('error', () => target.destroy());
    socket.on('close', () => target.destroy());
});
server.listen(44431, '127.0.0.1');
