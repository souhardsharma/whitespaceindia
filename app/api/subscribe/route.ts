import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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

function isAllowedOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://whitespaceindia-csr.vercel.app";
  if (origin === siteUrl) return true;
  if (origin.endsWith(".vercel.app")) return true;
  if (origin === "http://localhost:3000") return true;
  if (origin === "http://localhost:3001") return true;
  return false;
}

function clean(v: unknown, max = 100): string | undefined {
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim().slice(0, max);
  return trimmed.length > 0 ? trimmed : undefined;
}

function getClientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

export async function POST(req: NextRequest) {
  if (!isAllowedOrigin(req)) {
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
    return NextResponse.json({ ok: false, message: "Invalid request body." }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, message: "Invalid request body." }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
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
    return NextResponse.json({ ok: false, message: "Missing source." }, { status: 400 });
  }

  const formId =
    source === "landing"
      ? process.env.KIT_FORM_ID_LANDING || DEFAULT_FORM_ID_LANDING
      : process.env.KIT_FORM_ID || DEFAULT_FORM_ID_REPORTS;

  // Kit field keys are derived from the labels you set on the form.
  // "Company Name (Optional)" -> company_name, "Phone Number (Optional)" -> phone_number.
  // We send a few common spellings so the data lands regardless of how the field was named.
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

  const kitPayload: Record<string, unknown> = { email_address: email };
  // Kit's "Name" field on a form maps to first_name on the subscriber.
  if (name) kitPayload.first_name = name;
  kitPayload.fields = fields;

  try {
    const kitRes = await fetch(`https://app.kit.com/forms/${formId}/subscriptions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(kitPayload),
    });

    const kitBody = (await kitRes.json().catch(() => null)) as
      | { status?: string; errors?: unknown }
      | null;

    if (!kitRes.ok || !kitBody || kitBody.status !== "success") {
      console.error(
        "[subscribe] Kit error",
        kitRes.status,
        JSON.stringify(kitBody).slice(0, 500)
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
