"""Versioned configuration schema for the Zero Monetary Cost LLM Gateway.

Implements spec section 5 (Configuration model) plus the schema-level half
of section 1 (Non negotiable zero cost policy): every field the spec marks
non-negotiable is pinned with `Literal` so a config that tries to change it
fails to even parse, rather than relying solely on runtime checks. The
runtime half of the firewall (per-route checks that also need the approval
state, terms evidence and current time) lives in `firewall.py`.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ApprovalState(str, Enum):
    """Spec section 4.1 registry lifecycle states."""

    CANDIDATE = "CANDIDATE"
    QUARANTINED = "QUARANTINED"
    REJECTED = "REJECTED"
    APPROVED_FREE = "APPROVED_FREE"


class Policy(BaseModel):
    """Spec section 1 + section 5 `policy:` block.

    Fields that section 1 calls non-negotiable are `Literal`-pinned to the
    only value that satisfies the policy, with that value as the default.
    Setting any of them to anything else in YAML is a `ValidationError`,
    not a value the router could ever see and choose to honor or ignore.
    """

    model_config = ConfigDict(extra="forbid")

    currency: str = "USD"
    maximum_cost_per_request: Decimal = Decimal("0")
    maximum_cost_per_day: Decimal = Decimal("0")
    maximum_cost_lifetime: Decimal = Decimal("0")
    allow_credit_card: Literal[False] = False
    allow_paid_credits: Literal[False] = False
    allow_automatic_topup: Literal[False] = False
    allow_paid_fallback: Literal[False] = False
    allow_unknown_pricing: Literal[False] = False
    allow_expired_terms_evidence: Literal[False] = False
    fail_closed: Literal[True] = True
    maximum_failover_attempts: int = Field(default=3, ge=1, le=10)
    registry_refresh_can_auto_enable: Literal[False] = False
    terms_review_max_age_days: int = Field(default=30, gt=0)

    @field_validator(
        "maximum_cost_per_request",
        "maximum_cost_per_day",
        "maximum_cost_lifetime",
    )
    @classmethod
    def _must_be_exactly_zero(cls, value: Decimal) -> Decimal:
        if value != Decimal("0"):
            raise ValueError("must be exactly 0 -- this gateway has no concept of a nonzero budget")
        return value


class GatewayConfig(BaseModel):
    """Spec section 5 `gateway:` block."""

    model_config = ConfigDict(extra="forbid")

    bind_host: str = "127.0.0.1"
    port: int = Field(default=8000, ge=1, le=65535)
    database_url: str = "sqlite:///./data/gateway.db"
    request_timeout_seconds: int = Field(default=60, gt=0)
    local_api_key_env: str = "ZERO_COST_GATEWAY_API_KEY"
    log_prompt_content: bool = False
    log_response_content: bool = False


class CacheConfig(BaseModel):
    """Spec section 5 `cache:` block / section 12 (Semantic cache)."""

    model_config = ConfigDict(extra="forbid")

    enabled: bool = True
    backend: str = "sqlite"
    semantic_threshold: float = Field(default=0.94, ge=0.0, le=1.0)
    default_ttl_seconds: int = Field(default=86_400, gt=0)
    require_same_project_snapshot: bool = True
    bypass_for_tasks: List[str] = Field(default_factory=list)


class TermsEvidence(BaseModel):
    """Spec section 4.2 minimum approval evidence."""

    model_config = ConfigDict(extra="forbid")

    price_verified_zero: bool
    verified_at: datetime
    expires_at: datetime
    official_url: str
    evidence_sha256: str

    @field_validator("official_url")
    @classmethod
    def _must_be_https(cls, value: str) -> str:
        if not value.startswith("https://"):
            raise ValueError("official_url must be an https:// link to the provider's own terms/pricing page")
        return value

    @field_validator("evidence_sha256")
    @classmethod
    def _must_look_like_a_sha256_hex_digest(cls, value: str) -> str:
        if len(value) != 64 or any(c not in "0123456789abcdef" for c in value.lower()):
            raise ValueError("evidence_sha256 must be a 64-character hex sha256 digest of the archived evidence")
        return value.lower()


class ModelPricing(BaseModel):
    """Spec section 6.1: every price a model could incur must be known and zero.

    `input_usd_per_million_tokens` / `output_usd_per_million_tokens` are
    required (no default) so a config that omits them fails to parse at
    all -- "unknown means denied" (spec rule 6) enforced structurally.
    `extra_fees` covers the image/audio/tool/storage/request prices section
    6.1 also lists; a model with none of those simply omits the key rather
    than declaring an unknown value, since not every model has them.
    """

    model_config = ConfigDict(extra="forbid")

    input_usd_per_million_tokens: Decimal
    output_usd_per_million_tokens: Decimal
    extra_fees: Dict[str, Decimal] = Field(default_factory=dict)


class PublishedLimits(BaseModel):
    model_config = ConfigDict(extra="forbid")

    requests_per_minute: Optional[int] = None
    tokens_per_minute: Optional[int] = None
    requests_per_day: Optional[int] = None


class ModelSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    enabled: bool = True
    free_only: bool = True
    capabilities: List[str] = Field(default_factory=list)
    context_tokens: int = Field(gt=0)
    max_output_tokens: int = Field(gt=0)
    pricing: ModelPricing
    published_limits: PublishedLimits = Field(default_factory=PublishedLimits)


class ProviderSpec(BaseModel):
    """Spec section 5 one entry of `providers:`.

    `id` is not part of the YAML value itself (it is the mapping key); the
    loader injects it so every `ProviderSpec` is self-describing once
    constructed.
    """

    model_config = ConfigDict(extra="forbid")

    id: str
    enabled: bool = False
    approval_state: ApprovalState = ApprovalState.CANDIDATE
    base_url: str = ""
    secret_env: str = ""
    billing_instrument_present: bool = False
    paid_credits_present: bool = False
    automatic_topup_enabled: bool = False
    terms: Optional[TermsEvidence] = None
    adapter: str = "openai_compatible"
    priority: int = 100
    models: List[ModelSpec] = Field(default_factory=list)
    rejection_reason: Optional[str] = None

    @field_validator("base_url")
    @classmethod
    def _must_be_https_when_present(cls, value: str) -> str:
        if value and not value.startswith("https://"):
            raise ValueError("base_url must be https:// -- egress allowlisting assumes TLS")
        return value


class GatewayConfigRoot(BaseModel):
    """Top-level document: the union of `policy.yaml` and `providers.approved.yaml`."""

    model_config = ConfigDict(extra="forbid")

    version: int = 1
    policy: Policy
    gateway: GatewayConfig = Field(default_factory=GatewayConfig)
    cache: CacheConfig = Field(default_factory=CacheConfig)
    providers: Dict[str, ProviderSpec] = Field(default_factory=dict)

    @field_validator("providers")
    @classmethod
    def _keys_match_provider_ids(cls, value: Dict[str, ProviderSpec]) -> Dict[str, ProviderSpec]:
        for key, provider in value.items():
            if provider.id != key:
                raise ValueError(f"providers.{key}: id field ({provider.id!r}) must match its mapping key")
        return value
