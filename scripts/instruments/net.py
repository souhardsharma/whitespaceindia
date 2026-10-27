"""Resilient egress for the PARIVESH fetchers.

WHY THIS EXISTS
---------------
During this project's own backfill, sustained concurrency against one endpoint
got the source IP refused at the TCP layer for hours - not rate-limited, not
throttled, but dropped at connect for every path on that host. The data was
still public and the code was still correct; the instrument simply could not
reach its source. A tool that keeps a public dataset current cannot have a
single point of failure between it and the source, and it cannot be the reason
a government server stops answering.

So this module does two things. It makes the fetchers POLITE ENOUGH not to
provoke that, by watching what the server actually tolerates and slowing down
before it complains rather than after. And it gives them somewhere else to go
when a route dies anyway.

INTEGRITY IS NOT NEGOTIABLE
---------------------------
Requests may be routed through third-party proxies, and those proxies are not
trusted. They do not need to be. Every request is HTTPS with the certificate
chain verified against the system trust store and the hostname checked, so a
proxy CONNECT-tunnels opaque bytes and can neither read nor alter the payload.

Verification is never disabled - not as a fallback, not for a proxy that "only
works that way", not behind a flag. A proxy that cannot carry a verified
tunnel is dropped. The reason is specific to this instrument: its entire claim
is that every published figure traces to an authoritative source, and a
silently rewritten district code or coordinate would pass every invariant the
build has, because it would be internally consistent and merely wrong. A
degraded route is worse than no route, because no route is visible.

HOW A ROUTE IS CHOSEN
---------------------
Direct first, always: it is the fastest and the only one with no third party in
it. Proxies are used when direct is failing, and each is scored on what it has
actually delivered rather than on what a list claimed. A route that starts
failing is rested, not hammered; a route that fails repeatedly is retired.

  used by: fetch_caf.py, fetch_process_history.py, sync.py
"""
from __future__ import annotations

import collections
import json
import os
import random
import ssl
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

USER_AGENT = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/126 Safari/537.36")
# THE HEADERS EVERY REQUEST ACTUALLY CARRIES.
#
# Both fetchers defined their own `HEADERS` dict with a Content-Type and an
# Origin, and neither was ever used: `NET.get` takes no headers argument, so
# every request went out with these. The file that appeared to set the right
# headers was not the file making the request, and the discrepancy was
# invisible at the call site. Those dead dicts are gone and the one thing they
# carried that this lacked - Content-Type on a POST - is here.
DEFAULT_HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "application/json, text/plain, */*",
    "Content-Type": "application/json",
    "Origin": "https://parivesh.nic.in",
    "Referer": "https://parivesh.nic.in/newupgrade/",
}

# Certificate verification, on, for every route. See the module docstring.
TLS = ssl.create_default_context()
TLS.check_hostname = True
TLS.verify_mode = ssl.CERT_REQUIRED

# A route is rested after this many consecutive failures, and retired after
# this many rests. Free proxies die constantly; the pool has to shrink without
# the caller noticing.
# Setting the direct route aside is a claim about the network, and it costs
# the run its fastest path, so it needs more than one bad moment to make and
# it has to be able to be wrong. Three CONSECUTIVE refusals to connect, then
# a suspension that expires and re-tests rather than a verdict that stands
# for the rest of the run.
DIRECT_STRIKES = 3
DIRECT_BLOCK_SECONDS = 300
# The longest we will go without re-testing. The two costs are wildly
# asymmetric: re-testing a real block costs ONE request, while staying stood
# down after a block has lifted costs the direct route's whole share of the
# run - a quarter of it - for however long the suspension has left. So the
# doubling is capped rather than run out to hours. Measured on a live block:
# uncapped, the fifth confirmation would have put the next test 80 minutes
# away, and a block that lifted a minute later would have gone unnoticed for
# the rest of the backfill.
DIRECT_BLOCK_MAX_SECONDS = 900

REST_AFTER = 3
RETIRE_AFTER = 4
REST_SECONDS = 90
# How long a request waits for a RESTING route to come back before giving up:
# a first or second rest. A route rested longer keeps failing, and the caller's
# breaker needs to see that rather than have it hidden in a wait.
REST_WAIT_LIMIT = REST_SECONDS * 2
# Consecutive successes that buy back one rest. Without this the penalty is
# monotonic and the reward is not, so every route retires eventually just for
# having been used long enough: three scattered failures four separate times
# is retirement, however many thousands of clean requests fall between them.
# The pool could then only shrink, and a long run ended on whatever survived.
RECOVERY_WINS = 25

# The most requests one route may have in flight at once, per kind of route.
#
# This is the lesson of the block that prompted this module, and it cuts both
# ways. The original run was not fast because it was well engineered; it was
# fast because it put every request down one route, and that route was
# withdrawn. But capping every route equally is the opposite error: the direct
# route answers in a fifth of a second and a public proxy takes five, so
# treating them alike throttles the good route to the speed of the bad ones.
#
# So the caps differ by what the route is. Direct carries the largest share,
# because it is the fastest and has no third party in it - but far below the
# concurrency that got it withdrawn, which is the number worth remembering.
# Each proxy carries a little, because there are a hundred of them and each is
# someone else's machine.
# The block came at 48 sustained on this route. 20 is comfortably under half,
# and measurement says the extra capacity is real rather than queued: the CAF
# endpoint answers in 6.2s at one concurrent request and 6.1s at six, so the
# server is not slowing under us - it is simply a heavy query, and more slots
# convert to more throughput rather than to a longer queue.
DIRECT_INFLIGHT = 20
PROXY_INFLIGHT = int(os.environ.get("INSTRUMENTS_PROXY_INFLIGHT") or 3)


def _cap(route) -> int:
    return PROXY_INFLIGHT if route.proxy else DIRECT_INFLIGHT


