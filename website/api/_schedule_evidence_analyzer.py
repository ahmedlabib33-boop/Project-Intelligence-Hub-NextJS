from __future__ import annotations

from collections import defaultdict
from datetime import datetime
import re
import unicodedata
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple


ARABIC_RE = re.compile(r"[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]")
LATIN_RE = re.compile(r"[A-Za-z]")
ARABIC_DIACRITICS_RE = re.compile(r"[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]")
MARKER_RE = re.compile(r"^\[(PAGE|SHEET|SLIDE|TABLE)\s+([^\]]+)\]$", re.IGNORECASE)
ARABIC_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")


def _normalize(value: Any) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).translate(ARABIC_DIGITS)
    text = ARABIC_DIACRITICS_RE.sub("", text.lower())
    text = text.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا").replace("ى", "ي").replace("ة", "ه")
    return re.sub(r"\s+", " ", text).strip()


def _short(value: Any, limit: int = 520) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text if len(text) <= limit else f"{text[: limit - 1]}…"


def _language(text: str) -> str:
    arabic = len(ARABIC_RE.findall(text))
    latin = len(LATIN_RE.findall(text))
    if arabic and latin:
        return "Arabic and English"
    if arabic:
        return "Arabic"
    if latin:
        return "English"
    return "Language not confirmed"


DOCUMENT_TYPES: Sequence[Tuple[str, Sequence[str]]] = (
    ("Contract / Conditions", ("contract", "conditions of contract", "particular conditions", "general conditions", "عقد", "شروط العقد", "الشروط الخاصه", "الشروط العامه")),
    ("BOQ / Quantity", ("bill of quantities", "priced boq", "boq", "جدول الكميات", "مقايسه", "كميات")),
    ("Technical Specification", ("technical specification", "special specification", "specification", "المواصفات الفنيه", "المواصفات الخاصه", "مواصفات")),
    ("Method Statement / Methodology", ("method statement", "construction methodology", "work method", "بيان طريقه", "منهجيه التنفيذ", "طريقه التنفيذ")),
    ("Drawing", ("drawing", "ifc drawing", "shop drawing", "مخطط", "لوحه", "رسومات", "رسم تنفيذي")),
    ("Schedule / Programme", ("primavera", "xer", "baseline schedule", "programme", "program", "البرنامج الزمني", "جدول زمني", "بريمافيرا")),
    ("Submittal / Register", ("submittal register", "shop drawing register", "material register", "سجل الاعتمادات", "سجل المخططات", "سجل المواد")),
    ("Procurement / Long Lead", ("procurement", "long lead", "purchase order", "توريدات", "مشتريات", "طويل التوريد")),
    ("RFI / Technical Query", ("request for information", "rfi", "استفسار فني", "طلب معلومات")),
    ("ITP / QA-QC", ("inspection and test plan", "itp", "hold point", "خطه الفحص", "نقطه توقف", "ضبط الجوده")),
    ("Testing / Commissioning", ("testing and commissioning", "commissioning", "اختبارات وتشغيل", "التشغيل التجريبي")),
    ("Handover", ("handover", "taking over", "as-built", "o&m manual", "تسليم", "مستندات التسليم", "حسب التنفيذ")),
    ("Geotechnical", ("geotechnical", "soil report", "foundation recommendation", "تقرير التربه", "جسات", "توصيات الاساسات")),
    ("Authority / Permit", ("authority approval", "permit", "noc", "موافقه جهه", "تصريح", "عدم ممانعه")),
    ("Correspondence / Minutes", ("correspondence", "letter", "minutes of meeting", "mom", "مراسلات", "خطاب", "محضر اجتماع")),
    ("Resource / Productivity", ("resource plan", "manpower", "productivity", "equipment plan", "خطه الموارد", "العماله", "الانتاجيه", "المعدات")),
)


