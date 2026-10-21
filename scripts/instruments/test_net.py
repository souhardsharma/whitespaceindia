"""Tests for the egress layer.

WHY THIS EXISTS
---------------
This module decides how hard the instrument leans on a government server and
where it goes when a route dies. Both were learned the hard way: sustained
concurrency down one address got that address refused for nine hours, and the
first fix over-corrected so badly that one dead public proxy could throttle the
whole run to nothing while the service was answering in 0.17 seconds.

Neither failure looked like a failure at the time. The first looked like speed
and the second looked like caution, and only the numbers gave them away. So the
behaviours are pinned here rather than left to be re-derived.

Everything runs offline against fabricated routes. No network.
"""
from __future__ import annotations

import sys
import threading
import urllib.error
import urllib.request
import ssl
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import net as NET  # noqa: E402

PASS = FAIL = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ok    {name}")
    else:
        FAIL += 1
        print(f"  FAIL  {name}  {detail}")


def test_integrity() -> None:
    print("\ncertificate verification")
    # The entire safety argument for routing through untrusted intermediaries.
    check("hostname checking is on", NET.TLS.check_hostname is True)
    check("certificates are required",
          NET.TLS.verify_mode.name == "CERT_REQUIRED", NET.TLS.verify_mode.name)
    # THE OPENER THAT ACTUALLY MAKES THE REQUEST, not the source text.
    #
    # These were greps for "CERT_NONE" and "check_hostname = False", which is
    # a check on spelling rather than on behaviour: rewriting Route.opener()
    # to build its handler with ssl._create_unverified_context() introduces
    # neither string, so every request would have gone out unverified with
    # this suite green - and unverified is the one thing that would let a
    # public proxy read or rewrite a district code undetected, because a
    # rewritten payload passes every invariant the build has.
    for label, proxy in (("direct", None), ("through a proxy", "1.2.3.4:8080")):
        opener = NET.Route(proxy).opener()
        https = [h for h in opener.handlers
                 if isinstance(h, urllib.request.HTTPSHandler)]
        check(f"the {label} opener installs exactly one HTTPS handler",
              len(https) == 1, f"{len(https)} handlers")
        if not https:
            continue
        ctx = getattr(https[0], "_context", None)
        check(f"the {label} opener verifies the hostname",
              ctx is not None and ctx.check_hostname is True,
              repr(getattr(ctx, "check_hostname", None)))
        check(f"the {label} opener requires a certificate",
              ctx is not None and ctx.verify_mode == ssl.CERT_REQUIRED,
              getattr(getattr(ctx, "verify_mode", None), "name", "none"))

    # The direct route must carry an EMPTY proxy map, so an https_proxy set in
    # the environment cannot quietly become "direct" - which would report a
    # proxied request as the one route we own and can verify.
    # urllib drops an empty ProxyHandler as a no-op, so the direct opener
    # carries none at all - which is the state being asserted. What must never
    # appear is a proxy map on the route we call "direct".
    direct = NET.Route(None).opener()
    direct_proxies = [h.proxies for h in direct.handlers
                      if isinstance(h, urllib.request.ProxyHandler) and h.proxies]
    check("no environment proxy can masquerade as the direct route",
          not direct_proxies, str(direct_proxies))

    # And the proxied route must actually carry the proxy it was given, or a
    # run would report proxy traffic that in fact went out on our own address.
    via = NET.Route("1.2.3.4:8080").opener()
    via_proxies = [h.proxies for h in via.handlers
                   if isinstance(h, urllib.request.ProxyHandler)]
    check("a proxied route routes through the proxy it names",
          any("1.2.3.4:8080" in str(p) for p in via_proxies),
          str(via_proxies))


def test_route_health() -> None:
    print("\nroute health")
    r = NET.Route("1.2.3.4:8080")
    for _ in range(NET.REST_AFTER):
        r.record(False, 1.0)
    check("a route that keeps failing is rested",
          r.resting_until > 0 and not r.available(NET.time.time()))
    r2 = NET.Route("1.2.3.4:8080")
    for _ in range(NET.REST_AFTER * NET.RETIRE_AFTER):
        r2.record(False, 1.0)
    check("a proxy that keeps failing after rests is retired", r2.retired)

    # The direct route is not disposable: there is one of it, we own it, and
    # it cannot be replaced from a public list. Retiring it on twelve
    # scattered failures took it out of a four-hour run for good while it was
    # answering every request it was given.
    d = NET.Route(None)
    for _ in range(NET.REST_AFTER * NET.RETIRE_AFTER * 4):
        d.record(False, 1.0)
    check("the direct route is never retired", not d.retired,
          f"rests={d.rests}")
    check("but it is rested, which expires",
          d.resting_until > NET.time.time())

    # Monotonic penalties empty a pool. A route that fails a few times, then
    # serves thousands of requests cleanly, is not the route that earned the
    # penalty - and if the penalty never decays, every route retires
    # eventually merely for having been used long enough.
    r3 = NET.Route("5.5.5.5:8080")
    for _ in range(NET.REST_AFTER):
        r3.record(False, 1.0)
    earned = r3.rests
    check("a rest is earned", earned == 1, str(earned))
    for _ in range(NET.RECOVERY_WINS):
        r3.record(True, 0.2)
    check("and paid off by sustained success", r3.rests == 0, str(r3.rests))

    r4 = NET.Route("6.6.6.6:8080")
    for cycle in range(NET.RETIRE_AFTER * 3):
        for _ in range(NET.REST_AFTER):
            r4.record(False, 1.0)
        for _ in range(NET.RECOVERY_WINS):
            r4.record(True, 0.2)
    check("a route that recovers every time is never retired",
          not r4.retired, f"rests={r4.rests} after {NET.RETIRE_AFTER*3} cycles")

    r5 = NET.Route("7.7.7.7:8080")
    for _ in range(NET.REST_AFTER):
        r5.record(False, 1.0)
    for _ in range(NET.RECOVERY_WINS - 1):
        r5.record(True, 0.2)
    r5.record(False, 1.0)
    for _ in range(NET.RECOVERY_WINS - 1):
        r5.record(True, 0.2)
    check("an interrupted recovery does not pay off the rest",
          r5.rests >= 1, f"rests={r5.rests}")
    good, bad = NET.Route(None), NET.Route("5.6.7.8:3128")
    good.record(True, 0.2)
    bad.record(False, 9.0)
    check("a proven route scores better than a failing one",
          good.score() < bad.score(), f"{good.score():.2f} vs {bad.score():.2f}")


def test_load_spreads() -> None:
    print("\nload spreading")
    check("the direct route carries more than a proxy",
          NET.DIRECT_INFLIGHT > NET.PROXY_INFLIGHT,
          f"{NET.DIRECT_INFLIGHT} vs {NET.PROXY_INFLIGHT}")
    check("the direct route stays well under the concurrency that got it "
          "withdrawn", NET.DIRECT_INFLIGHT <= 20, str(NET.DIRECT_INFLIGHT))

    pool = NET.Pool([f"10.0.0.{i}:8080" for i in range(1, 6)])
    picked = [pool.pick() for _ in range(NET.DIRECT_INFLIGHT + 5)]
    check("every request got a route", all(p is not None for p in picked))
    direct = [p for p in picked if p and p.proxy is None]
    check("the direct route is capped, not unlimited",
          len(direct) <= NET.DIRECT_INFLIGHT, f"{len(direct)} picks")
    check("overflow goes to other routes",
          any(p and p.proxy for p in picked))


def test_pace() -> None:
    print("\npace control")
    pool = NET.Pool(["10.0.0.1:8080"], min_workers=2, max_workers=64,
                    start_workers=16)
    start = pool.concurrency()
    for _ in range(60):
        pool.observe(True)
    check("a healthy service lets the pace rise",
          pool.concurrency() > start, f"{start} -> {pool.concurrency()}")

    high = pool.concurrency()
    for _ in range(40):
        pool.observe(False)
    check("a struggling service makes the pace fall sharply",
          pool.concurrency() < high, f"{high} -> {pool.concurrency()}")
    check("the pace never falls below the floor",
          pool.concurrency() >= pool.min_workers)

    # The over-correction that mattered: concurrency fell 96 -> 4 while the
    # service was answering, because dead proxies were being read as strain.
    pool2 = NET.Pool([f"10.0.0.{i}:8080" for i in range(1, 20)],
                     min_workers=2, max_workers=64, start_workers=32)
    before = pool2.concurrency()
    for _ in range(200):
        pool2.note_route_transport_failure()
    check("a dead proxy does not slow the run",
          pool2.concurrency() == before,
          f"{before} -> {pool2.concurrency()}")
    check("dead proxies are still counted",
          pool2.stats()["proxy_transport_failures"] == 200)


def test_reporting() -> None:
    print("\nwhat the run reports about itself")
    pool = NET.Pool(["10.0.0.1:8080", "10.0.0.2:8080"])
    for _ in range(6):
        pool.pick()
    st = pool.stats()
    for key in ("routes_total", "routes_live", "concurrency", "direct_blocked",
                "served", "caps", "proxy_transport_failures"):
        check(f"stats report {key}", key in st, str(sorted(st)))
    check("the mix is counted",
          st["served"]["direct"] + st["served"]["proxy"] == 6,
          str(st["served"]))


