from __future__ import annotations

import json
import re
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
KNOWLEDGE_DIR = ROOT / "knowledge" / "technical_question_bank"
WEBSITE_DATA_DIR = ROOT / "website" / "public" / "data"
DEFAULT_DOCX = ROOT / "Construction_Maintenance_Technical_Question_Bank_Enhanced_Learning_KnowHow.docx"
FALLBACK_DOCX = Path(
    r"C:\Users\pc\OneDrive\Documents\Project Intelligence Hub\Construction_Maintenance_Technical_Question_Bank_Enhanced_Learning_KnowHow.docx"
)
RECORDS_JSON = KNOWLEDGE_DIR / "technical_question_bank.records.json"
INDEX_JSON = KNOWLEDGE_DIR / "technical_question_bank.index.json"
WEBSITE_INDEX_JSON = WEBSITE_DATA_DIR / "technical_question_bank.json"


STOPWORDS = {
    "the", "and", "or", "to", "of", "in", "on", "for", "with", "is", "are", "a", "an",
    "what", "which", "how", "do", "does", "i", "we", "it", "this", "that", "be", "by",
    "from", "into", "as", "at", "can", "should", "must", "user", "project",
}


SYNONYMS = {
    "delay": {"late", "delayed", "behind", "impact", "time", "schedule", "critical", "path", "eot"},
    "claim": {"claims", "entitlement", "notice", "contract", "dispute", "eot", "commercial"},
    "mep": {"mechanical", "electrical", "plumbing", "sleeves", "openings", "embedded", "coordination"},
    "steel": {"reinforcement", "rebar", "bars", "diameter", "delivery", "supply"},
    "letter": {"letters", "correspondence", "rfi", "reply", "response", "notice"},
    "risk": {"hazard", "exposure", "issue", "mitigation", "escalation", "audit"},
    "quality": {"qa", "qc", "inspection", "ncr", "defect", "test", "acceptance"},
    "procurement": {"material", "supplier", "submittal", "purchase", "delivery", "lead"},
}


@dataclass(frozen=True)
class KnowledgeRecord:
    id: str
    department: str
    section: str
    level: str
    question: str
    keywords: list[str]
    source_file: str


def _tokenize(text: str) -> list[str]:
    tokens = re.findall(r"[A-Za-z0-9]+", text.lower())
    expanded: list[str] = []
    for token in tokens:
        if token in STOPWORDS or len(token) < 2:
            continue
        expanded.append(token)
        for key, values in SYNONYMS.items():
            if token == key or token in values:
                expanded.append(key)
                expanded.extend(sorted(values))
    return sorted(set(expanded))


def _clean_heading(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _is_department(text: str, style_name: str) -> bool:
    if "Dept Heading" in style_name:
        return True
    return style_name == "Heading 1" and bool(re.match(r"^\d+\.\s+", text))


def extract_question_bank(source_docx: Path | None = None) -> list[KnowledgeRecord]:
    path = source_docx or DEFAULT_DOCX
    if not path.exists():
        path = FALLBACK_DOCX
    if not path.exists():
        raise FileNotFoundError(f"Technical question bank DOCX was not found: {source_docx or DEFAULT_DOCX}")

    try:
        from docx import Document
    except ImportError as exc:
        raise RuntimeError("python-docx is required to extract the technical question bank.") from exc

    document = Document(str(path))
    records: list[KnowledgeRecord] = []
    department = "General Technical Governance"
    section = "General"
    level = "General"
    question_counter = 0

    for paragraph in document.paragraphs:
        text = _clean_heading(paragraph.text)
        if not text:
            continue
        style_name = paragraph.style.name

        if _is_department(text, style_name):
            department = text
            section = "General"
            level = "General"
            continue
        if style_name == "Heading 2":
            section = text
            level = "General"
            continue
        if "Level Heading" in style_name:
            level = text
            continue
        if style_name in {"Question Item", "ALH Question"}:
            question_counter += 1
            question = re.sub(r"^(Q?\d+[\.\)]\s*)", "", text).strip()
            if not question:
                continue
            context_text = f"{department} {section} {level} {question}"
            records.append(
                KnowledgeRecord(
                    id=f"TQB-{question_counter:04d}",
                    department=department,
                    section=section,
                    level=level,
                    question=question,
                    keywords=_tokenize(context_text),
                    source_file=path.name,
                )
            )

    return records


def build_knowledge_index(source_docx: Path | None = None) -> dict[str, Any]:
    KNOWLEDGE_DIR.mkdir(parents=True, exist_ok=True)
    WEBSITE_DATA_DIR.mkdir(parents=True, exist_ok=True)
    source = source_docx or DEFAULT_DOCX
    if not source.exists():
        source = FALLBACK_DOCX
    if source.exists():
        target_docx = KNOWLEDGE_DIR / source.name
        if source.resolve() != target_docx.resolve():
            target_docx.write_bytes(source.read_bytes())

    records = extract_question_bank(source)
    payload = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "source_file": source.name if source.exists() else "",
        "record_count": len(records),
        "departments": sorted({record.department for record in records}),
        "records": [asdict(record) for record in records],
    }
    RECORDS_JSON.write_text(json.dumps(payload["records"], indent=2, ensure_ascii=False), encoding="utf-8")
    INDEX_JSON.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    WEBSITE_INDEX_JSON.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    return payload


