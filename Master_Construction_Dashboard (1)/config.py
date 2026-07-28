"""
╔══════════════════════════════════════════════════════════════════════════════╗
║                    MASTER CONSTRUCTION DASHBOARD - CONFIG                    ║
║                         Premium Theme & Global Settings                       ║
╚══════════════════════════════════════════════════════════════════════════════╝

This module defines the premium visual theme, color palette, and global 
configuration for the Master Dashboard. All styling tokens are centralized 
here for easy customization by any AI agent or developer.

Color Philosophy:
- Deep Navy: Authority, trust, professionalism (construction industry standard)
- Liquid Gold: Excellence, premium quality, achievement
- Emerald Glow: Success, on-track indicators, growth
- Rose Alert: Critical attention, risks, delays
- Sapphire: Information, contracts, milestones
- Pearl: Clarity, readability, elegance
"""

import plotly.graph_objects as go
import plotly.express as px
from plotly.subplots import make_subplots

# ═══════════════════════════════════════════════════════════════════════════════
# PREMIUM COLOR PALETTE - Elite Tier
# ═══════════════════════════════════════════════════════════════════════════════
COLORS = {
    # Backgrounds
    "bg_dark": "#0a0e27",           # Deep cosmic navy - main background
    "bg_card": "rgba(15, 23, 42, 0.85)",  # Glassmorphism card background
    "bg_card_hover": "rgba(15, 23, 42, 0.95)",
    "bg_section": "rgba(30, 41, 59, 0.6)",

    # Primary Accents
    "gold": "#f59e0b",              # Liquid gold - premium highlight
    "gold_light": "#fbbf24",        # Soft gold
    "gold_dark": "#d97706",         # Deep amber

    # Status Colors
    "emerald": "#10b981",           # Success / On Track
    "emerald_glow": "rgba(16, 185, 129, 0.3)",
    "rose": "#f43f5e",              # Critical / Delayed
    "rose_glow": "rgba(244, 63, 94, 0.3)",
    "amber": "#f59e0b",             # Warning / At Risk
    "sapphire": "#3b82f6",          # Info / Milestones
    "violet": "#8b5cf6",            # Contracts / Special
    "cyan": "#06b6d4",              # Activities / Fresh

    # Text
    "text_primary": "#f8fafc",      # Pearl white
    "text_secondary": "#94a3b8",    # Soft slate
    "text_muted": "#64748b",        # Muted slate

    # Borders & Dividers
    "border": "rgba(148, 163, 184, 0.15)",
    "border_gold": "rgba(245, 158, 11, 0.4)",

    # Gradients (for charts)
    "gradient_gold": ["#f59e0b", "#fbbf24", "#fcd34d"],
    "gradient_emerald": ["#059669", "#10b981", "#34d399"],
    "gradient_rose": ["#e11d48", "#f43f5e", "#fb7185"],
    "gradient_sapphire": ["#2563eb", "#3b82f6", "#60a5fa"],
    "gradient_violet": ["#7c3aed", "#8b5cf6", "#a78bfa"],
}

# ═══════════════════════════════════════════════════════════════════════════════
# CHART TEMPLATES - Premium Plotly Configuration
# ═══════════════════════════════════════════════════════════════════════════════

def get_premium_template():
    """Returns a premium Plotly template with dark theme."""
    return dict(
        layout=dict(
            paper_bgcolor="rgba(0,0,0,0)",
            plot_bgcolor="rgba(0,0,0,0)",
            font=dict(family="Inter, Segoe UI, sans-serif", color=COLORS["text_primary"]),
            title=dict(font=dict(size=20, color=COLORS["gold"], family="Inter, Segoe UI, sans-serif")),
            xaxis=dict(
                gridcolor="rgba(148, 163, 184, 0.1)",
                linecolor="rgba(148, 163, 184, 0.2)",
                tickfont=dict(color=COLORS["text_secondary"]),
            ),
            yaxis=dict(
                gridcolor="rgba(148, 163, 184, 0.1)",
                linecolor="rgba(148, 163, 184, 0.2)",
                tickfont=dict(color=COLORS["text_secondary"]),
            ),
            legend=dict(
                bgcolor="rgba(15, 23, 42, 0.8)",
                bordercolor=COLORS["border"],
                borderwidth=1,
                font=dict(color=COLORS["text_secondary"]),
            ),
            margin=dict(l=60, r=40, t=80, b=60),
            hoverlabel=dict(
                bgcolor=COLORS["bg_card"],
                bordercolor=COLORS["border_gold"],
                font=dict(color=COLORS["text_primary"], size=13),
            ),
        )
    )

