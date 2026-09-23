"""End-to-end loader tests: real YAML files on disk -> validated config.

Exercises the actual shipped `config/policy.yaml` +
`config/providers.approved.yaml`, plus a couple of hand-written fixture
pairs, so a mistake in either the loader or the shipped defaults is caught
here rather than only in the FastAPI app at Phase 1.
"""

from pathlib import Path

import pytest

from app.policy.firewall import RouteDenied, validate_startup_config
from app.policy.loader import ConfigError, load_config

REPO_ROOT = Path(__file__).resolve().parents[2]


def test_shipped_default_config_loads_and_starts_clean() -> None:
    config = load_config(
        REPO_ROOT / "config" / "policy.yaml",
        REPO_ROOT / "config" / "providers.approved.yaml",
    )
    assert config.providers == {}
    validate_startup_config(config)  # must not raise: nothing is enabled yet


def test_loader_rejects_a_credit_card_provider(tmp_path: Path) -> None:
    policy_path = tmp_path / "policy.yaml"
    providers_path = tmp_path / "providers.approved.yaml"
    policy_path.write_text(
        """
version: 1
policy: {}
""",
        encoding="utf-8",
    )
    providers_path.write_text(
        """
providers:
  card_provider:
    enabled: true
    approval_state: APPROVED_FREE
    base_url: https://api.example.invalid/v1
    secret_env: CARD_PROVIDER_API_KEY
    billing_instrument_present: true
    terms:
      price_verified_zero: true
      verified_at: "2026-09-15T00:00:00Z"
      expires_at: "2026-10-15T00:00:00Z"
      official_url: https://provider.example.invalid/pricing
      evidence_sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    models:
      - id: some-model
        context_tokens: 8192
        max_output_tokens: 2048
        pricing:
          input_usd_per_million_tokens: 0.00
          output_usd_per_million_tokens: 0.00
""",
        encoding="utf-8",
    )

    config = load_config(policy_path, providers_path)  # structurally valid, so this loads fine
    with pytest.raises(RouteDenied) as excinfo:
        validate_startup_config(config)  # ... but the firewall refuses to start
    assert excinfo.value.reason == "billing_instrument_present"


def test_loader_rejects_unknown_pricing_at_parse_time(tmp_path: Path) -> None:
    policy_path = tmp_path / "policy.yaml"
    providers_path = tmp_path / "providers.approved.yaml"
    policy_path.write_text("version: 1\npolicy: {}\n", encoding="utf-8")
    providers_path.write_text(
        """
providers:
  incomplete_provider:
    enabled: true
    approval_state: APPROVED_FREE
    base_url: https://api.example.invalid/v1
    secret_env: INCOMPLETE_PROVIDER_API_KEY
    terms:
      price_verified_zero: true
      verified_at: "2026-09-15T00:00:00Z"
      expires_at: "2026-10-15T00:00:00Z"
      official_url: https://provider.example.invalid/pricing
      evidence_sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    models:
      - id: some-model
        context_tokens: 8192
        max_output_tokens: 2048
        pricing:
          input_usd_per_million_tokens: 0.00
          # output price omitted entirely: unknown, must be denied at load
""",
        encoding="utf-8",
    )

    with pytest.raises(ConfigError):
        load_config(policy_path, providers_path)


def test_loader_rejects_policy_yaml_that_tries_to_allow_paid_fallback(tmp_path: Path) -> None:
    policy_path = tmp_path / "policy.yaml"
    policy_path.write_text(
        """
version: 1
policy:
  allow_paid_fallback: true
""",
        encoding="utf-8",
    )

    with pytest.raises(ConfigError):
        load_config(policy_path, None)


def test_loader_rejects_mismatched_provider_id(tmp_path: Path) -> None:
    policy_path = tmp_path / "policy.yaml"
    providers_path = tmp_path / "providers.approved.yaml"
    policy_path.write_text("version: 1\npolicy: {}\n", encoding="utf-8")
    providers_path.write_text(
        """
providers:
  groq:
    id: not_groq
    enabled: false
""",
        encoding="utf-8",
    )

    with pytest.raises(ConfigError):
        load_config(policy_path, providers_path)
