import { NextRequest } from 'next/server';
import { isAllowedOrigin, clientIp } from '@/lib/request-identity';
import { SECTORS, sectorPOS, type District, type Weights } from '@/lib/csr/score';
import fs from 'fs';
import path from 'path';
import React from 'react';
import { Document, Page, Text, View, StyleSheet, renderToBuffer, Link, Image, Font, Svg, Path, Circle } from '@react-pdf/renderer';

export const maxDuration = 60;

const SYSTEM_PROMPT = `You write short research briefs on Indian districts for Whitespace India, an independent project that sets the corporate social responsibility (CSR) spending companies report against district poverty. The readers are researchers, journalists, CSR and foundation staff, and public officials. Write as a careful researcher explaining figures to an intelligent colleague: plainly, exactly and calmly.

FACTS:
- Use only the figures in the data block. Add no other fact, number, place, scheme, programme, company, CSR sector or event, and do not guess at causes.
- The data block says nothing about which sectors or companies fund the district, about the intensity of poverty, or about any indicator it does not list. If a point would need such information, leave the point out.
- Give every number with the period and unit the data block gives it. CSR figures cover FY2021-24; population is from Census 2011; poverty figures are NITI Aayog's for 2019-21 and 2015-16.
- Describe and compare. Do not recommend where money should go, and do not call the district neglected, deserving or a priority.

STYLE:
- Never use a dash as punctuation: no em dash, no en dash, and no hyphen with spaces around it. Use a comma, a full stop, brackets or a conjunction. Hyphens inside words and in year ranges such as 2019-21 are fine.
- Never use these words: leverage, utilize, robust, seamless, innovative, transformative, pivotal, synergy, foster, harness, catalyze, optimize, democratize, holistic, impactful, actionable, delve, embark, unleash, crucial, insights, navigate, landscape, unlock, empower, stark, staggering, underscore, surface (as a verb).
- State each claim directly. Avoid contrasts of the form "not X but Y", "it is not X, it is Y" and "rather than".
- Do not group adjectives, phrases or sentences in threes for rhythm.
- No rhetorical questions, slogans, closing one-liners or sentence fragments.
- No bullet points or lists. Write full paragraphs, vary sentence length, and join sentences with ordinary connectives such as because, so, but and which means.
- Do not mention artificial intelligence, language models or automation.

FORMAT: write exactly five sections in this order. Put each heading alone on its own line, in bold, exactly as written below, and follow it with one paragraph of three to five sentences.

**Summary**
[the district's score, and how its poverty and its CSR spending per person compare with the benchmarks in the data block]

**Poverty**
[the 2019-21 headcount ratio and MPI score, and the change since 2015-16 if the data block gives a baseline; if it does not, say that no baseline is available]

**CSR spending**
[CSR received over FY2021-24, the amount per person, and how it compares with the median for districts in the same population tier]

**What the figures indicate**
[what this combination of figures says about the district, kept strictly within the data block]

**Limits of this brief**
[the limits that matter most for these particular figures, chosen from these facts: CSR filed as national or without a district is not counted, so district totals are a lower bound; population is from Census 2011; the poverty figures are for 2019-21; the score depends on the weights the reader chose]`;

const SAFE_FILENAME = /[^A-Za-z0-9._-]+/g;
const LGD_CODE_RE = /^[A-Z0-9_]{1,80}$/;

