#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CHATGPT PROJECT REPORT WORKFLOW
===============================

Companion orchestration layer for ``UNIVERSAL_PROJECT_REPORT_ENGINE_26PLUS_ML.py``.

Purpose
-------
This module makes the end-to-end workflow explicit and auditable:

1. READ SOURCES
   - Discover uploaded files/folders/ZIP packages.
   - Use the source readers in the Universal Project Report Engine.
   - Preserve source IDs, file names, extracted text, tables, metadata, and warnings.

2. ANALYZE UPLOADED FILES
   - Build the normalized project-controls model.
   - Classify the report type.
   - Parse XER schedules and before/after comparisons.
   - Extract events, progress, milestones, constraints, risks, actions, and warnings.
   - Create a searchable evidence index.

3. INTERACT WITH THE EVIDENCE
   - Answer questions only from retrieved evidence and the normalized model.
   - Return source references and confidence with every answer.
   - Identify unsupported questions instead of inventing an answer.
   - Allow reviewed facts to be inserted into an AI context JSON.

4. CREATE REPORTS
   - Pass the reviewed context back to the Universal Project Report Engine.
   - Generate editable PowerPoint, PNG PowerPoint, SVG, PNG, PDF, HTML,
     project intelligence JSON, validation outputs, and a ZIP package.

This module does not attempt to reproduce a proprietary language model. It
implements the transparent file-reading, retrieval, grounding, interaction,
review, and report-generation workflow that an AI assistant should follow.

Examples
--------
Analyze only::

    python CHATGPT_PROJECT_REPORT_WORKFLOW_26PLUS_ML.py analyze \
        --input ./evidence \
        --session ./analysis_session.json

Ask one grounded question::

    python CHATGPT_PROJECT_REPORT_WORKFLOW_26PLUS_ML.py ask \
        --input ./evidence \
        --question "How was the forecast finish calculated?"

Interactive evidence chat::

    python CHATGPT_PROJECT_REPORT_WORKFLOW_26PLUS_ML.py chat --input ./evidence

Generate the complete report package::

    python CHATGPT_PROJECT_REPORT_WORKFLOW_26PLUS_ML.py generate \
        --input ./evidence \
        --output ./REPORT_OUTPUT \
        --report-type auto
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import re
import shlex
import sys
import tempfile
from collections import Counter
from dataclasses import asdict, dataclass, field, is_dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Tuple


WORKFLOW_VERSION = "3.0.0"
ATTRIBUTION = "Python AI Programming by Eng. Ahmed Labib"
DEFAULT_ENGINE_FILE = "UNIVERSAL_PROJECT_REPORT_ENGINE_26PLUS_ML.py"
DEFAULT_CONTEXT_FILE = "AI_CONTEXT_TEMPLATE_26PLUS_ML.json"


# ---------------------------------------------------------------------------
# Data contracts
# ---------------------------------------------------------------------------


@dataclass
class EvidenceChunk:
    """A traceable text unit used for retrieval and grounded interaction."""

    chunk_id: str
    source_id: str
    file_name: str
    source_kind: str
    location: str
    text: str
    tokens: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class Citation:
    """A source reference attached to an answer."""

    source_id: str
    file_name: str
    location: str
    excerpt: str
    score: float


@dataclass
class GroundedAnswer:
    """Evidence-grounded response returned by the workflow."""

    question: str
    answer: str
    confidence: str
    citations: List[Citation] = field(default_factory=list)
    unsupported_points: List[str] = field(default_factory=list)
    reasoning_basis: List[str] = field(default_factory=list)


@dataclass
class WorkflowSession:
    """Serializable record of one evidence-analysis session."""

    workflow_version: str
    engine_version: str
    generated_at: str
    input_files: List[str]
    report_type: str
    project_model: Dict[str, Any]
    source_inventory: List[Dict[str, Any]]
    context: Dict[str, Any]
    warnings: List[str]
    chunks: List[EvidenceChunk] = field(default_factory=list)


# ---------------------------------------------------------------------------
# General utilities
# ---------------------------------------------------------------------------


STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "been", "by", "can", "did",
    "do", "does", "for", "from", "had", "has", "have", "how", "i", "if", "in",
    "into", "is", "it", "its", "of", "on", "or", "our", "that", "the", "their",
    "then", "this", "to", "was", "were", "what", "when", "where", "which", "who",
    "why", "will", "with", "you", "your",
}


def _jsonable(value: Any) -> Any:
    if is_dataclass(value):
        return {k: _jsonable(v) for k, v in asdict(value).items()}
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_jsonable(v) for v in value]
    if isinstance(value, Path):
        return str(value)
    return value


def save_json(path: str | Path, value: Any) -> Path:
    target = Path(path).expanduser().resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        json.dumps(_jsonable(value), indent=2, ensure_ascii=False, default=str),
        encoding="utf-8",
    )
    return target


def load_json(path: str | Path) -> Dict[str, Any]:
    value = json.loads(Path(path).expanduser().read_text(encoding="utf-8-sig"))
    if not isinstance(value, dict):
        raise TypeError(f"Expected a JSON object in {path}")
    return value


def normalize_space(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def tokenize(text: str) -> List[str]:
    words = re.findall(r"[A-Za-z0-9_\-%.]+", (text or "").lower())
    return [w for w in words if len(w) > 1 and w not in STOPWORDS]


def split_sentences(text: str) -> List[str]:
    raw = re.split(r"(?<=[.!?])\s+|\n+", text or "")
    return [normalize_space(x) for x in raw if len(normalize_space(x)) >= 15]


def truncate(text: str, limit: int = 420) -> str:
    value = normalize_space(text)
    if len(value) <= limit:
        return value
    return value[: max(0, limit - 3)].rstrip() + "..."


def deep_merge(base: Dict[str, Any], patch: Dict[str, Any]) -> Dict[str, Any]:
    """Recursively merge reviewed context without deleting unrelated fields."""
    out = dict(base)
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = deep_merge(out[key], value)
        else:
            out[key] = value
    return out


# ---------------------------------------------------------------------------
# Engine loading
# ---------------------------------------------------------------------------


def resolve_engine_path(explicit: Optional[str | Path] = None) -> Path:
    candidates: List[Path] = []
    if explicit:
        candidates.append(Path(explicit).expanduser())
    candidates.extend(
        [
            Path(__file__).resolve().with_name(DEFAULT_ENGINE_FILE),
            Path.cwd() / DEFAULT_ENGINE_FILE,
        ]
    )
    for candidate in candidates:
        if candidate.exists():
            return candidate.resolve()
    raise FileNotFoundError(
        f"Could not find {DEFAULT_ENGINE_FILE}. Place this workflow beside the engine "
        "or pass --engine /full/path/to/UNIVERSAL_PROJECT_REPORT_ENGINE_26PLUS_ML.py"
    )


def load_engine(explicit: Optional[str | Path] = None):
    path = resolve_engine_path(explicit)
    spec = importlib.util.spec_from_file_location("universal_project_report_engine", path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Could not create import specification for {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


# ---------------------------------------------------------------------------
# Workflow implementation
# ---------------------------------------------------------------------------


class ChatGPTProjectReportWorkflow:
    """
    Auditable orchestration layer around the Universal Project Report Engine.

    The class intentionally separates:
    - ingestion,
    - normalization,
    - retrieval,
    - question answering,
    - reviewed context,
    - final artifact generation.
    """

    def __init__(
        self,
        engine_path: Optional[str | Path] = None,
        report_type: str = "auto",
        context: Optional[Dict[str, Any]] = None,
        max_chunk_chars: int = 1600,
        chunk_overlap_chars: int = 220,
    ) -> None:
        self.engine = load_engine(engine_path)
        self.engine_path = resolve_engine_path(engine_path)
        self.report_type = report_type
        self.context: Dict[str, Any] = dict(context or {})
        self.max_chunk_chars = max(500, int(max_chunk_chars))
        self.chunk_overlap_chars = max(0, min(int(chunk_overlap_chars), self.max_chunk_chars // 2))

        self.input_files: List[Path] = []
        self.sources: List[Any] = []
        self.schedules: List[Any] = []
        self.model: Optional[Any] = None
        self.chunks: List[EvidenceChunk] = []
        self.source_inventory: List[Dict[str, Any]] = []
        self.ingestion_warnings: List[str] = []

    # ------------------------- Stage 1: read sources ----------------------

    def read_sources(self, input_items: Sequence[str | Path], strict: bool = False) -> "ChatGPTProjectReportWorkflow":
        """Discover and parse all supported uploaded evidence files."""
        with tempfile.TemporaryDirectory(prefix="report_workflow_") as td:
            files = self.engine.collect_inputs(input_items, Path(td))
            self.input_files = [Path(x).resolve() for x in files]
            self.sources = []
            self.schedules = []
            self.ingestion_warnings = []

            for index, path in enumerate(self.input_files, 1):
                source_id = f"SRC-{index:03d}"
                try:
                    source, schedule = self.engine.read_source(path)
                    source.meta.setdefault("source_id", source_id)
                    self.sources.append(source)
                    if schedule is not None:
                        self.schedules.append(schedule)
                except Exception as exc:
                    warning = f"Reader failed for {path.name}: {exc}"
                    self.ingestion_warnings.append(warning)
                    fallback = self.engine.Source(
                        str(path),
                        path.suffix.lower().lstrip("."),
                        path.stem,
                        meta={"source_id": source_id},
                        warnings=[warning],
                    )
                    self.sources.append(fallback)
                    if strict:
                        raise RuntimeError(warning) from exc

        self.source_inventory = self.engine.source_inventory(self.sources)
        self.chunks = self._build_evidence_chunks()
        return self

    def _chunk_text(self, text: str) -> List[str]:
        text = (text or "").strip()
        if not text:
            return []
        paragraphs = [x.strip() for x in re.split(r"\n{2,}", text) if x.strip()]
        chunks: List[str] = []
        current = ""

        for paragraph in paragraphs:
            if len(paragraph) > self.max_chunk_chars:
                sentences = split_sentences(paragraph)
            else:
                sentences = [paragraph]

            for unit in sentences:
                candidate = f"{current}\n{unit}".strip() if current else unit
                if len(candidate) <= self.max_chunk_chars:
                    current = candidate
                    continue

                if current:
                    chunks.append(current)
                    overlap = current[-self.chunk_overlap_chars :] if self.chunk_overlap_chars else ""
                    current = f"{overlap}\n{unit}".strip()
                else:
                    start = 0
                    step = self.max_chunk_chars - self.chunk_overlap_chars
                    while start < len(unit):
                        chunks.append(unit[start : start + self.max_chunk_chars])
                        start += max(1, step)
                    current = ""

        if current:
            chunks.append(current)
        return chunks

    def _build_evidence_chunks(self) -> List[EvidenceChunk]:
        chunks: List[EvidenceChunk] = []
        sequence = 0

        for source in self.sources:
            source_id = source.meta.get("source_id", "SRC-UNKNOWN")
            file_name = Path(source.path).name

            for part_no, part in enumerate(self._chunk_text(source.text), 1):
                sequence += 1
                chunks.append(
                    EvidenceChunk(
                        chunk_id=f"CHK-{sequence:05d}",
                        source_id=source_id,
                        file_name=file_name,
                        source_kind=source.kind,
                        location=f"extracted text chunk {part_no}",
                        text=part,
                        tokens=tokenize(part),
                        metadata={"title": source.title},
                    )
                )

            for table_no, table in enumerate(source.tables or [], 1):
                headers = [normalize_space(str(x)) for x in table.get("headers", [])]
                rows = table.get("rows", []) or []
                table_name = table.get("name") or f"Table {table_no}"
                for row_no, row in enumerate(rows[:5000], 1):
                    values = [normalize_space(str(x)) for x in row]
                    pairs = [
                        f"{headers[i] if i < len(headers) else f'Column {i + 1}'}: {value}"
                        for i, value in enumerate(values)
                        if value
                    ]
                    if not pairs:
                        continue
                    sequence += 1
                    row_text = " | ".join(pairs)
                    chunks.append(
                        EvidenceChunk(
                            chunk_id=f"CHK-{sequence:05d}",
                            source_id=source_id,
                            file_name=file_name,
                            source_kind=source.kind,
                            location=f"{table_name}, row {row_no}",
                            text=row_text,
                            tokens=tokenize(row_text),
                            metadata={"table": table_name, "row": row_no},
                        )
                    )

        return chunks

    # ---------------------- Stage 2: analyze evidence ---------------------

    def analyze(self) -> "ChatGPTProjectReportWorkflow":
        """Build the normalized project model from all parsed sources."""
        if not self.sources:
            raise RuntimeError("No evidence has been read. Call read_sources() first.")
        self.model = self.engine.build_model(
            self.sources,
            self.schedules,
            self.report_type,
            self.context or None,
        )
        return self

    def source_summary(self) -> Dict[str, Any]:
        if self.model is None:
            raise RuntimeError("Run analyze() before requesting a source summary.")
        return {
            "project_name": self.model.project_name,
            "report_type": self.model.report_type,
            "classification_confidence": self.model.confidence,
            "data_date": self.model.data_date,
            "source_count": len(self.sources),
            "schedule_count": len(self.schedules),
            "evidence_chunk_count": len(self.chunks),
            "event_count": len(self.model.events),
            "milestone_count": len(self.model.milestones),
            "warnings": list(dict.fromkeys(self.ingestion_warnings + list(self.model.warnings))),
        }

    # ---------------- Stage 3: retrieve and interact ----------------------

    def _document_frequency(self) -> Counter[str]:
        frequency: Counter[str] = Counter()
        for chunk in self.chunks:
            frequency.update(set(chunk.tokens))
        return frequency

    def retrieve(self, query: str, top_k: int = 8) -> List[Tuple[EvidenceChunk, float]]:
        """Hybrid keyword retrieval with source traceability."""
        terms = tokenize(query)
        if not terms:
            return []

        document_frequency = self._document_frequency()
        total_docs = max(1, len(self.chunks))
        phrase = normalize_space(query).lower()
        results: List[Tuple[EvidenceChunk, float]] = []

        for chunk in self.chunks:
            counts = Counter(chunk.tokens)
            score = 0.0
            matched = 0
            for term in terms:
                tf = counts.get(term, 0)
                if not tf:
                    continue
                matched += 1
                idf = math.log((total_docs + 1) / (document_frequency.get(term, 0) + 1)) + 1.0
                score += (1.0 + math.log(tf)) * idf

            coverage = matched / max(1, len(set(terms)))
            score *= 0.65 + coverage
            lower_text = chunk.text.lower()
            if phrase and phrase in lower_text:
                score += 8.0
            if all(term in lower_text for term in set(terms)):
                score += 3.0
            if score > 0:
                results.append((chunk, round(score, 6)))

        results.sort(key=lambda item: (-item[1], item[0].source_id, item[0].chunk_id))
        return results[: max(1, top_k)]

    def _model_facts_for_question(self, question: str) -> List[str]:
        if self.model is None:
            return []
        q = question.lower()
        facts: List[str] = []

        if any(x in q for x in ["project", "report type", "data date", "status date"]):
            facts.extend(
                [
                    f"Project: {self.model.project_name}",
                    f"Report type: {self.model.report_type}",
                    f"Data date: {self.model.data_date or 'not established'}",
                ]
            )

        if any(x in q for x in ["finish", "forecast", "completion", "impact", "eot", "delay", "metric"]):
            metrics = self.model.metrics
            for label, key in [
                ("Base finish", "base_finish"),
                ("Latest/impacted finish", "latest_finish"),
                ("Gross impact days", "gross_impact_days"),
                ("Overlap days", "overlap_days"),
                ("Net EOT days", "net_eot_days"),
            ]:
                value = metrics.get(key)
                if value is not None:
                    facts.append(f"{label}: {value}")
            for comparison in self.model.comparisons[:8]:
                facts.append(
                    f"Comparison {comparison.name}: before finish {comparison.before_finish or 'not established'}, "
                    f"after finish {comparison.after_finish or 'not established'}, movement "
                    f"{comparison.movement_days if comparison.movement_days is not None else 'not established'} days."
                )

        if any(x in q for x in ["progress", "planned", "actual", "spi", "variance"]):
            for key, value in self.model.progress.items():
                facts.append(f"Progress {key}: {value}")

        if any(x in q for x in ["event", "cause", "effect", "risk", "constraint", "action"]):
            for event in self.model.events[:12]:
                facts.append(
                    f"{event.event_id} {event.title}: cause={event.cause}; effect={event.effect}; "
                    f"movement={event.movement_days}; treatment={event.treatment}."
                )
            facts.extend(f"Risk: {x}" for x in self.model.risks[:10])
            facts.extend(f"Constraint: {x}" for x in self.model.constraints[:10])
            facts.extend(f"Action: {x}" for x in self.model.actions[:10])

        return facts

    def build_ai_packet(self, question: str, top_k: int = 8) -> Dict[str, Any]:
        """
        Create the exact grounded information packet that can be sent to an AI model.

        A caller may connect this packet to any approved language-model client. The
        packet contains only the project model and selected source excerpts.
        """
        if self.model is None:
            raise RuntimeError("Run analyze() before building an AI packet.")
        retrieved = self.retrieve(question, top_k=top_k)
        return {
            "instruction": (
                "Answer only from the supplied project model and evidence excerpts. "
                "Do not invent missing facts. Distinguish measured schedule movement, "
                "contractual responsibility, and entitlement. Cite source_id and location."
            ),
            "question": question,
            "project_model": {
                "project_name": self.model.project_name,
                "report_type": self.model.report_type,
                "data_date": self.model.data_date,
                "metrics": self.model.metrics,
                "progress": self.model.progress,
                "events": [_jsonable(x) for x in self.model.events],
                "milestones": self.model.milestones,
                "constraints": self.model.constraints,
                "risks": self.model.risks,
                "actions": self.model.actions,
                "conclusions": self.model.conclusions,
                "warnings": self.model.warnings,
            },
            "evidence": [
                {
                    "chunk_id": chunk.chunk_id,
                    "source_id": chunk.source_id,
                    "file_name": chunk.file_name,
                    "location": chunk.location,
                    "text": chunk.text,
                    "retrieval_score": score,
                }
                for chunk, score in retrieved
            ],
        }

    def ask(
        self,
        question: str,
        top_k: int = 8,
        ai_reasoner: Optional[Callable[[Dict[str, Any]], Dict[str, Any] | str]] = None,
    ) -> GroundedAnswer:
        """
        Answer from evidence.

        When ``ai_reasoner`` is supplied, it receives ``build_ai_packet()`` and may
        return either a string or a dictionary containing ``answer``, ``confidence``,
        and ``unsupported_points``. Without an external reasoner, the workflow uses
        deterministic extractive synthesis.
        """
        if self.model is None:
            raise RuntimeError("Run analyze() before asking questions.")

        packet = self.build_ai_packet(question, top_k=top_k)
        citations = [
            Citation(
                source_id=item["source_id"],
                file_name=item["file_name"],
                location=item["location"],
                excerpt=truncate(item["text"], 360),
                score=float(item["retrieval_score"]),
            )
            for item in packet["evidence"]
        ]

        if ai_reasoner is not None:
            result = ai_reasoner(packet)
            if isinstance(result, str):
                return GroundedAnswer(
                    question=question,
                    answer=result,
                    confidence="Model supplied",
                    citations=citations,
                    reasoning_basis=["External AI reasoner used the grounded evidence packet."],
                )
            if not isinstance(result, dict):
                raise TypeError("ai_reasoner must return a string or dictionary")
            return GroundedAnswer(
                question=question,
                answer=str(result.get("answer") or "No answer returned."),
                confidence=str(result.get("confidence") or "Model supplied"),
                citations=citations,
                unsupported_points=[str(x) for x in result.get("unsupported_points", [])],
                reasoning_basis=[str(x) for x in result.get("reasoning_basis", [])]
                or ["External AI reasoner used the grounded evidence packet."],
            )

        model_facts = self._model_facts_for_question(question)
        query_terms = set(tokenize(question))
        candidate_sentences: List[Tuple[float, str, EvidenceChunk]] = []

        for chunk, retrieval_score in self.retrieve(question, top_k=top_k):
            for sentence in split_sentences(chunk.text):
                sentence_terms = set(tokenize(sentence))
                overlap = len(query_terms & sentence_terms)
                if overlap == 0:
                    continue
                score = retrieval_score + overlap * 1.8
                candidate_sentences.append((score, sentence, chunk))

        candidate_sentences.sort(key=lambda item: -item[0])
        selected: List[str] = []
        seen = set()
        for _, sentence, _ in candidate_sentences:
            key = re.sub(r"[^a-z0-9]+", " ", sentence.lower()).strip()
            if key in seen:
                continue
            seen.add(key)
            selected.append(sentence)
            if len(selected) >= 5:
                break

        answer_parts: List[str] = []
        if model_facts:
            answer_parts.append("Structured analysis: " + " ".join(model_facts[:8]))
        if selected:
            answer_parts.append("Supporting evidence: " + " ".join(selected))
        elif packet["evidence"]:
            direct_excerpts = [truncate(item["text"], 500) for item in packet["evidence"][:2]]
            answer_parts.append("Supporting evidence: " + " ".join(direct_excerpts))

        unsupported: List[str] = []
        if not answer_parts:
            unsupported.append(
                "The uploaded evidence and normalized model do not contain enough information to answer this question reliably."
            )
            answer = unsupported[0]
            confidence = "Low"
        else:
            answer = "\n\n".join(answer_parts)
            if len(citations) >= 3 and selected:
                confidence = "High"
            elif citations or model_facts:
                confidence = "Medium"
            else:
                confidence = "Low"

        return GroundedAnswer(
            question=question,
            answer=answer,
            confidence=confidence,
            citations=citations,
            unsupported_points=unsupported,
            reasoning_basis=[
                "Normalized project-model facts were checked first.",
                "Relevant evidence chunks were retrieved by query coverage and weighted term frequency.",
                "Only source-supported sentences were included in the deterministic answer.",
            ],
        )

    # ---------------- Stage 4: reviewed context ---------------------------

    def update_context(self, patch: Dict[str, Any], rebuild_model: bool = True) -> Dict[str, Any]:
        """Insert reviewed facts and optionally rebuild the project model."""
        if not isinstance(patch, dict):
            raise TypeError("Context patch must be a dictionary")
        self.context = deep_merge(self.context, patch)
        if rebuild_model and self.sources:
            self.analyze()
        return self.context

    def set_context_value(self, dotted_key: str, value: Any, rebuild_model: bool = True) -> Dict[str, Any]:
        """Set values such as metrics.net_eot_days or progress.actual."""
        keys = [x for x in dotted_key.split(".") if x]
        if not keys:
            raise ValueError("A dotted context key is required")
        patch: Dict[str, Any] = {}
        cursor = patch
        for key in keys[:-1]:
            cursor[key] = {}
            cursor = cursor[key]
        cursor[keys[-1]] = value
        return self.update_context(patch, rebuild_model=rebuild_model)

    # ---------------- Stage 5: create reports -----------------------------

    def generate_reports(
        self,
        output_directory: str | Path,
        config_path: Optional[str | Path] = None,
        strict: bool = False,
        keep_working: bool = False,
    ) -> Dict[str, Any]:
        """Generate the complete report package using the reviewed context."""
        if not self.input_files:
            raise RuntimeError("No input files are available. Call read_sources() first.")
        return self.engine.generate_report(
            input_files=[str(x) for x in self.input_files],
            output_directory=output_directory,
            report_type=self.report_type,
            config_path=config_path,
            context=self.context or None,
            strict=strict,
            keep_working=keep_working,
        )

    # ---------------- Serialization and human-readable output -------------

    def create_session(self) -> WorkflowSession:
        if self.model is None:
            raise RuntimeError("Run analyze() before creating a session file.")
        warnings = list(
            dict.fromkeys(self.ingestion_warnings + list(getattr(self.model, "warnings", [])))
        )
        return WorkflowSession(
            workflow_version=WORKFLOW_VERSION,
            engine_version=str(getattr(self.engine, "VERSION", "unknown")),
            generated_at=datetime.now().isoformat(timespec="seconds"),
            input_files=[str(x) for x in self.input_files],
            report_type=self.report_type,
            project_model=_jsonable(self.model),
            source_inventory=self.source_inventory,
            context=self.context,
            warnings=warnings,
            chunks=self.chunks,
        )

    def save_session(self, path: str | Path, include_chunks: bool = True) -> Path:
        session = self.create_session()
        payload = _jsonable(session)
        if not include_chunks:
            payload["chunks"] = []
        return save_json(path, payload)

    @staticmethod
    def format_answer(result: GroundedAnswer) -> str:
        lines = [ATTRIBUTION, result.answer, "", f"Confidence: {result.confidence}"]
        if result.citations:
            lines.append("Evidence references:")
            for item in result.citations:
                lines.append(
                    f"- [{item.source_id}] {item.file_name} — {item.location} "
                    f"(retrieval score {item.score:.2f}): {item.excerpt}"
                )
        if result.unsupported_points:
            lines.append("Unsupported / missing:")
            lines.extend(f"- {x}" for x in result.unsupported_points)
        return "\n".join(lines)


# ---------------------------------------------------------------------------
# Interactive shell
# ---------------------------------------------------------------------------


HELP_TEXT = """
Commands
--------
/sources                 Show parsed source inventory.
/summary                 Show normalized project summary.
/events                  Show detected events and measured movements.
/warnings                Show extraction and validation warnings.
/context                 Show current reviewed context JSON.
/set key=value           Set a reviewed context value, e.g.:
                         /set metrics.net_eot_days=69
/save path.json          Save the complete analysis session.
/generate output_folder  Generate the complete report package.
/help                    Show this help.
/exit                    Exit the interactive workflow.

Any other text is treated as a grounded question about the uploaded evidence.
""".strip()


def parse_scalar(value: str) -> Any:
    text = value.strip()
    if text.lower() in {"null", "none"}:
        return None
    if text.lower() in {"true", "false"}:
        return text.lower() == "true"
    try:
        return json.loads(text)
    except Exception:
        return text


def run_chat(workflow: ChatGPTProjectReportWorkflow) -> int:
    print(ATTRIBUTION)
    print(HELP_TEXT)
    print("\nEvidence is loaded. Ask a question or enter a command.\n")

    while True:
        try:
            raw = input("report> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return 0
        if not raw:
            continue
        if raw in {"/exit", "/quit"}:
            return 0
        if raw == "/help":
            print(HELP_TEXT)
            continue
        if raw == "/sources":
            print(json.dumps(workflow.source_inventory, indent=2, ensure_ascii=False))
            continue
        if raw == "/summary":
            print(json.dumps(workflow.source_summary(), indent=2, ensure_ascii=False))
            continue
        if raw == "/events":
            print(json.dumps([_jsonable(x) for x in workflow.model.events], indent=2, ensure_ascii=False))
            continue
        if raw == "/warnings":
            warnings = workflow.source_summary()["warnings"]
            print("\n".join(f"- {x}" for x in warnings) if warnings else "No warnings.")
            continue
        if raw == "/context":
            print(json.dumps(workflow.context, indent=2, ensure_ascii=False))
            continue
        if raw.startswith("/set "):
            expression = raw[5:].strip()
            if "=" not in expression:
                print("Use: /set dotted.key=value")
                continue
            key, value = expression.split("=", 1)
            workflow.set_context_value(key.strip(), parse_scalar(value))
            print(f"Updated {key.strip()}.")
            continue
        if raw.startswith("/save "):
            path = shlex.split(raw[6:].strip())[0]
            print(workflow.save_session(path))
            continue
        if raw.startswith("/generate "):
            path = shlex.split(raw[10:].strip())[0]
            print(json.dumps(workflow.generate_reports(path), indent=2, ensure_ascii=False))
            continue

        result = workflow.ask(raw)
        print(workflow.format_answer(result))
        print()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def common_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--input", nargs="+", required=True, help="Evidence files, folders, or ZIP files")
    parser.add_argument("--engine", help="Path to UNIVERSAL_PROJECT_REPORT_ENGINE_26PLUS_ML.py")
    parser.add_argument(
        "--report-type",
        default="auto",
        choices=["auto","tia","eot","delay","progress","recovery","variation","hybrid","resource","equipment","cost","evm","cashflow","scurve","procurement","material","lookahead","critical_path","float","milestone","risk","rfi_submittal","qaqc","productivity","executive","baseline_current","forecast_completion","ml_project_controls","contract_admin","change_control","document_control","interface_management"],
    )
    parser.add_argument("--context-json", help="Reviewed AI context JSON")
    parser.add_argument("--strict", action="store_true", help="Stop on reader or validation failure")


def construct_workflow(args: argparse.Namespace) -> ChatGPTProjectReportWorkflow:
    context = load_json(args.context_json) if getattr(args, "context_json", None) else None
    workflow = ChatGPTProjectReportWorkflow(
        engine_path=getattr(args, "engine", None),
        report_type=getattr(args, "report_type", "auto"),
        context=context,
    )
    workflow.read_sources(args.input, strict=getattr(args, "strict", False)).analyze()
    return workflow


def main(argv: Optional[Sequence[str]] = None) -> int:
    print(ATTRIBUTION)
    parser = argparse.ArgumentParser(
        description=f"ChatGPT-style project report workflow v{WORKFLOW_VERSION}"
    )
    parser.add_argument("--version", action="version", version=WORKFLOW_VERSION)
    subparsers = parser.add_subparsers(dest="command", required=True)

    analyze_parser = subparsers.add_parser("analyze", help="Read and analyze uploaded evidence")
    common_arguments(analyze_parser)
    analyze_parser.add_argument("--session", required=True, help="Output analysis-session JSON")
    analyze_parser.add_argument("--without-chunks", action="store_true")

    ask_parser = subparsers.add_parser("ask", help="Ask one grounded question")
    common_arguments(ask_parser)
    ask_parser.add_argument("--question", required=True)
    ask_parser.add_argument("--top-k", type=int, default=8)
    ask_parser.add_argument("--answer-json", help="Optional JSON output path")
    ask_parser.add_argument("--ai-packet", help="Optional grounded AI packet JSON path")

    chat_parser = subparsers.add_parser("chat", help="Interactive evidence Q&A and report generation")
    common_arguments(chat_parser)

    generate_parser = subparsers.add_parser("generate", help="Analyze evidence and create reports")
    common_arguments(generate_parser)
    generate_parser.add_argument("--output", required=True)
    generate_parser.add_argument("--config")
    generate_parser.add_argument("--keep-working", action="store_true")
    generate_parser.add_argument("--session", help="Optional analysis-session JSON")

    packet_parser = subparsers.add_parser("ai-packet", help="Create a grounded packet for an AI model")
    common_arguments(packet_parser)
    packet_parser.add_argument("--question", required=True)
    packet_parser.add_argument("--output", required=True)
    packet_parser.add_argument("--top-k", type=int, default=8)

    args = parser.parse_args(argv)
    workflow = construct_workflow(args)

    if args.command == "analyze":
        path = workflow.save_session(args.session, include_chunks=not args.without_chunks)
        print(json.dumps({"status": "completed", "session": str(path), **workflow.source_summary()}, indent=2, ensure_ascii=False))
        return 0

    if args.command == "ask":
        if args.ai_packet:
            save_json(args.ai_packet, workflow.build_ai_packet(args.question, top_k=args.top_k))
        result = workflow.ask(args.question, top_k=args.top_k)
        if args.answer_json:
            save_json(args.answer_json, result)
        print(workflow.format_answer(result))
        return 0

    if args.command == "chat":
        return run_chat(workflow)

    if args.command == "generate":
        if args.session:
            workflow.save_session(args.session)
        result = workflow.generate_reports(
            output_directory=args.output,
            config_path=args.config,
            strict=args.strict,
            keep_working=args.keep_working,
        )
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0

    if args.command == "ai-packet":
        path = save_json(args.output, workflow.build_ai_packet(args.question, top_k=args.top_k))
        print(path)
        return 0

    parser.print_help()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
