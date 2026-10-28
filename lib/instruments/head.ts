/**
 * The head of the one static page every proposal is served from
 * (app/instruments/consent/view). Its HTML carries the shelf's generic title,
 * description and "index, follow"; the proposal's own are set here, in the
 * browser, once the proposal is read.
 *
 * Set once, they did not hold. React finishes the page's metadata after the
 * page's own effects can run, and where the head was changed first it puts
 * its copies back: measured on 2026-10-28, a mistyped address was set to
 * "noindex" at 367 ms and React restored the generic title and appended a
 * second description and an "index, follow" 8 ms later, so the not-found page
 * said both. A real proposal is set after its files arrive and lost the race
 * only by luck. The head is therefore held: every change to it re-asserts
 * the proposal's values, on every copy, until the page leaves.
 */

export interface Head {
  title: string;
  description: string;
  path: string;
  index: boolean;
}

const NOINDEX = "noindex, follow";

/** Sets and holds the document's head for one proposal; returns what undoes it. */
export function applyHead(head: Head, siteUrl: string, doc: Document = document): () => void {
  const previousTitle = doc.title;
  // Every tag rewritten, with what it said before, so leaving restores it.
  const previous = new Map<HTMLMetaElement, string>();
  const set = (el: HTMLMetaElement, value: string) => {
    if (!previous.has(el)) previous.set(el, el.content);
    if (el.content !== value) el.content = value;
  };
  // Idempotent: it writes only what differs, so the writes it makes do not
  // set the observer below off again.
  const hold = () => {
    if (doc.title !== head.title) doc.title = head.title;
    doc.querySelectorAll<HTMLMetaElement>('meta[name="description"]')
      .forEach((m) => set(m, head.description));
    // googlebot too: the layouts write it as "index, follow" beside robots.
    if (!head.index) {
      doc.querySelectorAll<HTMLMetaElement>('meta[name="robots"], meta[name="googlebot"]')
        .forEach((m) => set(m, NOINDEX));
    }
  };

  const added: HTMLElement[] = [];
  const canonical = doc.createElement("link");
  canonical.rel = "canonical";
  canonical.href = `${siteUrl}${head.path}`;
  added.push(canonical);
  if (!head.index && !doc.querySelector('meta[name="robots"]')) {
    const noindex = doc.createElement("meta");
    noindex.name = "robots";
    noindex.content = NOINDEX;
    added.push(noindex);
  }
  for (const el of added) doc.head.appendChild(el);
  hold();

  const Observer = doc.defaultView?.MutationObserver;
  const watch = Observer ? new Observer(hold) : null;
  watch?.observe(doc.head, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["content"],
  });

  return () => {
    watch?.disconnect();
    doc.title = previousTitle;
    previous.forEach((content, el) => { el.content = content; });
    for (const el of added) el.remove();
  };
}
