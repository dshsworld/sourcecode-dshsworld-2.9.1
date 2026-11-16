import { env } from "cloudflare:workers";

type ImageOutput = {
  response(): Promise<Response>;
};

type ImageTransformer = {
  transform(options: Record<string, unknown>): ImageTransformer;
  output(options: { format: string; quality: number }): Promise<ImageOutput>;
};

export type RuntimeEnv = {
  DB: D1Database;
  BUCKET: R2Bucket;
  ADMIN_PASSWORD_HASH?: string;
  SESSION_SECRET?: string;
  IMAGES: {
    input(stream: ReadableStream): ImageTransformer;
  };
};

export function getRuntimeEnv(): RuntimeEnv {
  return env as unknown as RuntimeEnv;
}
