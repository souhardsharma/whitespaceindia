"""How the education instruments reach their sources.

One egress for every education source, built on the same route pool that
keeps People & Consent current (scripts/instruments/net.py, imported, never
edited). What that pool already does, and why it is reused rather than
re-invented:

- Every request is HTTPS with the certificate chain and hostname verified, so
  a free proxy carries opaque bytes and can neither read nor alter an answer.
- Each exit IP is spaced (ROUTE_INTERVAL), so no single address leans on a
  source; a 429 cools only the address that drew it.
- The total pace adapts down on server distress (5xx) and back up when clean.
- Failing routes rest, then retire; sustained success buys rests back; the
  pool takes new routes from its file every minute (reload_routes).

What this module adds:

1. NO DIRECT ROUTE OFF A RUNNER. Off a runner the direct route is
   suspended for good: nothing is ever fetched from that address. On a
   GitHub runner (GITHUB_ACTIONS=true) the runner's own address may carry a
   share, as it does for People & Consent.
2. ONE POOL FILE PER TARGET FAMILY. Several education hosts answer only
   Indian addresses (PRABANDH, PGI, PM POSHAN, the School GIS layers), others
   answer anyone. A route is verified against the family it will be used for
   (refresh_pool.py), with a validator that checks the answer is the real
   thing and not a captive page.
3. GENTLER DEFAULTS. These are small public services. The total pace starts
   at 4 requests a second and each exit address waits 6 s between requests,
   unless the caller asks for less.

Usage:
    from egress import open_pool, fetch
    pool = open_pool("india")           # or "open"
    status, body = fetch(pool, url)
"""
from __future__ import annotations

import hashlib
import http.client
import http.cookiejar
import json
import os
import random
import socket
import ssl
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

# Pace defaults must be in the environment BEFORE net is imported: net reads
# them once at import. A caller's own setting wins.
os.environ.setdefault("INSTRUMENTS_MAX_RPS", "4")
os.environ.setdefault("INSTRUMENTS_MIN_RPS", "0.5")
os.environ.setdefault("INSTRUMENTS_ROUTE_INTERVAL", "6")
os.environ.setdefault("INSTRUMENTS_ROUTE_INTERVAL_DIRECT", "1.5")

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "instruments"))
import net as NET  # noqa: E402

# Generic browser headers. net's defaults name PARIVESH as Origin and Referer;
# carrying those to another government host would be both wrong and odd.
NET.DEFAULT_HEADERS = {
    "User-Agent": NET.USER_AGENT,
    "Accept": "application/json, text/html;q=0.9, */*;q=0.8",
    "Accept-Language": "en-IN,en;q=0.9",
}

# Ten years: "never" without the arithmetic trouble of infinity in stats().
FOREVER = 10 * 365 * 86400


def on_runner() -> bool:
    return os.environ.get("GITHUB_ACTIONS") == "true"


def cache_dir() -> Path:
    d = os.environ.get("EDUCATION_CACHE_DIR")
    if not d:
        raise SystemExit("EDUCATION_CACHE_DIR is not set: downloaded data and "
                         "caches live outside the repository")
    p = Path(d)
    p.mkdir(parents=True, exist_ok=True)
    return p


@dataclass(frozen=True)
class Target:
    """A family of hosts that one verified route is expected to reach."""
    name: str
    probe_url: str
    validate: Callable[[bytes], bool]
    note: str
    india_only: bool = False     # the family answers Indian addresses only
    probe_timeout: int = 12      # seconds a route has to deliver the probe


def _json_list(min_len: int, *keys: str) -> Callable[[bytes], bool]:
    def ok(body: bytes) -> bool:
        try:
            doc = json.loads(body.decode("utf-8", "replace"))
        except ValueError:
            return False
        rows = doc.get("data") if isinstance(doc, dict) else doc
        if isinstance(rows, dict):
            rows = rows.get("content") or rows.get("list") or rows.get("data")
        return (isinstance(rows, list) and len(rows) >= min_len
                and all(isinstance(r, dict) and all(k in r for k in keys)
                        for r in rows[:min_len]))
    return ok


