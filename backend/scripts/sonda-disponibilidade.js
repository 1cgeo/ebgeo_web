// Path: scripts/sonda-disponibilidade.js
// Run on a separate host inside the network; it does not need account credentials.
import { appendFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { resolve, dirname, basename, join } from 'node:path';

const args = process.argv.slice(2);
const valor = flag => args[args.indexOf(flag) + 1];
const base = args.includes('--url') ? valor('--url') : null;
if (!base || !/^https?:\/\//.test(base)) {
  console.error('Uso: node scripts/sonda-disponibilidade.js --url http://servidor --arquivo ./sonda.jsonl [--once]');
  process.exitCode = 1;
} else {
  const destino = resolve(args.includes('--arquivo') ? valor('--arquivo') : './sonda.jsonl');
  await mkdir(dirname(destino), { recursive: true });
  const prefixo = `${basename(destino, '.jsonl')}-`;
  let diaAnterior = null;
  const medir = async () => {
    const inicio = Date.now();
    let status = null;
    let disponivel = false;
    try {
      const r = await fetch(new URL('/api/v1/health', base), { signal: AbortSignal.timeout(5000) });
      status = r.status;
      disponivel = r.ok && (await r.json()).status === 'ok';
    } catch { /* The absence of a response is itself the observation. */ }
    const linha = { time: inicio, disponivel, status, duracaoMs: Date.now() - inicio };
    const dia = new Date(inicio).toISOString().slice(0, 10);
    await appendFile(join(dirname(destino), `${prefixo}${dia}.jsonl`), JSON.stringify(linha) + '\n', 'utf8');
    if (dia !== diaAnterior) {
      diaAnterior = dia;
      for (const nome of await readdir(dirname(destino))) {
        if (!nome.startsWith(prefixo) || !nome.endsWith('.jsonl')) continue;
        const data = nome.slice(prefixo.length, -6);
        if (/^\d{4}-\d{2}-\d{2}$/.test(data) && Date.parse(data) < inicio - 30 * 86400000) {
          await unlink(join(dirname(destino), nome));
        }
      }
    }
    if (args.includes('--once')) process.exitCode = disponivel ? 0 : 2;
  };
  await medir();
  if (!args.includes('--once')) {
    let ocupado = false;
    const timer = setInterval(async () => {
      if (ocupado) return;
      ocupado = true;
      try { await medir(); } catch (err) { console.error('Falha ao gravar a sonda:', err.code); }
      finally { ocupado = false; }
    }, 30000);
    process.once('SIGINT', () => clearInterval(timer));
    process.once('SIGTERM', () => clearInterval(timer));
  }
}
