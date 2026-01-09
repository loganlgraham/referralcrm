/**
 * Normalizes a phone number by extracting only digits.
 * Handles various formats like "123-456-7890", "(123) 456-7890", "1234567890", etc.
 * 
 * @param phone - The phone number string to normalize
 * @returns Normalized phone number (digits only) or null if phone is empty/null/undefined
 */
export function normalizePhoneNumber(phone: string | null | undefined): string | null {
  if (!phone) {
    return null;
  }
  
  // Extract only digits
  const digits = phone.replace(/\D+/g, '');
  
  // Return null if no digits found
  if (digits.length === 0) {
    return null;
  }
  
  // Handle 11-digit numbers starting with 1 (US country code)
  // Normalize to 10 digits by removing leading 1
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits.slice(1);
  }
  
  // Return 10-digit number or whatever we have (for validation purposes)
  return digits;
}
