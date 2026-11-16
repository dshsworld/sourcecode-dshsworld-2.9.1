import { getRuntimeEnv } from './runtime';

// Install the owner's supplied photograph once, without replacing later uploads.
export async function installGardenPhoto() {
  const { DB } = getRuntimeEnv();
  const marker = 'garden_photo_20260914';
  if (await DB.prepare('SELECT 1 FROM settings WHERE key=?').bind(marker).first()) return;
  await DB.batch([
    DB.prepare("UPDATE scenes SET image_8k=?,image_4k=?,thumb=?,updated_at=CURRENT_TIMESTAMP WHERE id='M4-G' AND image_8k='' AND image_4k='' AND NOT EXISTS (SELECT 1 FROM settings WHERE key=?)")
      .bind('/assets/haneul-garden-20260914.jpg','/assets/haneul-garden-20260914.jpg','/assets/haneul-garden-20260914.jpg',marker),
    DB.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES (?,'done')").bind(marker),
  ]);
}
