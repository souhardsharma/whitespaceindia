/**
 * Renders one page's JSON-LD.
 *
 * Server component, no client cost. Each instrument page passes its OWN
 * identity; nothing is inherited from the layout, because a layout cannot
 * know which route is rendering and inheriting it made every page claim to
 * be the shelf.
 */
export default function StructuredData({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      // `<` escaped, because JSON.stringify does not do it and the HTML
      // parser reads `</script>` inside a script element regardless of JSON
      // quoting. These values carry district and state names joined from a
      // rebuilt pipeline, so one name containing `</script>` would terminate
      // the block and inject the rest as markup on all 626 instrument pages.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
