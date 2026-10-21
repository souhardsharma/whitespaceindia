import { NextRequest } from 'next/server';
import { isAllowedOrigin, clientIp } from '@/lib/request-identity';
import {
  obligationDetermination, resolveDetermination, resolveSite,
} from '@/lib/instruments/determination';
import {
  obligationsFor, sortObligations,
  type LegalReference, type ObligationSubject,
} from '@/lib/instruments/obligations';
import type { Determination } from '@/lib/instruments/determination';
import { locationEvidence } from '@/lib/instruments/location';
import { LINKS_BLANK, LINKS_NONE, LINKS_UNREAD, linkedClearanceLines } from '@/lib/instruments/links';
import { forestRecord, shard as cachedShard } from '@/lib/instruments/server';
import React from 'react';
import fs from 'fs';
import path from 'path';
import {
  Document, Page, Text, View, StyleSheet, renderToBuffer, Font, Link,
} from '@react-pdf/renderer';

/**
 * Deterministic PDF export for one proposal profile.
 *
 * Every figure the instrument shows carries its own definition, source and
 * vintage, so the export contains exactly what the screen contains: values
 * joined to their definitions, obligations joined to their provisions, and
 * the citations for both.
 *
 * Security controls mirror app/api/brief/route.ts: origin checking, a token
 * bucket per IP, and validation of every input before it reaches the filesystem.
 */

export const maxDuration = 60;

const DATA_DIR = path.join(process.cwd(), 'public', 'data', 'instruments', 'consent');

// ── security ──────────────────────────────────────────────────────────────
const rateLimitMap = new Map<string, { tokens: number; lastRefill: number }>();
const RATE_LIMIT_MAX_TOKENS = 10;
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


/** State slugs are used to build a filesystem path, so they are validated
 *  against a strict pattern rather than sanitised. Anything else is rejected. */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ID_RE = /^[0-9]{1,12}$/;

// ── fonts ─────────────────────────────────────────────────────────────────
Font.register({
  family: 'Lora',
  fonts: [
    { src: 'https://fonts.gstatic.com/s/lora/v37/0QI6MX1D_JOuGQbT0gvTJPa787weuyJG.ttf', fontWeight: 400 },
    { src: 'https://fonts.gstatic.com/s/lora/v37/0QI6MX1D_JOuGQbT0gvTJPa787z5vCJG.ttf', fontWeight: 700 },
  ],
});
Font.register({
  family: 'Karla',
  fonts: [
    { src: 'https://fonts.gstatic.com/s/karla/v33/qkBIXvYC6trAT55ZBi1ueQVIjQTD-JqqFA.ttf', fontWeight: 400 },
    { src: 'https://fonts.gstatic.com/s/karla/v33/qkBIXvYC6trAT55ZBi1ueQVIjQTDH52qFA.ttf', fontWeight: 700 },
  ],
});

const PAPER = '#fcf9f4';
const PLUM = '#7a3b6b';
const INK = '#1c1c19';
const DIM = '#5b5f62';

const s = StyleSheet.create({
  page: { backgroundColor: PAPER, padding: 40, fontFamily: 'Karla', fontSize: 9, color: INK },
  eyebrow: { fontSize: 7, letterSpacing: 1.6, color: PLUM, marginBottom: 6 },
  h1: { fontFamily: 'Lora', fontWeight: 700, fontSize: 19, lineHeight: 1.2, marginBottom: 8 },
  h2: { fontFamily: 'Lora', fontWeight: 700, fontSize: 12, marginTop: 16, marginBottom: 6 },
  meta: { fontSize: 8, color: DIM, marginBottom: 2 },
  rule: { borderBottomWidth: 1, borderBottomColor: INK, marginVertical: 10 },
  ruleThin: { borderBottomWidth: 0.5, borderBottomColor: '#d8d3ca', marginVertical: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  label: { fontSize: 8.5, flex: 1, paddingRight: 10 },
  value: { fontSize: 9.5, fontWeight: 700 },
  defn: { fontSize: 6.8, color: DIM, marginTop: 1, lineHeight: 1.35 },
  small: { fontSize: 7.5, color: DIM, lineHeight: 1.45 },
  body: { fontSize: 8.5, lineHeight: 1.5, marginBottom: 5 },
  badge: { fontSize: 6.5, letterSpacing: 1, color: PLUM },
  footer: {
    position: 'absolute', bottom: 22, left: 40, right: 40,
    fontSize: 6.5, color: DIM, borderTopWidth: 0.5, borderTopColor: '#d8d3ca', paddingTop: 5,
  },
});

const nf = new Intl.NumberFormat('en-IN');

function fmt(v: number | null, unit: string): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'no figure published';
  if (unit === 'percent') return `${v.toFixed(1)}%`;
  if (unit === 'count') return nf.format(v);
  if (unit === 'hectare') return `${nf.format(v)} ha`;
  return String(v);
}