def test_direct_is_not_lost_to_slowness() -> None:
    """Setting the direct route aside must be evidence-based and reversible.

    Both halves were wrong once and the run looked healthy throughout: a read
    timeout on a six-second endpoint counted as an IP ban, and the ban was a
    latch nothing could clear. Together they took the fastest route out of a
    93,000-request backfill permanently, on one slow response, while the route
    kept answering in 0.17s. Nothing failed; the run was just quietly three
    times slower for the rest of the night.
    """
    print("\nthe direct route is not lost to slowness")
    check("a read that timed out is not a refusal",
          not NET.is_connect_refusal("The read operation timed out"))
    # A BARE "timed out" is a connect that was never answered. The read cases
    # carry their own wording ("the read operation timed out") and are
    # excluded above, so what is left is the connection attempt expiring -
    # which on Linux, where the scheduled job runs, is how a blackholed
    # address presents. Asserting the opposite here made the detector blind
    # on the one platform that runs unattended.
    check("a bare connect timeout is a refusal",
          NET.is_connect_refusal(TimeoutError("timed out")))
    check("but the read wording still is not",
          not NET.is_connect_refusal("The read operation timed out"))
    check("nor is a read timeout dressed up as an exception",
          not NET.is_connect_refusal(TimeoutError("The read operation timed out")))
    check("a name that would not resolve is our resolver, not the far end",
          not NET.is_connect_refusal(
              "<urlopen error [Errno 11001] getaddrinfo failed>"))
    for m in ("Connection refused", "Network is unreachable",
              "[Errno 104] Connection reset by peer",
              # Silence is the signature. An IP-level drop answers nothing at
              # all: no RST comes back and the attempt simply expires. Reading
              # this as ordinary slowness made the detector blind to the exact
              # event it exists to catch - 61 of these were recorded on this
              # project while it counted none of them.
              "<urlopen error [WinError 10060] A connection attempt failed "
              "because the connected party did not properly respond>",
              "[Errno 110] Connection timed out"):
        check(f"{m.split(']')[-1].strip()[:30]!r} is a refusal",
              NET.is_connect_refusal(m))

    # THE EXCEPTION THE DETECTOR IS ACTUALLY HANDED.
    #
    # Everything above passes a bare exception or a string. `_attempt` does
    # not: it passes what urllib raised, and urllib wraps any connection
    # OSError in URLError. So the Linux blackhole - the signature this module
    # was written for - arrived as URLError("<urlopen error timed out>") and
    # the exact-match branch missed it, while this suite certified the
    # unwrapped object it never sees. The check below is the object urlopen
    # demonstrably produces against a closed port.
    wrapped_connect = urllib.error.URLError(TimeoutError("timed out"))
    check("a URLError-wrapped connect timeout is still a refusal",
          NET.is_connect_refusal(wrapped_connect),
          f"str={str(wrapped_connect)!r}")
    check("a URLError-wrapped read timeout is still not one",
          not NET.is_connect_refusal(
              urllib.error.URLError(TimeoutError("The read operation timed out"))))
    check("a URLError-wrapped DNS failure is still not one",
          not NET.is_connect_refusal(
              urllib.error.URLError(OSError(-2, "Name or service not known"))))
    check("a URLError-wrapped errno 110 is a refusal",
          NET.is_connect_refusal(
              urllib.error.URLError(OSError(110, "Connection timed out"))))
    # An HTTPError is a URLError subclass whose `reason` is a status phrase.
    # A status is never transport evidence, and unwrapping into one would let
    # a 403 - our address being refused at the APPLICATION layer, which is
    # charged to the route elsewhere - also stand the direct route down.
    check("an HTTPError is not unwrapped into a transport verdict",
          not NET.is_connect_refusal(urllib.error.HTTPError(
              "https://x/y", 403, "Forbidden", {}, None)))
    # The handshake case used to be pinned to a CPython source line, so the
    # same timeout on another build stopped matching.
    for line in ("1112", "1006", "9999"):
        check(f"a handshake timeout matches whatever _ssl.c line it cites ({line})",
              NET.is_connect_refusal(
                  f"_ssl.c:{line}: The handshake operation timed out"))

    pool = NET.Pool([f"10.0.0.{i}:8080" for i in range(1, 6)])
    for _ in range(NET.DIRECT_STRIKES - 1):
        pool.note_direct_refused()
    check("one refusal short of the threshold does not suspend",
          not pool.blocked_direct, f"{pool.direct_blocked_until}")
    pool.note_direct_refused()
    check("the threshold suspends the direct route", pool.blocked_direct)
    def sample(pl, n=40):
        """Routes chosen over n picks, releasing each so capacity is free.

        Holding them would fill every proxy and prove nothing: the fallback
        below would kick in and the direct route would be chosen for a
        completely different reason.
        """
        out = []
        for _ in range(n):
            r = pl.pick()
            if r is None:
                break
            out.append(r)
            pl.release(r)
        return out

    check("and pick() then avoids it",
          all(r.proxy for r in sample(pool)))

    pool.note_direct_ok()
    check("an answer from the direct route lifts the suspension",
          not pool.blocked_direct)
    check("and it is chosen again",
          any(r.proxy is None for r in sample(pool)))

    # Suspended means unused. Under 10 s per-address spacing "every proxy is
    # busy" is routine, so a fallback to the suspended route sent connects
    # down a blocked address every few seconds. The request waits instead
    # (SATURATED, owed), and the suspension ends on its own clock.
    busy = NET.Pool(["10.0.0.1:8080"])
    for _ in range(NET.DIRECT_STRIKES):
        busy.note_direct_refused()
    held = [busy.pick() for _ in range(NET.PROXY_INFLIGHT)]
    check("the proxy filled up", all(r and r.proxy for r in held))
    nxt = busy.pick()
    check("a suspended direct route is not used when the proxies are busy",
          nxt is None, "none" if nxt is None else str(nxt.proxy))

    pool2 = NET.Pool(["10.0.0.9:8080"])
    for _ in range(NET.DIRECT_STRIKES):
        pool2.note_direct_refused()
    check("the suspension is a deadline, not a verdict",
          pool2.direct_blocked_until > NET.time.time())

    # However many times a block is re-confirmed, the wait to re-test stays
    # bounded. Re-testing costs one request; staying down after a block lifts
    # costs a quarter of the run for as long as the suspension has left.
    deep = NET.Pool(["10.0.0.9:8080"])
    for _ in range(NET.DIRECT_STRIKES * 12):
        deep.note_direct_refused()
    waited = deep.direct_blocked_until - NET.time.time()
    check("the wait to re-test never runs away",
          waited <= NET.DIRECT_BLOCK_MAX_SECONDS + 1,
          f"{waited:.0f}s after 12 confirmations")
    check("and is still long enough not to hammer a real block",
          waited >= NET.DIRECT_BLOCK_SECONDS, f"{waited:.0f}s")
    pool2.direct_blocked_until = NET.time.time() - 1
    check("and it expires on its own", not pool2.blocked_direct)

    # Non-consecutive failures must not accumulate into a ban.
    pool3 = NET.Pool(["10.0.0.9:8080"])
    for _ in range(NET.DIRECT_STRIKES * 4):
        pool3.note_direct_refused()
        pool3.note_direct_ok()
    check("failures separated by successes never add up to a ban",
          not pool3.blocked_direct)


def test_a_block_is_not_congestion() -> None:
    """A refusal aimed at ONE caller must not slow every other route.

    Observed live: the government server began answering this project's own
    address with 403 while every proxy kept working. Because any non-200 was
    charged to the pace, concurrency fell from 96 to 31 and throughput to
    three quarters - the run punished 300 healthy routes for a rejection none
    of them had received and none of them could fix. The correct response to
    "not you" is to stop using that route, not to slow down.
    """
    print("\na block on one route is not congestion on the service")
    for code in (502, 503, 504):
        check(f"{code} is a capacity signal", NET.is_capacity_signal(code))
    # 429 is PARIVESH's PER-ADDRESS limit (measured 2026-09-25): it cools the
    # address that drew it and never slows the pool.
    check("429 is not a pool-wide capacity signal", not NET.is_capacity_signal(429))
    for code in (401, 403, 407):
        check(f"{code} is a rejection of the caller",
              NET.is_identity_rejection(code)
              and not NET.is_capacity_signal(code))
    for code in (400, 404, 500):
        check(f"{code} moves neither the pace nor the caller",
              not NET.is_capacity_signal(code)
              and not NET.is_identity_rejection(code),
              "a 500 means one proposal has no form, 303 times over")

    # A 500 on this endpoint is the origin answering about the proposal, not a
    # failure. Retrying it charged the carrying route a failure per attempt,
    # so a per-proposal fact rested healthy routes - four requests spent to
    # learn what the first one had already said, 303 times over.
    check("a 500 is a final answer about the resource",
          NET.is_resource_answer(500))

    # THE DISPATCH, not just the predicates it is built from.
    #
    # Everything above tests is_capacity_signal / is_identity_rejection /
    # is_resource_answer. The decision that USES them lived inline in
    # _attempt, which does network I/O, so it was never exercised: replacing
    # the guard with a bare pool.observe(good) charged every 403 on our own
    # address to the service pace - the incident that dropped concurrency from
    # 96 to 31 while all 300 proxies were fine - and this suite stayed green.
    check("a good answer moves the pace up",
          NET.pace_response(200, True, has_proxies=True) is True)
    check("429 leaves the service pace alone (it is one address's limit)",
          NET.pace_response(429, False, has_proxies=True) is None)
    for code in (502, 503, 504):
        check(f"{code} slows the service pace",
              NET.pace_response(code, False, has_proxies=True) is False)
    for code in (401, 403, 407):
        check(f"{code} with proxies available leaves the pace alone",
              NET.pace_response(code, False, has_proxies=True) is None,
              "a refusal aimed at one caller is not congestion")
        check(f"{code} with nowhere else to go does slow the pace",
              NET.pace_response(code, False, has_proxies=False) is False,
              "otherwise the run hammers an address that just said no")
    for code in (400, 404, 500):
        check(f"{code} moves the pace in neither direction",
              NET.pace_response(code, False, has_proxies=True) is None)
    check("a transport failure with no status moves nothing",
          NET.pace_response(None, False, has_proxies=True) is None)
    for code in (200, 403, 404, 429, 502, 503):
        check(f"{code} is not a resource answer",
              not NET.is_resource_answer(code))

    pool = NET.Pool([f"10.0.0.{i}:8080" for i in range(1, 30)],
                    min_workers=2, max_workers=96, start_workers=64)
    before = pool.concurrency()
    for _ in range(200):
        if NET.is_capacity_signal(403):
            pool.observe(False)
    check("a hundred 403s do not slow the run",
          pool.concurrency() == before, f"{before} -> {pool.concurrency()}")

    for _ in range(60):
        if NET.is_capacity_signal(503):
            pool.observe(False)
    check("but a service asking for less still slows it",
          pool.concurrency() < before, f"{before} -> {pool.concurrency()}")

    # And the blocked route is stood down, by the mechanism that expires.
    p2 = NET.Pool(["10.0.0.1:8080"])
    for _ in range(NET.DIRECT_STRIKES):
        if NET.is_identity_rejection(403):
            p2.note_direct_refused()
    check("three rejections stand the direct route down", p2.blocked_direct)
    p2.note_direct_ok()
    check("and an answer brings it straight back", not p2.blocked_direct)


