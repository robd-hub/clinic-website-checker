import { saveLead } from "@/lib/leads";
import type { CheckStatus, Lead, LeadFinding, Quote } from "@/lib/types";

export const maxDuration = 15;

const STATUSES = new Set<CheckStatus>(["pass", "fail", "warn", "na"]);

function clip(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max) : clean;
}

function isQuote(value: unknown): value is Quote {
  if (!value || typeof value !== "object") return false;
  const quote = value as Quote;
  return typeof quote.text === "string" && typeof quote.pageUrl === "string";
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "We couldn't read that. Try again." }, { status: 400 });
  }

  if (typeof body.company === "string" && body.company.trim()) {
    return Response.json({ ok: true });
  }

  const name = typeof body.name === "string" ? clip(body.name, 80) : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const url = typeof body.url === "string" ? clip(body.url, 300) : "";
  const verdict = typeof body.verdict === "string" ? clip(body.verdict, 240) : "";
  const score = typeof body.score === "number" ? Math.round(body.score) : Number.NaN;

  if (name.length < 2) {
    return Response.json({ error: "Add your name so Rob knows who to reply to." }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) {
    return Response.json({ error: "That email doesn't look right." }, { status: 400 });
  }
  if (!/^https?:\/\//i.test(url)) {
    return Response.json({ error: "Check a website first, then ask for the before-and-after." }, { status: 400 });
  }
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    return Response.json({ error: "Check a website first, then ask for the before-and-after." }, { status: 400 });
  }

  const findings: LeadFinding[] = [];
  if (Array.isArray(body.findings)) {
    for (const item of body.findings.slice(0, 12)) {
      if (!item || typeof item !== "object") continue;
      const finding = item as LeadFinding;
      if (typeof finding.title !== "string" || !STATUSES.has(finding.status)) continue;
      const quotes = Array.isArray(finding.quotes)
        ? finding.quotes.filter(isQuote).slice(0, 4).map((quote) => ({
            text: clip(quote.text, 300),
            pageUrl: clip(quote.pageUrl, 300),
            pageLabel: clip(quote.pageLabel || "", 40),
          }))
        : [];
      findings.push({
        id: clip(String(finding.id || ""), 40),
        title: clip(finding.title, 80),
        status: finding.status,
        summary: clip(String(finding.summary || ""), 400),
        impact: finding.impact ? clip(String(finding.impact), 300) : undefined,
        quotes,
      });
    }
  }

  const pages = Array.isArray(body.pages)
    ? body.pages.filter((item): item is string => typeof item === "string").slice(0, 8).map((item) => clip(item, 300))
    : [];

  const lead: Lead = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    name,
    email,
    url,
    score,
    verdict,
    findings,
    pages,
  };

  try {
    const saved = await saveLead(lead);
    return Response.json({ ok: true, savedTo: saved.savedTo });
  } catch (error) {
    console.error("lead failed", error);
    return Response.json(
      { error: "We couldn't save that just now. Email rob@designimp.com and mention the website." },
      { status: 500 },
    );
  }
}
