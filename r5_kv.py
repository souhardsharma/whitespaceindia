"""Throwaway probe: Koshvani second read (grant page + each education grant's scheme page), to compare with
the read of 17 Nov 02:20Z. Uses r3's sender (one connection, pause, cap, TLS verified)."""
import json, time
import os as _os, sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
import r3
from r3 import send, links, RESULTS, OUT, BASE


def main():
    OUT.mkdir(exist_ok=True)
    t0 = time.time()
    if r3.set_year("2026-2027"):
        eg = send("kv2-ExpGrant", BASE + "KoshReports/ExpGrant.aspx")
        if eg and eg["status"] == 200:
            for g in r3.EDU:
                hit = [u for t, u in links(eg, rf"^{g}$")]
                if hit:
                    send(f"kv2-head-{g}", hit[0], timeout=120)
            send("kv2-DailyTrx", BASE + "KoshReports/DailyTrx.aspx", timeout=120)
    RESULTS.append({"name": "_kv_total", "wall_seconds": round(time.time() - t0, 1)})
    (OUT / "results.json").write_text(json.dumps(RESULTS, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