REQUIREMENTS: Sequence[Dict[str, Any]] = (
    {"id": "project_name", "label": "Project Name", "terms": ("project name", "اسم المشروع"), "priority": "Critical", "source": "Contract / Contract Data"},
    {"id": "employer", "label": "Client / Employer", "terms": ("employer", "client", "owner", "صاحب العمل", "المالك", "العميل"), "priority": "High", "source": "Contract / Contract Data"},
    {"id": "engineer", "label": "Engineer / Consultant", "terms": ("engineer", "consultant", "المهندس", "الاستشاري"), "priority": "High", "source": "Contract / Contract Data"},
    {"id": "contractor", "label": "Contractor", "terms": ("contractor", "المقاول"), "priority": "High", "source": "Contract / Contract Data"},
    {"id": "contract_number", "label": "Contract Number", "terms": ("contract no", "contract number", "رقم العقد"), "priority": "High", "source": "Contract Agreement"},
    {"id": "location", "label": "Project Location", "terms": ("project location", "site location", "موقع المشروع", "موقع الاعمال"), "priority": "Medium", "source": "Contract / Drawings"},
    {"id": "contract_type", "label": "Contract Type", "terms": ("contract type", "lump sum", "unit rate", "نوع العقد", "مقطوعيه", "سعر الوحده"), "priority": "Medium", "source": "Contract / BOQ"},
    {"id": "commencement_date", "label": "Contract Commencement Date", "terms": ("commencement date", "commencement of the works", "تاريخ البدء", "تاريخ بدء الاعمال", "تاريخ المباشره"), "priority": "Critical", "source": "Contract / Notice to Proceed", "scalar": "date"},
    {"id": "notice_to_proceed", "label": "Notice to Proceed Date", "terms": ("notice to proceed", "ntp", "امر الاسناد", "امر المباشره", "اخطار المباشره"), "priority": "Critical", "source": "Notice to Proceed", "scalar": "date"},
    {"id": "time_for_completion", "label": "Time for Completion", "terms": ("time for completion", "contract duration", "period of completion", "مده التنفيذ", "مده العقد", "فتره التنفيذ"), "priority": "Critical", "source": "Contract / Contract Data", "scalar": "duration"},
    {"id": "completion_date", "label": "Required Completion Date", "terms": ("completion date", "contract completion", "required completion", "تاريخ الانتهاء", "تاريخ اتمام الاعمال", "تاريخ التسليم"), "priority": "Critical", "source": "Contract / Contract Data", "scalar": "date"},
    {"id": "milestones", "label": "Contractual / Sectional Milestones", "terms": ("contractual milestone", "sectional completion", "key milestone", "milestone", "معلم تعاقدي", "مراحل التسليم", "مواعيد مرحليه"), "priority": "Critical", "source": "Contract / Appendix", "table": "Contract and Milestones"},
    {"id": "calendar", "label": "Working Calendar", "terms": ("working days", "working hours", "project calendar", "calendar", "ايام العمل", "ساعات العمل", "تقويم المشروع"), "priority": "Critical", "source": "Contract / Site Rules", "table": "Calendars"},
    {"id": "scope", "label": "Scope / Main Deliverables", "terms": ("scope of work", "works include", "main deliverables", "نطاق الاعمال", "يشمل نطاق", "المخرجات الرئيسيه"), "priority": "Critical", "source": "Scope / Employer Requirements", "table": "Scope and Deliverables"},
    {"id": "boq", "label": "BOQ / Quantities", "terms": ("bill of quantities", "boq", "quantity", "جدول الكميات", "الكميه", "بند الكميه"), "priority": "Critical", "source": "BOQ / Drawings", "table": "Scope, BOQ and Quantities"},
    {"id": "drawings", "label": "Drawings / Areas / Zones", "terms": ("drawing no", "drawing title", "ifc drawing", "area", "zone", "floor", "رقم اللوحه", "عنوان اللوحه", "منطقه", "قطاع", "دور"), "priority": "Critical", "source": "Drawing Register / Drawings", "table": "Drawings and Derived Scope"},
    {"id": "specifications", "label": "Technical Specifications", "terms": ("specification section", "technical specification", "special specification", "curing", "مواصفات فنيه", "قسم المواصفات", "معالجه الخرسانه"), "priority": "Critical", "source": "Technical / Special Specifications", "table": "Technical Durations and Specifications"},
    {"id": "methodology", "label": "Construction Methodology", "terms": ("method statement", "construction methodology", "construction sequence", "طريقه التنفيذ", "منهجيه التنفيذ", "تسلسل التنفيذ"), "priority": "Critical", "source": "Method Statement / Methodology", "table": "Construction Methodology and Sequence"},
    {"id": "work_fronts", "label": "Work Fronts / Sequence", "terms": ("work front", "construction sequence", "sequence of works", "جبهه عمل", "واجهه عمل", "تسلسل الاعمال"), "priority": "High", "source": "Methodology / Logistics", "table": "Construction Methodology and Sequence"},
    {"id": "shop_drawings", "label": "Shop Drawing Cycle", "terms": ("shop drawing", "shop drawings", "مخططات الورشه", "رسومات تنفيذييه", "لوحات الشوب"), "priority": "High", "source": "Contract / Shop Drawing Register", "table": "Engineering and Approval Cycles"},
    {"id": "material_submittals", "label": "Material Submittal Cycle", "terms": ("material submittal", "material approval", "اعتماد المواد", "تقديم المواد"), "priority": "High", "source": "Contract / Material Register", "table": "Engineering and Approval Cycles"},
    {"id": "rfi_cycle", "label": "RFI Cycle", "terms": ("rfi response", "request for information", "technical query", "مده الرد علي الاستفسار", "استفسار فني", "طلب معلومات"), "priority": "High", "source": "Contract / RFI Register", "table": "Engineering and Approval Cycles"},
    {"id": "review_durations", "label": "Consultant Review Durations", "terms": ("review duration", "engineer review period", "consultant review", "مده المراجعه", "فتره مراجعه الاستشاري"), "priority": "Critical", "source": "Contract / Submittal Procedure", "table": "Engineering and Approval Cycles"},
    {"id": "procurement", "label": "Procurement Cycle", "terms": ("procurement lead time", "manufacturing period", "shipping duration", "procurement", "مده التوريد", "فتره التصنيع", "الشحن", "المشتريات"), "priority": "High", "source": "Procurement Register / Vendor Data", "table": "Procurement and Long-Lead Items"},
    {"id": "long_lead", "label": "Long-Lead Items", "terms": ("long lead", "long-lead", "طويل التوريد", "مواد طويله التوريد"), "priority": "Critical", "source": "Long-Lead Register", "table": "Procurement and Long-Lead Items"},
    {"id": "resources", "label": "Resources / Manpower", "terms": ("resource plan", "manpower", "crew", "خطه الموارد", "العماله", "طاقم العمل"), "priority": "High", "source": "Resource / Manpower Plan", "table": "Resources, Equipment and Productivity"},
    {"id": "productivity", "label": "Productivity Rates", "terms": ("productivity", "output per day", "production rate", "الانتاجيه", "معدل الانتاج"), "priority": "High", "source": "Productivity Data / Methodology", "table": "Resources, Equipment and Productivity"},
    {"id": "equipment", "label": "Equipment Requirements", "terms": ("equipment plan", "equipment requirement", "plant and equipment", "خطه المعدات", "المعدات المطلوبه"), "priority": "High", "source": "Equipment Plan / Methodology", "table": "Resources, Equipment and Productivity"},
    {"id": "site_logistics", "label": "Site Logistics / Restrictions", "terms": ("site logistics", "access restriction", "storage area", "traffic restriction", "لوجستيات الموقع", "قيود الدخول", "منطقه التخزين", "قيود المرور"), "priority": "High", "source": "Logistics Plan / Contract", "table": "Constraints and Interfaces"},
    {"id": "itp", "label": "ITP / Inspections / Hold Points", "terms": ("inspection and test plan", "hold point", "witness point", "inspection notice", "خطه الفحص", "نقطه توقف", "نقطه مشاهده", "اخطار فحص"), "priority": "High", "source": "ITP / Specification", "table": "QA-QC, Inspections and Testing"},
    {"id": "authority", "label": "Authority Approvals / Permits", "terms": ("authority approval", "permit approval", "noc", "موافقه الجهات", "تصريح", "عدم ممانعه"), "priority": "High", "source": "Authority Register / Contract", "table": "Authorities and Permits"},
    {"id": "testing", "label": "Testing & Commissioning", "terms": ("testing and commissioning", "integrated testing", "pre-commissioning", "اختبارات وتشغيل", "اختبارات متكامله", "ما قبل التشغيل"), "priority": "High", "source": "T&C Requirements / Specifications", "table": "Testing, Commissioning and Handover"},
    {"id": "handover", "label": "Handover Requirements", "terms": ("handover requirement", "taking over", "as-built drawings", "o&m manuals", "متطلبات التسليم", "الاستلام", "رسومات حسب التنفيذ", "ادله التشغيل والصيانه"), "priority": "High", "source": "Contract / Handover Requirements", "table": "Testing, Commissioning and Handover"},
    {"id": "constraints", "label": "Constraints / Interfaces", "terms": ("schedule constraint", "interface milestone", "dependency", "قيد زمني", "واجهه تنسيق", "اعتماديه"), "priority": "High", "source": "Contract / Interface Register", "table": "Constraints and Interfaces"},
    {"id": "progress_measurement", "label": "Progress Measurement / Update Frequency", "terms": ("progress measurement", "update frequency", "monthly update", "weekly update", "قياس التقدم", "دوريه التحديث", "تحديث شهري", "تحديث اسبوعي"), "priority": "High", "source": "Contract / Project Controls Procedure", "table": "Project Controls Requirements"},
    {"id": "cost_loading", "label": "Cost Loading / Cash Flow", "terms": ("cost loading", "cash flow", "priced programme", "تحميل التكاليف", "التدفق النقدي", "برنامج مسعر"), "priority": "Medium", "source": "Contract / BOQ", "table": "Project Controls Requirements"},
    {"id": "resource_loading", "label": "Resource Loading", "terms": ("resource loading", "resource-loaded", "تحميل الموارد", "برنامج محمل بالموارد"), "priority": "Medium", "source": "Contract / Planning Requirements", "table": "Project Controls Requirements"},
    {"id": "geotechnical_report", "label": "Geotechnical / Foundation Recommendation", "terms": ("geotechnical investigation", "soil investigation report", "foundation recommendation", "borehole", "bearing capacity", "تقرير الجسات", "توصيات الاساسات", "تحمل التربه"), "priority": "Critical", "source": "Geotechnical Investigation / Foundation Recommendation Report", "table": "Geotechnical and Foundation"},
    {"id": "letter_of_award", "label": "Letter of Award / Commencement Notice", "terms": ("letter of award", "notice of award", "commencement notice", "خطاب الترسيه", "خطاب الاحاله", "اخطار المباشره"), "priority": "High", "source": "Letter of Award / Commencement Notice", "table": "Contract and Milestones"},
    {"id": "tender_clarifications", "label": "Tender Clarifications / Addenda", "terms": ("clarification", "addendum", "addenda", "tender query", "استفسار المناقصه", "توضيح", "ملحق توضيحي"), "priority": "Medium", "source": "Tender Clarifications / Addenda", "table": "Contract and Milestones"},
    {"id": "wbs_coding_structure", "label": "Approved WBS / Coding Structure", "terms": ("wbs coding", "coding structure", "activity coding structure", "cost code structure", "هيكل الترميز", "نظام ترميز الانشطه"), "priority": "High", "source": "Approved WBS / Coding Structure", "table": "Construction Methodology and Sequence"},
    {"id": "document_transmittal_register", "label": "Document Transmittal Register", "terms": ("transmittal register", "document transmittal", "issue and transmittal", "سجل التسليم", "سجل المراسلات", "سجل تسليم المستندات"), "priority": "High", "source": "Document Transmittal Register", "table": "Engineering and Approval Cycles"},
    {"id": "submittal_procedure", "label": "Submittal / Approval Procedure", "terms": ("submittal procedure", "review and resubmission", "resubmission cycle", "approval procedure", "اجراء الاعتماد", "اعاده التقديم"), "priority": "Medium", "source": "Submittal / Approval Procedure", "table": "Engineering and Approval Cycles"},
    {"id": "subcontractor_packages", "label": "Subcontractor Package List", "terms": ("subcontractor package", "subcontract package", "package list", "نطاق مقاول الباطن", "حزمه مقاول الباطن"), "priority": "Medium", "source": "Subcontractor Package List", "table": "Resources, Equipment and Productivity"},
    {"id": "temporary_works", "label": "Temporary Works Requirements", "terms": ("temporary works", "shoring", "scaffolding", "dewatering", "temporary access road", "اعمال مؤقته", "دعامات", "سقالات", "خفض منسوب المياه الجوفيه"), "priority": "High", "source": "Temporary Works Requirements", "table": "Constraints and Interfaces"},
)