class Route:
    """One way out. `proxy` is None for the direct route."""

    def __init__(self, proxy: str | None):
        self.banned = False
        self.proxy = proxy
        self.ok = 0
        self.fail = 0
        self.streak = 0
        self.wins = 0
        self.rests = 0
        self.resting_until = 0.0
        # When this ADDRESS may send again. See ROUTE_INTERVAL.
        self.next_ok_at = 0.0
        self.dead_streak = 0
        self.latency = 0.0
        self.inflight = 0
        self._lock = threading.Lock()

    @property
    def name(self) -> str:
        return self.proxy or "direct"

    @property
    def retired(self) -> bool:
        # The direct route is never retired. It is the one route we own, the
        # one we can verify independently, and the only one that cannot be
        # replaced from a public list - so it may be rested and it may be
        # suspended, both of which expire, but it is never put beyond recall.
        # Retiring it on twelve scattered failures took it out of a four-hour
        # run for good while it was answering every request it was given.
        if self.proxy is None:
            return False
        return self.banned or self.rests >= RETIRE_AFTER

    def ban(self) -> None:
        """A public proxy the service refuses BY IDENTITY (401/403/407).

        That address is refused - by the service's own rules, or because
        other users of the same public proxy earned it - and it will not
        change within a run: each such proxy carries about one request every
        ninety seconds at the tuned pace, far too few to have earned it. Under
        the rest/retire rule it cost three refusals per rest and four rests
        before retirement, up to twelve wasted sends per banned proxy per run.
        Retired on the first refusal instead; the request moves to another
        route. The direct route is never banned (see `retired`)."""
        if self.proxy is not None:
            self.banned = True

    @property
    def host(self) -> str:
        """The exit IP. Free SOCKS lists carry one IP on several ports; to
        PARIVESH they are one address with one allowance."""
        if self.proxy is None:
            return "direct"
        return self.proxy.split("://", 1)[-1].rsplit(":", 1)[0]

    def available(self, now: float) -> bool:
        return (not self.retired and now >= self.resting_until
                and now >= self.next_ok_at
                and now >= HOST_NEXT_OK.get(self.host, 0.0)
                and self.inflight < _cap(self))

    def opener(self):
        if self.proxy and self.proxy.startswith(("socks5://", "socks4://")):
            # SOCKS routes widen the pool (free SOCKS lists are as large as the
            # HTTP ones). TLS is still end to end with OUR context - PySocks
            # wraps the tunnel with it, certificate and hostname verified - so
            # the proxy moves opaque bytes exactly as a CONNECT proxy does.
            import socks  # PySocks
            import sockshandler
            kind, hostport = self.proxy.split("://", 1)
            host, port = hostport.rsplit(":", 1)
            ptype = socks.SOCKS5 if kind == "socks5" else socks.SOCKS4
            return urllib.request.build_opener(
                sockshandler.SocksiPyHandler(ptype, host, int(port), True, context=TLS))
        handlers = [urllib.request.HTTPSHandler(context=TLS)]
        if self.proxy:
            handlers.insert(0, urllib.request.ProxyHandler(
                {"https": f"http://{self.proxy}", "http": f"http://{self.proxy}"}))
        else:
            # An explicit empty map, so a proxy set in the environment cannot
            # silently become the "direct" route.
            handlers.insert(0, urllib.request.ProxyHandler({}))
        return urllib.request.build_opener(*handlers)

    def record(self, good: bool, seconds: float) -> None:
        # Under its own lock. Several worker threads finish requests on the
        # same route at once, and read-modify-write on `rests`, `wins` and
        # `streak` is not atomic: a lost update either forgives a penalty that
        # was earned or keeps one that was paid off, and both are invisible.
        with self._lock:
            self._record(good, seconds)

    def _record(self, good: bool, seconds: float) -> None:
        if good:
            self.dead_streak = 0
            self.ok += 1
            self.streak = 0
            self.wins += 1
            # Proven again: give back one rest. A route that has served this
            # many requests in a row without a fault is not the route that
            # earned the penalty, and holding it against them for the rest of
            # the run is how a healthy pool empties.
            if self.wins >= RECOVERY_WINS and self.rests:
                self.rests -= 1
                self.wins = 0
            self.latency = seconds if not self.latency else (
                0.7 * self.latency + 0.3 * seconds)
        else:
            self.fail += 1
            self.streak += 1
            self.wins = 0
            if self.streak >= REST_AFTER:
                self.streak = 0
                self.rests += 1
                self.resting_until = time.time() + REST_SECONDS * self.rests

    def score(self) -> float:
        """Lower is better. Direct wins ties; proven routes beat fast claims."""
        base = 0.0 if self.proxy is None else 1.0
        seen = self.ok + self.fail
        rate = (self.fail / seen) if seen else 0.3
        return base + rate * 5 + min(self.latency, 30) / 30


