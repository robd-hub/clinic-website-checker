"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { LeadForm } from "@/components/lead-form";
import { ReportView } from "@/components/report";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Report } from "@/lib/types";
import { checkLinkPath, runnableQueryUrl } from "@/lib/url";

const STEPS = [
  "Opening the homepage",
  "Reading contact, about and fees",
  "Looking for anything out of date",
  "Writing your checklist",
];

const LOOKS_FOR = [
  "Old COVID notices, past closure dates, a tired copyright year, or news that stopped years ago",
  "A map that shows an error instead of the clinic",
  "Template code left visible, such as [form id=\"1\"]",
  "A phone number people can tap, near the top on a phone",
  "An obvious way to book or get in touch",
  "Repeated paragraphs and obvious spelling slips",
  "The UK register for the profession, where it fits",
  "A secure connection",
  "A layout that fits a phone screen",
  "The title and description Google shows",
];

declare global {
  interface Window {
    __nativeReplaceState?: History["replaceState"];
  }
}

function rememberCheckInAddressBar(value: string) {
  const current = new URL(window.location.href);
  if (current.pathname === "/" && current.searchParams.get("url")?.trim() === value) return;
  const replace = window.__nativeReplaceState ?? window.history.replaceState.bind(window.history);
  replace(window.history.state, "", checkLinkPath(value));
}

type CheckPayload = (Report & { error?: string }) | null;

const inflightChecks = new Map<string, Promise<{ ok: boolean; data: CheckPayload }>>();

function requestCheck(url: string): Promise<{ ok: boolean; data: CheckPayload }> {
  const existing = inflightChecks.get(url);
  if (existing) return existing;
  const promise = fetch("/api/check", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  })
    .then(async (response) => {
      const data = (await response.json().catch(() => null)) as CheckPayload;
      return { ok: response.ok, data };
    })
    .finally(() => {
      if (inflightChecks.get(url) === promise) inflightChecks.delete(url);
    });
  inflightChecks.set(url, promise);
  return promise;
}

export function Checker({
  initialUrl = "",
  shell = false,
}: {
  initialUrl?: string;
  shell?: boolean;
}) {
  const startingUrl = runnableQueryUrl(initialUrl) ?? "";
  const [url, setUrl] = useState(startingUrl);
  const [shareUrl, setShareUrl] = useState(startingUrl);
  const [phase, setPhase] = useState<"idle" | "loading" | "error" | "done">(
    startingUrl ? "loading" : "idle",
  );
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const autoRan = useRef<string | null>(null);
  const requestSeq = useRef(0);

  const runCheck = useCallback(async (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      setPhase("error");
      setError("Paste the clinic website address first.");
      return;
    }
    const seq = ++requestSeq.current;
    autoRan.current = trimmed;
    setUrl(trimmed);
    setShareUrl(trimmed);
    setStep(0);
    setPhase("loading");
    setError("");
    setReport(null);
    rememberCheckInAddressBar(trimmed);
    try {
      const { ok, data } = await requestCheck(trimmed);
      if (requestSeq.current !== seq) return;
      if (!ok || !data || typeof data.score !== "number") {
        setPhase("error");
        setError(data?.error || "We couldn't check that site. Try again in a moment.");
        return;
      }
      setReport(data);
      setPhase("done");
    } catch {
      if (requestSeq.current !== seq) return;
      setPhase("error");
      setError("We couldn't check that site. Try again in a moment.");
    }
  }, []);

  useEffect(() => {
    if (shell) return;
    document.documentElement.removeAttribute("data-autocheck");
  }, [shell]);

  useEffect(() => {
    const next = runnableQueryUrl(initialUrl);
    if (!next || autoRan.current === next) return;
    // Set before the request so Strict Mode's second effect pass does not start another check.
    autoRan.current = next;
    void runCheck(next);
  }, [initialUrl, runCheck]);

  useEffect(() => {
    if (phase !== "loading") return;
    const timer = window.setInterval(() => {
      setStep((current) => Math.min(current + 1, STEPS.length - 1));
    }, 3500);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (phase === "done") {
      document.getElementById("result")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [phase, report]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runCheck(url);
  }

  return (
    <div>
      <section className="hero-glow border-b border-border">
        <div className="mx-auto max-w-3xl px-5 pb-14 pt-12 sm:pb-16 sm:pt-16">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-gold">
            Free clinic website check
          </p>
          <h1 className="mt-4 max-w-xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            See what&apos;s putting patients off your website.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
            Paste your address. In about 20 seconds you&apos;ll get a score out of 100 and a plain
            list of what to fix.
          </p>

          <form onSubmit={onSubmit} className="mt-8">
            <Label htmlFor="clinic-url" className="sr-only">
              Clinic website
            </Label>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Input
                id="clinic-url"
                name="url"
                type="text"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="https://www.yourclinic.co.uk"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                disabled={phase === "loading"}
                suppressHydrationWarning
                className="h-12 rounded-full px-5 text-base md:text-base"
                aria-describedby="url-help"
              />
              <Button
                id="check-submit"
                type="submit"
                disabled={phase === "loading"}
                className="h-12 rounded-full px-6 text-base"
              >
                <span className="check-submit-label inline-flex items-center gap-1">
                  {phase === "loading" ? "Checking…" : "Check my site"}
                  {phase === "loading" ? null : <span aria-hidden="true">→</span>}
                </span>
                <span className="check-submit-busy hidden" aria-hidden="true">
                  Checking…
                </span>
              </Button>
            </div>
            <p id="url-help" className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
              For independent UK clinics: dentists, physios, osteopaths, podiatrists, chiropractors
              and hearing services. We only read the public pages.
            </p>
          </form>

          <ol
            id="check-steps"
            className={phase === "loading" ? "mt-6 space-y-2" : "mt-6 hidden space-y-2"}
            aria-live="polite"
          >
            {STEPS.map((item, index) => (
              <li
                key={item}
                className={index <= step ? "text-sm text-foreground" : "text-sm text-muted-foreground"}
              >
                <span className="mr-2 text-gold">{index < step ? "✓" : index === step ? "…" : "·"}</span>
                {item}
              </li>
            ))}
          </ol>

          {phase === "error" ? (
            <p className="mt-6 rounded-2xl border border-bad/40 bg-bad/10 px-4 py-3 text-sm leading-relaxed text-foreground" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </section>

      <div className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
        {report ? (
          <>
            <ReportView report={report} linkValue={shareUrl} />
            <LeadForm report={report} />
          </>
        ) : phase === "loading" ? null : (
          <section id="check-overview">
            <h2 className="text-2xl font-semibold tracking-tight">What the check looks at</h2>
            <p className="mt-3 max-w-xl text-base leading-relaxed text-muted-foreground">
              Ten things that make a clinic site feel closed, hard to call, or out of date. Each one
              that needs work includes what we found, and why it matters to patients.
            </p>
            <ol className="mt-6 grid gap-3 sm:grid-cols-2">
              {LOOKS_FOR.map((item, index) => (
                <li key={item} className="rounded-2xl border border-border bg-card px-4 py-4 text-sm leading-relaxed">
                  <span className="mb-1 block text-xs font-semibold text-gold">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  {item}
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </div>
  );
}
