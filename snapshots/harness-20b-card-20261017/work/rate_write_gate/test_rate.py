from rate import rate


def test_positive():
    assert rate(1) == "ok"


def test_zero():
    assert rate(0) == "bad"


def test_negative():
    assert rate(-1) == "bad"
