// A share card that changes gets a new filename (scrapers cache by image URL),
// so every rename leaves the old name answering 404 to the crawlers and chat
// apps that cached it: Googlebot still asked for consent-3.jpg, csr-index-3.jpg
// and instruments-4.jpg a week after they were replaced. Each retired name is
// sent permanently to the card that replaced it.
//
// The current card of a family is `<family>-<n>.jpg`; every earlier version
// (`<family>.jpg|png`, `<family>-1.jpg` .. `<family>-<n-1>.jpg`) redirects to it.
// Names that left their family entirely are listed in ALIASES.
const ALIASES = {
  "brand.png": "whitespace-india",
  "csr.jpg": "csr-index",
  "csr.png": "csr-index",
};

const CURRENT = /^(.+)-(\d+)\.jpg$/;

/** `_redirects` lines for every retired card name, given public/og's file names. */
export function retiredCardRedirects(cards) {
  const current = new Map();
  for (const name of cards) {
    const m = CURRENT.exec(name);
    if (m && Number(m[2]) > (current.get(m[1])?.version ?? 0)) {
      current.set(m[1], { version: Number(m[2]), name });
    }
  }
  const lines = [];
  const add = (old, family) => {
    const target = current.get(family);
    if (target && !cards.includes(old)) lines.push(`/og/${old} /og/${target.name} 301`);
  };
  for (const [family, { version }] of current) {
    add(`${family}.jpg`, family);
    add(`${family}.png`, family);
    for (let v = 1; v < version; v++) add(`${family}-${v}.jpg`, family);
  }
  for (const [old, family] of Object.entries(ALIASES)) add(old, family);
  return lines;
}
