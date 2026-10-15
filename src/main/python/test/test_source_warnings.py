import pathlib
import warnings

SRC = pathlib.Path(__file__).resolve().parent.parent


def test_sources_compile_without_syntax_warnings():
    """ Invalid escape sequences are a SyntaxWarning on 3.12+ and will become errors """
    problems = []
    for path in sorted(SRC.rglob("*.py")):
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            compile(path.read_text(encoding="utf-8"), str(path), "exec")
        problems += ["{}:{}: {}".format(path.relative_to(SRC), w.lineno, w.message) for w in caught]
    assert problems == []
