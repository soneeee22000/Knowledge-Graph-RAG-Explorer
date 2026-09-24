import { z } from 'zod';

/** "1" or "true" (any case) switches a flag on; anything else, or unset, is off. */
const EnvFlag = z
  .string()
  .optional()
  .transform((value) => value !== undefined && ['1', 'true'].includes(value.toLowerCase()));

/**
 * Environment configuration, validated with zod at startup.
 *
 * Every value has a default so the service boots fully offline with no keys.
 * API keys are optional and only consulted by the `baml` provider.
 */
const ConfigSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8000),
  HOST: z.string().min(1).default('0.0.0.0'),
  LLM_PROVIDER: z.enum(['mock', 'baml']).default('mock'),
  DATA_DIR: z.string().min(1).default('./data'),
  CORS_ORIGIN: z.string().min(1).default('*'),
  /** Public read-only demo: seed the sample on boot, refuse ingest and delete, rate-limit. */
  DEMO_READONLY: EnvFlag,
  /** Requests per client IP per minute; unset means the demo default in read-only mode, off otherwise. */
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().optional(),
  /** Trust X-Forwarded-For for the client IP. Only set it behind a proxy that overwrites the header. */
  TRUST_PROXY: EnvFlag,
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

/** Parse + validate `process.env` into a typed config object. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return parsed.data;
}

/** Eagerly-loaded singleton config for convenience in app code. */
export const config: Config = loadConfig();