def test_no_route() -> None:
    print("\nwhen there is nowhere to go")
    # Reaching this state is deliberately hard now: the direct route cannot be
    # retired, so every route must be unavailable for another reason. Here the
    # proxy is retired and the direct route is resting, both of which are real
    # states a run passes through.
    pool = NET.Pool(["1.2.3.4:9"])
    pool.routes[1].rests = NET.RETIRE_AFTER
    for _ in range(NET.REST_AFTER):
        pool.routes[0].record(False, 1.0)
    # A rest longer than a request will wait out: a route that keeps failing.
    # (A first rest is waited for - see test_rested_is_not_gone.)
    pool.routes[0].resting_until = NET.time.time() + NET.REST_WAIT_LIMIT + 60
    check("the direct route is resting, not retired",
          not pool.routes[0].retired
          and not pool.routes[0].available(NET.time.time()))
    status, body = NET.get(pool, "https://example.invalid/", attempts=1)
    check("a request with no route fails rather than hanging", status == -1,
          f"status {status}")
    check("and says so", b"no route" in body, body[:60])


def test_rested_is_not_gone() -> None:
    print("\nwhen the only route is resting")
    # The default run has one route. Three failures rest it; the 2026-09-24
    # sync's history pass then failed 79 requests unsent inside the rest and
    # its breaker aborted the pass, while the endpoint answered in 0.19s.
    pool = NET.Pool([])
    direct = pool.routes[0]
    direct.opener = lambda: _FakeOpener(200)
    direct.resting_until = NET.time.time() + 0.6
    check("a resting route reports when it resumes",
          0 < (pool.resumes_in() or 0) <= 0.6)
    t0 = NET.time.time()
    status, _ = NET.get(pool, "https://example.invalid/", attempts=1, timeout=5)
    elapsed = NET.time.time() - t0
    check("a request waits out a short rest and is then served",
          status == 200, f"status {status}")
    check("and nothing was sent before the rest ended", elapsed >= 0.55,
          f"{elapsed:.2f}s")

    pool = NET.Pool([])
    pool.routes[0].resting_until = NET.time.time() + NET.REST_WAIT_LIMIT + 60
    t0 = NET.time.time()
    status, body = NET.get(pool, "https://example.invalid/", attempts=1, timeout=5)
    check("a rest longer than the wait limit still fails at once",
          status == -1 and b"no route" in body and NET.time.time() - t0 < 2,
          f"status {status} after {NET.time.time() - t0:.1f}s")


def test_full_is_not_gone() -> None:
    print("\nwhen every route is merely full")
    # The default run: no proxies, and more workers than the direct route
    # carries. Measured before the fix, 220 of 240 requests to a service
    # answering 200 came back "no route available" without being sent.
    pool = NET.Pool([])
    direct = pool.routes[0]
    direct.opener = lambda: _FakeOpener(200)
    direct.inflight = NET.DIRECT_INFLIGHT
    check("the direct route is full, not resting",
          not direct.available(NET.time.time()) and pool.saturated())
    threading.Timer(0.3, pool.release, args=(direct,)).start()
    t0 = NET.time.time()
    status, _ = NET.get(pool, "https://example.invalid/", attempts=1, timeout=5)
    check("a request to a full route waits for a slot and is served",
          status == 200, f"status {status}")
    check("and waited for the slot rather than the timeout",
          NET.time.time() - t0 < 3, f"{NET.time.time() - t0:.1f}s")

    pool = NET.Pool([])
    pool.routes[0].inflight = NET.DIRECT_INFLIGHT
    t0 = NET.time.time()
    status, body = NET.get(pool, "https://example.invalid/", attempts=1, timeout=1)
    # ...and says it was NOT SENT, so the fetcher keeps it owed instead of
    # counting it toward the breaker (117 of these tripped a healthy run).
    check("a slot that never frees still ends in an answer, not a hang",
          status == -1 and body == NET.SATURATED_BODY and NET.time.time() - t0 < 3,
          f"status {status} after {NET.time.time() - t0:.1f}s")


# ═════════════════════════════════════════════════════════════════════════
# THE WIRING, not the predicates
# ═════════════════════════════════════════════════════════════════════════
class _FakeResponse:
    """What urllib hands back, reduced to what _attempt reads."""

    def __init__(self, status, body=b"ok"):
        self.status = status
        self._body = body

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False


class _FakeOpener:
    def __init__(self, behaviour):
        self.behaviour = behaviour

    def open(self, _req, timeout=None):  # noqa: ARG002
        b = self.behaviour
        if isinstance(b, Exception):
            raise b
        return _FakeResponse(*b) if isinstance(b, tuple) else _FakeResponse(b)


class _FakeRoute:
    def __init__(self, behaviour, proxy=None):
        self.proxy = proxy
        self.dead_streak = 0
        self.next_ok_at = 0.0
        self.behaviour = behaviour
        self.records = []

    def opener(self):
        return _FakeOpener(self.behaviour)

    def ban(self):
        self.banned_by_attempt = True

    def record(self, good, seconds):  # noqa: ARG002
        self.records.append(bool(good))


class _SpyPool:
    """A pool that records what _attempt does to it.

    The point of these tests is NOT whether concurrency lands on a particular
    number - test_pace already pins that from the controller's own inputs. It
    is whether _attempt reaches for the right lever at all, which is the thing
    three separate incidents got wrong while every predicate test stayed green.
    """

    def __init__(self, route, has_proxy_configured=True):
        self.route = route
        self.calls = []
        # `routes` is read by _attempt to decide whether there is anywhere else
        # to go, so it has to look like a pool with proxies in it.
        other = _FakeRoute(200, proxy="10.0.0.9:8080") if has_proxy_configured else None
        self.routes = [route] + ([other] if other else [])

    def pick(self):
        return self.route

    def has_live_proxy(self):
        # The spy's routes are never rested or retired, so "configured" and
        # "live" coincide here. The real Pool.has_live_proxy is exercised by
        # its own checks below.
        return any(r.proxy for r in self.routes)

    def release(self, _route):
        self.calls.append("release")

    def observe(self, good):
        self.calls.append(f"observe:{bool(good)}")

    def note_direct_ok(self):
        self.calls.append("direct_ok")

    def note_direct_refused(self):
        self.calls.append("direct_refused")

    def note_route_transport_failure(self):
        self.calls.append("route_transport_failure")


