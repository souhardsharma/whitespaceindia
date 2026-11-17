"""Throwaway runner probe: Delhi DoE EMPLOYEE (teacher) attendance on edudel.nic.in, to test a join on school ID.

GET the report index and each view; where a view carries day/month selects, POST it for the dates in
EMP_DATES; where it carries a school picker, POST the first N schools. One request at a time, 1 s apart.
Writes out/emp/*.html and out/emp/summary.json.
"""
from __future__ import annotations

import datetime as dt
import html
import json
import re
import time
import urllib.parse
from pathlib import Path

import att  # same folder: req(), form_fields(), cells(), opener()

OUT = Path(__file__).resolve().parent / "out" / "emp"
INDEX = "https://edudel.nic.in/mis/eis/attendance/attendancereport.aspx"
DATES = ["2026-11-13", "2026-11-04"]
N_SCHOOLS = 8


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    op = att.opener()
    S = {"views": {}, "posts": {}}
    st, page = att.req(op, INDEX, tag="EMP index")
    (OUT / "index.html").write_text(page, encoding="utf-8")
    links = [html.unescape(h) for h in re.findall(r'href="([^"]*EmpAtn[^"]*)"', page, flags=re.I)]
    links += [f"EmpAtnReportnew.aspx?dis={v}" for v in re.findall(r"check\('([A-Za-z]+)'\)", page)]
    links = list(dict.fromkeys(links))
    S["links"] = links
    for i, ln in enumerate(links):
        url = urllib.parse.urljoin(INDEX, ln.replace(" ", "%20"))
        time.sleep(1)
        st, page = att.req(att.opener() if False else op, url, tag=f"EMP GET {ln}")
        (OUT / f"view{i}.html").write_text(page, encoding="utf-8")
        f, sel, sub, action = att.form_fields(page)
        rows = att.cells(page)
        S["views"][ln] = {"status": st, "bytes": len(page), "selects": {k: [len(v), v[:3]] for k, v in sel.items()},
                          "submits": sub, "n_rows": len(rows), "rows_head": rows[:6], "rows_tail": rows[-4:]}
        print("GET", st, len(page), ln, {k: len(v) for k, v in sel.items()}, len(rows), flush=True)
        day = next((k for k in sel if "day" in k.lower()), None)
        mon = next((k for k in sel if "month" in k.lower()), None)
        yr = next((k for k in f if "year" in k.lower()), None)
        sch = next((k for k in sel if k not in (day, mon) and len(sel[k]) > 50), None)
        if not day or not sub:
            continue
        targets = [None]
        if sch:
            targets = [o[0] for o in sel[sch] if o[0] not in ("", "0", "-1", "Select")][:N_SCHOOLS]
        for x in DATES:
            d = dt.date.fromisoformat(x)
            for tv in targets:
                body = dict(f)
                body[day], body[mon] = str(d.day), str(d.month)
                if yr:
                    body[yr] = str(d.year)
                if tv:
                    body[sch] = tv
                body[sub[0][0]] = sub[0][1]
                time.sleep(1)
                st, pg = att.req(op, action, data=urllib.parse.urlencode(list(body.items())).encode(),
                                 tag=f"EMP POST {ln} {x} {tv}")
                key = f"{i}_{x}_{tv}"
                (OUT / f"post_{key}.html").write_text(pg, encoding="utf-8")
                r = att.cells(pg)
                S["posts"][key] = {"status": st, "view": ln, "n_rows": len(r), "rows_head": r[:8], "rows_tail": r[-6:]}
                print("POST", st, key, len(r), flush=True)
    S["requests"] = att.COUNT["requests"]
    S["log"] = att.LOG
    (OUT / "summary.json").write_text(json.dumps(S, ensure_ascii=False, indent=0), encoding="utf-8")


if __name__ == "__main__":
    main()
