import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What the clinic website check stores when you ask for a before-and-after.",
};

export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-3xl px-5 py-14">
      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-gold">Privacy</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">What we keep</h1>
      <div className="mt-6 space-y-4 text-base leading-relaxed text-muted-foreground">
        <p>
          The check itself reads the public pages of the address you paste. It does not log in,
          fill in forms, or change anything on the site.
        </p>
        <p>
          If you ask for a before-and-after, we store your name, email, the website address, the
          score and the checklist, with the time you sent it. Rob Doughty at Design Imp uses that
          only to send the before-and-after. It is not added to a newsletter.
        </p>
        <p>
          To ask for a copy or for it to be deleted, email{" "}
          <a className="text-foreground underline underline-offset-4" href="mailto:rob@designimp.com">
            rob@designimp.com
          </a>
          .
        </p>
      </div>
    </article>
  );
}
