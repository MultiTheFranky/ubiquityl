import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const targetIpMapParser = z
  .string()
  .optional()
  .transform((value, ctx) => {
    if (!value || value.trim().length === 0) {
      return {};
    }
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'TARGET_IP_MAP must be a JSON object of { externalIp: internalIp }.',
        });
        return z.NEVER;
      }
      for (const [key, val] of Object.entries(parsed)) {
        if (typeof val !== 'string' || val.trim().length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `TARGET_IP_MAP entry for '${key}' must be a non-empty string.`,
          });
          return z.NEVER;
        }
      }
      return parsed as Record<string, string>;
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Failed to parse TARGET_IP_MAP JSON: ${(error as Error).message}`,
      });
      return z.NEVER;
    }
  });

const envSchema = z
  .object({
    PTERODACTYL_URL: z.string().url('PTERODACTYL_URL must be a valid URL'),
    PTERODACTYL_API_KEY: z.string().min(1, 'PTERODACTYL_API_KEY is required'),
    PTERODACTYL_NODE_ID: z.coerce
      .number({ invalid_type_error: 'PTERODACTYL_NODE_ID must be a number' })
      .int('PTERODACTYL_NODE_ID must be an integer')
      .nonnegative('PTERODACTYL_NODE_ID must be >= 0'),
    SYNC_INTERVAL_SECONDS: z.coerce
      .number({ invalid_type_error: 'SYNC_INTERVAL_SECONDS must be a number' })
      .int('SYNC_INTERVAL_SECONDS must be an integer')
      .positive('SYNC_INTERVAL_SECONDS must be greater than zero')
      .default(30),
    UDM_URL: z.string().url('UDM_URL must be a valid URL'),
    UDM_USERNAME: z.string().min(1, 'UDM_USERNAME is required'),
    UDM_PASSWORD: z.string().min(1, 'UDM_PASSWORD is required'),
    UDM_SITE: z.string().min(1).default('default'),
    UDM_ALLOW_SELF_SIGNED: z.coerce.boolean().default(false),
    PORT_FORWARD_NAME_PREFIX: z.string().min(1).default('ptero-alloc-'),
    PORT_FORWARD_PROTOCOL: z.enum(['tcp', 'udp', 'tcp_udp']).default('tcp_udp'),
    TARGET_IP_DEFAULT: z.string().optional(),
    TARGET_IP_MAP: targetIpMapParser,
    UDM_WAN_IP: z.string().min(1).default('any'),
    PORT_FORWARD_SOURCE: z.string().min(1).default('any'),
    PORT_FORWARD_DESTINATION: z.string().min(1).default('any'),
  })
  .passthrough();

const env = envSchema.parse(process.env);

const normalizeUrl = (value: string): string => {
  const url = new URL(value);
  return url.toString().replace(/\/+$/, '');
};

const targetIpMap = env.TARGET_IP_MAP ?? {};

if (!env.TARGET_IP_DEFAULT && Object.keys(targetIpMap).length === 0) {
  throw new Error(
    'You must define either TARGET_IP_DEFAULT or TARGET_IP_MAP with at least one mapping.',
  );
}

export const appConfig = {
  pterodactyl: {
    url: normalizeUrl(env.PTERODACTYL_URL),
    apiKey: env.PTERODACTYL_API_KEY,
    nodeId: env.PTERODACTYL_NODE_ID,
    pollIntervalMs: env.SYNC_INTERVAL_SECONDS * 1000,
  },
  udm: {
    url: normalizeUrl(env.UDM_URL),
    username: env.UDM_USERNAME.trim(),
    password: env.UDM_PASSWORD,
    site: env.UDM_SITE.trim(),
    allowSelfSigned: env.UDM_ALLOW_SELF_SIGNED,
    namePrefix: env.PORT_FORWARD_NAME_PREFIX.trim(),
    protocol: env.PORT_FORWARD_PROTOCOL,
    defaultTargetIp: env.TARGET_IP_DEFAULT?.trim(),
    targetIpMap,
    wanIp: env.UDM_WAN_IP.trim(),
    source: env.PORT_FORWARD_SOURCE.trim(),
    destination: env.PORT_FORWARD_DESTINATION.trim(),
  },
} as const;

export type AppConfig = typeof appConfig;
