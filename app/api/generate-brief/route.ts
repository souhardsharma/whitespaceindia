import { NextRequest } from 'next/server';

export const maxDuration = 60; // Max allowed for Vercel Hobby tier

const SYSTEM_PROMPT = `You are a senior research analyst at a philanthropic advisory firm in India. You write district investment briefs used by foundation program officers and CSR heads. Your writing is direct, data-anchored, and clear.

RULES:
- Never use: leverage, utilize, robust, seamless, innovative, transformative, pivotal, synergy, foster, harness, catalyze, optimize, democratize, holistic, impactful, actionable, delve, embark, unleash
- No em-dashes. Use hyphens with spaces ( - ) instead
- No AI/automation references
- Vary sentence length
- Every claim cites a specific number, place, or year
- No bullet points. Pure prose paragraphs
- No generic phrases like "In an era where" or "In conclusion"

FORMAT - write exactly this structure, with these headings in bold:

**Why This District Matters**
[1 paragraph: the specific case for philanthropic attention right now]

**Poverty Profile**
[1 paragraph: specific MPI headcount, intensity, change from baseline, what it means on the ground]

**CSR Funding Gap**
[1 paragraph: how much CSR the district receives per person vs. its population-tier median, what sectors are funded or absent]

**Where the Opportunity Lies**
[1 paragraph: specific philanthropic entry points based on the data]

**One Honest Limitation**
[1 paragraph: a genuine constraint on this analysis - be specific, not generic]`;

// ── Multi-key cycling with retry logic ──────────────────────────────────
function getApiKeys(): string[] {
  const keys: string[] = [];
  // Support up to 10 keys (GEMINI_API_KEY_1 through GEMINI_API_KEY_10)
  for (let i = 1; i <= 10; i++) {
    const key = process.env[`GEMINI_API_KEY_${i}`];
    if (key) keys.push(key);
  }
  // Fallback: also check the legacy single-key env var
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
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
  // Stitches chunks back together so text doesn't cut off
  const text = parts.map((p: any) => p.text || '').join('');
  if (!text) throw new Error('No text in Gemini response');
  return text;
}

/**
 * Cycles through all available API keys.
 * Each key is tried up to 3 times (with exponential backoff) before moving to the next.
 * If ALL keys exhaust their retries, throws a final error.
 */
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
        console.log(`Trying API key ${keyIdx + 1}/${keys.length}, attempt ${attempt + 1}/${maxRetriesPerKey}`);
        const result = await callGeminiWithKey(apiKey, messages, systemPrompt);
        return result;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.warn(`Key ${keyIdx + 1} attempt ${attempt + 1} failed: ${errorMsg}`);

        // Wait before retrying (exponential backoff)
        if (attempt < maxRetriesPerKey - 1) {
          // Changed to slower cycle: 4 seconds for Try 2, 8 seconds for Try 3
          const wait = Math.pow(2, attempt + 1) * 2000;
          await new Promise(r => setTimeout(r, wait));
        }
      }
    }

    console.warn(`All ${maxRetriesPerKey} retries exhausted for API key ${keyIdx + 1}. Moving to next key...`);
  }

  throw new Error('ALL_KEYS_EXHAUSTED');
}

export async function POST(req: NextRequest) {
  const keys = getApiKeys();
  if (keys.length === 0) {
    return new Response('Gemini API key not configured. Please set GEMINI_API_KEY_1 in .env.local', { status: 503 });
  }

  try {
    const body = await req.json();
    const {
      district_name,
      state_name,
      headcount_ratio_2021,
      headcount_ratio_2016,
      district_csr_per_person,
      total_csr_recent,
      total_population,
      mpi_2021,
      computed_pos,
      pop_tier,
      tier_median_csr,
    } = body;

    const tierMedian = tier_median_csr ?? 127;
    const povChange = headcount_ratio_2016
      ? ((headcount_ratio_2021 - headcount_ratio_2016) * 100).toFixed(1)
      : 'N/A';
    const retentionRatio = headcount_ratio_2016 && headcount_ratio_2016 > 0
      ? (headcount_ratio_2021 / headcount_ratio_2016).toFixed(2)
      : 'N/A';

    const dataBlock = `
DATA FOR ${district_name.toUpperCase()} DISTRICT, ${state_name.toUpperCase()}:
- MPI Headcount Ratio (2019-21): ${(headcount_ratio_2021 * 100).toFixed(1)}% of population is multidimensionally poor
- MPI Score (2019-21): ${mpi_2021}
- Headcount Ratio baseline (2015-16): ${headcount_ratio_2016 ? (headcount_ratio_2016 * 100).toFixed(1) + '%' : 'not available'}
- Change from baseline: ${povChange} percentage points
- Poverty retention ratio: ${retentionRatio} (1.0 = no improvement, >1.0 = worsening)
- Total population (Census 2011): ${total_population ? Number(total_population).toLocaleString('en-IN') : 'not available'}
- Population tier: ${pop_tier || 'N/A'}
- CSR received FY2021-24: INR ${Number(total_csr_recent).toFixed(2)} crore
- CSR per person: INR ${Math.round(district_csr_per_person)}
- Tier median CSR per person: INR ${Math.round(tierMedian)}
- Shortfall vs tier median: INR ${Math.max(0, Math.round(tierMedian) - Math.round(district_csr_per_person))} per person
- Philanthropic Opportunity Score: ${Math.round(computed_pos)}/100`;

    const userPrompt = `Write a research brief for the following district. Use all data provided. Follow the required format with 5 bold-headed sections.

${dataBlock}`;

    let brief = await callGemini(
      [{ role: 'user', parts: [{ text: userPrompt }] }],
      SYSTEM_PROMPT
    );

    return new Response(brief, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('generate-brief error:', message);
    
    // User-friendly error message - hide technical details
    return new Response('Please try after some time.', { status: 500 });
  }
}