"""Tests for the education egress: completing a certificate chain safely.

WHY THIS EXISTS
---------------
Some government hosts present their certificate without the intermediate that
signed it. On GitHub's Linux runner every request to them failed, although the
host had answered. egress.ensure_chain() fetches the missing intermediate from
the address the certificate names, as a browser does.

That is a certificate being taken from the network and put where the verifier
can use it, so the thing to pin is what it can NOT do: a certificate planted
by a proxy, or served from a forged address, must verify nothing. These tests
build real certificates, serve them from a real local TLS server, and fail if
a planted one is ever believed.

Everything is local: 127.0.0.1 only, no outside network.
Needs the `cryptography` package (to make the certificates, not to run egress).
"""
from __future__ import annotations

import datetime
import os
import socket
import ssl
import sys
import tempfile
import threading
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import AuthorityInformationAccessOID, NameOID

CACHE = Path(tempfile.mkdtemp(prefix="egress-test-"))
os.environ["EDUCATION_CACHE_DIR"] = str(CACHE)
sys.path.insert(0, str(Path(__file__).resolve().parent))

import egress  # noqa: E402

NET = egress.NET
PASS = FAIL = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ok    {name}")
    else:
        FAIL += 1
        print(f"  FAIL  {name}  {detail}")


def name(cn: str) -> x509.Name:
    return x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, cn)])


def issue(cn: str, issuer: tuple | None, *, ca: bool, host: str | None = None,
          aia: list[str] | None = None) -> tuple:
    """(certificate, key), signed by `issuer` (certificate, key) or by itself."""
    key = ec.generate_private_key(ec.SECP256R1())
    signer_cert, signer_key = issuer if issuer else (None, key)
    now = datetime.datetime.now(datetime.timezone.utc)
    b = (x509.CertificateBuilder()
         .subject_name(name(cn))
         .issuer_name(signer_cert.subject if signer_cert else name(cn))
         .public_key(key.public_key())
         .serial_number(x509.random_serial_number())
         .not_valid_before(now - datetime.timedelta(days=1))
         .not_valid_after(now + datetime.timedelta(days=30))
         .add_extension(x509.BasicConstraints(ca=ca, path_length=None), critical=True)
         .add_extension(x509.KeyUsage(
             digital_signature=True, key_cert_sign=ca, crl_sign=ca,
             content_commitment=False, key_encipherment=False, data_encipherment=False,
             key_agreement=False, encipher_only=False, decipher_only=False), critical=True)
         .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()),
                        critical=False)
         .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(
             (signer_cert.public_key() if signer_cert else key.public_key())), critical=False))
    if host:
        b = b.add_extension(x509.SubjectAlternativeName([x509.DNSName(host)]), critical=False)
    if aia:
        b = b.add_extension(x509.AuthorityInformationAccess([
            x509.AccessDescription(AuthorityInformationAccessOID.CA_ISSUERS,
                                   x509.UniformResourceIdentifier(u)) for u in aia]),
            critical=False)
    return b.sign(signer_key, hashes.SHA256()), key


def der(cert) -> bytes:
    return cert.public_bytes(serialization.Encoding.DER)


def pem(cert) -> str:
    return cert.public_bytes(serialization.Encoding.PEM).decode()


PORTS: dict[str, int] = {}
TUNNELS: list[str] = []


def serve(host: str, leaf: tuple) -> None:
    """A TLS server on 127.0.0.1 that presents ONLY the leaf, as the sources do."""
    cert, key = leaf
    folder = Path(tempfile.mkdtemp(prefix="egress-srv-"))
    (folder / "c.pem").write_text(pem(cert), encoding="ascii")
    (folder / "k.pem").write_bytes(key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption()))
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(folder / "c.pem", folder / "k.pem")
    listener = socket.create_server(("127.0.0.1", 0))
    PORTS[host] = listener.getsockname()[1]

    def loop() -> None:
        while True:
            raw, _ = listener.accept()
            try:
                with ctx.wrap_socket(raw, server_side=True):
                    pass
            except OSError:
                pass

    threading.Thread(target=loop, daemon=True).start()


def local_tunnel(host: str, proxy, timeout: float) -> socket.socket:
    TUNNELS.append(host)
    if host not in PORTS:
        raise OSError(f"no route to {host}")
    return socket.create_connection(("127.0.0.1", PORTS[host]), timeout)


def fresh_process(root) -> None:
    """What a new process starts with: the trusted root and nothing learned."""
    NET.TLS = ssl.create_default_context(cadata=pem(root))
    NET.TLS.verify_flags &= ~ssl.VERIFY_X509_PARTIAL_CHAIN
    egress._chain_state.clear()
    egress._chain_tries.clear()
    egress._fetched_for.clear()
    egress._intermediates_loaded = False
    TUNNELS.clear()


