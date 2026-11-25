import { load } from "cheerio";

import {
  analyzeSite,
  classifyLink,
  homepageHints,
  hostKey,
  listMapEmbeds,
  pageLabel,
} from "./analyze";
import {
  CheckError,
  checkCertificate,
  fetchPublic,
  findMixedContent,
  looksLikeHtml,
  normaliseUrl,
} from "./http";
import { findTypos } from "./llm";
import type { FetchedPage, PageRole, Report, SslReport } from "./types";

const EXTRA_LIMIT = 4;

export async function runCheck(input: string): Promise<Report> {
  const startUrl = normaliseUrl(input);
  const initial = new URL(startUrl);

  const [homeResult, certResult] = await Promise.allSettled([
    fetchPublic(startUrl, 8000),
    checkCertificate(initial.hostname),
  ]);

  if (homeResult.status === "rejected") {
    const reason = homeResult.reason;
    if (reason instanceof CheckError) throw reason;
    throw new CheckError("We couldn't open that website. Check the address and try again.", 422);
  }

  const homeResponse = homeResult.value;
  if (homeResponse.status >= 400) {
    throw new CheckError(
      homeResponse.status === 404
        ? "That page wasn't found. Check the address and try again."
        : "The website refused the check. It may be blocking automated visits, so try again later.",
      422,
    );
  }
  if (!looksLikeHtml(homeResponse.body, homeResponse.contentType)) {
    throw new CheckError("That address didn't return a normal web page.", 422);
  }

  const final = new URL(homeResponse.finalUrl);
  let ssl: SslReport =
    certResult.status === "fulfilled"
      ? certResult.value
      : {
          secure: false,
          certificateValid: false,
          error: "We couldn't read the security certificate.",
          mixedContent: [],
        };

  if (hostKey(final.hostname) !== hostKey(initial.hostname)) {
    ssl = await checkCertificate(final.hostname);
  }

  ssl = {
    ...ssl,
    mixedContent: findMixedContent(homeResponse.body),
  };

  // Node only returns the page when the certificate is valid, so a failed
  // side check shouldn't wipe a connection that already succeeded.
  if (final.protocol === "https:" && !ssl.certificateValid) {
    ssl = {
      secure: true,
      certificateValid: true,
      mixedContent: ssl.mixedContent,
    };
  }
  if (final.protocol !== "https:") {
    ssl = { ...ssl, secure: false, certificateValid: false };
  }

  const home: FetchedPage = {
    url: homeResponse.finalUrl,
    role: "home",
    status: homeResponse.status,
    html: homeResponse.body,
    ok: true,
  };

  const extras = pickPages(home);
  const extraPages = await Promise.all(extras.map(fetchExtra));
  const pages = [home, ...extraPages];

  const hints = homepageHints(home.html, home.url);
  const cssHasMedia = hints.inlineMedia ? true : await stylesheetMedia(home.html, hints.stylesheets);

  const embeds = listMapEmbeds(pages);
  const mapProbes = await Promise.all(
    embeds.map(async (frame) => {
      try {
        const response = await fetchPublic(frame.src, 6000);
        return {
          src: frame.src,
          ok: response.status < 400,
          status: response.status,
          body: response.body.slice(0, 80_000),
        };
      } catch (error) {
        return {
          src: frame.src,
          ok: false,
          body: "",
          error: error instanceof Error ? error.message : "Couldn't load the map",
        };
      }
    }),
  );

  const typos = await findTypos(pages);
  const analyzed = analyzeSite({
    pages,
    ssl,
    mapProbes,
    cssHasMedia,
    typos,
    spellingRead: typos ? "full" : "light",
  });

  return {
    url: startUrl,
    finalUrl: home.url,
    hostname: final.hostname.replace(/^www\./, ""),
    fetchedAt: new Date().toISOString(),
    score: analyzed.score,
    verdict: analyzed.verdict,
    scoreNote: analyzed.scoreNote,
    checks: analyzed.checks,
    pages: pages
      .filter((page) => page.ok)
      .map((page) => ({
        url: page.url,
        role: page.role,
        label: pageLabel(page.role),
        ok: page.ok,
      })),
  };
}

async function fetchExtra(item: { url: string; role: PageRole }): Promise<FetchedPage> {
  try {
    const response = await fetchPublic(item.url, 7000);
    const ok = response.status < 400 && looksLikeHtml(response.body, response.contentType);
    return {
      url: response.finalUrl,
      role: item.role,
      status: response.status,
      html: ok ? response.body : "",
      ok,
    };
  } catch {
    return {
      url: item.url,
      role: item.role,
      status: 0,
      html: "",
      ok: false,
    };
  }
}

async function stylesheetMedia(html: string, stylesheets: string[]): Promise<boolean | null> {
  if (!/name=["']viewport["']/i.test(html) || stylesheets.length === 0) return null;
  const sheets = await Promise.all(
    stylesheets.map(async (href) => {
      try {
        const response = await fetchPublic(href, 4000);
        return /@media\s/i.test(response.body);
      } catch {
        return null;
      }
    }),
  );
  if (sheets.some((sheet) => sheet === true)) return true;
  if (sheets.length > 0 && sheets.every((sheet) => sheet === false)) return false;
  return null;
}

function pickPages(home: FetchedPage): { url: string; role: PageRole }[] {
  const $ = load(home.html);
  const origin = new URL(home.url);
  const best = new Map<PageRole, string>();
  $("a[href]").each((_, element) => {
    const href = $(element).attr("href") || "";
    const text = $(element).text().replace(/\s+/g, " ").trim();
    const role = classifyLink(text, href);
    if (!role) return;
    let absolute: URL;
    try {
      absolute = new URL(href, home.url);
    } catch {
      return;
    }
    if (absolute.protocol !== "http:" && absolute.protocol !== "https:") return;
    if (hostKey(absolute.hostname) !== hostKey(origin.hostname)) return;
    if (/\.(pdf|jpe?g|png|gif|webp|zip)$/i.test(absolute.pathname)) return;
    absolute.hash = "";
    const url = absolute.toString();
    if (url.replace(/\/$/, "") === home.url.replace(/\/$/, "")) return;
    if (!best.has(role)) best.set(role, url);
  });

  const order: PageRole[] = ["contact", "about", "fees", "covid", "blog"];
  const picked: { url: string; role: PageRole }[] = [];
  for (const role of order) {
    const url = best.get(role);
    if (!url) continue;
    picked.push({ url, role });
    if (picked.length >= EXTRA_LIMIT) break;
  }
  return picked;
}