# ═══════════════════════════════════════════════════════════════════════════════
# DASHBOARD SECTION CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════════

SECTIONS = {
    "overview": {
        "title": "🏗️ PROJECT OVERVIEW",
        "icon": "🏗️",
        "color": COLORS["gold"],
        "priority": 1,
    },
    "wbs": {
        "title": "📊 WORK BREAKDOWN STRUCTURE",
        "icon": "📊",
        "color": COLORS["sapphire"],
        "priority": 2,
    },
    "activities": {
        "title": "⚡ ACTIVITIES",
        "icon": "⚡",
        "color": COLORS["cyan"],
        "priority": 3,
    },
    "milestones": {
        "title": "🎯 MAIN MILESTONES",
        "icon": "🎯",
        "color": COLORS["violet"],
        "priority": 4,
    },
    "s_curve": {
        "title": "📈 S-CURVE ANALYSIS",
        "icon": "📈",
        "color": COLORS["emerald"],
        "priority": 5,
    },
    "evm": {
        "title": "💰 EARNED VALUE MANAGEMENT",
        "icon": "💰",
        "color": COLORS["gold"],
        "priority": 6,
    },
    "contracts": {
        "title": "📜 CONTRACTS",
        "icon": "📜",
        "color": COLORS["violet"],
        "priority": 7,
    },
    "letters": {
        "title": "✉️ LETTERS INTELLIGENCE",
        "icon": "✉️",
        "color": COLORS["sapphire"],
        "priority": 8,
    },
    "risks": {
        "title": "⚠️ RISK ANALYSIS",
        "icon": "⚠️",
        "color": COLORS["rose"],
        "priority": 9,
    },
    "delay": {
        "title": "⏱️ DELAY & TIME IMPACT ANALYSIS",
        "icon": "⏱️",
        "color": COLORS["rose"],
        "priority": 10,
    },
}

# ═══════════════════════════════════════════════════════════════════════════════
# STREAMLIT CUSTOM CSS - Premium Glassmorphism Theme
# ═══════════════════════════════════════════════════════════════════════════════

