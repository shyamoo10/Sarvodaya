export const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;

/**
 * Accepts "+91 98765 43210", "09876543210", "9876543210" and returns "9876543210".
 * Throws when the number cannot be a valid 10 digit Indian mobile number.
 */
export function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, '');
  const withoutPrefix =
    digits.length === 12 && digits.startsWith('91')
      ? digits.slice(2)
      : digits.length === 11 && digits.startsWith('0')
        ? digits.slice(1)
        : digits;

  if (!INDIAN_MOBILE_REGEX.test(withoutPrefix)) {
    throw new Error('Phone must be a valid 10 digit Indian mobile number');
  }
  return withoutPrefix;
}

export function isValidPhone(input: string): boolean {
  try {
    normalizePhone(input);
    return true;
  } catch {
    return false;
  }
}
