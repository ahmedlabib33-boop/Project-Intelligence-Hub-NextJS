"""The hard zero-cost firewall -- spec section 6.

`assert_zero_cost_route` is the per-route gate from section 6.2: it is
meant to run again immediately before every outbound provider call in
later phases, never trusting a decision made earlier in the same request.
`validate_startup_config` is section 6.1: refuse to start the whole
gateway if any *enabled* route would fail that same gate right now.

Both raise `RouteDenied` rather than returning a bool, so a caller cannot
accidentally ignore a `False` and proceed anyway.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from typing import Iterator, Optional, Tuple

from .models import ApprovalState, GatewayConfigRoot, ModelSpec, Policy, ProviderSpec


class RouteDenied(Exception):
    """Raised for any reason a route may not be used -- never a bare bool."""

    def __init__(self, reason: str, *, provider_id: str = "", model_id: str = ""):
        self.reason = reason
        self.provider_id = provider_id
        self.model_id = model_id
        label = f"{provider_id}/{model_id}: " if provider_id else ""
        super().__init__(f"{label}{reason}")


@dataclass(frozen=True)
class ZeroCostDecision:
    """Proof a route passed the firewall, to be carried alongside the attempt.

    Phase 1+ persists this (or its hash) with every outbound attempt so an
    audit trail can show *why* a route was believed to be zero-cost at the
    moment it was used, per spec section 6.2 and the `attempts` table in
    section 13.
    """

    provider_id: str
    model_id: str
    policy_version: int
    terms_evidence_hash: str


def _all_prices(model: ModelSpec) -> Iterator[Optional[Decimal]]:
    yield model.pricing.input_usd_per_million_tokens
    yield model.pricing.output_usd_per_million_tokens
    yield from model.pricing.extra_fees.values()


def _assert_policy_itself_is_zero_cost(policy: Policy) -> None:
    # Defense in depth: Policy's own field types already make most of this
    # unrepresentable (Literal[False], a validator pinning cost to 0), but
    # the firewall re-checks explicitly rather than trusting "it parsed, so
    # it must be fine" -- config classes can change; this function is the
    # one place every route's fate actually runs through.
    if policy.maximum_cost_per_request != Decimal("0"):
        raise RouteDenied("policy_maximum_cost_per_request_not_zero")
    if policy.maximum_cost_per_day != Decimal("0"):
        raise RouteDenied("policy_maximum_cost_per_day_not_zero")
    if policy.maximum_cost_lifetime != Decimal("0"):
        raise RouteDenied("policy_maximum_cost_lifetime_not_zero")
    if policy.allow_credit_card:
        raise RouteDenied("policy_allows_credit_card")
    if policy.allow_paid_credits:
        raise RouteDenied("policy_allows_paid_credits")
    if policy.allow_automatic_topup:
        raise RouteDenied("policy_allows_automatic_topup")
    if policy.allow_paid_fallback:
        raise RouteDenied("policy_allows_paid_fallback")
    if not policy.fail_closed:
        raise RouteDenied("policy_fail_closed_disabled")


def assert_zero_cost_route(
    provider: ProviderSpec,
    model: ModelSpec,
    policy: Policy,
    now: datetime,
    *,
    policy_version: int = 1,
) -> ZeroCostDecision:
    _assert_policy_itself_is_zero_cost(policy)

    if not provider.enabled or not model.enabled:
        raise RouteDenied("route_disabled", provider_id=provider.id, model_id=model.id)
    if provider.approval_state != ApprovalState.APPROVED_FREE:
        raise RouteDenied("provider_not_approved", provider_id=provider.id, model_id=model.id)
    if provider.billing_instrument_present:
        raise RouteDenied("billing_instrument_present", provider_id=provider.id, model_id=model.id)
    if provider.paid_credits_present:
        raise RouteDenied("paid_credits_present", provider_id=provider.id, model_id=model.id)
    if provider.automatic_topup_enabled:
        raise RouteDenied("automatic_topup_enabled", provider_id=provider.id, model_id=model.id)

    if provider.terms is None:
        raise RouteDenied("terms_evidence_missing", provider_id=provider.id, model_id=model.id)
    if not provider.terms.price_verified_zero:
        raise RouteDenied("price_not_verified_zero", provider_id=provider.id, model_id=model.id)
    expires_at = provider.terms.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= now:
        raise RouteDenied("terms_evidence_expired", provider_id=provider.id, model_id=model.id)

    for price in _all_prices(model):
        if price is None or price != Decimal("0"):
            raise RouteDenied("price_not_proven_zero", provider_id=provider.id, model_id=model.id)

    return ZeroCostDecision(
        provider_id=provider.id,
        model_id=model.id,
        policy_version=policy_version,
        terms_evidence_hash=provider.terms.evidence_sha256,
    )


def enabled_routes(config: GatewayConfigRoot) -> Iterator[Tuple[ProviderSpec, ModelSpec]]:
    """Every (provider, model) pair currently marked enabled on both sides.

    A disabled provider or a disabled model within an enabled provider is
    excluded here rather than denied by the firewall -- it was never a
    route a request could reach in the first place.
    """
    for provider in config.providers.values():
        if not provider.enabled:
            continue
        for model in provider.models:
            if not model.enabled:
                continue
            yield provider, model


def validate_startup_config(config: GatewayConfigRoot, now: Optional[datetime] = None) -> None:
    """Spec section 6.1: refuse to start if any enabled route is unsafe.

    Raises `RouteDenied` on the first violation. A registry with zero
    enabled routes always passes -- an empty, fully-disabled registry is
    trivially zero-cost; Phase 2 is what actually approves providers into
    it. This function's only job is making sure nothing slips through once
    something *is* enabled.
    """
    now = now or datetime.now(timezone.utc)
    for provider, model in enabled_routes(config):
        assert_zero_cost_route(provider, model, config.policy, now, policy_version=config.version)
