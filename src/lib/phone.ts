// Shared phone formatting utility. Display-only; storage stays raw.
// - 10 digits          → (XXX) XXX-XXXX
// - 11 digits, leads 1 → +1 (XXX) XXX-XXXX
// - anything else      → return input unchanged (never mangle)

export function formatPhone(input: string | null | undefined): string {
  if (input == null) return '';
  const raw = String(input);
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return raw;
}

// Progressive formatter for input fields. Formats as the user types when the
// digits look like a US number; otherwise returns the raw input untouched so
// international numbers aren't mangled.
export function formatPhoneInput(input: string): string {
  const raw = input ?? '';
  const hasPlus = raw.trim().startsWith('+');
  const digits = raw.replace(/\D/g, '');

  // International (starts with +) — leave alone beyond stripping nothing.
  if (hasPlus && !(digits.length === 11 && digits.startsWith('1'))) {
    return raw;
  }

  if (digits.length === 0) return '';

  // 11-digit US (leading 1)
  if (digits.length > 10) {
    const d = digits.slice(0, 11);
    if (d.startsWith('1')) {
      const a = d.slice(1, 4);
      const b = d.slice(4, 7);
      const c = d.slice(7, 11);
      if (d.length <= 4) return `+1 (${a}`;
      if (d.length <= 7) return `+1 (${a}) ${b}`;
      return `+1 (${a}) ${b}-${c}`;
    }
    return raw;
  }

  // Up to 10 US digits — progressive mask
  const a = digits.slice(0, 3);
  const b = digits.slice(3, 6);
  const c = digits.slice(6, 10);
  if (digits.length < 4) return `(${a}`;
  if (digits.length < 7) return `(${a}) ${b}`;
  return `(${a}) ${b}-${c}`;
}

// Strip to digits for persistence.
export function phoneToDigits(input: string | null | undefined): string {
  if (input == null) return '';
  return String(input).replace(/\D/g, '');
}
