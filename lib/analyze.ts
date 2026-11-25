import { load, type CheerioAPI } from "cheerio";
import * as chrono from "chrono-node";
import type { AnyNode, Element, Text } from "domhandler";

import { findPhoneStrings, isUkPhone } from "./phones";
import type {
  CheckResult,
  FetchedPage,
  MapProbe,
  PageRole,
  Quote,
  SslReport,
} from "./types";

export type AnalyzeInput = {
  pages: FetchedPage[];
  ssl: SslReport;
  mapProbes: MapProbe[];
  cssHasMedia: boolean | null;
  typos: { quote: string; suggestion: string }[] | null;
  spellingRead: "full" | "light";
  now?: Date;
};

const MONTH =
  /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)\b/i;

export function pageLabel(role: PageRole): string {
  switch (role) {
    case "home":
      return "Homepage";
    case "contact":
      return "Contact page";
    case "about":
      return "About page";
    case "fees":
      return "Fees page";
    case "blog":
      return "Blog";
    case "covid":
      return "Coronavirus page";
    default:
      return "Another page";
  }
}

function clip(text: string, max = 220): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 80 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

function check(
  partial: Omit<CheckResult, "quotes"> & { quotes?: Quote[] },
): CheckResult {
  return { quotes: [], ...partial };
}

function dedupeQuotes(quotes: Quote[]): Quote[] {
  const seen = new Set<string>();
  const out: Quote[] = [];
  for (const quote of quotes) {
    const key = quote.text.toLowerCase();
    if (!quote.text || seen.has(key)) continue;
    seen.add(key);
    out.push(quote);
    if (out.length >= 4) break;
  }
  return out;
}

function dom(page: FetchedPage): CheerioAPI {
  return load(page.html);
}

function walk(node: AnyNode, visit: (node: AnyNode) => void) {
  if (skipTag(node)) return;
  visit(node);
  if ("children" in node && node.children) {
    for (const child of node.children) walk(child, visit);
  }
}

function skipTag(node: AnyNode): boolean {
  return (
    node.type === "tag" &&
    ["script", "style", "noscript", "svg", "template"].includes(node.name)
  );
}

function elementText(node: Element): string {
  let text = "";
  walk(node, (child) => {
    if (skipTag(child)) return;
    if (child.type === "text") text += ` ${child.data}`;
  });
  return text.replace(/\s+/g, " ").trim();
}

function classId(node: Element): string {
  return `${node.attribs?.class || ""} ${node.attribs?.id || ""}`.toLowerCase();
}

function hiddenOnMobile(node: Element): boolean {
  let current: Element | null = node;
  for (let depth = 0; depth < 8 && current; depth += 1) {
    const cls = classId(current);
    if (
      /(hidden-xs|hidden-sm|hide-on-mobile|mobile-hidden|desktop-only|max-md:hidden|max-sm:hidden)/.test(
        cls,
      )
    ) {
      return true;
    }
    if (/\bhidden\b/.test(cls) && /\b(md|lg|xl):(block|flex|inline|grid)\b/.test(cls)) {
      return true;
    }
    if (/\bd-none\b/.test(cls) && /\bd-(md|lg|xl)-/.test(cls)) return true;
    const parent = current.parent as AnyNode | null;
    current = parent && parent.type === "tag" ? parent : null;
  }
  return false;
}

function inTag(node: Element, names: string[]): boolean {
  let current: Element | null = node;
  while (current) {
    if (names.includes(current.name)) return true;
    const cls = classId(current);
    if (names.includes("header") && /(^|\s)(header|navbar|masthead|top-bar|topbar)(\s|$)/.test(cls)) {
      return true;
    }
    if (names.includes("footer") && /(^|\s)(footer|site-footer)(\s|$)/.test(cls)) return true;
    if (names.includes("nav") && current.attribs?.role === "navigation") return true;
    const parent = current.parent as AnyNode | null;
    current = parent && parent.type === "tag" ? parent : null;
  }
  return false;
}

function textBefore(body: Element, target: Element): number {
  let count = 0;
  let found = false;
  function walkUntil(node: AnyNode) {
    if (found) return;
    if (node.type === "tag" && node === target) {
      found = true;
      return;
    }
    if (skipTag(node)) return;
    if (node.type === "text") {
      count += node.data.replace(/\s+/g, " ").trim().length;
      return;
    }
    if ("children" in node && node.children) {
      for (const child of node.children) {
        walkUntil(child);
        if (found) return;
      }
    }
  }
  walkUntil(body);
  return found ? count : 100000;
}

function weekdayCount(text: string): number {
  return text.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi)?.length ?? 0;
}

function isStaleCovid(text: string): boolean {
  const lower = text.toLowerCase();
  if (!/covid|coronavirus|pandemic/.test(lower)) return false;
  const treatment =
    /long covid|post[-\s]?covid/.test(lower) &&
    !/coronavirus|covid-?\s?19|pandemic|update|policy|restriction|lockdown|notice|guidance/.test(
      lower,
    );
  if (treatment) return false;
  return /coronavirus|covid-?\s?19|\bcovid\b|pandemic/.test(lower);
}