def test_attempt_wiring() -> None:
    """Every documented incident, pinned at the call site that caused it.

    `_attempt` is the only place the egress rules meet the pool, and it ran
    four of its sixty-five lines under this suite - the `pick() is None` early
    return and nothing else. Measured on a copy, three mutations each an exact
    revert of a documented incident all passed 98 of 98:

      - the pace guard replaced by a bare `pool.observe(good)`, which is the
        403-throttles-300-healthy-proxies incident;
      - the `is_connect_refusal` guard dropped, which is the
        read-timeout-read-as-an-IP-ban incident;
      - a 500 charged to the route as a failure, which is the
        retry-a-per-proposal-fact-four-times incident.

    None of them could be caught, because nothing here ever called the
    function. These tests do, with a stubbed opener, offline.
    """
    print("\nthe wiring between an answer and the pool")

    slept = []
    real_sleep = NET.time.sleep
    NET.time.sleep = lambda s: slept.append(s)
    try:
        # ── 200 on the direct route ──────────────────────────────────────
        r = _FakeRoute((200, b"body"))
        p = _SpyPool(r)
        status, body = NET._attempt(p, "https://x/y", None, "GET", 5, 3, None)
        check("a 200 returns its body", status == 200 and body == b"body",
              f"{status} {body!r}")
        check("a 200 credits the route", r.records == [True], str(r.records))
        check("a 200 on the direct route clears any suspension",
              "direct_ok" in p.calls, str(p.calls))
        # A success DOES feed the pace - that is how concurrency is allowed to
        # grow. What must never happen is a success moving it the wrong way.
        check("a 200 feeds the pace as a success",
              "observe:True" in p.calls and "observe:False" not in p.calls,
              str(p.calls))

        # ── 403 on the direct route: OUR address refused ─────────────────
        # The incident: charging this to the pace dropped concurrency from 96
        # to 31 and throughput to three quarters while all 300 proxies were
        # answering normally.
        r = _FakeRoute((403, b"no"))
        p = _SpyPool(r)
        NET._attempt(p, "https://x/y", None, "GET", 5, 1, None)
        check("a 403 does not move the pace",
              not any(c.startswith("observe") for c in p.calls), str(p.calls))
        check("a 403 on the direct route stands it down",
              "direct_refused" in p.calls, str(p.calls))
        check("a 403 is charged to the route", r.records == [False],
              str(r.records))

        # The SAME status as urllib actually delivers it. urllib raises
        # HTTPError for 4xx, so the response branch above is the one that
        # almost never runs and the branch below is where the incident lived -
        # testing only the first left the mutation that caused it undetected.
        r = _FakeRoute(urllib.error.HTTPError("https://x/y", 403, "no", {}, None))
        p = _SpyPool(r)
        NET._attempt(p, "https://x/y", None, "GET", 5, 1, None)
        check("a 403 raised as HTTPError does not move the pace",
              not any(c.startswith("observe") for c in p.calls), str(p.calls))
        check("a 403 raised as HTTPError stands the direct route down",
              "direct_refused" in p.calls, str(p.calls))
        check("a 403 raised as HTTPError is charged to the route",
              r.records == [False], str(r.records))

        r = _FakeRoute(urllib.error.HTTPError("https://x/y", 404, "gone", {}, None))
        p = _SpyPool(r)
        NET._attempt(p, "https://x/y", None, "GET", 5, 1, None)
        check("a 404 says nothing about capacity and does not move the pace",
              not any(c.startswith("observe") for c in p.calls), str(p.calls))
        check("a 404 does not stand the direct route down",
              "direct_refused" not in p.calls, str(p.calls))

        # ── 403 on a proxy: that proxy's problem, not ours ───────────────
        r = _FakeRoute((403, b"no"), proxy="10.0.0.1:8080")
        p = _SpyPool(r)
        NET._attempt(p, "https://x/y", None, "GET", 5, 1, None)
        check("a 403 on a proxy does not stand the direct route down",
              "direct_refused" not in p.calls, str(p.calls))
        check("a 403 on a proxy still does not move the pace",
              not any(c.startswith("observe") for c in p.calls), str(p.calls))

        # ── 500 on the CAF endpoint: a fact about the PROPOSAL ───────────
        # The incident: retrying it four times charged four route failures for
        # a per-proposal fact and rested healthy routes.
        r = _FakeRoute((500, b"{}"))
        p = _SpyPool(r)
        status, _b = NET._attempt(p, "https://x/y", None, "POST", 5, 4, None)
        check("a 500 is returned, not retried", status == 500, str(status))
        # Credited, and credited the same way whichever path delivered it.
        # This read `[False]` on the response path while the HTTPError path
        # credited the identical status.
        check("a 500 is CREDITED to the route, once",
              r.records == [True], str(r.records))
        check("a 500 does not move the pace",
              not any(c.startswith("observe") for c in p.calls), str(p.calls))

        # The same, arriving as HTTPError rather than a response.
        r = _FakeRoute(urllib.error.HTTPError("https://x/y", 500, "err", {}, None))
        p = _SpyPool(r)
        status, _b = NET._attempt(p, "https://x/y", None, "POST", 5, 4, None)
        check("a 500 raised as HTTPError is also final and credited",
              status == 500 and r.records == [True],
              f"{status} {r.records}")
        # A register sector has no "absent" answer: its caller passes an empty
        # `final`, and one 500 used to fail the whole sector.
        r = _FakeRoute(urllib.error.HTTPError("https://x/y", 500, "err", {}, None))
        p = _SpyPool(r)
        status, _b = NET._attempt(p, "https://x/y", None, "GET", 5, 3, None,
                                  None, frozenset())
        check("with no final statuses a 500 is retried, every attempt",
              len(r.records) == 3,
              f"{status} {r.records}")

        # ── 503: the service asking for less ─────────────────────────────
        r = _FakeRoute(urllib.error.HTTPError("https://x/y", 503, "busy", {}, None))
        p = _SpyPool(r)
        NET._attempt(p, "https://x/y", None, "GET", 5, 1, None)
        check("a 503 moves the pace", "observe:False" in p.calls, str(p.calls))
        check("a 503 does not stand the direct route down",
              "direct_refused" not in p.calls, str(p.calls))
        check("a 503 is waited out", bool(slept), str(slept))

        # ── transport failure on a PROXY ─────────────────────────────────
        # The incident: wiring this to the pace dropped concurrency from 96 to
        # 4 while the service answered in 0.17s and the run had recorded no
        # failures at all.
        r = _FakeRoute(OSError("proxy is dead"), proxy="10.0.0.2:8080")
        p = _SpyPool(r)
        NET._attempt(p, "https://x/y", None, "GET", 5, 1, None)
        check("a dead proxy is charged to the route, not the pace",
              "route_transport_failure" in p.calls
              and not any(c.startswith("observe") for c in p.calls),
              str(p.calls))
        check("a dead proxy never stands the direct route down",
              "direct_refused" not in p.calls, str(p.calls))

        # ── transport failure on DIRECT, a real connect refusal ──────────
        r = _FakeRoute(urllib.error.URLError(TimeoutError("timed out")))
        p = _SpyPool(r)
        NET._attempt(p, "https://x/y", None, "GET", 5, 1, None)
        check("a connect refusal on the direct route moves the pace",
              "observe:False" in p.calls, str(p.calls))
        check("a connect refusal on the direct route stands it down",
              "direct_refused" in p.calls, str(p.calls))

        # ── transport failure on DIRECT that is only slowness ────────────
        # The incident: this took the fastest route out of a 93,000-request
        # backfill on the first slow response of the night, while it was still
        # answering in 0.17s. Nothing errored; the run was three times slower.
        r = _FakeRoute(urllib.error.URLError(
            TimeoutError("The read operation timed out")))
        p = _SpyPool(r)
        NET._attempt(p, "https://x/y", None, "GET", 5, 1, None)
        check("a read timeout on the direct route still moves the pace",
              "observe:False" in p.calls, str(p.calls))
        check("but a read timeout NEVER stands the direct route down",
              "direct_refused" not in p.calls, str(p.calls))

        # ── a name that would not resolve is our own resolver ────────────
        r = _FakeRoute(urllib.error.URLError(
            OSError(-2, "Name or service not known")))
        p = _SpyPool(r)
        NET._attempt(p, "https://x/y", None, "GET", 5, 1, None)
        check("a DNS failure does not stand the direct route down",
              "direct_refused" not in p.calls, str(p.calls))

        # ── every route is released, on every path ───────────────────────
        for behaviour in ((200, b"x"), (403, b"x"), (500, b"x"),
                          OSError("dead"),
                          urllib.error.HTTPError("https://x/y", 503, "b", {}, None)):
            r = _FakeRoute(behaviour)
            p = _SpyPool(r)
            NET._attempt(p, "https://x/y", None, "GET", 5, 1, None)
            check(f"the route is released after {str(behaviour)[:28]!r}",
                  "release" in p.calls, str(p.calls))
    finally:
        NET.time.sleep = real_sleep


def test_the_ledger_settles_only_what_was_answered() -> None:
    """Resume must stop asking, without claiming the register is silent.

    Two opposite failures meet here.

    A 200 whose body carries its own non-200 status was once settled here,
    on the theory that it would not change on asking again. Measured, it
    does: under load the form server fails forms that exist (D172 - 488 of
    495 settled ids answered when re-asked), so retiring such an id kept it
    `pend` for ever with nothing left to read it. It stays owed.

    Nor is it written as 500: `build_data` reads 500 as "the Ministry serves
    no application form for this proposal" and publishes `cf: "none"`. The
    Ministry served a form; reading it is what failed, and that is ours to
    say. Only a 500 settles an id.
    """
    print()
    print("the error ledger settles an answer, not a bad moment")
    import json as _json
    import tempfile
    from pathlib import Path as _Path
    import fetch_caf as CAF

    d = _Path(tempfile.mkdtemp())
    p = d / "caf_errors.jsonl"
    rows = [
        {"id": 1, "status": 500},                                # the service answered
        {"id": 2, "status": 403},                                # our address refused
        {"id": 3, "status": 404},                                # a proxy's error page
        {"id": 4, "status": -1},                                 # died in transport
        {"id": 5, "status": 200, "reason": "unparseable"},       # answered, unreadable
        {"id": 6, "status": 200},                                # nothing conclusive
    ]
    p.write_text("".join(_json.dumps(r) + chr(10) for r in rows),
                 encoding="utf-8")

    done = CAF.load_done(p, answered_only=True)
    check("a 500 settles the id", 1 in done, str(sorted(done)))
    check("an unparseable 200 stays owed", 5 not in done, str(sorted(done)))
    check("a 403 does not", 2 not in done, str(sorted(done)))
    check("a 404 does not", 3 not in done, str(sorted(done)))
    check("a transport failure does not", 4 not in done, str(sorted(done)))
    check("a bare 200 does not", 6 not in done, str(sorted(done)))
    check("nothing else settles", sorted(done) == [1], str(sorted(done)))

    # And the settling set itself stays narrow.
    check("only 500 is a settling STATUS",
          CAF.SETTLED_STATUSES == frozenset({500}),
          str(CAF.SETTLED_STATUSES))