function safeFilename(name: string): string {
  return name.replace(SAFE_FILENAME, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'district';
}

/**
 * Every figure in a brief comes from the published CSR data, never from the
 * request. The request used to carry the district's name and all its numbers,
 * so any script could have this route print a "Whitespace India" PDF with an
 * invented score and spending, and the free-text name doubled as a way to
 * write instructions into the prompt. Now the caller names a district by its
 * code and chooses only what the map lets a reader choose: the sector and the
 * weights.
 */
const CSR_DATA = path.join(process.cwd(), 'public', 'data', 'csr');
let MASTER: Map<string, District> | null = null;
let SECTOR_SCORES: Record<string, Record<string, number>> | null = null;

function master(): Map<string, District> {
  if (!MASTER) {
    const rows = JSON.parse(fs.readFileSync(path.join(CSR_DATA, 'whitespace_master.json'), 'utf-8')) as District[];
    MASTER = new Map(rows.map((d) => [d.district_lgd_code, d]));
  }
  return MASTER;
}

function sectorScores(): Record<string, Record<string, number>> {
  if (!SECTOR_SCORES) {
    SECTOR_SCORES = JSON.parse(fs.readFileSync(path.join(CSR_DATA, 'sector_scores.json'), 'utf-8'));
  }
  return SECTOR_SCORES as Record<string, Record<string, number>>;
}

/** The reader's weights: three shares in [0, 1] that sum to one (the panel's
 *  whole-percent sliders can leave a rounding remainder). Null when not. */
function parseWeights(v: unknown): Weights | null {
  if (!v || typeof v !== 'object') return null;
  const w = v as Record<string, unknown>;
  const out = { w_N: Number(w.w_N), w_G: Number(w.w_G), w_U: Number(w.w_U) };
  const parts = [out.w_N, out.w_G, out.w_U];
  if (!parts.every((x) => Number.isFinite(x) && x >= 0 && x <= 1)) return null;
  const sum = parts.reduce((a, b) => a + b, 0);
  return Math.abs(sum - 1) <= 0.02 ? out : null;
}

const rateLimitMap = new Map<string, { tokens: number; lastRefill: number }>();
const RATE_LIMIT_MAX_TOKENS = 5;
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


function getApiKeys(): string[] {
  const keys: string[] = [];
  for (let i = 1; i <= 10; i++) {
    const key = process.env[`GEMINI_API_KEY_${i}`];
    if (key) keys.push(key);
  }
  if (keys.length === 0 && process.env.GEMINI_API_KEY) {
    keys.push(process.env.GEMINI_API_KEY);
  }
  return keys;
}

async function callGeminiWithKey(
  apiKey: string,
  messages: { role: string; parts: { text: string }[] }[],
  systemPrompt: string
): Promise<string> {
  const response = await fetch(
    // The key in a header, not the query string, where it would sit in every
    // log line that records the URL.
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      cache: 'no-store',
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: messages,
        generationConfig: {
          maxOutputTokens: 8192,
          temperature: 0.7,
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  const text = parts.map((p: any) => p.text || '').join('');
  if (!text) throw new Error('No text in Gemini response');
  return text;
}

async function callGemini(
  messages: { role: string; parts: { text: string }[] }[],
  systemPrompt: string
): Promise<string> {
  const keys = getApiKeys();
  if (keys.length === 0) {
    throw new Error('NO_API_KEYS');
  }

  const maxRetriesPerKey = 3;

  for (let keyIdx = 0; keyIdx < keys.length; keyIdx++) {
    const apiKey = keys[keyIdx];

    for (let attempt = 0; attempt < maxRetriesPerKey; attempt++) {
      try {
        return await callGeminiWithKey(apiKey, messages, systemPrompt);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.warn(`[brief] key ${keyIdx + 1} attempt ${attempt + 1} failed: ${errorMsg}`);

        if (attempt < maxRetriesPerKey - 1) {
          const wait = Math.pow(2, attempt + 1) * 2000;
          await new Promise(r => setTimeout(r, wait));
        }
      }
    }
  }

  throw new Error('ALL_KEYS_EXHAUSTED');
}

Font.register({
  family: 'Karla',
  fonts: [
    { src: 'https://fonts.gstatic.com/s/karla/v33/qkBIXvYC6trAT55ZBi1ueQVIjQTD-JqqFA.ttf', fontWeight: 400 },
    { src: 'https://fonts.gstatic.com/s/karla/v33/qkBIXvYC6trAT55ZBi1ueQVIjQTDH52qFA.ttf', fontWeight: 700 }
  ]
});

Font.register({
  family: 'Lora',
  fonts: [
    { src: 'https://fonts.gstatic.com/s/lora/v37/0QI6MX1D_JOuGQbT0gvTJPa787weuyJG.ttf', fontWeight: 400 },
    { src: 'https://fonts.gstatic.com/s/lora/v37/0QI6MX1D_JOuGQbT0gvTJPa787z5vCJG.ttf', fontWeight: 700 },
    { src: 'https://fonts.gstatic.com/s/lora/v37/0QI8MX1D_JOuMw_hLdO6T2wV9KnW-MoFkqg.ttf', fontWeight: 400, fontStyle: 'italic' },
    { src: 'https://fonts.gstatic.com/s/lora/v37/0QI8MX1D_JOuMw_hLdO6T2wV9KnW-C0Ckqg.ttf', fontWeight: 700, fontStyle: 'italic' }
  ]
});

const PAPER = '#fcf9f4';
const CLAY = '#BD402C';
const INK = '#1c1c19';
const INK_RULE = '#1c1c19';
const INK_DIM = '#5b5f62';
const SURFACE_LOW = '#f6f3ee';

const styles = StyleSheet.create({
  page: {
    backgroundColor: PAPER,
    paddingTop: 48,
    paddingBottom: 48,
    paddingLeft: 52,
    paddingRight: 52,
    fontFamily: 'Karla',
  },
  wordmarkRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 22 },
  wordmarkLogo: { width: 14, height: 14, marginRight: 5 },
  wordmarkBrand: { fontSize: 14, fontFamily: 'Lora', fontWeight: 700, color: INK, letterSpacing: -0.2 },
  wordmarkCsr: { fontSize: 12, fontFamily: 'Lora', fontWeight: 700, fontStyle: 'italic', color: CLAY, marginLeft: 5 },
  districtName: { fontSize: 30, fontFamily: 'Lora', fontWeight: 700, color: INK, lineHeight: 1.1, marginBottom: 4 },
  stateName: { fontSize: 13, color: INK_DIM, marginBottom: 18 },
  scoreBadgeWrap: { flexDirection: 'row', marginBottom: 28 },
  scoreBadge: { backgroundColor: CLAY, paddingTop: 5, paddingBottom: 5, paddingLeft: 10, paddingRight: 10, borderRadius: 0 },
  scoreBadgeText: { fontSize: 9, fontFamily: 'Karla', fontWeight: 700, color: PAPER, letterSpacing: 1.2 },
  divider: { borderBottomWidth: 1, borderBottomColor: INK_RULE, marginBottom: 24 },
  metricsRow: { flexDirection: 'row', marginBottom: 28 },
  card: { flex: 1, borderWidth: 1, borderColor: INK_RULE, borderRadius: 0, padding: 14, backgroundColor: SURFACE_LOW },
  cardGap: { width: 10 },
  cardLabel: { fontSize: 7, fontFamily: 'Karla', fontWeight: 700, color: CLAY, letterSpacing: 1.5, marginBottom: 8 },
  cardValue: { fontSize: 20, fontFamily: 'Karla', fontWeight: 700, color: INK, lineHeight: 1, marginBottom: 4 },
  cardSubValue: { fontSize: 9, color: INK_DIM },
  briefSection: { marginBottom: 24 },
  heading: { fontSize: 12, fontFamily: 'Lora', fontWeight: 700, color: CLAY, marginBottom: 8, marginTop: 6 },
  paragraph: { fontSize: 10, color: INK, lineHeight: 1.75, marginBottom: 11, fontFamily: 'Karla', fontWeight: 400 },
  footer: { borderTopWidth: 1, borderTopColor: INK_RULE, paddingTop: 14, marginTop: 'auto' },
  footerSources: { fontSize: 7, color: INK_DIM, lineHeight: 1.6, marginBottom: 4 },
  footerDate: { fontSize: 7, color: INK_DIM, opacity: 0.6 },
});

interface BriefInput {
  district_name: string;
  state_name: string;
  headcount_ratio_2021: number;
  headcount_ratio_2016: number | null;
  district_csr_per_person: number;
  total_csr_recent: number;
  total_population: number;
  mpi_2021: number;
  computed_pos: number;
  pop_tier: string;
  tier_median_csr: number;
  population_imputed?: boolean;
  population_source?: string;
  population_citation?: string;
  population_parent_districts?: string;
}

function buildPrompt(d: BriefInput): string {
  const tierMedian = d.tier_median_csr || 127;
  const povChange = d.headcount_ratio_2016
    ? ((d.headcount_ratio_2021 - d.headcount_ratio_2016) * 100).toFixed(1)
    : 'N/A';
  const retentionRatio = d.headcount_ratio_2016 && d.headcount_ratio_2016 > 0
    ? (d.headcount_ratio_2021 / d.headcount_ratio_2016).toFixed(2)
    : 'N/A';

  const dataBlock = `
DATA FOR ${d.district_name.toUpperCase()} DISTRICT, ${d.state_name.toUpperCase()}:
- MPI Headcount Ratio (2019-21): ${(d.headcount_ratio_2021 * 100).toFixed(1)}% of population is multidimensionally poor
- MPI Score (2019-21): ${d.mpi_2021}
- Headcount Ratio baseline (2015-16): ${d.headcount_ratio_2016 ? (d.headcount_ratio_2016 * 100).toFixed(1) + '%' : 'not available'}
- Change from baseline: ${povChange} percentage points
- Poverty retention ratio (2019-21 headcount divided by 2015-16 headcount): ${retentionRatio} (1.0 means no fall, above 1.0 means a rise)
- Total population (Census 2011${d.population_imputed && d.population_source ? `, ${d.population_source.replace(/_/g, ' ')}` : ''}): ${d.total_population ? Number(d.total_population).toLocaleString('en-IN') : 'not available'}${d.population_imputed && d.population_parent_districts ? ` (district carved from ${d.population_parent_districts} after Census 2011; recast to current boundary)` : ''}
- Population tier: ${d.pop_tier || 'N/A'}
- CSR received FY2021-24: INR ${Number(d.total_csr_recent).toFixed(2)} crore
- CSR per person (CSR received FY2021-24 divided by Census 2011 population): INR ${Math.round(d.district_csr_per_person)}
- Median CSR per person for districts in the same population tier: INR ${Math.round(tierMedian)}
- Shortfall against that median: INR ${Math.max(0, Math.round(tierMedian) - Math.round(d.district_csr_per_person))} per person
- Philanthropic Opportunity Score: ${Math.round(d.computed_pos)} out of 100 (a higher score means more poverty relative to recorded CSR spending; it reflects the weights and sector the reader chose)`;

  return `Write the research brief for this district from the data below, in the five-section format.\n\n${dataBlock}`;
}

function buildDocument(d: BriefInput, briefText: string) {
  const mpiPct = (d.headcount_ratio_2021 * 100).toFixed(1) + '%';
  const csrPerPerson = 'INR ' + Math.round(d.district_csr_per_person).toLocaleString('en-IN');
  const tierMedian = 'INR ' + Math.round(d.tier_median_csr).toLocaleString('en-IN');
  const scoreLabel = Math.round(d.computed_pos) + ' / 100';
  const generationDate = new Date().toLocaleDateString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  const paragraphs = briefText
    .split(/\n+/)
    .map((p: string) => p.trim())
    .filter(Boolean);

  const ce = React.createElement;

  return ce(
    Document,
    null,
    ce(
      Page,
      { size: 'A4', style: styles.page },

      ce(
        View,
        { style: styles.wordmarkRow },
        ce(
          Svg,
          { width: 14, height: 14, viewBox: '32 28 176 184', style: styles.wordmarkLogo },
          ce(Path, { d: 'M 78 40 C 58 40 56 58 56 76 C 56 98 56 104 44 116 C 44 120 44 120 44 124 C 56 136 56 142 56 164 C 56 182 58 200 78 200', stroke: INK, strokeWidth: 20, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' }),
          ce(Path, { d: 'M 162 40 C 182 40 184 58 184 76 C 184 98 184 104 196 116 C 196 120 196 120 196 124 C 184 136 184 142 184 164 C 184 182 182 200 162 200', stroke: INK, strokeWidth: 20, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' }),
          ce(Path, { d: 'M 98 88 C 98 72 108 62 120 62 C 134 62 144 74 144 88 C 144 104 134 110 126 118 C 120 124 120 130 120 138 L 120 146', stroke: INK, strokeWidth: 30, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' }),
          ce(Circle, { cx: 120, cy: 180, r: 16, fill: CLAY })
        ),
        ce(Text, { style: styles.wordmarkBrand }, 'Whitespace India'),
        ce(Text, { style: styles.wordmarkCsr }, 'CSR')
      ),

      ce(Text, { style: styles.districtName }, d.district_name),
      ce(Text, { style: styles.stateName }, d.state_name),

      ce(
        View,
        { style: styles.scoreBadgeWrap },
        ce(
          View,
          { style: styles.scoreBadge },
          ce(Text, { style: styles.scoreBadgeText }, scoreLabel + '  ·  OPPORTUNITY SCORE')
        )
      ),

      ce(View, { style: styles.divider }),

      ce(
        View,
        { style: styles.metricsRow },
        ce(
          View,
          { style: styles.card },
          ce(Text, { style: styles.cardLabel }, 'MPI HEADCOUNT RATIO'),
          ce(Text, { style: styles.cardValue }, mpiPct),
          ce(Text, { style: styles.cardSubValue }, '2019-21  ·  NFHS-5')
        ),
        ce(View, { style: styles.cardGap }),
        ce(
          View,
          { style: styles.card },
          ce(Text, { style: styles.cardLabel }, 'CSR PER PERSON'),
          ce(Text, { style: styles.cardValue }, csrPerPerson),
          ce(Text, { style: styles.cardSubValue }, 'FY2021-24  ·  MCA data')
        ),
        ce(View, { style: styles.cardGap }),
        ce(
          View,
          { style: styles.card },
          ce(Text, { style: styles.cardLabel }, 'MEDIAN, SIMILAR DISTRICTS'),
          ce(Text, { style: styles.cardValue }, tierMedian),
          ce(Text, { style: styles.cardSubValue }, 'CSR per person, same population tier')
        )
      ),

      ce(Image, {
        src: `https://quickchart.io/chart?c={type:'bar',data:{labels:['District','Median of similar districts'],datasets:[{label:'INR per person',backgroundColor:['%23BD402C','%231c1c19'],data:[${Math.round(d.district_csr_per_person)},${Math.round(d.tier_median_csr)}]}]}}`,
        style: { width: '100%', height: 180, marginTop: 10, marginBottom: 24, borderRadius: 0 }
      }),

      ce(
        View,
        { style: styles.briefSection },
        ...paragraphs.map((para: string, i: number) => {
          const isHeading = para.startsWith('**') && para.endsWith('**') && para.split('**').length === 3;

          if (isHeading) {
            return ce(Text, { key: String(i), style: styles.heading }, para.replace(/\*\*/g, ''));
          }

          const chunks = para.split('**');
          return ce(
            Text,
            { key: String(i), style: styles.paragraph },
            ...chunks.map((chunk, index) => {
              if (index % 2 === 1) {
                return ce(Text, { key: `chunk-${index}`, style: { fontFamily: 'Karla', fontWeight: 700 } }, chunk);
              }
              return chunk;
            })
          );
        })
      ),

      ce(
        View,
        { style: styles.footer },
        ce(
          Text,
          { style: styles.footerSources },
          'Sources: ',
          ce(Link, { src: 'https://www.niti.gov.in/sites/default/files/2023-07/National-Multidimentional-Poverty-Index-2023-Final-17th-July.pdf', style: { color: INK_DIM, textDecoration: 'underline' } }, 'NITI Aayog MPI 2023 (NFHS-5)'),
          ' · ',
          ce(Link, { src: 'https://dataful.in/datasets/1612/', style: { color: INK_DIM, textDecoration: 'underline' } }, 'Ministry of Corporate Affairs CSR via Dataful.in'),
          ' · Census of India 2011'
        ),
        ce(
          Text,
          { style: styles.footerSources },
          'The text of this brief was written by Google Gemini 2.5 Flash, a language model, from the figures above. It should be checked against those figures, which come from the sources listed, before it is quoted.'
        ),
        ce(
          Text,
          { style: styles.footerSources },
          'Whitespace India is maintained by ',
          ce(Link, { src: 'https://linkedin.com/in/souhardsharma', style: { color: CLAY, textDecoration: 'none' } }, 'Souhard Sharma'),
          '.'
        ),
        ce(Text, { style: styles.footerDate }, 'Generated on ' + generationDate + ' from the CSR Opportunity Index')
      )
    )
  );
}

export async function POST(req: NextRequest) {
  if (!isAllowedOrigin(req)) {
    return new Response('Forbidden', { status: 403 });
  }

  // NOT the leftmost X-Forwarded-For entry, which the caller can set: a
  // client sending its own header has its real address APPENDED, so the
  // leftmost value is whatever it typed. See clientIp.
  const ip = clientIp(req);
  if (!checkRateLimit(ip)) {
    return new Response('Too many requests. Please wait a minute.', {
      status: 429,
      headers: { 'Retry-After': '60' },
    });
  }

  if (getApiKeys().length === 0) {
    // The caller is not the operator. Naming the environment variable and
    // the file it belongs in told an unauthenticated stranger exactly how
    // this deployment is configured and what is missing from it; the operator
    // gets that in the server log instead.
    console.error(
      'brief: no API key configured; set GEMINI_API_KEY_1 in the environment');
    return new Response('This service is temporarily unavailable.', { status: 503 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return new Response('Invalid JSON body.', { status: 400 });
  }

  if (!raw || typeof raw !== 'object') {
    return new Response('Invalid payload.', { status: 400 });
  }

  const r = raw as Record<string, unknown>;
  const code = typeof r.district_lgd_code === 'string' ? r.district_lgd_code : '';
  const d = LGD_CODE_RE.test(code) ? master().get(code) : undefined;
  if (!d) {
    return new Response('Unknown district.', { status: 400 });
  }
  const sector = typeof r.sector === 'string' ? r.sector : 'All Sectors';
  if (!(SECTORS as readonly string[]).includes(sector)) {
    return new Response('Unknown sector.', { status: 400 });
  }
  const weights = parseWeights(r.weights);
  if (!weights) {
    return new Response('Invalid weights.', { status: 400 });
  }

  const input: BriefInput = {
    district_name: d.district_name,
    state_name: d.state_name,
    headcount_ratio_2021: d.headcount_ratio_2021,
    headcount_ratio_2016: d.headcount_ratio_2016,
    district_csr_per_person: d.district_csr_per_person,
    total_csr_recent: d.total_csr_recent,
    total_population: d.total_population,
    mpi_2021: d.mpi_2021,
    computed_pos: sectorPOS(d, weights, sector, sectorScores()),
    pop_tier: d.pop_tier,
    tier_median_csr: d.tier_median_csr,
  };
  const district_name = d.district_name;

  try {
    const briefText = await callGemini(
      [{ role: 'user', parts: [{ text: buildPrompt(input) }] }],
      SYSTEM_PROMPT
    );

    const doc = buildDocument(input, briefText);
    const buffer = await renderToBuffer(doc);
    const filename = `${safeFilename(district_name)}-brief.pdf`;

    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('brief error:', msg);
    return new Response('The brief could not be prepared. Please try again in a minute.', { status: 500 });
  }
}