const CLOSURE =
  /\b(annual leave|on holiday|we are closed|we're closed|we’re closed|temporarily closed|closed for|closed from|closed until|closed between|will be closed|reopen|closure)\b/i;

function latestDate(text: string, now: Date): Date | null {
  const results = chrono.parse(text, now, { forwardDate: false });
  let latest: Date | null = null;
  for (const result of results) {
    const date = result.end?.date() ?? result.start.date();
    if (!latest || date > latest) latest = date;
  }
  return latest;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function olderThan(date: Date, years: number, now: Date): boolean {
  const cutoff = new Date(now);
  cutoff.setFullYear(cutoff.getFullYear() - years);
  return date < cutoff;
}

type Dated = { date: Date; quote: string; page: FetchedPage };

function jsonLdDates(page: FetchedPage, $: CheerioAPI): Dated[] {
  const found: Dated[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).text();
    if (!raw) return;
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    const visit = (node: unknown) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      const record = node as Record<string, unknown>;
      const type = record["@type"];
      const types = Array.isArray(type) ? type.map(String) : [String(type || "")];
      const isArticle = types.some((item) =>
        /Article|BlogPosting|NewsArticle/i.test(item),
      );
      const published = record.datePublished || record.dateCreated;
      if (isArticle && typeof published === "string") {
        const date = new Date(published);
        if (!Number.isNaN(date.getTime())) {
          const headline = typeof record.headline === "string" ? record.headline : "";
          found.push({
            date,
            quote: headline
              ? `${clip(headline, 80)} · ${formatDate(date)}`
              : formatDate(date),
            page,
          });
        }
      }
      for (const value of Object.values(record)) visit(value);
    };
    visit(data);
  });
  return found;
}

function postDates(page: FetchedPage, $: CheerioAPI, now: Date): Dated[] {
  const found: Dated[] = jsonLdDates(page, $);
  const blogPage =
    page.role === "blog" || /\/(blog|news|articles?)(\/|$)/i.test(new URL(page.url).pathname);
  const consider = (text: string, quote: string) => {
    if (!MONTH.test(text) || !/\b20\d{2}\b/.test(text)) return;
    if (/copyright|©|\(c\)/i.test(text)) return;
    const date = latestDate(text, now);
    if (!date || date.getFullYear() < 1990 || date > new Date(now.getTime() + 86400000)) return;
    found.push({ date, quote: clip(quote || text, 160), page });
  };

  $("time[datetime]").each((_, el) => {
    if (!blogPage && !$(el).closest("article, .post, .hentry, .blog, .news").length) return;
    const stamp = $(el).attr("datetime") || "";
    const date = new Date(stamp);
    if (Number.isNaN(date.getTime())) return;
    const heading = $(el).closest("article, .post, .hentry").find("h1, h2, h3").first().text();
    found.push({
      date,
      quote: heading.trim()
        ? `${clip(heading, 80)} · ${formatDate(date)}`
        : formatDate(date),
      page,
    });
  });

  const selector = blogPage
    ? "article, .post, .hentry, .blog-item, [class*=posted], [class*=entry-date], [class*=post-date]"
    : ".post, .hentry, [class*=posted-on], [class*=entry-date], [class*=post-date]";
  $(selector).each((_, el) => {
    const element = el as Element;
    const text = elementText(element).slice(0, 240);
    consider(text, text);
  });

  if (blogPage) {
    const clean = load(page.html);
    clean("script, style, noscript, header, nav, footer").remove();
    const text = clean("body").text().replace(/\s+/g, " ");
    const dated =
      /\b(\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+20\d{2}|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+20\d{2})/gi;
    for (const match of text.matchAll(dated)) {
      const at = match.index ?? 0;
      const window = text.slice(Math.max(0, at - 90), at + match[1].length);
      const postedAt = window.toLowerCase().lastIndexOf("posted");
      let quote = window;
      if (postedAt >= 0) {
        const before = window.slice(0, postedAt);
        const title = before
          .split(/[.?…!]/)
          .map((part) => part.trim())
          .filter(Boolean)
          .pop();
        const posted = window.slice(postedAt).replace(/\s+/g, " ").trim();
        const punct = before.trimEnd().endsWith("?") ? "?" : ".";
        quote = title && title.length > 8 && title.length < 90 ? `${title}${punct} ${posted}` : posted;
      }
      consider(match[1], quote);
    }
  }

  const urlMatch = page.url.match(/\/(20\d{2})\/(\d{1,2})\/(\d{1,2})(?:\/|$)/);
  if (urlMatch) {
    const date = new Date(Number(urlMatch[1]), Number(urlMatch[2]) - 1, Number(urlMatch[3]));
    if (!Number.isNaN(date.getTime())) {
      found.push({ date, quote: `The address includes ${formatDate(date)}`, page });
    }
  }
  return found;
}