def test_one_place_defines_the_headers() -> None:
    """The file that looks like it sets the headers must be the one that does.

    Both fetchers carried a `HEADERS` dict with a Content-Type and an Origin
    and neither was ever used - `NET.get` takes no headers argument, so every
    request went out with net.py's. A reader tightening the headers would have
    edited a dict with no effect, and the discrepancy is invisible at the call
    site.
    """
    print()
    print("headers are defined once, where the request is made")
    import fetch_caf as CAF
    import fetch_process_history as HIST
    for name, mod in (("fetch_caf", CAF), ("fetch_process_history", HIST)):
        check(f"{name} defines no headers of its own",
              not hasattr(mod, "HEADERS"),
              f"{name}.HEADERS exists again and is not used by NET.get")
    # A POST to this API carries JSON; the header the dead dicts had is here.
    check("the shared headers declare a JSON content type",
          NET.DEFAULT_HEADERS.get("Content-Type") == "application/json",
          str(NET.DEFAULT_HEADERS.get("Content-Type")))


def test_somewhere_else_to_go_means_a_live_route() -> None:
    """The escape hatch must open on the pool's real state.

    `pace_response` treats an identity rejection differently depending on
    whether there is anywhere else to send the request. That question was
    asked as `any(r.proxy for r in pool.routes)` - whether a proxy was ever
    CONFIGURED - and free proxies retire as a long run wears them out, which
    is the normal end state of a six-hour backfill. So the pool could be down
    to the direct route alone and still answer "yes, there are proxies", and a
    403 on our own address would move neither the pace nor anything else,
    leaving the run hammering at full concurrency an address that had just
    refused it. That is precisely how this project earned a nine-hour block.
    """
    print()
    print("somewhere else to go means a route that still works")
    pool = NET.Pool([f"10.0.0.{i}:8080" for i in range(1, 4)])
    check("a fresh pool has live proxies", pool.has_live_proxy())

    for r in pool.routes:
        if r.proxy:
            r.rests = NET.RETIRE_AFTER + 1
    check("a pool whose proxies have all retired has none live",
          not pool.has_live_proxy(),
          f"{[r.proxy for r in pool.routes if r.proxy and not r.retired]}")
    # And the old test would still have said yes.
    check("the configured-proxy test would have disagreed",
          any(r.proxy for r in pool.routes),
          "no proxy configured at all, so the two tests cannot differ")

    # With none live, an identity rejection has to move the pace.
    check("a 403 with nowhere else to go slows the run",
          NET.pace_response(403, False, False) is False,
          str(NET.pace_response(403, False, False)))
    check("a 403 with somewhere else to go does not",
          NET.pace_response(403, False, True) is None,
          str(NET.pace_response(403, False, True)))


def test_the_opening_probe_classifies_its_failure() -> None:
    """A probe that failed is not a probe that was refused.

    `build_pool` stood the direct route down on ANY exception from the opening
    probe, so a DNS blip or one slow response on the sector-list endpoint
    suspended the fastest route for five minutes and pre-seeded
    `direct_blocks = 1`, doubling the next backoff to ten. The run opened at
    proxy latency - 5.5s against 0.17s - on evidence this module refuses to
    act on anywhere else.
    """
    print()
    print("the opening probe tells a refusal from a bad moment")
    import urllib.error as UE
    for exc, refused in (
        (UE.URLError(TimeoutError("timed out")), True),
        (UE.URLError(OSError(111, "Connection refused")), True),
        (UE.URLError(TimeoutError("The read operation timed out")), False),
        (UE.URLError(OSError(-2, "Name or service not known")), False),
    ):
        check(f"probe verdict for {str(exc)[:40]!r}",
              NET.is_connect_refusal(exc) is refused,
              f"{NET.is_connect_refusal(exc)} wanted {refused}")

    # And build_pool acts on that verdict, not on the bare failure. The probe
    # is stubbed so this stays offline.
    real_probe = NET.probe_direct
    try:
        NET.probe_direct = lambda url, timeout=20: (False, False)
        pool = NET.build_pool(probe_url="https://example.invalid/")
        check("a probe that merely failed leaves the direct route in play",
              pool.direct_blocked_until == 0 and pool.direct_blocks == 0,
              f"blocked_until={pool.direct_blocked_until} "
              f"blocks={pool.direct_blocks}")
        NET.probe_direct = lambda url, timeout=20: (False, True)
        pool = NET.build_pool(probe_url="https://example.invalid/")
        check("a probe that was refused stands it down",
              pool.direct_blocked_until > NET.time.time()
              and pool.direct_blocks == 1,
              f"blocked_until={pool.direct_blocked_until}")
        NET.probe_direct = lambda url, timeout=20: (True, False)
        pool = NET.build_pool(probe_url="https://example.invalid/")
        check("a probe that succeeded blocks nothing",
              pool.direct_blocked_until == 0, str(pool.direct_blocked_until))
        answers = iter([(False, True), (True, False)])
        NET.probe_direct = lambda url, timeout=20: next(answers)
        pool = NET.build_pool(probe_url="https://example.invalid/")
        check("a refusal not repeated on re-asking blocks nothing",
              pool.direct_blocked_until == 0, str(pool.direct_blocked_until))
    finally:
        NET.probe_direct = real_probe


def test_a_settled_answer_is_corroborated() -> None:
    """One 500 must not retire a proposal for ever.

    Settling an id is the strongest claim these fetchers make. The build turns
    it into `cf: "none"`, which states on a public register that the Ministry
    serves no application form for that proposal - and it was reached from a
    single 500, on a single attempt, over a single route.

    That is safe only while the endpoint is healthy. A degraded window
    returning 500 to a tenth of requests sits under the circuit breaker's
    threshold and moves no pace at all, because a resource answer is CREDITED
    rather than charged - so nothing in the run would slow down, and nothing
    would notice, while the error ledger filled with permanent false claims
    about a government body. The genuine population is about 300 in 130,000.

    `settle_decision` now requires the answer twice. net.py picks a route per
    attempt, so the second ask almost always leaves by a different one, and an
    answer that survives that is about the proposal rather than the moment.
    """
    print("\na settled answer has to be said twice")
    import fetch_caf as CAF
    import fetch_process_history as HIST

    for name, mod in (("CAF", CAF), ("history", HIST)):
        check(f"{name}: a settled status is not final on first sight",
              mod.settle_decision(500, 0, 0) == "confirm",
              mod.settle_decision(500, 0, 0))
        check(f"{name}: it IS final once corroborated",
              mod.settle_decision(500, 1, 1) == "return",
              mod.settle_decision(500, 1, 1))
        check(f"{name}: it requires more than one confirmation",
              mod.SETTLE_CONFIRMATIONS >= 2, str(mod.SETTLE_CONFIRMATIONS))
        # Only a 500. Admitting anything else is what published 163 proposals
        # as "the regulator serves no form" on the strength of our own block.
        check(f"{name}: nothing but 500 can settle an id",
              mod.SETTLED_STATUSES == frozenset({500}),
              str(mod.SETTLED_STATUSES))
        for st in (403, 404, 429, 502, 503, 504, -1, 200):
            if st in (429, 503, -1):
                want = "retry"
            else:
                want = "return"
            got = mod.settle_decision(st, 0, 0)
            check(f"{name}: {st} decides {want}", got == want, got)
        # And it must not loop for ever - but an answer seen once with no
        # attempt left to confirm it is not corroborated, so the id stays
        # owed. Returning it there let a single 500 retire a proposal.
        check(f"{name}: an unconfirmed settle on the last attempt stays owed",
              mod.settle_decision(500, 0, 2) == "owed",
              mod.settle_decision(500, 0, 2))
        check(f"{name}: a confirmed settle on the last attempt returns",
              mod.settle_decision(500, 1, 2) == "return",
              mod.settle_decision(500, 1, 2))


def test_a_server_error_does_not_rest_our_own_route() -> None:
    """A 5xx on the direct route is the origin answering, not a bad route;
    and a suspended direct route, alone, is waited out rather than polled."""
    print("\na server error does not rest our own route")
    import time

    class _Op:
        def open(self, req, timeout=None):
            raise urllib.error.HTTPError(req.full_url, 500, "boom", {}, None)

    saved = (NET.Route.opener, NET.time.sleep)
    try:
        NET.Route.opener = lambda self: _Op()
        NET.time.sleep = lambda s: None
        p = NET.Pool(["10.7.0.1:8080"])
        p.direct_share = 1.0
        st, _ = NET.get(p, "https://example.invalid/sector", attempts=5,
                        final=frozenset())
        d = [r for r in p.routes if r.proxy is None][0]
        check("five sector 500s leave the direct route unrested",
              st == 500 and d.resting_until <= time.time(),
              f"status {st}, resting {d.resting_until - time.time():.0f} s")
        check("and every retry stays on it",
              p.served_direct == 5 and p.served_proxy == 0,
              f"direct {p.served_direct} proxy {p.served_proxy}")
    finally:
        NET.Route.opener, NET.time.sleep = saved
    p = NET.Pool([])
    p.direct_blocked_until = time.time() + 300
    check("a suspended direct-only pool is waited out, not polled",
          p.pick() is None and p.opens_in() > 290, f"{p.opens_in():.0f}")


