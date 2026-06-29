import { join, dirname } from 'path';
import { existsSync } from 'fs';

/**
 * Walk up from the current directory looking for a file. Lets the server find
 * the repo-root `config.json` / `.env` whether it's launched from the repo root
 * (production) or from `server/` (the `npm run dev` workspace cwd).
 */
export function findUp(filename: string, maxDepth = 4): string | undefined {
  let dir = process.cwd();
  for (let i = 0; i <= maxDepth; i++) {
    const candidate = join(dir, filename);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/**
 * The single canonical config.json location, resolved identically by startup
 * and by the `/api/config` routes so a save is always read back by the loader.
 * Precedence: CONFIG_PATH env → nearest config.json up the tree → cwd/config.json.
 */
export function resolveConfigPath(): string {
  return process.env.CONFIG_PATH || findUp('config.json') || join(process.cwd(), 'config.json');
}