function checkOutdated(pages: FetchedPage[], now: Date): CheckResult {
  const quotes: Quote[] = [];
  let covid = false;
  let closure = false;
  let copyrightYear: number | null = null;
  let copyrightQuote: Quote | null = null;
  let oldPost: Dated | null = null;
  let sawBlog = false;

  for (const page of pages) {
    if (!page.ok) continue;
    const $ = dom(page);
    const label = pageLabel(page.role);

    $("a, h1, h2, h3").each((_, el) => {
      const text = $(el).text().replace(/\s+/g, " ").trim();
      const href = $(el).attr("href") || "";
      if (!text || text.length > 90) return;
      if (!isStaleCovid(`${text} ${href}`)) return;
      covid = true;
      quotes.push({ text, pageUrl: page.url, pageLabel: label });
    });

    $("[class*=notice], [class*=alert], [class*=banner], [class*=announcement], [id*=covid], [class*=covid]").each(
      (_, el) => {
        const text = $(el).text().replace(/\s+/g, " ").trim();
        if (text.length < 8 || text.length > 280) return;
        if (!isStaleCovid(text)) return;
        covid = true;
        quotes.push({ text: clip(text), pageUrl: page.url, pageLabel: label });
      },
    );

    if (page.role === "covid") {
      const heading = $("h1, h2").first().text().replace(/\s+/g, " ").trim();
      const paragraph = $("p")
        .toArray()
        .map((el) => $(el).text().replace(/\s+/g, " ").trim())
        .find((text) => text.length > 40);
      if (heading) {
        covid = true;
        quotes.push({ text: heading, pageUrl: page.url, pageLabel: label });
      }
      if (paragraph) {
        quotes.push({ text: clip(paragraph), pageUrl: page.url, pageLabel: label });
      }
    }

    $("p, li, h2, h3, blockquote").each((_, el) => {
      const text = $(el).text().replace(/\s+/g, " ").trim();
      if (text.length < 12 || text.length > 400) return;
      if (weekdayCount(text) >= 3) return;
      if (!CLOSURE.test(text)) return;
      if (!/\b(19|20)\d{2}\b/.test(text)) return;
      const date = latestDate(text.replace(/\b\d{1,2}[.:]\d{2}\s*(am|pm)?\b/gi, ""), now);
      if (!date || date >= startOfDay(now)) return;
      closure = true;
      quotes.push({ text: clip(text), pageUrl: page.url, pageLabel: label });
    });

    const visible = $("body").text();
    const copyRe = /(?:©|\(c\)|\bcopyright\b)[^.\n]{0,90}/gi;
    for (const match of visible.matchAll(copyRe)) {
      const years = [...match[0].matchAll(/\b(19|20)\d{2}\b/g)].map((item) => Number(item[0]));
      const year = years.length ? Math.max(...years) : null;
      if (!year || year > now.getFullYear() + 1) continue;
      if (copyrightYear === null || year > copyrightYear) {
        copyrightYear = year;
        copyrightQuote = {
          text: clip(match[0], 120),
          pageUrl: page.url,
          pageLabel: label,
        };
      }
    }

    if (page.role === "blog" || /blog|news/i.test(page.url)) sawBlog = true;
    if ($("a[href*='blog'], a[href*='news']").length) sawBlog = true;
    for (const dated of postDates(page, $, now)) {
      if (!oldPost || dated.date > oldPost.date) oldPost = dated;
    }
  }

  const blogStale = Boolean(oldPost && olderThan(oldPost.date, 2, now));
  const copyrightStale =
    copyrightYear !== null && copyrightYear < now.getFullYear() - 1;

  if (copyrightStale && copyrightQuote) quotes.push(copyrightQuote);
  if (blogStale && oldPost) {
    quotes.push({
      text: oldPost.quote,
      pageUrl: oldPost.page.url,
      pageLabel: pageLabel(oldPost.page.role),
    });
  }

  const problems: string[] = [];
  if (covid) problems.push("The site still shows a COVID or coronavirus notice.");
  if (closure) problems.push("A closure or holiday notice has a date in the past.");
  if (blogStale && oldPost) {
    problems.push(`The newest dated post we found is ${formatDate(oldPost.date)}.`);
  }
  if (copyrightStale) problems.push(`The copyright year is ${copyrightYear}.`);

  if (problems.length === 0) {
    const extra = sawBlog && !oldPost ? " We found a blog link, but no post date." : "";
    return check({
      id: "outdated",
      title: "Up to date",
      status: "pass",
      summary: `Nothing looked out of date. No COVID notice, no expired closure, and no old copyright year.${extra}`,
    });
  }

  let impact = "Visitors may think the clinic's details are no longer looked after.";
  if (covid) {
    impact = "Visitors may think your rules are out of date or that you're closed.";
  } else if (closure) {
    impact = "Visitors may think you're still shut, because that notice is in the past.";
  } else if (blogStale) {
    impact = "A news page that stopped years ago makes a busy clinic look quiet.";
  } else if (copyrightStale) {
    impact = "An old copyright year makes people wonder if the prices and opening hours are still right.";
  }

  return check({
    id: "outdated",
    title: "Up to date",
    status: "fail",
    summary: problems.join(" "),
    quotes: dedupeQuotes(quotes),
    impact,
  });
}

