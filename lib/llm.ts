import { load } from "cheerio";

import type { FetchedPage } from "./types";

export type SpellingNote = {
  quote: string;
  suggestion: string;
};

/**
 * Optional closer read for obvious typos. Returns null when the key is missing
 * or the request fails, so the rest of the check still finishes.
 */
export async function findTypos(pages: FetchedPage[]): Promise<SpellingNote[] | null> {
  const key = process.env.CHECKER_LLM_API_KEY;
  if (!key) return null;

  const samples = pages
    .filter((page) => page.ok && (page.role === "home" || page.role === "about" || page.role === "contact"))
    .slice(0, 3)
    .map((page) => {
      const $ = load(page.html);
      $("script, style, noscript, svg, header, nav, footer").remove();
      const text = $("body").text().replace(/\s+/g, " ").trim().slice(0, 3500);
      return `PAGE ${page.url}\n${text}`;
    })
    .filter((sample) => sample.length > 40);

  if (samples.length === 0) return [];

  const base = (process.env.CHECKER_LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.CHECKER_LLM_MODEL || "gpt-4o-mini";

  try {
    const response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              'You check UK clinic website text for obvious spelling mistakes only. UK spelling is correct, including colour, organised and practise used as a verb. Do not flag people\'s names, place names, clinical words, or writing style. Reply with JSON only: {"typos":[{"quote":"exact short excerpt from the text","suggestion":"the corrected word"}]}. If nothing is obvious, return {"typos":[]}. Maximum 5.',
          },
          { role: "user", content: samples.join("\n\n") },
        ],
      }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(content) as {
      typos?: { quote?: string; suggestion?: string }[];
    };
    return (parsed.typos || [])
      .filter((item) => item.quote && item.suggestion)
      .slice(0, 5)
      .map((item) => ({
        quote: String(item.quote).replace(/\s+/g, " ").trim(),
        suggestion: String(item.suggestion).replace(/\s+/g, " ").trim(),
      }));
  } catch {
    return null;
  }
}
