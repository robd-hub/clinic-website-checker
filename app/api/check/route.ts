import { CheckError } from "@/lib/http";
import { allowRequest } from "@/lib/rate-limit";
import { runCheck } from "@/lib/run-check";

export const maxDuration = 60;

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip") || "local";
}

export async function POST(request: Request) {
  if (!allowRequest(clientKey(request))) {
    return Response.json(
      { error: "That's a lot of checks in a short time. Wait a few minutes and try again." },
      { status: 429 },
    );
  }

  let url = "";
  try {
    const body = (await request.json()) as { url?: unknown };
    url = typeof body.url === "string" ? body.url : "";
  } catch {
    return Response.json({ error: "Send the website address and try again." }, { status: 400 });
  }

  try {
    const report = await runCheck(url);
    return Response.json(report);
  } catch (error) {
    if (error instanceof CheckError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error("check failed", error);
    return Response.json(
      { error: "Something went wrong while reading that site. Try again in a moment." },
      { status: 500 },
    );
  }
}