export function listMapEmbeds(pages: FetchedPage[]): { src: string; pageUrl: string; pageLabel: string }[] {
  const frames: { src: string; pageUrl: string; pageLabel: string }[] = [];
  const seen = new Set<string>();
  for (const page of pages) {
    if (!page.ok) continue;
    const $ = dom(page);
    $("iframe").each((_, el) => {
      const src = $(el).attr("src") || $(el).attr("data-src") || $(el).attr("data-lazy-src") || "";
      if (!/google\.[^/"']+\/maps|maps\.google|openstreetmap|maps\.apple/i.test(src)) return;
      let absolute = src;
      try {
        absolute = new URL(src, page.url).toString();
      } catch {
        return;
      }
      if (seen.has(absolute)) return;
      seen.add(absolute);
      frames.push({ src: absolute, pageUrl: page.url, pageLabel: pageLabel(page.role) });
    });
  }
  return frames.slice(0, 2);
}

const MAP_ERROR =
  /oops!\s*something went wrong|this page can(?:'|’)t load google maps|google maps platform rejected|for development purposes only|invalidkey|referernotallowed|the provided api key is invalid|sorry!\s*something went wrong/i;

function checkMaps(pages: FetchedPage[], probes: MapProbe[]): CheckResult {
  const frames = listMapEmbeds(pages);
  const quotes: Quote[] = [];
  for (const page of pages) {
    if (!page.ok) continue;
    const $ = dom(page);
    $("body").find("script, style, noscript").remove();
    const text = $("body").text().replace(/\s+/g, " ");
    const match = text.match(MAP_ERROR);
    if (match) {
      quotes.push({
        text: clip(match[0]),
        pageUrl: page.url,
        pageLabel: pageLabel(page.role),
      });
    }
  }
  if (quotes.length) {
    return check({
      id: "map",
      title: "Map",
      status: "fail",
      summary: "The page shows a Google Maps error.",
      quotes,
      impact: "If the map is broken, new patients struggle to find the clinic and may not come.",
    });
  }
  if (frames.length === 0) {
    return check({
      id: "map",
      title: "Map",
      status: "na",
      summary: "No map embed on the pages we checked, so this wasn't scored.",
    });
  }
  for (const frame of frames) {
    const probe = probes.find((item) => item.src === frame.src);
    if (!probe) continue;
    const error = probe.body.match(MAP_ERROR);
    if (error) {
      return check({
        id: "map",
        title: "Map",
        status: "fail",
        summary: "The map frame came back with an error.",
        quotes: [{ text: clip(error[0]), pageUrl: frame.pageUrl, pageLabel: frame.pageLabel }],
        impact: "If the map is broken, new patients struggle to find the clinic and may not come.",
      });
    }
    if (!probe.ok || (probe.status && probe.status >= 400)) {
      return check({
        id: "map",
        title: "Map",
        status: "warn",
        summary: "We found a map, but we couldn't load the frame to confirm it works.",
        quotes: [{ text: frame.src, pageUrl: frame.pageUrl, pageLabel: frame.pageLabel }],
        impact: "If visitors see “Oops! Something went wrong” in the map, the embed needs fixing.",
      });
    }
  }
  return check({
    id: "map",
    title: "Map",
    status: "pass",
    summary: "The map embed loaded without an error message.",
  });
}

const SHORTCODE =
  /\[(\/?[a-zA-Z][a-zA-Z0-9:_-]{0,40})((?:\s+[^\]]{0,160})?)\]/g;

function looksLikeShortcode(name: string, rest: string): boolean {
  if (/^data-/i.test(name)) return false;
  if (rest.includes("=")) return true;
  if (name.startsWith("/")) return true;
  if (name.includes("_")) return true;
  return ["gallery", "caption", "audio", "video", "embed", "playlist", "contact-form", "contact-form-7"].includes(
    name.toLowerCase(),
  );
}

function visibleTextNodes(page: FetchedPage): { text: string; page: FetchedPage }[] {
  if (!page.ok) return [];
  const $ = dom(page);
  const body = $("body").get(0);
  if (!body) return [];
  const nodes: { text: string; page: FetchedPage }[] = [];
  walk(body, (node) => {
    if (skipTag(node)) return;
    if (node.type === "text") {
      const text = node.data.replace(/\s+/g, " ").trim();
      if (text) nodes.push({ text, page });
    }
  });
  return nodes;
}

function checkCode(pages: FetchedPage[]): CheckResult {
  const quotes: Quote[] = [];
  for (const page of pages) {
    for (const node of visibleTextNodes(page)) {
      for (const match of node.text.matchAll(SHORTCODE)) {
        const full = match[0];
        if (!looksLikeShortcode(match[1], match[2] || "")) continue;
        quotes.push({
          text: full,
          pageUrl: page.url,
          pageLabel: pageLabel(page.role),
        });
      }
      for (const match of node.text.matchAll(/\{\{[a-zA-Z][^}]{0,60}\}\}|<\?php|\{%[^%]{1,80}%\}/g)) {
        quotes.push({
          text: match[0],
          pageUrl: page.url,
          pageLabel: pageLabel(page.role),
        });
      }
    }
  }
  const unique = dedupeQuotes(quotes);
  if (!unique.length) {
    return check({
      id: "code",
      title: "Stray code on the page",
      status: "pass",
      summary: "No leftover template code was showing in the text.",
    });
  }
  return check({
    id: "code",
    title: "Stray code on the page",
    status: "fail",
    summary: "Visitors can see leftover template code that should have been hidden.",
    quotes: unique,
    impact: "That code should have turned into a form, a map or a gallery. Left on the page, the site looks broken.",
  });
}

type PhoneHit = {
  display: string;
  tel: boolean;
  nearTop: boolean;
  hiddenOnMobile: boolean;
  page: FetchedPage;
};

function collectPhones(page: FetchedPage): PhoneHit[] {
  if (!page.ok) return [];
  const $ = dom(page);
  const body = $("body").get(0);
  if (!body) return [];
  const hits: PhoneHit[] = [];
  const push = (display: string, el: Element, tel: boolean) => {
    if (!isUkPhone(display)) return;
    hits.push({
      display: display.replace(/\s+/g, " ").trim(),
      tel,
      nearTop: inTag(el, ["header", "nav"]) || textBefore(body, el) < 400,
      hiddenOnMobile: hiddenOnMobile(el),
      page,
    });
  };

  walk(body, (node) => {
    if (node.type !== "tag") return;
    if (node.name === "a") {
      const href = node.attribs?.href || "";
      if (/^tel:/i.test(href)) {
        const fromHref = href.replace(/^tel:/i, "");
        const fromText = elementText(node);
        push(isUkPhone(fromText) ? fromText : fromHref, node, true);
      }
    }
    if (skipTag(node)) return;
    const own = (node.children || [])
      .filter((child): child is Text => child.type === "text")
      .map((child) => child.data)
      .join(" ");
    if (!own.trim()) return;
    if (node.name === "a" && /^tel:/i.test(node.attribs?.href || "")) return;
    for (const phone of findPhoneStrings(own)) push(phone, node, false);
  });
  return hits;
}

function checkPhone(pages: FetchedPage[]): CheckResult {
  const hits = pages.flatMap(collectPhones);
  const home = hits.filter((hit) => hit.page.role === "home" && !hit.hiddenOnMobile);
  const good = home.filter((hit) => hit.tel && hit.nearTop);
  if (good.length) {
    return check({
      id: "phone",
      title: "Phone number",
      status: "pass",
      summary: `The number ${good[0].display} is near the top and can be tapped to call.`,
      quotes: [
        {
          text: good[0].display,
          pageUrl: good[0].page.url,
          pageLabel: "Homepage",
        },
      ],
    });
  }

  const hiddenHome = hits.filter((hit) => hit.page.role === "home" && hit.hiddenOnMobile);
  if (home.length === 0 && hiddenHome.length) {
    return check({
      id: "phone",
      title: "Phone number",
      status: "fail",
      summary: `The number ${hiddenHome[0].display} is on the page, but it's hidden on a phone screen.`,
      quotes: [
        {
          text: hiddenHome[0].display,
          pageUrl: hiddenHome[0].page.url,
          pageLabel: "Homepage",
        },
      ],
      impact: "People on their phones, which is most patients, won't see a number they can call.",
    });
  }

  if (hits.length === 0) {
    return check({
      id: "phone",
      title: "Phone number",
      status: "fail",
      summary: "We couldn't find a phone number on the pages we checked.",
      impact: "Patients who want to call may give up if they can't see a number straight away.",
    });
  }

  const shown = home[0] || hits[0];
  const near = home.some((hit) => hit.nearTop);
  const linked = home.some((hit) => hit.tel && hit.nearTop);
  let summary: string;
  let impact: string;
  if (!home.length) {
    summary = `We found ${shown.display}, but only away from the homepage.`;
    impact = "On a phone, people often won't hunt for the number. Put it at the top of the homepage, as a tap-to-call link.";
  } else if (!near && !home.some((hit) => hit.tel)) {
    summary = `${shown.display} isn't a tap-to-call link, and it isn't near the top of the homepage.`;
    impact = "Patients on a phone can't tap the number to call, and many won't scroll to find it.";
  } else if (!near) {
    summary = `${shown.display} isn't near the top of the homepage on a phone.`;
    impact = "People often give up before they scroll far enough to find the number.";
  } else if (!linked) {
    summary = `${shown.display} is written out, but it isn't a tap-to-call link.`;
    impact = "On a phone, people have to copy the number instead of tapping it, and a lot of them won't.";
  } else {
    summary = `${shown.display} needs to be easier to call from a phone.`;
    impact = "Patients who want to call may give up.";
  }

  return check({
    id: "phone",
    title: "Phone number",
    status: "fail",
    summary,
    quotes: [{ text: shown.display, pageUrl: shown.page.url, pageLabel: pageLabel(shown.page.role) }],
    impact,
  });
}

const CTA_TEXT =
  /\b(book(?:\s+online|\s+now|\s+an appointment)?|booking|appointments?|contact(?:\s+us)?|get in touch|call us|email us|enquir(?:e|y|ies)|make an appointment|make a booking)\b/i;
const CTA_HREF =
  /(contact|book|appoint|cliniko|janeapp|calendly|simplybook|setmore|writeupp|fresha|10to8|acuityscheduling|timely)/i;

function checkCta(pages: FetchedPage[]): CheckResult {
  const found: { text: string; inFooter: boolean; page: FetchedPage }[] = [];
  for (const page of pages) {
    if (!page.ok || page.role !== "home") continue;
    const $ = dom(page);
    $("a, button, input[type=submit]").each((_, el) => {
      const element = el as Element;
      const text = (
        element.name === "input"
          ? element.attribs?.value || ""
          : elementText(element)
      )
        .replace(/\s+/g, " ")
        .trim();
      const href = element.attribs?.href || element.attribs?.["aria-label"] || "";
      if (text.length > 80 && !CTA_HREF.test(href)) return;
      if (!CTA_TEXT.test(text) && !(CTA_HREF.test(href) && text.length > 0 && text.length <= 80)) {
        return;
      }
      found.push({ text: text || "Book", inFooter: inTag(element, ["footer"]), page });
    });
  }
  const obvious = found.filter((item) => !item.inFooter);
  if (obvious.length) {
    return check({
      id: "cta",
      title: "A clear way to get in touch",
      status: "pass",
      summary: `There's a clear “${clip(obvious[0].text, 40)}” link on the homepage.`,
      quotes: [
        {
          text: obvious[0].text,
          pageUrl: obvious[0].page.url,
          pageLabel: "Homepage",
        },
      ],
    });
  }
  if (found.length) {
    return check({
      id: "cta",
      title: "A clear way to get in touch",
      status: "warn",
      summary: "The only contact link we found is in the footer.",
      quotes: [
        {
          text: found[0].text,
          pageUrl: found[0].page.url,
          pageLabel: "Homepage",
        },
      ],
      impact: "People may not scroll that far. A booking or contact link near the top is easier to spot.",
    });
  }
  return check({
    id: "cta",
    title: "A clear way to get in touch",
    status: "fail",
    summary: "We couldn't see an obvious booking or contact button on the homepage.",
    impact: "If people can't see how to book or get in touch, they often leave and try the next clinic.",
  });
}

const TYPOS = [
  "recieve",
  "recieved",
  "seperate",
  "seperately",
  "definately",
  "occassion",
  "occassionally",
  "accomodate",
  "accomodation",
  "untill",
  "gaurantee",
  "referal",
  "refered",
  "publically",
  "independant",
  "tommorow",
  "tommorrow",
  "begining",
  "calender",
  "neccessary",
  "sucess",
  "succesful",
  "availble",
  "managment",
];

function paragraphText(page: FetchedPage): string[] {
  if (!page.ok) return [];
  const $ = dom(page);
  $("header, nav, footer, script, style, noscript, [class*=cookie], [id*=cookie], [class*=consent]").remove();
  const blocks: string[] = [];
  $("p, li").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length >= 18 && text.length >= 90) blocks.push(text);
  });
  return blocks;
}

