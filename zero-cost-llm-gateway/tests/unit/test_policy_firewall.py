"""Runtime half of the Phase 0 exit condition -- the firewall itself.

Every AC-01..AC-05-shaped rejection reason gets its own fixture and its
own assertion on `exc.value.reason`, not just "it raised something", so a
future refactor that silently changes *why* a route is denied breaks a
test instead of passing by accident.
"""

from datetime import datetime, timedelta, timezone

import pytest

from app.policy.firewall import RouteDenied, assert_zero_cost_route, enabled_routes, validate_startup_config
from app.policy.models import (
    ApprovalState,
    GatewayConfigRoot,
    ModelPricing,
    ModelSpec,
    Policy,
    ProviderSpec,
    TermsEvidence,
)

NOW = datetime(2026, 9, 15, tzinfo=timezone.utc)


def make_terms(**overrides) -> TermsEvidence:
    base = dict(
        price_verified_zero=True,
        verified_at=NOW - timedelta(days=1),
        expires_at=NOW + timedelta(days=29),
        official_url="https://provider.example.invalid/pricing",
        evidence_sha256="a" * 64,
    )
    base.update(overrides)
    return TermsEvidence(**base)


def make_model(**overrides) -> ModelSpec:
    pricing_overrides = overrides.pop("pricing", None)
    pricing = pricing_overrides or ModelPricing(
        input_usd_per_million_tokens="0.00",
        output_usd_per_million_tokens="0.00",
    )
    base = dict(
        id="example-free-model",
        context_tokens=131_072,
        max_output_tokens=8192,
        pricing=pricing,
    )
    base.update(overrides)
    return ModelSpec(**base)


def make_provider(**overrides) -> ProviderSpec:
    terms_overrides = overrides.pop("terms", "DEFAULT")
    terms = make_terms() if terms_overrides == "DEFAULT" else terms_overrides
    models = overrides.pop("models", None)
    base = dict(
        id="example_provider_a",
        enabled=True,
        approval_state=ApprovalState.APPROVED_FREE,
        base_url="https://api.example.invalid/openai/v1",
        secret_env="EXAMPLE_PROVIDER_A_API_KEY",
        terms=terms,
        models=models if models is not None else [make_model()],
    )
    base.update(overrides)
    return ProviderSpec(**base)


def test_fully_valid_route_is_accepted() -> None:
    provider = make_provider()
    decision = assert_zero_cost_route(provider, provider.models[0], Policy(), NOW, policy_version=1)
    assert decision.provider_id == "example_provider_a"
    assert decision.model_id == "example-free-model"
    assert decision.terms_evidence_hash == "a" * 64


def test_nonzero_input_price_is_denied() -> None:
    model = make_model(pricing=ModelPricing(input_usd_per_million_tokens="0.10", output_usd_per_million_tokens="0.00"))
    provider = make_provider(models=[model])
    with pytest.raises(RouteDenied) as excinfo:
        assert_zero_cost_route(provider, model, Policy(), NOW)
    assert excinfo.value.reason == "price_not_proven_zero"


def test_nonzero_extra_fee_is_denied() -> None:
    pricing = ModelPricing(
        input_usd_per_million_tokens="0.00",
        output_usd_per_million_tokens="0.00",
        extra_fees={"image_usd_per_unit": "0.002"},
    )
    model = make_model(pricing=pricing)
    provider = make_provider(models=[model])
    with pytest.raises(RouteDenied) as excinfo:
        assert_zero_cost_route(provider, model, Policy(), NOW)
    assert excinfo.value.reason == "price_not_proven_zero"


def test_disabled_provider_is_denied() -> None:
    provider = make_provider(enabled=False)
    with pytest.raises(RouteDenied) as excinfo:
        assert_zero_cost_route(provider, provider.models[0], Policy(), NOW)
    assert excinfo.value.reason == "route_disabled"


def test_disabled_model_is_denied() -> None:
    model = make_model(enabled=False)
    provider = make_provider(models=[model])
    with pytest.raises(RouteDenied) as excinfo:
        assert_zero_cost_route(provider, model, Policy(), NOW)
    assert excinfo.value.reason == "route_disabled"


def test_candidate_provider_is_denied() -> None:
    provider = make_provider(approval_state=ApprovalState.CANDIDATE)
    with pytest.raises(RouteDenied) as excinfo:
        assert_zero_cost_route(provider, provider.models[0], Policy(), NOW)
    assert excinfo.value.reason == "provider_not_approved"


def test_quarantined_provider_is_denied() -> None:
    provider = make_provider(approval_state=ApprovalState.QUARANTINED)
    with pytest.raises(RouteDenied) as excinfo:
        assert_zero_cost_route(provider, provider.models[0], Policy(), NOW)
    assert excinfo.value.reason == "provider_not_approved"


