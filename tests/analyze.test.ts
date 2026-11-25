import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { analyzeSite } from "../lib/analyze";
import { findPhoneStrings } from "../lib/phones";
import type { FetchedPage, SslReport } from "../lib/types";

const NOW = new Date("2026-11-25T12:00:00Z");

const SSL_OK: SslReport = {
  secure: true,
  certificateValid: true,
  validTo: "2027-08-12T00:00:00.000Z",
  mixedContent: [],
};

function page(partial: Partial<FetchedPage> & Pick<FetchedPage, "html" | "role">): FetchedPage {
  return {
    url: partial.url ?? `https://example.test/${partial.role === "home" ? "" : partial.role}`,
    status: 200,
    ok: true,
    ...partial,
  };
}

function byId(result: ReturnType<typeof analyzeSite>, id: string) {
  const check = result.checks.find((item) => item.id === id);
  assert.ok(check, `missing check ${id}`);
  return check;
}

describe("phone numbers", () => {
  it("reads spaced UK numbers without gluing on a second copy", () => {
    assert.deepEqual(findPhoneStrings("Telephone: 01422 25 26 25"), ["01422 25 26 25"]);
    assert.deepEqual(findPhoneStrings("Call 01543 462928 (01543462928)"), ["01543 462928"]);
    assert.deepEqual(findPhoneStrings("Ring +44 1422 252625 today"), ["+44 1422 252625"]);
  });
});

