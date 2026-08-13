from __future__ import annotations

import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

from project_input_contracts import (
    activity_master_eligibility,
    build_activity_master_rows,
    build_payment_projection,
    load_master_table,
    load_payment_rows,
    read_csv_rows,
    write_activity_master,
)


def _write_csv(path: Path, headers: list[str], rows: list[list[str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(headers)
        writer.writerows(rows)


def test_activity_master_rebuilds_each_normal_logical_table_in_original_row_order(tmp_path: Path) -> None:
    data_dir = tmp_path / "01-data" / "import_templates"
    delay_dir = tmp_path / "02-delay_analysis" / "unified_tia_csv"
    _write_csv(data_dir / "activities.csv", ["project_id", "activity_id", "name"], [["P", "A2", "Second"], ["P", "A1", "First"]])
    _write_csv(data_dir / "evm.csv", ["project_id", "activity_id", "ev"], [["P", "A1", "100"], ["P", "A2", "200"]])
    _write_csv(data_dir / "progress_updates.csv", ["project_id", "activity_id", "progress"], [["P", "A2", "0.2"], ["P", "A1", "0.1"]])
    _write_csv(delay_dir / "04- p6_activity_export.csv", ["Project ID", "Activity ID", "remaining"], [["P", "A1", "1"], ["P", "A2", "2"]])

    assert activity_master_eligibility(data_dir, delay_dir) == (True, "Exact one-to-one activity key validation passed")
    headers, rows = build_activity_master_rows(data_dir, delay_dir)
    master = data_dir / "activity_master.csv"
    write_activity_master(master, headers, rows)

    assert load_master_table(master, "activities") == read_csv_rows(data_dir / "activities.csv")
    assert load_master_table(master, "evm") == read_csv_rows(data_dir / "evm.csv")
    assert load_master_table(master, "progress_updates") == read_csv_rows(data_dir / "progress_updates.csv")


def test_payment_projection_rebuilds_normal_payment_schema_from_tia_source(tmp_path: Path) -> None:
    data_dir = tmp_path / "01-data" / "import_templates"
    delay_dir = tmp_path / "02-delay_analysis" / "unified_tia_csv"
    normal = data_dir / "payments.csv"
    canonical = delay_dir / "08- payments.csv"
    _write_csv(normal, ["payment_id", "amount"], [["P-1", "100"], ["P-2", "200"]])
    _write_csv(canonical, ["payment_id", "amount", "unneeded_blank"], [["P-1", "100", ""], ["P-2", "200", ""]])

    build_payment_projection(normal, canonical, data_dir)
    normal.rename(data_dir / "payments.archived.csv")

    assert load_payment_rows(data_dir, delay_dir) == [{"payment_id": "P-1", "amount": "100"}, {"payment_id": "P-2", "amount": "200"}]
