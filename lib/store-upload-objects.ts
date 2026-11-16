type UploadObject = { key: string; file: File; type: string };

// Bound storage concurrency and settle every in-flight write before the caller
// cleans up a failed upload. Never let a late successful write become orphaned.
export async function storeUploadObjects(bucket: Pick<R2Bucket, 'put'>, objects: UploadObject[]) {
  let next = 0;
  let failed = false;
  let failure: unknown;
  await Promise.all(Array.from({ length: Math.min(2, objects.length) }, async () => {
    while (!failed && next < objects.length) {
      const object = objects[next++];
      try { await bucket.put(object.key, object.file.stream(), { httpMetadata: { contentType: object.type } }); }
      catch (error) { failed = true; failure = error; }
    }
  }));
  if (failed) throw failure;
}
