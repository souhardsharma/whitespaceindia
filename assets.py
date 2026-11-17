"""GET each page in assets.json and the same-host scripts it names (at most `max_scripts`), so the page's
data calls can be read from its own JavaScript. Read-only, TLS verified, `pause` seconds between requests."""
from __future__ import annotations

import json
import re
import sys
import time
import urllib.parse
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import probe  # noqa: E402

OUT = HERE / "out" / "assets"


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    log = []
    for t in json.loads((HERE / "assets.json").read_text(encoding="utf-8")):
        op = probe.opener_for()
        s, raw, h, url = probe.send(op, t["url"], timeout=t.get("timeout", 60))
        (OUT / f"{t['name']}.html").write_bytes(raw)
        log.append({"name": t["name"], "url": t["url"], "status": s, "bytes": len(raw), "final": url})
        print(s, len(raw), t["name"], flush=True)
        if s != 200:
            continue
        host = urllib.parse.urlparse(url).netloc
        srcs = re.findall(r'<script[^>]*src="([^"]+)"', raw.decode("utf-8", "replace"), flags=re.I)
        n = 0
        for src in srcs:
            full = urllib.parse.urljoin(url, src)
            if urllib.parse.urlparse(full).netloc != host or re.search(r"jquery|bootstrap|\.min\.js", full, re.I):
                continue
            if n >= t.get("max_scripts", 6):
                break
            n += 1
            time.sleep(t.get("pause", 1.5))
            s2, raw2, _, _ = probe.send(op, full, timeout=60)
            fn = f"{t['name']}-js{n}-" + re.sub(r"[^A-Za-z0-9.]+", "_", full.split("/")[-1])[:60]
            (OUT / fn).write_bytes(raw2)
            log.append({"name": fn, "url": full, "status": s2, "bytes": len(raw2)})
            print(s2, len(raw2), fn, flush=True)
        time.sleep(t.get("pause", 1.5))
    (OUT / "log.json").write_text(json.dumps(log, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
