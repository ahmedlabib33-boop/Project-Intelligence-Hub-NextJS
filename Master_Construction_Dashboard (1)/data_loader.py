"""
╔══════════════════════════════════════════════════════════════════════════════╗
║                    MASTER CONSTRUCTION DASHBOARD - DATA LOADER                ║
║              Intelligent Data Integration from JSON & Python Files            ║
╚══════════════════════════════════════════════════════════════════════════════╝

This module provides intelligent data loading capabilities that can:
1. Read data from JSON files (auto-detects structure)
2. Import data from other Python modules dynamically
3. Generate realistic sample data for demonstration
4. Validate and normalize data structures

AI Agent Integration Guide:
- Place your data-generating .py files in the same directory
- Export data as dictionaries or JSON files
- The loader will auto-detect and import everything
"""

import json
import os
import sys
import importlib.util
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional
import random

# ═══════════════════════════════════════════════════════════════════════════════
# DATA STRUCTURE DEFINITIONS (for AI reference)
# ═══════════════════════════════════════════════════════════════════════════════

"""
EXPECTED DATA STRUCTURES:

PROJECT_OVERVIEW = {
    "project_name": str,
    "project_code": str,
    "client": str,
    "contractor": str,
    "contract_value": float,
    "start_date": str,  # "YYYY-MM-DD"
    "finish_date": str,
    "actual_start": str,
    "actual_finish": str,
    "overall_progress": float,  # 0-100
    "status": str,  # "On Track", "At Risk", "Delayed"
    "health_score": float,  # 0-100
    "total_activities": int,
    "completed_activities": int,
    "total_manpower": int,
    "budget_utilized": float,
    "budget_remaining": float,
}

WBS_DATA = {
    "wbs_items": [
        {
            "id": str,
            "name": str,
            "parent_id": str or None,
            "level": int,
            "budget": float,
            "actual_cost": float,
            "progress": float,  # 0-100
            "status": str,
            "weight": float,  # relative weight
        }
    ]
}

ACTIVITIES_DATA = {
    "activities": [
        {
            "id": str,
            "name": str,
            "wbs_id": str,
            "start_date": str,
            "finish_date": str,
            "actual_start": str or None,
            "actual_finish": str or None,
            "duration": int,  # days
            "progress": float,
            "status": str,
            "resources": [str],
            "predecessors": [str],
            "critical_path": bool,
        }
    ]
}

MILESTONES_DATA = {
    "milestones": [
        {
            "id": str,
            "name": str,
            "planned_date": str,
            "actual_date": str or None,
            "forecast_date": str or None,
            "status": str,  # "Completed", "On Track", "Delayed"
            "weight": float,
            "description": str,
        }
    ]
}

S_CURVE_DATA = {
    "dates": [str],  # monthly or weekly dates
    "planned_progress": [float],  # cumulative
    "actual_progress": [float],  # cumulative
    "forecast_progress": [float],  # cumulative
}

EVM_DATA = {
    "dates": [str],
    "bcws": [float],  # Budgeted Cost of Work Scheduled (Planned Value)
    "bcwp": [float],  # Budgeted Cost of Work Performed (Earned Value)
    "acwp": [float],  # Actual Cost of Work Performed (Actual Cost)
    "spi": [float],   # Schedule Performance Index
    "cpi": [float],   # Cost Performance Index
    "sv": [float],    # Schedule Variance
    "cv": [float],    # Cost Variance
    "eac": [float],   # Estimate at Completion
    "etc": [float],   # Estimate to Complete
    "vac": [float],   # Variance at Completion
}

CONTRACTS_DATA = {
    "contracts": [
        {
            "id": str,
            "contract_no": str,
            "title": str,
            "contractor": str,
            "contract_value": float,
            "approved_variations": float,
            "total_value": float,
            "invoiced_to_date": float,
            "paid_to_date": float,
            "balance": float,
            "completion_percent": float,
            "status": str,
            "start_date": str,
            "finish_date": str,
            "retention": float,
        }
    ]
}

LETTERS_DATA = {
    "threads": [
        {
            "thread_id": str,
            "subject": str,
            "parties": [str],
            "letter_count": int,
            "last_date": str,
            "status": str,  # "Open", "Closed", "Pending Response"
            "priority": str,  # "High", "Medium", "Low"
            "category": str,  # "Technical", "Commercial", "Claim", "Variation"
            "summary": str,
            "letters": [
                {
                    "ref_no": str,
                    "date": str,
                    "from": str,
                    "to": str,
                    "subject": str,
                    "status": str,
                }
            ]
        }
    ]
}

RISKS_DATA = {
    "risks": [
        {
            "id": str,
            "description": str,
            "category": str,  # "Technical", "Commercial", "Schedule", "Safety", "External"
            "probability": int,  # 1-5
            "impact": int,  # 1-5
            "score": int,  # probability * impact
            "status": str,  # "Active", "Mitigated", "Closed", "Realized"
            "mitigation": str,
            "owner": str,
            "date_identified": str,
            "target_date": str,
        }
    ]
}

DELAY_DATA = {
    "delays": [
        {
            "id": str,
            "description": str,
            "type": str,  # "Excusable", "Non-Excusable", "Compensable", "Concurrent"
            "start_date": str,
            "end_date": str,
            "duration_days": int,
            "impact_days": int,
            "responsible_party": str,
            "status": str,  # "Active", "Resolved", "Disputed"
            "financial_impact": float,
            "mitigation": str,
        }
    ],
    "time_impact": {
        "original_completion": str,
        "current_forecast": str,
        "total_delay_days": int,
        "excusable_days": int,
        "non_excusable_days": int,
        "compensable_days": int,
        "concurrent_days": int,
        "recovery_plan": str,
    }
}
"""


