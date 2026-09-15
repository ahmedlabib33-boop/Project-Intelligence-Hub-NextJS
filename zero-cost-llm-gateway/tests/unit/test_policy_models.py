"""Schema-level half of the Phase 0 exit condition:

'A policy fixture with any price above zero, unknown pricing, card, paid
credit, top-up, expired evidence, or paid fallback is rejected.'

These tests prove several of those are rejected at *parse* time, before
any request or startup-validation logic ever runs -- the non-negotiable
fields in `Policy` are typed so the wrong value cannot be represented.
"""

from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.policy.models import GatewayConfigRoot, ModelPricing, ModelSpec, Policy, ProviderSpec


def test_valid_policy_constructs_cleanly() -> None:
    policy = Policy()
    assert policy.allow_credit_card is False
    assert policy.maximum_cost_per_request == Decimal("0")
    assert policy.fail_closed is True


@pytest.mark.parametrize(
    "field",
    [
        "allow_credit_card",
        "allow_paid_credits",
        "allow_automatic_topup",
        "allow_paid_fallback",
        "allow_unknown_pricing",
        "allow_expired_terms_evidence",
        "registry_refresh_can_auto_enable",
    ],
)
def test_policy_rejects_flipping_any_guardrail_true(field: str) -> None:
    with pytest.raises(ValidationError):
        Policy(**{field: True})


def test_policy_rejects_fail_closed_false() -> None:
    with pytest.raises(ValidationError):
        Policy(fail_closed=False)


@pytest.mark.parametrize(
    "field",
    ["maximum_cost_per_request", "maximum_cost_per_day", "maximum_cost_lifetime"],
)
def test_policy_rejects_nonzero_cost_fields(field: str) -> None:
    with pytest.raises(ValidationError):
        Policy(**{field: Decimal("0.01")})


def test_policy_rejects_negative_cost_field_too() -> None:
    # A negative "cost" is not a loophole either -- only exactly zero passes.
    with pytest.raises(ValidationError):
        Policy(maximum_cost_per_request=Decimal("-0.01"))


def _valid_pricing() -> dict:
    return {
        "input_usd_per_million_tokens": "0.00",
        "output_usd_per_million_tokens": "0.00",
    }


def test_model_pricing_accepts_fully_zero_pricing() -> None:
    pricing = ModelPricing(**_valid_pricing())
    assert pricing.input_usd_per_million_tokens == Decimal("0")


def test_model_pricing_requires_input_price_field() -> None:
    # Omitted price is "unknown", and spec rule 6 says unknown means denied
    # -- enforced here structurally: the config cannot even load.
    with pytest.raises(ValidationError):
        ModelPricing(output_usd_per_million_tokens="0.00")


def test_model_pricing_requires_output_price_field() -> None:
    with pytest.raises(ValidationError):
        ModelPricing(input_usd_per_million_tokens="0.00")


def test_model_pricing_does_not_itself_reject_nonzero_value() -> None:
    # Deliberately NOT rejected here: a REJECTED/QUARANTINED registry entry
    # may legitimately record a real, nonzero price as the reason it was
    # rejected (spec section 4.2's rejection_reason). The firewall
    # (assert_zero_cost_route) is what refuses to *route* to a nonzero
    # price -- it only inspects ENABLED, APPROVED_FREE routes.
    pricing = ModelPricing(input_usd_per_million_tokens="0.50", output_usd_per_million_tokens="1.50")
    assert pricing.input_usd_per_million_tokens == Decimal("0.50")


def _valid_model(model_id: str = "example-free-model") -> ModelSpec:
    return ModelSpec(
        id=model_id,
        context_tokens=131_072,
        max_output_tokens=8192,
        pricing=ModelPricing(**_valid_pricing()),
    )


def _valid_provider(provider_id: str = "example_provider_a", **overrides) -> ProviderSpec:
    base = {
        "id": provider_id,
        "enabled": True,
        "approval_state": "APPROVED_FREE",
        "base_url": "https://api.example.invalid/openai/v1",
        "secret_env": "EXAMPLE_PROVIDER_A_API_KEY",
        "terms": {
            "price_verified_zero": True,
            "verified_at": "2026-09-15T00:00:00Z",
            "expires_at": "2026-10-15T00:00:00Z",
            "official_url": "https://provider.example.invalid/pricing",
            "evidence_sha256": "a" * 64,
        },
        "models": [_valid_model()],
    }
    base.update(overrides)
    return ProviderSpec(**base)


def test_valid_provider_constructs_cleanly() -> None:
    provider = _valid_provider()
    assert provider.approval_state.value == "APPROVED_FREE"


def test_provider_base_url_must_be_https() -> None:
    with pytest.raises(ValidationError):
        _valid_provider(base_url="http://api.example.invalid/openai/v1")


def test_terms_official_url_must_be_https() -> None:
    with pytest.raises(ValidationError):
        ProviderSpec(
            id="p",
            terms={
                "price_verified_zero": True,
                "verified_at": "2026-09-15T00:00:00Z",
                "expires_at": "2026-10-15T00:00:00Z",
                "official_url": "http://not-https.example.invalid",
                "evidence_sha256": "a" * 64,
            },
        )


def test_terms_evidence_hash_must_look_like_sha256() -> None:
    with pytest.raises(ValidationError):
        ProviderSpec(
            id="p",
            terms={
                "price_verified_zero": True,
                "verified_at": "2026-09-15T00:00:00Z",
                "expires_at": "2026-10-15T00:00:00Z",
                "official_url": "https://provider.example.invalid/pricing",
                "evidence_sha256": "not-a-hash",
            },
        )


def test_gateway_config_root_requires_provider_id_to_match_its_key() -> None:
    with pytest.raises(ValidationError):
        GatewayConfigRoot(
            policy=Policy(),
            providers={"groq": _valid_provider(provider_id="not_groq")},
        )


def test_gateway_config_root_rejects_unknown_top_level_fields() -> None:
    with pytest.raises(ValidationError):
        GatewayConfigRoot(policy=Policy(), some_unrelated_field=True)
