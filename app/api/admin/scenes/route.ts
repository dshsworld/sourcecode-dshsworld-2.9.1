import { requireAdmin } from "@/lib/admin-auth";
import { errorResponse, fail, finiteNumber, json, safeText, sceneId } from "@/lib/http";
import { imageDimensions, imageType } from "@/lib/image-metadata";
import { getRuntimeEnv } from "@/lib/runtime";
import { initializeMainPlan } from "@/lib/initialize-main-plan";

import { MAX_UPLOAD, uploadForm } from '@/lib/upload-body';
import { storeUploadObjects } from '@/lib/store-upload-objects';

export async function POST(request: Request) {
  const uploadedKeys: string[] = [];
  try {
    await requireAdmin(request);
    await initializeMainPlan();
    const form = await uploadForm(request);
    const file = form.get("panorama");
    if (!(file instanceof File) || !file.size) fail(400, "A panorama image is required.");
    if (file.size > MAX_UPLOAD) fail(413, "원본 파일은 최대 48MB까지 업로드할 수 있습니다.");
    const insp = /\.insp$/i.test(file.name);
    const originalHeader = await file.slice(0, 1024 * 1024).arrayBuffer();
    const detectedOriginalType = imageType(originalHeader);
    if (insp && detectedOriginalType !== 'image/jpeg') fail(415, 'INSP 사진 데이터를 읽을 수 없습니다. Insta360 X6 원본인지 확인해 주세요.');
    const originalType = insp ? 'application/octet-stream' : detectedOriginalType;
    if (form.get('sourceOnly') === 'true') fail(400, '이전 업로드 화면이 남아 있습니다. 페이지를 새로고침한 뒤 다시 업로드해 주세요.');
    if (!insp) {
      const size = imageDimensions(originalHeader, detectedOriginalType);
      if (size.width < 1024 || size.height < 512 || size.width / size.height < 1.92 || size.width / size.height > 2.08) fail(400, '원본은 1024×512 이상인 2:1 파노라마여야 합니다.');
    }
    const variants: { name: string; file: File; type: string; ext: string }[] = [];
    const sharedDisplay = form.get('image8kRef') === 'image4k';
    if (form.has('image8kRef') && !sharedDisplay) fail(400, '웹용 사진 참조가 올바르지 않습니다.');
    for (const [name, maxWidth] of [['image8k',8192],['image4k',4096],['thumb',640]] as const) {
      if (name === 'image8k' && sharedDisplay) continue;
      const variant = form.get(name);
      if (!(variant instanceof File) || !variant.size) fail(400, '웹용 사진이 준비되지 않았습니다. 페이지를 새로고침한 뒤 다시 업로드해 주세요.');
      if (variant.size > 16 * 1024 * 1024) fail(413, '웹용 사진의 용량이 너무 큽니다.');
      const header = await variant.slice(0, 1024 * 1024).arrayBuffer();
      const type = imageType(header);
      const size = imageDimensions(header, type);
      if (size.width > maxWidth || size.width < (name === 'thumb' ? 64 : 1024) || size.width / size.height < 1.92 || size.width / size.height > 2.08) fail(400, '웹용 파노라마의 크기나 비율이 올바르지 않습니다.');
      variants.push({ name, file: variant, type, ext: type === 'image/jpeg' ? 'jpg' : type === 'image/png' ? 'png' : 'webp' });
    }

    const id = sceneId(form.get("id"));
    const title = safeText(form.get("title"), "Title", 100);
    const floor = safeText(form.get("floor"), "Floor", 12);
    const building = safeText(form.get("building") || "본관", "Building", 40);
    const nodeType = safeText(form.get("nodeType") || "hall", "Node type", 40);
    const initialYaw = finiteNumber(form.get("initialYaw") ?? 90, "Initial yaw", -360, 360, 90);
    const initialPitch = finiteNumber(form.get("initialPitch") ?? 0, "Initial pitch", -85, 85, 0);
    const { DB, BUCKET } = getRuntimeEnv();
    const exists = await DB.prepare("SELECT 1 AS ok FROM scenes WHERE id = ?").bind(id).first();
    if (exists && form.get("replace") !== "true") fail(409, "That node ID already exists.");

    const base = `${id.toLowerCase()}-${crypto.randomUUID()}`;
    const ext = insp ? 'insp' : originalType === 'image/jpeg' ? 'jpg' : originalType === 'image/png' ? 'png' : 'webp';
    const originalKey = `originals/${base}.${ext}`;
    const pendingKey = `pending_insp_${id}`;
    const pending = await DB.prepare('SELECT value FROM settings WHERE key=?').bind(pendingKey).first<{value:string}>();
    const urls: Record<string, string> = {};
    const objects = [{ key: originalKey, file, type: originalType }];
    for (const variant of variants) {
      const key = `${variant.name === 'thumb' ? 'thumbs' : 'panos'}/${base}-${variant.name}.${variant.ext}`;
      objects.push({ key, file: variant.file, type: variant.type });
      urls[variant.name] = `/api/media/${key}`;
    }
    uploadedKeys.push(...objects.map(object => object.key));
    await storeUploadObjects(BUCKET, objects);
    if (sharedDisplay) urls.image8k = urls.image4k;
    const { image8k, image4k, thumb } = urls;
    const saveScene = exists
      ? DB.prepare("UPDATE scenes SET image_8k=?,image_4k=?,thumb=?,original_key=?,initial_yaw=?,initial_pitch=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(image8k,image4k,thumb,originalKey,initialYaw,initialPitch,id)
      : DB.prepare(`INSERT INTO scenes (id, title, floor, building, node_type, image_8k, image_4k, thumb, original_key, initial_yaw, initial_pitch) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id,title,floor,building,nodeType,image8k,image4k,thumb,originalKey,initialYaw,initialPitch);
    await DB.batch([saveScene, DB.prepare('DELETE FROM settings WHERE key=?').bind(pendingKey)]);
    uploadedKeys.length = 0;
    if (pending) {
      try {
        const pendingOriginalKey = JSON.parse(pending.value).key;
        if (typeof pendingOriginalKey === 'string' && pendingOriginalKey.startsWith('originals/') && pendingOriginalKey !== originalKey) await BUCKET.delete(pendingOriginalKey);
      } catch { /* The new panorama is already safely committed. */ }
    }
    return json({ ok: true, scene: { id, title, floor, nodeType, image8k, image4k, thumb, initialYaw, initialPitch, isStart: 0 } }, 201);
  } catch (error) {
    console.error('Panorama upload failed', error instanceof Error ? error.message : 'unknown error');
    if (uploadedKeys.length) await getRuntimeEnv().BUCKET.delete(uploadedKeys).catch(() => undefined);
    if (!(error && typeof error === 'object' && 'status' in error)) return json({ error: '사진 저장에 실패했습니다. 기존 사진은 유지됩니다. 잠시 후 다시 시도해 주세요.' }, 503);
    return errorResponse(error);
  }
}
