"""Opening Nevet to the internet safely (see README, "Open Nevet to everyone").

With Tailscale Funnel (or another tunnel/reverse proxy on the Pi) visitors
reach the web app through a proxy running on the Pi itself, so every
request arrives from 127.0.0.1. LocalProxyFix restores the visitor's real
address and https from the proxy's X-Forwarded-* headers, and only for
requests that really come from the Pi: a device on the LAN sending such
headers directly can't pretend to be someone else.

`where(addr)` tells the rest of the app who it is talking to: 'local' (the
Pi itself), 'lan', 'tailscale' (your own devices) or 'internet'. Internet
visitors need an invite code to sign up, and can't use the default API key.
"""
import ipaddress
import secrets

import traffic


def where(addr):
    return traffic.classify_client(addr) or "local"


def from_internet(addr):
    return where(addr) == "internet"


def _loopback(addr):
    try:
        return ipaddress.ip_address((addr or "").split("%")[0]).is_loopback
    except ValueError:
        return False


class LocalProxyFix:
    def __init__(self, app):
        self.app = app

    def __call__(self, environ, start_response):
        if _loopback(environ.get("REMOTE_ADDR")):
            fwd = environ.get("HTTP_X_FORWARDED_FOR", "")
            if fwd:
                # the proxy on the Pi appends the address it saw; anything left of it came from the visitor
                real = fwd.split(",")[-1].strip()
                try:
                    ipaddress.ip_address(real.split("%")[0])
                    environ["nevet.proxied_from"] = environ["REMOTE_ADDR"]
                    environ["REMOTE_ADDR"] = real
                except ValueError:
                    pass
            proto = environ.get("HTTP_X_FORWARDED_PROTO", "").split(",")[0].strip().lower()
            if proto in ("http", "https"):
                environ["wsgi.url_scheme"] = proto
            host = environ.get("HTTP_X_FORWARDED_HOST", "").split(",")[0].strip()
            if host:
                environ["HTTP_HOST"] = host
        return self.app(environ, start_response)


def new_invite_code():
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"      # no 0/O, 1/I
    return "".join(secrets.choice(alphabet) for _ in range(8))