def _score_record(query_tokens: set[str], record: KnowledgeRecord) -> float:
    record_tokens = set(record.keywords)
    overlap = len(query_tokens & record_tokens)
    if overlap == 0:
        return 0.0
    section_bonus = 1.0 if any(token in record.section.lower() for token in query_tokens) else 0.0
    department_bonus = 1.0 if any(token in record.department.lower() for token in query_tokens) else 0.0
    return (overlap * 3.0) + section_bonus + department_bonus


def search_question_bank(question: str, limit: int = 8) -> list[dict[str, Any]]:
    records_path = INDEX_JSON if INDEX_JSON.exists() else WEBSITE_INDEX_JSON
    if not records_path.exists():
        build_knowledge_index()
    payload = json.loads(records_path.read_text(encoding="utf-8"))
    records = [KnowledgeRecord(**record) for record in payload.get("records", [])]
    chunks = re.split(r"\band\b|\bor\b|,|;|\?", question, flags=re.IGNORECASE)
    query_tokens = set(_tokenize(" ".join(chunks) or question))
    ranked = [
        (record, _score_record(query_tokens, record))
        for record in records
    ]
    ranked = [(record, score) for record, score in ranked if score > 0]
    ranked.sort(key=lambda item: item[1], reverse=True)
    return [
        {
            **asdict(record),
            "score": round(score, 2),
        }
        for record, score in ranked[:limit]
    ]


def build_local_answer(question: str, matched: list[dict[str, Any]], source_scope: str) -> dict[str, Any]:
    departments = sorted({item["department"] for item in matched})
    evidence = [
        "Latest approved drawings, logs, registers, inspections, and schedule records relevant to the issue.",
        "Owner, deadline, impact, decision required, and closure evidence.",
    ]
    actions = [
        "Confirm the affected department and workfront.",
        "Collect source evidence before making a management or claim decision.",
        "Escalate unresolved blockers with owner and deadline.",
    ]
    if matched:
        lead = matched[0]["question"]
        answer = (
            f"The closest technical-control guidance is: {lead} "
            f"Use this as {source_scope} guidance, then confirm the facts from the selected project evidence before acting."
        )
    else:
        answer = "No close bank question was found. Treat this as a new technical issue and collect evidence before decision-making."
    return {
        "answer": answer,
        "matchedQuestions": matched,
        "departments": departments,
        "evidenceRequired": evidence,
        "owners": departments[:4],
        "impactAreas": ["time", "cost", "quality", "HSE", "contract", "handover"],
        "recommendedActions": actions,
        "followUpQuestions": [
            "Which activity, workfront, or system is affected?",
            "What source evidence confirms the issue?",
            "Who owns the next decision and by when?",
        ],
        "sourceScope": source_scope,
        "provider": "local",
        "model": "technical-question-bank",
        "status": "fallback",
    }


if __name__ == "__main__":
    index = build_knowledge_index()
    print(f"Built technical question bank index with {index['record_count']} records.")
