import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * GEN-08 suites write real files. Import this module BEFORE anything that loads AppModule: the config
 * module reads UPLOAD_DIR when AppModule is first imported, so the override has to come first.
 * Each suite gets its own empty directory under the OS temp folder; call removeTempUploadDir() in afterAll.
 */
export const TEMP_UPLOAD_DIR = mkdtempSync(join(tmpdir(), 'gen08-e2e-'));
process.env.UPLOAD_DIR = TEMP_UPLOAD_DIR;

export function removeTempUploadDir(): void {
  rmSync(TEMP_UPLOAD_DIR, { recursive: true, force: true });
}
