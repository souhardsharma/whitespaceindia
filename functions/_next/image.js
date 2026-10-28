// next/image asks /_next/image?url=/landing/x.webp&w=..&q=.. for a resized
// copy. The images are already WebP sized for the page, so the original is
// served from the static files instead of spending the server's bandwidth.
export async function onRequest({ request, env }) {
  const src = new URL(request.url).searchParams.get("url") || "";
  if (!src.startsWith("/") || src.startsWith("//")) return new Response("Bad image url", { status: 400 });
  const res = await env.ASSETS.fetch(new URL(src, request.url));
  const out = new Response(res.body, res);
  if (res.ok) out.headers.set("Cache-Control", "public, max-age=86400");
  return out;
}
