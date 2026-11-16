import { fail } from './http';

export const MAX_UPLOAD = 48 * 1024 * 1024;
export const MAX_UPLOAD_BODY = 64 * 1024 * 1024;

// Enforce the cap even when Content-Length is absent or inaccurate.
export async function uploadForm(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('multipart/form-data;')) fail(415, '사진 업로드 형식이 올바르지 않습니다.');
  if (Number(request.headers.get('content-length')) > MAX_UPLOAD_BODY) fail(413, '업로드 전체 용량은 최대 64MB입니다.');
  if (!request.body) fail(400, '사진 파일이 없습니다.');
  let received = 0;
  const stream = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > MAX_UPLOAD_BODY) fail(413, '업로드 전체 용량은 최대 64MB입니다.');
      controller.enqueue(chunk);
    },
  }));
  try { return await new Response(stream, { headers: { 'content-type': request.headers.get('content-type')! } }).formData(); }
  catch (error) {
    if (received > MAX_UPLOAD_BODY) fail(413, '업로드 전체 용량은 최대 64MB입니다.');
    if (error instanceof Error && 'status' in error) throw error;
    fail(400, '사진 전송이 완료되지 않았습니다. 다시 업로드해 주세요.');
  }
}
