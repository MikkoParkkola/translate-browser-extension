import pytest

class ProviderError(Exception):
    """Simple provider-level error for test harness"""
    pass


class HTTPError(ProviderError):
    """Error carrying an HTTP status code to simulate provider HTTP failures."""

    def __init__(self, status):
        super().__init__(f"HTTP {status}")
        self.status = status

class FakeProvider:
    """A minimal fake provider used by tests.

    - name: identifier returned in responses
    - endpoints: list of endpoints this provider advertises
    - response: payload returned on success
    - fail: if True, send() raises ProviderError to simulate provider failure
    """
    def __init__(self, name, endpoints=None, response=None, fail=False):
        self.name = name
        self.endpoints = set(endpoints or [])
        self.response = response if response is not None else {"text": "ok"}
        self.fail = fail
        self.last_request = None

    def send(self, request):
        self.last_request = request
        if self.fail:
            raise ProviderError("simulated failure")
        # Return a normalized response shape used across the dispatcher/tests
        return {"provider": self.name, "endpoint": request.get("endpoint"), "result": self.response}

class ProviderRegistry:
    """Test-only provider registry supporting registration by name and endpoint."""
    def __init__(self):
        self._by_name = {}
        self._by_endpoint = {}

    def register(self, name, provider, endpoints=None):
        self._by_name[name] = provider
        for ep in (endpoints or []):
            self._by_endpoint.setdefault(ep, []).append(provider)

    def get_by_name(self, name):
        return self._by_name.get(name)

    def get_by_endpoint(self, endpoint):
        return list(self._by_endpoint.get(endpoint, []))

class Dispatcher:
    """Simple dispatcher that selects providers by request.provider or by endpoint.

    Behavior:
    - If request contains "provider", try that provider first (if registered).
    - Then append providers registered for the request endpoint.
    - Deduplicate providers while preserving order.
    - Try providers in order until one successfully returns a response with the expected shape.
    - On provider exception or invalid response shape, continue to next provider.
    - If none succeed, raise the last encountered exception.
    """
    def __init__(self, registry):
        self.registry = registry

    def dispatch(self, request):
        provider_name = request.get("provider")
        endpoint = request.get("endpoint")

        candidates = []
        if provider_name:
            p = self.registry.get_by_name(provider_name)
            if p:
                candidates.append(p)

        candidates.extend(self.registry.get_by_endpoint(endpoint))

        # Dedupe by object id to preserve registration/selection order
        seen = set()
        providers = []
        for p in candidates:
            pid = id(p)
            if pid in seen:
                continue
            seen.add(pid)
            providers.append(p)

        if not providers:
            raise ProviderError("no provider available for request")

        last_exc = None
        for p in providers:
            try:
                resp = p.send(request)
                # Validate expected response shape for these tests
                if not isinstance(resp, dict) or "result" not in resp:
                    raise ProviderError("invalid response shape from provider")
                return resp
            except Exception as exc:
                last_exc = exc
                # try next provider
                continue

        # All providers failed
        raise last_exc or ProviderError("all providers failed")

# Tests

def test_select_by_provider_field():
    reg = ProviderRegistry()
    p1 = FakeProvider("p1", endpoints=["/translate"], response={"text": "from_p1"})
    p2 = FakeProvider("p2", endpoints=["/translate"], response={"text": "from_p2"})
    reg.register("p1", p1, ["/translate"])
    reg.register("p2", p2, ["/translate"])

    dispatcher = Dispatcher(reg)
    req = {"provider": "p2", "endpoint": "/translate", "payload": {"q": "hello"}}
    resp = dispatcher.dispatch(req)

    assert resp["provider"] == "p2"
    assert p2.last_request is req
    assert resp["result"]["text"] == "from_p2"

def test_select_by_endpoint_when_no_provider_field():
    reg = ProviderRegistry()
    p1 = FakeProvider("p1", endpoints=["/translate"], response={"text": "from_p1"})
    reg.register("p1", p1, ["/translate"])

    dispatcher = Dispatcher(reg)
    req = {"endpoint": "/translate", "payload": {"q": "hi"}}
    resp = dispatcher.dispatch(req)

    assert resp["provider"] == "p1"
    assert p1.last_request is req

def test_fallback_to_next_provider_on_failure():
    reg = ProviderRegistry()
    p_fail = FakeProvider("fail", endpoints=["/translate"], fail=True)
    p_ok = FakeProvider("ok", endpoints=["/translate"], response={"text": "ok"})
    reg.register("fail", p_fail, ["/translate"])
    reg.register("ok", p_ok, ["/translate"])

    dispatcher = Dispatcher(reg)
    req = {"endpoint": "/translate", "payload": {"q": "bye"}}
    resp = dispatcher.dispatch(req)

    assert resp["provider"] == "ok"
    assert p_ok.last_request is req

def test_invalid_response_shape_triggers_fallback():
    class BadProvider(FakeProvider):
        def send(self, request):
            self.last_request = request
            return "not a dict"

    reg = ProviderRegistry()
    bad = BadProvider("bad", endpoints=["/translate"])
    ok = FakeProvider("ok", endpoints=["/translate"], response={"text": "ok"})
    reg.register("bad", bad, ["/translate"])
    reg.register("ok", ok, ["/translate"])

    dispatcher = Dispatcher(reg)
    req = {"endpoint": "/translate"}
    resp = dispatcher.dispatch(req)

    assert resp["provider"] == "ok"
    assert ok.last_request is req

def test_no_providers_raises():
    reg = ProviderRegistry()
    dispatcher = Dispatcher(reg)
    with pytest.raises(ProviderError):
        dispatcher.dispatch({"endpoint": "/translate"})


def test_failover_on_http_429():
    reg = ProviderRegistry()

    class Fail429(FakeProvider):
        def send(self, request):
            self.last_request = request
            raise HTTPError(429)

    fail = Fail429("fail", endpoints=["/translate"])
    ok = FakeProvider("ok", endpoints=["/translate"], response={"text": "ok"})
    reg.register("fail", fail, ["/translate"])
    reg.register("ok", ok, ["/translate"])

    dispatcher = Dispatcher(reg)
    resp = dispatcher.dispatch({"endpoint": "/translate"})

    assert resp["provider"] == "ok"
    assert ok.last_request is not None


def test_failover_on_http_5xx():
    reg = ProviderRegistry()

    class Fail500(FakeProvider):
        def send(self, request):
            self.last_request = request
            raise HTTPError(500)

    fail = Fail500("fail", endpoints=["/translate"])
    ok = FakeProvider("ok", endpoints=["/translate"], response={"text": "ok"})
    reg.register("fail", fail, ["/translate"])
    reg.register("ok", ok, ["/translate"])

    dispatcher = Dispatcher(reg)
    resp = dispatcher.dispatch({"endpoint": "/translate"})

    assert resp["provider"] == "ok"
    assert ok.last_request is not None
