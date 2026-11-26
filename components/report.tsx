import { memo, useEffect, useState } from "react";

import type { CheckResult, CheckStatus, Report } from "@/lib/types";
import { checkLinkPath } from "@/lib/url";

function tone(status: CheckStatus): string {
  if (status === "pass") return "border-good/40 text-good";
  if (status === "fail") return "border-bad/50 text-bad";
  if (status === "warn") return "border-gold/50 text-gold-deep";
  return "border-border text-muted-foreground";
}

function label(status: CheckStatus): string {
  if (status === "pass") return "Fine";
  if (status === "fail") return "Fix";
  if (status === "warn") return "Tidy";
  return "Skipped";
}

function ringColor(score: number): string {
  if (score >= 80) return "#8fcead";
  if (score >= 50) return "#c8973a";
  return "#f0a08a";
}

function ScoreRing({ score }: { score: number }) {
  const radius = 52;
  const circ = 2 * Math.PI * radius;
  const offset = circ - (Math.max(0, Math.min(100, score)) / 100) * circ;
  return (
    <div className="relative size-32 shrink-0 sm:size-36" aria-hidden="true">
      <svg viewBox="0 0 120 120" className="size-full -rotate-90">
        <circle cx="60" cy="60" r={radius} fill="none" stroke="#2a2a2e" strokeWidth="8" />
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke={ringColor(score)}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-semibold tracking-tight text-foreground">{score}</span>
        <span className="text-xs text-muted-foreground">out of 100</span>
      </div>
    </div>
  );
}

function CheckRow({ item }: { item: CheckResult }) {
  const open = item.status === "fail" || item.status === "warn";
  const body = (
    <div className="flex items-start gap-3">
      <span
        className={`mt-0.5 inline-flex shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold ${tone(item.status)}`}
      >
        {label(item.status)}
      </span>
      <span>
        <span className="block font-medium text-foreground">{item.title}</span>
        <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">{item.summary}</span>
      </span>
    </div>
  );

  if (!item.impact && item.quotes.length === 0) {
    return <li className="border-b border-border px-4 py-4 last:border-b-0 sm:px-5">{body}</li>;
  }

  return (
    <li className="border-b border-border last:border-b-0">
      <details open={open} className="group">
        <summary className="cursor-pointer list-none px-4 py-4 sm:px-5 [&::-webkit-details-marker]:hidden">
          {body}
        </summary>
        <div className="space-y-3 px-4 pb-5 sm:px-5 sm:pl-16">
          {item.quotes.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                What we found
              </p>
              {item.quotes.map((quote) => (
                <blockquote
                  key={`${quote.pageUrl}-${quote.text}`}
                  className="border-l-2 border-gold/70 pl-3 text-sm leading-relaxed text-foreground"
                >
                  <p>“{quote.text}”</p>
                  <footer className="mt-1 text-xs text-muted-foreground">{quote.pageLabel}</footer>
                </blockquote>
              ))}
            </div>
          ) : null}
          {item.impact ? (
            <p className="text-sm leading-relaxed text-foreground">
              <span className="font-medium">Why it matters. </span>
              {item.impact}
            </p>
          ) : null}
        </div>
      </details>
    </li>
  );
}

function CopyCheckLink({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function onCopy() {
    const link = `${window.location.origin}${checkLinkPath(value)}`;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      const field = document.createElement("textarea");
      field.value = link;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.left = "-9999px";
      document.body.append(field);
      field.select();
      const copiedOk = document.execCommand("copy");
      field.remove();
      if (!copiedOk) return;
    }
    setCopied(true);
  }

  return (
    <button
      type="button"
      onClick={() => void onCopy()}
      className="mt-4 rounded-sm text-left text-sm text-muted-foreground underline decoration-border underline-offset-4 transition-colors hover:text-foreground hover:decoration-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
    >
      {copied ? "Link copied" : "Copy link to this check"}
    </button>
  );
}

export const ReportView = memo(function ReportView({
  report,
  linkValue,
}: {
  report: Report;
  linkValue: string;
}) {
  return (
    <section id="result" className="scroll-mt-6" aria-live="polite">
      <div className="rounded-3xl border border-border bg-card p-5 sm:p-7">
        <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
          <ScoreRing score={report.score} />
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-gold">
              {report.hostname}
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              {report.score} out of 100
            </h2>
            <p className="mt-3 max-w-xl text-base leading-relaxed text-muted-foreground">
              {report.verdict}
            </p>
            {report.scoreNote ? (
              <p className="mt-2 text-sm text-muted-foreground">{report.scoreNote}</p>
            ) : null}
            {linkValue ? <CopyCheckLink value={linkValue} /> : null}
          </div>
        </div>
        {report.pages.length > 0 ? (
          <p className="mt-6 text-sm text-muted-foreground">
            Pages we read:{" "}
            {report.pages.map((page, index) => (
              <span key={page.url}>
                {index > 0 ? ", " : null}
                <a
                  href={page.url}
                  className="text-foreground underline decoration-border underline-offset-4 hover:decoration-gold"
                >
                  {page.label}
                </a>
              </span>
            ))}
            .
          </p>
        ) : null}
      </div>

      <h3 className="mt-8 text-lg font-semibold">The checklist</h3>
      <ol className="mt-3 overflow-hidden rounded-3xl border border-border bg-card">
        {report.checks.map((item) => (
          <CheckRow key={item.id} item={item} />
        ))}
      </ol>
      <p className="mt-3 text-sm text-muted-foreground">
        This is an automatic read of the public pages, not a full review.
      </p>
    </section>
  );
});
