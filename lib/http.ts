import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import tls from "node:tls";

import type { SslReport } from "./types";
import { CheckError } from "./url";

export { CheckError, normaliseUrl } from "./url";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 DesignImpClinicChecker/1.0";

const MAX_BYTES = 1_500_000;

function isBlockedIp(ip: string): boolean {
  const mapped = ip.toLowerCase().startsWith("::ffff:")
    ? ip.slice(7)
    : ip;
  if (mapped.includes(":")) {
    const first = mapped.split(":")[0] || "0";
    const value = Number.parseInt(first, 16);
    if (mapped === "::1" || mapped === "::") return true;
    if (value >= 0xfc00 && value <= 0xfdff) return true;
    if (value >= 0xfe80 && value <= 0xfebf) return true;
    return false;
  }
  const parts = mapped.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return true;
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 198 && (b === 18 || (b === 51 && c === 100))) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;
  return false;
}

function blockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "metadata.google.internal" ||
    host.endsWith(".internal")
  ) {
    return true;
  }
  return false;
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new CheckError("That doesn't look like a website address.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CheckError("Use a normal website address, starting with https://.");
  }
  if (url.username || url.password) {
    throw new CheckError("Take the username and password out of the address.");
  }
  if (blockedHostname(url.hostname)) {
    throw new CheckError("That address isn't a public website.");
  }
  if (isIP(url.hostname)) {
    if (isBlockedIp(url.hostname)) {
      throw new CheckError("That address isn't a public website.");
    }
    return url;
  }
  let records: { address: string }[];
  try {
    records = await lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw new CheckError(
      "We couldn't find that website. Check the address and try again.",
      422,
    );
  }
  if (records.length === 0 || records.some((record) => isBlockedIp(record.address))) {
    throw new CheckError("That address isn't a public website.");
  }
  return url;
}

async function readLimited(response: Response, max: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > max) {
      chunks.push(value.slice(0, Math.max(0, value.byteLength - (total - max))));
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export type PublicResponse = {
  finalUrl: string;
  status: number;
  contentType: string;
  body: string;
};

export async function fetchPublic(
  rawUrl: string,
  timeoutMs = 8000,
): Promise<PublicResponse> {
  let current = rawUrl;
  for (let hop = 0; hop < 5; hop += 1) {
    await assertPublicUrl(current);
    let response: Response;
    try {
      response = await fetch(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          "user-agent": UA,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "en-GB,en;q=0.9",
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/timeout|aborted/i.test(message)) {
        throw new CheckError(
          "That website took too long to answer. Try again in a moment.",
          504,
        );
      }
      if (/certificate|ssl|tls|cert/i.test(message)) {
        throw new CheckError(
          "The browser would warn people about this site's security certificate, so we stopped.",
          422,
        );
      }
      throw new CheckError(
        "We couldn't open that website. Check the address and try again.",
        422,
      );
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) {
        throw new CheckError("The website sent a redirect we couldn't follow.", 422);
      }
      current = new URL(location, current).toString();
      continue;
    }

    const body = await readLimited(response, MAX_BYTES);
    return {
      finalUrl: current,
      status: response.status,
      contentType: response.headers.get("content-type") || "",
      body,
    };
  }
  throw new CheckError("The website redirected too many times.", 422);
}

export function looksLikeHtml(body: string, contentType: string): boolean {
  if (/text\/html|application\/xhtml/i.test(contentType)) return true;
  return /<!doctype html|<html[\s>]|<head[\s>]|<body[\s>]/i.test(body.slice(0, 2000));
}

function friendlyCertError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("expired")) return "The security certificate has expired.";
  if (lower.includes("self signed") || lower.includes("unable to verify")) {
    return "The security certificate isn't one browsers trust.";
  }
  if (lower.includes("altname") || lower.includes("hostname")) {
    return "The security certificate is for a different website.";
  }
  return "The security certificate isn't valid.";
}

export function checkCertificate(hostname: string): Promise<SslReport> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (report: SslReport) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(report);
    };
    const socket = tls.connect({
      host: hostname,
      port: 443,
      servername: hostname,
      rejectUnauthorized: true,
      timeout: 7000,
    });
    socket.setTimeout(7000, () => {
      finish({
        secure: false,
        certificateValid: false,
        error: "The secure connection timed out.",
        mixedContent: [],
      });
    });
    socket.on("secureConnect", () => {
      const cert = socket.getPeerCertificate();
      const validTo = cert.valid_to ? new Date(cert.valid_to).toISOString() : undefined;
      finish({
        secure: true,
        certificateValid: socket.authorized,
        validTo: validTo && !Number.isNaN(Date.parse(validTo)) ? validTo : undefined,
        error: socket.authorized
          ? undefined
          : friendlyCertError(String(socket.authorizationError || "")),
        mixedContent: [],
      });
    });
    socket.on("error", (error) => {
      finish({
        secure: false,
        certificateValid: false,
        error: friendlyCertError(error.message),
        mixedContent: [],
      });
    });
  });
}

export function findMixedContent(html: string): string[] {
  const hosts = new Set<string>();
  const pattern =
    /<(?:script|img|iframe|source|video|audio|embed|link)\b[^>]*?\s(?:src|href)\s*=\s*["'](http:\/\/[^"']+)["']/gi;
  for (const match of html.matchAll(pattern)) {
    try {
      const url = new URL(match[1]);
      if (url.hostname === "www.w3.org") continue;
      hosts.add(url.hostname.replace(/^www\./, ""));
    } catch {
      continue;
    }
    if (hosts.size >= 4) break;
  }
  return [...hosts];
}
