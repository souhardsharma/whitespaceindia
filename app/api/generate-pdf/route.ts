import { NextRequest } from 'next/server';
import React from 'react';
import { Document, Page, Text, View, StyleSheet, renderToBuffer, Link, Image } from '@react-pdf/renderer';

const NAVY = '#0B1526';
const AMBER = '#F5A623';
const WHITE = '#FFFFFF';
const NAVY_LIGHT = '#1A2B45';
const WHITE_DIM = '#8FA3BC';

const styles = StyleSheet.create({
  page: {
    backgroundColor: NAVY,
    paddingTop: 48,
    paddingBottom: 48,
    paddingLeft: 52,
    paddingRight: 52,
    fontFamily: 'Helvetica',
  },
  // ── Header ──────────────────────────────────────────────
  wordmark: {
    fontSize: 8,
    color: AMBER,
    letterSpacing: 3.5,
    marginBottom: 22,
  },
  districtName: {
    fontSize: 30,
    fontFamily: 'Helvetica-Bold',
    color: WHITE,
    lineHeight: 1.1,
    marginBottom: 4,
  },
  stateName: {
    fontSize: 13,
    color: WHITE_DIM,
    marginBottom: 18,
  },
  scoreBadgeWrap: {
    flexDirection: 'row',
    marginBottom: 28,
  },
  scoreBadge: {
    backgroundColor: AMBER,
    paddingTop: 5,
    paddingBottom: 5,
    paddingLeft: 10,
    paddingRight: 10,
    borderRadius: 3,
  },
  scoreBadgeText: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: NAVY,
    letterSpacing: 1.2,
  },
  // ── Divider ──────────────────────────────────────────────
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: NAVY_LIGHT,
    marginBottom: 24,
  },
  // ── Metric cards ────────────────────────────────────────
  metricsRow: {
    flexDirection: 'row',
    marginBottom: 28,
  },
  card: {
    flex: 1,
    borderWidth: 1,
    borderColor: NAVY_LIGHT,
    borderRadius: 4,
    padding: 14,
  },
  cardGap: {
    width: 10,
  },
  cardLabel: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: AMBER,
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  cardValue: {
    fontSize: 20,
    fontFamily: 'Helvetica-Bold',
    color: WHITE,
    lineHeight: 1,
    marginBottom: 4,
  },
  cardSubValue: {
    fontSize: 9,
    color: WHITE_DIM,
  },
  // ── Brief text ──────────────────────────────────────────
  briefSection: {
    marginBottom: 24,
  },
  heading: {
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
    color: AMBER,
    marginBottom: 8,
    marginTop: 6,
  },
  paragraph: {
    fontSize: 10,
    color: WHITE,
    lineHeight: 1.75,
    marginBottom: 11,
    fontFamily: 'Helvetica',
  },
  // ── Footer ───────────────────────────────────────────────
  footer: {
    borderTopWidth: 1,
    borderTopColor: NAVY_LIGHT,
    paddingTop: 14,
    marginTop: 'auto',
  },
  footerSources: {
    fontSize: 7,
    color: WHITE_DIM,
    lineHeight: 1.6,
    marginBottom: 4,
  },
  footerDate: {
    fontSize: 7,
    color: WHITE_DIM,
    opacity: 0.6,
  },
});

interface PdfPayload {
  districtName: string;
  stateName: string;
  briefText: string;
  mpiData: {
    headcount_ratio_2021: number;
    headcount_ratio_2016: number;
    mpi_2021: number;
  };
  csrData: {
    total_csr_recent: number;
    csr_per_person: number;
    national_average: number;
  };
  pos: number;
}