# ═══════════════════════════════════════════════════════════════════════════════
# DATA LOADER CLASS
# ═══════════════════════════════════════════════════════════════════════════════

class ConstructionDataLoader:
    """
    Intelligent data loader for construction project data.

    Usage:
        loader = ConstructionDataLoader()
        data = loader.load_all()

    The loader will:
    1. Search for JSON files in the current directory
    2. Search for Python files that export data dictionaries
    3. Generate sample data if no sources found
    4. Merge and validate all data
    """

    def __init__(self, data_dir: str = "."):
        self.data_dir = data_dir
        self.data = {}
        self.sources = []

    def load_all(self) -> Dict[str, Any]:
        """Load all available data from all sources."""
        self._load_from_json()
        self._load_from_python_modules()

        if not self.data:
            print("⚠️ No external data found. Generating premium sample data for demonstration...")
            self.data = self._generate_sample_data()
            self.sources.append("generated_sample")

        return self.data

    def _load_from_json(self):
        """Auto-detect and load JSON files."""
        json_files = [f for f in os.listdir(self.data_dir) if f.endswith('.json')]

        for json_file in json_files:
            filepath = os.path.join(self.data_dir, json_file)
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    data = json.load(f)

                # Auto-detect data type from filename or content
                data_type = self._detect_data_type(json_file, data)
                if data_type:
                    self.data[data_type] = data
                    self.sources.append(f"json:{json_file}")
                    print(f"✅ Loaded {data_type} from {json_file}")
            except Exception as e:
                print(f"⚠️ Error loading {json_file}: {e}")

    def _load_from_python_modules(self):
        """Auto-detect and import data from Python modules."""
        py_files = [f for f in os.listdir(self.data_dir) 
                    if f.endswith('.py') and f not in ['master_dashboard.py', 'config.py', 'data_loader.py']]

        for py_file in py_files:
            filepath = os.path.join(self.data_dir, py_file)
            try:
                spec = importlib.util.spec_from_file_location("data_module", filepath)
                module = importlib.util.module_from_spec(spec)
                sys.modules["data_module"] = module
                spec.loader.exec_module(module)

                # Look for common data variable names
                data_vars = [
                    'project_data', 'project_overview', 'overview',
                    'wbs_data', 'wbs',
                    'activities_data', 'activities',
                    'milestones_data', 'milestones',
                    's_curve_data', 's_curve', 'progress_data',
                    'evm_data', 'evm', 'earned_value',
                    'contracts_data', 'contracts',
                    'letters_data', 'letters', 'correspondence',
                    'risks_data', 'risks',
                    'delay_data', 'delays', 'time_impact',
                ]

                for var_name in data_vars:
                    if hasattr(module, var_name):
                        data = getattr(module, var_name)
                        data_type = self._detect_data_type(py_file, data, var_name)
                        if data_type and data_type not in self.data:
                            self.data[data_type] = data
                            self.sources.append(f"py:{py_file}:{var_name}")
                            print(f"✅ Loaded {data_type} from {py_file}.{var_name}")

            except Exception as e:
                print(f"⚠️ Error importing {py_file}: {e}")

    def _detect_data_type(self, filename: str, data: Any, var_name: str = "") -> Optional[str]:
        """Intelligently detect the type of data based on filename and structure."""
        filename_lower = filename.lower()
        var_lower = var_name.lower()

        # Check filename hints
        if any(x in filename_lower for x in ['overview', 'project', 'general']):
            return "overview"
        if any(x in filename_lower for x in ['wbs', 'breakdown']):
            return "wbs"
        if any(x in filename_lower for x in ['activity', 'task']):
            return "activities"
        if any(x in filename_lower for x in ['milestone']):
            return "milestones"
        if any(x in filename_lower for x in ['s_curve', 'scurve', 'progress_curve']):
            return "s_curve"
        if any(x in filename_lower for x in ['evm', 'earned', 'value']):
            return "evm"
        if any(x in filename_lower for x in ['contract']):
            return "contracts"
        if any(x in filename_lower for x in ['letter', 'correspondence', 'communication']):
            return "letters"
        if any(x in filename_lower for x in ['risk']):
            return "risks"
        if any(x in filename_lower for x in ['delay', 'impact', 'time']):
            return "delay"

        # Check variable name hints
        if any(x in var_lower for x in ['overview', 'project']):
            return "overview"
        if any(x in var_lower for x in ['wbs']):
            return "wbs"
        if any(x in var_lower for x in ['activity']):
            return "activities"
        if any(x in var_lower for x in ['milestone']):
            return "milestones"
        if any(x in var_lower for x in ['s_curve', 'scurve', 'progress']):
            return "s_curve"
        if any(x in var_lower for x in ['evm', 'earned']):
            return "evm"
        if any(x in var_lower for x in ['contract']):
            return "contracts"
        if any(x in var_lower for x in ['letter', 'correspondence']):
            return "letters"
        if any(x in var_lower for x in ['risk']):
            return "risks"
        if any(x in var_lower for x in ['delay', 'impact']):
            return "delay"

        # Check data structure hints
        if isinstance(data, dict):
            keys = [k.lower() for k in data.keys()]
            if 'project_name' in keys or 'contract_value' in keys:
                return "overview"
            if 'wbs_items' in keys or 'work_packages' in keys:
                return "wbs"
            if 'activities' in keys or 'tasks' in keys:
                return "activities"
            if 'milestones' in keys:
                return "milestones"
            if 'planned_progress' in keys or 'actual_progress' in keys:
                return "s_curve"
            if 'bcws' in keys or 'bcwp' in keys or 'spi' in keys:
                return "evm"
            if 'contracts' in keys:
                return "contracts"
            if 'threads' in keys or 'letters' in keys:
                return "letters"
            if 'risks' in keys:
                return "risks"
            if 'delays' in keys or 'time_impact' in keys:
                return "delay"

        return None

    # ═══════════════════════════════════════════════════════════════════════════
    # PREMIUM SAMPLE DATA GENERATOR (for demonstration)
    # ═══════════════════════════════════════════════════════════════════════════

    def _generate_sample_data(self) -> Dict[str, Any]:
        """Generate realistic, premium sample data for demonstration."""
        data = {}
        data["overview"] = self._generate_overview()
        data["wbs"] = self._generate_wbs()
        data["activities"] = self._generate_activities()
        data["milestones"] = self._generate_milestones()
        data["s_curve"] = self._generate_s_curve()
        data["evm"] = self._generate_evm()
        data["contracts"] = self._generate_contracts()
        data["letters"] = self._generate_letters()
        data["risks"] = self._generate_risks()
        data["delay"] = self._generate_delay()
        return data

    def _generate_overview(self) -> Dict:
        return {
            "project_name": "ICONIC TOWER - Mixed Use Development",
            "project_code": "IT-2024-001",
            "client": "Royal Development Authority",
            "contractor": "Elite Construction Consortium",
            "contract_value": 850000000.0,
            "start_date": "2023-01-15",
            "finish_date": "2026-12-31",
            "actual_start": "2023-01-20",
            "actual_finish": None,
            "overall_progress": 68.5,
            "status": "On Track",
            "health_score": 82.0,
            "total_activities": 1247,
            "completed_activities": 853,
            "total_manpower": 2847,
            "budget_utilized": 582250000.0,
            "budget_remaining": 267750000.0,
            "project_manager": "Eng. Alexander Sterling",
            "location": "Dubai Marina District, UAE",
            "description": "A 75-story mixed-use tower featuring luxury residences, premium offices, and world-class retail spaces with a total built-up area of 285,000 sqm.",
        }

    def _generate_wbs(self) -> Dict:
        wbs_items = [
            {"id": "1.0", "name": "ICONIC TOWER", "parent_id": None, "level": 0, "budget": 850000000, "actual_cost": 582250000, "progress": 68.5, "status": "On Track", "weight": 100.0},
            {"id": "1.1", "name": "Pre-Construction & Mobilization", "parent_id": "1.0", "level": 1, "budget": 42500000, "actual_cost": 42500000, "progress": 100.0, "status": "Completed", "weight": 5.0},
            {"id": "1.2", "name": "Foundation & Substructure", "parent_id": "1.0", "level": 1, "budget": 127500000, "actual_cost": 127500000, "progress": 100.0, "status": "Completed", "weight": 15.0},
            {"id": "1.3", "name": "Superstructure (Core & Shell)", "parent_id": "1.0", "level": 1, "budget": 255000000, "actual_cost": 216750000, "progress": 85.0, "status": "On Track", "weight": 30.0},
            {"id": "1.4", "name": "MEP Systems", "parent_id": "1.0", "level": 1, "budget": 170000000, "actual_cost": 93500000, "progress": 55.0, "status": "On Track", "weight": 20.0},
            {"id": "1.5", "name": "Interior Fit-Out & Finishes", "parent_id": "1.0", "level": 1, "budget": 127500000, "actual_cost": 38250000, "progress": 30.0, "status": "At Risk", "weight": 15.0},
            {"id": "1.6", "name": "External Works & Landscaping", "parent_id": "1.0", "level": 1, "budget": 42500000, "actual_cost": 8500000, "progress": 20.0, "status": "On Track", "weight": 5.0},
            {"id": "1.7", "name": "Testing, Commissioning & Handover", "parent_id": "1.0", "level": 1, "budget": 85000000, "actual_cost": 0, "progress": 0.0, "status": "Planned", "weight": 10.0},

            {"id": "1.3.1", "name": "Concrete Core (Levels B3-75)", "parent_id": "1.3", "level": 2, "budget": 153000000, "actual_cost": 137700000, "progress": 90.0, "status": "On Track", "weight": 18.0},
            {"id": "1.3.2", "name": "Structural Steel Frame", "parent_id": "1.3", "level": 2, "budget": 76500000, "actual_cost": 61200000, "progress": 80.0, "status": "On Track", "weight": 9.0},
            {"id": "1.3.3", "name": "Curtain Wall & Facade", "parent_id": "1.3", "level": 2, "budget": 25500000, "actual_cost": 17850000, "progress": 70.0, "status": "At Risk", "weight": 3.0},

            {"id": "1.4.1", "name": "Electrical Systems", "parent_id": "1.4", "level": 2, "budget": 59500000, "actual_cost": 32725000, "progress": 55.0, "status": "On Track", "weight": 7.0},
            {"id": "1.4.2", "name": "HVAC Systems", "parent_id": "1.4", "level": 2, "budget": 59500000, "actual_cost": 35700000, "progress": 60.0, "status": "On Track", "weight": 7.0},
            {"id": "1.4.3", "name": "Plumbing & Drainage", "parent_id": "1.4", "level": 2, "budget": 34000000, "actual_cost": 17000000, "progress": 50.0, "status": "On Track", "weight": 4.0},
            {"id": "1.4.4", "name": "Fire Protection & Safety", "parent_id": "1.4", "level": 2, "budget": 17000000, "actual_cost": 8075000, "progress": 47.5, "status": "Delayed", "weight": 2.0},
        ]
        return {"wbs_items": wbs_items}

    def _generate_activities(self) -> Dict:
        activities = [
            {"id": "A001", "name": "Site Mobilization & Setup", "wbs_id": "1.1", "start_date": "2023-01-20", "finish_date": "2023-03-15", "actual_start": "2023-01-20", "actual_finish": "2023-03-10", "duration": 55, "progress": 100.0, "status": "Completed", "resources": ["Site Team", "Equipment"], "predecessors": [], "critical_path": True},
            {"id": "A002", "name": "Piling & Deep Foundation", "wbs_id": "1.2", "start_date": "2023-03-20", "finish_date": "2023-08-30", "actual_start": "2023-03-20", "actual_finish": "2023-08-25", "duration": 164, "progress": 100.0, "status": "Completed", "resources": ["Piling Crew", "Cranes"], "predecessors": ["A001"], "critical_path": True},
            {"id": "A003", "name": "Basement Construction (B3-B1)", "wbs_id": "1.2", "start_date": "2023-09-05", "finish_date": "2024-01-30", "actual_start": "2023-09-05", "actual_finish": "2024-01-25", "duration": 148, "progress": 100.0, "status": "Completed", "resources": ["Concrete Team", "Formwork"], "predecessors": ["A002"], "critical_path": True},
            {"id": "A004", "name": "Core Construction (Levels 1-25)", "wbs_id": "1.3.1", "start_date": "2024-02-05", "finish_date": "2024-10-30", "actual_start": "2024-02-05", "actual_finish": "2024-10-25", "duration": 269, "progress": 100.0, "status": "Completed", "resources": ["Core Team", "Climbing Formwork"], "predecessors": ["A003"], "critical_path": True},
            {"id": "A005", "name": "Core Construction (Levels 26-50)", "wbs_id": "1.3.1", "start_date": "2024-11-05", "finish_date": "2025-06-30", "actual_start": "2024-11-05", "actual_finish": None, "duration": 238, "progress": 92.0, "status": "On Track", "resources": ["Core Team"], "predecessors": ["A004"], "critical_path": True},
            {"id": "A006", "name": "Core Construction (Levels 51-75)", "wbs_id": "1.3.1", "start_date": "2025-07-05", "finish_date": "2026-01-30", "actual_start": None, "actual_finish": None, "duration": 210, "progress": 0.0, "status": "Planned", "resources": ["Core Team"], "predecessors": ["A005"], "critical_path": True},
            {"id": "A007", "name": "Steel Frame Erection (Levels 1-40)", "wbs_id": "1.3.2", "start_date": "2024-06-01", "finish_date": "2025-04-30", "actual_start": "2024-06-01", "actual_finish": None, "duration": 334, "progress": 78.0, "status": "On Track", "resources": ["Steel Crew", "Tower Cranes"], "predecessors": ["A004"], "critical_path": False},
            {"id": "A008", "name": "Curtain Wall Installation (Levels 1-30)", "wbs_id": "1.3.3", "start_date": "2024-10-01", "finish_date": "2025-08-30", "actual_start": "2024-10-15", "actual_finish": None, "duration": 334, "progress": 45.0, "status": "At Risk", "resources": ["Facade Team", "Gondolas"], "predecessors": ["A007"], "critical_path": False},
            {"id": "A009", "name": "MEP Rough-in (Levels 1-25)", "wbs_id": "1.4", "start_date": "2024-08-01", "finish_date": "2025-03-30", "actual_start": "2024-08-01", "actual_finish": None, "duration": 242, "progress": 65.0, "status": "On Track", "resources": ["MEP Crew"], "predecessors": ["A004"], "critical_path": False},
            {"id": "A010", "name": "Interior Fit-Out (Levels 1-15)", "wbs_id": "1.5", "start_date": "2025-01-15", "finish_date": "2025-10-30", "actual_start": "2025-02-01", "actual_finish": None, "duration": 289, "progress": 25.0, "status": "At Risk", "resources": ["Fit-Out Team"], "predecessors": ["A009"], "critical_path": False},
            {"id": "A011", "name": "Fire Protection Installation", "wbs_id": "1.4.4", "start_date": "2024-09-01", "finish_date": "2025-08-30", "actual_start": "2024-09-15", "actual_finish": None, "duration": 364, "progress": 40.0, "status": "Delayed", "resources": ["Fire Safety Team"], "predecessors": ["A004"], "critical_path": False},
            {"id": "A012", "name": "External Works & Hardscape", "wbs_id": "1.6", "start_date": "2025-10-01", "finish_date": "2026-06-30", "actual_start": None, "actual_finish": None, "duration": 273, "progress": 0.0, "status": "Planned", "resources": ["Landscape Team"], "predecessors": ["A003"], "critical_path": False},
        ]
        return {"activities": activities}

    def _generate_milestones(self) -> Dict:
        milestones = [
            {"id": "M001", "name": "Project Kick-off & Mobilization", "planned_date": "2023-01-15", "actual_date": "2023-01-20", "forecast_date": "2023-01-20", "status": "Completed", "weight": 5.0, "description": "Site mobilization complete, all permits secured"},
            {"id": "M002", "name": "Foundation Completion", "planned_date": "2024-01-30", "actual_date": "2024-01-25", "forecast_date": "2024-01-25", "status": "Completed", "weight": 15.0, "description": "All piling, raft foundation and basement works complete"},
            {"id": "M003", "name": "25th Floor Core Completion", "planned_date": "2024-10-30", "actual_date": "2024-10-25", "forecast_date": "2024-10-25", "status": "Completed", "weight": 15.0, "description": "Concrete core construction up to level 25"},
            {"id": "M004", "name": "50th Floor Core Completion", "planned_date": "2025-06-30", "actual_date": None, "forecast_date": "2025-07-05", "status": "On Track", "weight": 15.0, "description": "Concrete core construction up to level 50"},
            {"id": "M005", "name": "Structural Topping Out", "planned_date": "2025-10-30", "actual_date": None, "forecast_date": "2025-11-15", "status": "At Risk", "weight": 10.0, "description": "Final structural level completion (Level 75)"},
            {"id": "M006", "name": "MEP Systems Commissioning", "planned_date": "2026-06-30", "actual_date": None, "forecast_date": "2026-07-15", "status": "On Track", "weight": 10.0, "description": "All MEP systems tested and commissioned"},
            {"id": "M007", "name": "Practical Completion", "planned_date": "2026-12-31", "actual_date": None, "forecast_date": "2027-01-15", "status": "At Risk", "weight": 20.0, "description": "Project handover to client"},
            {"id": "M008", "name": "Final Handover & Closeout", "planned_date": "2027-03-31", "actual_date": None, "forecast_date": "2027-04-15", "status": "Planned", "weight": 10.0, "description": "Final documentation, snagging complete, project closed"},
        ]
        return {"milestones": milestones}

    def _generate_s_curve(self) -> Dict:
        dates = []
        planned = []
        actual = []
        forecast = []

        base_date = datetime(2023, 1, 15)
        for i in range(48):  # 48 months
            date = base_date + timedelta(days=30*i)
            dates.append(date.strftime("%Y-%m-%d"))

            # S-curve formula: logistic function
            t = i / 48.0
            planned_val = 100 / (1 + pow(2.71828, -8*(t - 0.5)))
            planned.append(round(planned_val, 2))

            # Actual with some realistic lag
            if i < 30:
                actual_val = planned_val * (0.95 + random.uniform(-0.05, 0.02))
            else:
                actual_val = planned_val * (0.92 + random.uniform(-0.03, 0.01))
            actual.append(round(max(0, min(100, actual_val)), 2))

            # Forecast continues from actual
            if i < 30:
                forecast.append(round(actual_val, 2))
            else:
                forecast_val = planned_val * (0.95 + random.uniform(-0.02, 0.03))
                forecast.append(round(max(actual[-1], min(100, forecast_val)), 2))

        return {
            "dates": dates,
            "planned_progress": planned,
            "actual_progress": actual,
            "forecast_progress": forecast,
        }

    def _generate_evm(self) -> Dict:
        dates = []
        bcws = []
        bcwp = []
        acwp = []
        spi = []
        cpi = []

        base_date = datetime(2023, 1, 15)
        total_budget = 850000000

        for i in range(36):  # 36 months
            date = base_date + timedelta(days=30*i)
            dates.append(date.strftime("%Y-%m-%d"))

            t = i / 36.0
            # Planned value (BCWS) - S-curve distribution
            planned_cum = total_budget / (1 + pow(2.71828, -8*(t - 0.5)))
            bcws.append(round(planned_cum, 2))

            # Earned value (BCWP) - slightly behind planned
            if i < 24:
                earned_cum = planned_cum * (0.96 + random.uniform(-0.04, 0.01))
            else:
                earned_cum = planned_cum * (0.93 + random.uniform(-0.03, 0.01))
            bcwp.append(round(max(0, earned_cum), 2))

            # Actual cost (ACWP) - slightly over budget
            actual_cum = earned_cum * (1.02 + random.uniform(-0.02, 0.04))
            acwp.append(round(actual_cum, 2))

            # Calculate indices
            spi_val = earned_cum / planned_cum if planned_cum > 0 else 1.0
            cpi_val = earned_cum / actual_cum if actual_cum > 0 else 1.0
            spi.append(round(spi_val, 3))
            cpi.append(round(cpi_val, 3))

        sv = [round(bcwp[i] - bcws[i], 2) for i in range(len(bcws))]
        cv = [round(bcwp[i] - acwp[i], 2) for i in range(len(acwp))]
        eac = [round(total_budget / cpi[i], 2) if cpi[i] > 0 else total_budget for i in range(len(cpi))]
        etc = [round(eac[i] - acwp[i], 2) for i in range(len(eac))]
        vac = [round(total_budget - eac[i], 2) for i in range(len(eac))]

        return {
            "dates": dates,
            "bcws": bcws,
            "bcwp": bcwp,
            "acwp": acwp,
            "spi": spi,
            "cpi": cpi,
            "sv": sv,
            "cv": cv,
            "eac": eac,
            "etc": etc,
            "vac": vac,
        }

    def _generate_contracts(self) -> Dict:
        contracts = [
            {"id": "C001", "contract_no": "IT-MAIN-2023", "title": "Main Construction Contract", "contractor": "Elite Construction Consortium", "contract_value": 680000000, "approved_variations": 12500000, "total_value": 692500000, "invoiced_to_date": 465000000, "paid_to_date": 441750000, "balance": 250750000, "completion_percent": 68.5, "status": "Active", "start_date": "2023-01-15", "finish_date": "2026-12-31", "retention": 34625000},
            {"id": "C002", "contract_no": "IT-MEP-2023", "title": "MEP Engineering & Installation", "contractor": "Premier MEP Solutions LLC", "contract_value": 170000000, "approved_variations": 3400000, "total_value": 173400000, "invoiced_to_date": 86700000, "paid_to_date": 82365000, "balance": 91035000, "completion_percent": 50.0, "status": "Active", "start_date": "2023-06-01", "finish_date": "2026-09-30", "retention": 8670000},
            {"id": "C003", "contract_no": "IT-FACADE-2024", "title": "Curtain Wall & Facade Systems", "contractor": "GlassTech Facade International", "contract_value": 85000000, "approved_variations": 0, "total_value": 85000000, "invoiced_to_date": 29750000, "paid_to_date": 28262500, "balance": 56737500, "completion_percent": 35.0, "status": "Active", "start_date": "2024-03-01", "finish_date": "2026-06-30", "retention": 4250000},
            {"id": "C004", "contract_no": "IT-ELV-2024", "title": "Elevator Supply & Installation", "contractor": "KONE Elevators Middle East", "contract_value": 42000000, "approved_variations": 0, "total_value": 42000000, "invoiced_to_date": 12600000, "paid_to_date": 11970000, "balance": 30030000, "completion_percent": 30.0, "status": "Active", "start_date": "2024-06-01", "finish_date": "2026-08-30", "retention": 2100000},
            {"id": "C005", "contract_no": "IT-FIT-2025", "title": "Interior Fit-Out Package", "contractor": "Luxury Interiors Group", "contract_value": 95000000, "approved_variations": 0, "total_value": 95000000, "invoiced_to_date": 14250000, "paid_to_date": 13537500, "balance": 81462500, "completion_percent": 15.0, "status": "Active", "start_date": "2025-01-15", "finish_date": "2026-11-30", "retention": 4750000},
        ]
        return {"contracts": contracts}

    def _generate_letters(self) -> Dict:
        threads = [
            {
                "thread_id": "LT-001",
                "subject": "Extension of Time Claim - MEP Coordination Delays",
                "parties": ["Elite Construction Consortium", "Royal Development Authority"],
                "letter_count": 8,
                "last_date": "2025-06-15",
                "status": "Open",
                "priority": "High",
                "category": "Claim",
                "summary": "Contractor claims 45-day EOT due to delayed MEP shop drawings approval and coordination issues affecting Levels 35-50. Supporting documentation submitted including revised CPM schedule and delay analysis.",
                "letters": [
                    {"ref_no": "ECC-LET-2025-142", "date": "2025-05-01", "from": "Elite Construction", "to": "Client", "subject": "Notice of Delay - MEP Coordination", "status": "Acknowledged"},
                    {"ref_no": "RDA-LET-2025-089", "date": "2025-05-10", "from": "Client", "to": "Elite Construction", "subject": "Re: Notice of Delay - Request for Details", "status": "Responded"},
                    {"ref_no": "ECC-LET-2025-156", "date": "2025-05-25", "from": "Elite Construction", "to": "Client", "subject": "Detailed EOT Claim Submission", "status": "Under Review"},
                    {"ref_no": "ECC-LET-2025-168", "date": "2025-06-15", "from": "Elite Construction", "to": "Client", "subject": "Follow-up: EOT Claim Status", "status": "Pending Response"},
                ]
            },
            {
                "thread_id": "LT-002",
                "subject": "Curtain Wall Glass Specification Change - Performance Requirements",
                "parties": ["GlassTech Facade", "Royal Development Authority", "Elite Construction Consortium"],
                "letter_count": 5,
                "last_date": "2025-06-20",
                "status": "Open",
                "priority": "High",
                "category": "Technical",
                "summary": "Client requested upgrade to triple-glazed low-E glass with enhanced thermal performance (U-value 0.8 W/m²K). GlassTech submitted revised proposal with 12% cost increase. Awaiting client decision on variation order.",
                "letters": [
                    {"ref_no": "RDA-LET-2025-095", "date": "2025-05-20", "from": "Client", "to": "All Parties", "subject": "Glass Specification Upgrade Request", "status": "Acknowledged"},
                    {"ref_no": "GTF-LET-2025-042", "date": "2025-06-01", "from": "GlassTech", "to": "Client", "subject": "Revised Proposal - Triple Glazed System", "status": "Under Review"},
                    {"ref_no": "ECC-LET-2025-175", "date": "2025-06-10", "from": "Elite Construction", "to": "Client", "subject": "Impact Assessment - Glass Change on Schedule", "status": "Pending Response"},
                    {"ref_no": "GTF-LET-2025-048", "date": "2025-06-20", "from": "GlassTech", "to": "Client", "subject": "Clarification on Glass Performance Testing", "status": "Pending Response"},
                ]
            },
            {
                "thread_id": "LT-003",
                "subject": "Fire Protection System - Authority Approval Pending",
                "parties": ["Premier MEP Solutions", "Civil Defense Authority", "Elite Construction Consortium"],
                "letter_count": 6,
                "last_date": "2025-06-25",
                "status": "Open",
                "priority": "High",
                "category": "Commercial",
                "summary": "Civil Defense Authority raised concerns about fire suppression coverage in atrium areas. Required redesign of sprinkler layout and additional smoke extraction fans. Potential 3-week delay and $850K cost impact.",
                "letters": [
                    {"ref_no": "CDF-LET-2025-012", "date": "2025-05-15", "from": "Civil Defense", "to": "Premier MEP", "subject": "Fire System Review - Atrium Coverage", "status": "Acknowledged"},
                    {"ref_no": "PMS-LET-2025-067", "date": "2025-05-25", "from": "Premier MEP", "to": "Civil Defense", "subject": "Revised Fire Protection Design", "status": "Under Review"},
                    {"ref_no": "ECC-LET-2025-162", "date": "2025-06-05", "from": "Elite Construction", "to": "Client", "subject": "Impact Notification - Fire System Redesign", "status": "Pending Response"},
                    {"ref_no": "PMS-LET-2025-073", "date": "2025-06-25", "from": "Premier MEP", "to": "Civil Defense", "subject": "Additional Clarifications - Smoke Extraction", "status": "Pending Response"},
                ]
            },
        ]
        return {"threads": threads}

    def _generate_risks(self) -> Dict:
        risks = [
            {"id": "R001", "description": "Curtain wall installation delays due to glass supply chain disruption from European manufacturer", "category": "External", "probability": 4, "impact": 5, "score": 20, "status": "Active", "mitigation": "Identified alternative supplier in Asia. Expedited shipping arranged. 3-week buffer built into schedule.", "owner": "Project Director", "date_identified": "2025-01-10", "target_date": "2025-09-30"},
            {"id": "R002", "description": "MEP coordination clashes in congested ceiling spaces causing rework and schedule impact", "category": "Technical", "probability": 4, "impact": 4, "score": 16, "status": "Active", "mitigation": "BIM clash detection implemented weekly. Dedicated coordination meetings held every Tuesday. Prefabrication strategy adopted.", "owner": "MEP Manager", "date_identified": "2024-08-15", "target_date": "2025-12-31"},
            {"id": "R003", "description": "Skilled labor shortage affecting concrete core construction cycle time", "category": "External", "probability": 3, "impact": 4, "score": 12, "status": "Mitigated", "mitigation": "Subcontracted specialized climbing formwork crew from international pool. Training program initiated for local workforce.", "owner": "Construction Manager", "date_identified": "2024-03-20", "target_date": "2025-06-30"},
            {"id": "R004", "description": "Client-requested design changes to penthouse layout affecting structural and MEP design", "category": "Commercial", "probability": 3, "impact": 5, "score": 15, "status": "Active", "mitigation": "Change control board established. All changes evaluated for time/cost impact before approval. Design reserve fund allocated.", "owner": "Contracts Manager", "date_identified": "2025-04-01", "target_date": "2025-08-15"},
            {"id": "R005", "description": "Extreme summer temperatures affecting concrete curing and worker productivity", "category": "External", "probability": 4, "impact": 3, "score": 12, "status": "Mitigated", "mitigation": "Night shift concrete pouring approved. Cooling systems installed. Hydration stations established across site.", "owner": "HSE Manager", "date_identified": "2024-05-01", "target_date": "2025-10-15"},
            {"id": "R006", "description": "Currency fluctuation (USD/EUR) impacting imported material costs by 8-12%", "category": "Commercial", "probability": 3, "impact": 3, "score": 9, "status": "Active", "mitigation": "Forward exchange contracts secured for 60% of forecasted imports. Local sourcing increased where feasible.", "owner": "Finance Controller", "date_identified": "2024-06-10", "target_date": "2026-03-31"},
            {"id": "R007", "description": "Adjacent metro construction causing vibration concerns for foundation monitoring", "category": "External", "probability": 2, "impact": 4, "score": 8, "status": "Active", "mitigation": "Real-time vibration monitoring system installed. Weekly geotechnical surveys. Coordination meetings with metro contractor.", "owner": "Structural Engineer", "date_identified": "2024-02-15", "target_date": "2025-12-31"},
            {"id": "R008", "description": "Permit delays for crane erection in dense urban environment", "category": "External", "probability": 3, "impact": 3, "score": 9, "status": "Mitigated", "mitigation": "Early engagement with municipality. Pre-approved crane locations. Alternative lifting methodology prepared.", "owner": "Planning Manager", "date_identified": "2023-11-01", "target_date": "2025-06-30"},
        ]
        return {"risks": risks}

    def _generate_delay(self) -> Dict:
        delays = [
            {"id": "D001", "description": "MEP shop drawing approval delays from consultant (8 weeks)", "type": "Excusable", "start_date": "2025-03-01", "end_date": "2025-04-26", "duration_days": 56, "impact_days": 45, "responsible_party": "Client / Consultant", "status": "Resolved", "financial_impact": 0, "mitigation": "EOT granted. No compensation approved."},
            {"id": "D002", "description": "Curtain wall glass supply chain disruption (European supplier)", "type": "Excusable", "start_date": "2025-04-15", "end_date": "2025-05-30", "duration_days": 45, "impact_days": 35, "responsible_party": "External / Force Majeure", "status": "Active", "financial_impact": 1250000, "mitigation": "Alternative Asian supplier engaged. Air freight for critical panels."},
            {"id": "D003", "description": "Fire protection system redesign required by Civil Defense Authority", "type": "Compensable", "start_date": "2025-05-15", "end_date": "2025-07-15", "duration_days": 61, "impact_days": 21, "responsible_party": "Client (Authority Requirement)", "status": "Active", "financial_impact": 850000, "mitigation": "Redesign underway. Parallel procurement of additional equipment."},
            {"id": "D004", "description": "Concrete supply shortage during peak summer demand", "type": "Non-Excusable", "start_date": "2025-05-01", "end_date": "2025-05-20", "duration_days": 20, "impact_days": 12, "responsible_party": "Contractor", "status": "Resolved", "financial_impact": -450000, "mitigation": "LDs applied. Additional supplier contracted. Night pouring implemented."},
            {"id": "D005", "description": "Concurrent delays: MEP coordination + facade installation overlap", "type": "Concurrent", "start_date": "2025-06-01", "end_date": "2025-06-30", "duration_days": 30, "impact_days": 18, "responsible_party": "Both Parties", "status": "Disputed", "financial_impact": 0, "mitigation": "Time impact analysis prepared. Awaiting dispute resolution board decision."},
        ]

        time_impact = {
            "original_completion": "2026-12-31",
            "current_forecast": "2027-01-15",
            "total_delay_days": 131,
            "excusable_days": 80,
            "non_excusable_days": 12,
            "compensable_days": 21,
            "concurrent_days": 18,
            "recovery_plan": "Accelerated interior fit-out sequencing. Additional manpower deployment (150 workers). Extended working hours (6-day week, 10-hour shifts). Fast-track MEP commissioning approach.",
        }

        return {"delays": delays, "time_impact": time_impact}