describe("clinic checks", () => {
  it("flags the problems on an old chiropractic homepage", () => {
    const home = page({
      role: "home",
      url: "https://halifax.example/",
      html: `<!doctype html><html><head>
        <title>Halifax Chiropractic Centre</title>
        <meta name="description" content="Website Description" />
      </head><body>
        <header>
          <div id="tel-no"><p>Telephone: 01422 25 26 25</p></div>
          <nav>
            <a href="https://halifax.example/coronavirus-update/">Coronavirus Update</a>
            <a href="https://halifax.example/contact-us/">Contact us</a>
          </nav>
        </header>
        <h1>Halifax Chiropractic Centre</h1>
        <p>Welcome to the centre.</p>
        <footer>
          <img src="https://halifax.example/images/footer-gcc.png" alt="alt" />
        </footer>
      </body></html>`,
    });

    const result = analyzeSite({
      pages: [home],
      ssl: SSL_OK,
      mapProbes: [],
      cssHasMedia: null,
      typos: null,
      spellingRead: "light",
      now: NOW,
    });

    assert.equal(byId(result, "outdated").status, "fail");
    assert.match(byId(result, "outdated").impact || "", /out of date or that you're closed/);
    assert.equal(byId(result, "phone").status, "fail");
    assert.match(byId(result, "phone").summary, /01422 25 26 25/);
    assert.equal(byId(result, "mobile").status, "fail");
    assert.equal(byId(result, "meta").status, "fail");
    assert.equal(byId(result, "cta").status, "pass");
    assert.equal(byId(result, "regulator").status, "warn");
    assert.equal(byId(result, "https").status, "pass");
    assert.equal(byId(result, "map").status, "na");
    assert.equal(byId(result, "code").status, "pass");
    assert.equal(result.score, 50);
  });

  it("gives a tidy osteopath site full marks", () => {
    const home = page({
      role: "home",
      url: "https://clinic.example/",
      html: `<!doctype html><html><head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Northgate Osteopaths in Lincoln</title>
        <meta name="description" content="Osteopathy in Lincoln for back pain, neck pain and sports injuries. Book a visit with our registered team." />
      </head><body>
        <header>
          <a href="tel:01522555666">01522 555666</a>
          <nav><a href="https://clinic.example/contact">Contact</a></nav>
        </header>
        <h1>Osteopathy in Lincoln</h1>
        <p>All of our osteopaths are registered with the General Osteopathic Council.</p>
        <iframe src="https://www.google.com/maps/embed?pb=clinic"></iframe>
        <footer><p>Copyright © Northgate Osteopaths 2026</p></footer>
      </body></html>`,
    });

    const result = analyzeSite({
      pages: [home],
      ssl: SSL_OK,
      mapProbes: [
        {
          src: "https://www.google.com/maps/embed?pb=clinic",
          ok: true,
          status: 200,
          body: "<html><body>Map</body></html>",
        },
      ],
      cssHasMedia: true,
      typos: null,
      spellingRead: "light",
      now: NOW,
    });

    for (const item of result.checks) {
      assert.equal(item.status, "pass", `${item.id} was ${item.status}: ${item.summary}`);
    }
    assert.equal(result.score, 100);
  });

  it("does not treat a long COVID service as an old notice", () => {
    const home = page({
      role: "home",
      url: "https://physio.example/",
      html: `<!doctype html><html><head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>River Physio in York</title>
        <meta name="description" content="Physiotherapy in York for sports injuries, joint pain and recovery after illness." />
      </head><body>
        <header>
          <a href="tel:01904555666">01904 555666</a>
          <a href="/book">Book online</a>
        </header>
        <h2>Long COVID rehab</h2>
        <p>Our physiotherapists are registered with the HCPC.</p>
        <footer>Copyright 2026 River Physio</footer>
      </body></html>`,
    });
    const result = analyzeSite({
      pages: [home],
      ssl: SSL_OK,
      mapProbes: [],
      cssHasMedia: true,
      typos: null,
      spellingRead: "light",
      now: NOW,
    });
    assert.equal(byId(result, "outdated").status, "pass");
    assert.equal(byId(result, "regulator").status, "pass");
  });

  it("flags an old copyright, a past closure, stray code and a repeated paragraph", () => {
    const paragraph =
      "Our osteopaths take time to listen before any treatment starts and they explain each step in plain language so you know what to expect.";
    const home = page({
      role: "home",
      url: "https://old.example/",
      html: `<!doctype html><html><head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Old Street Osteopaths</title>
        <meta name="description" content="Osteopathy for back pain, neck pain and everyday aches at our city clinic." />
      </head><body>
        <header><a href="tel:02079460000">020 7946 0000</a><a href="/contact">Contact</a></header>
        <p>We are closed for annual leave from 20 December 2023 until 3 January 2024.</p>
        <p>${paragraph}</p>
        <p>${paragraph}</p>
        <p>Please use the form [contact-form-7 id="12"] to write to us.</p>
        <p>Registered with the General Osteopathic Council.</p>
        <footer>Copyright © Old Street Osteopaths 2024</footer>
      </body></html>`,
    });
    const blog = page({
      role: "blog",
      url: "https://old.example/blog/",
      html: `<!doctype html><html><body>
        <article class="post"><h2>Back pain myths</h2><time datetime="2022-03-12">12 March 2022</time></article>
      </body></html>`,
    });
    const result = analyzeSite({
      pages: [home, blog],
      ssl: SSL_OK,
      mapProbes: [],
      cssHasMedia: true,
      typos: null,
      spellingRead: "light",
      now: NOW,
    });
    assert.equal(byId(result, "outdated").status, "fail");
    assert.match(byId(result, "outdated").summary, /2024/);
    assert.match(byId(result, "outdated").summary, /12 March 2022|March 2022/);
    assert.equal(byId(result, "code").status, "fail");
    assert.match(byId(result, "code").quotes.map((quote) => quote.text).join(" "), /contact-form-7/);
    assert.equal(byId(result, "writing").status, "fail");
  });

  it("accepts a copyright year from last year and rejects one from the year before", () => {
    function withYear(year: number) {
      return analyzeSite({
        pages: [
          page({
            role: "home",
            url: "https://year.example/",
            html: `<html><head>
              <meta name="viewport" content="width=device-width, initial-scale=1" />
              <title>Harbour Osteopaths</title>
              <meta name="description" content="Osteopathy in the harbour town for back pain, necks and sports injuries." />
            </head><body>
              <header><a href="tel:01315550000">0131 555 0000</a><a href="/contact">Get in touch</a></header>
              <p>Members of the General Osteopathic Council.</p>
              <footer>Copyright ${year}</footer>
            </body></html>`,
          }),
        ],
        ssl: SSL_OK,
        mapProbes: [],
        cssHasMedia: true,
        typos: null,
        spellingRead: "light",
        now: NOW,
      });
    }
    assert.equal(byId(withYear(2025), "outdated").status, "pass");
    assert.equal(byId(withYear(2024), "outdated").status, "fail");
  });

  it("dates a blog from 'Posted' lines and ignores other professions in an old article", () => {
    const home = page({
      role: "home",
      url: "https://blog.example/",
      html: `<html><head>
        <title>Cannock Osteopaths</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="description" content="Osteopathy in Cannock for back pain, neck pain and sports injuries." />
      </head><body>
        <header><a href="tel:01543462928">01543 462928</a><nav><a href="/contact">Contact</a></nav></header>
        <p>Registered with the General Osteopathic Council.</p>
        <footer>Copyright 2026</footer>
      </body></html>`,
    });
    const blog = page({
      role: "blog",
      url: "https://blog.example/blog/",
      html: `<html><body>
        <h2>Osteopaths, Physiotherapists, Chiropractors: What's the difference?</h2>
        <p>Posted: June 11th 2019</p>
        <p>Posted: July 12th 2017</p>
      </body></html>`,
    });
    const result = analyzeSite({
      pages: [home, blog],
      ssl: SSL_OK,
      mapProbes: [],
      cssHasMedia: true,
      typos: null,
      spellingRead: "light",
      now: NOW,
    });
    assert.equal(byId(result, "outdated").status, "fail");
    assert.match(byId(result, "outdated").summary, /11 June 2019/);
    assert.equal(byId(result, "regulator").status, "pass");
  });

  it("quotes a broken map", () => {
    const home = page({
      role: "home",
      url: "https://map.example/",
      html: `<html><head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Market Osteopaths</title>
        <meta name="description" content="Osteopathy by the market for backs, necks and sports injuries. Call to book." />
      </head><body>
        <header><a href="tel:01134567890">0113 456 7890</a><a href="/contact">Contact</a></header>
        <iframe src="https://www.google.com/maps/embed?pb=broken"></iframe>
        <p>Registered with the GOsC.</p>
        <footer>© 2026</footer>
      </body></html>`,
    });
    const result = analyzeSite({
      pages: [home],
      ssl: SSL_OK,
      mapProbes: [
        {
          src: "https://www.google.com/maps/embed?pb=broken",
          ok: true,
          status: 200,
          body: "<html>Oops! Something went wrong</html>",
        },
      ],
      cssHasMedia: true,
      typos: null,
      spellingRead: "light",
      now: NOW,
    });
    assert.equal(byId(result, "map").status, "fail");
    assert.match(byId(result, "map").quotes[0]?.text || "", /Oops! Something went wrong/);
  });
});
