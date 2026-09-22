# Oracle model and reasoning compatibility

This binding was checked against the installed `@steipete/oracle` **0.20.3**
package on 2026-09-14. It is source-level compatibility evidence. No live
browser/API consult or account-access claim follows from it.

## Separate the surfaces

- **Browser:** `--model gpt-6-pro --browser-model-strategy select
  --browser-thinking-time pro`. The browser alias maps to the `Latest` model
  radio, with Pro selected separately. The native model selector
  `gpt-6-astra` and native `max` effort are not the browser receipt's identity.
- **API:** `--engine api --model gpt-6-astra --reasoning-effort max
  --reasoning-mode standard` or an intentionally selected `pro` mode. In
  0.20.3, this API adapter supports `low`, `medium`, `high`, `xhigh`, and `max`;
  `none` and `ultra` are unsupported. `gpt-6-pro` is not an API model slug.
  Pro reasoning mode requires the OpenAI/Azure Responses API path; custom
  endpoints and OpenRouter are not interchangeable adapters.
- Generic older browser Pro aliases such as `gpt-5-pro` still normalize to
  Sol in this version. Use the explicit current browser alias above.

## Source evidence in the Oracle package

The maintained upstream is [steipete/oracle](https://github.com/steipete/oracle).
Inspect the installed package's version and these compiled modules before
changing this binding; do not infer support from a model name or release date:

| Module beneath the package's `dist/src/` | Checked behavior |
| --- | --- |
| `cli/browserConfig.js` | Preserves `gpt-6-pro`, maps it and `gpt-6-astra` to `Latest`, and defaults the browser Pro alias to `pro` thinking |
| `browser/actions/modelSelection.js` | Requires a verified selection from `chatgpt-model-picker`; exact accepted Latest labels are `Latest`, `最新`, and `최신` |
| `browser/actions/thinkingTime.js` | Explicit Pro fails when unavailable/unverified; the Astra slider verifies its label and numeric position; the usual returned tier label is `Pro` |
| `cli/sessionRunner.js` | Normal completion persists `browser.modelSelection` and `browser.thinkingSelection`; detached runtime hints may persist only the former |
| `oracle/run.js` and `cli/options.js` | Validate the Astra API slug, supported effort values, and reasoning-mode adapter restriction |

The version-prefixed composer pill can read `6 Pro` or `6Pro`. The Oracle
model-selection adapter normalizes its Latest model evidence separately;
neither a pill label nor a model's answer is backend identity attestation.

## Routed acceptance and migration

Railyard's `oracle-browser` carrier **v2** requires Oracle 0.20.3 or newer and
uses only the explicit browser pair. Each result must have:

1. Session configuration requesting `Latest`, `select`, and `pro`, with
   verified successful model-selection metadata for an exact supported label.
2. Exactly one Pro thinking-control record in the same session's log before
   `Answer:`. `Pro`, `6 Pro`, and `6Pro` are the narrow accepted tier labels.
3. When `thinkingSelection` is present, successful verified metadata for
   requested level `pro`, strict failure behavior, and source
   `chatgpt-thinking-picker`. Missing metadata can use the control-log proof
   for detached recovery; conflicting metadata fails even with a Pro log.

This proves observed browser controls. `Latest` is a changing product label;
it is not an immutable backend model ID. The receipt's `gpt-6-pro` value
identifies the Oracle browser control used, not native Astra effort or an API
response model.

The carrier revision invalidates old capability evidence. A prepared Sol
bundle cannot be rewritten into a new review under its old digest. A detached
Sol session cannot be reattached through v2 and relabeled as Astra. Preserve
the old session for manual inspection; a newly selected routed consult needs
a fresh bundle and claim. Routed Oracle API remains unsupported.
