"""Validate one project-local Universal Controlled TIA CSV pack."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "src") not in sys.path:
    sys.path.insert(0, str(ROOT / "src"))

from construction_system.unified_tia_csv import validate_pack


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", type=Path, required=True, help="Project-local unified_tia_csv directory.")
    parser.add_argument("--template-mode", action="store_true", help="Validate an intentionally empty template pack.")
    parser.add_argument("--expected-project-id", help="Reject rows that do not belong to this selected project ID.")
    parser.add_argument("--expected-project-key", help="Reject rows that do not belong to this selected project key.")
    parser.add_argument("--json-out", type=Path, help="Optional JSON result path.")
    args = parser.parse_args()
    result = validate_pack(
        args.input_dir,
        template_mode=args.template_mode,
        expected_project_id=args.expected_project_id,
        expected_project_key=args.expected_project_key,
    )
    rendered = json.dumps(result, indent=2)
    print(rendered)
    if args.json_out:
        args.json_out.parent.mkdir(parents=True, exist_ok=True)
        args.json_out.write_text(rendered + "\n", encoding="utf-8")
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
