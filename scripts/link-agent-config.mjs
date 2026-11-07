#!/usr/bin/env node
// Enlaza la configuración agéntica compartida para que Claude Code y OpenCode
// lean los MISMOS archivos. La fuente canónica es `.claude/`; OpenCode recibe
// enlaces (junction en Windows, symlink en macOS/Linux) donde no lee `.claude/`
// de forma nativa.
//
//   .opencode/commands  →  .claude/commands
//
// Las skills NO necesitan enlace: OpenCode ya descubre `.claude/skills/` (y un
// enlace las registraría dos veces). Los enlaces están en .gitignore: git no
// versiona junctions, así que cada clon corre `npm run agents:link` una vez.
// Además activa el hook de git pre-push del repo (core.hooksPath=.githooks).
// Idempotente: re-ejecutarlo no cambia nada si los enlaces ya están bien.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const LINKS = [
  { link: '.opencode/commands', target: '.claude/commands' },
];

let failed = false;

for (const { link, target } of LINKS) {
  const linkPath = path.join(root, link);
  const targetPath = path.join(root, target);

  if (!fs.existsSync(targetPath)) {
    console.error(`✗ ${link}: falta el destino ${target}`);
    failed = true;
    continue;
  }

  const stat = fs.lstatSync(linkPath, { throwIfNoEntry: false });
  if (stat?.isSymbolicLink()) {
    if (path.resolve(fs.realpathSync(linkPath)) === fs.realpathSync(targetPath)) {
      console.log(`✓ ${link} → ${target} (ya existía)`);
      continue;
    }
    fs.unlinkSync(linkPath);
  } else if (stat?.isDirectory()) {
    if (fs.readdirSync(linkPath).length > 0) {
      console.error(`✗ ${link} es una carpeta real con archivos; muévelos a ${target} y re-ejecuta.`);
      failed = true;
      continue;
    }
    fs.rmdirSync(linkPath);
  } else if (stat) {
    console.error(`✗ ${link} existe y no es carpeta ni enlace.`);
    failed = true;
    continue;
  }

  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  // 'junction' no requiere privilegios de administrador en Windows; fuera de
  // Windows Node ignora el tipo y crea un symlink de directorio normal.
  fs.symlinkSync(targetPath, linkPath, 'junction');
  console.log(`✓ ${link} → ${target}`);
}

// Hook de git pre-push (.githooks/pre-push): lint → typecheck → test antes de
// empujar. Es la parte de la config dual que no depende de ninguna herramienta.
const HOOKS_PATH = '.githooks';
try {
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  let current = '';
  try {
    current = git('config', '--local', '--get', 'core.hooksPath');
  } catch {
    // Sin valor configurado: git sale con código 1.
  }
  if (current === HOOKS_PATH) {
    console.log(`✓ core.hooksPath = ${HOOKS_PATH} (ya existía)`);
  } else if (current) {
    console.error(`✗ core.hooksPath ya apunta a «${current}»; no lo piso. Para usar el pre-push del repo: git config core.hooksPath ${HOOKS_PATH}`);
    failed = true;
  } else {
    git('config', '--local', 'core.hooksPath', HOOKS_PATH);
    console.log(`✓ core.hooksPath = ${HOOKS_PATH}`);
  }
} catch (err) {
  console.error(`✗ no pude configurar el hook de git: ${err.message}`);
  failed = true;
}

process.exit(failed ? 1 : 0);