# Which of the REQUIREMENTS ids the Tender Schedule vs the Detailed / Baseline
# Schedule needs, and how strictly -- mirrors the "must-have documents" tables
# for each schedule type. This drives the wording in must_have_data_check
# only; it does not change which requirements count as "Critical" for the
# overall readiness gate (that stays a single, stage-independent priority
# per requirement, set above).
SCHEDULE_STAGE_APPLICABILITY: Dict[str, Tuple[str, str]] = {
    "commencement_date": ("Must", "Must"),
    "time_for_completion": ("Must", "Must"),
    "completion_date": ("Must", "Must"),
    "milestones": ("Must", "Must"),
    "calendar": ("Must", "Must"),
    "scope": ("Must", "Must"),
    "boq": ("Must — Tender BOQ", "Must — Approved / Contract BOQ"),
    "drawings": ("Must — Tender Drawings", "Must — IFC / Approved Drawings"),
    "specifications": ("Must", "Must"),
    "geotechnical_report": ("Must where applicable", "Must"),
    "methodology": ("Preliminary", "Must — detailed / approved"),
    "work_fronts": ("Preliminary", "Must — work-front specific"),
    "shop_drawings": ("Major packages only", "Must — full register"),
    "material_submittals": ("Major packages only", "Must — full register"),
    "document_transmittal_register": ("Tender issue dates only", "Must — actual planned/actual dates"),
    "submittal_procedure": ("Assumed", "Must — contractual cycles"),
    "review_durations": ("Assumed / contract", "Must — contractual duration"),
    "procurement": ("Major long-lead items", "Must — full procurement chain"),
    "long_lead": ("Must", "Must"),
    "resources": ("Preliminary", "Must — detailed"),
    "productivity": ("Assumed / historical", "Must — project-specific / validated"),
    "equipment": ("Major equipment", "Must — detailed"),
    "itp": ("High-level if available", "Must"),
    "rfi_cycle": ("Not normally detailed", "Must where relevant"),
    "testing": ("High-level", "Must — detailed"),
    "handover": ("High-level", "Must — detailed"),
    "site_logistics": ("Preliminary", "Must — detailed"),
    "cost_loading": ("Usually limited", "As contract requires"),
    "progress_measurement": ("Not normally required", "Must"),
    "tender_clarifications": ("Must", "—"),
    "letter_of_award": ("—", "Must"),
    "wbs_coding_structure": ("—", "Must"),
    "subcontractor_packages": ("—", "Must — mobilization/approval"),
    "temporary_works": ("—", "Must where applicable"),
}


DATE_RE = re.compile(
    r"\b(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{1,2}\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|يناير|فبراير|مارس|ابريل|أبريل|مايو|يونيو|يوليو|اغسطس|أغسطس|سبتمبر|اكتوبر|أكتوبر|نوفمبر|ديسمبر)\s+\d{4})\b",
    re.IGNORECASE,
)
DURATION_RE = re.compile(r"\b\d+(?:\.\d+)?\s*(?:calendar\s+days?|working\s+days?|days?|weeks?|months?|hours?|يوم(?:ا|ين)?|ايام|أيام|اسابيع|أسابيع|اسبوع|أسبوع|شهور|اشهر|أشهر|شهر|ساعات|ساعه)\b", re.IGNORECASE)


# Column-name terms distinctive enough to identify a real BOQ header row.
# Some workbooks put a merged title (e.g. "BILL No.1 - BRIDGE 7 - STRUCTURES")
# in row 1 with the real columns in row 2; the generic table extractor then
# takes the title as `headers` and demotes the real header into row 0 of
# `rows`. _effective_headers() detects and corrects for that rather than
# trusting `table.headers` unconditionally.
BOQ_HEADER_TERMS = (
    "item", "description", "unit", "quantity", "qty", "rate", "amount", "section", "division",
    "البند", "الوصف", "الوحده", "الكميه", "السعر", "الاجمالي", "القسم",
)

# "Item" column values that are section headings, carry-forward or subtotal
# labels rather than a real item number -- observed directly in real BOQ
# workbooks where these rows are interspersed with priced line items.
NON_ITEM_LABEL_PREFIXES = ("section", "carried", "summary", "sub total", "subtotal", "bill no", "page", "total")


def _header_like_score(cells: Sequence[Any]) -> int:
    normalized = [_normalize(cell) for cell in cells]
    return sum(1 for cell in normalized if cell and any(term in cell for term in BOQ_HEADER_TERMS))


def _effective_headers(table: Any) -> Tuple[List[str], int]:
    """Return (headers, data_row_offset). offset is 1 when the real header
    was recovered from rows[0] and that row must be skipped as data.
    """
    headers = [str(h or "") for h in getattr(table, "headers", []) or []]
    rows = getattr(table, "rows", []) or []
    header_score = _header_like_score(headers)
    if rows:
        first_row_score = _header_like_score(rows[0])
        if first_row_score > header_score and first_row_score >= 3:
            return [str(cell or "") for cell in rows[0]], 1
    return headers, 0


