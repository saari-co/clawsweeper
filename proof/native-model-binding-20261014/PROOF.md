# Native Codex model binding

Claim: an explicitly opted-in native subscription invocation places its selected model in the actual Codex argv, while default upstream behavior and sandbox/reasoning argument composition remain intact.
Scenario: run the built `codexAgentArgs` and `codexEnv` with public fixture model `gpt-6.1-sol`, binding disabled then enabled, read-only sandbox/high reasoning.
Environment: Node 24.18.0, upstream pnpm 12.4.1 and tsc build; command and observed argv are in argv-proof.json. No auth/config files, GitHub writes or model requests are needed for this core source behavior.
Observable result: baseline omits --model; opt-in adds --model gpt-6.1-sol; read-only/high remain; child env strips the control flag. Tests exercise missing/matching/different selectors and existing repair default behavior.
Limits: this proves built argv selection, not native model execution, publication or installed activation. Dedicated runtime qualification and exact-source native reruns remain gated.

Upstream consulted: openclaw/clawsweeper main c0f27ee282e13721d5399aeae82ae0f909e092cd. It retains configuration-owned internal model selection. This patch preserves it by default and changes only an explicit opt-in. No upstream resync is included. Fork integration base 18b75578b03f506194998c6a8d0941fba39aa873 preserves its existing compatibility ancestry.
Build convention: packageManager pnpm@12.4.1, engines node>=24, build tsc -p tsconfig.json, unchanged. OpenClaw Bay is unaffected: no lifecycle/publication/queue/status/schema/browser change.

Precommit independent AutoReview: GPT-6.1 Sol P3 clean on code/test diff, no model fallback. Focused tests 24 passed. Full required check recorded at closeout.
