import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve, basename } from 'node:path';
import { adaptDatabaseSync } from './adapters/sqlite-adapter.mjs';

const sqlLiteral = value => `'${String(value).replaceAll("'", "''")}'`;

async function exists(path) {
  try { await stat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

function backupPathFor(backupsDir, migration) {
  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  return join(backupsDir, `${basename(migration, '.sql')}-before-${stamp}.sqlite`);
}

/** Open SQLite and apply ordered SQL migrations, preserving a pre-migration copy. */
export async function openSelfHostedDatabase({ databasePath, migrationsDir = resolve('migrations'), backupsDir } = {}) {
  if (!databasePath) throw new Error('DATABASE_PATH is required');
  const file = resolve(databasePath), migrationRoot = resolve(migrationsDir);
  const backupRoot = resolve(backupsDir || join(dirname(file), 'migration-backups'));
  await mkdir(dirname(file), { recursive: true });
  await mkdir(backupRoot, { recursive: true });

  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
  raw.exec(`CREATE TABLE IF NOT EXISTS qidian_schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);

  try {
    const applied = new Set(raw.prepare('SELECT name FROM qidian_schema_migrations').all().map(row => row.name));
    const files = (await readdir(migrationRoot)).filter(name => /^\d+_[a-z0-9_-]+\.sql$/i.test(name)).sort();
    for (const name of files) {
      if (applied.has(name)) continue;

      // VACUUM INTO creates a consistent copy that includes committed WAL data.
      // Keep it outside the app repository/data path so it cannot be served publicly.
      const hasPriorSchema = applied.size > 0;
      if (hasPriorSchema && await exists(file)) {
        raw.exec('PRAGMA wal_checkpoint(FULL)');
        raw.exec(`VACUUM INTO ${sqlLiteral(backupPathFor(backupRoot, name))}`);
      }

      // Rebuilding the account table removes its unique legacy contact column.
      // Disable FK enforcement only for this schema transaction, then validate
      // every relationship before committing it.
      const requiresForeignKeyRebuild = new Set(['0006_username_only_login.sql', '0008_streamed_unbounded_assets.sql']).has(name);
      if (requiresForeignKeyRebuild) raw.exec('PRAGMA foreign_keys=OFF');
      raw.exec('BEGIN IMMEDIATE');
      try {
        raw.exec(await readFile(join(migrationRoot, name), 'utf8'));
        if (requiresForeignKeyRebuild) {
          const violations = raw.prepare('PRAGMA foreign_key_check').all();
          if (violations.length) throw new Error(`foreign key check failed: ${JSON.stringify(violations)}`);
        }
        raw.prepare('INSERT INTO qidian_schema_migrations(name, applied_at) VALUES (?, ?)').run(name, Date.now());
        raw.exec('COMMIT');
        if (requiresForeignKeyRebuild) raw.exec('PRAGMA foreign_keys=ON');
        applied.add(name);
      } catch (error) {
        raw.exec('ROLLBACK');
        if (requiresForeignKeyRebuild) raw.exec('PRAGMA foreign_keys=ON');
        throw new Error(`SQLite migration ${name} failed; prior data was preserved: ${error.message}`, { cause: error });
      }
    }
    return adaptDatabaseSync(raw);
  } catch (error) {
    raw.close();
    throw error;
  }
}
