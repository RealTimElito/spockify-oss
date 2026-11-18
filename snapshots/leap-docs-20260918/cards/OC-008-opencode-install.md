# OC-008/010 OpenCode smoke — 2026-09-18T22:45:52+02:00

## Binary
- path: /workspace/.opencode/bin/opencode
1.18.31

## Help (top)
⠀                                ▄     
█▀▀█ █▀▀█ █▀▀█ █▀▀▄ █▀▀▀ █▀▀█ █▀▀█ █▀▀█
█  █ █  █ █▀▀▀ █  █ █    █  █ █  █ █▀▀▀
▀▀▀▀ █▀▀▀ ▀▀▀▀ ▀  ▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀

Commands:
  opencode completion          generate shell completion script
  opencode acp                 start ACP (Agent Client Protocol) server
  opencode mcp                 manage MCP (Model Context Protocol) servers
  opencode [project]           start opencode tui                                          [default]
  opencode attach <url>        attach to a running opencode server
  opencode run [message..]     run opencode with a message
  opencode debug               debugging and troubleshooting tools
  opencode providers           manage AI providers and credentials                   [aliases: auth]
  opencode agent               manage agents
  opencode upgrade [target]    upgrade opencode to the latest or a specific version
  opencode uninstall           uninstall opencode and remove all related files
  opencode serve               starts a headless opencode server
  opencode web                 start opencode server and open web interface
  opencode models [provider]   list all available models
  opencode stats               show token usage and cost statistics
  opencode export [sessionID]  export session data as JSON
  opencode import <file>       import session data from JSON file or URL
  opencode github              manage GitHub agent
  opencode pr <number>         fetch and checkout a GitHub PR branch, then run opencode
  opencode session             manage sessions
  opencode plugin <module>     install plugin and update config                      [aliases: plug]
  opencode db                  database tools

Positionals:
  project  path to start opencode in                                                        [string]

Options:
  -h, --help          show help                                                            [boolean]
  -v, --version       show version number                                                  [boolean]
      --print-logs    print logs to stderr                                                 [boolean]
      --log-level     log level                 [string] [choices: "DEBUG", "INFO", "WARN", "ERROR"]
      --pure          run without external plugins                                         [boolean]
      --port          port to listen on                                        [number] [default: 0]
      --hostname      hostname to listen on                          [string] [default: "127.0.0.1"]

## Providers / models probe (no long SWE)
opencode/big-pickle
opencode/ling-3.0-flash-fin-free
opencode/mimo-v2.5-free
opencode/muse-spark-1.2-contributor-free
opencode/muse-spark-1.3-contributor-free
opencode/nemotron-3-ultra-free
opencode/nemotron-3.5-lightning-free

## Local tag hosting
Checking whether OpenCode can use OpenAI-compat base URL for gpt-oss-20b / gpt-oss:120b…
  opencode mcp                 manage MCP (Model Context Protocol) servers
  opencode providers           manage AI providers and credentials                   [aliases: auth]
  opencode models [provider]   list all available models
  opencode db                  database tools
  -m, --model         model to use in the format of provider/model                          [string]

## providers list
opencode providers

manage AI providers and credentials

Commands:
  opencode providers list               list providers and credentials                 [aliases: ls]
  opencode providers login [url]        log in to a provider
  opencode providers logout [provider]  log out from a configured provider

Options:
  -h, --help        show help                                                              [boolean]
  -v, --version     show version number                                                    [boolean]
      --print-logs  print logs to stderr                                                   [boolean]
      --log-level   log level                   [string] [choices: "DEBUG", "INFO", "WARN", "ERROR"]
      --pure        run without external plugins                                           [boolean]
## models containing gpt/oss/ollama/openai

## OC-010 verdict
OpenCode 1.18.31 installed on Spock (amd64 SWE host).
Default `opencode models` lists hosted free/Zen-style tags, not gpt-oss:120b / gpt-oss-20b.
Row C for same local tag: **not run — provider** (OpenCode does not advertise local gpt-oss tags out of the box).
Optional path: configure OpenAI-compatible provider pointing at Spark LiteLLM — deferred while Lite board holds :24001; do not contend.

## Smoke instance
Full SWE instance under OpenCode deferred (would contend with lite-full-20260917 for LiteLLM/Docker).
Binary smoke: `opencode --version` → 1.18.31 PASS.