function checkWriting(
  pages: FetchedPage[],
  typos: AnalyzeInput["typos"],
  spellingRead: AnalyzeInput["spellingRead"],
): CheckResult {
  const quotes: Quote[] = [];
  for (const page of pages) {
    const blocks = paragraphText(page);
    const seen = new Map<string, string>();
    for (const block of blocks) {
      const key = block.toLowerCase();
      if (seen.has(key)) {
        quotes.push({
          text: clip(block),
          pageUrl: page.url,
          pageLabel: pageLabel(page.role),
        });
      } else {
        seen.set(key, block);
      }
    }
    const $ = dom(page);
    $("script, style, noscript").remove();
    const text = $("body").text().replace(/\s+/g, " ");
    const doubled = text.match(
      /\b(the|a|an|and|to|of|in|for|with|your|our|is|it)\s+\1\b/i,
    );
    if (doubled) {
      const at = doubled.index ?? 0;
      quotes.push({
        text: clip(text.slice(Math.max(0, at - 40), at + 60)),
        pageUrl: page.url,
        pageLabel: pageLabel(page.role),
      });
    }
    for (const word of TYPOS) {
      const re = new RegExp(`\\b${word}\\b`, "i");
      const match = text.match(re);
      if (!match || match.index === undefined) continue;
      quotes.push({
        text: clip(text.slice(Math.max(0, match.index - 40), match.index + word.length + 40)),
        pageUrl: page.url,
        pageLabel: pageLabel(page.role),
      });
    }
  }

  if (typos) {
    const corpus = pages
      .filter((page) => page.ok)
      .map((page) => {
        const $ = dom(page);
        $("script, style, noscript").remove();
        return $("body").text().toLowerCase();
      })
      .join(" ");
    for (const typo of typos.slice(0, 5)) {
      const quote = clip(typo.quote, 180);
      if (!quote || !corpus.includes(typo.quote.toLowerCase().slice(0, 40))) continue;
      const home = pages.find((page) => page.ok);
      if (!home) continue;
      quotes.push({
        text: typo.suggestion ? `${quote} (should this be “${typo.suggestion}”?)` : quote,
        pageUrl: home.url,
        pageLabel: pageLabel(home.role),
      });
    }
  }

  const unique = dedupeQuotes(quotes);
  if (!unique.length) {
    return check({
      id: "writing",
      title: "Spelling and repeated text",
      status: "pass",
      summary:
        spellingRead === "full"
          ? "We read the pages for spelling mistakes and repeated paragraphs, and nothing stood out."
          : "We didn't find a repeated paragraph or an obvious spelling slip.",
    });
  }
  return check({
    id: "writing",
    title: "Spelling and repeated text",
    status: "fail",
    summary: "Some wording is repeated, or there's an obvious spelling slip.",
    quotes: unique,
    impact: "A repeated paragraph or a spelling slip makes the practice look less careful, and some patients will trust you less before they call.",
  });
}

