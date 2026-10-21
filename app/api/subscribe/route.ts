import { NextRequest, NextResponse } from "next/server";
import { checkBotId } from "botid/server";
import { clientIp, isAllowedOrigin } from "@/lib/request-identity";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_IN_TEXT = /[^\s@"]+@[^\s@"]+\.[^\s@"]+/g;
// Numeric form IDs used by Kit's /forms/:id/subscriptions endpoint.
// The public embed UIDs (96285e43e0, 324b05edcf) are NOT accepted here — must
// be the numeric ID found inside each embed script's submission URL.
// Reports form embed uid 96285e43e0 -> form id 9364278
// Landing form embed uid 324b05edcf -> form id 9364340
const DEFAULT_FORM_ID_REPORTS = "9364278";
const DEFAULT_FORM_ID_LANDING = "9364340";

const rateLimitMap = new Map<string, { tokens: number; lastRefill: number }>();
const RATE_LIMIT_MAX_TOKENS = 3;
const RATE_LIMIT_REFILL_MS = 60_000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const bucket = rateLimitMap.get(ip);
  if (!bucket) {
    rateLimitMap.set(ip, { tokens: RATE_LIMIT_MAX_TOKENS - 1, lastRefill: now });
    return true;
  }
  const elapsed = now - bucket.lastRefill;
  const refill = Math.floor(elapsed / RATE_LIMIT_REFILL_MS) * RATE_LIMIT_MAX_TOKENS;
  if (refill > 0) {
    bucket.tokens = Math.min(RATE_LIMIT_MAX_TOKENS, bucket.tokens + refill);
    bucket.lastRefill = now;
  }
  if (bucket.tokens <= 0) return false;
  bucket.tokens -= 1;
  return true;
}

setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_REFILL_MS * 10;
  rateLimitMap.forEach((bucket, ip) => {
    if (bucket.lastRefill < cutoff) rateLimitMap.delete(ip);
  });
}, 300_000);

function clean(v: unknown, max = 100): string | undefined {
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim().slice(0, max);
  return trimmed.length > 0 ? trimmed : undefined;
}

// Replaced by the shared clientIp: the leftmost X-Forwarded-For entry is
// whatever the caller typed, because a proxy APPENDS rather than replaces.
function getClientIp(req: NextRequest): string {
  return clientIp(req);
}

export async function POST(req: NextRequest) {
  if (!isAllowedOrigin(req)) {
    return NextResponse.json({ ok: false, message: "Forbidden" }, { status: 403 });
  }

  // The Origin check stops other websites; it does not stop a script, which
  // can send any Origin it likes. BotID does: the challenge runs in the
  // visitor's browser and Vercel verifies it on this request. Without it,
  // anyone could sign other people's addresses up and have Kit mail them.
  const verdict = await checkBotId();
  if (verdict.isBot) {
    return NextResponse.json({ ok: false, message: "Forbidden" }, { status: 403 });
  }

  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { ok: false, message: "Too many requests. Please try again in a minute." },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: "The form could not be read. Please reload the page and try again." }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, message: "The form could not be read. Please reload the page and try again." }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  // The form's honeypot (SubscribeForm). A person never fills it; answering
  // success tells a script nothing about why its address went nowhere.
  if (typeof b.website === "string" && b.website.trim() !== "") {
    return NextResponse.json({ ok: true });
  }
  const email = clean(b.email, 150);
  const name = clean(b.name, 100);
  const company = clean(b.company, 100);
  const phone = clean(b.phone, 30);
  const source = typeof b.source === "string" && (b.source === "reports" || b.source === "landing")
    ? b.source
    : null;

  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json(
      { ok: false, message: "Please enter a valid email address." },
      { status: 400 }
    );
  }
  if (!source) {
    return NextResponse.json({ ok: false, message: "The form could not be read. Please reload the page and try again." }, { status: 400 });
  }

  const formId =
    source === "landing"
      ? process.env.KIT_FORM_ID_LANDING || DEFAULT_FORM_ID_LANDING
      : process.env.KIT_FORM_ID || DEFAULT_FORM_ID_REPORTS;

  const apiKey = process.env.KIT_API_KEY;
  if (!apiKey) {
    console.error("[subscribe] KIT_API_KEY missing in environment");
    return NextResponse.json(
      { ok: false, message: "Subscriptions are closed for the moment. Please try again later." },
      { status: 500 }
    );
  }

  // Kit subscriber custom-field keys. Kit auto-derives these from the field
  // labels in the form editor. If a key doesn't exist on the account, Kit
  // silently drops it — sending common spellings maximises the hit rate.
  const fields: Record<string, string> = {};
  if (company) {
    fields.company_name = company;
    fields.company = company;
  }
  if (phone) {
    fields.phone_number = phone;
    fields.phone = phone;
  }
  fields.source = source;

  // v3 forms/subscribe endpoint — authenticated via api_key in the body.
  // This bypasses Kit's public form-guard (anti-bot quarantine) that blocked
  // the unauthenticated /forms/:id/subscriptions path from Vercel.
  const kitPayload: Record<string, unknown> = {
    api_key: apiKey,
    email,
    fields,
  };
  if (name) kitPayload.first_name = name;

  try {
    const kitRes = await fetch(
      `https://api.convertkit.com/v3/forms/${formId}/subscribe`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(kitPayload),
        cache: "no-store",
      }
    );

    const rawBody = await kitRes.text().catch(() => "");
    type KitBody = {
      subscription?: { id?: number; state?: string };
      error?: string;
      message?: string;
    };
    let kitBody: KitBody | null = null;
    try {
      kitBody = rawBody ? (JSON.parse(rawBody) as KitBody) : null;
    } catch {
      kitBody = null;
    }

    if (!kitRes.ok || !kitBody?.subscription?.id) {
      // Kit's error fields only: its raw body can echo the subscriber's
      // address, which has no business in the deployment's logs.
      console.error(
        "[subscribe] Kit error",
        "http=" + kitRes.status,
        "formId=" + formId,
        "error=" + String(kitBody?.error ?? "").slice(0, 100),
        "message=" + String(kitBody?.message ?? "").replace(EMAIL_IN_TEXT, "<email>").slice(0, 200)
      );
      return NextResponse.json(
        { ok: false, message: "Subscription failed. Please try again." },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[subscribe] network error", err);
    return NextResponse.json(
      { ok: false, message: "Subscription failed. Please try again." },
      { status: 502 }
    );
  }
}
