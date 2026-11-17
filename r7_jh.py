"""Throwaway probe: Jharkhand Kuber single-day reads from this runner, with the host's incomplete
certificate chain completed and verification ON.

The intermediates are fetched IN THE JOB (egress.ensure_chain: the leaf's AIA "CA Issuers" address; a fetched
certificate is used only as an intermediate, never as a root, self-signed ones are refused). The requests then
run on a context whose ONLY roots are certifi's bundle, plus those intermediates, with PARTIAL_CHAIN cleared,
so a chain verifies only if it ends at a root certifi already trusts. verify is never turned off.
"""
import hashlib, json, os, ssl, sys, time, urllib.request, http.cookiejar
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE / "scripts" / "education"))
import certifi  # noqa: E402
import egress  # noqa: E402
import r3  # noqa: E402
from r3 import send, postback, RESULTS, OUT  # noqa: E402

URL = "https://jkuber.jharkhand.gov.in/treasurymis/rptBudAlloExp.aspx"
P = "ctl00$ContentPlaceHolder1$"
# (label, financial year or None for current, day, value already held from pool/browser, Rs crore)
DAYS = [("d59-02112026", None, "02/11/2026", "127.36 (browser and pool)"),
        ("d59-13112026", None, "13/11/2026", "33.69 (browser)"),
        ("d59-09112026", None, "09/11/2026", "0 (browser; Govardhan Puja, state offices shut)"),
        ("d59-12102026", None, "12/10/2026", "29.42 (browser)"),
        ("d59-fy2526-28032026", "2526", "28/03/2026", "37.97 (browser)"),
        ("d59-fy2425-26032025", "2425", "26/03/2025", "428.97 (browser)")]


def main():
    OUT.mkdir(exist_ok=True)
    notes = {}
    t0 = time.time()
    state = egress.ensure_chain(URL, [None], recheck=True)
    notes["ensure_chain"] = state
    notes["chain_seconds"] = round(time.time() - t0, 2)
    ders = sorted(egress._intermediate_dir().glob("*.der"))
    ctx = ssl.create_default_context(cafile=certifi.where())
    ctx.check_hostname, ctx.verify_mode = True, ssl.CERT_REQUIRED
    ctx.verify_flags &= ~ssl.VERIFY_X509_PARTIAL_CHAIN
    notes["intermediates"] = []
    for f in ders:
        der = f.read_bytes()
        ctx.load_verify_locations(cadata=der)
        (OUT / ("intermediate-" + f.name)).write_bytes(der)
        notes["intermediates"].append({"file": f.name, "sha256": hashlib.sha256(der).hexdigest(), "bytes": len(der)})
    notes["certifi"] = certifi.__version__ if hasattr(certifi, "__version__") else certifi.where()
    # strict handshake check on the certifi-only context
    import socket
    try:
        with socket.create_connection(("jkuber.jharkhand.gov.in", 443), timeout=20) as raw:
            with ctx.wrap_socket(raw, server_hostname="jkuber.jharkhand.gov.in") as tls:
                notes["handshake"] = "verified"
                notes["peer_subject"] = tls.getpeercert().get("subject")
                notes["peer_issuer"] = tls.getpeercert().get("issuer")
    except Exception as e:  # noqa: BLE001
        notes["handshake"] = f"FAILED: {type(e).__name__}: {e}"
    (OUT / "jh_chain_notes.json").write_text(json.dumps(notes, indent=1, default=str), encoding="utf-8")
    print(json.dumps(notes, indent=1, default=str), flush=True)
    if notes["handshake"] != "verified":
        return
    r3.OPENER = urllib.request.build_opener(urllib.request.HTTPSHandler(context=ctx),
                                            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    pg = send("jh7-get", URL, timeout=120)
    if not pg or pg["status"] != 200:
        return
    for label, fy, day, held in DAYS:
        s = {P + "rdSearchCer": "PdAu", P + "ddlDemandNo": "59", P + "txtFromDate": day, P + "txtToDate": day}
        if fy:
            s |= {P + "rdfinYears": "P", P + "ddlFinYear": fy}
        url, f = postback(pg, s, button=P + "btnSearch", drop=("ctl00$cmdLogin", "ctl00$CaptchaControl1"))
        send("jh7-" + label, url, f, timeout=120)
    (OUT / "results.json").write_text(json.dumps(RESULTS, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