# The probe is the lightest real answer the family gives, checked for shape.
TARGETS: dict[str, Target] = {
    # Hosts that time out from outside India (runner probe, 2026-11-05).
    "india": Target(
        "india",
        "https://spgi.udiseplus.gov.in/performance/yearMaster",
        _json_list(3, "year", "yr_code"),
        "PGI / PRABANDH / PM POSHAN / School GIS: answer Indian addresses only",
        india_only=True),
    # The national PM POSHAN daily system closes every connection from
    # outside India (runner probe, 2026-11-25), so its routes are verified
    # against the host itself: its lightest page, which is an ASP.NET form.
    "ams": Target(
        "ams",
        "https://pmposhan-ams.education.gov.in/About_mdm.aspx",
        lambda body: b"__VIEWSTATE" in body and b"POSHAN" in body,
        "the national PM POSHAN daily system: answers Indian addresses only",
        # Its median answer through a verified route was 9 s (runner,
        # 2026-11-25); at 12 s half the routes that work were thrown away.
        india_only=True, probe_timeout=25),
    # Hosts that answer anyone; still read through the pool off a runner.
    "open": Target(
        "open",
        "https://kys.udiseplus.gov.in/web-app/api/states?yearId=0",
        _json_list(30, "stateId"),
        "KYS, sansad.in, SARAS and the other hosts that answered the US runner"),
}


def pool_path(target: str) -> Path:
    return cache_dir() / "pools" / f"{target}.txt"


def open_pool(target: str, *, reload_every: float = 60.0, **kw) -> NET.Pool:
    """A route pool for one target family.

    Off a runner the direct route is suspended for the life of the process,
    so a pool with no proxies sends nothing rather than falling back to the
    local address. The pool file is re-read every `reload_every` seconds,
    so a refresher running beside a long fetch heals the pool in place.
    """
    if target not in TARGETS:
        raise SystemExit(f"unknown target {target!r}; known: {sorted(TARGETS)}")
    path = pool_path(target)
    path.parent.mkdir(parents=True, exist_ok=True)
    os.environ["INSTRUMENTS_PROXIES"] = str(path)
    pool = NET.Pool(NET.load_proxies(path), **kw)
    if not on_runner():
        pool.direct_blocked_until = time.time() + FOREVER
        pool.direct_blocks = 1
    if reload_every:
        def reload() -> None:
            while True:
                time.sleep(reload_every)
                n = pool.reload_routes(path)
                if n:
                    print(f"  pool: +{n} routes from {path.name}", flush=True)
        threading.Thread(target=reload, daemon=True, name="pool-reload").start()
    return pool


def direct_allowed(pool: NET.Pool) -> bool:
    return not pool.blocked_direct


def fetch(pool: NET.Pool, url: str, **kw) -> tuple[int, bytes]:
    """One request through the pool: (status, body); status -1 = not answered.

    Statuses in net.NOT_SENT bodies mean the request was never sent (deadline
    or every route full) and are owed, not failures of the source.
    """
    kw.setdefault("final", frozenset({404}))
    ensure_chain(url, _pool_proxies(pool))
    status, body = NET.get(pool, url, **kw)
    if (status == -1 and ISSUER_MISSING.encode() in body
            and ensure_chain(url, _pool_proxies(pool), recheck=True) == "completed"):
        status, body = NET.get(pool, url, **kw)
    return status, body


def not_sent(body: bytes) -> bool:
    return body in NET.NOT_SENT


# Several government hosts (SARAS, the Madras High Court, PM POSHAN) present
# their own certificate WITHOUT the intermediate that signed it. Windows and
# browsers fetch the missing certificate from the address the leaf names
# (Authority Information Access); OpenSSL on a Linux runner does not, so every
# request there failed with "unable to get local issuer certificate" (runner
# run 43638321829) although the host had answered. The chain is completed the
# way a browser completes it, and verification is never relaxed for it: a
# fetched certificate is only an INTERMEDIATE. It is refused if it is
# self-signed, and with PARTIAL_CHAIN cleared OpenSSL accepts a chain only if
# it ends at a root this machine already trusts, so a certificate planted by
# a proxy or a forged AIA address verifies nothing.
NET.TLS.verify_flags &= ~ssl.VERIFY_X509_PARTIAL_CHAIN

ISSUER_MISSING = "unable to get local issuer certificate"
CA_ISSUERS_OID = bytes.fromhex("2b06010505073002")  # 1.3.6.1.5.5.7.48.2
CHAIN_DEPTH = 4           # leaf -> at most this many intermediates
CHAIN_TRIES = 3           # routes asked before a host is left for later
CHAIN_RECHECK_S = 7 * 86400   # a chain that verified is not re-asked for a week
MAX_CERT_BYTES = 16_384
_chain_lock = threading.Lock()
_chain_state: dict[str, str] = {}   # host -> "ok" | "completed" | "incomplete"
_chain_tries: dict[str, int] = {}
_fetched_for: dict[str, int] = {}   # host -> intermediates fetched in this process
_intermediates_loaded = False


