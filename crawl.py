"""Second batch: read FNDE's PDDE Info reports and the federal transfer files from the runner.

Only reads. One request a second to fnde.gov.br. Raw pages are saved gzipped under out/crawl/.
"""
from __future__ import annotations

import collections
import csv
import gzip
import html
import io
import json
import re
import sys
import time
import urllib.parse
import zipfile
from pathlib import Path

import probe

OUT = probe.OUT / "crawl"
BASE = "https://www.fnde.gov.br"
LOG = []
COUNT = collections.Counter()


def get(url: str, name: str, timeout: int = 90, save: bool = True) -> tuple[int, bytes]:
    host = urllib.parse.urlsplit(url).netloc
    t0 = time.time()
    s, raw, h, _ = probe.send(probe.opener_for(), url, timeout=timeout)
    COUNT[host] += 1
    LOG.append({"name": name, "url": url, "status": s, "bytes": len(raw), "seconds": round(time.time() - t0, 2),
                "utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t0))})
    print(f"{s:>4} {len(raw):>10,} {LOG[-1]['seconds']:>6}s {name}", flush=True)
    if save and s == 200:
        (OUT / (name + ".gz")).write_bytes(gzip.compress(raw))
    time.sleep(1.0)
    return s, raw


def text(raw: bytes) -> str:
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("latin-1")


def total_items(page: str) -> int | None:
    m = re.search(r"de\s+([\d.]+)\s+itens", page)
    return int(m.group(1).replace(".", "")) if m else None


SUSP = BASE + "/pddeinfo/relatoriosuspensao/relatoriosuspensao/relatoriosuspensao"


def susp_url(ano: int, uf: str, programa: str = "02", limit: int = 10, page: int = 1) -> str:
    return (f"{SUSP}/ano/{ano}/siglaUf/{uf}/sg_uf/{uf}/co_municipio_fnde//programa/{programa}/destinacao//cnpj//"
            f"co_escola//co_esfera_adm/1/co_esfera_adm/2/co_esfera_adm/3/tp_suspensao/0/consultar/Consultar/"
            f"limit/{limit}/page/{page}")


def crawl_suspension() -> None:
    ufs = "AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO".split()
    totals = {}
    # the query-string form first, as a browser sends it
    q = ("?ano=2026&siglaUf%5B%5D=AC&sg_uf=AC&co_municipio_fnde=&programa=02&destinacao=&cnpj=&co_escola="
         "&co_esfera_adm%5B%5D=1&co_esfera_adm%5B%5D=2&co_esfera_adm%5B%5D=3&tp_suspensao%5B%5D=0&consultar=Consultar")
    s, raw = get(SUSP + q, "susp_AC_2026_querystring")
    totals["AC_2026_querystring"] = total_items(text(raw))
    s, raw = get(SUSP + q.replace("programa=02", "programa="), "susp_AC_2026_allprog")
    totals["AC_2026_allprog"] = total_items(text(raw))
    for ano in (2026, 2025, 2024):
        for uf in ufs:
            s, raw = get(susp_url(ano, uf), f"susp_tot_{uf}_{ano}", save=(uf in ("AC", "RR")))
            totals[f"{uf}_{ano}"] = total_items(text(raw)) if s == 200 else f"HTTP {s}"
    (OUT / "susp_totals.json").write_text(json.dumps(totals, indent=1), encoding="utf-8")
    # every school of two small States, three years, 100 a page
    for uf in ("AC", "RR"):
        for ano in (2026, 2025, 2024):
            n = totals.get(f"{uf}_{ano}")
            pages = (n + 99) // 100 if isinstance(n, int) else 1
            for p in range(1, min(pages, 12) + 1):
                get(susp_url(ano, uf, limit=100, page=p), f"susp_{uf}_{ano}_p{p}")


def form_fields(page: str) -> dict:
    """A generic fill of a PDDE Info filter form: 2026, Acre, PDDE, every checkbox group in full."""
    f = page[page.find("<form"):page.find("</form>")]
    out: list[tuple[str, str]] = []
    for name in sorted(set(re.findall(r'<select[^>]*name="([^"]+)"', f))):
        opts = re.findall(r'<select[^>]*name="%s"[\s\S]*?</select>' % re.escape(name), f)
        vals = re.findall(r'<option[^>]*value="([^"]*)"', opts[0]) if opts else []
        want = {"ano": "2026", "programa": "02"}.get(name)
        if want and want in vals:
            out.append((name, want))
        else:
            out.append((name, ""))
    seen = set()
    for name, val in re.findall(r'<input[^>]*type="checkbox"[^>]*name="([^"]+)"[^>]*value="([^"]*)"', f):
        if name == "siglaUf[]":
            continue
        if (name, val) not in seen and val != "0":
            seen.add((name, val))
            out.append((name, val))
    out += [("siglaUf[]", "AC"), ("sg_uf", "AC"), ("co_municipio_fnde", ""), ("cnpj", ""), ("co_escola", ""),
            ("consultar", "Consultar")]
    return out


def crawl_other_reports() -> None:
    for rep in ("situacaoatendimentoentidade", "situacaoprestacaoconta", "consultasaldoentidade",
                "situacaocadastroentidade"):
        url = f"{BASE}/pddeinfo/{rep}/{rep}/{rep}"
        s, raw = get(url, f"form_{rep}")
        if s != 200:
            continue
        fields = form_fields(text(raw))
        get(url + "?" + urllib.parse.urlencode(fields), f"q_{rep}_AC_2026")


def crawl_schools() -> None:
    esc = BASE + "/pddeinfo/pddeinfo/escola/consultar"
    for code in ("12034100", "12000019", "12018503"):
        for ano in (2026, 2025):
            get(f"{esc}?ano={ano}&co_escola={code}&cnpj=&co_esfera_adm=&sg_uf=&co_municipio_fnde=&consultar=Consultar",
                f"escola_{code}_{ano}")
    get(f"{esc}?ano=2026&co_escola=&cnpj=&co_esfera_adm=&siglaUf%5B%5D=AC&sg_uf=AC&co_municipio_fnde=&consultar=Consultar",
        "escola_list_AC_2026")


CGU = "https://dadosabertos-download.cgu.gov.br/PortalDaTransparencia/saida"


def transfers() -> None:
    """Monthly 'Recursos transferidos' files: keep FNDE rows only, as compact rows."""
    w = csv.writer(gzip.open(OUT / "fnde_transfers_2026.csv.gz", "wt", encoding="utf-8", newline=""))
    w.writerow(["month", "tipo_favorecido", "uf", "mun_siafi", "acao", "plano_orc", "cnpj", "valor"])
    summary = {}
    for month in ("202601", "202602", "202603", "202604", "202605", "202606", "202607", "202608", "202609",
                  "202610", "202611", "202512", "202510"):
        s, raw = get(f"{CGU}/transferencias/{month}_Transferencias.zip", f"transf_{month}", timeout=300, save=False)
        if s != 200:
            summary[month] = f"HTTP {s}"
            continue
        z = zipfile.ZipFile(io.BytesIO(raw))
        n = kept = 0
        acts = collections.Counter()
        with z.open(z.infolist()[0]) as f:
            rd = csv.reader(io.TextIOWrapper(f, encoding="latin-1"), delimiter=";")
            head = next(rd)
            ix = {h: i for i, h in enumerate(head)}
            for row in rd:
                n += 1
                if row[ix["CÓDIGO UNIDADE GESTORA"]] != "153173":
                    continue
                kept += 1
                acts[(row[ix["AÇÃO"]], row[ix["NOME AÇÃO"]][:60], row[ix["TIPO FAVORECIDO"]])] += 1
                w.writerow([month, row[ix["TIPO FAVORECIDO"]], row[ix["UF"]], row[ix["CÓDIGO MUNICÍPIO SIAFI"]],
                            row[ix["AÇÃO"]], row[ix["CÓDIGO PLANO ORÇAMENTÁRIO"]], row[ix["CÓDIGO FAVORECIDO"]],
                            row[ix["VALOR TRANSFERIDO"]]])
        summary[month] = {"zip_bytes": len(raw), "rows": n, "fnde_rows": kept,
                          "last_modified": "", "actions": [[*k, v] for k, v in acts.most_common(25)]}
    (OUT / "transfers_summary.json").write_text(json.dumps(summary, indent=1, ensure_ascii=False), encoding="utf-8")


def daily_docs() -> None:
    """Daily expenditure documents: which dates exist, and FNDE's payment documents in them."""
    res = {}
    days = ["20261117", "20261116", "20261114", "20261113", "20261112", "20261111", "20261110", "20261109",
            "20261106", "20261030", "20261015", "20260915", "20260615", "20260115", "20251114"]
    for d in days:
        for pat in (f"{CGU}/despesas/{d}_Despesas.zip",):
            s, raw = get(pat, f"desp_{d}", timeout=300, save=False)
            if s != 200:
                res[d] = f"HTTP {s}"
                continue
            z = zipfile.ZipFile(io.BytesIO(raw))
            info = {"zip_bytes": len(raw), "members": {}}
            for m in z.infolist():
                n = kept = 0
                keep_rows = []
                with z.open(m) as f:
                    head = f.readline()
                    for line in f:
                        n += 1
                        if b"153173" in line:
                            kept += 1
                            if "Pagamento.csv" in m.filename and len(keep_rows) < 4000:
                                keep_rows.append(line)
                info["members"][m.filename] = {"rows": n, "fnde": kept}
                if keep_rows:
                    (OUT / f"desp_{d}_pagamento_fnde.csv.gz").write_bytes(gzip.compress(head + b"".join(keep_rows)))
            res[d] = info
    (OUT / "daily_docs.json").write_text(json.dumps(res, indent=1, ensure_ascii=False), encoding="utf-8")


def census() -> None:
    """INEP school census microdata: keep Acre and Roraima rows, a few columns."""
    for year in (2025, 2024):
        s, raw = get(f"https://download.inep.gov.br/dados_abertos/microdados_censo_escolar_{year}.zip",
                     f"censo_{year}", timeout=600, save=False)
        if s != 200:
            continue
        z = zipfile.ZipFile(io.BytesIO(raw))
        names = [m.filename for m in z.infolist()]
        (OUT / f"censo_{year}_members.json").write_text(json.dumps(names, indent=1), encoding="utf-8")
        for m in z.infolist():
            if re.search(r"microdados_ed_basica_\d+\.csv$", m.filename, flags=re.I):
                with z.open(m) as f:
                    rd = csv.reader(io.TextIOWrapper(f, encoding="latin-1"), delimiter=";")
                    head = next(rd)
                    ix = {h: i for i, h in enumerate(head)}
                    cols = [c for c in ("NU_ANO_CENSO", "SG_UF", "CO_MUNICIPIO", "NO_MUNICIPIO", "CO_ENTIDADE",
                                        "NO_ENTIDADE", "TP_DEPENDENCIA", "TP_LOCALIZACAO",
                                        "TP_SITUACAO_FUNCIONAMENTO", "QT_MAT_BAS", "QT_MAT_INF", "QT_MAT_FUND",
                                        "QT_MAT_MED", "QT_MAT_EJA", "QT_MAT_ESP") if c in ix]
                    w = csv.writer(gzip.open(OUT / f"censo_{year}_AC_RR.csv.gz", "wt", encoding="utf-8", newline=""))
                    w.writerow(cols)
                    n = 0
                    for row in rd:
                        n += 1
                        if row[ix["SG_UF"]] in ("AC", "RR"):
                            w.writerow([row[ix[c]] for c in cols])
                    (OUT / f"censo_{year}_rows.txt").write_text(f"{n} rows, {len(head)} columns\n", encoding="utf-8")
        return


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    steps = [crawl_suspension, crawl_other_reports, crawl_schools, transfers, daily_docs, census]
    for step in steps:
        try:
            step()
        except Exception as e:  # noqa: BLE001 - a failed step must not lose the others
            LOG.append({"name": step.__name__, "error": f"{type(e).__name__}: {e}"})
            print("STEP FAILED", step.__name__, e, flush=True)
        (OUT / "log.json").write_text(json.dumps({"requests_by_host": COUNT, "log": LOG}, indent=1), encoding="utf-8")


if __name__ == "__main__":
    sys.exit(main())
