import { Suspense } from "react";

import { AutoCheckScript } from "@/components/auto-check-script";
import { Checker } from "@/components/checker";
import { readUrlParam, runnableQueryUrl } from "@/lib/url";

export default function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string | string[] }>;
}) {
  return (
    <>
      {/* The shell is the static landing page. A ?url= visit paints the loading
          state on top of it until this checker streams in. */}
      <Suspense fallback={<Checker initialUrl="" shell />}>
        <CheckerRoute searchParams={searchParams} />
      </Suspense>
      <AutoCheckScript />
    </>
  );
}

async function CheckerRoute({
  searchParams,
}: {
  searchParams: Promise<{ url?: string | string[] }>;
}) {
  const params = await searchParams;
  const initialUrl = runnableQueryUrl(readUrlParam(params.url)) ?? "";
  return <Checker initialUrl={initialUrl} />;
}