def _document_type(document: Any) -> str:
    haystack = _normalize(f"{getattr(document, 'filename', '')} {getattr(document, 'text', '')[:30000]}")
    scores: List[Tuple[int, str]] = []
    for label, terms in DOCUMENT_TYPES:
        score = sum(1 for term in terms if _normalize(term) in haystack)
        if score:
            scores.append((score, label))
    # A BOQ is structurally a priced schedule of items: Description + Unit +
    # Quantity + Rate/Amount together in one table is a far stronger signal
    # than incidental free-text term matches (an item description that
    # happens to mention "specification" can otherwise outscore "boq").
    for table in getattr(document, "tables", []) or []:
        headers, _ = _effective_headers(table)
        normalized_headers = [_normalize(h) for h in headers]
        has_quantity = any(any(t in h for t in ("quantity", "qty", "الكميه")) for h in normalized_headers)
        has_price = any(any(t in h for t in ("rate", "unit cost", "amount", "السعر", "الاجمالي")) for h in normalized_headers)
        has_description = any(any(t in h for t in ("description", "item", "الوصف", "البند")) for h in normalized_headers)
        if has_quantity and has_price and has_description:
            scores.append((6, "BOQ / Quantity"))
            break
    return max(scores)[1] if scores else "Other Project Evidence"


def _segments(document: Any) -> Iterable[Tuple[str, str]]:
    location = "EXACT SOURCE LOCATION UNAVAILABLE"
    seen: set[Tuple[str, str]] = set()
    for raw in str(getattr(document, "text", "") or "").splitlines():
        line = raw.strip()
        marker = MARKER_RE.match(line)
        if marker:
            location = f"{marker.group(1).title()} {marker.group(2).strip()}"
            continue
        if len(line) < 3:
            continue
        key = (location, _normalize(line))
        if key not in seen:
            seen.add(key)
            yield location, line
    for table in getattr(document, "tables", []) or []:
        headers = [str(item or "") for item in getattr(table, "headers", [])]
        for row_number, row in enumerate(getattr(table, "rows", []) or [], start=2):
            cells = [str(item or "") for item in row]
            content = " | ".join(
                f"{headers[index] if index < len(headers) and headers[index] else f'Column {index + 1}'}: {cell}"
                for index, cell in enumerate(cells)
                if cell.strip()
            )
            if not content:
                continue
            loc = f"{getattr(table, 'name', 'Table')}, row {row_number}"
            key = (loc, _normalize(content))
            if key not in seen:
                seen.add(key)
                yield loc, content


def _contains_term(normalized_line: str, terms: Sequence[str]) -> bool:
    return any(_normalize(term) in normalized_line for term in terms)


def _scalar_value(requirement: Dict[str, Any], line: str) -> Optional[Tuple[str, str]]:
    kind = requirement.get("scalar")
    normalized = _normalize(line)
    positions = [normalized.find(_normalize(term)) for term in requirement["terms"] if _normalize(term) in normalized]
    start = max(0, min(positions)) if positions else 0
    window = normalized[start : start + 260]
    match = DATE_RE.search(window) if kind == "date" else DURATION_RE.search(window) if kind == "duration" else None
    if not match:
        return None
    raw = match.group(0)
    canonical = _normalize(raw)
    if kind == "date":
        parsed = _parse_date(canonical)
        canonical = parsed.date().isoformat() if parsed else canonical
    return raw, canonical


def _parse_date(value: str) -> Optional[datetime]:
    month_map = {
        "يناير": "January", "فبراير": "February", "مارس": "March", "ابريل": "April", "أبريل": "April",
        "مايو": "May", "يونيو": "June", "يوليو": "July", "اغسطس": "August", "أغسطس": "August",
        "سبتمبر": "September", "اكتوبر": "October", "أكتوبر": "October", "نوفمبر": "November", "ديسمبر": "December",
    }
    text = value.translate(ARABIC_DIGITS)
    for arabic, english in month_map.items():
        text = text.replace(_normalize(arabic), english)
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%d-%m-%Y", "%d/%m/%Y", "%d-%m-%y", "%d/%m/%y", "%d %B %Y", "%d %b %Y"):
        try:
            return datetime.strptime(text.title(), fmt)
        except ValueError:
            continue
    return None


def _structured_schedule_rows(documents: Sequence[Any]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]]]:
    wbs_rows: List[Dict[str, Any]] = []
    activity_rows: List[Dict[str, Any]] = []
    logic_rows: List[Dict[str, Any]] = []
    aliases = {
        "activity_id": ("activity id", "activity code", "task id", "رمز النشاط", "كود النشاط"),
        "activity_name": ("activity name", "task name", "activity", "اسم النشاط", "النشاط"),
        "wbs": ("wbs", "work breakdown structure", "هيكل تقسيم العمل"),
        "predecessor": ("predecessor", "predecessors", "النشاط السابق", "سابق"),
        "successor": ("successor", "successors", "النشاط اللاحق", "لاحق"),
        "relationship": ("relationship", "relation", "نوع العلاقه", "العلاقه"),
        "lag": ("lag", "time lag", "فاصل زمني", "تأخير العلاقه"),
    }
    for document in documents:
        for table in getattr(document, "tables", []) or []:
            normalized_headers = [_normalize(item) for item in getattr(table, "headers", [])]
            found: Dict[str, int] = {}
            for key, names in aliases.items():
                for index, header in enumerate(normalized_headers):
                    if any(_normalize(name) == header for name in names):
                        found[key] = index
                        break
            for row_number, row in enumerate(getattr(table, "rows", []) or [], start=2):
                def cell(key: str) -> str:
                    index = found.get(key)
                    return _short(row[index], 240) if index is not None and index < len(row) else ""
                source = f"{document.filename} — {table.name}, row {row_number}"
                if cell("wbs"):
                    wbs_rows.append({"WBS": cell("wbs"), "Source": source, "Status": "AVAILABLE"})
                if cell("activity_id") or cell("activity_name"):
                    activity_rows.append({
                        "Activity ID": cell("activity_id") or "UNAVAILABLE",
                        "Activity Name": cell("activity_name") or "UNAVAILABLE",
                        "WBS": cell("wbs") or "UNAVAILABLE",
                        "Source": source,
                        "Status": "AVAILABLE" if cell("activity_id") and cell("activity_name") else "PARTIALLY AVAILABLE",
                    })
                if cell("predecessor") or cell("successor"):
                    logic_rows.append({
                        "Predecessor": cell("predecessor") or "UNAVAILABLE",
                        "Successor": cell("successor") or cell("activity_id") or "UNAVAILABLE",
                        "Relationship": cell("relationship") or "UNAVAILABLE",
                        "Lag": cell("lag") or "UNAVAILABLE",
                        "Source": source,
                        "Status": "AVAILABLE" if cell("predecessor") and (cell("successor") or cell("activity_id")) else "PARTIALLY AVAILABLE",
                    })
    unique_wbs = {(_normalize(row["WBS"]), row["Source"]): row for row in wbs_rows}
    return list(unique_wbs.values())[:2000], activity_rows[:5000], logic_rows[:5000]