def test_the_history_pass_survives_an_error_answer() -> None:
    """The history fetcher's own result loop, end to end, on stubbed answers.

    The storm guard was once placed between `if steps is None:` and its
    `else:`, so the first error answer took the success path and raised on
    len(None): no error ledger, no `.left`, exit 1, every queued id still sent.
    The predicates were all tested; the loop that joins them was not.
    """
    print("\nthe history pass records an error answer and carries on")
    import json as _json
    import os as _os
    import tempfile
    from pathlib import Path as _Path
    import fetch_process_history as HIST

    d = _Path(tempfile.mkdtemp())
    sent = []

    def fake(rec_id, timeout=45, deadline=None):
        sent.append(rec_id)
        if rec_id == 3:
            return 500, b"err"
        if rec_id == 5:
            return 403, b"no"
        if rec_id == 7:
            return 200, b"null"   # parses, but is no envelope
        return 200, _json.dumps({"status": 200, "data": []}).encode()

    ids = d / "ids.json"
    ids.write_text(_json.dumps(list(range(1, 11))), encoding="utf-8")
    saved = (HIST.run_lock.hold_or_exit, HIST.register_cache.load_records,
             HIST.fetch_one, HIST.time.sleep, sys.argv,
             _os.environ.get("INSTRUMENTS_CACHE_DIR"),
             _os.environ.get("INSTRUMENTS_PROXIES"))
    try:
        HIST.run_lock.hold_or_exit = lambda name: None
        HIST.register_cache.load_records = lambda cache, log: [
            {"id": i, "category": "A", "proposalStatus": "x"} for i in range(1, 11)]
        HIST.fetch_one = fake
        HIST.time.sleep = lambda s: None
        _os.environ["INSTRUMENTS_CACHE_DIR"] = str(d)
        _os.environ["INSTRUMENTS_PROXIES"] = str(d / "none.txt")
        sys.argv = ["x", "--workers", "1", "--ids-file", str(ids)]
        try:
            HIST.main()
            raised = ""
        except SystemExit as e:
            raised = "" if e.code in (0, None) else f"exit {e.code}"
        except Exception as e:  # noqa: BLE001
            raised = f"{type(e).__name__}: {e}"
        check("it completes without raising", not raised, raised)
        errs = (d / "history" / "history_errors.jsonl").read_text(encoding="utf-8")
        check("each error answer is in the error ledger",
              '"id": 3' in errs and '"id": 5' in errs, errs)
        recs = (d / "history" / "history.jsonl").read_text(encoding="utf-8").splitlines()
        check("every good answer is recorded, and no error answer is",
              len(recs) == 7, str(len(recs)))
        left = _json.loads((d / "ids.json.left").read_text(encoding="utf-8")) \
            if (d / "ids.json.left").exists() else None
        # A settled 500 stays owed too: a changed pass's ids are cached, and
        # the nightly re-check skips cached ids, so cleared here it was never
        # asked again (D189).
        check("the unread ids are named in .left, the settled 500 among them",
              left == [3, 5, 7], str(left))
    finally:
        (HIST.run_lock.hold_or_exit, HIST.register_cache.load_records,
         HIST.fetch_one, HIST.time.sleep, sys.argv) = saved[:5]
        for k, v in (("INSTRUMENTS_CACHE_DIR", saved[5]),
                     ("INSTRUMENTS_PROXIES", saved[6])):
            if v is None:
                _os.environ.pop(k, None)
            else:
                _os.environ[k] = v


def test_the_form_pass_keeps_a_settled_500_owed() -> None:
    """The form fetcher's own loop: a 500 it settles stays in `.left`.

    A changed pass's ids are already cached and the nightly re-check skips
    cached ids, so a settled 500 counted as answered left the queue and the
    superseded form stayed published for ever (D189).
    """
    print("\na changed form pass keeps a settled 500 owed")
    import json as _json
    import os as _os
    import tempfile
    import time as _time
    from pathlib import Path as _Path
    import fetch_caf as CAF

    d = _Path(tempfile.mkdtemp())
    real_sleep = _time.sleep

    def fake(rec_id, timeout=60, deadline=None):
        if rec_id == 3:
            return 500, b"err"
        if rec_id == 5:
            return 403, b"no"
        return 200, _json.dumps({"status": 200, "data": {}}).encode()

    ids = d / "ids.json"
    ids.write_text(_json.dumps(list(range(1, 11))), encoding="utf-8")
    saved = (CAF.run_lock.hold_or_exit, CAF.register_cache.load_records,
             CAF.fetch_one, CAF.time.sleep, sys.argv,
             _os.environ.get("INSTRUMENTS_CACHE_DIR"),
             _os.environ.get("INSTRUMENTS_PROXIES"))
    try:
        CAF.run_lock.hold_or_exit = lambda name: None
        CAF.register_cache.load_records = lambda cache, log: [
            {"id": i, "category": "A"} for i in range(1, 11)]
        CAF.fetch_one = fake
        # Backoffs return at once; the route-reload thread's 60 s nap is real,
        # so the daemon idles instead of spinning for the rest of the suite.
        CAF.time.sleep = lambda s: real_sleep(s) if s >= 60 else None
        _os.environ["INSTRUMENTS_CACHE_DIR"] = str(d)
        _os.environ["INSTRUMENTS_PROXIES"] = str(d / "none.txt")
        sys.argv = ["x", "--workers", "1", "--ids-file", str(ids)]
        try:
            CAF.main()
            raised = ""
        except SystemExit as e:
            raised = "" if e.code in (0, None) else f"exit {e.code}"
        check("it completes without raising", not raised, raised)
        errs = (d / "caf" / "caf_errors.jsonl").read_text(encoding="utf-8")
        check("the 500 is settled in the error ledger", 3 in CAF.load_done(
            d / "caf" / "caf_errors.jsonl", answered_only=True), errs)
        left = _json.loads((d / "ids.json.left").read_text(encoding="utf-8")) \
            if (d / "ids.json.left").exists() else None
        check("the settled 500 and the refused id stay owed", left == [3, 5], str(left))
        # Owed ids the register no longer holds: nothing to fetch, but still a
        # report, or the sync reads a crash and keeps the debt for ever.
        ids.write_text(_json.dumps([99, 100]), encoding="utf-8")
        (d / "ids.json.left").unlink()
        CAF.main()
        left = _json.loads((d / "ids.json.left").read_text(encoding="utf-8")) \
            if (d / "ids.json.left").exists() else None
        check("an empty pass still reports, owing nothing", left == [], str(left))
        # A pass that runs out of budget should have read current filings:
        # category first, then newest first within it.
        asked = []
        CAF.fetch_one = lambda rec_id, timeout=60, deadline=None: (
            asked.append(rec_id) or fake(rec_id))
        CAF.register_cache.load_records = lambda cache, log: [
            {"id": 20, "category": "A", "dateOfSubmission": "2023-02-16"},
            {"id": 21, "category": "A", "dateOfSubmission": "2026-10-19"},
            {"id": 22, "category": "B2", "dateOfSubmission": "2026-10-19"},
            {"id": 23, "category": "B1", "dateOfSubmission": "2025-01-01"}]
        sys.argv = ["x", "--workers", "1", "--limit", "3"]
        CAF.main()
        check("a new pass reads category A newest first, then B1",
              asked == [21, 20, 23], str(asked))
        # Named ids that --limit cut were not answered, so they stay owed.
        ids.write_text(_json.dumps([20, 21, 22, 23]), encoding="utf-8")
        sys.argv = ["x", "--workers", "1", "--limit", "1", "--ids-file", str(ids)]
        CAF.main()
        left = _json.loads((d / "ids.json.left").read_text(encoding="utf-8"))
        check("ids cut by --limit stay in the report", left == [20, 22, 23], str(left))
    finally:
        (CAF.run_lock.hold_or_exit, CAF.register_cache.load_records,
         CAF.fetch_one, CAF.time.sleep, sys.argv) = saved[:5]
        for k, v in (("INSTRUMENTS_CACHE_DIR", saved[5]),
                     ("INSTRUMENTS_PROXIES", saved[6])):
            if v is None:
                _os.environ.pop(k, None)
            else:
                _os.environ[k] = v


def test_a_deadline_bounds_the_whole_call() -> None:
    """A fetcher's time budget reaches inside the retries.

    Checked only once per proposal, one proposal could spend four attempts at
    a full timeout each past its budget - 520 seconds on the last four forms
    of one run. A request whose deadline has passed must not be SENT, and must
    say so distinctly, because the fetchers count it as owed, not as a failure
    the source caused.
    """
    print("\na deadline bounds the whole call, retries included")
    seen = []

    class _TimedOpener(_FakeOpener):
        def open(self, req, timeout=None):
            seen.append(timeout)
            return super().open(req, timeout)

    class _TimedRoute(_FakeRoute):
        def opener(self):
            return _TimedOpener(self.behaviour)

    r = _TimedRoute((200, b"body"))
    status, body = NET._attempt(_SpyPool(r), "https://x/y", None, "GET", 60, 4,
                                None, NET.time.time() - 1)
    check("a passed deadline sends nothing", seen == [] and r.records == [],
          f"{seen} {r.records}")
    check("a passed deadline is reported as such, not as a failure",
          status == -1 and body == NET.DEADLINE_BODY, f"{status} {body!r}")
    status, _ = NET._attempt(_SpyPool(r), "https://x/y", None, "GET", 60, 4,
                             None, NET.time.time() + 10)
    check("an attempt never gets a timeout that runs past the deadline",
          status == 200 and seen and seen[-1] <= 10, str(seen))
    seen.clear()
    NET._attempt(_SpyPool(r), "https://x/y", None, "GET", 60, 4, None, None)
    check("without a deadline the caller's timeout is used unchanged",
          seen == [60], str(seen))


