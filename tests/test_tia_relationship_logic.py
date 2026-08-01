from pathlib import Path
import sys

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from construction_system.steel_delay_tia import attach_relationship_logic, normalize_relationship_logic  # noqa: E402


def test_relationship_file_is_normalized_and_attached_to_own_activity_only() -> None:
    relationships = pd.DataFrame(
        [
            {"Activity ID": "A-200", "Predecessor ID": "A-100", "Successor ID": "", "Relationship Type": "FS", "Lag": "2"},
            {"Activity ID": "A-300", "Predecessor ID": "A-200", "Successor ID": "", "Relationship Type": "SS", "Lag": "-1"},
        ]
    )
    p6 = pd.DataFrame(
        [
            {"Activity ID": "A-100", "Activity Name": "Predecessor"},
            {"Activity ID": "A-200", "Activity Name": "Affected activity"},
            {"Activity ID": "A-300", "Activity Name": "Successor"},
        ]
    )

    logic = normalize_relationship_logic(relationships)
    linked = attach_relationship_logic(p6, logic)

    assert len(logic) == 2
    affected = linked.loc[linked["Activity ID"] == "A-200"].iloc[0]
    unrelated = linked.loc[linked["Activity ID"] == "A-100"].iloc[0]
    assert affected["Driving Predecessor Activity ID"] == "A-100"
    assert affected["Driving Predecessor Relationship Type"] == "FS"
    assert affected["Driving Predecessor Lag"] == 2.0
    assert affected["Driving Successor Activity ID"] == "A-300"
    assert affected["Driving Successor Relationship Type"] == "SS"
    assert unrelated["Driving Predecessor Activity ID"] == ""
    assert unrelated["Driving Successor Activity ID"] == "A-200"


def test_missing_relationship_file_does_not_invent_logic() -> None:
    p6 = pd.DataFrame([{"Activity ID": "A-200", "Activity Name": "Affected activity"}])

    linked = attach_relationship_logic(p6, normalize_relationship_logic(pd.DataFrame()))

    assert linked.loc[0, "Relationship Logic Status"] == "Missing relationship file"
    assert linked.loc[0, "Driving Predecessor Activity ID"] == ""
