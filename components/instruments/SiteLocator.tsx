"use client";

/**
 * Where the filed coordinates put this project, inside the district it names.
 *
 * WHAT THE POINT IS
 * -----------------
 * NOT the centre of the site's envelope. A project is a set of places - a mine
 * is one mapped block, an expressway is four hundred across two states - and
 * the centre of an envelope drawn round all of them can fall where no part of
 * the project is. One observed filing produced a 590 km "the coordinates are
 * elsewhere" verdict that existed only because of that reduction. The point
 * drawn here is the block the geometric verdict actually rests on, which is
 * what the build publishes in `lat`/`lon`.
 *
 * WHAT THE VERDICT MEANS
 * ----------------------
 * The build tests every mapped block against every district the filing names.
 * `inside` means at least one block falls in one of them. `elsewhere` means
 * none did - which is a disagreement worth showing, not an error to hide, and
 * it is drawn with the district outline so a reader can see the distance for
 * themselves rather than take the word for it.
 *
 * The map is decoration only if the verdict is already stated in words. It is,
 * beneath - so a reader who cannot see the outline still gets the finding.
 */

import { useEffect, useMemo, useState } from "react";
import { geoContains, geoMercator, geoPath } from "d3-geo";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { RAMP } from "@/lib/instruments/choropleth";

const GEO_URL = "/geo/districts-2011.geojson";
const INK = "#1c1c19";
const W = 340;
const H = 300;

interface Props {
  /** Census codes the filing names. The outline is drawn for all of them. */
  districts: number[];
  lat: number | null;
  lon: number | null;
  /** inside | boundary | elsewhere | offshore | unmapped | no_geometry */
  verdict: string | null;
  /** District the coordinates actually fall in, when it is not one named. */
  fallsIn?: number | null;
  /** Distinct mapped blocks the filing carries. */
  blocks?: number | null;
  /**
   * What qualifies this location, from the shard's `sq`.
   *
   * Carries "rej" when the filing DID map blocks and every one of them was
   * malformed and discarded by this instrument. 354 proposals are in that
   * state, and saying "this filing records no site coordinates" about them
   * puts our own rejection in the proponent's mouth - the same not-ours/
   * not-theirs distinction the rest of this instrument is built on.
   */
  quality?: string | null;
  /**
   * Whether the regulator's form was read: ok | nogeo | none | pend.
   * "This filing records no site coordinates" is only true of a form that was
   * read. For 70 placed proposals the Ministry serves no form at all, and the
   * sentence charged the proponent with an omission from a document that does
   * not exist.
   */
  formStatus?: string | null;
  /**
   * How the district was established. "Its district comes from the codes in
   * the application form" is only true of village, sub-district and LGD
   * resolutions; for 73 placed proposals it came from the project's title.
   */
  resolution?: string | null;
  /**
   * The outlines to draw, supplied by the server. When present nothing is
   * fetched: the national boundary file is 1.1 MB, and a proposal page needs
   * two or three of its 640 districts.
   */
  features?: GeoFeature[] | null;
}

const VERDICT_TEXT: Record<string, string> = {
  inside:
    "The filed coordinates fall inside a district this proposal names.",
  boundary:
    "The filed coordinates fall on the boundary of a district this proposal names.",
  elsewhere:
    "The filed coordinates do not fall in any district this proposal names.",
  offshore:
    "The filed coordinates fall outside every district boundary — at sea.",
  // NOT "at sea". The boundary source carries about 98,700 km2 of Jammu &
  // Kashmir under "Data Not Available", and a point there falls in no
  // district for a reason that has nothing to do with the site. Published as
  // `offshore`, it told readers that seven filings - among them the 240 MW
  // Uri-I Stage-II hydroelectric project on the Jhelum, 16 km from the
  // nearest mapped district - were in the sea.
  unmapped:
    "The boundary source does not map this ground, so the coordinates could " +
    "not be tested against a district. This says nothing about the site.",
  no_geometry:
    "No boundary was available to test the filed coordinates against.",
};

