import { writeFileSync } from 'node:fs';

const id = process.env.DSHS_D1_DATABASE_ID;
if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || id === '00000000-0000-4000-8000-000000000000') {
  throw new Error('Set DSHS_D1_DATABASE_ID to the Database ID of your new Cloudflare D1 database. Existing Sites data is NOT transferred automatically.');
}
const name = process.env.DSHS_WORKER_NAME || 'sourcecode-dshsworld-2-9-1';
const bucket = process.env.DSHS_R2_BUCKET || 'dshs-world-media';
for (const value of [name, bucket]) {
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(value)) throw new Error('Invalid Worker or R2 bucket name.');
}
const config = {
  name, main: './worker/index.ts', compatibility_date: '2026-10-01',
  compatibility_flags: ['nodejs_compat'],
  assets: { binding: 'ASSETS', directory: './public', run_worker_first: ['/', '/api/*'] },
  d1_databases: [{ binding: 'DB', database_name: 'dshs-world-db', database_id: id, migrations_dir: './drizzle' }],
  r2_buckets: [{ binding: 'BUCKET', bucket_name: bucket }],
  images: { binding: 'IMAGES' },
};
writeFileSync('.cloudflare-wrangler.json', JSON.stringify(config, null, 2) + '\n');
console.log('Cloudflare configuration generated. No credentials are written to this file.');
