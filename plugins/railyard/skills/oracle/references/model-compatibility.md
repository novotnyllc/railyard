# Oracle model compatibility

Checked on 2026-09-26 against the installed Oracle 0.21.3 (`oracle --help`,
`oracle --help --verbose`, and `dist/src/cli/browserConfig.js`). The skill's
minimum is 0.20.3. These notes describe the CLI; they are not evidence that a
given account can use a given model.

| Surface | Flags | Notes |
| --- | --- | --- |
| ChatGPT browser (default for this skill) | `--engine browser --model gpt-6-pro --browser-model-strategy select --browser-thinking-time pro` | `gpt-6-pro` is a browser-only alias. It selects the `Latest` picker entry, and Pro is a separate thinking-time control. `--browser-thinking-time` is hidden from `--help` but still accepted. |
| OpenAI API (paid, only when authorized) | `--engine api --model gpt-6.1-sol --reasoning-effort <low…max>` | Preferred API model per routing. OpenAI supports `low` through `max`, default `medium`; no `none`, `minimal`, or single-agent API `ultra`. Recheck installed Oracle support before a paid run; the September 26 CLI check predates Sol 6.1. `gpt-6-pro` is not an API model slug. |

Generic Pro aliases follow whatever Oracle's current default target is, which
can be an older model. Keep the explicit `gpt-6-pro` pair.

`Latest` is ChatGPT's changing product label, not a fixed backend model ID.
Neither the composer label nor the model's own answer proves which model
served the request. If a run matters, look at the session record
(`oracle session <slug>`) to see which picker and thinking controls Oracle
reports it selected.

OpenAI model/effort guidance checked 2026-09-29 against the
[Sol 6.1 model](https://developers.openai.com/api/docs/models/gpt-6.1-sol).
A rejected selector is a blocker, not permission to fall back to Astra.

Before relying on a newer Oracle release, recheck `oracle --help` and the
`browserConfig.js` alias table.
