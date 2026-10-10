# Golden fixtures — Phase 0 (Wichy harness plan)

These describe expected event shapes for Ask / Agent / YOLO / tool-fence turns.
Used as documentation + future snapshot tests. Events must match `HarnessEvent` in `src/types.ts`.

## ask-turn.jsonl

```
{"type":"status","text":"model turn 1"}
{"type":"model","requested":"gpt-oss-20b"}
{"type":"text","content":"Here is what I found."}
{"type":"toolStart","id":"call_1","name":"grep","arguments":{"pattern":"TODO"}}
{"type":"toolResult","id":"call_1","name":"grep","ok":true,"content":"src/a.ts:1:// TODO"}
{"type":"done"}
```

Ask/plan mode must never emit `toolStart` for `write_file`, `apply_patch`, or `shell`.

## agent-two-tools.jsonl

```
{"type":"status","text":"model turn 1"}
{"type":"model","requested":"gpt-oss-20b"}
{"type":"toolStart","id":"call_1","name":"read_file","arguments":{"path":"a.ts"}}
{"type":"toolResult","id":"call_1","name":"read_file","ok":true,"content":"…"}
{"type":"toolStart","id":"call_2","name":"apply_patch","arguments":{"path":"a.ts","search":"x","replace":"y"}}
{"type":"toolResult","id":"call_2","name":"apply_patch","ok":true,"content":"apply_patch ok"}
{"type":"done"}
```

Order of toolResults must match toolStart order (parallel Phase 1 preserves LLM order).

## yolo-shell.jsonl

```
{"type":"status","text":"model turn 1"}
{"type":"toolStart","id":"call_1","name":"shell","arguments":{"command":"pytest -q"}}
{"type":"toolResult","id":"call_1","name":"shell","ok":true,"content":"exit 0"}
{"type":"done"}
```

YOLO skips confirm; policy still applies writeRequiresRead.

## tool-fence.jsonl

Model emits no native tool_calls; harness parses:

````
```tool
{"name":"run_tests","arguments":{}}
```
````

Then emits toolStart/toolResult as usual. If only a ```bash fence appears, one repair user turn is injected.
