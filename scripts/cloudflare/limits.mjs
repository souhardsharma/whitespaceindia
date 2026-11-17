// Cloudflare Pages' free-plan limits on one deployment, checked against the
// assembled site. Past any of them Pages refuses the deployment, the live site
// keeps its previous build, and every tool's nightly update stops reaching it,
// so they are checked on every pull request (CI) and every day (watchdog), not
// discovered by a failed production build.
//
// Limits: https://developers.cloudflare.com/pages/platform/limits/
export const LIMITS = {
  files: 20000, // files in one deployment
  fileBytes: 25 * 1024 * 1024, // one file
  staticRedirects: 2000, // _redirects lines without a splat or placeholder
  dynamicRedirects: 100, // _redirects lines with one
  headerRules: 100, // _headers URL patterns
  routeRules: 100, // _routes.json include + exclude
  routeRuleChars: 100, // one _routes.json rule
};

// Past this share of a limit the check warns, so a growing tool is seen weeks
// before it fails.
export const WARN_AT = 0.8;

export function countRedirects(text) {
  let staticCount = 0;
  let dynamicCount = 0;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const from = line.split(/\s+/)[0];
    if (from.includes("*") || from.includes(":")) dynamicCount++;
    else staticCount++;
  }
  return { staticCount, dynamicCount };
}

export function countHeaderRules(text) {
  // A rule is a URL pattern at the start of a line; its headers are indented.
  return text.split("\n").filter((l) => l.trim() && !l.startsWith("#") && !/^\s/.test(l)).length;
}

/**
 * @param {{files: number, largest: {rel: string, bytes: number}[],
 *          redirectsText: string, headersText: string,
 *          routes: {include: string[], exclude: string[]}}} site
 * @returns {{errors: string[], warnings: string[], summary: string}}
 */
export function checkLimits(site) {
  const errors = [];
  const warnings = [];
  const measure = (label, value, limit) => {
    if (value > limit) errors.push(`${label}: ${value} exceeds Cloudflare Pages' ${limit}`);
    else if (value > limit * WARN_AT)
      warnings.push(`${label}: ${value} of ${limit} (${Math.round((100 * value) / limit)}%)`);
  };

  measure("files", site.files, LIMITS.files);
  for (const f of site.largest) {
    if (f.bytes > LIMITS.fileBytes) errors.push(`${f.rel}: ${mib(f.bytes)} exceeds the 25 MiB file limit`);
    else if (f.bytes > LIMITS.fileBytes * WARN_AT) warnings.push(`${f.rel}: ${mib(f.bytes)} of 25 MiB`);
  }
  const { staticCount, dynamicCount } = countRedirects(site.redirectsText);
  measure("static redirects", staticCount, LIMITS.staticRedirects);
  measure("dynamic redirects", dynamicCount, LIMITS.dynamicRedirects);
  measure("_headers rules", countHeaderRules(site.headersText), LIMITS.headerRules);
  const rules = [...site.routes.include, ...site.routes.exclude];
  measure("_routes.json rules", rules.length, LIMITS.routeRules);
  for (const r of rules) {
    if (r.length > LIMITS.routeRuleChars) errors.push(`_routes.json rule over ${LIMITS.routeRuleChars} characters: ${r}`);
  }

  const top = site.largest[0];
  const summary =
    `${site.files} files of ${LIMITS.files}; largest ${top ? `${top.rel} ${mib(top.bytes)}` : "none"}; ` +
    `redirects ${staticCount} static + ${dynamicCount} dynamic; ` +
    `${countHeaderRules(site.headersText)} header rules; ${rules.length} route rules`;
  return { errors, warnings, summary };
}

function mib(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}