def get_custom_css():
    """Returns premium CSS for Streamlit with glassmorphism effects."""
    return """
    <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');

    /* ═════════════════ GLOBAL RESET ═════════════════ */
    * {
        font-family: 'Inter', 'Segoe UI', sans-serif !important;
    }

    .stApp {
        background: linear-gradient(135deg, #0a0e27 0%, #0f172a 50%, #1e1b4b 100%);
        background-attachment: fixed;
    }

    /* ═════════════════ SCROLLBAR ═════════════════ */
    ::-webkit-scrollbar {
        width: 8px;
        height: 8px;
    }
    ::-webkit-scrollbar-track {
        background: rgba(15, 23, 42, 0.5);
        border-radius: 4px;
    }
    ::-webkit-scrollbar-thumb {
        background: linear-gradient(180deg, #f59e0b, #d97706);
        border-radius: 4px;
    }
    ::-webkit-scrollbar-thumb:hover {
        background: linear-gradient(180deg, #fbbf24, #f59e0b);
    }

    /* ═════════════════ HEADER ═════════════════ */
    .dashboard-header {
        background: linear-gradient(135deg, rgba(245, 158, 11, 0.15), rgba(139, 92, 246, 0.1));
        border: 1px solid rgba(245, 158, 11, 0.3);
        border-radius: 20px;
        padding: 30px 40px;
        margin-bottom: 30px;
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        box-shadow: 0 8px 32px rgba(245, 158, 11, 0.15), 
                    inset 0 1px 0 rgba(255, 255, 255, 0.1);
        position: relative;
        overflow: hidden;
    }

    .dashboard-header::before {
        content: '';
        position: absolute;
        top: -50%;
        left: -50%;
        width: 200%;
        height: 200%;
        background: radial-gradient(circle, rgba(245, 158, 11, 0.05) 0%, transparent 70%);
        animation: pulse 4s ease-in-out infinite;
    }

    @keyframes pulse {
        0%, 100% { transform: scale(1); opacity: 0.5; }
        50% { transform: scale(1.1); opacity: 0.8; }
    }

    .dashboard-title {
        font-size: 42px !important;
        font-weight: 800 !important;
        background: linear-gradient(135deg, #fbbf24, #f59e0b, #d97706);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
        letter-spacing: -1px;
        margin-bottom: 8px !important;
        text-shadow: 0 0 40px rgba(245, 158, 11, 0.3);
    }

    .dashboard-subtitle {
        font-size: 16px !important;
        color: #94a3b8 !important;
        font-weight: 400 !important;
        letter-spacing: 2px;
        text-transform: uppercase;
    }

    /* ═════════════════ SECTION HEADERS ═════════════════ */
    .section-header {
        background: linear-gradient(135deg, rgba(15, 23, 42, 0.9), rgba(30, 41, 59, 0.8));
        border: 1px solid rgba(148, 163, 184, 0.15);
        border-left: 4px solid;
        border-radius: 16px;
        padding: 20px 28px;
        margin: 30px 0 20px 0;
        backdrop-filter: blur(15px);
        -webkit-backdrop-filter: blur(15px);
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        transition: all 0.3s ease;
    }

    .section-header:hover {
        transform: translateX(5px);
        box-shadow: 0 6px 30px rgba(0, 0, 0, 0.4);
    }

    .section-title {
        font-size: 22px !important;
        font-weight: 700 !important;
        letter-spacing: 1px;
        margin: 0 !important;
    }

    /* ═════════════════ KPI CARDS ═════════════════ */
    .kpi-card {
        background: linear-gradient(135deg, rgba(15, 23, 42, 0.9), rgba(30, 41, 59, 0.7));
        border: 1px solid rgba(148, 163, 184, 0.15);
        border-radius: 20px;
        padding: 28px;
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3),
                    inset 0 1px 0 rgba(255, 255, 255, 0.05);
        transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        position: relative;
        overflow: hidden;
    }

    .kpi-card::after {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 3px;
        background: linear-gradient(90deg, transparent, var(--accent-color), transparent);
        opacity: 0.6;
    }

    .kpi-card:hover {
        transform: translateY(-8px) scale(1.02);
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4),
                    0 0 30px var(--accent-glow);
        border-color: var(--accent-color);
    }

    .kpi-label {
        font-size: 13px !important;
        font-weight: 600 !important;
        text-transform: uppercase;
        letter-spacing: 2px;
        color: #94a3b8 !important;
        margin-bottom: 12px !important;
    }

    .kpi-value {
        font-size: 36px !important;
        font-weight: 800 !important;
        color: #f8fafc !important;
        margin: 0 !important;
        line-height: 1.2 !important;
    }

    .kpi-delta {
        font-size: 14px !important;
        font-weight: 600 !important;
        margin-top: 8px !important;
    }

    .kpi-delta-positive { color: #10b981 !important; }
    .kpi-delta-negative { color: #f43f5e !important; }

    /* ═════════════════ DATA TABLES ═════════════════ */
    .premium-table {
        background: rgba(15, 23, 42, 0.7);
        border-radius: 16px;
        overflow: hidden;
        border: 1px solid rgba(148, 163, 184, 0.15);
    }

    .premium-table th {
        background: linear-gradient(135deg, rgba(245, 158, 11, 0.2), rgba(139, 92, 246, 0.15));
        color: #fbbf24 !important;
        font-weight: 700 !important;
        text-transform: uppercase;
        letter-spacing: 1px;
        font-size: 12px !important;
        padding: 16px !important;
        border-bottom: 2px solid rgba(245, 158, 11, 0.3) !important;
    }

    .premium-table td {
        color: #e2e8f0 !important;
        font-size: 14px !important;
        padding: 14px 16px !important;
        border-bottom: 1px solid rgba(148, 163, 184, 0.1) !important;
    }

    .premium-table tr:hover td {
        background: rgba(245, 158, 11, 0.05) !important;
    }

    /* ═════════════════ STATUS BADGES ═════════════════ */
    .badge {
        display: inline-block;
        padding: 6px 14px;
        border-radius: 20px;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 1px;
        text-transform: uppercase;
    }

    .badge-ontrack {
        background: rgba(16, 185, 129, 0.15);
        color: #10b981;
        border: 1px solid rgba(16, 185, 129, 0.3);
    }

    .badge-atrisk {
        background: rgba(245, 158, 11, 0.15);
        color: #f59e0b;
        border: 1px solid rgba(245, 158, 11, 0.3);
    }

    .badge-delayed {
        background: rgba(244, 63, 94, 0.15);
        color: #f43f5e;
        border: 1px solid rgba(244, 63, 94, 0.3);
    }

    .badge-completed {
        background: rgba(59, 130, 246, 0.15);
        color: #3b82f6;
        border: 1px solid rgba(59, 130, 246, 0.3);
    }

    /* ═════════════════ PROGRESS BARS ═════════════════ */
    .progress-container {
        background: rgba(30, 41, 59, 0.8);
        border-radius: 12px;
        height: 12px;
        overflow: hidden;
        position: relative;
    }

    .progress-fill {
        height: 100%;
        border-radius: 12px;
        background: linear-gradient(90deg, var(--progress-start), var(--progress-end));
        transition: width 1.5s cubic-bezier(0.4, 0, 0.2, 1);
        position: relative;
    }

    .progress-fill::after {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
        animation: shimmer 2s infinite;
    }

    @keyframes shimmer {
        0% { transform: translateX(-100%); }
        100% { transform: translateX(100%); }
    }

    /* ═════════════════ MILESTONE TIMELINE ═════════════════ */
    .timeline-item {
        position: relative;
        padding-left: 40px;
        padding-bottom: 30px;
        border-left: 2px solid rgba(148, 163, 184, 0.2);
    }

    .timeline-item::before {
        content: '';
        position: absolute;
        left: -8px;
        top: 0;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: var(--timeline-color);
        box-shadow: 0 0 15px var(--timeline-color);
    }

    .timeline-item.completed::before {
        background: #10b981;
        box-shadow: 0 0 20px rgba(16, 185, 129, 0.6);
    }

    .timeline-item.upcoming::before {
        background: #f59e0b;
        box-shadow: 0 0 20px rgba(245, 158, 11, 0.6);
    }

    .timeline-item.delayed::before {
        background: #f43f5e;
        box-shadow: 0 0 20px rgba(244, 63, 94, 0.6);
        animation: pulse-dot 2s infinite;
    }

    @keyframes pulse-dot {
        0%, 100% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.3); opacity: 0.7; }
    }

    /* ═════════════════ RISK MATRIX CELLS ═════════════════ */
    .risk-cell {
        border-radius: 8px;
        padding: 12px;
        text-align: center;
        font-weight: 700;
        font-size: 13px;
        transition: all 0.3s ease;
        cursor: pointer;
    }

    .risk-cell:hover {
        transform: scale(1.05);
        box-shadow: 0 4px 15px rgba(0,0,0,0.3);
    }

    /* ═════════════════ ANIMATED ENTRANCE ═════════════════ */
    .fade-in-up {
        animation: fadeInUp 0.8s ease-out forwards;
        opacity: 0;
    }

    @keyframes fadeInUp {
        from {
            opacity: 0;
            transform: translateY(30px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    /* ═════════════════ STREAMLIT OVERRIDES ═════════════════ */
    .stTabs [data-baseweb="tab-list"] {
        gap: 8px;
        background: rgba(15, 23, 42, 0.6);
        border-radius: 16px;
        padding: 8px;
        border: 1px solid rgba(148, 163, 184, 0.15);
    }

    .stTabs [data-baseweb="tab"] {
        background: transparent !important;
        color: #94a3b8 !important;
        font-weight: 600 !important;
        border-radius: 12px !important;
        padding: 12px 24px !important;
        transition: all 0.3s ease !important;
    }

    .stTabs [data-baseweb="tab"]:hover {
        background: rgba(245, 158, 11, 0.1) !important;
        color: #fbbf24 !important;
    }

    .stTabs [aria-selected="true"] {
        background: linear-gradient(135deg, rgba(245, 158, 11, 0.2), rgba(139, 92, 246, 0.15)) !important;
        color: #fbbf24 !important;
        border: 1px solid rgba(245, 158, 11, 0.3) !important;
    }

    div[data-testid="stExpander"] {
        background: rgba(15, 23, 42, 0.7);
        border: 1px solid rgba(148, 163, 184, 0.15);
        border-radius: 16px;
        overflow: hidden;
    }

    div[data-testid="stExpander"] > div:first-child {
        background: linear-gradient(135deg, rgba(245, 158, 11, 0.1), rgba(139, 92, 246, 0.05));
        border-bottom: 1px solid rgba(148, 163, 184, 0.15);
    }

    /* ═════════════════ DIVIDERS ═════════════════ */
    .gold-divider {
        height: 1px;
        background: linear-gradient(90deg, transparent, rgba(245, 158, 11, 0.5), transparent);
        margin: 30px 0;
        border: none;
    }

    /* ═════════════════ FOOTER ═════════════════ */
    .dashboard-footer {
        text-align: center;
        padding: 30px;
        color: #64748b;
        font-size: 13px;
        letter-spacing: 2px;
        text-transform: uppercase;
        border-top: 1px solid rgba(148, 163, 184, 0.1);
        margin-top: 40px;
    }
    </style>
    """

