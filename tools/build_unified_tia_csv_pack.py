"""Build the deterministic public and project-template Universal TIA CSV packs."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "src") not in sys.path:
    sys.path.insert(0, str(ROOT / "src"))

from construction_system.unified_tia_csv import write_template_pack


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--destination", action="append", type=Path, required=True, help="Template-pack directory to write; can be provided more than once.")
    args = parser.parse_args()
    for destination in args.destination:
        written = write_template_pack(destination)
        print(f"Wrote {len(written)} unified TIA contract files to {destination}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
