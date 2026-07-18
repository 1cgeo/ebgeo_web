#!/usr/bin/env node
// Path: .claude/hooks/lint-on-write.js
//
// PostToolUse (Edit|Write): lints the file that was just written and feeds the
// result back into the conversation.
//
// Same dead-hook story as block-protected.js: the old inline version read
// `$TOOL_INPUT_FILE_PATH` (never set), so it never matched `.js$` and never
// linted anything. CLAUDE.md meanwhile promised "a saída aparece depois de
// cada escrita". It did not.
//
// PostToolUse cannot block (the write already happened); it reports. Output
// goes back as additionalContext so the result is actually read.
//
// Two traps this file already fell into, both caught by probing it:
//   - `require` throws here: the root package.json is `"type": "module"`.
//     That is exactly how prepare-deploy.js became dead code.
//   - A failed spawn used to be swallowed by the catch, making a broken hook
//     look identical to a clean file. Silence now means clean, and ONLY clean;
//     anything else reports itself.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const FERRAMENTAS = {
    js: { bin: 'node_modules/eslint/bin/eslint.js', args: ['--no-warn-ignored', '--max-warnings', '0'] },
    css: { bin: 'node_modules/stylelint/bin/stylelint.mjs', args: [] },
};

function reportar(texto) {
    process.stdout.write(
        JSON.stringify({
            hookSpecificOutput: {
                hookEventName: 'PostToolUse',
                additionalContext: texto.slice(0, 3000),
            },
        })
    );
    process.exit(0);
}

let bruto = '';
process.stdin.on('data', (c) => (bruto += c));
process.stdin.on('end', () => {
    let caminho = '';
    let raiz = process.cwd();
    try {
        const payload = JSON.parse(bruto);
        caminho = (payload.tool_input || {}).file_path || '';
        raiz = payload.cwd || raiz;
    } catch {
        process.exit(0);
    }

    const ext = /\.(js|css)$/.exec(caminho);
    if (!ext) process.exit(0);

    // Only lint inside the project: scratchpad probes and files outside the
    // repo have no applicable config and would only emit noise.
    if (!path.resolve(caminho).startsWith(path.resolve(raiz))) process.exit(0);

    const { bin, args } = FERRAMENTAS[ext[1]];
    const binAbs = path.join(raiz, bin);
    // Invoke the tool's JS entry with this same Node binary: no `npx`, no
    // shell, no .cmd shim. One less thing that can fail differently on Windows.
    if (!existsSync(binAbs)) reportar(`Lint NAO rodou: ${bin} nao existe (npm install?).`);

    let saida = '';
    try {
        saida = execFileSync(process.execPath, [binAbs, ...args, caminho], {
            cwd: raiz,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
    } catch (e) {
        const achados = `${e.stdout || ''}${e.stderr || ''}`.trim();
        // Non-zero exit WITH output is the normal "lint found problems" path.
        // Non-zero exit WITHOUT output means the tool never ran. Do not
        // conflate the two: that is how a dead check passes for a clean file.
        if (!achados) reportar(`Lint NAO rodou em ${caminho}: ${e.message}`);
        saida = achados;
    }

    const limpo = saida.trim();
    if (limpo) reportar(`Lint de ${path.relative(raiz, caminho).replace(/\\/g, '/')}:\n${limpo}`);
    process.exit(0);
});