# BOQ-specific data points that a priced BOQ commonly leaves composite or
# absent even when it is otherwise well structured (reinforcement inside a
# composite concrete rate, no productivity data, etc.). Each check only
# reports what it can actually find in the uploaded BOQ's own column
# headers -- never a guess at what the missing value would have been.
BOQ_COLUMN_CHECKS: Sequence[Dict[str, Any]] = (
    {"id": "reinforcement_quantity", "label": "Reinforcement quantity as a separate line/column", "terms": ("reinforcement", "rebar", "steel weight", "حديد التسليح", "وزن الحديد"), "why": "Without a separate reinforcement quantity, a defensible rebar duration (ton/day) cannot be calculated — it is otherwise buried inside composite concrete rates."},
    {"id": "formwork_quantity", "label": "Formwork quantity as a separate line/column", "terms": ("formwork", "شده", "الشدات الخشبيه"), "why": "Formwork m² is needed to calculate formwork duration; when absent it is usually folded into composite concrete rates and must come from drawings/QTO instead."},
    {"id": "cost_breakdown", "label": "Material / labour / equipment cost breakdown (not just one unit rate)", "terms": ("material cost", "labour cost", "labor cost", "equipment cost", "تكلفه المواد", "تكلفه العماله", "تكلفه المعدات"), "why": "A single composite unit rate cannot be split into direct-cost categories, which blocks cost-loaded scheduling, cash-flow forecasting and prolongation/delay cost analysis."},
    {"id": "productivity_data", "label": "Productivity / output / crew data", "terms": ("productivity", "output per day", "crew size", "number of crews", "الانتاجيه", "معدل الانتاج", "عدد الطواقم"), "why": "Activity Duration = Quantity ÷ Productivity cannot be applied without a productivity or crew-size assumption; this is almost never carried inside a priced BOQ."},
    {"id": "location_coding", "label": "Building / Floor / Zone location coding", "terms": ("building", "floor", "zone", "villa type", "block", "مبني", "دور", "منطقه", "قطاع"), "why": "Location-based WBS and work-front planning need a Building → Floor → Zone breakdown; BOQ line items rarely carry this beyond the section/sheet title."},
    {"id": "discipline_classification", "label": "Discipline classification (Civil / Structural / Architectural / MEP)", "terms": ("discipline", "trade", "التخصص"), "why": "Discipline-level cost and schedule weighting needs an explicit discipline column, not just the BOQ section heading."},
    {"id": "supply_install_flag", "label": "Supply-only / Install-only / Supply & Install flag", "terms": ("supply only", "install only", "supply and install", "supply & install", "توريد فقط", "تركيب فقط", "توريد وتركيب"), "why": "Procurement scheduling needs to separate supply from installation scope; without an explicit flag this must be inferred from free-text descriptions."},
    {"id": "employer_supplied_flag", "label": "Employer-supplied / free-issue material flag", "terms": ("employer supplied", "free issue", "provided by employer", "توريد صاحب العمل", "بند مجاني"), "why": "Employer material-delivery milestones cannot be scheduled without knowing which items are Employer-supplied rather than Contractor-procured."},
    {"id": "provisional_prime_lump_sum", "label": "Provisional Sum / Prime Cost / Lump Sum flags", "terms": ("provisional sum", "prime cost", "p.c. sum", "lump sum", "مبلغ احتياطي", "مبلغ نقدي محدد", "مبلغ اجمالي"), "why": "These items carry uncertain scope or cost and need separate treatment in the cost baseline rather than being treated as firm, measurable quantities."},
    {"id": "long_lead_flag", "label": "Long-lead item flag", "terms": ("long lead", "long-lead", "طويل التوريد"), "why": "Long-lead procurement items should be identifiable directly in the BOQ so they can be scheduled as critical procurement activities."},
    {"id": "p6_mapping_columns", "label": "P6 / WBS / Cost-code mapping columns", "terms": ("activity id", "wbs code", "cost code", "p6 code", "كود النشاط", "كود التكلفه"), "why": "Without a BOQ-to-P6 mapping column, linking BOQ items to Primavera activities, WBS and cost accounts has to be built as a separate register."},
)


def _boq_numeric_anomalies(boq_documents: Sequence[Any]) -> Dict[str, Any]:
    """Zero/negative/blank Quantity, Rate or Amount cells -- computed only
    from columns actually identified in the reviewed tables.
    """
    quantity_aliases = ("quantity", "qty", "الكميه")
    rate_aliases = ("rate", "unit rate", "unit cost", "unit price", "سعر الوحده")
    amount_aliases = ("amount", "total amount", "total", "الاجمالي", "القيمه")

    zero_rate: List[Dict[str, Any]] = []
    zero_quantity: List[Dict[str, Any]] = []
    negative_values: List[Dict[str, Any]] = []
    blank_values: List[Dict[str, Any]] = []
    rows_checked = 0

    for document in boq_documents:
        for table in getattr(document, "tables", []) or []:
            effective, offset = _effective_headers(table)
            headers = [_normalize(item) for item in effective]
            qty_index = next((i for i, header in enumerate(headers) if header and any(_normalize(t) in header for t in quantity_aliases)), None)
            rate_index = next((i for i, header in enumerate(headers) if header and any(_normalize(t) in header for t in rate_aliases)), None)
            amount_index = next((i for i, header in enumerate(headers) if header and any(_normalize(t) in header for t in amount_aliases)), None)
            if qty_index is None and rate_index is None and amount_index is None:
                continue
            for row_number, row in enumerate((getattr(table, "rows", []) or [])[offset:], start=2 + offset):
                rows_checked += 1
                source = f"{document.filename} — {getattr(table, 'name', 'Table')}, row {row_number}"
                for label, index in (("Quantity", qty_index), ("Rate", rate_index), ("Amount", amount_index)):
                    if index is None or index >= len(row):
                        continue
                    raw = row[index]
                    text = str(raw).strip() if raw is not None else ""
                    if not text:
                        blank_values.append({"Field": label, "Source": source})
                        continue
                    try:
                        value = float(text.replace(",", ""))
                    except ValueError:
                        continue
                    if value < 0:
                        negative_values.append({"Field": label, "Value": value, "Source": source})
                    elif value == 0:
                        if label == "Rate":
                            zero_rate.append({"Source": source})
                        elif label == "Quantity":
                            zero_quantity.append({"Source": source})

    return {
        "rows_checked": rows_checked,
        "zero_rate_lines": zero_rate[:50],
        "zero_quantity_lines": zero_quantity[:50],
        "negative_values": negative_values[:50],
        "blank_values": blank_values[:50],
        "note": (
            "Blank items require commercial review — they may be legitimate headers or alternates rather than data errors."
            if rows_checked else
            "No Quantity, Rate or Amount column was identified in the reviewed BOQ table(s), so numeric checks could not run."
        ),
    }


# ---------------------------------------------------------------------------
# Drawing register -- text-layer only. No OCR, no vector/geometric quantity
# take-off: this reads exactly the same document.text every other check in
# this module reads. Confirmed empirically against a real 93-file drawing
# set: some drawings (CAD exports with real embedded text) yield genuine
# title-block, note and cross-reference text; others (plotted/rasterized
# sheets) yield none at all -- those are reported as OCR required, never
# backfilled with an assumed value.
# ---------------------------------------------------------------------------

DRAWING_FILENAME_RE = re.compile(
    r"\b(dwg|drg)\b|-(AR|SB|ST|CV|RD|TR|WU|PL|PU|EL|DS|MEP|HV|FF|FP|LS|IN)-\d",
    re.IGNORECASE,
)

DRAWING_DISCIPLINE_CODES = {
    "AR": "Architectural", "A": "Architectural",
    "ST": "Structural", "SB": "Structural", "S": "Structural",
    "CV": "Civil", "C": "Civil",
    "RD": "Roads", "TR": "Roads",
    "WU": "Wet Utilities",
    "PL": "Plumbing", "PU": "Plumbing",
    "EL": "Electrical", "DS": "Electrical", "E": "Electrical",
    "MEP": "MEP", "M": "Mechanical", "HV": "HVAC",
    "FF": "Fire Fighting", "FP": "Fire Fighting",
    "LS": "Landscape", "L": "Landscape",
    "IN": "Infrastructure",
}
DRAWING_CODE_RE = re.compile(r"-([A-Z]{1,4})-\d+[A-Za-z]*$")

