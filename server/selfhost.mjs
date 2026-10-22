import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readSelfHostedConfig, QIDIAN_PORT } from './config.mjs';
import { openSelfHostedDatabase } from './sqlite-migrations.mjs';
import { createSelfHostedServer } from './http-server.mjs';

export { QIDIAN_PORT };

async function main() {
  const config = readSelfHostedConfig();
  const DB = await openSelfHostedDatabase({
    databasePath: resolve(config.dataDir, 'qidian.sqlite'),
    migrationsDir: config.migrationsDir,
    backupsDir: config.backupsDir
  });
  const server = createSelfHostedServer({
    DB,
    root: config.staticDir,
    storagePath: config.dataDir,
    registrationEnabled: config.registrationEnabled,
    trustProxy: config.trustProxy,
    trustedProxies: config.trustedProxies,
    updateRequestDir: config.updateRequestDir,
    updateStatusDir: config.updateStatusDir,
    qidianVersion: config.qidianVersion
  });
  server.listen(config.port, config.host, () => console.log('Qidian self-hosted server listening on ' + config.host + ':' + config.port));
  const shutdown = signal => {
    console.log('Received ' + signal + '; closing the server');
    server.close(() => { DB.close(); process.exit(0); });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