def _tlv(der: bytes, at: int) -> tuple[int, int, int]:
    """(tag, content start, content end) of the DER element at `at`."""
    tag, size, at = der[at], der[at + 1], at + 2
    if size & 0x80:
        width = size & 0x7F
        size, at = int.from_bytes(der[at:at + width], "big"), at + width
    return tag, at, at + size


def cert_names(der: bytes) -> tuple[bytes, bytes]:
    """(issuer, subject) of an X.509 certificate, each as its DER bytes."""
    _, at, _ = _tlv(der, 0)                 # Certificate
    _, at, _ = _tlv(der, at)                # TBSCertificate
    tag, _, end = _tlv(der, at)
    if tag == 0xA0:                         # explicit version, absent in v1
        at = end
    fields = []
    for _ in range(5):                      # serial, algorithm, issuer, validity, subject
        _, _, end = _tlv(der, at)
        fields.append(der[at:end])
        at = end
    return fields[2], fields[4]


def ca_issuer_urls(der: bytes) -> list[str]:
    """The http addresses a certificate names for its issuer's certificate."""
    urls, at = [], der.find(CA_ISSUERS_OID)
    while at >= 0:
        tag, start, end = _tlv(der, at + len(CA_ISSUERS_OID))
        if tag == 0x86:                     # GeneralName: uniformResourceIdentifier
            url = der[start:end].decode("ascii", "replace")
            if url.startswith("http://"):
                urls.append(url)
        at = der.find(CA_ISSUERS_OID, at + 1)
    return urls


def _intermediate_dir() -> Path:
    d = cache_dir() / "intermediates"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _trust_as_intermediate(der: bytes) -> None:
    NET.TLS.load_verify_locations(cadata=der)


def load_intermediates() -> int:
    """Intermediates fetched on earlier runs, loaded once per process."""
    global _intermediates_loaded
    with _chain_lock:
        if _intermediates_loaded:
            return 0
        _intermediates_loaded = True
        loaded = 0
        for f in sorted(_intermediate_dir().glob("*.der")):
            der = f.read_bytes()
            try:
                issuer, subject = cert_names(der)
            except IndexError:
                continue
            if issuer == subject:   # a kept file is held to the rule a fetched one is
                continue
            _trust_as_intermediate(der)
            loaded += 1
        return loaded


def _tunnel(host: str, proxy: str | None, timeout: float) -> socket.socket:
    """A raw connection to host:443 down one route (None = direct)."""
    if proxy is None:
        return socket.create_connection((host, 443), timeout)
    if proxy.startswith(("socks5://", "socks4://")):
        import socks  # PySocks
        kind, hostport = proxy.split("://", 1)
        phost, pport = hostport.rsplit(":", 1)
        return socks.create_connection(
            (host, 443), timeout=timeout, proxy_addr=phost, proxy_port=int(pport),
            proxy_type=socks.SOCKS5 if kind == "socks5" else socks.SOCKS4,
            proxy_rdns=True)
    phost, pport = proxy.rsplit(":", 1)
    raw = socket.create_connection((phost, int(pport)), timeout)
    try:
        raw.sendall(f"CONNECT {host}:443 HTTP/1.1\r\nHost: {host}:443\r\n\r\n".encode())
        reply = b""
        while b"\r\n\r\n" not in reply:
            chunk = raw.recv(4096)
            if not chunk or len(reply) > 16_384:
                raise OSError(f"proxy {proxy} closed during CONNECT")
            reply += chunk
        if reply.split(b" ", 2)[1:2] != [b"200"]:
            raise OSError(f"proxy {proxy} refused CONNECT: {reply[:40]!r}")
    except OSError:
        raw.close()
        raise
    return raw


def _handshake(host: str, proxy: str | None, timeout: float) -> None:
    """A verified TLS handshake with nothing sent after it; raises on failure."""
    with _tunnel(host, proxy, timeout) as raw:
        with NET.TLS.wrap_socket(raw, server_hostname=host):
            pass