# ═══════════════════════════════════════════════════════════════════════════════
# HELPER FUNCTIONS
# ═══════════════════════════════════════════════════════════════════════════════

def load_construction_data(data_dir: str = ".") -> Dict[str, Any]:
    """
    Main entry point for loading all construction project data.

    Args:
        data_dir: Directory to search for data files (default: current directory)

    Returns:
        Dictionary containing all project data sections
    """
    loader = ConstructionDataLoader(data_dir)
    return loader.load_all()


def format_currency(value: float, currency: str = "USD") -> str:
    """Format value as currency with premium styling."""
    if value >= 1_000_000_000:
        return f"{currency} {value/1_000_000_000:.2f}B"
    elif value >= 1_000_000:
        return f"{currency} {value/1_000_000:.1f}M"
    elif value >= 1_000:
        return f"{currency} {value/1_000:.0f}K"
    else:
        return f"{currency} {value:,.0f}"


def format_percentage(value: float, decimals: int = 1) -> str:
    """Format value as percentage."""
    return f"{value:.{decimals}f}%"


def days_between(date1_str: str, date2_str: str) -> int:
    """Calculate days between two date strings."""
    d1 = datetime.strptime(date1_str, "%Y-%m-%d")
    d2 = datetime.strptime(date2_str, "%Y-%m-%d")
    return (d2 - d1).days
