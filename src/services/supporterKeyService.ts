/**
 * The supporter key service lives in the supporter package. This keeps the
 * app's import path and adds the dev-only Cypress seam: a fixture keypair
 * set on the window overrides the registry so the real verification path
 * runs end to end. Stripped from production builds with every other
 * import.meta.env.DEV block.
 */
import { verifySupporterKey as verify, type SupporterKeyVerification, type VerifySupporterKeyOptions } from '@pratherbytecraft/supporter';

export * from '@pratherbytecraft/supporter';
export { verify as verifySupporterKeyWithRegistry };

const devOverride = (): Record<string, string> | undefined =>
  import.meta.env.DEV && typeof window !== 'undefined'
    ? (window as { __supporterPublicKeysOverride__?: Record<string, string> }).__supporterPublicKeysOverride__
    : undefined;

export function verifySupporterKey(key: string, options: VerifySupporterKeyOptions = {}): Promise<SupporterKeyVerification> {
  return verify(key, { ...options, publicKeys: options.publicKeys ?? devOverride() });
}
