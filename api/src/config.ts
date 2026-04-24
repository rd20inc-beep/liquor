import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: resolve(import.meta.dirname, '../../.env') });

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  API_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string(),
  S3_SECRET_KEY: z.string(),
  S3_BUCKET: z.string(),

  JWT_SECRET: z.string().min(16),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL: z.string().default('30d'),

  DEV_OTP: z.string().default('123456'),
});

export type Config = z.infer<typeof EnvSchema>;

export const config: Config = (() => {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error('Invalid environment configuration:');
    for (const issue of parsed.error.issues) {
      // eslint-disable-next-line no-console
      console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  return parsed.data;
})();

export const isDev = () => config.NODE_ENV === 'development';
export const isProd = () => config.NODE_ENV === 'production';