function buildDocument(payload: PdfPayload) {
  const { districtName, stateName, briefText, mpiData, csrData, pos } = payload;

  const mpiPct = (mpiData.headcount_ratio_2021 * 100).toFixed(1) + '%';
  const csrPerPerson = 'INR ' + Math.round(csrData.csr_per_person).toLocaleString('en-IN');
  const nationalAvg = 'INR ' + Math.round(csrData.national_average).toLocaleString('en-IN');
  const scoreLabel = Math.round(pos) + ' / 100';
  const generationDate = new Date().toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  // FIX 1: Split by ANY number of newlines to guarantee headings are isolated
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

      // Wordmark
      ce(Text, { style: styles.wordmark }, 'WHITESPACE INDIA  |  CSR'),

      // District & state
      ce(Text, { style: styles.districtName }, districtName),
      ce(Text, { style: styles.stateName }, stateName),

      // Score badge
      ce(
        View,
        { style: styles.scoreBadgeWrap },
        ce(
          View,
          { style: styles.scoreBadge },
          ce(Text, { style: styles.scoreBadgeText }, scoreLabel + '  ·  OPPORTUNITY SCORE')
        )
      ),

      // Divider
      ce(View, { style: styles.divider }),

      // Metric cards
      ce(
        View,
        { style: styles.metricsRow },
        ce(
          View,
          { style: styles.card },
          ce(Text, { style: styles.cardLabel }, 'MPI HEADCOUNT RATIO'),
          ce(Text, { style: styles.cardValue }, mpiPct),
          ce(Text, { style: styles.cardSubValue }, '2019 - 21  ·  NFHS-5')
        ),
        ce(View, { style: styles.cardGap }),
        ce(
          View,
          { style: styles.card },
          ce(Text, { style: styles.cardLabel }, 'CSR PER PERSON'),
          ce(Text, { style: styles.cardValue }, csrPerPerson),
          ce(Text, { style: styles.cardSubValue }, 'FY 2021 - 24  ·  MCA data')
        ),
        ce(View, { style: styles.cardGap }),
        ce(
          View,
          { style: styles.card },
          ce(Text, { style: styles.cardLabel }, 'TIER MEDIAN'),
          ce(Text, { style: styles.cardValue }, nationalAvg),
          ce(Text, { style: styles.cardSubValue }, 'CSR per person  ·  population tier')
        )
      ),

      // 🚨 UPGRADE 2: Consulting-Grade Data Visualization (QuickChart)
      ce(Image, { 
        src: `https://quickchart.io/chart?c={type:'bar',data:{labels:['District CSR','Tier Median'],datasets:[{label:'INR per person',backgroundColor:['%23F5A623','%231A2B45'],data:[${Math.round(csrData.csr_per_person)},${Math.round(csrData.national_average)}]}]}}`, 
        style: { width: '100%', height: 180, marginTop: 10, marginBottom: 24, borderRadius: 4 } 
      }),

      // Brief prose
      ce(
        View,
        { style: styles.briefSection },
        ...paragraphs.map((para: string, i: number) => {
          // FIX 2: Check if the string is EXACTLY a markdown heading
          const isHeading = para.startsWith('**') && para.endsWith('**') && para.split('**').length === 3;
          
          if (isHeading) {
            // It's a heading! Use the Amber/Bold heading style and strip asterisks
            return ce(Text, { key: String(i), style: styles.heading }, para.replace(/\*\*/g, ''));
          }

          // Otherwise, it's a paragraph. Let's check for inline bold words.
          const chunks = para.split('**');
          return ce(
            Text,
            { key: String(i), style: styles.paragraph },
            ...chunks.map((chunk, index) => {
              // In an array split by '**', every odd index was inside the asterisks
              if (index % 2 === 1) {
                return ce(Text, { key: `chunk-${index}`, style: { fontFamily: 'Helvetica-Bold' } }, chunk);
              }
              return chunk; // Normal text
            })
          );
        })
      ),

      // Footer
      ce(
        View,
        { style: styles.footer },
        ce(
          Text,
          { style: styles.footerSources },
          'Sources: ',
          ce(Link, { src: 'https://www.niti.gov.in/sites/default/files/2023-07/National-Multidimentional-Poverty-Index-2023-Final-17th-July.pdf', style: { color: WHITE_DIM, textDecoration: 'underline' } }, 'NITI Aayog MPI 2023 (NFHS-5)'),
          ' · ',
          ce(Link, { src: 'https://dataful.in/datasets/1612/', style: { color: WHITE_DIM, textDecoration: 'underline' } }, 'Ministry of Corporate Affairs CSR via Dataful.in'),
          ' · Census of India 2011'
        ),
        ce(
          Text,
          { style: styles.footerSources },
          'Brief text generated using Google Gemini 3 API. All underlying data from the public sources listed above.'
        ),
        ce(
          Text,
          { style: styles.footerSources },
          'Prepared by: ',
          ce(Link, { src: 'https://linkedin.com/in/souhardsharma', style: { color: AMBER, textDecoration: 'none' } }, 'Souhard Sharma (Whitespace India)')
        ),
        ce(Text, { style: styles.footerDate }, 'Generated ' + generationDate + '  ·  Whitespace India CSR')
      )
    )
  );
}

export async function POST(req: NextRequest) {
  const payload: PdfPayload = await req.json();

  const doc = buildDocument(payload);
  const buffer = await renderToBuffer(doc);

  const filename = `${payload.districtName.replace(/\s+/g, '-')}-brief.pdf`;

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`
    }
  });
}