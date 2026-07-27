---
description: Strict lint + spatial sanity checks on src/lib/. Diagnostics only — no auto-fix. Use before any PR that touches map export, KML parsing, or layer toggles.
agent: build
---

Run the GIS pre-flight checks against the map core (`src/lib/`) and surface failures. Do NOT auto-fix anything; the human reviews the diagnostics and decides.

After each step, capture the output verbatim. At the end, emit ONE Markdown summary with these sections:

- **Lint** — `pass` | `fail` (N errors)
- **Typecheck** — `pass` | `fail` (N errors)
- **Floating Promises in src/lib/** — `pass` | N floating references, each listed as `file_path:line_number: <code>`
- **Forbidden imports in src/** — `pass` | N occurrences, each listed as `file_path: <module>`

If anything fails, list the failing artifacts but do NOT propose fixes. The next turn in the conversation proposes fixes.

---

### Step 1 — Strict ESLint on src/lib/ (no warnings tolerated)

!`npx eslint src/lib --max-warnings=0`

### Step 2 — Full TypeScript typecheck

Catches spatial typing issues (e.g., bad `L.Point` math, missing `L.Coords` cast, return types of `L.MarkerClusterGroup.getVisibleParent`).

!`npx tsc --noEmit`

### Step 3 — Floating-Promise audit in src/lib/

A "floating Promise" is a `Promise.something` reference that is NOT consumed by `await`, `.then`, `.catch`, or as the operand of `new Promise(...)`. They cause unhandled rejections and silently broken async flows. This audit walks every `.ts`/`.tsx` in src/lib/ and surfaces anything that looks fishy — the human reviews false positives (typed event-handler returns, etc.).

!`node -e "const f=require('fs'),p=require('path');const re=/\\bPromise\\b\\s*\\./g;let hits=0;let flag=false;function w(d){for(const e of f.readdirSync(d,{withFileTypes:true})){const x=p.join(d,e.name);if(e.isDirectory()){if(!x.includes('node_modules'))w(x);}else if(/\\.(ts|tsx)$/.test(e.name)){const lines=f.readFileSync(x,'utf8').split('\\n');lines.forEach((line,i)=>{const r=new RegExp(re);let m;while((m=r.exec(line))){const tail=lines.slice(i,i+3).join(' ');if(!/await|\\.then|\\.catch|\\bnew Promise/.test(tail)){console.log(x+':'+(i+1)+' '+line.trim());hits++;flag=true;}});}}};w('src/lib');if(flag){console.error('FAIL: '+hits+' floating Promise references in src/lib/');process.exit(1);}else{console.log('OK: no floating Promises in src/lib/');}"`

Exit code 1 = fail (any hits printed). Exit code 0 = pass.

### Step 4 — Forbidden imports in src/ (client-side code)

The SIG must never import server-only modules in client code. This audit greps for known forbidden patterns:

!`node -e "const f=require('fs'),p=require('path');const forbidden=['@neondatabase/serverless','neondatabase/serverless','node:fs','node:fs/promises','child_process','pg','better-sqlite3'];let hits=0;let flag=false;function w(d){for(const e of f.readdirSync(d,{withFileTypes:true})){const x=p.join(d,e.name);if(x.includes('node_modules')||x.includes('.next'))continue;if(e.isDirectory())w(x);else if(/\\.(ts|tsx|js|jsx|mjs)$/.test(e.name)){const t=f.readFileSync(x,'utf8');for(const k of forbidden){if(t.includes(k)){console.log(x+': contains '+k);hits++;flag=true;}}}}};w('src');if(flag){console.error('FAIL: '+hits+' forbidden imports in src/');process.exit(1);}else{console.log('OK: no forbidden imports in src/');}"`

Specifically catches:

- `@neondatabase/serverless` — DB client; only route handlers in `src/app/api/*` may import it.
- `node:fs`, `node:fs/promises`, `child_process` — server-only Node APIs.
- `pg`, `better-sqlite3` — alternative DB drivers; must not appear in client code.

False positives exist if a custom types file in `src/types/` happens to include `fs` in its name. If so, exclude with a path-prefix escape in the audit.

### Step 5 — Summarize

Output exactly this Markdown structure:

```
## verify-gis report

### Lint (eslint src/lib --max-warnings=0)
- **Status**: pass | fail
- **Errors**: <number>

### Typecheck (tsc --noEmit)
- **Status**: pass | fail
- **Errors**: <number>

### Floating Promises in src/lib/
- **Status**: pass | fail (<number> hits)
- **Hits** (if any):
  - `path/to/file.ts:42: const p = Promise.resolve(...)`

### Forbidden Imports in src/
- **Status**: pass | fail (<number> hits)
- **Hits** (if any):
  - `path/to/file.ts: imports @neondatabase/serverless in client code`

### Next steps
The primary agent will read this report and propose a fix for each failure. Do NOT propose fixes here.
```

STOP after the summary. Hand back to the human / primary agent.