# ═══════════════════════════════════════════════════════════════════════════════
# UTILITY FUNCTIONS
# ═══════════════════════════════════════════════════════════════════════════════

def get_status_color(status: str) -> str:
    """Maps status string to color code."""
    status_map = {
        "completed": COLORS["emerald"],
        "complete": COLORS["emerald"],
        "done": COLORS["emerald"],
        "on track": COLORS["emerald"],
        "ontrack": COLORS["emerald"],
        "active": COLORS["emerald"],
        "in progress": COLORS["sapphire"],
        "inprogress": COLORS["sapphire"],
        "ongoing": COLORS["sapphire"],
        "at risk": COLORS["amber"],
        "atrisk": COLORS["amber"],
        "warning": COLORS["amber"],
        "delayed": COLORS["rose"],
        "delay": COLORS["rose"],
        "critical": COLORS["rose"],
        "high": COLORS["rose"],
        "pending": COLORS["amber"],
        "planned": COLORS["text_muted"],
        "approved": COLORS["emerald"],
        "rejected": COLORS["rose"],
        "under review": COLORS["amber"],
    }
    return status_map.get(status.lower().strip(), COLORS["text_secondary"])


def get_status_badge_class(status: str) -> str:
    """Maps status to CSS badge class."""
    status_map = {
        "completed": "badge-completed",
        "complete": "badge-completed",
        "done": "badge-completed",
        "on track": "badge-ontrack",
        "ontrack": "badge-ontrack",
        "active": "badge-ontrack",
        "in progress": "badge-ontrack",
        "inprogress": "badge-ontrack",
        "ongoing": "badge-ontrack",
        "at risk": "badge-atrisk",
        "atrisk": "badge-atrisk",
        "warning": "badge-atrisk",
        "delayed": "badge-delayed",
        "delay": "badge-delayed",
        "critical": "badge-delayed",
        "pending": "badge-atrisk",
        "planned": "badge-completed",
        "approved": "badge-ontrack",
        "rejected": "badge-delayed",
    }
    return status_map.get(status.lower().strip(), "badge-completed")