def verifies(host: str) -> bool:
    try:
        egress._handshake(host, None, 5)
        return True
    except ssl.SSLCertVerificationError:
        return False


def main() -> int:
    root = issue("Trusted Root", None, ca=True)
    mid = issue("Trusted Intermediate", root, ca=True, aia=["http://ca.test/root.crt"])
    good = issue("good.test", mid, ca=False, host="good.test",
                 aia=["ldap://ca.test/x", "http://ca.test/mid.crt"])
    rogue_root = issue("Rogue Root", None, ca=True)
    rogue_mid = issue("Rogue Intermediate", rogue_root, ca=True)
    planted = issue("planted.test", rogue_mid, ca=False, host="planted.test",
                    aia=["http://evil.test/mid.crt"])
    rootonly = issue("rootonly.test", rogue_root, ca=False, host="rootonly.test",
                     aia=["http://evil.test/root.crt"])
    for host, leaf in (("good.test", good), ("planted.test", planted),
                       ("rootonly.test", rootonly)):
        serve(host, leaf)
    served = {"http://ca.test/mid.crt": der(mid[0]), "http://ca.test/root.crt": der(root[0]),
              "http://evil.test/mid.crt": der(rogue_mid[0]),
              "http://evil.test/root.crt": der(rogue_root[0])}
    asked: list[str] = []
    egress._tunnel = local_tunnel
    egress._download_issuer = lambda url: (asked.append(url), served.get(url))[1]

    print("\nreading a certificate")
    issuer, subject = egress.cert_names(der(good[0]))
    check("issuer and subject are read from the DER",
          (issuer, subject) == (mid[0].subject.public_bytes(), good[0].subject.public_bytes()))
    check("a root is seen as self-signed",
          len(set(egress.cert_names(der(root[0])))) == 1)
    check("only http issuer addresses are taken",
          egress.ca_issuer_urls(der(good[0])) == ["http://ca.test/mid.crt"])
    check("a certificate naming none gives none", egress.ca_issuer_urls(der(root[0])) == [])

    print("\na host that sends no intermediate is completed, and verified")
    fresh_process(root[0])
    check("the education process never accepts a partial chain",
          not egress.NET.TLS.verify_flags & ssl.VERIFY_X509_PARTIAL_CHAIN)
    check("before: the handshake fails for the missing issuer", not verifies("good.test"))
    state = egress.ensure_chain("https://good.test/x", [None])
    check("ensure_chain reports it completed", state == "completed", state)
    check("after: the handshake verifies", verifies("good.test"))
    check("the root was offered and NOT taken (self-signed)",
          "http://ca.test/root.crt" in asked
          and len(list((CACHE / "intermediates").glob("*.der"))) == 1)
    TUNNELS.clear()
    egress.ensure_chain("https://good.test/y", [None])
    check("the same process does not ask twice", TUNNELS == [])

    print("\nthe next process starts from the cache")
    fresh_process(root[0])
    check("a verified host is remembered, so no handshake is spent on it",
          egress.ensure_chain("https://good.test/x", [None]) == "ok" and TUNNELS == [])
    check("and its intermediate was loaded from the cache", verifies("good.test"))

    print("\na planted certificate verifies nothing")
    fresh_process(root[0])
    state = egress.ensure_chain("https://planted.test/x", [None])
    check("an intermediate that reaches no trusted root: still does not verify",
          state == "incomplete" and not verifies("planted.test"), state)
    state = egress.ensure_chain("https://rootonly.test/x", [None])
    check("a self-signed certificate from the named address is refused",
          state == "incomplete" and not verifies("rootonly.test"), state)
    loose = ssl.create_default_context(cadata=pem(root[0]))
    loose.verify_flags |= ssl.VERIFY_X509_PARTIAL_CHAIN
    loose.load_verify_locations(cadata=der(rogue_mid[0]))
    with socket.create_connection(("127.0.0.1", PORTS["planted.test"]), 5) as raw:
        try:
            with loose.wrap_socket(raw, server_hostname="planted.test"):
                believed = True
        except ssl.SSLCertVerificationError:
            believed = False
    check("(the same planted certificate IS believed once partial chains are allowed, "
          "which is why they are not)", believed)

    print("\na host no route reaches is asked again, a bounded number of times")
    fresh_process(root[0])
    states = [egress.ensure_chain("https://away.test/x", [None, None, None])
              for _ in range(egress.CHAIN_TRIES + 2)]
    check("it is reported unreached", set(states) == {"unreached"})
    check("and the asking stops", len(TUNNELS) == egress.CHAIN_TRIES * 3, str(len(TUNNELS)))

    print(f"\n{PASS} passed, {FAIL} failed")
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
