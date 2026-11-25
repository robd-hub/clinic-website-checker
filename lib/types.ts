export type CheckStatus = "pass" | "fail" | "warn" | "na";

export type PageRole =
  | "home"
  | "contact"
  | "about"
  | "fees"
  | "blog"
  | "covid"
  | "other";

export type Quote = {
  text: string;
  pageUrl: string;
  pageLabel: string;
};

export type CheckResult = {
  id: string;
  title: string;
  status: CheckStatus;
  summary: string;
  quotes: Quote[];
  impact?: string;
};

export type FetchedPage = {
  url: string;
  role: PageRole;
  status: number;
  html: string;
  ok: boolean;
  error?: string;
};

export type SslReport = {
  secure: boolean;
  certificateValid: boolean;
  validTo?: string;
  error?: string;
  mixedContent: string[];
};

export type MapProbe = {
  src: string;
  ok: boolean;
  status?: number;
  body: string;
  error?: string;
};

export type ReportPage = {
  url: string;
  role: PageRole;
  label: string;
  ok: boolean;
};

export type Report = {
  url: string;
  finalUrl: string;
  hostname: string;
  fetchedAt: string;
  score: number;
  verdict: string;
  scoreNote?: string;
  checks: CheckResult[];
  pages: ReportPage[];
};

export type LeadFinding = {
  id: string;
  title: string;
  status: CheckStatus;
  summary: string;
  impact?: string;
  quotes: Quote[];
};

export type Lead = {
  id: string;
  createdAt: string;
  name: string;
  email: string;
  url: string;
  score: number;
  verdict: string;
  findings: LeadFinding[];
  pages: string[];
};
