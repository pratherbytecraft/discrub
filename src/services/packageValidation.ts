import { t as translate } from '@/i18n';
import type { ParsedPackage, PackageValidationResult } from '@/features/package/packageTypes';

/** Thrown when a package cannot be read or is missing what Discrub needs. */
export class PackageParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PackageParseError';
  }
}

/**
 * Validates a parsed package against the authenticated user (if any).
 *
 * - No authenticated user → soft-ok, read-only (analytics + browse only).
 * - User ID matches → full capabilities (delete/edit/export rehydration).
 * - User ID mismatch → soft-warn, read-only.
 */
export function validatePackage(
  parsed: ParsedPackage,
  authenticatedUserId: string | null,
): PackageValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!parsed.user?.id) {
    errors.push('Package is missing user identity (account/user.json).');
    return { ok: false, readOnly: true, warnings, errors };
  }

  if (!authenticatedUserId) {
    warnings.push(translate('package.notSignedInWarning'));
    return { ok: true, readOnly: true, warnings, errors };
  }

  if (parsed.user.id !== authenticatedUserId) {
    warnings.push(
      `This package belongs to a different user (${parsed.user.username}). Read-only mode: deletion and editing are disabled.`,
    );
    return { ok: true, readOnly: true, warnings, errors };
  }

  return { ok: true, readOnly: false, warnings, errors };
}
