/**
 * A table's horizontal scroll container that a keyboard can reach.
 *
 * At 320 px most register tables are wider than the screen. A scrolling div
 * cannot take focus, so a keyboard user could not scroll a table with no link
 * in it; focusable, it scrolls with the arrow keys. A focusable region needs
 * a name, hence `label`.
 */
export default function ScrollRegion({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className={`overflow-x-auto ${className}`}>
      {children}
    </div>
  );
}
