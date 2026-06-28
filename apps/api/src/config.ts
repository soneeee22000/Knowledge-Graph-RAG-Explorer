import { z } from 'zod';

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