def test_proxies_are_the_default_egress() -> None:
    """With a pool loaded our own address carries a bounded share, and the
    total pace is capped however many routes there are."""
    print("\nproxies are the default egress, under one total pace")
    pool = NET.Pool([f"10.0.0.{i}:8080" for i in range(1, 30)], max_workers=64)
    direct = 0
    for _ in range(400):
        r = pool.pick()
        if r is None:
            continue
        direct += r.proxy is None
        pool.release(r)
    check("our own address carries no more than its share",
          direct <= 400 * (NET.DIRECT_SHARE + 0.05), f"{direct} of 400 direct")
    big = NET.Pool([f"10.1.{i // 250}.{i % 250}:8080" for i in range(100)], max_workers=96)
    check("the concurrency ceiling grows with the pool (20 + 3 per proxy)",
          big.max_workers == 320, str(big.max_workers))
    huge = NET.Pool([f"10.2.{i // 250}.{i % 250}:8080" for i in range(1000)], max_workers=96)
    check("and stops at CONC_LIMIT", huge.max_workers == NET.CONC_LIMIT, str(huge.max_workers))
    check("with no pool the base ceiling holds", NET.Pool([], max_workers=96).max_workers == 96)
    top = NET.Pool([f"10.4.0.{i}:8080" for i in range(1, 11)], max_workers=10)
    check("a run starts at its ceiling (top-down), not at 16 climbing",
          top.workers == top.max_workers, f"{top.workers} of {top.max_workers}")
    only = NET.Pool([])
    r = only.pick()
    check("with no pool, the direct route still serves", r is not None and r.proxy is None)
    NET._next_slot[0] = 0.0
    t0 = NET.time.time()
    for _ in range(11):
        NET.throttle(max_rps=20)
    took = NET.time.time() - t0
    check("the total pace is capped (11 sends at 20/s take ~0.5 s)",
          0.4 <= took <= 1.0, f"{took:.2f}s")
    NET._next_slot[0] = NET.time.time() + 5
    check("a send slot past the deadline is refused, not waited for",
          NET.throttle(deadline=NET.time.time() + 1, max_rps=1) is False)
    NET._next_slot[0] = 0.0
    before = NET._next_slot[0] = NET.time.time() + 5
    NET.throttle(deadline=NET.time.time() + 1, max_rps=1)
    check("a refused slot does not push later sends back",
          NET._next_slot[0] == before)
    NET._answer_times.clear()
    NET._next_slot[0] = NET.time.time() + 10
    NET.refund(max_rps=1)
    check("a send that never reached the service gives its slot back",
          abs(NET._next_slot[0] - (NET.time.time() + 9)) < 0.5, str(NET._next_slot[0] - NET.time.time()))
    NET._next_slot[0] = 0.0
    NET.refund(max_rps=1)
    check("a refund never moves the clock into the past",
          NET._next_slot[0] >= NET.time.time() - 0.5)
    for _ in range(90):
        NET._answer_times.append(NET.time.time())
    NET._next_slot[0] = NET.time.time() + 10
    NET.refund(max_rps=2)
    check("no refund while the server already answers at the pace",
          NET._next_slot[0] - NET.time.time() > 9.5)
    NET._answer_times.clear()
    NET._next_slot[0] = 0.0
    NET._next_slot[0] = 0.0
    sweep = NET.Pool([f"10.3.0.{i}:8080" for i in range(1, 30)])
    sweep.direct_share = 1.0
    picks = []
    for _ in range(50):
        r = sweep.pick()
        picks.append(r.proxy is None)
        sweep.release(r)
    check("a pool set to prefer direct (the sweeps) keeps using it",
          sum(picks) >= 40, f"{sum(picks)} of 50 direct")
    order = []
    real_throttle = NET.throttle

    class _OrderPool(_SpyPool):
        def pick(self):
            order.append("pick")
            return super().pick()

    def _t(deadline=None, max_rps=None):
        order.append("throttle")
        return True
    NET.throttle = _t
    try:
        NET._attempt(_OrderPool(_FakeRoute((200, b"ok"))), "https://x/y", None, "GET", 5, 1, None)
    finally:
        NET.throttle = real_throttle
    check("the pace slot is taken before a route is held",
          order[:2] == ["throttle", "pick"], str(order))


def test_a_refused_proxy_is_rotated_out() -> None:
    print("\nban() retires a proxy; a 403 alone does not")
    import urllib.error as UE
    r = _FakeRoute(UE.HTTPError("https://x/y", 403, "no", {}, None), proxy="10.9.0.1:8080")
    r.banned = False
    r.proxy = "10.9.0.1:8080"
    real = NET.Route("10.9.0.2:8080")
    real.ban()
    check("ban() retires a proxy immediately", real.retired and not real.available(NET.time.time()))
    d = NET.Route(None)
    d.ban()
    check("the direct route is never banned", not d.retired)
    # Through _attempt: a 403 from a proxy route bans it.
    class _BanRoute(_FakeRoute):
        def __init__(self, *a, **k):
            super().__init__(*a, **k)
            self.was_banned = False
        def ban(self):
            self.was_banned = True
    br = _BanRoute(UE.HTTPError("https://x/y", 403, "no", {}, None), proxy="10.9.0.3:8080")
    NET._attempt(_SpyPool(br), "https://x/y", None, "GET", 5, 1, None)
    # A 403 is NOT an identity verdict on one proxy: measured, 403s follow
    # the TOTAL rate across many proxies (the firewall reacting to load), and
    # banning on the first one wiped a 400-route pool in minutes. It rests
    # the route (strikes) and slows the pace instead.
    check("a 403 through a proxy does not ban it outright", not br.was_banned)
    dr = _BanRoute(UE.HTTPError("https://x/y", 403, "no", {}, None))
    NET._attempt(_SpyPool(dr), "https://x/y", None, "GET", 5, 1, None)
    check("a 403 on the direct route stands it down instead", not dr.was_banned)


def test_the_pace_finds_the_wall() -> None:
    print("\nthe total pace backs off on refusals and recovers when clean")
    old = (NET.MAX_RPS, NET._rps_now[0])
    NET.MAX_RPS = 24.0
    NET._rps_now[0] = None
    NET._answers.clear()
    for _ in range(100):
        NET.note_answer(200)
    for _ in range(5):
        NET.note_answer(503)
    check("server errors above 2% cut the pace by a quarter",
          abs(NET.current_rps() - 18.0) < 0.01, str(NET.current_rps()))
    for _ in range(3):
        for _ in range(100):
            NET.note_answer(503)
    check("and keep cutting, down to the floor", NET.current_rps() >= NET.MAX_RPS_FLOOR
          and NET.current_rps() < 10, str(NET.current_rps()))
    low = NET.current_rps()
    for _ in range(NET.ADAPT_WINDOW):
        NET.note_answer(200)
    check("a clean full window raises it again", NET.current_rps() > low, str(NET.current_rps()))
    NET._rps_now[0] = 24.0
    for _ in range(NET.ADAPT_WINDOW):
        NET.note_answer(200)
    check("never above the ceiling", NET.current_rps() <= NET.MAX_RPS)
    NET._answers.clear()
    for _ in range(200):
        NET.note_answer(200)
    NET.note_answer(500)
    for _ in range(300):
        NET.note_answer(403)
    check("identity refusals (403) never move the total pace",
          NET.current_rps() == 24.0, str(NET.current_rps()))
    check("a stray 500 (a formless proposal) does not slow the run",
          NET.current_rps() == 24.0)
    NET.MAX_RPS, NET._rps_now[0] = old
    NET._answers.clear()


def test_each_address_is_paced() -> None:
    print("\neach address sends at most once per interval; a 429 cools it")
    old = (NET.ROUTE_INTERVAL, NET.ROUTE_INTERVAL_DIRECT)
    NET.ROUTE_INTERVAL = NET.ROUTE_INTERVAL_DIRECT = 10.0
    try:
        pool = NET.Pool([f"10.5.0.{i}:8080" for i in range(1, 11)])
        got = []
        for _ in range(40):
            r = pool.pick()
            if r is None:
                break
            got.append(r.proxy)
            pool.release(r)
        check("within one interval no address is used twice",
              len(got) == len(set(got)) and len(got) <= 11, f"{len(got)} picks, {len(set(got))} distinct")
        check("the load spreads over the whole pool", len(set(got)) >= 10, str(len(set(got))))
        NET.HOST_NEXT_OK.clear()
        twins = NET.Pool(["socks5://10.5.9.9:1080", "socks5://10.5.9.9:1081"])
        picked = [r.proxy for r in (twins.pick() for _ in range(5)) if r is not None and r.proxy]
        check("two ports on one exit IP share one allowance",
              len(picked) == 1, str(picked))
        NET.HOST_NEXT_OK.clear()
        r = NET.Route("10.5.1.1:8080")
        NET.cool(r)
        check("a 429 cools that address for a minute",
              r.next_ok_at - NET.time.time() > 55 and not r.available(NET.time.time()))
        sweep = NET.Pool([f"10.5.2.{i}:8080" for i in range(1, 5)])
        sweep.direct_share = 1.0
        d = [sweep.pick() for _ in range(3)]
        for r in d:
            if r:
                sweep.release(r)
        check("a sweep pool keeps using our own route back to back",
              all(r is not None and r.proxy is None for r in d), str([r and r.proxy for r in d]))
    finally:
        NET.ROUTE_INTERVAL, NET.ROUTE_INTERVAL_DIRECT = old


