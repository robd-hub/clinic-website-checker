"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Report } from "@/lib/types";

export function LeadForm({ report }: { report: Report }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const company = String(new FormData(event.currentTarget).get("company") || "");
    setStatus("sending");
    setMessage("");
    try {
      const response = await fetch("/api/lead", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          url: report.finalUrl,
          score: report.score,
          verdict: report.verdict,
          findings: report.checks,
          pages: report.pages.map((page) => page.url),
          company,
        }),
      });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setStatus("error");
        setMessage(data?.error || "We couldn't save that. Email rob@designimp.com instead.");
        return;
      }
      setStatus("sent");
    } catch {
      setStatus("error");
      setMessage("We couldn't save that. Email rob@designimp.com and mention the website.");
    }
  }

  return (
    <section id="before-after" className="mt-10 rounded-3xl border border-gold/30 bg-card p-5 sm:p-7">
      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-gold">Free, and just for you</p>
      <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
        Get a free before-and-after of your homepage
      </h2>
      <p className="mt-3 max-w-xl text-base leading-relaxed text-muted-foreground">
        Send your name and email. Rob will redraw the homepage from your own photos and words, and
        send both versions so you can see the difference. No call, and no obligation.
      </p>

      {status === "sent" ? (
        <p className="mt-6 rounded-2xl border border-good/30 bg-good/10 px-4 py-4 text-base leading-relaxed text-foreground" role="status">
          Thanks, {name.trim().split(/\s+/)[0]}. Rob has {report.hostname} and the score, and will
          send the before-and-after to {email}.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="lead-name">Your name</Label>
            <Input
              id="lead-name"
              name="name"
              autoComplete="name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="h-12 rounded-full px-4 text-base md:text-base"
              placeholder="Alex Patel"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="lead-email">Email</Label>
            <Input
              id="lead-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="h-12 rounded-full px-4 text-base md:text-base"
              placeholder="you@clinic.co.uk"
            />
          </div>
          <div className="hidden" aria-hidden="true">
            <label htmlFor="company">Company</label>
            <input id="company" name="company" tabIndex={-1} autoComplete="off" />
          </div>
          <div className="sm:col-span-2">
            <Button
              type="submit"
              disabled={status === "sending"}
              className="h-12 w-full rounded-full bg-gold px-6 text-base text-[#1a1408] hover:bg-gold-deep sm:w-auto"
            >
              {status === "sending" ? "Sending…" : "Send me the before-and-after"}
              <span aria-hidden="true">→</span>
            </Button>
            <p className="mt-3 text-sm text-muted-foreground">
              We&apos;ll use your email only to send the before-and-after.{" "}
              <a href="/privacy" className="underline underline-offset-4 hover:text-foreground">
                Privacy
              </a>
            </p>
            {status === "error" ? (
              <p className="mt-3 text-sm text-bad" role="alert">
                {message}
              </p>
            ) : null}
          </div>
        </form>
      )}
    </section>
  );
}
