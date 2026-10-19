import json
import os

from test.test_core_isolation import PYTHON_ROOT, run_isolated


def test_dump_openapi_writes_the_schema_without_qt_hidapi_or_a_server(tmp_path):
    out = tmp_path / "openapi.json"
    result = run_isolated("import sys, server.dump_openapi\n"
                          "sys.exit(server.dump_openapi.main([{!r}]))".format(str(out)))
    assert result.returncode == 0, result.stderr
    schema = json.loads(out.read_text(encoding="utf-8"))
    assert schema["info"]["title"] == "Vial"
    assert "/api/keyboard" in schema["paths"] and "/api/keyboard-languages" in schema["paths"]
    assert "KeyboardModel" in schema["components"]["schemas"]
    keycodes = schema["paths"]["/api/keycodes"]["get"]["responses"]["200"]["content"]["application/json"]["schema"]
    assert keycodes == {"type": "array", "items": {"$ref": "#/components/schemas/KeycodeCategory"},
                        "title": "Response Keycodes Api Keycodes Get"}
    # test aids of fake mode, not part of the API
    assert "/api/simulator/connection" not in schema["paths"] and "/api/simulator/unlock" not in schema["paths"]
    assert {"/api/unlock/start", "/api/unlock/cancel", "/api/lock"} <= set(schema["paths"])
    assert "/" not in schema["paths"]  # the page, not the API
    # what /api/events sends (WebSockets have no place in OpenAPI's paths)
    event = schema["components"]["schemas"]["Event"]
    assert set(event["properties"]["type"]["enum"]) == {"connected", "disconnected", "reloaded", "unlock"}
    assert "UnlockState" in schema["components"]["schemas"]
    options = schema["paths"]["/api/layout-options"]["put"]["responses"]["200"]["content"]["application/json"]
    assert options["schema"] == {"$ref": "#/components/schemas/LayoutOptionsValue"}
    named = schema["paths"]["/api/names/{kind}/{index}"]["put"]["responses"]["200"]["content"]["application/json"]
    assert named["schema"] == {"$ref": "#/components/schemas/Named"}
    described = schema["components"]["schemas"]["Described"]["properties"]
    assert "legend" in described and "description" in described and "layerAction" in described
    assert "tooltip" not in described and "altGr" not in described
    described = schema["components"]["schemas"]["Described"]["properties"]
    assert set(described["kind"]["enum"]) == {
        "basic", "modifier", "mod-tap", "layer-tap", "layer", "one-shot-mod", "tap-dance", "macro", "transparent",
        "none", "mouse", "media", "lighting", "other"}
    labels = schema["components"]["schemas"]["LayoutOptions"]["properties"]["labels"]
    assert labels["items"] == {"anyOf": [{"type": "string"}, {"type": "array", "items": {"type": "string"}}]}


def test_dump_openapi_is_stable(tmp_path):
    first, second = tmp_path / "a.json", tmp_path / "b.json"
    for out in (first, second):
        result = run_isolated("import sys, server.dump_openapi\n"
                              "sys.exit(server.dump_openapi.main([{!r}]))".format(str(out)))
        assert result.returncode == 0, result.stderr
    assert first.read_bytes() == second.read_bytes()
    assert first.read_bytes().endswith(b"}\n") and b"\r\n" not in first.read_bytes()


def test_dump_openapi_help_and_bad_arguments_write_no_file():
    for argv, code in (("['--help']", 0), ("['-h']", 0), ("[]", 2), ("['--bogus']", 2)):
        result = run_isolated("import sys, server.dump_openapi\n"
                              "sys.exit(server.dump_openapi.main({}))".format(argv))
        assert result.returncode == code, (argv, result.stderr)
        assert "usage:" in (result.stdout if code == 0 else result.stderr)
    for name in ("--help", "-h", "--bogus"):  # an option must never be taken as the output path
        assert not os.path.exists(os.path.join(PYTHON_ROOT, name))