def test_billing_instrument_present_is_denied() -> None:
    provider = make_provider(billing_instrument_present=True)
    with pytest.raises(RouteDenied) as excinfo:
        assert_zero_cost_route(provider, provider.models[0], Policy(), NOW)
    assert excinfo.value.reason == "billing_instrument_present"


def test_paid_credits_present_is_denied() -> None:
    provider = make_provider(paid_credits_present=True)
    with pytest.raises(RouteDenied) as excinfo:
        assert_zero_cost_route(provider, provider.models[0], Policy(), NOW)
    assert excinfo.value.reason == "paid_credits_present"


def test_automatic_topup_enabled_is_denied() -> None:
    provider = make_provider(automatic_topup_enabled=True)
    with pytest.raises(RouteDenied) as excinfo:
        assert_zero_cost_route(provider, provider.models[0], Policy(), NOW)
    assert excinfo.value.reason == "automatic_topup_enabled"


def test_missing_terms_evidence_is_denied() -> None:
    provider = make_provider(terms=None)
    with pytest.raises(RouteDenied) as excinfo:
        assert_zero_cost_route(provider, provider.models[0], Policy(), NOW)
    assert excinfo.value.reason == "terms_evidence_missing"


def test_price_not_verified_zero_is_denied() -> None:
    provider = make_provider(terms=make_terms(price_verified_zero=False))
    with pytest.raises(RouteDenied) as excinfo:
        assert_zero_cost_route(provider, provider.models[0], Policy(), NOW)
    assert excinfo.value.reason == "price_not_verified_zero"


def test_expired_terms_evidence_is_denied() -> None:
    provider = make_provider(terms=make_terms(expires_at=NOW - timedelta(days=1)))
    with pytest.raises(RouteDenied) as excinfo:
        assert_zero_cost_route(provider, provider.models[0], Policy(), NOW)
    assert excinfo.value.reason == "terms_evidence_expired"


def test_terms_expiring_this_instant_is_denied() -> None:
    # expires_at == now is treated as already expired, not "valid until".
    provider = make_provider(terms=make_terms(expires_at=NOW))
    with pytest.raises(RouteDenied) as excinfo:
        assert_zero_cost_route(provider, provider.models[0], Policy(), NOW)
    assert excinfo.value.reason == "terms_evidence_expired"


def test_enabled_routes_skips_disabled_providers_and_models() -> None:
    enabled_model = make_model(id="enabled-model")
    disabled_model = make_model(id="disabled-model", enabled=False)
    enabled_provider = make_provider(id="enabled_provider", models=[enabled_model, disabled_model])
    disabled_provider = make_provider(id="disabled_provider", enabled=False)

    config = GatewayConfigRoot(
        policy=Policy(),
        providers={"enabled_provider": enabled_provider, "disabled_provider": disabled_provider},
    )

    routes = list(enabled_routes(config))
    assert len(routes) == 1
    provider, model = routes[0]
    assert provider.id == "enabled_provider"
    assert model.id == "enabled-model"


def test_validate_startup_config_passes_with_no_enabled_routes() -> None:
    # An empty, fully-disabled registry is trivially zero-cost -- this is
    # the state config/providers.approved.yaml ships in for Phase 0.
    config = GatewayConfigRoot(policy=Policy(), providers={})
    validate_startup_config(config, now=NOW)  # must not raise


def test_validate_startup_config_passes_with_one_valid_enabled_route() -> None:
    provider = make_provider()
    config = GatewayConfigRoot(policy=Policy(), providers={provider.id: provider})
    validate_startup_config(config, now=NOW)  # must not raise


def test_validate_startup_config_raises_on_bad_enabled_route() -> None:
    bad_model = make_model(pricing=ModelPricing(input_usd_per_million_tokens="0.10", output_usd_per_million_tokens="0.00"))
    provider = make_provider(models=[bad_model])
    config = GatewayConfigRoot(policy=Policy(), providers={provider.id: provider})
    with pytest.raises(RouteDenied) as excinfo:
        validate_startup_config(config, now=NOW)
    assert excinfo.value.reason == "price_not_proven_zero"


def test_validate_startup_config_ignores_bad_but_disabled_route() -> None:
    # A rejected/candidate provider can be *recorded* with nonzero pricing
    # (e.g. to document why it was rejected) without blocking startup, as
    # long as it stays disabled.
    bad_model = make_model(pricing=ModelPricing(input_usd_per_million_tokens="9.99", output_usd_per_million_tokens="9.99"))
    provider = make_provider(enabled=False, approval_state=ApprovalState.REJECTED, models=[bad_model], terms=None)
    config = GatewayConfigRoot(policy=Policy(), providers={provider.id: provider})
    validate_startup_config(config, now=NOW)  # must not raise
