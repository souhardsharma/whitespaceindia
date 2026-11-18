"""Run 2: every Kerala money order (sanction/release/allotment on a general subject) of 24 Aug-18 Nov 2026, as PDF,
for amount and scheme extraction; and Andhra Pradesh GOIR asked again with longer timeouts. Runner only."""
from __future__ import annotations

import json
import traceback
from pathlib import Path

import probe as P

HERE = Path(__file__).resolve().parent
TARGETS = {(t["src"], t["no"]) for t in json.loads((HERE / "money_targets.json").read_text("utf-8"))}
P.CAP["eoffice.kerala.gov.in"] = 200
P.CAP["goir.ap.gov.in"] = 60
WIN2 = [w for w in P.WINDOWS if w[0] != "08b"] + [("08c", "24/08/2026", "01/09/2026")]


def kerala_money(dept):
    src = "Kerala GE" if dept == 740 else "Kerala HE"
    s = P.Direct()
    st, b = P.call(f"kl golist {dept}", P.KL + "golist", b"token=KL0567QW111A0SA1011W0", "open", s, P.FORM)
    meta = []
    for lab, a, z in WIN2:
        st, body = P.call(f"kl {dept} {lab}", P.KL + "godetails", P.kl_form(dept, a, z, "KL0567QW111A0SA1011W0"), "open",
                          s, P.FORM, save=f"kl/{dept}/{lab}.html", timeout=120)
        if not P.good(st, body, 500):
            continue
        for r in P.kl_rows(body):
            if (src, r["no"]) not in TARGETS:
                continue
            st2, pdf = P.call(f"kl pdf {dept} {lab} {r['rk']}", P.KL + "openIssuedGOList", f"recordKey={r['rk']}".encode(),
                              "open", s, P.PDFHDR, save=f"kl/money_{dept}/{lab}_{r['rk']}.pdf", timeout=60, pause=1.5)
            meta.append({**r, "win": lab, "status": st2, "is_pdf": pdf[:4] == b"%PDF", "bytes": len(pdf)})
        (P.OUT / "kl" / f"money_meta_{dept}.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), "utf-8")
        P.flush()


def andhra2():
    for dept, budget, seed in (("SE", 14, 21), ("HE", 10, 22)):
        ok = P.ap_dept(P.Direct(legacy=True), "open", dept, budget, seed) if False else False
        for _ in range(5):
            try:
                s = P.ISess()
                s.s.timeout = 120
                if P.ap_dept(s, "isess", dept, budget, seed):
                    ok = True
                    break
            except BaseException:  # noqa: BLE001
                traceback.print_exc()
        P.flush()


def main():
    P.OUT.mkdir(exist_ok=True)
    (P.OUT / "kl").mkdir(exist_ok=True)
    for name, fn in (("kl 740", lambda: kerala_money(740)), ("kl 1124", lambda: kerala_money(1124)), ("ap", andhra2)):
        print("==", name, flush=True)
        try:
            fn()
        except BaseException:  # noqa: BLE001
            traceback.print_exc()
        P.flush()


if __name__ == "__main__":
    main()