const PROFESSIONS: {
  id: string;
  test: RegExp;
  name: string;
  patterns: RegExp[];
}[] = [
  {
    id: "osteopath",
    test: /\bosteopath/i,
    name: "General Osteopathic Council (GOsC)",
    patterns: [/general osteopathic council/i, /\bgosc\b/i],
  },
  {
    id: "chiropractor",
    test: /\bchiropract/i,
    name: "General Chiropractic Council (GCC)",
    patterns: [/general chiropractic council/i, /\bgcc\b/i],
  },
  {
    id: "physio",
    test: /\bphysiotherap/i,
    name: "Health and Care Professions Council (HCPC)",
    patterns: [/health and care professions council/i, /\bhcpc\b/i],
  },
  {
    id: "podiatrist",
    test: /\bpodiatr|\bchiropod/i,
    name: "Health and Care Professions Council (HCPC)",
    patterns: [/health and care professions council/i, /\bhcpc\b/i],
  },
  {
    id: "dentist",
    test: /\bdentists?\b|\bdental\b/i,
    name: "General Dental Council (GDC)",
    patterns: [/general dental council/i, /\bgdc\b/i],
  },
  {
    id: "hearing",
    test: /\bhearing aid|\baudiolog/i,
    name: "Health and Care Professions Council (HCPC)",
    patterns: [/health and care professions council/i, /\bhcpc\b/i],
  },
];

function regulatorCorpus(page: FetchedPage): { text: string; images: { src: string; alt: string }[] } {
  const $ = dom(page);
  $("script, style, noscript").remove();
  const images = $("img")
    .toArray()
    .map((el) => ({
      src: $(el).attr("src") || "",
      alt: $(el).attr("alt") || "",
    }));
  return { text: $("body").text().replace(/\s+/g, " "), images };
}

function checkRegulator(pages: FetchedPage[]): CheckResult {
  const okPages = pages.filter((page) => page.ok);
  const blobs = okPages.map((page) => ({ page, ...regulatorCorpus(page) }));
  const allText = blobs.map((blob) => blob.text).join(" ");
  const identity = okPages
    .map((page) => {
      const $ = dom(page);
      return [
        $("title").text(),
        $('meta[name="description"]').attr("content") || "",
        $("h1").text(),
        $("header, nav").text(),
      ].join(" ");
    })
    .join(" ");
  let detected = PROFESSIONS.filter((profession) => profession.test.test(identity));
  if (detected.length === 0) {
    const ranked = PROFESSIONS.map((profession) => ({
      profession,
      count: allText.match(new RegExp(profession.test.source, "gi"))?.length ?? 0,
    }))
      .filter((item) => item.count > 0)
      .sort((a, b) => b.count - a.count);
    const top = ranked[0]?.count ?? 0;
    detected = ranked.filter((item) => item.count === top).map((item) => item.profession);
  }
  const unique = new Map<string, (typeof PROFESSIONS)[number]>();
  for (const profession of detected) unique.set(profession.name, profession);
  const needed = [...unique.values()];
  if (needed.length === 0) {
    return check({
      id: "regulator",
      title: "Professional register",
      status: "na",
      summary:
        "These pages don't read as a dentist, physio, osteopath, chiropractor, podiatrist or hearing service, so this wasn't scored.",
    });
  }

  const missing: string[] = [];
  const quotes: Quote[] = [];
  let imageOnly = false;
  for (const profession of needed) {
    let mentionedInText = false;
    let mentionedInImage = false;
    for (const blob of blobs) {
      if (profession.patterns.some((pattern) => pattern.test(blob.text))) {
        mentionedInText = true;
        const pattern = profession.patterns.find((item) => item.test(blob.text));
        const match = pattern ? blob.text.match(pattern) : null;
        if (match && match.index !== undefined) {
          const start = Math.max(0, match.index - 80);
          const sentence = blob.text.lastIndexOf(". ", match.index);
          const from = sentence >= start ? sentence + 2 : Math.max(0, match.index - 20);
          quotes.push({
            text: clip(blob.text.slice(from, match.index + match[0].length + 70)),
            pageUrl: blob.page.url,
            pageLabel: pageLabel(blob.page.role),
          });
        }
      }
      for (const image of blob.images) {
        const haystack = `${image.src} ${image.alt}`;
        if (!profession.patterns.some((pattern) => pattern.test(haystack))) continue;
        mentionedInImage = true;
        const alt = image.alt.trim();
        const generic = !alt || /^(alt|image|logo|footer|icon)$/i.test(alt);
        const file = image.src.split("/").pop() || image.src;
        if (!mentionedInText) {
          quotes.push({
            text: generic
              ? `A logo file named “${file}”. The alt text is “${alt || "empty"}”, so the register name isn't written out.`
              : alt,
            pageUrl: blob.page.url,
            pageLabel: pageLabel(blob.page.role),
          });
        }
      }
    }
    if (!mentionedInText && !mentionedInImage) missing.push(profession.name);
    if (!mentionedInText && mentionedInImage) imageOnly = true;
  }

  if (missing.length) {
    return check({
      id: "regulator",
      title: "Professional register",
      status: "fail",
      summary: `We couldn't find a mention of the ${missing.join(" or ")}.`,
      impact:
        "Patients look for proof you're registered. Without the register's name, some people won't be sure the clinic is legitimate.",
    });
  }
  if (imageOnly) {
    return check({
      id: "regulator",
      title: "Professional register",
      status: "warn",
      summary: `The ${needed[0].name} only shows up as a logo, not as words.`,
      quotes: dedupeQuotes(quotes),
      impact:
        "Someone who can't see the logo, and Google, can't read the register name. Write it out in text as well.",
    });
  }
  return check({
    id: "regulator",
    title: "Professional register",
    status: "pass",
    summary: `The pages mention the ${needed.map((item) => item.name).join(" and ")}.`,
    quotes: dedupeQuotes(quotes).slice(0, 1),
  });
}

