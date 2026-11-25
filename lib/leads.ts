import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import type { Lead } from "./types";

export type LeadSaveResult = {
  ok: boolean;
  savedTo: string[];
};

async function saveToFile(lead: Lead): Promise<boolean> {
  try {
    const dir = path.join(process.cwd(), "data");
    await mkdir(dir, { recursive: true });
    await appendFile(path.join(dir, "leads.ndjson"), `${JSON.stringify(lead)}\n`, "utf8");
    return true;
  } catch (error) {
    console.error("lead file save failed", error instanceof Error ? error.message : error);
    return false;
  }
}

async function saveToWebhook(lead: Lead): Promise<boolean> {
  const url = process.env.LEADS_WEBHOOK_URL;
  if (!url) return false;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "DesignImpClinicChecker/1.0",
      },
      body: JSON.stringify(lead),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      console.error("lead webhook status", response.status);
      return false;
    }
    return true;
  } catch (error) {
    console.error("lead webhook failed", error instanceof Error ? error.message : error);
    return false;
  }
}

async function saveToBlob(lead: Lead): Promise<boolean> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return false;
  try {
    const { put } = await import("@vercel/blob");
    await put(`leads/${lead.id}.json`, JSON.stringify(lead, null, 2), {
      access: "private",
      token,
      contentType: "application/json",
    });
    return true;
  } catch (error) {
    console.error("lead blob save failed", error instanceof Error ? error.message : error);
    return false;
  }
}

export async function saveLead(lead: Lead): Promise<LeadSaveResult> {
  const [file, webhook, blob] = await Promise.all([
    saveToFile(lead),
    saveToWebhook(lead),
    saveToBlob(lead),
  ]);
  const savedTo = [
    file ? "file" : null,
    webhook ? "webhook" : null,
    blob ? "blob" : null,
  ].filter((item): item is string => Boolean(item));

  if (savedTo.length === 0) {
    console.info(
      JSON.stringify({
        kind: "clinic-check-lead",
        id: lead.id,
        createdAt: lead.createdAt,
        name: lead.name,
        email: lead.email,
        url: lead.url,
        score: lead.score,
        findings: lead.findings,
      }),
    );
    savedTo.push("logs");
  }

  return { ok: true, savedTo };
}
