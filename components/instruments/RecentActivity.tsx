/**
 * Recent movement in the register for one district: the newest events among
 * every proposal that names it.
 *
 * Server-rendered from the change log (scripts/instruments/build_changes.py),
 * so it is dated by the regulator's own appraisal history. A proposal's own
 * steps are rendered in the browser with the same ActivityList.
 */
import { changes, changesFile } from "@/lib/instruments/server";
import ActivityList from "./ActivityList";

export default function RecentActivity({ district, limit = 12 }: { district: number; limit?: number }) {
  const file = changesFile();
  if (!file) return null;
  const { events, total } = changes({
    district,
    kinds: ["filed", "query", "decided", "closed"],
    since: file.window.from,
    limit,
  });
  return (
    <ActivityList
      district={district}
      events={events}
      total={total}
      window={file.window}
      basis={file.basis}
    />
  );
}
