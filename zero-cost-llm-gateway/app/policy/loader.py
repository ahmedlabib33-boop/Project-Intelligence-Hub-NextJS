"""Loads and schema-validates the two config files into a `GatewayConfigRoot`.

Kept deliberately separate from `models.py` (schema) and `firewall.py`
(runtime checks): this module only turns YAML into a validated tree or
raises `ConfigError`. It never decides whether a route is safe to use --
that is `validate_startup_config`'s job, called by the caller afterwards.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Optional

import yaml
from pydantic import ValidationError

from .models import GatewayConfigRoot


class ConfigError(Exception):
    """Raised for any structurally invalid or policy-violating config."""


def _read_yaml_mapping(path: Path) -> Dict[str, Any]:
    if not path.is_file():
        return {}
    with path.open("r", encoding="utf-8") as handle:
        data = yaml.safe_load(handle) or {}
    if not isinstance(data, dict):
        raise ConfigError(f"{path}: top level of the document must be a mapping")
    return data


def load_config(
    policy_path: Path,
    providers_path: Optional[Path] = None,
) -> GatewayConfigRoot:
    """Load `policy.yaml` (+ optional `providers.approved.yaml`) and validate.

    The two files are kept separate on disk (spec section 18) so the
    provider registry -- machine-imported and reviewed in Phase 2 -- can be
    rewritten independently of the hand-authored, rarely-changed policy
    file. Here they are simply merged into one document before validation;
    the schema does not care which file a field came from.
    """
    document = _read_yaml_mapping(policy_path)

    if providers_path is not None:
        provider_document = _read_yaml_mapping(providers_path)
        document["providers"] = provider_document.get("providers", {})

    raw_providers = document.get("providers") or {}
    if not isinstance(raw_providers, dict):
        raise ConfigError("providers must be a mapping of provider_id -> provider spec")

    # The YAML shape keys providers by id (`providers: {groq: {...}}`); the
    # schema wants that id inside each ProviderSpec too, so it is
    # self-describing once parsed out of its container.
    providers_with_ids: Dict[str, Any] = {}
    for provider_id, spec in raw_providers.items():
        if not isinstance(spec, dict):
            raise ConfigError(f"providers.{provider_id} must be a mapping")
        providers_with_ids[provider_id] = {"id": provider_id, **spec}
    document["providers"] = providers_with_ids

    try:
        return GatewayConfigRoot.model_validate(document)
    except ValidationError as exc:
        raise ConfigError(str(exc)) from exc
