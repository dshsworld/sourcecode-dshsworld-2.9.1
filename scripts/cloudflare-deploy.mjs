import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const config = JSON.parse(readFileSync('dist/server/wrangler.json', 'utf8'));
if (!process.env.DSHS_D1_DATABASE_ID || config.d1_databases?.[0]?.database_id !== process.env.DSHS_D1_DATABASE_ID) {
  throw new Error('Build again with the correct DSHS_D1_DATABASE_ID before deploying.');
}
const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'deploy', '--config', 'dist/server/wrangler.json'], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
