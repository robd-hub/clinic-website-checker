export class CheckError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "CheckError";
    this.status = status;
  }
}

export function normaliseUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new CheckError("Paste the clinic website address first.");
  }
  if (trimmed.length > 300) {
    throw new CheckError("That address is too long.");
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new CheckError("That doesn't look like a website address.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CheckError("Use a normal website address, starting with https://.");
  }
  if (!url.hostname.includes(".")) {
    throw new CheckError("That doesn't look like a public website address.");
  }
  if (url.username || url.password) {
    throw new CheckError("Take the username and password out of the address.");
  }
  url.hash = "";
  return url.toString();
}

export function readUrlParam(value: string | string[] | undefined): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? "";
  return "";
}

/** Trimmed query value that is safe to prefill and check, or null to ignore. */
export function runnableQueryUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    normaliseUrl(trimmed);
    return trimmed;
  } catch {
    return null;
  }
}

export function checkLinkPath(input: string): string {
  const params = new URLSearchParams();
  params.set("url", input.trim());
  return `/?${params.toString()}`;
}
