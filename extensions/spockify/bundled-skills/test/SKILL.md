---
title: Write and run tests
category: engineering
tags: [test, tdd]
---
# Write and run tests

1. Identify the behavior to lock in (happy path + one or two important edge cases).
2. Match the project's existing test style and runner. Look for `package.json` scripts, `pytest.ini`, `go.mod`, etc.
3. Write the failing test first when practical.
4. Implement the minimum code to make it pass.
5. Run the specific test (not the whole suite unless asked).
6. Report the command you ran and the result.

Prefer focused unit tests. Add an integration test only when the behavior crosses a real boundary.