def test_waiting_sleeps_until_a_route_clears() -> None:
    """A request that finds every route spaced sleeps until one clears.

    It used to re-ask pick() every 0.05-0.15 s. With a 301-route pool,
    hundreds of waiting threads re-scanning the pool under one lock held the
    fetcher's CPU and it read 1.2 forms/s (2026-10-20).
    """
    print("\nwaiting for a spaced route sleeps until it clears")
    NET.HOST_NEXT_OK.clear()
    pool = NET.Pool([f"10.8.0.{i}:8080" for i in range(1, 4)])
    pool.direct_share = 0.0
    now = NET.time.time()
    for i, r in enumerate(pool.routes):
        r.next_ok_at = now + 3.0 + i
    check("every route spaced: the wait is until the soonest clears",
          2.5 < pool.opens_in() <= 3.0, f"{pool.opens_in():.2f}")
    pool.routes[2].next_ok_at = 0.0
    check("a route clear now: no wait", pool.opens_in() == 0.0)
    pool.routes[2].resting_until = now + 600
    check("a resting route is not counted as about to open",
          pool.opens_in() > 0.0, f"{pool.opens_in():.2f}")
    # A suspended direct route is not open either: pick() will not use it,
    # and counting it as clear sent every waiter back to fast polling.
    direct = NET.Pool([])
    proxied = NET.Pool(["10.8.1.1:8080"])
    for pl in (direct, proxied):
        for r in pl.routes:
            r.next_ok_at = now + 9.0 if r.proxy else 0.0
        pl.direct_blocked_until = now + 300
    check("a suspended direct route does not read as open",
          proxied.opens_in() > 5.0, f"{proxied.opens_in():.2f}")
    NET.HOST_NEXT_OK.clear()


def test_the_refresher_counts_addresses() -> None:
    """At most PORTS_PER_HOST ports of one address, known pool included; and a
    429 at probe time is the address's allowance, not a dead route."""
    print("\nthe pool refresher counts addresses and keeps rate-limited routes")
    import refresh_proxies as RP
    routes = [f"socks5://45.74.31.42:{1000 + i}" for i in range(9)] + ["1.2.3.4:80"]
    kept, excess = RP.cap_ports(routes)
    check("one gateway address keeps PORTS_PER_HOST ports, in order",
          kept[:RP.PORTS_PER_HOST] == routes[:RP.PORTS_PER_HOST]
          and len(kept) == RP.PORTS_PER_HOST + 1, str(kept))
    check("its other ports are named, so the rotation can drop them",
          len(excess) == 9 - RP.PORTS_PER_HOST)

    class _Op:
        def __init__(self, exc):
            self.exc = exc

        def open(self, *a, **k):
            raise self.exc

    saved = RP.NET.Route.opener
    try:
        RP.NET.Route.opener = lambda self: _Op(urllib.error.HTTPError(
            "https://x", 429, "slow", {}, None))
        check("a 429 at probe time reads as rate-limited, not failed",
              RP.probe("10.9.0.1:8080") == RP.LIMITED)
        RP.NET.Route.opener = lambda self: _Op(urllib.error.HTTPError(
            "https://x", 403, "no", {}, None))
        check("a 403 is still a failed probe", RP.probe("10.9.0.1:8080") is None)
    finally:
        RP.NET.Route.opener = saved

    # PARIVESH answers only Indian addresses, so they are probed first.
    india = ([RP.ip_number("103.0.0.0:1")], [RP.ip_number("103.255.255.255:1")])
    order = RP.india_first(["8.8.8.8:80", "socks5://103.250.166.04:1080",
                            "1.1.1.1:80", "103.1.2.3:3128"], india)
    check("Indian candidates are probed first, each group in list order",
          order == ["socks5://103.250.166.04:1080", "103.1.2.3:3128",
                    "8.8.8.8:80", "1.1.1.1:80"], str(order))
    check("without the country table the order is unchanged",
          RP.india_first(["8.8.8.8:80", "103.1.2.3:3128"], None)
          == ["8.8.8.8:80", "103.1.2.3:3128"])
    check("list notation: HTTP bare, SOCKS schemed",
          RP.as_route("HTTP", "1.2.3.4:80") == "1.2.3.4:80"
          and RP.as_route("socks4", "1.2.3.4:80") == "socks4://1.2.3.4:80")


def test_a_settle_storm_stops_the_run() -> None:
    """Settled 500s too common to be absences stop a run (review 2026-10-20).

    Kept out of the breaker as answers, a server answering 500 to everything
    would otherwise settle id after id as "no form" and never trip anything.
    """
    print("\na storm of settled 500s stops the run; scattered ones do not")
    import os
    saved = os.environ.pop("INSTRUMENTS_RECHECK", None)
    try:
        g = NET.SettleStorm()
        fired = [g.note(i % 3 == 0) for i in range(60)]
        check("a third of outcomes settling is a storm, stopped by the 20th",
              any(fired) and fired.index(True) <= 58, str(fired.index(True)
                                                           if any(fired) else None))
        g = NET.SettleStorm()
        fired = [g.note(i % 100 == 0) for i in range(5000)]
        check("one in a hundred is never a storm (floor of 20 in 200)",
              not any(fired))
        os.environ["INSTRUMENTS_RECHECK"] = "1"
        g = NET.SettleStorm()
        check("the nightly re-check, which asks only settled ids, is exempt",
              not any(g.note(True) for _ in range(500)))
    finally:
        os.environ.pop("INSTRUMENTS_RECHECK", None)
        if saved is not None:
            os.environ["INSTRUMENTS_RECHECK"] = saved


def test_dead_proxies_are_dropped_fast() -> None:
    print("\na proxy that dies in transport cools, longer each time; never retired")
    r = _FakeRoute(OSError("tunnel failed"), proxy="10.6.0.1:8080")
    banned = []
    r.ban = lambda: banned.append(1)
    for _ in range(3):
        NET._attempt(_SpyPool(r), "https://x/y", None, "GET", 5, 1, None)
    check("repeated transport failures cool it exponentially (30, 60, 120 s)",
          110 < r.next_ok_at - NET.time.time() <= 121, str(r.next_ok_at - NET.time.time()))
    check("flaky is not dead: it is never retired for it", banned == [], str(banned))


def test_socks_routes_keep_verification() -> None:
    print("\na SOCKS route uses our verified TLS context")
    import sockshandler
    op = NET.Route("socks5://10.7.0.1:1080").opener()
    h = [x for x in op.handlers if isinstance(x, sockshandler.SocksiPyHandler)]
    check("a socks5 route opens through PySocks", len(h) == 1)
    check("with OUR context (certificate and hostname verified)",
          h and h[0].kw.get("context") is NET.TLS and NET.TLS.check_hostname
          and NET.TLS.verify_mode == __import__("ssl").CERT_REQUIRED)
    op4 = NET.Route("socks4://10.7.0.2:1080").opener()
    check("socks4 too", any(isinstance(x, sockshandler.SocksiPyHandler) for x in op4.handlers))


def main() -> int:
    # Route choice is random by design (load spreads across the pool); the
    # suite fixes the seed so a probabilistic check cannot flake.
    NET.random.seed(20260925)
    # The offline suite mocks sleep in places; a global pace would bank
    # imaginary waits. The pace has its own test below.
    NET.MAX_RPS = 0
    # Most checks pick the same route repeatedly to test caps and rests; the
    # per-address interval has its own test below.
    NET.ROUTE_INTERVAL = 0
    NET.ROUTE_INTERVAL_DIRECT = 0
    for fn in (test_integrity, test_route_health, test_load_spreads,
               test_pace, test_reporting, test_direct_is_not_lost_to_slowness,
               test_a_block_is_not_congestion, test_no_route, test_full_is_not_gone,
               test_rested_is_not_gone,
               test_attempt_wiring,
               test_a_settled_answer_is_corroborated,
               test_somewhere_else_to_go_means_a_live_route,
               test_the_opening_probe_classifies_its_failure,
               test_the_ledger_settles_only_what_was_answered,
               test_one_place_defines_the_headers,
               test_a_deadline_bounds_the_whole_call,
               test_proxies_are_the_default_egress,
               test_a_refused_proxy_is_rotated_out,
               test_the_pace_finds_the_wall,
               test_each_address_is_paced,
               test_waiting_sleeps_until_a_route_clears,
               test_a_settle_storm_stops_the_run,
               test_the_refresher_counts_addresses,
               test_the_history_pass_survives_an_error_answer,
               test_the_form_pass_keeps_a_settled_500_owed,
               test_a_server_error_does_not_rest_our_own_route,
               test_dead_proxies_are_dropped_fast,
               test_socks_routes_keep_verification):
        fn()
    print()
    if FAIL:
        print(f"{FAIL} of {PASS + FAIL} checks FAILED")
        return 1
    print(f"all {PASS} checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