function checkHttps(pages: FetchedPage[], ssl: SslReport): CheckResult {
  const home = pages.find((page) => page.role === "home");
  const finalUrl = home?.url || "";
  let secureUrl = false;
  try {
    secureUrl = new URL(finalUrl).protocol === "https:";
  } catch {
    secureUrl = false;
  }
  if (!secureUrl) {
    return check({
      id: "https",
      title: "Secure connection",
      status: "fail",
      summary: "This site still uses http, so the connection isn't secure.",
      quotes: finalUrl ? [{ text: finalUrl, pageUrl: finalUrl, pageLabel: "Homepage" }] : [],
      impact: "Browsers warn people about sites without a secure connection. Many will leave before they read a word.",
    });
  }
  if (!ssl.certificateValid) {
    return check({
      id: "https",
      title: "Secure connection",
      status: "fail",
      summary: ssl.error || "The security certificate isn't valid.",
      impact: "Browsers warn people about sites without a valid secure connection. Many will leave before they read a word.",
    });
  }
  const until = ssl.validTo ? formatDate(new Date(ssl.validTo)) : "";
  if (ssl.mixedContent.length) {
    return check({
      id: "https",
      title: "Secure connection",
      status: "warn",
      summary: `The site is secure${until ? ` until ${until}` : ""}, but some pieces still load over http (${ssl.mixedContent.join(", ")}).`,
      impact: "Some phones block those pieces, so a logo, font or map may not appear.",
    });
  }
  return check({
    id: "https",
    title: "Secure connection",
    status: "pass",
    summary: until
      ? `The site uses a secure connection. The certificate is valid until ${until}.`
      : "The site uses a secure connection and the certificate is valid.",
  });
}

function checkMobile(pages: FetchedPage[], cssHasMedia: boolean | null): CheckResult {
  const home = pages.find((page) => page.role === "home" && page.ok);
  if (!home) {
    return check({
      id: "mobile",
      title: "Works on a phone",
      status: "fail",
      summary: "We couldn't read the homepage, so we couldn't check the phone layout.",
      impact: "On a phone, a desktop-only page is tiny and fiddly. Most patients will leave.",
    });
  }
  const $ = dom(home);
  const content = ($('meta[name="viewport"]').attr("content") || "").toLowerCase();
  if (!content) {
    return check({
      id: "mobile",
      title: "Works on a phone",
      status: "fail",
      summary: "There's no instruction telling phones to fit the page to the screen.",
      impact: "On a phone, the text will be tiny and people will have to pinch and scroll sideways. Most patients will leave.",
    });
  }
  const width = content.match(/width\s*=\s*([^,]+)/)?.[1]?.trim() || "";
  if (width !== "device-width") {
    return check({
      id: "mobile",
      title: "Works on a phone",
      status: "fail",
      summary: `The phone sizing instruction says “${clip(content, 80)}”, which doesn't fit the screen width.`,
      quotes: [{ text: content, pageUrl: home.url, pageLabel: "Homepage" }],
      impact: "On a phone, the text will be tiny and people will have to pinch and scroll sideways. Most patients will leave.",
    });
  }
  const locksZoom = /user-scalable\s*=\s*(no|0)/.test(content) || /maximum-scale\s*=\s*(0|1)(?:\.0+)?(?:\s|,|$)/.test(content);
  if (locksZoom) {
    return check({
      id: "mobile",
      title: "Works on a phone",
      status: "warn",
      summary: "The page fits a phone screen, but people can't pinch to zoom.",
      quotes: [{ text: content, pageUrl: home.url, pageLabel: "Homepage" }],
      impact: "Anyone who needs larger text will struggle to read the page.",
    });
  }
  if (cssHasMedia === false) {
    return check({
      id: "mobile",
      title: "Works on a phone",
      status: "warn",
      summary: "The page tells phones how wide the screen is, but the layout we read has no phone-sized rules.",
      impact: "The site may still look like a desktop page squeezed onto a phone.",
    });
  }
  return check({
    id: "mobile",
    title: "Works on a phone",
    status: "pass",
    summary: "The page tells phones to fit the layout to the screen.",
  });
}