export default function SiteLocator({
  districts,
  lat,
  lon,
  verdict,
  fallsIn,
  blocks,
  quality,
  formStatus,
  resolution,
  features,
}: Props) {
  const [geo, setGeo] = useState<{ features: GeoFeature[] } | null>(
    features ? { features } : null,
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // No coordinates, no map: the component returns a two-sentence text block
    // in that case and never reads `geo`. Hooks run in declaration order and
    // an effect is scheduled whatever the component returns, so without this
    // guard the 747 proposals that record no site still downloaded 371 KB
    // gzipped of national boundary, parsed 1.08 MB of JSON into state, and
    // threw it away. The early return is 80 lines below and cannot help.
    if (lat == null || lon == null) return;
    if (features) return;
    let live = true;
    fetch(GEO_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (live) setGeo(d);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [lat, lon, features]);

  // Keyed on the CONTENTS, not the array identity. Callers build this prop
  // inline - `Array.from(new Set([...]))` in ProjectProfile - so it is a fresh
  // array on every parent render even when the codes are identical, and both
  // memos below then re-ran on every unrelated state change: re-filtering 640
  // features, re-fitting a projection and re-serialising every path, for the
  // same answer. Fixed here rather than at the call site so a future caller
  // cannot reintroduce it by passing another inline array.
  const districtKey = districts.join(",");
  // Built from the key itself, so the dependency list is the whole truth
  // about what this memo reads.
  const wanted = useMemo(() => {
    const set = new Set(
      districtKey ? districtKey.split(",").map((c) => Number(c)) : [],
    );
    if (fallsIn != null) set.add(fallsIn);
    return set;
  }, [districtKey, fallsIn]);

  const { paths, point } = useMemo(() => {
    if (!geo) return { paths: [], point: null };
    const shown = geo.features.filter((f) => wanted.has(Number(f.id)));
    if (shown.length === 0) return { paths: [], point: null };

    // Fitted to the districts AND the point together, so a project whose
    // coordinates fall well outside the district it names is drawn with both
    // visible. Fitting to the districts alone would push the point off the
    // canvas in exactly the case worth looking at.
    const collection: FeatureCollection<Geometry> = {
      type: "FeatureCollection",
      features:
        lat != null && lon != null
          ? [
              ...shown,
              {
                type: "Feature",
                id: -1,
                properties: {},
                geometry: { type: "Point", coordinates: [lon, lat] },
              } satisfies GeoFeature,
            ]
          : shown,
    };
    const projection = geoMercator().fitExtent(
      [
        [14, 14],
        [W - 14, H - 14],
      ],
      collection,
    );
    const path = geoPath(projection);
    return {
      paths: shown.map((f) => ({
        id: Number(f.id),
        d: path(f) ?? "",
        named: districts.includes(Number(f.id)),
      })),
      point:
        lat != null && lon != null
          ? (projection([lon, lat]) as [number, number] | null)
          : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo, wanted, lat, lon, districtKey]);

  // The name comes from the boundary file this component already loads, whose
  // features carry it. Importing districts.json for it would put 471 KB into
  // the bundle of a client component to render one word.
  const fallsInName = useMemo(() => {
    if (fallsIn == null || !geo) return null;
    const f = geo.features.find((x) => Number(x.id) === fallsIn);
    const props = f?.properties as { district?: string } | undefined;
    return props?.district ?? null;
  }, [geo, fallsIn]);

  const text = verdict ? VERDICT_TEXT[verdict] ?? null : null;
  const hasCoords = lat != null && lon != null;

  /**
   * Whether the marker is drawn OUTSIDE the outline the sentence names.
   *
   * The verdict is computed against the full Census shapefile; this map is
   * drawn on a Douglas-Peucker simplified copy, because the full boundaries are
   * far too large to serve. At national zoom the difference is a fifth of a
   * pixel. Here it is not: this component fits the projection to one district,
   * so a degree is hundreds of pixels and a 150 m divergence is visible.
   *
   * Measured over the register: 1,229 of 85,187 `inside` proposals have their
   * marker fall outside every named district's simplified outline, 934 of them
   * inside a neighbour's - median 152 m out, up to 1.02 km. A reader then sees
   * a dot beyond the line above a sentence saying it is within it, in the one
   * component that exists so they need not take our word for it.
   *
   * The verdict is the accurate statement and the drawing is the approximation,
   * so the drawing is what gets the caveat.
   */
  const drawnOutside = useMemo(() => {
    if (verdict !== "inside" || lat == null || lon == null || !geo) return false;
    const named = geo.features.filter((f) => districts.includes(Number(f.id)));
    if (named.length === 0) return false;
    return !named.some((f) => {
      try {
        return geoContains(f, [lon, lat]);
      } catch {
        return false;
      }
    });
  }, [geo, districts, lat, lon, verdict]);

  if (!hasCoords) {
    // Four different silences, and only one of them is the proponent's: no
    // form served (the Ministry's), a form not yet read (ours), blocks this
    // instrument discarded (ours), and a form that was read and maps nothing
    // (the filing's). Where the district came from is a separate question
    // with its own answer - the form's codes, or only the project's title.
    const discarded = typeof quality === "string" && quality.includes("rej");
    const fromTitle = resolution === "project_name";
    const why =
      formStatus === "none"
        ? "The Ministry’s portal serves no application form for this proposal, so there are no filed coordinates to place on a map."
        : formStatus === "pend"
          ? "This instrument has not yet read this proposal’s application form, so it has no coordinates to place on a map yet."
          : discarded
            ? "This filing does map a site, but every mapped block in it was malformed and was discarded by this instrument, so there is nothing it can place on a map. That is a limit of what this instrument could read, not a gap in the filing."
            : "This filing records no site coordinates, so there is nothing to place on a map.";
    const where = fromTitle
      ? "Its district was read from the project’s title, which is weaker evidence than a location filed on the form."
      : "Its district comes from the codes in the application form.";
    return (
      <div className="border border-dashed border-[#1c1c19]/30 p-4">
        <p className="font-body text-[13px] leading-relaxed opacity-70">
          {why} {where}
        </p>
      </div>
    );
  }

  const label =
    `${text ?? "Filed coordinates"} ` +
    `Latitude ${lat.toFixed(4)}, longitude ${lon.toFixed(4)}.` +
    (blocks && blocks > 1
      ? ` The filing maps ${blocks} separate blocks; the point shown is the one the verdict rests on.`
      : "") +
    (drawnOutside
      ? " The outline drawn is simplified, so the point sits slightly outside it here;"
        + " the verdict is computed against the full boundary."
      : "");

  return (
    <div className="mb-6">
      <h3 className="font-label text-[10px] uppercase tracking-[0.18em] opacity-75 mb-2">
        Where the filing puts it
      </h3>

      {/* No role here. This box also renders three states that are NOT a map -
          load failure, loading, and "no boundary is held" - and role="img"
          would prune each of them and announce the verdict label instead,
          telling a screen reader a map was drawn when none was. The role sits
          on the SVG alone, below. */}
      <div className="border border-[#1c1c19] bg-[#fcf9f4]">
        {failed ? (
          <p className="font-body text-[13px] p-4 opacity-70">
            The district outline could not be loaded. The coordinates and the
            verdict are stated below.
          </p>
        ) : !geo ? (
          <p className="font-body text-[13px] p-4 opacity-70">Loading&hellip;</p>
        ) : paths.length === 0 ? (
          <p className="font-body text-[13px] p-4 opacity-70">
            No boundary is held for the district this filing names.
          </p>
        ) : (
          <svg
            width="100%"
            viewBox={`0 0 ${W} ${H}`}
            style={{ display: "block" }}
            role="img"
            aria-label={label}
          >
            {paths.map((p) => (
              <path
                key={p.id}
                d={p.d}
                fill={p.named ? "rgba(122,59,107,0.10)" : "rgba(28,28,25,0.05)"}
                stroke={p.named ? INK : "rgba(28,28,25,0.35)"}
                strokeWidth={p.named ? 1.1 : 0.8}
                strokeDasharray={p.named ? undefined : "3 2"}
              />
            ))}
            {point ? (
              <>
                {/* A 2px surface ring, so the marker stays legible wherever it
                    lands - including on top of the outline it is being
                    compared against. */}
                <circle cx={point[0]} cy={point[1]} r="7" fill="#fcf9f4" />
                <circle
                  cx={point[0]}
                  cy={point[1]}
                  r="5"
                  fill={verdict === "inside" ? RAMP[3] : RAMP[0]}
                  stroke={INK}
                  strokeWidth="1.5"
                />
              </>
            ) : null}
          </svg>
        )}
      </div>

      <p className="font-body text-[13px] leading-relaxed opacity-75 mt-2">
        {text}{" "}
        <span className="tabular-nums">
          {lat.toFixed(4)}, {lon.toFixed(4)}
        </span>
        {fallsIn != null && !districts.includes(fallsIn) ? (
          <>
            {" "}They fall in{" "}
            <strong>{fallsInName ?? `district ${fallsIn}`}</strong>,
            drawn dashed.
          </>
        ) : null}
        {blocks && blocks > 1 ? (
          <>
            {" "}The filing maps {blocks} separate blocks; the point shown is
            the one the verdict rests on, not the centre of them all.
          </>
        ) : null}
        {drawnOutside ? (
          <>
            {" "}The outline drawn here is simplified for the web, so at this
            zoom the point can sit a few hundred metres the wrong side of it.
            The verdict above is computed against the full Census boundary, not
            this outline.
          </>
        ) : null}
      </p>
    </div>
  );
}

// A real GeoJSON Feature. The local shape typed `geometry` as `unknown`, so
// every hand-off to d3-geo needed a cast to compile - and a cast there would
// also have accepted a feature with no geometry at all.
export type GeoFeature = Feature<Geometry, Record<string, unknown>> & { id: number };
