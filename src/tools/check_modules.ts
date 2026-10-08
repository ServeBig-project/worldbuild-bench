import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { z } from "zod";
import { Tool, ToolContext } from "./index.js";

/** Bundled libraries and tooling are not the game's own modules. */
const SKIP_DIRS = new Set(["lib", "node_modules", "skills", ".git"]);
const IDENT = /^[A-Za-z_$][\w$]*$/;

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:\\])\/\/[^\n]*/g, "$1");
}

/** Split `a = 1, b = f(x, y)` at top-level commas (ignores commas inside brackets and strings). */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"' || ch === "`") quote = ch;
    else if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth--;
    else if (ch === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    } else if ((ch === ";" || ch === "\n") && depth === 0) {
      return [...parts, text.slice(start, i)];
    }
  }
  return [...parts, text.slice(start)];
}

/** Names a module exports ("default" for a default export, "*" for `export * from`). */
export function parseExports(source: string): Set<string> {
  const src = stripComments(source);
  const names = new Set<string>();
  for (const m of src.matchAll(/export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s+class\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s+(?:const|let|var)\s+/g)) {
    for (const decl of splitTopLevel(src.slice(m.index! + m[0].length))) {
      const name = decl.trim().match(/^([A-Za-z_$][\w$]*)/)?.[1];
      if (name) names.add(name);
    }
  }
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const spec of m[1].split(",")) {
      const parts = spec.trim().split(/\s+as\s+/);
      const name = (parts[1] ?? parts[0]).trim();
      if (IDENT.test(name)) names.add(name);
    }
  }
  if (/export\s+default\b/.test(src)) names.add("default");
  if (/export\s*\*\s*from/.test(src)) names.add("*");
  return names;
}

export interface ModuleImport {
  /** The specifier as written, relative modules only. */
  from: string;
  /** Exported names it needs ("default" for a default import). */
  names: string[];
}

/** Static imports of relative modules; namespace and side-effect imports need no names. */
export function parseImports(source: string): ModuleImport[] {
  const src = stripComments(source);
  const out: ModuleImport[] = [];
  for (const m of src.matchAll(/\bimport\s+([^'";]+?)\s+from\s*['"]([^'"]+)['"]/g)) {
    const [clause, from] = [m[1].trim(), m[2]];
    if (!from.startsWith(".") && !from.startsWith("/")) continue;
    const names: string[] = [];
    const head = clause.split("{")[0].replace(/,\s*$/, "").trim();
    if (head && !head.startsWith("*")) names.push("default");
    const braces = clause.match(/\{([^}]*)\}/);
    for (const spec of braces ? braces[1].split(",") : []) {
      const name = spec.trim().split(/\s+as\s+/)[0].trim();
      if (IDENT.test(name)) names.push(name);
    }
    if (names.length > 0) out.push({ from, names });
  }
  return out;
}

function listModules(workspace: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.m?js$/.test(e.name)) out.push(p);
    }
  };
  walk(workspace);
  return out.sort();
}

/**
 * `node --check file.js` passes ES-module syntax errors on Node 22 (module-syntax
 * detection gives up silently), so check a .mjs copy: always parsed as a module.
 */
function syntaxError(file: string): string | null {
  const copy = path.join(os.tmpdir(), `wb-check-${process.pid}-${Date.now()}-${path.basename(file)}.mjs`);
  fs.copyFileSync(file, copy);
  const r = spawnSync(process.execPath, ["--check", copy], { encoding: "utf8", timeout: 20_000 });
  fs.rmSync(copy, { force: true });
  if (r.status === 0) return null;
  const lines = `${r.stderr ?? ""}`.split("\n").map((l) => l.trim()).filter(Boolean);
  const where = lines.find((l) => l.startsWith(copy))?.slice(copy.length) ?? "";
  return `${lines.find((l) => /Error/.test(l)) ?? lines[0] ?? "node --check failed"}${where ? ` (line ${where.replace(/^:/, "")})` : ""}`;
}

/** Syntax of every game module, and every named import from a relative module resolved to an export. */
export function checkModules(workspace: string): { files: number; problems: string[] } {
  const files = listModules(workspace);
  const rel = (p: string) => path.relative(workspace, p).split(path.sep).join("/");
  const problems: string[] = [];
  const exportsOf = new Map<string, Set<string>>();
  for (const f of files) {
    const err = syntaxError(f);
    if (err) problems.push(`${rel(f)}: syntax error — ${err}`);
  }
  for (const f of files) {
    for (const imp of parseImports(fs.readFileSync(f, "utf8"))) {
      const target = imp.from.startsWith("/")
        ? path.join(workspace, imp.from)
        : path.resolve(path.dirname(f), imp.from);
      if (!fs.existsSync(target)) {
        problems.push(`${rel(f)} imports ${imp.from} but ${rel(target)} was not found`);
        continue;
      }
      if (!exportsOf.has(target)) exportsOf.set(target, parseExports(fs.readFileSync(target, "utf8")));
      const exported = exportsOf.get(target)!;
      if (exported.has("*")) continue;
      const missing = imp.names.filter((n) => !exported.has(n));
      if (missing.length > 0) {
        const list = [...exported].sort().join(", ") || "(nothing)";
        problems.push(`${rel(f)} imports ${missing.join(", ")} from ${imp.from}, but ${rel(target)} exports: ${list}`);
      }
    }
  }
  return { files: files.length, problems };
}

export const checkModulesTool: Tool = {
  def: {
    name: "check_modules",
    description:
      "Check the game's own JS modules (everything outside lib/): syntax via node --check, and that every named import from a relative module matches an export of that file. Fast and side-effect free, so it is safe while others are editing; run it after you write or edit a module.",
    inputSchema: { type: "object", properties: {} },
  },
  schema: z.object({}),
  async execute(_input, ctx: ToolContext): Promise<string> {
    const { files, problems } = checkModules(ctx.workspace);
    if (problems.length === 0) {
      return `OK: ${files} modules — syntax valid and every relative named import resolves.`;
    }
    const n = problems.length;
    return `${n} problem${n > 1 ? "s" : ""} in ${files} modules:\n${problems.map((p) => `- ${p}`).join("\n")}`;
  },
};