const GENERIC_TITLE = /^(home|homepage|welcome|untitled|new page|document|website|index)$/i;
const GENERIC_DESC =
  /^(website description|description|meta description|your description here|todo|add a description|some, site, keywords.*)$/i;

function checkMeta(pages: FetchedPage[]): CheckResult {
  const home = pages.find((page) => page.role === "home" && page.ok);
  if (!home) {
    return check({
      id: "meta",
      title: "Google title and description",
      status: "fail",
      summary: "We couldn't read the homepage title.",
      impact: "Google shows this title and description when someone searches for the clinic. A weak one means fewer people click through.",
    });
  }
  const $ = dom(home);
  const title = $("title").first().text().replace(/\s+/g, " ").trim();
  const description = ($('meta[name="description"]').attr("content") || "").replace(/\s+/g, " ").trim();
  const quotes: Quote[] = [];
  if (title) quotes.push({ text: `Title: ${title}`, pageUrl: home.url, pageLabel: "Homepage" });
  if (description) {
    quotes.push({ text: `Description: ${description}`, pageUrl: home.url, pageLabel: "Homepage" });
  }

  const titlePoor = !title || title.length < 12 || GENERIC_TITLE.test(title);
  const descMissing = !description;
  const descPlaceholder = GENERIC_DESC.test(description) || description.length < 40;
  const descSame = title && description && title.toLowerCase() === description.toLowerCase();
  const titleLong = title.length > 65;
  const descLong = description.length > 175;

  if (titlePoor || descMissing || descPlaceholder || descSame) {
    const bits: string[] = [];
    if (titlePoor) bits.push(title ? `the title “${clip(title, 80)}” doesn't say what the clinic is` : "the page has no title");
    if (descMissing) bits.push("there's no description for Google");
    else if (descPlaceholder || descSame) bits.push(`the description “${clip(description, 80)}” doesn't describe the clinic`);
    return check({
      id: "meta",
      title: "Google title and description",
      status: "fail",
      summary: `When someone searches, ${bits.join(", and ")}.`,
      quotes,
      impact: "Google shows this title and description in search results. A weak one means fewer people click through to the clinic.",
    });
  }
  if (titleLong || descLong) {
    return check({
      id: "meta",
      title: "Google title and description",
      status: "warn",
      summary: titleLong
        ? "The title is a bit long, so Google may cut it off."
        : "The description is a bit long, so Google may cut it off.",
      quotes,
      impact: "The cut-off line is what people see in search, so the important words should come first.",
    });
  }
  return check({
    id: "meta",
    title: "Google title and description",
    status: "pass",
    summary: "The title and description are in place and look specific to the clinic.",
    quotes,
  });
}

export function scoreChecks(checks: CheckResult[]): { score: number; note?: string } {
  const counted = checks.filter((item) => item.status !== "na");
  const points = counted.reduce((sum, item) => {
    if (item.status === "pass") return sum + 10;
    if (item.status === "warn") return sum + 5;
    return sum;
  }, 0);
  const max = counted.length * 10;
  const score = max === 0 ? 0 : Math.round((points / max) * 100);
  const skipped = checks.length - counted.length;
  let note: string | undefined;
  if (skipped === 1) {
    note = `One check didn't apply to this site, so the score uses the other ${counted.length}.`;
  } else if (skipped > 1) {
    note = `${skipped} checks didn't apply, so the score uses the other ${counted.length}.`;
  }
  return { score, note };
}

export function verdictFor(score: number): string {
  if (score >= 85) {
    return "This site is in good shape. The list below is the small stuff I'd still tidy.";
  }
  if (score >= 70) {
    return "Patients can use this site. A few things below may still be putting people off.";
  }
  if (score >= 45) {
    return "Several things on this site are getting in the way of new patients.";
  }
  return "This site is likely losing enquiries. I'd fix the items marked Fix first.";
}

export function analyzeSite(input: AnalyzeInput): {
  checks: CheckResult[];
  score: number;
  verdict: string;
  scoreNote?: string;
} {
  const now = input.now ?? new Date();
  const checks = [
    checkOutdated(input.pages, now),
    checkMaps(input.pages, input.mapProbes),
    checkCode(input.pages),
    checkPhone(input.pages),
    checkCta(input.pages),
    checkWriting(input.pages, input.typos, input.spellingRead),
    checkRegulator(input.pages),
    checkHttps(input.pages, input.ssl),
    checkMobile(input.pages, input.cssHasMedia),
    checkMeta(input.pages),
  ];
  const { score, note } = scoreChecks(checks);
  return { checks, score, verdict: verdictFor(score), scoreNote: note };
}

export function homepageHints(html: string, pageUrl: string): {
  inlineMedia: boolean;
  stylesheets: string[];
} {
  const $ = load(html);
  let inlineMedia = false;
  $("style").each((_, el) => {
    if (/@media/i.test($(el).text())) inlineMedia = true;
  });
  const stylesheets: string[] = [];
  $("link[rel='stylesheet']").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    try {
      stylesheets.push(new URL(href, pageUrl).toString());
    } catch {
      return;
    }
  });
  return { inlineMedia, stylesheets: stylesheets.slice(0, 2) };
}

export function hostKey(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

export function classifyLink(text: string, href: string): PageRole | null {
  const blob = `${text} ${href}`.toLowerCase();
  if (/covid|coronavirus/.test(blob)) return "covid";
  if (/\b(fees?|prices?|pricing|our-fees|costs?)\b/.test(blob)) return "fees";
  if (/\b(contact|get-in-touch|find-us)\b/.test(blob)) return "contact";
  if (/\b(about|our-team|meet-the|the-team|who-we-are)\b/.test(blob)) return "about";
  if (/\b(blog|news|articles?)\b/.test(blob) && !/newsletter/.test(blob)) return "blog";
  return null;
}
