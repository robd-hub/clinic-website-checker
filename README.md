# Clinic Website Checker

A free check for owners of small independent UK clinics. Paste a website address and, in about 20 seconds, get a score out of 100 and a plain-English checklist.

It is built for [Design Imp](https://designimp.com), and it is meant to live at a subdomain such as `check.designimp.com`, next to the existing site.

Dentists, physios, osteopaths, podiatrists and chiropodists, chiropractors, and hearing services are the audience. There is no pricing on the site.

## Run it locally

You need Node.js 20 or newer.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://127.0.0.1:4317](http://127.0.0.1:4317).

```bash
npm test
npm run lint
```

## What it checks

The homepage is always read. Contact, About, Fees, a coronavirus page, and the blog are read too when those links are on the homepage (up to four extra pages).

| Check | What “needs work” means |
| --- | --- |
| Up to date | A COVID or coronavirus notice, a closure or annual-leave notice with a past date, a copyright year more than a year behind, or a newest dated blog post more than two years old |
| Map | A Google Maps (or similar) embed whose frame contains an error such as “Oops! Something went wrong” |
| Stray code | Visible template code such as `[contact-form-7 id="12"]` |
| Phone number | No UK phone number, the number is not a `tel:` link, or it is not near the top of the homepage on a phone |
| A clear way to get in touch | No obvious booking or contact link on the homepage |
| Spelling and repeated text | A repeated paragraph, a doubled word, or an obvious spelling slip |
| Professional register | For a detected profession, no mention of GOsC, GCC, HCPC, or GDC. A logo with no written name is marked as worth tidying, not a full pass |
| Secure connection | The site is not on HTTPS, or the certificate is not valid. Old `http` images, fonts, or scripts are marked as worth tidying |
| Works on a phone | No viewport tag that sets `width=device-width` |
| Google title and description | The homepage title or meta description is missing, generic, or a placeholder |

Each failed item quotes the text that was found, where it can, and adds one sentence on why it matters to patients.

A check that does not apply (no map, or no recognised profession) is skipped and the score is scaled from the rest.

### What it cannot see

- Words that only exist inside a picture.
- Map errors that appear only after Google’s JavaScript runs, unless that error text is in the frame’s HTML. A map can pass here and still be broken in a browser.
- A full proofread, unless `CHECKER_LLM_API_KEY` is set. Without it, the checker looks for repeated paragraphs, doubled small words, and a short list of obvious misspellings.
- Pages behind a login, or text that is only drawn by JavaScript after the page loads.

The checker only requests public `http` and `https` pages. It refuses local, private, and link-local addresses.

## Environment variables

Copy `.env.example` to `.env.local`. Everything is optional. The checker runs with none of them set.

| Variable | Purpose |
| --- | --- |
| `CHECKER_LLM_API_KEY` | Turns on a closer spelling read. Any OpenAI-compatible chat completions API. If the key is missing, or the request fails, the lighter spelling check is used and the rest of the result still comes back. |
| `CHECKER_LLM_BASE_URL` | Defaults to `https://api.openai.com/v1`. |
| `CHECKER_LLM_MODEL` | Defaults to `gpt-4o-mini`. |
| `LEADS_WEBHOOK_URL` | POST each before-and-after enquiry here as JSON. Use this on Vercel. |
| `BLOB_READ_WRITE_TOKEN` | If you connect a Vercel Blob store, enquiries are also saved as private JSON files under `leads/`. |

## Where enquiries go

The results page asks for a name and email: “Get a free before-and-after of your homepage”. Each submission stores the website, score, checklist, name, email, and time.

The app tries three places, and uses every one that is configured:

1. **A file, `data/leads.ndjson`.** One JSON object per line. This is what you get from `npm run dev` on your own machine. The folder is gitignored. Vercel’s filesystem does not keep this file between requests, so do not rely on it in production.
2. **`LEADS_WEBHOOK_URL`.** A POST of the same JSON. This is the production option, and it is also how you send enquiries to a Google Sheet (below).
3. **Vercel Blob**, when `BLOB_READ_WRITE_TOKEN` is set. Files are private (`leads/<id>.json`). In the Vercel project, open Storage, create a Blob store, and connect it to the project. Vercel fills in the token.

If none of those succeed, the enquiry is written to the server log (on Vercel: the project’s Logs). Set a webhook before you rely on the form.

The JSON looks like this:

```json
{
  "id": "…",
  "createdAt": "2026-11-25T16:00:00.000Z",
  "name": "Alex Patel",
  "email": "alex@clinic.co.uk",
  "url": "https://www.example-clinic.co.uk/",
  "score": 72,
  "verdict": "…",
  "findings": [],
  "pages": []
}
```

### Send them to a Google Sheet

1. Create a sheet with a header row: `When`, `Name`, `Email`, `Website`, `Score`, `Verdict`, `Findings`.
2. In the sheet, Extensions → Apps Script, and paste:

```javascript
function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  var data = JSON.parse(e.postData.contents);
  var findings = (data.findings || [])
    .filter(function (item) { return item.status === "fail" || item.status === "warn"; })
    .map(function (item) { return item.title + ": " + item.summary; })
    .join("\n");
  sheet.appendRow([
    data.createdAt,
    data.name,
    data.email,
    data.url,
    data.score,
    data.verdict,
    findings,
  ]);
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

3. Deploy → New deployment → type **Web app**. Run as yourself, and set access to **Anyone**. Copy the web app URL.
4. In Vercel (or `.env.local`), set `LEADS_WEBHOOK_URL` to that URL and redeploy.

The same URL works with Make, Zapier, or any other service that accepts a JSON POST. To stop sending, clear the variable.

## Deploy on Vercel

The app is a Next.js project. The check route allows up to 60 seconds (`maxDuration` and `vercel.json`). A normal check finishes well inside 20 seconds. `vercel.json` also asks for the London region (`lhr1`) so UK clinic sites answer faster.

1. Push this repository to GitHub, or import the project another way.
2. In Vercel, **Add New Project** and select the repository. Framework preset: Next.js. Leave the build command as `next build` and the output as the default.
3. Add `LEADS_WEBHOOK_URL` (and the spelling key, if you want it) under Settings → Environment Variables.
4. Deploy.

Or from the Vercel CLI, in this folder:

```bash
npx vercel
npx vercel --prod
```

## Point check.designimp.com at it

`check.designimp.com` is a subdomain, so it wants a CNAME, not a change to the main domain.

1. In the Vercel project, go to **Settings → Domains** and add `check.designimp.com`.
2. Vercel will show the DNS record. At the DNS host for `designimp.com` (the same place `grader.designimp.com` is managed), add:

| Type | Name | Value |
| --- | --- | --- |
| CNAME | `check` | `cname.vercel-dns.com` |

3. If the DNS host asks for a full name, use `check.designimp.com`. Leave the main domain’s records alone.
4. Wait for Vercel to mark the domain as valid and to issue the certificate. That is usually a few minutes, and occasionally a few hours.
5. Open `https://check.designimp.com` and run a check.

If the domain was added in Vercel but the CNAME still points elsewhere, Vercel’s domain screen shows the exact record it is waiting for. Use that value if it differs from `cname.vercel-dns.com`.

Do not turn on a proxy (such as Cloudflare’s orange cloud) until the certificate is issued, or the check can fail. DNS-only is the straightforward setup.