DRAWING_STATUS_PATTERNS: Sequence[Tuple[str, "re.Pattern[str]"]] = (
    ("IFC — Issued For Construction", re.compile(r"issued for construction|\bifc\b", re.I)),
    ("100% Tender Design", re.compile(r"100\s*%\s*tender\s+design", re.I)),
    ("Approved Shop Drawing", re.compile(r"approved\s+shop\s+drawing", re.I)),
    ("Approved For Construction", re.compile(r"approved\s+for\s+construction", re.I)),
    ("Tender", re.compile(r"\btender\b", re.I)),
    ("Concept", re.compile(r"\bconcept\b", re.I)),
)
STRUCTURE_ID_RE = re.compile(r"\bbridge\s*\(?\s*(?:no\.?)?\s*0?(\d{1,3})\s*\)?", re.I)
DRAWING_CROSS_REF_RE = re.compile(r"\b(see detail|see section|refer to drawing|refer to specification)\b", re.I)
DRAWING_QA_WORDS = ("INSPECT", "APPROVE", "TEST", "WITNESS", "HOLD", "VERIFY", "SUBMIT", "MOCK-UP", "SAMPLE")
DRAWING_PROCUREMENT_TERMS = (
    "transformer", "switchgear", "generator", "elevator", "chiller", "ahu", "pump",
    "façade", "facade", "specialist door", "valve",
)
DRAWING_NOTE_TERMS = (
    "shall", "must", "required", "inspect", "approve", "test", "witness", "hold", "verify", "submit", "coordinate", "refer",
)


def _is_drawing_candidate(document: Any) -> bool:
    if _document_type(document) == "Drawing":
        return True
    return bool(DRAWING_FILENAME_RE.search(getattr(document, "filename", "") or ""))


def _drawing_discipline(filename: str) -> str:
    stem = filename.rsplit(".", 1)[0].upper()
    match = DRAWING_CODE_RE.search(stem)
    if not match:
        return "Not identified from filename"
    code = match.group(1)
    return DRAWING_DISCIPLINE_CODES.get(code, f"Unrecognized code ({code})")


def _drawing_status(text: str) -> str:
    for label, pattern in DRAWING_STATUS_PATTERNS:
        if pattern.search(text):
            return label
    return "NOT STATED"


def _structure_id(text: str) -> str:
    match = STRUCTURE_ID_RE.search(text)
    return f"Bridge {match.group(1)}" if match else ""


def assess_drawing_register(documents: Sequence[Any]) -> Dict[str, Any]:
    """Text-only drawing register: discipline, status, structure reference,
    notes, cross-references, QA-gate and procurement-candidate keywords --
    all mined from each drawing's own already-extracted text. A drawing
    with no embedded text layer (plotted/rasterized, confirmed to occur in
    real packages) is listed as OCR required, not silently dropped or
    given an invented value.
    """
    rows: List[Dict[str, Any]] = []
    for document in documents:
        if not _is_drawing_candidate(document):
            continue
        text = str(getattr(document, "text", "") or "")
        filename = getattr(document, "filename", "") or ""
        warnings = list(getattr(document, "warnings", []) or [])
        ocr_required = not text.strip() and any("OCR" in w or "scanned/image-only" in w for w in warnings)

        if ocr_required or not text.strip():
            rows.append({
                "Drawing File": filename,
                "Discipline": _drawing_discipline(filename),
                "Status": "NOT AVAILABLE",
                "Structure / Bridge": "NOT AVAILABLE",
                "Notes Found": 0,
                "Cross-References": 0,
                "QA Gate Candidates": [],
                "Procurement Candidates": [],
                "Read Status": "OCR REQUIRED — NOT ANALYZED",
            })
            continue

        notes = [
            line.strip() for line in text.splitlines()
            if line.strip() and _contains_term(_normalize(line), DRAWING_NOTE_TERMS)
        ]
        rows.append({
            "Drawing File": filename,
            "Discipline": _drawing_discipline(filename),
            "Status": _drawing_status(text),
            "Structure / Bridge": _structure_id(text) or "NOT IDENTIFIED",
            "Notes Found": len(notes),
            "Cross-References": len(DRAWING_CROSS_REF_RE.findall(text)),
            "QA Gate Candidates": [w for w in DRAWING_QA_WORDS if re.search(rf"\b{re.escape(w)}\w*\b", text, re.I)],
            "Procurement Candidates": [t for t in DRAWING_PROCUREMENT_TERMS if re.search(rf"\b{re.escape(t)}s?\b", text, re.I)],
            "Read Status": "READ",
        })

    by_discipline: Dict[str, int] = defaultdict(int)
    ocr_required_count = 0
    for row in rows:
        by_discipline[row["Discipline"]] += 1
        if row["Read Status"] != "READ":
            ocr_required_count += 1

    return {
        "drawings_found": len(rows),
        "drawings_requiring_ocr": ocr_required_count,
        "by_discipline": dict(by_discipline),
        "rows": rows,
        "note": (
            "Drawing reading here is text-layer only: title-block fields, discipline, structure/bridge "
            "references, notes and cross-references extracted from each drawing's own embedded text. It does "
            "not perform OCR or geometric quantity take-off from vector/raster content — a drawing with no "
            "embedded text layer is reported as OCR required, never estimated or backfilled."
        ),
    }


