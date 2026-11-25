/** Pull UK phone numbers out of visible text. Prefers the shortest valid match so a second copy in brackets is not glued on. */

export function normalizePhone(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("0044")) digits = "0" + digits.slice(4);
  else if (digits.startsWith("44")) digits = "0" + digits.slice(2);
  return digits;
}

export function isUkPhone(raw: string): boolean {
  const digits = normalizePhone(raw);
  return /^0[12378]\d{8,9}$/.test(digits);
}

function pretty(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function shortestValid(chunk: string): string | null {
  let acc = "";
  let digits = 0;
  let found: string | null = null;
  for (const ch of chunk) {
    if (digits > 0 && /[a-z]/i.test(ch)) break;
    acc += ch;
    if (/\d/.test(ch)) digits += 1;
    const trimmed = acc.replace(/[\s().-]+$/g, "");
    if (digits >= 10 && isUkPhone(trimmed)) {
      found = pretty(trimmed);
      const national = normalizePhone(trimmed);
      if (national.length >= 11) return found;
    }
    if (digits > 13) break;
  }
  return found;
}

export function findPhoneStrings(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(/(?:\+44|0\d)/g)) {
    const index = match.index ?? 0;
    const chunk = text.slice(index, index + 28);
    const phone = shortestValid(chunk);
    if (!phone) continue;
    const key = normalizePhone(phone);
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(phone);
  }
  return found;
}
