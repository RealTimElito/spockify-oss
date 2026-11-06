from greet import greet


def test_greet():
    # RED until cascade replaces hi → hello (file has trailing spaces on return).
    assert greet("x") == "hello x"