def assess_boq_completeness(documents: Sequence[Any]) -> Dict[str, Any]:
    """Deterministic BOQ-readiness check.

    Reports what the priced BOQ actually carries versus what quantity/cost
    loading and schedule-duration calculation need — computed only from
    headers and values present in the uploaded BOQ table(s). It never
    infers or assumes a value that is not present in the source; a data
    point not found is reported as not separately available, not as zero
    or as an estimate.
    """
    boq_documents = [document for document in documents if _document_type(document) == "BOQ / Quantity"]
    if not boq_documents:
        return {
            "boq_documents_found": 0,
            "column_checks": [],
            "unique_key_risk": None,
            "numeric_anomalies": None,
            "note": "No document was classified as a BOQ / Quantity document; upload a priced BOQ to run this check.",
        }

    all_headers: List[str] = []
    header_sources: Dict[str, List[str]] = defaultdict(list)
    for document in boq_documents:
        for table in getattr(document, "tables", []) or []:
            effective, _ = _effective_headers(table)
            for header in effective:
                normalized = _normalize(header)
                if not normalized:
                    continue
                all_headers.append(normalized)
                header_sources[normalized].append(f"{document.filename} — {getattr(table, 'name', 'Table')}")

    column_checks: List[Dict[str, Any]] = []
    for check in BOQ_COLUMN_CHECKS:
        matched_header = next((header for header in all_headers if any(_normalize(term) in header for term in check["terms"])), None)
        column_checks.append({
            "Data Point": check["label"],
            "Status": "AVAILABLE AS A SEPARATE COLUMN" if matched_header else "NOT SEPARATELY AVAILABLE",
            "Matched Column": matched_header or "—",
            "Source": ", ".join(sorted(set(header_sources.get(matched_header, [])))) if matched_header else "—",
            "Why It Matters": check["why"],
        })

    # Unique-key risk: does the same Item No. repeat across different
    # sections/sheets? Computed only from rows actually found.
    item_no_aliases = ("item no", "item number", "item code", "bill no", "item", "بند رقم", "رقم البند", "البند")
    section_aliases = ("section", "division", "bill no", "قسم", "الباب")
    item_locations: Dict[str, set] = defaultdict(set)
    for document in boq_documents:
        for table in getattr(document, "tables", []) or []:
            effective, offset = _effective_headers(table)
            headers = [_normalize(item) for item in effective]
            item_index = next((i for i, header in enumerate(headers) if header and any(_normalize(term) in header for term in item_no_aliases)), None)
            if item_index is None:
                continue
            section_index = next((i for i, header in enumerate(headers) if header and any(_normalize(term) in header for term in section_aliases)), None)
            for row in (getattr(table, "rows", []) or [])[offset:]:
                if item_index >= len(row):
                    continue
                item_no = _normalize(str(row[item_index] or ""))
                # Real BOQ "Item" columns routinely mix real item codes with
                # section-heading, carried-forward and subtotal label rows
                # (e.g. "Section 1.1 - Excavation", "Carried to Summary") and
                # unevaluated formula text (openpyxl reads formulas, not
                # their computed value, in this read mode). None of those
                # are item numbers, so they must not count as one.
                if not item_no or item_no.startswith("=") or any(
                    item_no.startswith(prefix) for prefix in NON_ITEM_LABEL_PREFIXES
                ):
                    continue
                section = _normalize(str(row[section_index])) if section_index is not None and section_index < len(row) else getattr(table, "name", "")
                item_locations[item_no].add(f"{document.filename} / {section or getattr(table, 'name', 'Table')}")

    repeated_items = {item_no: sorted(locations) for item_no, locations in item_locations.items() if len(locations) > 1}
    if not item_locations:
        key_recommendation = "No Item No. column was identified in the reviewed BOQ table(s)."
    elif repeated_items:
        key_recommendation = (
            "BOQ Item No. repeats across different sections/sheets and is not a safe unique schedule/cost key on its "
            "own; use a composite key (e.g. Section + Item No. + Description) or a generated BOQ Cost Code."
        )
    else:
        key_recommendation = "No repeated Item No. values were found across sections/sheets in the reviewed tables."
    unique_key_risk = {
        "checked_items": len(item_locations),
        "repeated_item_numbers": len(repeated_items),
        "examples": [{"Item No.": item_no, "Appears In": locations} for item_no, locations in list(repeated_items.items())[:20]],
        "recommendation": key_recommendation,
    }

    return {
        "boq_documents_found": len(boq_documents),
        "column_checks": column_checks,
        "unique_key_risk": unique_key_risk,
        "numeric_anomalies": _boq_numeric_anomalies(boq_documents),
        "note": (
            "These BOQs are generally strong enough for BOQ → WBS development → quantity loading → initial cost "
            "loading → discipline weighting → high-value item identification. They are not yet sufficient, on their "
            "own, for BOQ → productivity → duration → resources → procurement → a fully integrated Primavera P6 "
            "baseline unless the data points above are also supplied."
        ),
    }


