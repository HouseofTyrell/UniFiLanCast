import { z } from 'zod';
import { logger } from '../utils/logger.js';

/**
 * Runtime schemas for the *untrusted* UniFi controller payloads. They enforce
 * the identity/topology fields the adapter actually depends on and `catchall`
 * everything else (so unknown/extra fields degrade gracefully and stay
 * available to the field-by-field normalizers). Validation happens at the
 * boundary where TypeScript types offer no protection.
 */

export const RawSiteSchema = z
  .object({
    id: z.string().min(1),
    internalReference: z.string().optional(),
    name: z.string().optional(),
  })
  .catchall(z.unknown());
export type RawSite = z.infer<typeof RawSiteSchema>;

export const RawDeviceSchema = z
  .object({
    id: z.string().min(1),
  })
  .catchall(z.unknown());
export type RawDevice = z.infer<typeof RawDeviceSchema>;

// Clients may be identified by id and/or MAC; require at least one.
export const RawClientSchema = z
  .object({
    id: z.string().optional(),
    macAddress: z.string().optional(),
    mac: z.string().optional(),
  })
  .catchall(z.unknown())
  .refine(c => !!(c.id || c.macAddress || c.mac), {
    message: 'client has no id or MAC address',
  });
export type RawClient = z.infer<typeof RawClientSchema>;

/**
 * Validate a list of controller items, dropping any that don't match and
 * logging a single concise diagnostic (count + first error path) — never the
 * payload itself, so credentials/PII can't leak into logs.
 */
export function parseItems<T>(schema: z.ZodType<T>, items: unknown[], context: string): T[] {
  const out: T[] = [];
  let invalid = 0;
  let firstError = '';
  for (const item of items) {
    const r = schema.safeParse(item);
    if (r.success) {
      out.push(r.data);
    } else {
      invalid++;
      if (!firstError) {
        const issue = r.error.issues[0];
        firstError = `${issue?.message ?? 'invalid'} @ ${issue?.path.join('.') || '(root)'}`;
      }
    }
  }
  if (invalid > 0) {
    logger.warn(
      { context, invalid, total: items.length, firstError },
      'Dropped invalid items from controller response'
    );
  }
  return out;
}