def _presented_leaf(host: str, proxy: str | None, timeout: float) -> bytes:
    """The certificate the host presents, read WITHOUT believing it.

    No request is sent on this connection and nothing but the certificate is
    read from it. The certificate is used for one thing, the address of its
    issuer's certificate; whether either is genuine is decided afterwards by
    the verified handshake.
    """
    reader = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    reader.check_hostname = False
    reader.verify_mode = ssl.CERT_NONE
    with _tunnel(host, proxy, timeout) as raw:
        with reader.wrap_socket(raw, server_hostname=host) as tls:
            return tls.getpeercert(binary_form=True)


def _download_issuer(url: str) -> bytes | None:
    """The certificate at an AIA address as DER, or None if it is not one.

    Asked directly: the address belongs to the certificate authority, not to
    a source, and what comes back is checked by signature, not by route.
    """
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(url, timeout=20) as r:
            body = r.read(MAX_CERT_BYTES + 1)
    except OSError as e:
        print(f"  chain: {url} not fetched: {e}", flush=True)
        return None
    if body.lstrip().startswith(b"-----BEGIN CERTIFICATE"):
        body = ssl.PEM_cert_to_DER_cert(body.decode("ascii", "replace").strip())
    if len(body) > MAX_CERT_BYTES or body[:1] != b"\x30":
        return None
    return body


def _chase(leaf: bytes) -> int:
    """Fetch and load the intermediates above `leaf`; how many were loaded."""
    loaded, child = 0, leaf
    for _ in range(CHAIN_DEPTH):
        issuer_of_child, _ = cert_names(child)
        parent = None
        for url in ca_issuer_urls(child):
            der = _download_issuer(url)
            if der is None:
                continue
            try:
                issuer, subject = cert_names(der)
            except IndexError:
                continue
            if subject == issuer_of_child and issuer != subject:
                parent = der
                break
        if parent is None:      # no address, or the next one up is a root
            break
        _trust_as_intermediate(parent)
        name = hashlib.sha256(parent).hexdigest()[:24] + ".der"
        (_intermediate_dir() / name).write_bytes(parent)
        loaded, child = loaded + 1, parent
    return loaded


