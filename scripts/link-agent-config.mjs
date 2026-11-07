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
// Idempotente: re-ejecutarlo no cambia nada si los enlaces ya están bien.

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

process.exit(failed ? 1 : 0);