class Pool:
    """Routes, and the pace to use them at.

    The pace is the important half. Concurrency is not fixed: it rises slowly
    while the server is answering and falls sharply the moment it is not, so a
    run settles at whatever the service is willing to give that day instead of
    at a number chosen in advance on a quieter one.
    """

    def __init__(self, proxies: list[str] | None = None,
                 min_workers: int = 2, max_workers: int = 64,
                 start_workers: int | None = None):
        self._lock = threading.Lock()
        self.routes = [Route(None)] + [Route(p) for p in (proxies or [])]
        self.min_workers = min_workers
        # None: the module default. The register and forest SWEEPS set 1.0 -
        # 130 MB answers belong on our own verified route, with proxies only
        # as the fallback when it is stood down.
        self.direct_share: float | None = None
        self.base_max_workers = max_workers
        self.max_workers = max_workers
        self._resize()
        # TOP-DOWN by default: a run starts at its ceiling and the controller
        # only retreats on strain. Starting at 16 and climbing spent the first
        # ~2,000 forms of every run below half speed - measured, 1.6 forms/s
        # rising to 6.3 - and made short tuning trials meaningless.
        start = self.max_workers if start_workers is None else start_workers
        self.workers = float(min(max(start, min_workers), self.max_workers))
        self.window: list[tuple[float, bool]] = []
        # When the direct route may be tried again. A timestamp, not a flag:
        # the refusal that prompted this module lasted nine hours and then
        # lifted, so anything that cannot notice it lifting is wrong in the
        # same way for ever.
        self.direct_blocked_until = 0.0
        self.direct_strikes = 0
        self.direct_blocks = 0
        self.inflight = 0
        self.served_direct = 0
        self.served_proxy = 0
        self.proxy_transport_failures = 0
        # A rolling view of which routes are carrying the run RIGHT NOW. The
        # lifetime totals above cannot show that: after ten thousand requests
        # they move so slowly that the direct route could be withdrawn and the
        # reported share would still look healthy for hours. A monitor that
        # lags the event it exists to catch is not a monitor.
        self.recent: collections.deque = collections.deque(maxlen=400)

    # ── pace ─────────────────────────────────────────────────────────────
    def observe(self, good: bool) -> None:
        """Record an outcome that says something about THE SERVICE, and adjust.

        Only outcomes that bear on the service belong here. A public proxy
        dying mid-request says nothing about how the government server is
        coping, and feeding those in makes the pool retreat from a service that
        is answering perfectly - observed: concurrency fell from 96 to 4 while
        the direct route was returning in 0.17s and the run had recorded no
        failures at all. Route health is tracked separately, on the route.

        Additive increase, multiplicative decrease - the same shape as network
        congestion control, for the same reason: the safe pace is unknown, it
        changes, and the cost of overshooting is far higher than the cost of
        creeping up slowly.
        """
        # The caller's line, cheaply: extract_stack on every outcome cost CPU
        # in a process that is already CPU-bound.
        OBSERVE_TALLY[(bool(good), sys._getframe(1).f_lineno)] += 1
        now = time.time()
        with self._lock:
            self.window.append((now, good))
            cutoff = now - 90
            self.window = [w for w in self.window if w[0] > cutoff]
            if len(self.window) < 10:
                return
            bad = sum(1 for _, g in self.window if not g) / len(self.window)
            if bad > 0.25:
                # Sharp retreat. Overshooting costs hours of blocked access;
                # undershooting costs minutes of throughput.
                self.workers = max(self.min_workers, self.workers * 0.5)
                self.window.clear()
            elif bad < 0.10:
                # Climb in proportion to where we are, so a pool that starts
                # small still reaches a useful pace within minutes rather than
                # within hours. Still additive-increase in shape: bounded, and
                # given up instantly on the first sign of strain.
                self.workers = min(self.max_workers,
                                   self.workers + max(1.0, self.workers * 0.15))
                self.window.clear()

    def concurrency(self) -> int:
        with self._lock:
            return max(self.min_workers, int(self.workers))

    def enter(self) -> None:
        """Wait until this request is within the pace the pool has settled on.

        The worker pool is sized once, for the best case. The pace moves. This
        is what makes the two agree: threads beyond the current allowance wait
        here rather than going to the server, so the run slows down without
        having to be restarted at a smaller size.
        """
        while True:
            with self._lock:
                if self.inflight < max(self.min_workers, int(self.workers)):
                    self.inflight += 1
                    return
            time.sleep(0.05 + random.random() * 0.1)

    def leave(self) -> None:
        with self._lock:
            self.inflight = max(0, self.inflight - 1)

    # ── routes ───────────────────────────────────────────────────────────
    def pick(self) -> Route | None:
        now = time.time()
        with self._lock:
            live = [r for r in self.routes if r.available(now)]
            if not live:
                return None
            if now < self.direct_blocked_until:
                # Suspended means unused. Falling back to it whenever no proxy
                # happened to be free - routine under 10 s spacing - still
                # sent a connect down the suspended address every few seconds.
                live = [r for r in live if r.proxy]
                if not live:
                    return None
            # PROXIES ARE THE DEFAULT EGRESS. With a pool loaded, our own
            # address carries at most DIRECT_SHARE of recent requests, so no
            # single address is the one the whole run leans on. Sustained
            # reads down the direct route alone drew a 403 on 2026-09-25 at
            # 4-5 requests a second; spread over a verified pool, each address
            # carries a small fraction of that.
            proxies = [r for r in live if r.proxy]
            cap = DIRECT_SHARE if self.direct_share is None else self.direct_share
            if proxies and self.recent and cap < 1:
                share = sum(self.recent) / len(self.recent)
                if share >= cap:
                    live = proxies
            live.sort(key=Route.score)
            # Mostly the best route with capacity, sometimes another, so a
            # route that recovers is found again instead of being written off
            # for ever. The capacity cap in available() is what spreads the
            # load; this only decides the order of preference within it.
            # SPREAD, don't favour. PARIVESH allows each address about one
            # request per ~10 s (measured: back-to-back -> 429 after 1-2;
            # 10-30 s apart -> none). Sending 85% of requests to the single
            # best-scored route hammered a few addresses into 429s while
            # hundreds idled. Choose among the better half at random; the
            # per-route interval then rotates load across the whole pool.
            direct_first = [r for r in live if r.proxy is None] if cap >= 1 else []
            if direct_first:
                # A pool set to prefer our own route (the bulk sweeps) uses it
                # whenever it is open; proxies are its fallback.
                chosen = direct_first[0]
            else:
                top = live[:max(1, len(live) // 2)]
                chosen = random.choice(top)
            # Our own address is an address to PARIVESH too, and gets the
            # same spacing - except in a pool set to prefer it (the bulk
            # sweeps: ten sequential sector calls, each several seconds).
            if chosen.proxy is not None:
                chosen.next_ok_at = now + ROUTE_INTERVAL
                HOST_NEXT_OK[chosen.host] = now + ROUTE_INTERVAL
            elif cap < 1:
                chosen.next_ok_at = now + ROUTE_INTERVAL_DIRECT
            chosen.inflight += 1
            if chosen.proxy:
                self.served_proxy += 1
            else:
                self.served_direct += 1
            self.recent.append(chosen.proxy is None)
            return chosen

    def saturated(self) -> bool:
        """Is some route open and merely FULL, rather than none left at all?

        Asked only after `pick()` has come back empty, when the two readings of
        "no route" call for opposite things. Every route rested or retired is
        final and the request should fail at once. Every open route at its
        in-flight cap is a queue a moment long. Treating the second as the
        first made the default run fail on a healthy service: with no proxies
        and `--workers 24` against a direct cap of 20, measured, 220 of 240
        requests came back "no route available" while every route was
        answering 200 - and none of them had been sent.
        """
        now = time.time()
        with self._lock:
            return any(not r.retired and now >= r.resting_until
                       for r in self.routes)

    def resumes_in(self) -> float | None:
        """Seconds until some route can take a request; None if none ever will.

        0.0 means a route is open now (possibly full, which `saturated()`
        describes). A positive value means every usable route is RESTING, and
        is when the first rest ends. None means every route is retired.

        A rest is not a retirement. With no proxies configured - the default,
        and what the scheduled job runs - the direct route is the only route,
        so three consecutive failures rested the whole pool for 90 seconds.
        Every request in that window came back "no route available" without
        being sent, the fetcher's breaker read them as a failing service, and
        the 2026-09-24 sync's history pass aborted on 79 such non-attempts
        while the endpoint was answering in 0.19s.
        """
        now = time.time()
        with self._lock:
            waits = [max(0.0, r.resting_until - now)
                     for r in self.routes if not r.retired]
        return min(waits) if waits else None

    def opens_in(self) -> float:
        """Seconds until an open route (not resting, not retired) clears its
        per-address spacing; 0.0 if one has already.

        A request that found every route spaced waits this long instead of
        re-asking `pick()` ten times a second. Measured on 2026-10-20 with a
        301-route pool: hundreds of waiting threads re-scanning the pool under
        one lock held the fetcher's CPU and read 1.2 forms/s.
        """
        now = time.time()
        with self._lock:
            direct_out = now < self.direct_blocked_until
            waits = []
            for r in self.routes:
                if r.retired or now < r.resting_until:
                    continue
                # A suspended direct route is not open until its suspension
                # ends: counted as clear, it sent every waiter back to 0.25 s
                # polling for the whole suspension, and with no proxies it is
                # the only route there is.
                if r.proxy is None and direct_out:
                    waits.append(self.direct_blocked_until - now)
                    continue
                clear = max(r.next_ok_at, HOST_NEXT_OK.get(r.host, 0.0))
                if clear <= now:
                    return 0.0
                waits.append(clear - now)
        return min(waits) if waits else 0.0

    def has_live_proxy(self) -> bool:
        """Is there a proxy left that could actually take a request?

        NOT `any(r.proxy for r in self.routes)`, which asks whether a proxy was
        ever CONFIGURED. Free proxies retire as a long run wears them out, and
        that is the normal end state of a six-hour backfill - so the old test
        kept answering True long after the pool had emptied.
        
        It decides whether an identity rejection moves the pace. With proxies
        available, a 403 on our own address is charged to that route and the
        run carries on elsewhere. With none, there is nowhere else to go, and
        a run that keeps hammering an address which has just refused it is the
        thing that earned this project a nine-hour block. The escape hatch has
        to open on the real condition, not a historical one.
        """
        now = time.time()
        with self._lock:
            return any(r.proxy and not r.retired and now >= r.resting_until
                       for r in self.routes)

    def release(self, route: "Route") -> None:
        with self._lock:
            route.inflight = max(0, route.inflight - 1)

    def reload_routes(self, path) -> int:
        """Take on any routes named in `path` that this pool does not have.

        A long run outlives its route list. Free proxies die within hours, and
        a pool that can only shrink ends a six-hour backfill on whatever
        survived the first one - which is the single point of failure this
        module exists to remove, arrived at slowly instead of at once.

        Only additive: routes already held keep the health they have earned,
        and a route that was retired is not resurrected by reappearing on a
        list that never knew it failed.
        """
        try:
            wanted = load_proxies(path)
        except Exception:  # noqa: BLE001
            return 0
        with self._lock:
            known = {r.proxy for r in self.routes}
            fresh = [p for p in wanted if p not in known]
            self.routes.extend(Route(p) for p in fresh)
            old_max = self.max_workers
            self._resize()
            # Running at the old ceiling means nothing has pushed it down:
            # take the new ceiling at once rather than climbing to it.
            if fresh and self.workers >= old_max:
                self.workers = float(self.max_workers)
        return len(fresh)

    def _resize(self) -> None:
        """The concurrency ceiling follows the pool.

        The base ceiling was sized for our own address, where every request in
        flight is load on the service. Through a proxy most of a request's
        time is transit - a form takes tens of seconds through one against six
        direct - so a ceiling of 96 over 141 routes left them idle and ran at
        1.7 forms a second. Each proxy ADDRESS adds its own cap (3) to the
        ceiling, up to CONC_LIMIT. What the SERVICE sees is bounded
        separately, by MAX_RPS on every send, whatever the ceiling.

        Addresses, not routes: spacing is per address, and public lists carry
        gateways on hundreds of ports (measured 2026-10-20: 514 of 578 routes
        on five IPs, exiting through two). Counted by route, 1,500 threads
        queued for ~65 addresses and the waiting held the fetcher's CPU.
        """
        hosts = {r.host for r in self.routes if r.proxy and not r.retired}
        self.max_workers = min(CONC_LIMIT, max(self.base_max_workers,
                                               DIRECT_INFLIGHT + PROXY_INFLIGHT * len(hosts)))

    def note_route_transport_failure(self) -> None:
        with self._lock:
            self.proxy_transport_failures += 1

    def note_direct_refused(self) -> None:
        """The direct route could not open a connection at all.

        Only a refusal to CONNECT gets here. A read that ran out of time does
        not: the endpoints this fetches are slow by nature - the CAF form
        answers in about six seconds - so a timeout under load is an ordinary
        event and reading it as an IP-level ban costs the run its best route
        for a reason that was never evidence of anything.
        """
        with self._lock:
            self.direct_strikes += 1
            if self.direct_strikes < DIRECT_STRIKES:
                return
            self.direct_strikes = 0
            self.direct_blocks += 1
            # Longer each time it is re-confirmed, so a real ban is not probed
            # every five minutes for nine hours, and a false one costs little.
            back = min(DIRECT_BLOCK_SECONDS * (2 ** (self.direct_blocks - 1)),
                       DIRECT_BLOCK_MAX_SECONDS)
            self.direct_blocked_until = time.time() + back
            return

    def note_direct_ok(self) -> None:
        """The direct route answered. Whatever we suspected, it was wrong."""
        with self._lock:
            self.direct_strikes = 0
            if self.direct_blocked_until:
                self.direct_blocked_until = 0.0
                self.direct_blocks = 0

    @property
    def blocked_direct(self) -> bool:
        return time.time() < self.direct_blocked_until

    def stats(self) -> dict:
        with self._lock:
            live = [r for r in self.routes if not r.retired]
            return {
                "routes_total": len(self.routes),
                "routes_live": len(live),
                "banned": sum(1 for r in self.routes if getattr(r, "banned", False)),
                "transport_failures": self.proxy_transport_failures,
                "sends": self.served_direct + self.served_proxy,
                "retired": len(self.routes) - len(live),
                "concurrency": int(self.workers),
                "inflight": self.inflight,
                "direct_blocked": self.blocked_direct,
                "direct_blocked_for": max(
                    0, round(self.direct_blocked_until - time.time())),
                # What the direct route has actually done. A share of 0% has
                # several possible causes - suspended, out-scored, or simply
                # unlucky - and they call for different fixes, so the run
                # reports which rather than leaving it to be inferred.
                "direct_route": {
                    "ok": self.routes[0].ok,
                    "fail": self.routes[0].fail,
                    "latency": round(self.routes[0].latency, 2),
                    "score": round(self.routes[0].score(), 3),
                    "best_proxy_score": round(min(
                        (r.score() for r in self.routes[1:]
                         if r.available(time.time())), default=float("inf")), 3),
                    "rests": self.routes[0].rests,
                    "resting": self.routes[0].resting_until > time.time(),
                    "blocks": self.direct_blocks,
                },
                "caps": {"direct": DIRECT_INFLIGHT, "proxy": PROXY_INFLIGHT},
                "served": {"direct": self.served_direct,
                           "proxy": self.served_proxy},
            "recent": {
                "n": len(self.recent),
                "direct_pct": (round(100 * sum(self.recent) / len(self.recent))
                               if self.recent else None),
            },
            "proxy_transport_failures": self.proxy_transport_failures,
                "top": [
                    {"route": r.name, "ok": r.ok, "fail": r.fail,
                     "latency_s": round(r.latency, 2)}
                    for r in sorted(live, key=Route.score)[:5]
                ],
            }


# Returned, with status -1, when a request's deadline passed before it could
# be sent. Nothing was asked of the service, so a caller must treat it as NOT
# ATTEMPTED - never as a failure charged to the source.
DEADLINE_BODY = b"deadline passed before sending"
# Returned when every open route stayed full for the request's whole timeout.
# Also NOT ATTEMPTED: the pool is busy, not failing.
SATURATED_BODY = b"every route full; not sent"
NOT_SENT = (DEADLINE_BODY, SATURATED_BODY)


class SettleStorm:
    """Whether settled "no form" answers are too common to be true.

    A settled 500 is kept out of the circuit breaker because it is an answer,
    not a refusal. But the form server answers 500 for forms that exist once
    it is over its own ceiling (D172: 488 of 495 re-asked ids had a form), and
    a server answering 500 to everything would then settle id after id as
    absent without ever tripping the breaker. Genuine absences are rare - 4 of
    ~116,000 once re-asked gently - so `floor` settles making up `share` of
    the last `window` outcomes is a storm, and the run stops before it
    publishes more of them.

    Off in the nightly re-check (INSTRUMENTS_RECHECK set by sync.py), which
    asks ONLY ids already settled as absent: there every genuine absence
    settles again, and a guard would abort the pass that exists to correct
    a storm. Re-settling an id that is already settled publishes nothing new.
    """

    def __init__(self, window: int = 200, floor: int = 20, share: float = 0.10):
        self.recent: collections.deque = collections.deque(maxlen=window)
        self.floor = floor
        self.share = share
        self.enabled = not os.environ.get("INSTRUMENTS_RECHECK")

    def note(self, settled: bool) -> bool:
        """Record one outcome; True when the recent ones look like a storm."""
        if not self.enabled:
            return False
        self.recent.append(settled)
        n = sum(self.recent)
        return n >= self.floor and n >= self.share * len(self.recent)


# The route mix and the TOTAL pace. DIRECT_SHARE caps our own address's
# share of recent requests whenever a proxy pool is loaded. MAX_RPS caps the
# AGGREGATE request rate across every route: spreading load over many
# addresses must not become a way to put more load on the service.
# Tuned top-down on 2026-09-25 over a 677-route pool, 2,500 real forms per
# step, rate measured at steady state (scratch tune2_results):
#   4/proxy, 24/s, ceiling 2800 -> 9.4 forms/s, 3.1% errors (proxy 403s), breaker
#   3/proxy, 18/s, ceiling 2000 -> 7.4 forms/s, 1.8% errors (proxy 403s)
#   3/proxy, 12/s, ceiling 1500 -> 7.4 forms/s, 0 errors          <- defaults
#   2/proxy, 12/s, ceiling 1000 -> 7.1 forms/s, 0.04%
# The portal is the limit near 7.4 forms/s: past it, more concurrency buys
# per-address refusals and server 500s, not throughput.
DIRECT_SHARE = float(os.environ.get("INSTRUMENTS_DIRECT_SHARE") or 0.2)
CONC_LIMIT = int(os.environ.get("INSTRUMENTS_CONC_LIMIT") or 1500)
MAX_RPS = float(os.environ.get("INSTRUMENTS_MAX_RPS") or 24)

_rate_lock = threading.Lock()
_next_slot = [0.0]

# ── THE WALL FINDS ITSELF ────────────────────────────────────────────────
# Measured on 2026-09-25: the per-ADDRESS allowance is about one request per
# 10 s (ROUTE_INTERVAL handles it), and the form server itself returns 500s
# on forms that exist once the total passes roughly 10-15/s - a wall that
# moves with the portal's own load through the day. So the total pace is not
# a fixed number: it starts at MAX_RPS (the ceiling) and every server ANSWER
# feeds a window. More than REFUSAL_BACKOFF 5xx answers cuts the pace by a
# quarter; a long clean window raises it by a fifth, up to the ceiling and
# never below MAX_RPS_FLOOR. Top-down, and continuously re-found. 403s and
# 429s are per-address and handled per route; they do not move it.
MAX_RPS_FLOOR = float(os.environ.get("INSTRUMENTS_MIN_RPS") or 3)
REFUSAL_BACKOFF = 0.02          # >2% of recent answers refused -> slow down
CLEAN_BELOW = 0.004             # <0.4% over a full window -> speed up
ADAPT_WINDOW = 300              # answers per decision
_rps_now: list = [None]
_answers: "collections.deque" = collections.deque(maxlen=ADAPT_WINDOW)
_adapt_lock = threading.Lock()


ANSWER_TALLY: "collections.Counter" = collections.Counter()
# (route or "direct", status) -> count; for per-address / per-subnet analysis.
ROUTE_TALLY: "collections.Counter" = collections.Counter()
OBSERVE_TALLY: "collections.Counter" = collections.Counter()


def note_answer(status: int, *, route=None) -> None:
    """Every HTTP answer from the SERVICE feeds the pace (not transport
    failures - those are dead proxies, not the service).

    A 500 counts as distress even on the CAF endpoint, where it can mean "no
    form": under load the form server returns 500 for forms that exist
    (D172), and a genuine absence is about 4 in 116,000 - too rare to move a
    2% threshold.
    """
    # Only SERVER distress moves the total pace. Measured with per-address
    # pacing on: the 403s came from our own refused address (15) and one bad
    # proxy (6) - identity, handled per route - while they were cutting the
    # whole run's pace from 30/s to 6.5/s.
    bad = status >= 500
    with _adapt_lock:
        ANSWER_TALLY[status] += 1
        _answer_times.append(time.time())
        ROUTE_TALLY[((route.proxy if route is not None else None) or "direct", status)] += 1
        _answers.append(bad)
        if len(_answers) < ADAPT_WINDOW // 3:
            return
        share = sum(_answers) / len(_answers)
        now = current_rps()
        if share > REFUSAL_BACKOFF:
            _rps_now[0] = max(MAX_RPS_FLOOR, now * 0.75)
            _answers.clear()
        elif len(_answers) >= ADAPT_WINDOW // 2 and share < CLEAN_BELOW and now < MAX_RPS:
            # Recover quickly: the cut is sharp and the ceiling moves through
            # the day, so a slow climb leaves the run far below it for long.
            _rps_now[0] = min(MAX_RPS, now * 1.20)
            _answers.clear()


def current_rps() -> float:
    return _rps_now[0] if _rps_now[0] is not None else MAX_RPS


def throttle(deadline: float | None = None, max_rps: float | None = None) -> bool:
    """Wait for the next send slot under the current pace. False if the
    deadline arrives first (nothing is sent)."""
    rps = current_rps() if max_rps is None else max_rps
    if rps <= 0:
        return True
    with _rate_lock:
        now = time.time()
        slot = max(now, _next_slot[0])
        # A slot past the deadline is refused WITHOUT being reserved: taking
        # it anyway pushed every later send in the process back by one
        # interval per refusal (295 refusals at 100/s stalled the next send
        # 2.96 s).
        if deadline is not None and slot > deadline:
            return False
        _next_slot[0] = slot + 1.0 / rps
    wait = slot - time.time()
    if wait > 0:
        time.sleep(wait)
    return True


_answer_times: "collections.deque" = collections.deque(maxlen=4000)


def answer_rate(window: float = 30.0) -> float:
    """Server answers per second over the last `window` seconds."""
    cut = time.time() - window
    with _adapt_lock:
        n = sum(1 for t in _answer_times if t > cut)
    return n / window


def refund(max_rps: float | None = None) -> None:
    """Give back one pace slot - for a send that never reached the service.

    ONLY while the service is actually answering below the pace. Refunding
    unconditionally, with hundreds of sends in flight into dead proxies, pinned
    the pace clock to "now": the pace read 3/s while the server answered 8-9/s
    and returned 500s. The pace is a bound on what the SERVER sees, measured.
    """
    rps = current_rps() if max_rps is None else max_rps
    if rps <= 0 or answer_rate() >= rps:
        return
    with _rate_lock:
        _next_slot[0] = max(time.time(), _next_slot[0] - 1.0 / rps)


def get(pool: Pool, url: str, *, data: bytes | None = None,
        method: str = "GET", timeout: int = 45, attempts: int = 4,
        deadline: float | None = None, final: frozenset | None = None):
    """One request, over whichever route is healthiest. Returns (status, body).

    Status -1 means every attempt failed. The caller sees a normal result and
    does not need to know which way out was used.

    `final` names the statuses returned on the first answer instead of
    retried; by default RESOURCE_ANSWERS, the per-proposal endpoints' 500.
    A register sector has no "this resource is absent" answer, so its 500 is
    the server failing: the sweeps pass an empty set and retry it, where one
    500 used to fail the whole sector.

    `deadline` (epoch seconds) bounds the whole call, retries included: no
    attempt starts after it, and none is given a timeout that runs past it.
    Without it a fetcher's time budget was checked once per proposal, and
    one proposal could then spend four attempts at a full timeout each - the
    run that budgeted 70 minutes spent 520 seconds on its last four forms.
    """
    last = (-1, b"")
    pool.enter()
    try:
        return _attempt(pool, url, data, method, timeout, attempts, last,
                        deadline,
                        RESOURCE_ANSWERS if final is None else final)
    finally:
        pool.leave()


def pace_response(status, good: bool, has_proxies: bool):
    """Whether an outcome moves the SERVICE pace, and in which direction.

    Returns True or False to feed `pool.observe`, or None to leave the pace
    alone. Extracted from `_attempt` so it can be exercised without a network:
    the rule lived inline across three call sites, and the suite tested the
    PREDICATES it is built from while the dispatch itself could be rewritten
    freely - replacing the guard with a bare `pool.observe(good)` charged every
    403 on our own address to the pace, which is the exact incident this rule
    exists to prevent.

    The rule:
      - a good answer is capacity information: the service served us.
      - a CAPACITY signal (429/502/503/504) is the service saying "slow down".
      - an IDENTITY rejection (401/403/407) is "not you", and says nothing
        about the service's capacity - so it must NOT move the pace, unless
        there is no proxy to fall back to, in which case the run would
        otherwise hammer an address that has just refused it.
      - everything else - 400, 404, and the 500 that means a proposal has no
        form - moves neither.
    """
    if good:
        return True
    if status is None:
        return None
    if is_capacity_signal(status):
        return False
    if is_identity_rejection(status) and not has_proxies:
        return False
    return None


def _attempt(pool, url, data, method, timeout, attempts, last, deadline=None,
             final=None):
    if final is None:
        final = RESOURCE_ANSWERS
    base_timeout = timeout
    for _ in range(attempts):
        # The pace slot is taken BEFORE a route is picked. Taken after, each
        # request held its route's in-flight slot while it queued for the
        # pace; with the ceiling at the pool's full capacity every route read
        # as full, requests waited out their timeout unsent, came back "no
        # route available", and 117 such non-attempts tripped a backfill's
        # breaker in two minutes on a healthy pool.
        if not throttle(deadline):
            return -1, DEADLINE_BODY
        if deadline is not None:
            left = deadline - time.time()
            if left <= 1:
                return -1, DEADLINE_BODY
            timeout = max(1, min(base_timeout, int(left)))
        route = pool.pick()
        # Full is not gone, and neither is rested. A request that finds every
        # route full waits for a slot, bounded by its own timeout. One that
        # finds every route resting waits for the first rest to end, if that
        # is within REST_WAIT_LIMIT - a first or second rest. Nothing is sent
        # during the wait, so the rest still does its job. A longer rest is a
        # route that keeps failing, and the request fails at once so the
        # caller's breaker can act on it.
        waited = 0.0
        while route is None:
            resume = pool.resumes_in()
            if resume is None:
                break
            if resume == 0.0:
                if waited >= timeout:
                    break
                # Sleep until a route's spacing clears, within [0.25 s, 2 s]:
                # the floor still covers a route that is merely full, which
                # frees on a completion no clock predicts.
                pause = (min(2.0, max(0.25, pool.opens_in()))
                         + random.random() * 0.25)
            else:
                if waited + resume > REST_WAIT_LIMIT:
                    break
                pause = min(resume, 1.0) + random.random() * 0.1
            time.sleep(pause)
            waited += pause
            route = pool.pick()
        if route is None:
            refund()              # the slot it held was never spent
            if pool.saturated():
                # Every open route is merely FULL: nothing was sent and
                # nothing failed. The caller keeps it owed.
                return -1, SATURATED_BODY
            return -1, b"no route available"
        t0 = time.time()
        try:
            req = urllib.request.Request(url, data=data,
                                         headers=DEFAULT_HEADERS, method=method)
            with route.opener().open(req, timeout=timeout) as r:
                body = r.read()
                dt = time.time() - t0
                good = r.status == 200
                # A RESOURCE ANSWER is credited on BOTH paths.
                #
                # urllib raises HTTPError for 5xx, so in practice a 500 arrives
                # in the branch below, where it is correctly credited: the
                # route did its job and the answer is a fact about the
                # proposal, not a fault. Here - the same status arriving as a
                # response, which a different opener or handler can produce -
                # it was charged as a route FAILURE. The same fact must not be
                # scored two ways by which door it came through; a route that
                # is asked for 300 formless proposals would have been rested
                # for answering all 300 correctly.
                if r.status == RATE_LIMITED:
                    cool(route)
                route.record(good or r.status in final
                             or r.status == RATE_LIMITED
                             or (route.proxy is None and r.status >= 500), dt)
                pool.release(route)
                note_answer(r.status, route=route)
                if good and route.proxy is None:
                    pool.note_direct_ok()
                # Only a capacity answer moves the pace. See pace_response.
                moved = pace_response(r.status, good, pool.has_live_proxy())
                if moved is not None:
                    pool.observe(moved)
                if good:
                    return r.status, body
                if r.status in final:
                    return r.status, body
                if is_identity_rejection(r.status) and route.proxy is None:
                    pool.note_direct_refused()
                last = (r.status, body[:400])  # noqa: F841
                # Explicit "slow down" answers are worth waiting out.
                if is_capacity_signal(r.status):
                    time.sleep(2 + random.random() * 3)
        except urllib.error.HTTPError as e:
            dt = time.time() - t0
            note_answer(e.code, route=route)
            try:
                err_body = e.read()[:2000]
            except Exception:  # noqa: BLE001
                err_body = b""
            if e.code in final:
                # The origin answered about the proposal. The route did its
                # job, so it is credited, and the answer is returned rather
                # than retried three more times against three more routes.
                route.record(True, dt)
                pool.release(route)
                return e.code, err_body
            if e.code in REQUEST_ANSWERS and is_origin_answer(e.code, err_body):
                # The origin saying the PATH or the request is wrong, in its
                # own error format. A route that carried that answer worked:
                # on 2026-10-24 to 27 every route that reached PARIVESH drew
                # a Spring "404 Not Found" for the register search while the
                # same exits answered the control with 200, and charging each
                # 404 to its route rested and retired the pool - "every route
                # full; not sent" - for an answer no other route could change.
                route.record(True, dt)
                pool.release(route)
                return e.code, err_body
            if e.code == RATE_LIMITED:
                cool(route)
            # A 429 is the address over its allowance, not a bad route. And a
            # 5xx on the DIRECT route is the origin answering, so the route did
            # its job (the pace hears the distress through note_answer). On a
            # proxy a 5xx may be the proxy's own gateway error, so it counts.
            # Charged, three 500s on one register sector rested our own route
            # for 90 s and sent the retry of a 90 MB sector through a free proxy.
            route.record(e.code == RATE_LIMITED
                         or (route.proxy is None and e.code >= 500), dt)
            pool.release(route)
            # An HTTP status came back, but only some of them say anything
            # about the service's capacity. A 403 is the service refusing THIS
            # CALLER: it is charged to the route that earned it and never to
            # the pace. Doing otherwise meant a block on our own address
            # throttled 300 working proxies with it - concurrency fell to 31
            # and throughput to three quarters while every proxy was fine.
            moved = pace_response(e.code, False, pool.has_live_proxy())
            if moved is not None:
                pool.observe(moved)
            # With no proxy configured there is nowhere else to go, so a
            # rejection that moves neither the pace nor the route leaves the
            # run hammering an address that has just said no. Standing the
            # route down is still right; the pace has to give way too.
            # (the no-proxy identity rejection is handled by pace_response)
            if is_identity_rejection(e.code) and route.proxy is None:
                # Our address is not welcome. Stand it down; the suspension
                # expires and re-tests, so a lifted block is noticed.
                pool.note_direct_refused()

            last = (e.code, err_body[:400])
            if is_capacity_signal(e.code):
                time.sleep(2 + random.random() * 3)
        except Exception as exc:  # noqa: BLE001
            dt = time.time() - t0
            route.record(False, dt)
            pool.release(route)
            # No HTTP response at all: the request died in transport. On the
            # direct route that is the service or the path to it, and the pace
            # must react. On a proxy it is almost always the proxy, and
            # reacting would throttle the whole run for one stranger's dead
            # machine - the route is penalised instead, and stops being chosen.
            if route.proxy is None:
                pool.observe(False)
            else:
                pool.note_route_transport_failure()
                # A dead public proxy costs a thread for its whole timeout
                # each time it is tried. Measured: 77% of sends went into
                # dead proxies while the pool was being re-tried every 10 s.
                # Cool it, exponentially, not a retirement: free proxies that WORK still
                # fail about half their requests (measured), and retiring on
                # three in a row cut a 721-route pool to 47 live in minutes.
                route.dead_streak += 1
                route.next_ok_at = max(route.next_ok_at, time.time() + min(
                    DEAD_COOL_MAX, DEAD_COOL * 2 ** (route.dead_streak - 1)))
                # The request died between us and a dead proxy: it never
                # reached PARIVESH, so it gives its pace slot back. The pace
                # meters load ON THE SERVICE; charging it for sends into dead
                # public proxies spent the budget on nobody.
                refund()
            last = (-1, str(exc)[:200].encode())
            # A direct route that cannot even connect is the signature of the
            # IP-level refusal this module exists for. A read that ran out of
            # time is not: these endpoints are slow, and treating slowness as
            # a ban is how the run silently loses the one route it owns.
            if route.proxy is None and is_connect_refusal(exc):
                pool.note_direct_refused()
    return last


# The only statuses that say anything about the SERVICE'S CAPACITY. Everything
# else a server returns is about the request or about the caller, and pacing
# the whole run down for it throttles every healthy route over something none
# of them can fix. A 500 on the CAF endpoint means that one proposal has no
# form - 269 of them do - and each used to slow the run.
# 429 is NOT here. Measured on 2026-09-25 it is PARIVESH's PER-ADDRESS
# limit (one request per ~10 s per address; 37 simultaneous requests through
# 37 addresses drew none). Treated as a capacity signal it halved the whole
# pool's concurrency to 2 because a few favoured addresses were over their own
# allowance. It cools the route that drew it (ROUTE_COOL_429) instead.
CAPACITY_SIGNALS = frozenset({502, 503, 504})
RATE_LIMITED = 429
# "Not you." The service is refusing this caller, not struggling. Charged to
# the route that earned it and to nothing else: when our own address is
# blocked, the proxies are still perfectly welcome, and slowing them down is
# the opposite of the response the block calls for.
IDENTITY_REJECTIONS = frozenset({401, 403, 407})
# Statuses that are the ORIGIN answering about the resource itself. On the CAF
# endpoint a 500 is either "this proposal has no form" or the form server
# over its own ceiling (D172: 488 of 495 such ids answered when re-asked
# gently). Either way it ends the attempt and is not charged to the route:
# retrying charged the carrying route a failure on each attempt, so a
# per-proposal answer rested healthy routes. The fetchers settle an id only
# on a confirmed 500, and note_answer still counts it toward the pace.
RESOURCE_ANSWERS = frozenset({500})
# The origin saying the request or its path is wrong: not found, bad request,
# method not allowed, gone. Asking again down another route cannot change it,
# and it says nothing about the route that carried it - provided the answer is
# the origin's (is_origin_answer), which a proxy's own error page is not.
REQUEST_ANSWERS = frozenset({400, 404, 405, 410})


def is_origin_answer(status: int, body: bytes) -> bool:
    """Whether an HTTP error is PARIVESH's own Spring error body.

    Spring writes {"timestamp", "status", "error", "path"}; a proxy's error
    page does not, and a 404 from a proxy IS a fact about the proxy. The
    status in the body has to agree with the one on the wire.
    """
    try:
        doc = json.loads(body.decode("utf-8", "replace"))
    except ValueError:
        return False
    return (isinstance(doc, dict) and doc.get("status") == status
            and isinstance(doc.get("path"), str))


def is_resource_answer(status: int) -> bool:
    return status in RESOURCE_ANSWERS


def is_capacity_signal(status: int) -> bool:
    return status in CAPACITY_SIGNALS


# Per-address pacing (measured, see pick()). Direct keeps its old behaviour
# (no interval) unless set, since it is one address and capped separately.
ROUTE_INTERVAL = float(os.environ.get("INSTRUMENTS_ROUTE_INTERVAL") or 10)
ROUTE_INTERVAL_DIRECT = float(os.environ.get("INSTRUMENTS_ROUTE_INTERVAL_DIRECT")
                              or ROUTE_INTERVAL)
ROUTE_COOL_429 = 60.0


DEAD_COOL = 30.0
DEAD_COOL_MAX = 1800.0


# Exit IP -> when it may send again (shared by every route on that IP).
HOST_NEXT_OK: dict = {}


def cool(route) -> None:
    """A 429: this address is over its own allowance. Rest it a minute -
    it and every other route leaving from the same IP."""
    until = time.time() + ROUTE_COOL_429
    route.next_ok_at = max(route.next_ok_at, until)
    if route.proxy is not None:
        HOST_NEXT_OK[route.host] = max(HOST_NEXT_OK.get(route.host, 0.0), until)


def is_identity_rejection(status: int) -> bool:
    return status in IDENTITY_REJECTIONS


def is_connect_refusal(exc: BaseException | str) -> bool:
    """Whether this failure is the network refusing us, or merely slowness.

    The distinction decides whether the run gives up its fastest route, so it
    is a named function with tests rather than a condition inside an exception
    handler. A read that ran out of time is NOT a refusal: the CAF form takes
    about six seconds to answer and these runs push twenty at once, so
    timeouts are ordinary and reading them as an IP ban silently drops the
    direct route on the first slow response of the night.

    IT IS GIVEN THE EXCEPTION urllib RAISES, NOT THE ONE THE OS RAISED.
    `AbstractHTTPHandler.do_open` wraps any OSError from the connection in
    `URLError`, so a blackholed connect that the OS reports as
    `TimeoutError("timed out")` arrives here as
    `URLError("<urlopen error timed out>")`. The exact-match branch below then
    missed it - and that is the Linux signature of the refusal this whole
    module exists for, so on the platform the scheduled job runs on the
    detector answered False to its own reason for existing. The errno-110 form
    still matched, but reaching it needs the OS connect timeout (~130s) to beat
    our own socket timeout (45-60s), which it does not.

    Proven, not reasoned: urlopen against a closed port raises
    `URLError('<urlopen error timed out>')` whose `.reason` is
    `TimeoutError('timed out')`.
    """
    # Unwrap to the exception the OS actually raised. HTTPError is a URLError
    # subclass whose `reason` is a status phrase ("Forbidden"), and a status is
    # never transport evidence - it is classified elsewhere - so it is left
    # alone. The loop is bounded because a malformed chain must not hang the
    # only thing standing between the run and a nine-hour block.
    inner: object = exc
    for _ in range(4):
        if isinstance(inner, urllib.error.HTTPError):
            break
        reason = getattr(inner, "reason", None)
        if reason is None or reason is inner:
            break
        inner = reason
    msg = str(inner).lower()
    # A READ that ran out of time is the endpoint being slow, and these
    # endpoints are slow. Never a refusal, and checked first because some of
    # the phrases below also appear in timeout text.
    if "read operation timed out" in msg or "read timed out" in msg:
        return False
    # A NAME that would not resolve is our own resolver, not the far end. It
    # says nothing about whether we are welcome there.
    if "getaddrinfo" in msg or "name or service not known" in msg:
        return False
    # A bare "timed out" with no read in sight. On the Linux runner a
    # blackholed connect surfaces through socket.timeout as exactly that -
    # the read cases are excluded above - so treating it as ordinary slowness
    # made the detector blind on the one platform the scheduled job runs on.
    # The handshake case was pinned as "_ssl.c:1112: ...", an exact compare
    # against a CPython SOURCE LINE NUMBER: the same timeout on a different
    # Python build arrives as _ssl.c:1006 and stopped matching. Match the
    # phrase instead - the file and line are CPython's business, not ours.
    if msg.strip() == "timed out" or "handshake operation timed out" in msg:
        return True
    return any(k in msg for k in (
        # The far end said no, out loud.
        "refused", "unreachable", "no route to host",
        "reset by peer", "connection reset", "forcibly closed",
        # The far end said nothing at all. This is what an IP-level drop looks
        # like from the client: the connection attempt is not answered, no RST
        # comes back, and it eventually gives up. On Windows that is WinError
        # 10060, on Linux errno 110 - and it is the signature of the refusal
        # this module was written for, so omitting it made the detector blind
        # to the one event it exists to catch.
        "winerror 10060", "connection attempt failed",
        "errno 110", "connection timed out",
    ))


def load_proxies(path: Path | str | None = None) -> list[str]:
    """Verified proxies, best first. Lines are `host:port [seconds] [bytes]`."""
    if path is None:
        # Default: the pool refresh_proxies.py keeps in the fetch cache. The
        # proxies are the normal egress, not an opt-in for emergencies.
        env = os.environ.get("INSTRUMENTS_PROXIES", "")
        if not env:
            cache = os.environ.get("INSTRUMENTS_CACHE_DIR", "")
            env = str(Path(cache) / "proxies.txt") if cache else ""
        if not env:
            return []
        path = env
    p = Path(path)
    if not p.exists():
        return []
    out = []
    for line in p.read_text(encoding="utf-8").splitlines():
        tok = line.split()
        if tok and ":" in tok[0]:
            out.append(tok[0])
    shard = os.environ.get("INSTRUMENTS_ROUTE_SHARD", "")
    if shard:
        # A sharded fetcher takes only the exit IPs hashed to it: parallel
        # processes never share an address, so none of them pushes another's
        # address over PARIVESH's per-address allowance.
        import zlib
        i, n = (int(x) for x in shard.split("/"))
        out = [p for p in out
               if zlib.crc32(p.split("://", 1)[-1].rsplit(":", 1)[0].encode()) % n == i]
    return out


PROBE_RECONFIRM_S = 5.0


def probe_direct(url: str, timeout: int = 20) -> tuple[bool, bool]:
    """Is the direct route usable right now, and if not, was it REFUSED?

    Returns (ok, refused). `refused` is true only for a connect-level refusal -
    the signature of an IP block. It used to return a bare bool and the caller
    stood the route down on ANY exception, so a DNS blip or one slow response
    on the sector-list endpoint at process start suspended the fastest route
    for five minutes and pre-seeded `direct_blocks = 1`, which doubles the next
    backoff to ten. The run then spent its opening minutes at proxy latency -
    5.5s against 0.17s - on evidence this module refuses to act on everywhere
    else. `is_connect_refusal` draws the line; the probe now uses it too.
    """
    try:
        opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({}),
            urllib.request.HTTPSHandler(context=TLS))
        with opener.open(urllib.request.Request(url, headers=DEFAULT_HEADERS),
                         timeout=timeout) as r:
            return r.status == 200, False
    except urllib.error.HTTPError as e:
        # The service answered. Not a transport refusal, whatever it said.
        return e.code == 200, is_identity_rejection(e.code)
    except Exception as exc:  # noqa: BLE001
        return False, is_connect_refusal(exc)


def build_pool(*, probe_url: str | None = None, **kw) -> Pool:
    """A pool from $INSTRUMENTS_PROXIES, with direct tested once up front."""
    pool = Pool(load_proxies(), **kw)
    if probe_url:
        ok, refused = probe_direct(probe_url)
        # Only a REFUSAL counts. A probe that merely failed (slow endpoint,
        # resolver hiccup) leaves the route in play, exactly as a failed
        # request does once the run is under way. And a refusal is asked
        # again before it is believed: one transient 403 at the opening of
        # the 2026-10-20 sync sent its 130 MB sweep through free proxies at
        # 300 s a timeout, while a request a minute later answered 200.
        if not ok and refused:
            time.sleep(PROBE_RECONFIRM_S)
            ok, refused = probe_direct(probe_url)
        if not ok and refused:
            pool.direct_blocked_until = time.time() + DIRECT_BLOCK_SECONDS
            pool.direct_blocks = 1
    return pool


if __name__ == "__main__":
    URL = ("https://parivesh.nic.in/parivesh_api/trackYourProposal/"
           "getListOfSector")
    pool = build_pool(probe_url=URL)
    print(f"routes: {len(pool.routes)} (1 direct + {len(pool.routes)-1} proxies)")
    print(f"direct usable: {not pool.blocked_direct}")
    status, body = get(pool, URL)
    print(f"probe -> HTTP {status}, {len(body)} bytes")
    if status == 200:
        print(f"sectors: {len(json.loads(body).get('data') or [])}")
    print(json.dumps(pool.stats(), indent=1))
