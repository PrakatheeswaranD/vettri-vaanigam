# AI Evaluations

Exactly two formal AI evaluation suites exist, per
[`PART_00_MASTER_ENGINEERING_CONTRACT.md`](../PART_00_MASTER_ENGINEERING_CONTRACT.md)
§27: Intent Extraction and Recommendation Quality. No third suite exists —
adversarial/security scenarios (hallucination rejection, prompt-injection
resistance, policy-bypass immunity) are instead proven by dedicated
integration tests (`buyer-agent.test.ts`, `merchant-agent.test.ts`,
`recovery.test.ts`), not duplicated into either eval dataset.

## Running them

```bash
pnpm eval:intent
pnpm eval:recommendation
```

Both scripts run against whichever `AIProvider` is currently configured
(`DEMO_RULE_BASED` by default; `LIVE_ANTHROPIC` if `AI_PROVIDER_API_KEY`
is set) and print an honest `LIVE MODEL EVALUATION NOT EXECUTED` line
whenever no live key is configured — never a fabricated live result.

## Evaluation A — Buyer Intent Extraction

- **Dataset**: `evals/` fixtures, version **1.0**, **28** held-out cases.
- **Metrics**: category accuracy, budget accuracy, attribute accuracy,
  clarification-decision accuracy, overall exact semantic match.
- **Runner**: `apps/api/scripts/eval-intent.ts`.
- **Latest measured result** (this session, `DEMO_RULE_BASED` /
  `CONTRACT` mode — the deterministic rule-based extractor, not a live
  model):

  | Metric | Result |
  |---|---|
  | Category accuracy | 100.0% (24/24) |
  | Budget accuracy | 100.0% (11/11) |
  | Attribute accuracy | 100.0% (10/10) |
  | Clarification decision accuracy | 100.0% (3/3) |
  | Overall exact semantic match | 100.0% (28/28) |

  `LIVE MODEL EVALUATION NOT EXECUTED` — no `AI_PROVIDER_API_KEY` is
  configured in this environment. This is a **CONTRACT** eval: it proves
  the deterministic extractor and the schema pipeline behave correctly,
  not that a live LLM would score this well. It has not been run against
  `LIVE_ANTHROPIC` in this environment.

## Evaluation B — Recommendation Quality

- **Dataset**: `evals/` fixtures, version **1.0**, **8** scenario cases +
  **1** adversarial hallucination case.
- **Metrics**: hard-constraint violation rate (post-validation), unknown-
  product hallucination rate (post-validation), near-match disclosure
  accuracy, adversarial-case grounding catch.
- **Runner**: `apps/api/scripts/eval-recommendation.ts`.
- **Latest measured result** (this session, `DEMO_RULE_BASED` /
  `CONTRACT` mode):

  | Metric | Result | Target |
  |---|---|---|
  | Hard constraint violation rate | 0.0% (0/19) | 0% |
  | Unknown product hallucination rate | 0.0% (0/19) | 0% |
  | Near-match disclosure accuracy | 100.0% (1/1) | — |
  | Adversarial hallucination caught by grounding validator | YES | YES |

  `LIVE MODEL EVALUATION NOT EXECUTED` — same reason as above. The
  adversarial case (a fixture provider returning a fabricated product ID)
  is caught by the same `recommendation-grounding.ts` validator the real
  application path uses, not a special eval-only check.

## What "CONTRACT" mode actually proves

Every case above ran through the real HTTP/service pipeline — schema
validation, deterministic catalog filtering, grounding — with only the
final "what would an LLM rank/extract" step substituted for a
deterministic rule-based stand-in. It proves the surrounding safety
machinery works correctly regardless of what the model outputs; it does
not measure a live model's actual language-understanding quality. If
`AI_PROVIDER_API_KEY` is set, rerunning both commands exercises the real
`AnthropicProvider` end to end with no code change — the eval scripts,
the grounding validators, and the fallback paths are all the exact same
ones used in production request handling.

## System safety vs. model quality

An important distinction this project is built around: raw model output
may occasionally be invalid, incomplete, or wrong — no LLM integration
can promise otherwise. What these evaluations and the surrounding
integration tests actually demonstrate is that **system-level
validation prevents an invalid model output from ever becoming commerce
truth**: an ungrounded product ID is rejected before it reaches a
recommendation; an out-of-bounds discount is rejected before it reaches a
proposal; a hallucinated recovery action falls back to a deterministic,
provably-safe answer before it reaches an authorization. The evaluation
suites measure the model; the integration/adversarial test suites measure
whether the model's mistakes can reach money — and per
`PROGRESS.md`, they cannot.

## No fabricated numbers

Every percentage above is copied verbatim from this session's actual
command output, not estimated or rounded for effect. No conversion rate,
revenue uplift, or customer-facing accuracy claim beyond what is
literally printed by `pnpm eval:intent` / `pnpm eval:recommendation`
appears anywhere in this project's documentation.