def analyze_schedule_evidence(documents: Sequence[Any], *, project_name: str = "") -> Dict[str, Any]:
    document_types = {document.sha256: _document_type(document) for document in documents}
    evidence: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    scalar_candidates: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    traceability: List[Dict[str, Any]] = []

    for requirement in REQUIREMENTS:
        seen: set[Tuple[str, str, str]] = set()
        for document in documents:
            language = _language(str(getattr(document, "text", "") or ""))
            for location, line in _segments(document):
                normalized_line = _normalize(line)
                if not _contains_term(normalized_line, requirement["terms"]):
                    continue
                key = (document.sha256, location, normalized_line)
                if key in seen:
                    continue
                seen.add(key)
                exact = location != "EXACT SOURCE LOCATION UNAVAILABLE"
                scalar = _scalar_value(requirement, line)
                status = "AVAILABLE" if exact else "UNVERIFIED"
                confidence = "High" if exact and scalar else "Medium" if exact else "Low"
                row = {
                    "Requirement": requirement["label"],
                    "Extracted Evidence": _short(line),
                    "Source Document": document.filename,
                    "Document Type": document_types[document.sha256],
                    "Source Reference": location,
                    "Language": language,
                    "Status": status,
                    "Confidence": confidence,
                }
                evidence[requirement["id"]].append(row)
                traceability.append({
                    "Data ID": f"{requirement['id']}-{len(evidence[requirement['id']]):03d}",
                    "Extracted Data": _short(line),
                    "File Name": document.filename,
                    "Document Type": document_types[document.sha256],
                    "Exact Source Location": location,
                    "Language": language,
                    "Status": status,
                })
                if scalar:
                    scalar_candidates[requirement["id"]].append({**row, "Value": scalar[0], "Canonical Value": scalar[1]})
                if len(evidence[requirement["id"]]) >= 80:
                    break

    conflicts: List[Dict[str, Any]] = []
    for requirement in REQUIREMENTS:
        candidates = scalar_candidates.get(requirement["id"], [])
        by_value: Dict[str, Dict[str, Any]] = {}
        for candidate in candidates:
            by_value.setdefault(candidate["Canonical Value"], candidate)
        if len(by_value) < 2:
            continue
        values = list(by_value.values())[:2]
        source_1, source_2 = values[0], values[1]
        conflict_id = f"C-{len(conflicts) + 1:03d}"
        conflicts.append({
            "Conflict ID": conflict_id,
            "Category": requirement["label"],
            "Source 1": source_1["Source Document"],
            "Source 1 Type": source_1["Document Type"],
            "Source 1 Location": source_1["Source Reference"],
            "Source 1 Requirement": source_1["Value"],
            "Source 2": source_2["Source Document"],
            "Source 2 Type": source_2["Document Type"],
            "Source 2 Location": source_2["Source Reference"],
            "Source 2 Requirement": source_2["Value"],
            "Conflict Description": f"Two different explicit values were found for {requirement['label']}.",
            "Conflict Cause": "CAUSE NOT CONFIRMED — USER REVIEW REQUIRED",
            "Schedule Impact": f"{requirement['label']} cannot be finalized for Schedule Builder until resolved.",
            "Criticality": requirement["priority"],
            "Status": "CONFLICTING — AWAITING USER DECISION",
            "Affected Outputs": [requirement["label"], "Schedule readiness", "Schedule Builder input"],
            "Options": [
                {"Option": "Option 1", "Decision": f"Apply Source 1: {source_1['Value']}", "Consequence": f"Use the value cited at {source_1['Source Reference']}."},
                {"Option": "Option 2", "Decision": f"Apply Source 2: {source_2['Value']}", "Consequence": f"Use the value cited at {source_2['Source Reference']}."},
                {"Option": "Option 3", "Decision": "Keep unresolved and request formal clarification", "Consequence": "Do not transfer this value to Schedule Builder until an approved instruction or clarification is received."},
            ],
        })

    conflict_ids = {conflict["Category"] for conflict in conflicts}
    master_summary: List[Dict[str, Any]] = []
    missing: List[Dict[str, Any]] = []
    for requirement in REQUIREMENTS:
        rows = evidence.get(requirement["id"], [])
        category_conflict = requirement["label"] in conflict_ids
        if category_conflict:
            status = "CONFLICTING"
        elif rows:
            status = rows[0]["Status"]
        else:
            status = "UNAVAILABLE"
        master_summary.append({
            "Requirement": requirement["label"],
            "Extracted Data": rows[0]["Extracted Evidence"] if rows else "UNAVAILABLE",
            "Source Document": rows[0]["Source Document"] if rows else "UNAVAILABLE",
            "Source Reference": rows[0]["Source Reference"] if rows else "EXACT SOURCE LOCATION UNAVAILABLE",
            "Status": status,
            "Confidence": rows[0]["Confidence"] if rows else "Not available",
        })
        if not rows:
            missing.append({
                "Missing Information": requirement["label"],
                "Why Required": "Required to create or validate the corresponding Primavera schedule input.",
                "Schedule Impact": "Schedule Builder input remains unavailable." if requirement["priority"] != "Critical" else "Reliable schedule generation is blocked.",
                "Priority": requirement["priority"],
                "Expected Source": requirement["source"],
                "Can Schedule Proceed?": "No" if requirement["priority"] == "Critical" else "Only with approved review or assumption",
                "Status": "UNAVAILABLE",
            })

    dynamic_groups: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for requirement in REQUIREMENTS:
        table = requirement.get("table")
        if table and evidence.get(requirement["id"]):
            dynamic_groups[table].extend(evidence[requirement["id"]])

    wbs_rows, activity_rows, logic_rows = _structured_schedule_rows(documents)
    dynamic_tables = [{"title": title, "rows": rows} for title, rows in dynamic_groups.items()]
    if wbs_rows:
        dynamic_tables.append({"title": "Evidence-Derived WBS", "rows": wbs_rows})
    if activity_rows:
        dynamic_tables.append({"title": "Evidence-Derived Activity Register", "rows": activity_rows})
    if logic_rows:
        dynamic_tables.append({"title": "Evidence-Derived Logic Register", "rows": logic_rows})

    document_register: List[Dict[str, Any]] = []
    languages: set[str] = set()
    unreadable = 0
    schedule_documents = 0
    for document in documents:
        text = str(getattr(document, "text", "") or "")
        language = _language(text)
        if language == "Arabic and English":
            languages.update({"Arabic", "English"})
        elif language != "Language not confirmed":
            languages.add(language)
        warnings = list(getattr(document, "warnings", []) or [])
        ocr_required = not text.strip() and any("OCR" in warning or "scanned/image-only" in warning for warning in warnings)
        has_data = any(row["Source Document"] == document.filename for rows in evidence.values() for row in rows)
        if ocr_required:
            status = "OCR REQUIRED — NOT ANALYZED"
            unreadable += 1
        elif text.strip() and has_data:
            status = "PARTIALLY ANALYZED"
            schedule_documents += 1
        elif text.strip():
            status = "NO SCHEDULE DATA IDENTIFIED"
        else:
            status = "UNSUPPORTED CONTENT — REVIEW REQUIRED"
            unreadable += 1
        document_register.append({
            "File": document.filename,
            "Detected Type": document_types[document.sha256],
            "Language": language,
            "Read Status": status,
            "Tables Extracted": len(getattr(document, "tables", []) or []),
            "Schedule Data Found": "Yes" if has_data else "No",
            "Issues": "; ".join(warnings) if warnings else "None",
            "SHA-256": document.sha256,
        })

    critical_missing = sum(1 for row in missing if row["Priority"] == "Critical")
    if critical_missing or conflicts or unreadable:
        readiness = "NOT READY"
    elif missing:
        readiness = "READY WITH ASSUMPTIONS"
    else:
        readiness = "READY"

    readiness_areas: List[Dict[str, Any]] = []
    area_map = {
        "Contract": ("project_name", "employer", "engineer", "contractor", "contract_number", "commencement_date", "time_for_completion", "completion_date", "letter_of_award", "tender_clarifications"),
        "Milestones and Calendar": ("milestones", "calendar"),
        "Scope, BOQ and Drawings": ("scope", "boq", "drawings", "geotechnical_report"),
        "Methodology and Specifications": ("specifications", "methodology", "work_fronts", "wbs_coding_structure"),
        "Engineering and Procurement": ("shop_drawings", "material_submittals", "document_transmittal_register", "submittal_procedure", "rfi_cycle", "review_durations", "procurement", "long_lead"),
        "Resources and Execution": ("resources", "productivity", "equipment", "site_logistics", "itp", "subcontractor_packages", "temporary_works"),
        "Testing and Handover": ("authority", "testing", "handover"),
        "Project Controls": ("constraints", "progress_measurement", "cost_loading", "resource_loading"),
    }
    for area, ids in area_map.items():
        found = sum(1 for item in ids if evidence.get(item))
        area_missing = sum(1 for item in ids if not evidence.get(item))
        area_conflicts = sum(1 for conflict in conflicts if any(req["id"] in ids and req["label"] == conflict["Category"] for req in REQUIREMENTS))
        completeness = round(found / len(ids) * 100) if ids else 0
        readiness_areas.append({
            "Area": area,
            "Completeness": f"{completeness}%",
            "Missing Inputs": area_missing,
            "Conflicts": area_conflicts,
            "Ready": "Review" if area_missing or area_conflicts else "Yes",
        })

    dashboard = {
        "Documents Uploaded": len(documents),
        "Documents With Schedule Data": schedule_documents,
        "Documents Requiring Review": unreadable,
        "Project": project_name or "Selected project",
        "Contract Duration": next((item["Value"] for item in scalar_candidates.get("time_for_completion", [])), "UNAVAILABLE"),
        "Contract Milestones Found": len(evidence.get("milestones", [])),
        "Evidence-Derived WBS Nodes": len(wbs_rows),
        "Evidence-Derived Activities": len(activity_rows),
        "Evidence-Derived Logic Links": len(logic_rows),
        "Missing Critical Inputs": critical_missing,
        "Conflicting Inputs": len(conflicts),
        "Unresolved Assumptions": 0,
    }

    return {
        "analyzer": "Schedule Evidence Analyzer",
        "project": project_name or "Selected project",
        "languages_detected": sorted(languages),
        "language_policy": "Arabic and English source wording is preserved. No machine translation is treated as contractual evidence.",
        "readiness_status": readiness,
        "schedule_builder_transfer_allowed": readiness == "READY",
        "dashboard": dashboard,
        "project_master_summary": master_summary,
        "must_have_data_check": [
            {
                "Required Schedule Input": req["label"],
                "Tender Schedule": SCHEDULE_STAGE_APPLICABILITY[req["id"]][0],
                "Detailed / Baseline": SCHEDULE_STAGE_APPLICABILITY[req["id"]][1],
                "Status": next((row["Status"] for row in master_summary if row["Requirement"] == req["label"]), "UNAVAILABLE"),
                "Source": next((row["Source Document"] for row in master_summary if row["Requirement"] == req["label"]), "UNAVAILABLE"),
            }
            for req in REQUIREMENTS if req["id"] in SCHEDULE_STAGE_APPLICABILITY
        ],
        "boq_completeness": assess_boq_completeness(documents),
        "drawing_register": assess_drawing_register(documents),
        "dynamic_tables": dynamic_tables,
        "conflicts": conflicts,
        "missing_information": missing,
        "source_traceability": traceability[:8000],
        "document_register": document_register,
        "readiness_table": readiness_areas,
        "schedule_builder_output": {
            "status": "BLOCKED" if readiness != "READY" else "READY FOR USER APPROVAL",
            "reason": "Critical missing, unreadable or conflicting evidence must be resolved first." if readiness != "READY" else "All controlled requirements were found; user approval remains mandatory.",
            "project_data": [row for row in master_summary if row["Status"] == "AVAILABLE"],
            "wbs": wbs_rows,
            "activities": activity_rows,
            "relationships": logic_rows,
        },
        "controls": [
            "The analyzer does not invent dates, durations, quantities, logic, clauses or page references.",
            "Scanned or unreadable files are not counted as analyzed evidence.",
            "Unresolved conflicts block affected Schedule Builder inputs.",
            "The master schedule is not changed by this analysis.",
            "Native Primavera P6 review and recalculation remain mandatory before reliance.",
        ],
    }
