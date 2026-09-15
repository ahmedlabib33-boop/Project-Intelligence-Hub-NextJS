# Zero-Cost LLM Gateway

A local, OpenAI-compatible gateway that routes only to LLM providers proven,
per-route, to cost exactly USD 0.00 — never a credit card, never purchased
credits, never automatic top-up, never a paid fallback. Full design: see
[`docs/spec.md`](docs/spec.md).

## Status: Phase 0 (Policy and threat model)

Implemented:

- `app/policy/models.py` — the versioned config schema. Every field spec
  section 1 calls non-negotiable (`allow_credit_card`, `allow_paid_credits`,
  `allow_automatic_topup`, `allow_paid_fallback`, `allow_unknown_pricing`,
  `allow_expired_terms_evidence`, `fail_closed`, and the three cost ceilings)
  is typed so the wrong value fails to parse, not just fails a runtime check.
- `app/policy/firewall.py` — `assert_zero_cost_route` (spec 6.2, the
  per-route gate meant to run again before every outbound call in later
  phases) and `validate_startup_config` (spec 6.1: refuse to start if any
  *enabled* route would fail that gate).
- `app/policy/loader.py` — loads `config/policy.yaml` +
  `config/providers.approved.yaml` into a validated `GatewayConfigRoot`.
- `config/providers.approved.yaml` ships empty on purpose — no provider is
  routable until Phase 2's registry/approval workflow adds one.

Not implemented yet (later phases, see `docs/spec.md` section 19):
FastAPI surface, provider adapters, SQLite audit trail, quota state
machine, semantic cache, task-aware routing, Primavera evidence-package
integration.

## Running the tests

```bash
pip install -r requirements-dev.txt
pytest
```

Exit condition for this phase (spec section 19): a policy fixture with any
price above zero, unknown pricing, card, paid credit, top-up, expired
evidence, or paid fallback is rejected — see `tests/unit/test_policy_models.py`
and `tests/unit/test_policy_firewall.py`.