function readJson(file: string): any {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf-8'));
}

export async function POST(req: NextRequest) {
  if (!isAllowedOrigin(req)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
  }
  // See clientIp: the leftmost X-Forwarded-For entry is caller-controlled, so
  // keying a limiter on it lets one header evade the limit - or exhaust the
  // bucket of any address the caller chooses to name.
  const ip = clientIp(req);
  if (!checkRateLimit(ip)) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), { status: 429 });
  }

  let body: { proposalId?: string; state?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const proposalId = String(body.proposalId ?? '');
  const state = String(body.state ?? '');
  if (!ID_RE.test(proposalId) || !SLUG_RE.test(state)) {
    return new Response(JSON.stringify({ error: 'Invalid proposalId or state' }), { status: 400 });
  }

  // Through the server's shard cache (slug-validated there too). Parsing the
  // file afresh made every export cost a full shard - 11 MB for Rajasthan -
  // of CPU and heap, which a loop of requests turns into the deployment's
  // quota.
  const shard = cachedShard(state);
  if (!shard) {
    return new Response(JSON.stringify({ error: 'Unknown state' }), { status: 404 });
  }
  const F = (n: string) => shard.fields.indexOf(n);
  const row = (shard.rows as any[][]).find((r) => String(r[F('id')]) === proposalId);
  if (!row) {
    return new Response(JSON.stringify({ error: 'Proposal not found' }), { status: 404 });
  }

  const meta = readJson('meta.json');
  const registry = readJson('measures.json');
  const districts = readJson('districts.json');
  let legal: LegalReference | null = null;
  try { legal = readJson('legal_reference.json'); } catch { /* optional */ }

  const districtCode = row[F('dc')];
  const district = districtCode ? districts[String(districtCode)] : null;
  // Over every district the filing names. The PDF is the artefact a reader
  // takes away and cites, so it must not say a Scheduled-Area obligation
  // "does not apply" to a project that names a scheduled district - which
  // reading only the modal district did, on 224 proposals.
  const determination: Determination | null = resolveDetermination(
    legal?.determinations as Record<string, Determination> | undefined,
    districtCode as number | null,
    (row[F('dall')] as number[]) ?? null,
  ).governing;

  // THE SAME NARROWING THE SCREEN APPLIES.
  //
  // A district an Order names only in part cannot answer for one project -
  // unless the Order names, in whole, a sub-division the filing places the
  // project in. `resolveSite` does that and `obligationDetermination` raises
  // the answer from `partial` to `within`, which turns Gram Sabha consent from
  // "may apply" into "applies" under RFCTLARR section 41(3).
  //
  // The screen did this and this document did not, so for 1,114 proposals the
  // page said consent is a legal precondition and the PDF a reader downloads
  // and cites said it merely might be. That is a disagreement about the law
  // between two renderings of one record, and the weaker one travels.

  const project = {
    name: row[F('name')] as string,
    no: row[F('no')] as string,
    agency: (row[F('agency')] as string || '').trim(),
    sector: shard.sectors[row[F('sector')] as number],
    category: row[F('cat')] as string,
    status: shard.statuses[row[F('status')] as number],
    date: row[F('date')] as string,
    authority: row[F('auth')] !== null ? shard.authorities[row[F('auth')] as number] : null,
    land: row[F('land')] as number | null,
    forest: row[F('forest')] as number | null,
    affected: row[F('af')] as number | null,
    displaced: row[F('df')] as number | null,
    rnr: row[F('rnr')] as string | null,
    villages: row[F('nv')] as number | null,
    resolution: row[F('dm')] as string,
    formStatus: row[F('cf')] as string | null,
  };

  // The location sentence, from the same module the screen uses, over the
  // same three statements of place. See lib/instruments/location.ts.
  const RESOLUTION_BY_CODE: Record<string, string> = {
    v: 'village', s: 'subdistrict', d: 'lgd_district', n: 'project_name',
    a: 'adjudicated', c: 'town_settled', x: 'unresolved',
  };
  const evidenceNames: Record<string, string> = {};
  for (const c of [districtCode, ...((row[F('dall')] as number[]) ?? []),
                   F('dd') >= 0 ? row[F('dd')] : null, row[F('gd')]]) {
    if (c != null && districts[String(c)]) {
      evidenceNames[String(c)] = districts[String(c)].district_name;
    }
  }
  const evidence = locationEvidence({
    resolution: RESOLUTION_BY_CODE[project.resolution] ?? 'unresolved',
    district: (districtCode as number | null) ?? null,
    allDistricts: (row[F('dall')] as number[]) ?? null,
    declaredDistrict: F('dd') >= 0 ? ((row[F('dd')] as number) ?? null) : null,
    villageCount: project.villages,
    verdict: (row[F('gk')] as string) ?? null,
    fallsIn: (row[F('gd')] as number) ?? null,
  }, evidenceNames);

  // WHAT `evaluateTrigger` ACTUALLY READS.
  //
  // The local `project` above is flat - `land`, `forest`, `displaced` at the
  // top level - because that is what this document renders. `evaluateTrigger`
  // reads a `Project`, whose declared figures live under `declared`. Passing
  // the flat object with a type-escaping cast compiled and then threw on
  // `declared.totalLandHa`, so the export 500'd for every proposal. The shape
  // is built explicitly rather than cast, and it carries exactly the five
  // fields the triggers read: category, sector, and the three declared
  // figures plus the R&R flag.
  const obligationProject: ObligationSubject = {
    category: project.category ?? null,
    sector: project.sector ?? '',
    links: F('lk') >= 0 ? ((row[F('lk')] as ObligationSubject['links']) ?? null) : null,
    declared: {
      totalLandHa: project.land ?? null,
      forestLandHa: project.forest ?? null,
      affectedFamilies: project.affected ?? null,
      displacedFamilies: project.displaced ?? null,
      rnrInvolved: project.rnr ?? null,
      litigationPending: null,
      violationInvolved: null,
    },
  };

  const siteDetermination = obligationDetermination(
    determination,
    resolveSite(determination, (row[F('sd')] as number[]) ?? null),
  );


  const groups = ['population', 'livelihood', 'infrastructure', 'circumstances'] as const;
  const factsByGroup = groups.map((g) => ({
    group: g,
    title: registry.groups[g] as string,
    items: Object.entries(registry.measures)
      .filter(([, m]: any) => m.group === g && !m.internal)
      .map(([id, m]: any) => ({
        id,
        label: m.label as string,
        unit: m.unit as string,
        definition: m.definition as string,
        source: m.source as string,
        vintage: m.vintage as string,
        value: district ? (district.values[id] ?? null) : null,
        // Benchmarks only for rates and ratios; comparing an absolute count to a
        // national total is arithmetic without meaning.
        benchmark: m.kind === 'count' ? null : (registry.benchmarks.india[id] ?? null),
      })),
  }));

  const generated = new Date().toISOString().slice(0, 10);
  // WHEN THE REGISTER WAS READ, which is not when this PDF was made. The
  // document carried only its own generation date beside a "live register"
  // status, so a reader taking it away could not tell a figure read this
  // morning from one read three weeks ago - and the PDF is the artefact that
  // outlives the page and gets cited.
  let registerReadAt: string | null = null;
  try {
    registerReadAt = (readJson('freshness.json') as { checked_at?: string })
      ?.checked_at?.slice(0, 10) ?? null;
  } catch { /* the page states it too; absence is not fatal here */ }

  const doc = React.createElement(
    Document,
    { title: `People & Consent: ${project.no}`, author: 'Whitespace India' },
    React.createElement(
      Page,
      { size: 'A4', style: s.page },
      React.createElement(Text, { style: s.eyebrow }, 'WHITESPACE INDIA · PEOPLE & CONSENT · PROFILE OF ONE CLEARANCE PROPOSAL'),
      React.createElement(Text, { style: s.h1 }, project.name),
      React.createElement(Text, { style: s.meta },
        `${project.no} · ${project.category ? `Category ${project.category}` : 'No category recorded'} · ${project.status}` +
        (project.authority ? ` · ${project.authority}` : '')),
      React.createElement(Text, { style: s.meta },
        `${project.agency || 'Applicant not recorded'} · ${project.sector} · submitted ${project.date}`),
      React.createElement(View, { style: s.rule }),

      // location
      React.createElement(Text, { style: s.h2 }, 'Area profiled'),
      district
        ? React.createElement(React.Fragment, null,
            React.createElement(Text, { style: s.body },
              `${district.district_name}, ${district.state_name}`),
            React.createElement(Text, { style: s.small },
              (evidence.contested ? 'The location is uncertain. ' : '') +
                evidence.sentences.join(' ')))
        // THE SAME THREE SILENCES THE SCREEN DISTINGUISHES.
        //
        // This said "the application records no village, sub-district or
        // district" for every unplaced proposal. 456 reach this branch and
        // only 266 were read and found to name no place: for 189 the
        // Ministry's portal answers that it serves NO form at all, and for 1
        // this instrument has not read the form yet. The sentence charged a
        // named company with an omission in a public regulatory filing on 190
        // proposals where no such omission is known - in the document a
        // reader downloads and cites. The screen was fixed; this was not.
        : React.createElement(Text, { style: s.body },
            project.formStatus === 'none'
              ? 'The location of this project could not be determined. The PARIVESH ' +
                'portal of the Ministry of Environment, Forest and Climate Change serves ' +
                'no Common Application Form for this proposal, so we could read no filed ' +
                'location, and the project’s title names no district we can match to the ' +
                'Census 2011 list. No population profile is shown, because a state ' +
                'average would describe a far larger area than the site.'
              : project.formStatus === 'pend'
              ? 'The location of this project is not yet known. We have not yet read ' +
                'the Common Application Form for this proposal, and the project’s title ' +
                'names no district we can match to the Census 2011 list. No population ' +
                'profile is shown, because a state average would describe a far larger ' +
                'area than the site.'
              : 'The location of this project could not be determined. This proposal’s ' +
                'Common Application Form records no village, sub-district or district, ' +
                'and the project’s title names no district we can match to the Census ' +
                '2011 list. No population profile is shown, because a state average would ' +
                'describe a far larger area than the site.'),

      // declared
      (project.land || project.affected || project.displaced || project.rnr === 'YES')
        ? React.createElement(React.Fragment, null,
            React.createElement(Text, { style: s.h2 }, 'Declared by the applicant'),
            React.createElement(Text, { style: s.small },
              [
                project.land != null
                  ? `The project uses land recorded as ${nf.format(project.land)}, and the filing gives no unit for that figure.`
                  : null,
                project.forest
                  ? `It involves forest land recorded as ${nf.format(project.forest)}, again with no unit given.`
                  : null,
                project.displaced ? `${nf.format(project.displaced)} families will be displaced.` : null,
                project.affected ? `${nf.format(project.affected)} families will be affected.` : null,
                project.rnr === 'YES' ? 'The project involves rehabilitation and resettlement.' : null,
              ].filter(Boolean).join(' ')),
            React.createElement(Text, { style: s.defn },
              "These figures come from the applicant's own filing, and we have not checked them against any other record."))
        : null,

      // other clearances and the land - the same lines the screen shows
      React.createElement(Text, { style: s.h2 }, 'Other clearances and land tenure'),
      ...(() => {
        const links = F('lk') >= 0 ? ((row[F('lk')] as ObligationSubject['links']) ?? null) : null;
        const fr = forestRecord({ links } as never);
        const { state, lines } = linkedClearanceLines(links ?? null, fr);
        if (state === 'unread') return [React.createElement(Text, { style: s.small }, LINKS_UNREAD)];
        if (state === 'none') return [React.createElement(Text, { style: s.small }, LINKS_NONE)];
        if (state === 'blank') return [React.createElement(Text, { style: s.small }, LINKS_BLANK)];
        return lines.map((l) => React.createElement(Text, { style: s.small, key: l.label },
          `${l.label}: ${l.text}${l.note ? ' ' + l.note : ''}`));
      })(),
      React.createElement(Text, { style: s.defn },
        "This section reports the application form's own declarations."),

      // consent screening
      //
      // This MUST render the determination the instrument actually holds. An
      // earlier version printed a fixed "reports it as NOT DETERMINED"
      // paragraph, written before the legal reference table existed. Once that
      // table was built the sentence became false for the 83 districts with a
      // determination: the screen said Surguja is within a Scheduled Area under
      // C.O. 192 and the PDF of the same profile said its status was not
      // determined. A document that contradicts the screen it was exported from
      // is worse than one that says nothing.
      React.createElement(Text, { style: s.h2 }, 'Scheduled Area status'),
      React.createElement(Text, { style: s.body },
        determination
          ? determination.status === 'within'
            ? 'The district lies within a Fifth Schedule Scheduled Area.'
            : determination.status === 'partial'
            ? 'Part of the district lies within a Fifth Schedule Scheduled Area.'
            : determination.status === 'outside'
            ? 'The district is not in a Fifth Schedule Scheduled Area.'
            : 'Whether the district is in a Scheduled Area has not been determined.'
          : 'Whether the district is in a Scheduled Area has not been determined.'),
      determination?.note
        ? React.createElement(Text, { style: s.small }, determination.note)
        : null,
      determination?.instrument
        ? React.createElement(Text, { style: s.defn },
            `Legal source: ${determination.instrument}` +
            (determination.provision ? ` · ${determination.provision}` : '') +
            (determination.citation ? ` · ${determination.citation}` : ''))
        : null,
      React.createElement(Text, { style: s.small },
        'Scheduled Areas are declared by Presidential Order under paragraph 6 of the Fifth Schedule, ' +
        'and no official list of them exists in a form a program can read, so we determined each ' +
        'status from the Orders themselves. Where an Order names the place, the status is read from ' +
        'that Order and cited to it. Where no Order covers the State, the status follows from that ' +
        'absence, cited to the Ministry of Tribal Affairs index of Orders in force. Assam, Meghalaya, ' +
        'Tripura and Mizoram are treated separately because Article 244(1) applies the Fifth Schedule ' +
        'to the Scheduled Areas of every other State, while Article 244(2) applies the Sixth Schedule ' +
        'to the tribal areas of those four. The Scheduled Tribe share of the population plays no part ' +
        'in the determination, because many districts with a large tribal population lie outside ' +
        'every Scheduled Area.' +
        (determination?.status === 'partial'
          ? ' A partial determination means the Order schedules only part of this district. Where ' +
            'the filing places the project in a sub-district the Order names in whole, the legal ' +
            'duties at the end of this document treat the site as inside the Scheduled Area; ' +
            'otherwise the district record alone cannot say whether the site falls inside it.'
          : '')),

      React.createElement(Text, { style: s.footer },
        `Generated ${generated} by Whitespace India, People & Consent. ` +
        (registerReadAt
          ? `We last read the clearance register on ${registerReadAt}, and ` +
            `figures drawn from it are current to that date. `
          : `The date we last read the clearance register is unknown for ` +
            `this copy, so figures drawn from it cannot be dated. `) +
        `Population and work figures come from Census 2011, the most recent census published ` +
        `at sub-district level, and household circumstances from the Socio Economic and Caste ` +
        `Census 2011.`)
    ),

    // fact pages
    ...factsByGroup.filter((g) => district).map((g) =>
      React.createElement(
        Page,
        { size: 'A4', style: s.page, key: g.group },
        React.createElement(Text, { style: s.eyebrow },
          `${String(g.title).toUpperCase()} · ${district.district_name.toUpperCase()}`),
        React.createElement(View, { style: s.rule }),
        ...g.items.map((f) =>
          React.createElement(
            View, { key: f.id, wrap: false },
            React.createElement(View, { style: s.row },
              React.createElement(Text, { style: s.label }, f.label),
              React.createElement(Text, { style: s.value }, fmt(f.value, f.unit))),
            React.createElement(Text, { style: s.defn }, f.definition),
            React.createElement(Text, { style: s.defn },
              `${f.source} · ${f.vintage}` +
              (f.benchmark !== null ? ` · India: ${fmt(f.benchmark, f.unit)}` : '')),
            React.createElement(View, { style: s.ruleThin })
          )),
        React.createElement(Text, { style: s.footer },
          `Generated ${generated} · Whitespace India, People & Consent · each figure is listed with its source and the year of its data`)
      )),

    // obligations
    legal ? React.createElement(
      Page,
      { size: 'A4', style: s.page },
      React.createElement(Text, { style: s.eyebrow }, 'LEGAL DUTIES AND WHETHER THEY APPLY'),
      React.createElement(View, { style: s.rule }),
      React.createElement(Text, { style: s.small },
        'We compiled each entry by hand from the text of the law or standard and cite the provision ' +
        "it rests on. Whether each one applies depends on what this proposal's own filing " +
        'establishes and on the Scheduled Area determination for every district it names; the ' +
        'population figures play no part in it. ' +
        `We last reviewed the list on ${legal.last_reviewed}.`),
      React.createElement(View, { style: s.ruleThin }),
      // THE VERDICT, which this document used to omit entirely.
      //
      // It printed all fifteen obligations under the heading "OBLIGATIONS THAT
      // ATTACH", with the requirement, the trigger and the review date but no
      // statement of whether any of them applies to THIS proposal - so the
      // artefact a reader takes away and cites told them that fifteen statutory
      // duties attached to their project, when the screen they downloaded it
      // from said most of them did not. It is computed here by the same
      // function the screen uses, from the same inputs, so the two cannot
      // drift apart again.
      ...sortObligations(obligationsFor(legal, obligationProject,
                                        siteDetermination))
        .map((o, i: number) =>
          React.createElement(
            View, { key: i, wrap: false, style: { marginBottom: 8 } },
            React.createElement(Text, { style: { ...s.value, fontSize: 8.5 } },
              `${o.instrument}, ${o.provision}`),
            React.createElement(Text, { style: s.body }, o.requirement),
            React.createElement(Text, { style: s.defn }, `Applies when: ${o.trigger}`),
            o.note ? React.createElement(Text, { style: s.defn }, `Note: ${o.note}`) : null,
            React.createElement(Text, { style: { ...s.value, fontSize: 8 } },
              o.applies === 'yes' ? 'APPLIES'
                : o.applies === 'conditional' ? 'MAY APPLY'
                : o.applies === 'no' ? 'DOES NOT APPLY'
                : 'NOT DETERMINED'),
            React.createElement(Text, { style: s.defn },
              `Reviewed ${o.lastReviewed}${o.verified ? ' · checked against the text of the law or standard' : ' · not yet checked against the text of the law or standard'}`),
            React.createElement(View, { style: s.ruleThin })
          )),
      React.createElement(Text, { style: s.footer },
        `Generated ${generated} · Whitespace India, People & Consent`)
    ) : null
  );

  const buffer = await renderToBuffer(doc);
  const filename = `people-and-consent-${project.no.replace(/[^A-Za-z0-9]+/g, '-')}.pdf`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