def _pool_proxies(pool: NET.Pool) -> list[str | None]:
    """Routes a handshake may use: direct first where it is allowed."""
    now = time.time()
    proxies = [r.proxy for r in pool.routes
               if r.proxy and not r.retired and now >= r.resting_until]
    # The file is written fastest first; ask among the better half.
    proxies = proxies[: max(CHAIN_TRIES, len(proxies) // 2)]
    random.shuffle(proxies)
    return ([] if pool.blocked_direct else [None]) + proxies


def _known_good() -> dict[str, float]:
    """host -> when its chain last verified here (epoch seconds)."""
    try:
        return json.loads((_intermediate_dir() / "hosts.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _remember_good(host: str) -> None:
    known = {**_known_good(), host: time.time()}
    path = _intermediate_dir() / "hosts.json"
    tmp = path.with_suffix(f".{os.getpid()}.tmp")
    tmp.write_text(json.dumps(known, indent=0, sort_keys=True), encoding="utf-8")
    os.replace(tmp, path)


def _verify_host(host: str, proxy: str | None, timeout: float) -> str:
    """One route's verdict: "ok", "completed" or "incomplete"; OSError if unreached."""
    try:
        _handshake(host, proxy, timeout)
        return "completed" if _fetched_for.get(host) else "ok"
    except ssl.SSLCertVerificationError as e:
        if ISSUER_MISSING not in str(e):
            return "incomplete"
    # Counted before the second handshake: if that one dies in transit, the
    # next route still reports the host as completed, not as fine all along.
    _fetched_for[host] = _fetched_for.get(host, 0) + _chase(_presented_leaf(host, proxy, timeout))
    try:
        _handshake(host, proxy, timeout)
    except ssl.SSLCertVerificationError:
        return "incomplete"
    return "completed"


def ensure_chain(url: str, proxies: list[str | None], *, timeout: float = 12,
                 recheck: bool = False) -> str:
    """Make sure the host's certificate chain can be verified here.

    A verified handshake, and only if that fails for a missing issuer, the
    chase. Asked once per host per process, and not at all for a host whose
    chain verified within CHAIN_RECHECK_S (`recheck` asks regardless: a
    request has just failed on the chain). Returns "ok", "completed"
    (intermediates were fetched and the handshake then verified),
    "incomplete" (it still does not verify; requests will fail, loudly, as
    they should) or "unreached" (no route got through; asked again on a later
    request, CHAIN_TRIES times).
    """
    parts = urllib.parse.urlsplit(url)
    host = parts.hostname or ""
    if parts.scheme != "https" or (parts.port or 443) != 443:
        return "ok"
    load_intermediates()
    with _chain_lock:
        if recheck:
            _chain_state.pop(host, None)
            _chain_tries.pop(host, None)
        elif host in _chain_state:
            return _chain_state[host]
        elif time.time() - _known_good().get(host, 0) < CHAIN_RECHECK_S:
            _chain_state[host] = "ok"
            return "ok"
        if _chain_tries.get(host, 0) >= CHAIN_TRIES:
            return "unreached"
        _chain_tries[host] = _chain_tries.get(host, 0) + 1
        for proxy in proxies[:CHAIN_TRIES]:
            try:
                state = _verify_host(host, proxy, timeout)
            except OSError:
                continue
            if state != "ok":
                print(f"  chain: {host}: {_fetched_for.get(host, 0)} intermediate(s) "
                      f"fetched, {'verifies' if state == 'completed' else 'does NOT verify'}",
                      flush=True)
            if state != "incomplete":
                _remember_good(host)
            _chain_state[host] = state
            return state
        return "unreached"


class SessionLost(Exception):
    """The route under a session failed; the caller restarts its flow."""


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """A flow asks for one page. A redirect is returned as its 3xx answer and
    never followed, so a session cannot be walked to a page it did not ask for
    (a login page, say)."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Session:
    """Several requests that must share one cookie jar and one exit address.

    Some sources keep state between requests: an ASP.NET page whose postbacks
    carry a view state bound to a session cookie, a form whose antiforgery
    token is bound to a cookie. The pool sends each request down whichever
    route is free, so it cannot carry them. A Session holds ONE verified route
    (never the direct one off a runner) for the length of a flow, spaces its
    own requests, and raises SessionLost when that route fails, so the caller
    starts the flow again on another route rather than continuing a half-made
    session somewhere else.
    """

    # A free relay drops about half its requests now and then (People &
    # Consent, measured 2026-09-25). One more try on the SAME relay keeps the
    # session; a second failure gives the relay up.
    RETRIES = 1
    RETRY_PAUSE_S = 3.0

    def __init__(self, target: str, *, spacing: float = 2.0,
                 timeout: int = 30, avoid: set[str] | None = None):
        routes = [r for r in NET.load_proxies(pool_path(target))
                  if r not in (avoid or set())]
        if not routes and not on_runner():
            raise SystemExit(f"no routes in {pool_path(target)}; run refresh_pool.py")
        # Fastest half first (the file is written fastest first), chosen at
        # random so successive sessions spread over addresses.
        self.proxy = random.choice(routes[: max(1, len(routes) // 2)]) if routes else None
        self.jar = http.cookiejar.CookieJar()
        self.opener = NET.Route(self.proxy).opener()
        self.opener.add_handler(urllib.request.HTTPCookieProcessor(self.jar))
        self.opener.add_handler(_NoRedirect())
        self.spacing, self.timeout, self._next = spacing, timeout, 0.0

    def request(self, url: str, *, data: bytes | None = None,
                headers: dict | None = None) -> tuple[int, bytes, str]:
        """(status, body, final URL). Raises SessionLost on a transport failure."""
        ensure_chain(url, [self.proxy])
        wait = self._next - time.time()
        if wait > 0:
            time.sleep(wait)
        self._next = time.time() + self.spacing
        req = urllib.request.Request(url, data=data,
                                     headers={**NET.DEFAULT_HEADERS, **(headers or {})},
                                     method="POST" if data is not None else "GET")
        tries, chain_checked = 0, False
        while True:
            try:
                with self.opener.open(req, timeout=self.timeout) as r:
                    return r.status, r.read(), r.geturl()
            except urllib.error.HTTPError as e:
                # An answer, refusals included: never asked again from here.
                return e.code, e.read(), url
            except (OSError, http.client.HTTPException) as e:   # a body cut short is not an OSError
                if (not chain_checked and ISSUER_MISSING in str(e)
                        and ensure_chain(url, [self.proxy], recheck=True) == "completed"):
                    chain_checked = True
                    continue
                if tries >= self.RETRIES:
                    raise SessionLost(f"{self.proxy}: {e}") from e
                tries += 1
                time.sleep(self.RETRY_PAUSE_S)


def summary(pool: NET.Pool) -> str:
    s = pool.stats()
    return (f"routes {s['routes_live']}/{s['routes_total']} live, "
            f"sends {s['sends']}, direct "
            + ("suspended" if s["direct_blocked"] else "allowed"))
