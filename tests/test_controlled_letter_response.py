from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ROUTE = ROOT / "website" / "src" / "app" / "api" / "letters-response-draft" / "route.ts"
ENGINE = ROOT / "website" / "src" / "lib" / "letters" / "controlled-response.ts"
PAGE = ROOT / "website" / "src" / "app" / "page.tsx"


def test_response_route_uses_the_controlled_seven_section_engine():
    route = ROUTE.read_text(encoding="utf-8")
    engine = ENGINE.read_text(encoding="utf-8")

    assert "buildControlledLetterResponse" in route
    assert "Clarification of the Existing Record and Correspondence History" in engine
    assert "Factual Position, Actual Effects and Mitigation" in engine
    assert "Purpose and Status of Previous Notices" in engine
    assert "Contractual Basis and Published Clause Wording" in engine
    assert "Continuing Notice, Evidence, Time and Cost Position" in engine
    assert "Requested Engineer Action" in engine
    assert "Reservation of Rights" in engine
    assert "Summary of SAMCO's Position" in engine
    assert "Evidence and Attachment Schedule" in engine


def test_response_engine_exposes_review_controls_without_ml_branding():
    engine = ENGINE.read_text(encoding="utf-8")
    page = PAGE.read_text(encoding="utf-8")

    assert "evidence_gaps" in engine
    assert "contention_map" in engine
    assert "conflict_review" in engine
    assert "published_contract_wording" in engine
    assert "Evidence Gaps and Mandatory Review" in page
    assert "Contention Map" in page
    assert "Conflict Review" in page
    assert "machine learning" not in engine.lower()


def test_response_engine_uses_probability_ranked_project_evidence():
    engine = ENGINE.read_text(encoding="utf-8")

    assert "function classify" in engine
    assert "Math.exp" in engine
    assert "probability" in engine
    assert "thresholds: { accepted: 0.58, review: 0.45 }" in engine
    assert "STR-090 supplies logic only" in engine
    assert "rankHistory" in engine
    assert "rankClauses" in engine


def test_response_engine_never_withholds_a_professional_draft_for_missing_matches():
    engine = ENGINE.read_text(encoding="utf-8")
    page = PAGE.read_text(encoding="utf-8")

    assert "if (!matched.length) return" not in engine
    assert "fallbackContractReferences" in engine
    assert "rankApplicationContext" in engine
    assert "application_context" in engine
    assert "Professional Response Basis" in page
    assert "Application Context Reviewed" in page
