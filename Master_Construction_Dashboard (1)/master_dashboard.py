"""
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║     ███╗   ███╗ █████╗ ███████╗████████╗███████╗██████╗                      ║
║     ████╗ ████║██╔══██╗██╔════╝╚══██╔══╝██╔════╝██╔══██╗                     ║
║     ██╔████╔██║███████║███████╗   ██║   █████╗  ██████╔╝                     ║
║     ██║╚██╔╝██║██╔══██║╚════██║   ██║   ██╔══╝  ██╔══██╗                     ║
║     ██║ ╚═╝ ██║██║  ██║███████║   ██║   ███████╗██║  ██║                     ║
║     ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝   ╚═╝   ╚══════╝╚═╝  ╚═╝                     ║
║                                                                              ║
║     D A S H B O A R D                                                        ║
║                                                                              ║
║     Premium Construction Project Intelligence Platform                        ║
║     Version: 2.0.0 | Elite Tier | Visual Editable | Dark Glassmorphism     ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝

MASTER CONSTRUCTION DASHBOARD - VISUAL EDITABLE EDITION
═══════════════════════════════════════════════════════════════════════════════

A premium, interactive, and visually stunning construction project dashboard
with FULL VISUAL EDITING CAPABILITIES. Edit any data directly in the UI and
see changes reflected in real-time across all charts and visualizations.

NEW IN V2.0:
  ✏️ Visual Data Editor - Edit all 10 sections inline
  💾 Export edited data to JSON
  🔄 Reset to original data
  📊 Real-time chart updates

FEATURES:
  a) Project Overview          - Executive KPIs, health indicators
  b) WBS                       - Interactive work breakdown structure
  c) Activities                - Gantt-style activity tracking
  d) Main Milestones           - Timeline visualization
  e) S-Curve Analysis          - Cumulative progress curves
  f) EVM Analysis              - Earned Value Management
  g) Contracts                 - Contract performance
  h) Letters Intelligence      - Top 3 correspondence threads
  i) Risk Analysis             - Risk matrix, heat map
  j) Delay & Time Impact       - Delay waterfall, TIA

USAGE:
    streamlit run master_dashboard.py

DATA INTEGRATION:
  - Auto-detects JSON files in working directory
  - Imports data from other Python modules
  - Generates premium sample data for demo
  - Visual editor for real-time data modification

═══════════════════════════════════════════════════════════════════════════════
"""

import streamlit as st
import plotly.graph_objects as go
import plotly.express as px
from plotly.subplots import make_subplots
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import json
import os
import sys

# Import local modules
from config import COLORS, SECTIONS, get_custom_css, get_premium_template, get_status_color, get_status_badge_class
from data_loader import load_construction_data, format_currency, format_percentage, days_between
from data_editor import init_editor_state, render_editor_toggle, render_full_editor, get_editor_data

# ═══════════════════════════════════════════════════════════════════════════════
# PAGE CONFIGURATION - Premium Full-Screen Layout
# ═══════════════════════════════════════════════════════════════════════════════

st.set_page_config(
    page_title="🏗️ Master Dashboard | Construction Intelligence",
    page_icon="🏗️",
    layout="wide",
    initial_sidebar_state="collapsed",
    menu_items={'Get Help': None, 'Report a bug': None, 'About': None}
)

# Inject premium CSS
st.markdown(get_custom_css(), unsafe_allow_html=True)

# ═══════════════════════════════════════════════════════════════════════════════
# DATA LOADING - Intelligent Auto-Detection
# ═══════════════════════════════════════════════════════════════════════════════

@st.cache_data(ttl=300)
def load_data():
    """Load all project data with intelligent source detection."""
    return load_construction_data()

try:
    original_data = load_data()
    DATA_LOADED = True
except Exception as e:
    st.error(f"⚠️ Error loading data: {e}")
    DATA_LOADED = False
    original_data = {}

# Initialize editor state with original data
init_editor_state(original_data)
if 'original_data' not in st.session_state:
    st.session_state.original_data = original_data.copy()

# Use editor data if in edit mode, otherwise use original
data = get_editor_data() if st.session_state.get('edit_mode') else original_data

# ═══════════════════════════════════════════════════════════════════════════════
# HELPER FUNCTIONS - Premium Visual Components
# ═══════════════════════════════════════════════════════════════════════════════

def render_section_header(section_key: str):
    """Render a premium section header with accent color."""
    section = SECTIONS.get(section_key, {})
    title = section.get("title", section_key.upper())
    color = section.get("color", COLORS["gold"])
    st.markdown(f"""
    <div class="section-header" style="border-left-color: {color};">
        <h2 class="section-title" style="color: {color};">{title}</h2>
    </div>
    """, unsafe_allow_html=True)

def render_kpi_card(title: str, value: str, delta: str = "", delta_positive: bool = True,
                    accent_color: str = COLORS["gold"], icon: str = ""):
    """Render a premium KPI card with glassmorphism effect."""
    delta_class = "kpi-delta-positive" if delta_positive else "kpi-delta-negative"
    delta_icon = "▲" if delta_positive else "▼"
    st.markdown(f"""
    <div class="kpi-card" style="--accent-color: {accent_color}; --accent-glow: {accent_color}33;">
        <div class="kpi-label">{icon} {title}</div>
        <div class="kpi-value">{value}</div>
        {f'<div class="kpi-delta {delta_class}">{delta_icon} {delta}</div>' if delta else ''}
    </div>
    """, unsafe_allow_html=True)

def create_gauge_chart(value: float, title: str, color: str = COLORS["gold"],
                         max_val: float = 100, suffix: str = "%"):
    """Create a premium circular gauge chart."""
    fig = go.Figure(go.Indicator(
        mode="gauge+number+delta",
        value=value,
        number={'suffix': suffix, 'font': {'size': 28, 'color': COLORS["text_primary"], 'family': 'Inter'}},
        title={'text': title, 'font': {'size': 14, 'color': COLORS["text_secondary"], 'family': 'Inter'}},
        delta={'reference': max_val * 0.8, 'increasing': {'color': COLORS["emerald"]}, 'decreasing': {'color': COLORS["rose"]}},
        gauge={
            'axis': {'range': [0, max_val], 'tickwidth': 1, 'tickcolor': COLORS["text_muted"]},
            'bar': {'color': color, 'thickness': 0.75},
            'bgcolor': "rgba(15, 23, 42, 0.5)",
            'borderwidth': 2,
            'bordercolor': COLORS["border"],
            'steps': [
                {'range': [0, max_val * 0.3], 'color': "rgba(244, 63, 94, 0.1)"},
                {'range': [max_val * 0.3, max_val * 0.7], 'color': "rgba(245, 158, 11, 0.1)"},
                {'range': [max_val * 0.7, max_val], 'color': "rgba(16, 185, 129, 0.1)"},
            ],
            'threshold': {
                'line': {'color': COLORS["text_secondary"], 'width': 2},
                'thickness': 0.8,
                'value': max_val * 0.8
            }
        }
    ))
    fig.update_layout(
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)",
        margin=dict(l=20, r=20, t=50, b=20),
        height=220,
    )
    return fig

def create_progress_bar_html(label: str, value: float, color: str = COLORS["emerald"],
                              width: int = 100, show_percent: bool = True):
    """Create a premium animated progress bar."""
    percent_text = f"{value:.1f}%" if show_percent else ""
    return f"""
    <div style="margin-bottom: 12px;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
            <span style="color: {COLORS['text_secondary']}; font-size: 13px; font-weight: 500;">{label}</span>
            <span style="color: {color}; font-size: 13px; font-weight: 700;">{percent_text}</span>
        </div>
        <div class="progress-container" style="width: {width}%;">
            <div class="progress-fill" style="width: {value}%; --progress-start: {color}88; --progress-end: {color};"></div>
        </div>
    </div>
    """

# ═══════════════════════════════════════════════════════════════════════════════
# EDITOR TOGGLE & MODE SELECTION
# ═══════════════════════════════════════════════════════════════════════════════

render_editor_toggle()

# ═══════════════════════════════════════════════════════════════════════════════
# VISUAL EDITOR MODE
# ═══════════════════════════════════════════════════════════════════════════════

if st.session_state.get('edit_mode'):
    # In edit mode, show the full visual editor
    data = render_full_editor(data)

    # After editing, update the data reference for any subsequent dashboard preview
    st.session_state.editor_data = data

    # Show a preview section below the editor
    st.markdown("<div class='gold-divider'></div>", unsafe_allow_html=True)
    st.markdown(f"""
    <div style="text-align: center; padding: 20px;">
        <div style="font-size: 16px; font-weight: 700; color: #fbbf24; text-transform: uppercase; letter-spacing: 2px;">
            👇 PREVIEW YOUR CHANGES BELOW
        </div>
        <div style="font-size: 13px; color: #94a3b8; margin-top: 8px;">
            Toggle EDIT MODE off to see the full dashboard with your changes, or scroll down to preview.
        </div>
    </div>
    """, unsafe_allow_html=True)
    st.markdown("<div class='gold-divider'></div>", unsafe_allow_html=True)

# ═══════════════════════════════════════════════════════════════════════════════
# MAIN DASHBOARD HEADER
# ═══════════════════════════════════════════════════════════════════════════════

overview_data = data.get("overview", {})
project_name = overview_data.get("project_name", "PROJECT DASHBOARD")
project_code = overview_data.get("project_code", "N/A")

st.markdown(f"""
<div class="dashboard-header">
    <h1 class="dashboard-title">🏗️ MASTER DASHBOARD</h1>
    <p class="dashboard-subtitle">{project_name} | {project_code} | Construction Intelligence Platform</p>
    <div style="display: flex; gap: 30px; margin-top: 20px; flex-wrap: wrap;">
        <div style="text-align: center;">
            <div style="font-size: 24px; font-weight: 800; color: {COLORS['gold']};">{overview_data.get('overall_progress', 0):.1f}%</div>
            <div style="font-size: 11px; color: {COLORS['text_muted']}; text-transform: uppercase; letter-spacing: 2px;">Overall Progress</div>
        </div>
        <div style="width: 1px; background: rgba(148, 163, 184, 0.3);"></div>
        <div style="text-align: center;">
            <div style="font-size: 24px; font-weight: 800; color: {COLORS['emerald']};">{overview_data.get('health_score', 0):.0f}</div>
            <div style="font-size: 11px; color: {COLORS['text_muted']}; text-transform: uppercase; letter-spacing: 2px;">Health Score</div>
        </div>
        <div style="width: 1px; background: rgba(148, 163, 184, 0.3);"></div>
        <div style="text-align: center;">
            <div style="font-size: 24px; font-weight: 800; color: {COLORS['sapphire']};">{overview_data.get('total_manpower', 0):,}</div>
            <div style="font-size: 11px; color: {COLORS['text_muted']}; text-transform: uppercase; letter-spacing: 2px;">Manpower</div>
        </div>
        <div style="width: 1px; background: rgba(148, 163, 184, 0.3);"></div>
        <div style="text-align: center;">
            <div style="font-size: 24px; font-weight: 800; color: {COLORS['violet']};">{format_currency(overview_data.get('budget_utilized', 0))}</div>
            <div style="font-size: 11px; color: {COLORS['text_muted']}; text-transform: uppercase; letter-spacing: 2px;">Budget Utilized</div>
        </div>
    </div>
</div>
""", unsafe_allow_html=True)

# ═══════════════════════════════════════════════════════════════════════════════
# A) PROJECT OVERVIEW SECTION
# ═══════════════════════════════════════════════════════════════════════════════

render_section_header("overview")

if "overview" in data:
    ov = data["overview"]
    col1, col2, col3, col4, col5 = st.columns(5)
    with col1:
        render_kpi_card("Contract Value", format_currency(ov.get("contract_value", 0)), accent_color=COLORS["gold"], icon="💰")
    with col2:
        render_kpi_card("Budget Remaining", format_currency(ov.get("budget_remaining", 0)),
                        delta="31.5% of total", delta_positive=True, accent_color=COLORS["emerald"], icon="📊")
    with col3:
        total_act = ov.get('total_activities', 1)
        comp_act = ov.get('completed_activities', 0)
        render_kpi_card("Activities Completed", f"{comp_act:,} / {total_act:,}",
                        delta=f"{comp_act/max(total_act,1)*100:.1f}%", delta_positive=True, accent_color=COLORS["sapphire"], icon="✅")
    with col4:
        status = ov.get("status", "On Track")
        render_kpi_card("Project Status", status, accent_color=get_status_color(status), icon="🎯")
    with col5:
        render_kpi_card("Project Manager", ov.get("project_manager", "N/A"), accent_color=COLORS["violet"], icon="👤")

    col1, col2, col3, col4 = st.columns([1, 1, 1.5, 1.5])
    with col1:
        fig = create_gauge_chart(ov.get("overall_progress", 0), "Progress", color=COLORS["gold"])
        st.plotly_chart(fig, use_container_width=True, config={'displayModeBar': False})
    with col2:
        fig = create_gauge_chart(ov.get("health_score", 0), "Health Score", color=COLORS["emerald"], max_val=100)
        st.plotly_chart(fig, use_container_width=True, config={'displayModeBar': False})
    with col3:
        st.markdown("""
        <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(148, 163, 184, 0.15);
                    border-radius: 16px; padding: 24px; height: 220px; backdrop-filter: blur(15px);">
            <div style="font-size: 13px; font-weight: 700; color: #fbbf24; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 16px;">📅 TIMELINE</div>
        """, unsafe_allow_html=True)
        start = ov.get("start_date", "N/A")
        finish = ov.get("finish_date", "N/A")
        actual_start = ov.get("actual_start", "N/A")
        st.markdown(f"""
            <div style="margin-bottom: 12px;"><div style="font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 1px;">Planned Start</div>
            <div style="font-size: 16px; font-weight: 600; color: #f8fafc;">{start}</div></div>
            <div style="margin-bottom: 12px;"><div style="font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 1px;">Planned Finish</div>
            <div style="font-size: 16px; font-weight: 600; color: #f8fafc;">{finish}</div></div>
            <div><div style="font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 1px;">Actual Start</div>
            <div style="font-size: 16px; font-weight: 600; color: #10b981;">{actual_start}</div></div>
        </div>
        """, unsafe_allow_html=True)
    with col4:
        st.markdown(f"""
        <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(148, 163, 184, 0.15);
                    border-radius: 16px; padding: 24px; height: 220px; backdrop-filter: blur(15px);">
            <div style="font-size: 13px; font-weight: 700; color: #fbbf24; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 16px;">🏢 PROJECT DETAILS</div>
            <div style="margin-bottom: 10px;"><span style="font-size: 11px; color: #64748b; text-transform: uppercase;">Client:</span>
            <span style="font-size: 14px; font-weight: 600; color: #f8fafc; margin-left: 8px;">{ov.get('client', 'N/A')}</span></div>
            <div style="margin-bottom: 10px;"><span style="font-size: 11px; color: #64748b; text-transform: uppercase;">Contractor:</span>
            <span style="font-size: 14px; font-weight: 600; color: #f8fafc; margin-left: 8px;">{ov.get('contractor', 'N/A')}</span></div>
            <div style="margin-bottom: 10px;"><span style="font-size: 11px; color: #64748b; text-transform: uppercase;">Location:</span>
            <span style="font-size: 14px; font-weight: 600; color: #f8fafc; margin-left: 8px;">{ov.get('location', 'N/A')}</span></div>
            <div><span style="font-size: 11px; color: #64748b; text-transform: uppercase;">Code:</span>
            <span style="font-size: 14px; font-weight: 600; color: #f8fafc; margin-left: 8px;">{ov.get('project_code', 'N/A')}</span></div>
        </div>
        """, unsafe_allow_html=True)

    if ov.get("description"):
        st.markdown(f"""
        <div style="background: linear-gradient(135deg, rgba(245, 158, 11, 0.08), rgba(139, 92, 246, 0.05));
                    border: 1px solid rgba(245, 158, 11, 0.2); border-radius: 12px; padding: 20px; margin-top: 20px;">
            <div style="font-size: 12px; font-weight: 700; color: #fbbf24; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 8px;">📝 PROJECT DESCRIPTION</div>
            <div style="font-size: 14px; color: #e2e8f0; line-height: 1.6;">{ov.get('description')}</div>
        </div>
        """, unsafe_allow_html=True)

st.markdown("<div class='gold-divider'></div>", unsafe_allow_html=True)

# ═══════════════════════════════════════════════════════════════════════════════
# B) WBS
# ═══════════════════════════════════════════════════════════════════════════════

render_section_header("wbs")

if "wbs" in data:
    wbs_data = data["wbs"]
    wbs_items = wbs_data.get("wbs_items", [])
    if wbs_items:
        df_wbs = pd.DataFrame(wbs_items)
        col1, col2 = st.columns([2, 1])
        with col1:
            fig = go.Figure(go.Sunburst(
                ids=df_wbs['id'],
                labels=df_wbs['name'],
                parents=df_wbs['parent_id'].fillna(''),
                values=df_wbs['weight'],
                branchvalues='total',
                marker=dict(
                    colors=df_wbs['progress'],
                    colorscale=[[0, COLORS['rose']], [0.5, COLORS['amber']], [1, COLORS['emerald']]],
                    showscale=True,
                    colorbar=dict(title='Progress %', titleside='right', titlefont=dict(color=COLORS['text_secondary']), tickfont=dict(color=COLORS['text_secondary'])),
                    line=dict(color='rgba(15, 23, 42, 0.8)', width=2),
                ),
                hovertemplate='<b>%{label}</b><br>Progress: %{color:.1f}%<br>Weight: %{value:.1f}%<extra></extra>',
                textfont=dict(size=12, color=COLORS['text_primary']),
            ))
            fig.update_layout(
                **get_premium_template()['layout'],
                height=500,
                margin=dict(l=20, r=20, t=40, b=20),
                title=dict(text="WBS Hierarchy - Size = Weight | Color = Progress", font=dict(size=16, color=COLORS['gold']), x=0.5),
            )
            st.plotly_chart(fig, use_container_width=True, config={'displayModeBar': False})
        with col2:
            st.markdown(f"""
            <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(148, 163, 184, 0.15);
                        border-radius: 16px; padding: 24px; height: 500px; overflow-y: auto; backdrop-filter: blur(15px);">
                <div style="font-size: 13px; font-weight: 700; color: #fbbf24; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 20px;">📊 WBS PROGRESS</div>
            """, unsafe_allow_html=True)
            level1_items = [item for item in wbs_items if item.get('level') == 1]
            for item in level1_items:
                color = get_status_color(item.get('status', 'On Track'))
                st.markdown(create_progress_bar_html(item['name'], item['progress'], color=color), unsafe_allow_html=True)
                st.markdown(f"""
                <div style="display: flex; justify-content: space-between; margin-bottom: 16px; padding-left: 8px;">
                    <span style="font-size: 11px; color: {COLORS['text_muted']};">{format_currency(item['actual_cost'])} / {format_currency(item['budget'])} spent</span>
                    <span class="badge {get_status_badge_class(item.get('status', 'On Track'))}">{item.get('status', 'On Track')}</span>
                </div>
                """, unsafe_allow_html=True)
            st.markdown("</div>", unsafe_allow_html=True)
        with st.expander("📋 View Complete WBS Table", expanded=False):
            df_display = df_wbs[['id', 'name', 'level', 'budget', 'actual_cost', 'progress', 'status', 'weight']].copy()
            df_display['budget'] = df_display['budget'].apply(lambda x: format_currency(x))
            df_display['actual_cost'] = df_display['actual_cost'].apply(lambda x: format_currency(x))
            df_display['progress'] = df_display['progress'].apply(lambda x: f"{x:.1f}%")
            df_display['weight'] = df_display['weight'].apply(lambda x: f"{x:.1f}%")
            st.dataframe(df_display, use_container_width=True, hide_index=True)

st.markdown("<div class='gold-divider'></div>", unsafe_allow_html=True)

# ═══════════════════════════════════════════════════════════════════════════════
# C) ACTIVITIES
# ═══════════════════════════════════════════════════════════════════════════════

render_section_header("activities")

if "activities" in data:
    act_data = data["activities"]
    activities = act_data.get("activities", [])
    if activities:
        df_act = pd.DataFrame(activities)
        col1, col2, col3 = st.columns([1, 1.5, 1.5])
        with col1:
            status_counts = df_act['status'].value_counts().reset_index()
            status_counts.columns = ['Status', 'Count']
            colors_map = {'Completed': COLORS['emerald'], 'On Track': COLORS['emerald'], 'In Progress': COLORS['sapphire'],
                          'Planned': COLORS['text_muted'], 'At Risk': COLORS['amber'], 'Delayed': COLORS['rose']}
            fig = px.pie(status_counts, values='Count', names='Status', hole=0.6, color='Status', color_discrete_map=colors_map)
            fig.update_traces(textposition='outside', textinfo='label+value', textfont=dict(color=COLORS['text_primary'], size=12),
                              marker=dict(line=dict(color='rgba(15, 23, 42, 0.8)', width=2)))
            fig.update_layout(**get_premium_template()['layout'], height=350, showlegend=False,
                              annotations=[dict(text=f"<b>{len(activities)}</b><br>Activities", x=0.5, y=0.5,
                                               font=dict(size=20, color=COLORS['gold'], family='Inter'), showarrow=False)])
            st.plotly_chart(fig, use_container_width=True, config={'displayModeBar': False})
        with col2:
            df_gantt = df_act.copy()
            df_gantt['start'] = pd.to_datetime(df_gantt['start_date'])
            df_gantt['finish'] = pd.to_datetime(df_gantt['finish_date'])
            color_map = {'Completed': COLORS['emerald'], 'On Track': COLORS['sapphire'], 'In Progress': COLORS['sapphire'],
                         'Planned': COLORS['text_muted'], 'At Risk': COLORS['amber'], 'Delayed': COLORS['rose']}
            df_gantt['bar_color'] = df_gantt['status'].map(color_map).fillna(COLORS['text_muted'])
            fig = go.Figure()
            for idx, row in df_gantt.iterrows():
                fig.add_trace(go.Bar(name=row['name'], y=[row['name']], x=[(row['finish'] - row['start']).days],
                                     base=row['start'], orientation='h',
                                     marker=dict(color=row['bar_color'], line=dict(color='rgba(15, 23, 42, 0.5)', width=1), opacity=0.85),
                                     hovertemplate=f"<b>{row['name']}</b><br>Start: {row['start_date']}<br>Finish: {row['finish_date']}<br>Duration: {row['duration']} days<br>Progress: {row['progress']}%<br>Status: {row['status']}<extra></extra>", showlegend=False))
            fig.update_layout(**get_premium_template()['layout'], height=350, barmode='overlay',
                              xaxis=dict(title='Timeline', gridcolor='rgba(148, 163, 184, 0.1)', showgrid=True),
                              yaxis=dict(title='', showgrid=False, tickfont=dict(size=11)), margin=dict(l=200, r=40, t=40, b=40))
            st.plotly_chart(fig, use_container_width=True, config={'displayModeBar': False})
        with col3:
            critical = df_act[df_act['critical_path'] == True]
            non_critical = df_act[df_act['critical_path'] == False]
            fig = go.Figure()
            fig.add_trace(go.Bar(name='Critical Path', x=critical['name'], y=critical['progress'],
                                 marker=dict(color=COLORS['rose'], line=dict(color='rgba(15, 23, 42, 0.5)', width=1)),
                                 text=critical['progress'].apply(lambda x: f'{x:.0f}%'), textposition='outside',
                                 textfont=dict(color=COLORS['text_primary'], size=10), showlegend=False))
            fig.add_trace(go.Bar(name='Non-Critical', x=non_critical['name'], y=non_critical['progress'],
                                 marker=dict(color=COLORS['sapphire'], line=dict(color='rgba(15, 23, 42, 0.5)', width=1)),
                                 text=non_critical['progress'].apply(lambda x: f'{x:.0f}%'), textposition='outside',
                                 textfont=dict(color=COLORS['text_primary'], size=10), showlegend=False))
            fig.update_layout(**get_premium_template()['layout'], height=350, barmode='group',
                              xaxis=dict(title='', tickangle=-45, tickfont=dict(size=10)),
                              yaxis=dict(title='Progress %', range=[0, 110]),
                              legend=dict(orientation='h', yanchor='bottom', y=1.02, xanchor='center', x=0.5),
                              margin=dict(l=40, r=40, t=60, b=100))
            st.plotly_chart(fig, use_container_width=True, config={'displayModeBar': False})
        with st.expander("📋 View Complete Activities Table", expanded=False):
            df_display = df_act[['id', 'name', 'start_date', 'finish_date', 'duration', 'progress', 'status', 'critical_path']].copy()
            df_display['critical_path'] = df_display['critical_path'].apply(lambda x: '🔴 Yes' if x else '⚪ No')
            df_display['progress'] = df_display['progress'].apply(lambda x: f"{x:.1f}%")
            st.dataframe(df_display, use_container_width=True, hide_index=True)

st.markdown("<div class='gold-divider'></div>", unsafe_allow_html=True)

# ═══════════════════════════════════════════════════════════════════════════════
# D) MAIN MILESTONES
# ═══════════════════════════════════════════════════════════════════════════════

render_section_header("milestones")

if "milestones" in data:
    ms_data = data["milestones"]
    milestones = ms_data.get("milestones", [])
    if milestones:
        df_ms = pd.DataFrame(milestones)
        df_ms['planned_date'] = pd.to_datetime(df_ms['planned_date'])
        df_ms['actual_date'] = pd.to_datetime(df_ms['actual_date'], errors='coerce')
        df_ms['forecast_date'] = pd.to_datetime(df_ms['forecast_date'], errors='coerce')
        col1, col2 = st.columns([1.5, 1])
        with col1:
            fig = go.Figure()
            for idx, row in df_ms.iterrows():
                status = row['status']
                if status == 'Completed': color, symbol, size = COLORS['emerald'], 'diamond', 20
                elif status == 'On Track': color, symbol, size = COLORS['sapphire'], 'diamond', 18
                elif status == 'At Risk': color, symbol, size = COLORS['amber'], 'diamond-cross', 18
                else: color, symbol, size = COLORS['text_muted'], 'diamond-dot', 16
                fig.add_trace(go.Scatter(x=[row['planned_date']], y=[row['name']], mode='markers+text',
                                         marker=dict(color=color, size=size, symbol=symbol, line=dict(color='rgba(15, 23, 42, 0.8)', width=2)),
                                         text=[f"  {row['planned_date'].strftime('%Y-%m-%d')}"], textposition='middle right',
                                         textfont=dict(color=COLORS['text_secondary'], size=11), showlegend=False,
                                         hovertemplate=f"<b>{row['name']}</b><br>Status: {status}<br>Planned: {row['planned_date'].strftime('%Y-%m-%d')}<br>Weight: {row['weight']}%<extra></extra>"))
                actual = row['actual_date'] if pd.notna(row['actual_date']) else row['forecast_date']
                if pd.notna(actual):
                    actual_color = COLORS['emerald'] if status == 'Completed' else COLORS['amber']
                    fig.add_trace(go.Scatter(x=[actual], y=[row['name']], mode='markers',
                                             marker=dict(color=actual_color, size=12, symbol='circle', line=dict(color='rgba(15, 23, 42, 0.8)', width=2)),
                                             showlegend=False, hovertemplate=f"<b>{row['name']}</b><br>Actual/Forecast: {actual.strftime('%Y-%m-%d')}<extra></extra>"))
                    fig.add_trace(go.Scatter(x=[row['planned_date'], actual], y=[row['name'], row['name']], mode='lines',
                                             line=dict(color=color, width=2, dash='dot' if status != 'Completed' else 'solid'),
                                             showlegend=False, hoverinfo='skip'))
            fig.update_layout(**get_premium_template()['layout'], height=450,
                              xaxis=dict(title='Date', showgrid=True, gridcolor='rgba(148, 163, 184, 0.1)'),
                              yaxis=dict(title='', showgrid=False, tickfont=dict(size=12)), margin=dict(l=250, r=40, t=40, b=40))
            st.plotly_chart(fig, use_container_width=True, config={'displayModeBar': False})
        with col2:
            st.markdown(f"""
            <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(148, 163, 184, 0.15);
                        border-radius: 16px; padding: 24px; height: 450px; overflow-y: auto; backdrop-filter: blur(15px);">
                <div style="font-size: 13px; font-weight: 700; color: #fbbf24; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 20px;">🎯 MILESTONE TIMELINE</div>
            """, unsafe_allow_html=True)
            for idx, row in df_ms.iterrows():
                status = row['status']
                if status == 'Completed': timeline_class, color = 'completed', COLORS['emerald']
                elif status == 'On Track': timeline_class, color = 'upcoming', COLORS['amber']
                elif status == 'At Risk': timeline_class, color = 'delayed', COLORS['amber']
                else: timeline_class, color = 'upcoming', COLORS['text_muted']
                actual_date = row['actual_date'].strftime('%Y-%m-%d') if pd.notna(row['actual_date']) else (row['forecast_date'].strftime('%Y-%m-%d') if pd.notna(row['forecast_date']) else 'TBD')
                planned_date = row['planned_date'].strftime('%Y-%m-%d')
                st.markdown(f"""
                <div class="timeline-item {timeline_class}" style="--timeline-color: {color};">
                    <div style="font-size: 14px; font-weight: 700; color: #f8fafc; margin-bottom: 4px;">{row['name']}</div>
                    <div style="font-size: 12px; color: #94a3b8; margin-bottom: 4px;">{row['description']}</div>
                    <div style="display: flex; gap: 12px; font-size: 11px;">
                        <span style="color: #64748b;">Planned: <span style="color: #94a3b8;">{planned_date}</span></span>
                        <span style="color: {color};">{'Actual' if status == 'Completed' else 'Forecast'}: <span style="font-weight: 600;">{actual_date}</span></span>
                    </div>
                    <span class="badge {get_status_badge_class(status)}">{status}</span>
                </div>
                """, unsafe_allow_html=True)
            st.markdown("</div>", unsafe_allow_html=True)

st.markdown("<div class='gold-divider'></div>", unsafe_allow_html=True)

# ═══════════════════════════════════════════════════════════════════════════════
# E) S-CURVE ANALYSIS
# ═══════════════════════════════════════════════════════════════════════════════

render_section_header("s_curve")

if "s_curve" in data:
    sc_data = data["s_curve"]
    dates = sc_data.get("dates", [])
    planned = sc_data.get("planned_progress", [])
    actual = sc_data.get("actual_progress", [])
    forecast = sc_data.get("forecast_progress", [])
    if dates and planned and actual:
        df_sc = pd.DataFrame({'Date': pd.to_datetime(dates), 'Planned': planned, 'Actual': actual, 'Forecast': forecast if forecast else actual})
        col1, col2 = st.columns([2, 1])
        with col1:
            fig = go.Figure()
            fig.add_trace(go.Scatter(x=df_sc['Date'], y=df_sc['Planned'], mode='lines', name='Planned Progress',
                                       line=dict(color=COLORS['text_muted'], width=2, dash='dash'),
                                       fill='tonexty', fillcolor='rgba(100, 116, 139, 0.05)',
                                       hovertemplate='Date: %{x}<br>Planned: %{y:.1f}%<extra></extra>'))
            fig.add_trace(go.Scatter(x=df_sc['Date'], y=df_sc['Actual'], mode='lines+markers', name='Actual Progress',
                                       line=dict(color=COLORS['emerald'], width=3),
                                       marker=dict(size=6, color=COLORS['emerald'], line=dict(color='rgba(15, 23, 42, 0.8)', width=2)),
                                       fill='tonexty', fillcolor='rgba(16, 185, 129, 0.08)',
                                       hovertemplate='Date: %{x}<br>Actual: %{y:.1f}%<extra></extra>'))
            last_actual_idx = df_sc['Actual'].last_valid_index()
            if last_actual_idx is not None and forecast:
                forecast_dates = df_sc['Date'].iloc[last_actual_idx:]
                forecast_values = df_sc['Forecast'].iloc[last_actual_idx:]
                fig.add_trace(go.Scatter(x=forecast_dates, y=forecast_values, mode='lines', name='Forecast',
                                         line=dict(color=COLORS['amber'], width=2, dash='dot'),
                                         hovertemplate='Date: %{x}<br>Forecast: %{y:.1f}%<extra></extra>'))
            fig.update_layout(**get_premium_template()['layout'], height=450,
                              xaxis=dict(title='Timeline', showgrid=True, gridcolor='rgba(148, 163, 184, 0.1)'),
                              yaxis=dict(title='Cumulative Progress (%)', range=[0, 105], showgrid=True, gridcolor='rgba(148, 163, 184, 0.1)'),
                              legend=dict(orientation='h', yanchor='bottom', y=1.02, xanchor='center', x=0.5),
                              margin=dict(l=60, r=40, t=80, b=60))
            st.plotly_chart(fig, use_container_width=True, config={'displayModeBar': False})
        with col2:
            current_actual = actual[-1] if actual else 0
            current_planned = planned[-1] if planned else 0
            variance = current_actual - current_planned
            st.markdown(f"""
            <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(148, 163, 184, 0.15);
                        border-radius: 16px; padding: 24px; height: 450px; backdrop-filter: blur(15px);">
                <div style="font-size: 13px; font-weight: 700; color: #fbbf24; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 20px;">📈 S-CURVE METRICS</div>
                <div style="margin-bottom: 24px;">
                    <div style="font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">Current Actual Progress</div>
                    <div style="font-size: 36px; font-weight: 800; color: {COLORS['emerald']};">{current_actual:.1f}%</div>
                </div>
                <div style="margin-bottom: 24px;">
                    <div style="font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">Current Planned Progress</div>
                    <div style="font-size: 36px; font-weight: 800; color: {COLORS['text_muted']};">{current_planned:.1f}%</div>
                </div>
                <div style="margin-bottom: 24px;">
                    <div style="font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">Schedule Variance</div>
                    <div style="font-size: 36px; font-weight: 800; color: {COLORS['amber'] if variance < 0 else COLORS['emerald']};">{variance:+.1f}%</div>
                </div>
                <div style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 12px; padding: 16px;">
                    <div style="font-size: 12px; color: #fbbf24; font-weight: 600; margin-bottom: 8px;">⚡ INSIGHT</div>
                    <div style="font-size: 13px; color: #e2e8f0; line-height: 1.5;">
                        Project is <b>{abs(variance):.1f}%</b> {'behind' if variance < 0 else 'ahead of'} planned schedule.
                        {'Recovery measures recommended.' if variance < -5 else 'Performance is within acceptable tolerance.'}
                    </div>
                </div>
            </div>
            """, unsafe_allow_html=True)

st.markdown("<div class='gold-divider'></div>", unsafe_allow_html=True)

# ═══════════════════════════════════════════════════════════════════════════════
# F) EVM ANALYSIS
# ═══════════════════════════════════════════════════════════════════════════════

render_section_header("evm")

if "evm" in data:
    evm_data = data["evm"]
    dates = evm_data.get("dates", [])
    bcws = evm_data.get("bcws", [])
    bcwp = evm_data.get("bcwp", [])
    acwp = evm_data.get("acwp", [])
    spi = evm_data.get("spi", [])
    cpi = evm_data.get("cpi", [])
    if dates and bcws and bcwp and acwp:
        df_evm = pd.DataFrame({'Date': pd.to_datetime(dates), 'BCWS (Planned Value)': bcws, 'BCWP (Earned Value)': bcwp,
                               'ACWP (Actual Cost)': acwp, 'SPI': spi, 'CPI': cpi})
        col1, col2 = st.columns([2, 1])
        with col1:
            fig = make_subplots(rows=2, cols=1, row_heights=[0.65, 0.35],
                                subplot_titles=('Cost & Value Curves', 'Performance Indices (SPI / CPI)'),
                                vertical_spacing=0.12)
            fig.add_trace(go.Scatter(x=df_evm['Date'], y=df_evm['BCWS (Planned Value)'], mode='lines', name='BCWS (Planned)',
                                     line=dict(color=COLORS['text_muted'], width=2, dash='dash'),
                                     hovertemplate='Date: %{x}<br>BCWS: %{y:,.0f}<extra></extra>'), row=1, col=1)
            fig.add_trace(go.Scatter(x=df_evm['Date'], y=df_evm['BCWP (Earned Value)'], mode='lines', name='BCWP (Earned)',
                                     line=dict(color=COLORS['emerald'], width=3), fill='tonexty', fillcolor='rgba(16, 185, 129, 0.08)',
                                     hovertemplate='Date: %{x}<br>BCWP: %{y:,.0f}<extra></extra>'), row=1, col=1)
            fig.add_trace(go.Scatter(x=df_evm['Date'], y=df_evm['ACWP (Actual Cost)'], mode='lines', name='ACWP (Actual)',
                                     line=dict(color=COLORS['rose'], width=3),
                                     hovertemplate='Date: %{x}<br>ACWP: %{y:,.0f}<extra></extra>'), row=1, col=1)
            fig.add_trace(go.Scatter(x=df_evm['Date'], y=df_evm['SPI'], mode='lines', name='SPI',
                                     line=dict(color=COLORS['sapphire'], width=2),
                                     hovertemplate='Date: %{x}<br>SPI: %{y:.3f}<extra></extra>'), row=2, col=1)
            fig.add_trace(go.Scatter(x=df_evm['Date'], y=df_evm['CPI'], mode='lines', name='CPI',
                                     line=dict(color=COLORS['gold'], width=2),
                                     hovertemplate='Date: %{x}<br>CPI: %{y:.3f}<extra></extra>'), row=2, col=1)
            fig.add_hline(y=1.0, line_dash="dash", line_color="rgba(148, 163, 184, 0.3)", row=2, col=1)
            fig.update_layout(**get_premium_template()['layout'], height=550, showlegend=True,
                              legend=dict(orientation='h', yanchor='bottom', y=1.02, xanchor='center', x=0.5),
                              margin=dict(l=60, r=40, t=80, b=40))
            fig.update_yaxes(title_text="Value (USD)", row=1, col=1)
            fig.update_yaxes(title_text="Index", row=2, col=1)
            fig.update_xaxes(title_text="Date", row=2, col=1)
            st.plotly_chart(fig, use_container_width=True, config={'displayModeBar': False})
        with col2:
            current_spi = spi[-1] if spi else 1.0
            current_cpi = cpi[-1] if cpi else 1.0
            current_bcwp = bcwp[-1] if bcwp else 0
            current_bcws = bcws[-1] if bcws else 0
            current_acwp = acwp[-1] if acwp else 0
            sv = current_bcwp - current_bcws
            cv = current_bcwp - current_acwp
            st.markdown(f"""
            <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(148, 163, 184, 0.15);
                        border-radius: 16px; padding: 24px; height: 550px; overflow-y: auto; backdrop-filter: blur(15px);">
                <div style="font-size: 13px; font-weight: 700; color: #fbbf24; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 20px;">💰 EVM KPIs</div>
            """, unsafe_allow_html=True)
            fig_spi = create_gauge_chart(current_spi * 100, "SPI", color=COLORS['sapphire'], max_val=120, suffix="%")
            st.plotly_chart(fig_spi, use_container_width=True, config={'displayModeBar': False})
            fig_cpi = create_gauge_chart(current_cpi * 100, "CPI", color=COLORS['gold'], max_val=120, suffix="%")
            st.plotly_chart(fig_cpi, use_container_width=True, config={'displayModeBar': False})
            st.markdown(f"""
                <div style="margin-top: 16px;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 12px; padding: 12px; background: rgba(30, 41, 59, 0.5); border-radius: 8px;">
                        <span style="font-size: 12px; color: #94a3b8;">Schedule Variance (SV)</span>
                        <span style="font-size: 14px; font-weight: 700; color: {COLORS['emerald'] if sv >= 0 else COLORS['rose']};">{format_currency(sv)}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; padding: 12px; background: rgba(30, 41, 59, 0.5); border-radius: 8px;">
                        <span style="font-size: 12px; color: #94a3b8;">Cost Variance (CV)</span>
                        <span style="font-size: 14px; font-weight: 700; color: {COLORS['emerald'] if cv >= 0 else COLORS['rose']};">{format_currency(cv)}</span>
                    </div>
                </div>
            </div>
            """, unsafe_allow_html=True)
        with st.expander("📋 View EVM Detailed Data", expanded=False):
            df_display = df_evm.copy()
            df_display['Date'] = df_display['Date'].dt.strftime('%Y-%m-%d')
            st.dataframe(df_display, use_container_width=True, hide_index=True)

st.markdown("<div class='gold-divider'></div>", unsafe_allow_html=True)

# ═══════════════════════════════════════════════════════════════════════════════
# G) CONTRACTS
# ═══════════════════════════════════════════════════════════════════════════════

render_section_header("contracts")

if "contracts" in data:
    ct_data = data["contracts"]
    contracts = ct_data.get("contracts", [])
    if contracts:
        df_ct = pd.DataFrame(contracts)
        col1, col2, col3 = st.columns(3)
        total_contract_value = df_ct['contract_value'].sum()
        total_variations = df_ct['approved_variations'].sum()
        total_invoiced = df_ct['invoiced_to_date'].sum()
        total_paid = df_ct['paid_to_date'].sum()
        total_balance = df_ct['balance'].sum()
        with col1:
            render_kpi_card("Total Contract Value", format_currency(total_contract_value), accent_color=COLORS['gold'], icon="📜")
        with col2:
            render_kpi_card("Total Variations", format_currency(total_variations),
                            delta=f"{total_variations/total_contract_value*100:.1f}% of base", delta_positive=False, accent_color=COLORS['amber'], icon="📈")
        with col3:
            render_kpi_card("Balance Remaining", format_currency(total_balance), accent_color=COLORS['sapphire'], icon="💰")
        col1, col2 = st.columns([2, 1])
        with col1:
            fig = go.Figure()
            fig.add_trace(go.Bar(name='Contract Value', x=df_ct['title'], y=df_ct['contract_value'],
                                 marker=dict(color=COLORS['sapphire'], line=dict(color='rgba(15, 23, 42, 0.5)', width=1)),
                                 hovertemplate='%{x}<br>Contract Value: %{y:,.0f}<extra></extra>'))
            fig.add_trace(go.Bar(name='Invoiced to Date', x=df_ct['title'], y=df_ct['invoiced_to_date'],
                                 marker=dict(color=COLORS['amber'], line=dict(color='rgba(15, 23, 42, 0.5)', width=1)),
                                 hovertemplate='%{x}<br>Invoiced: %{y:,.0f}<extra></extra>'))
            fig.add_trace(go.Bar(name='Paid to Date', x=df_ct['title'], y=df_ct['paid_to_date'],
                                 marker=dict(color=COLORS['emerald'], line=dict(color='rgba(15, 23, 42, 0.5)', width=1)),
                                 hovertemplate='%{x}<br>Paid: %{y:,.0f}<extra></extra>'))
            fig.update_layout(**get_premium_template()['layout'], height=400, barmode='group',
                              xaxis=dict(title='', tickangle=-30, tickfont=dict(size=10)),
                              yaxis=dict(title='Amount (USD)', showgrid=True),
                              legend=dict(orientation='h', yanchor='bottom', y=1.02, xanchor='center', x=0.5),
                              margin=dict(l=60, r=40, t=80, b=100))
            st.plotly_chart(fig, use_container_width=True, config={'displayModeBar': False})
        with col2:
            fig = go.Figure(go.Pie(labels=df_ct['title'], values=df_ct['contract_value'], hole=0.55,
                                     marker=dict(colors=[COLORS['sapphire'], COLORS['emerald'], COLORS['amber'], COLORS['violet'], COLORS['rose']],
                                                 line=dict(color='rgba(15, 23, 42, 0.8)', width=2)),
                                     textinfo='label+percent', textfont=dict(color=COLORS['text_primary'], size=11),
                                     hovertemplate='<b>%{label}</b><br>Value: %{value:,.0f}<br>Share: %{percent}<extra></extra>'))
            fig.update_layout(**get_premium_template()['layout'], height=400, showlegend=False,
                              annotations=[dict(text=f"<b>{format_currency(total_contract_value)}</b><br>Total", x=0.5, y=0.5,
                                               font=dict(size=16, color=COLORS['gold'], family='Inter'), showarrow=False)])
            st.plotly_chart(fig, use_container_width=True, config={'displayModeBar': False})
        with st.expander("📋 View Contract Details", expanded=False):
            df_display = df_ct[['contract_no', 'title', 'contractor', 'contract_value', 'approved_variations',
                               'total_value', 'invoiced_to_date', 'paid_to_date', 'balance', 'completion_percent', 'status']].copy()
            for col in ['contract_value', 'approved_variations', 'total_value', 'invoiced_to_date', 'paid_to_date', 'balance']:
                df_display[col] = df_display[col].apply(format_currency)
            df_display['completion_percent'] = df_display['completion_percent'].apply(lambda x: f"{x:.1f}%")
            st.dataframe(df_display, use_container_width=True, hide_index=True)

st.markdown("<div class='gold-divider'></div>", unsafe_allow_html=True)

# ═══════════════════════════════════════════════════════════════════════════════
# H) LETTERS INTELLIGENCE - TOP 3 THREADS
# ═══════════════════════════════════════════════════════════════════════════════

render_section_header("letters")

if "letters" in data:
    lt_data = data["letters"]
    threads = lt_data.get("threads", [])
    if threads:
        top_threads = threads[:3]
        total_letters = sum(t['letter_count'] for t in threads)
        st.markdown(f"""
        <div style="background: linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(139, 92, 246, 0.05));
                    border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 16px; padding: 20px; margin-bottom: 24px;">
            <div style="font-size: 12px; font-weight: 700; color: #60a5fa; text-transform: uppercase; letter-spacing: 2px;">🧠 INTELLIGENCE SUMMARY</div>
            <div style="font-size: 14px; color: #e2e8f0; margin-top: 8px; line-height: 1.6;">
                <b>{len(threads)} active correspondence threads</b> detected. Top 3 priority threads are displayed below,
                representing the most critical issues requiring executive attention.
                Total <b>{total_letters} letters</b> exchanged across all threads.
            </div>
        </div>
        """, unsafe_allow_html=True)
        for i, thread in enumerate(top_threads, 1):
            priority_colors = {'High': COLORS['rose'], 'Medium': COLORS['amber'], 'Low': COLORS['emerald']}
            priority_color = priority_colors.get(thread.get('priority', 'Medium'), COLORS['amber'])
            category_colors = {'Claim': COLORS['rose'], 'Technical': COLORS['sapphire'], 'Commercial': COLORS['gold'], 'Variation': COLORS['violet']}
            category_color = category_colors.get(thread.get('category', 'Technical'), COLORS['sapphire'])
            status_colors = {'Open': COLORS['amber'], 'Closed': COLORS['emerald'], 'Pending Response': COLORS['sapphire']}
            status_color = status_colors.get(thread.get('status', 'Open'), COLORS['amber'])
            with st.expander(f"#{i} {thread.get('subject', 'Unknown Thread')} — {thread.get('letter_count', 0)} letters", expanded=(i==1)):
                col1, col2 = st.columns([1, 1])
                with col1:
                    parties_html = ''.join([f'<span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #60a5fa; border-color: rgba(59, 130, 246, 0.3);">{party}</span>' for party in thread.get('parties', [])])
                    st.markdown(f"""
                    <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(148, 163, 184, 0.15);
                                border-radius: 16px; padding: 24px; backdrop-filter: blur(15px);">
                        <div style="display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap;">
                            <span class="badge" style="background: {priority_color}22; color: {priority_color}; border-color: {priority_color}44;">🔥 {thread.get('priority', 'Medium')} Priority</span>
                            <span class="badge" style="background: {category_color}22; color: {category_color}; border-color: {category_color}44;">📂 {thread.get('category', 'General')}</span>
                            <span class="badge" style="background: {status_color}22; color: {status_color}; border-color: {status_color}44;">📌 {thread.get('status', 'Open')}</span>
                        </div>
                        <div style="font-size: 13px; font-weight: 700; color: #fbbf24; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 12px;">📝 THREAD SUMMARY</div>
                        <div style="font-size: 14px; color: #e2e8f0; line-height: 1.7; margin-bottom: 20px;">{thread.get('summary', 'No summary available.')}</div>
                        <div style="font-size: 13px; font-weight: 700; color: #fbbf24; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 12px;">👥 PARTIES INVOLVED</div>
                        <div style="display: flex; gap: 8px; flex-wrap: wrap;">{parties_html}</div>
                        <div style="margin-top: 16px; font-size: 12px; color: #64748b;">Last Activity: <span style="color: #94a3b8; font-weight: 600;">{thread.get('last_date', 'N/A')}</span></div>
                    </div>
                    """, unsafe_allow_html=True)
                with col2:
                    st.markdown(f"""
                    <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(148, 163, 184, 0.15);
                                border-radius: 16px; padding: 24px; backdrop-filter: blur(15px); height: 100%;">
                        <div style="font-size: 13px; font-weight: 700; color: #fbbf24; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 16px;">📨 CORRESPONDENCE CHAIN</div>
                    """, unsafe_allow_html=True)
                    letters = thread.get('letters', [])
                    for j, letter in enumerate(letters):
                        letter_status_color = {'Acknowledged': COLORS['emerald'], 'Responded': COLORS['sapphire'],
                                                  'Under Review': COLORS['amber'], 'Pending Response': COLORS['rose']}.get(letter.get('status', ''), COLORS['text_muted'])
                        st.markdown(f"""
                        <div style="display: flex; gap: 12px; margin-bottom: 16px; padding-left: 8px; border-left: 2px solid {letter_status_color}44;">
                            <div style="min-width: 80px;"><div style="font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 1px;">{letter.get('date', '')}</div></div>
                            <div style="flex: 1;">
                                <div style="font-size: 13px; font-weight: 600; color: #f8fafc; margin-bottom: 2px;">{letter.get('ref_no', '')}</div>
                                <div style="font-size: 12px; color: #94a3b8; margin-bottom: 4px;">{letter.get('subject', '')}</div>
                                <div style="display: flex; gap: 8px; font-size: 11px;">
                                    <span style="color: #64748b;">From: <span style="color: #94a3b8;">{letter.get('from', '')}</span></span>
                                    <span style="color: #64748b;">→ To: <span style="color: #94a3b8;">{letter.get('to', '')}</span></span>
                                </div>
                                <span class="badge" style="background: {letter_status_color}22; color: {letter_status_color}; border-color: {letter_status_color}44; margin-top: 6px; display: inline-block;">{letter.get('status', '')}</span>
                            </div>
                        </div>
                        """, unsafe_allow_html=True)
                    st.markdown("</div>", unsafe_allow_html=True)

st.markdown("<div class='gold-divider'></div>", unsafe_allow_html=True)

# ═══════════════════════════════════════════════════════════════════════════════
# I) RISK ANALYSIS
# ═══════════════════════════════════════════════════════════════════════════════

render_section_header("risks")

if "risks" in data:
    risk_data = data["risks"]
    risks = risk_data.get("risks", [])
    if risks:
        df_risk = pd.DataFrame(risks)
        col1, col2, col3 = st.columns([1.2, 1, 1])
        with col1:
            prob_labels = ['Very Low', 'Low', 'Medium', 'High', 'Very High']
            impact_labels = ['Very Low', 'Low', 'Medium', 'High', 'Very High']
            matrix = np.zeros((5, 5))
            for _, row in df_risk.iterrows():
                p = min(row['probability'] - 1, 4)
                i = min(row['impact'] - 1, 4)
                matrix[p, i] += 1
            colorscale = [[0, 'rgba(16, 185, 129, 0.3)'], [0.25, 'rgba(245, 158, 11, 0.3)'],
                          [0.5, 'rgba(245, 158, 11, 0.5)'], [0.75, 'rgba(244, 63, 94, 0.5)'], [1, 'rgba(244, 63, 94, 0.7)']]
            fig = go.Figure(data=go.Heatmap(z=matrix, x=impact_labels, y=prob_labels, colorscale=colorscale,
                                             text=matrix.astype(int), texttemplate='%{text}',
                                             textfont=dict(size=16, color=COLORS['text_primary']),
                                             hovertemplate='Impact: %{x}<br>Probability: %{y}<br>Risks: %{z}<extra></extra>',
                                             colorbar=dict(title='Risk Count', titleside='right',
                                                           titlefont=dict(color=COLORS['text_secondary']),
                                                           tickfont=dict(color=COLORS['text_secondary']))))
            fig.update_layout(**get_premium_template()['layout'], height=400,
                              xaxis=dict(title='Impact →', side='top'), yaxis=dict(title='Probability →', autorange='reversed'),
                              title=dict(text='Risk Probability-Impact Matrix', font=dict(size=16, color=COLORS['gold']), x=0.5))
            st.plotly_chart(fig, use_container_width=True, config={'displayModeBar': False})
        with col2:
            category_counts = df_risk['category'].value_counts().reset_index()
            category_counts.columns = ['Category', 'Count']
            fig = px.pie(category_counts, values='Count', names='Category', hole=0.6,
                         color_discrete_sequence=[COLORS['sapphire'], COLORS['amber'], COLORS['rose'], COLORS['violet'], COLORS['emerald']])
            fig.update_traces(textposition='outside', textinfo='label+value', textfont=dict(color=COLORS['text_primary'], size=11),
                              marker=dict(line=dict(color='rgba(15, 23, 42, 0.8)', width=2)))
            fig.update_layout(**get_premium_template()['layout'], height=400, showlegend=False,
                              annotations=[dict(text=f"<b>{len(risks)}</b><br>Risks", x=0.5, y=0.5,
                                               font=dict(size=20, color=COLORS['gold'], family='Inter'), showarrow=False)])
            st.plotly_chart(fig, use_container_width=True, config={'displayModeBar': False})
        with col3:
            status_counts = df_risk['status'].value_counts().reset_index()
            status_counts.columns = ['Status', 'Count']
            status_color_map = {'Active': COLORS['rose'], 'Mitigated': COLORS['emerald'], 'Closed': COLORS['sapphire'], 'Realized': COLORS['amber']}
            fig = go.Figure()
            for _, row in status_counts.iterrows():
                fig.add_trace(go.Bar(name=row['Status'], x=[row['Status']], y=[row['Count']],
                                     marker=dict(color=status_color_map.get(row['Status'], COLORS['text_muted']),
                                                 line=dict(color='rgba(15, 23, 42, 0.5)', width=1)),
                                     text=[row['Count']], textposition='outside', textfont=dict(color=COLORS['text_primary'], size=14),
                                     hovertemplate='%{x}<br>Count: %{y}<extra></extra>', showlegend=False))
            fig.update_layout(**get_premium_template()['layout'], height=400, xaxis=dict(title=''), yaxis=dict(title='Count', showgrid=True),
                              margin=dict(l=40, r=40, t=40, b=40))
            st.plotly_chart(fig, use_container_width=True, config={'displayModeBar': False})
        with st.expander("📋 View All Risks", expanded=False):
            df_display = df_risk[['id', 'description', 'category', 'probability', 'impact', 'score', 'status', 'owner', 'mitigation']].copy()
            def score_color(score):
                if score >= 15: return f'<span style="color: {COLORS["rose"]}; font-weight: 800;">{score}</span>'
                elif score >= 8: return f'<span style="color: {COLORS["amber"]}; font-weight: 700;">{score}</span>'
                else: return f'<span style="color: {COLORS["emerald"]}; font-weight: 600;">{score}</span>'
            df_display['score'] = df_display['score'].apply(score_color)
            st.markdown(f"""
            <div class="premium-table">
                <table style="width: 100%; border-collapse: collapse;">
                    <thead><tr><th>ID</th><th>Description</th><th>Category</th><th>P</th><th>I</th><th>Score</th><th>Status</th><th>Owner</th></tr></thead>
                    <tbody>
            """, unsafe_allow_html=True)
            for _, row in df_display.iterrows():
                st.markdown(f"""
                        <tr>
                            <td>{row['id']}</td>
                            <td>{row['description'][:80]}{'...' if len(row['description']) > 80 else ''}</td>
                            <td>{row['category']}</td>
                            <td>{row['probability']}</td>
                            <td>{row['impact']}</td>
                            <td>{row['score']}</td>
                            <td><span class="badge {get_status_badge_class(row['status'])}">{row['status']}</span></td>
                            <td>{row['owner']}</td>
                        </tr>
                """, unsafe_allow_html=True)
            st.markdown("""</tbody></table></div>""", unsafe_allow_html=True)

st.markdown("<div class='gold-divider'></div>", unsafe_allow_html=True)

# ═══════════════════════════════════════════════════════════════════════════════
# J) DELAY ANALYSIS - TIME IMPACT ANALYSIS
# ═══════════════════════════════════════════════════════════════════════════════

render_section_header("delay")

if "delay" in data:
    delay_data = data["delay"]
    delays = delay_data.get("delays", [])
    time_impact = delay_data.get("time_impact", {})
    if delays and time_impact:
        df_delay = pd.DataFrame(delays)
        col1, col2, col3 = st.columns(3)
        with col1:
            render_kpi_card("Total Delay Days", f"{time_impact.get('total_delay_days', 0)} days",
                            delta=f"Original: {time_impact.get('original_completion', 'N/A')}", delta_positive=False, accent_color=COLORS['rose'], icon="⏱️")
        with col2:
            render_kpi_card("Current Forecast", time_impact.get('current_forecast', 'N/A'),
                            delta=f"+{time_impact.get('total_delay_days', 0)} days from original", delta_positive=False, accent_color=COLORS['amber'], icon="📅")
        with col3:
            render_kpi_card("Recovery Strategy", "Active", accent_color=COLORS['emerald'], icon="🚀")
        col1, col2 = st.columns([1.5, 1])
        with col1:
            delay_types = ['Excusable', 'Non-Excusable', 'Compensable', 'Concurrent']
            delay_values = [time_impact.get('excusable_days', 0), time_impact.get('non_excusable_days', 0),
                            time_impact.get('compensable_days', 0), time_impact.get('concurrent_days', 0)]
            delay_colors = [COLORS['sapphire'], COLORS['rose'], COLORS['amber'], COLORS['violet']]
            fig = go.Figure()
            for dtype, dval, dcolor in zip(delay_types, delay_values, delay_colors):
                fig.add_trace(go.Bar(name=dtype, x=[dtype], y=[dval],
                                     marker=dict(color=dcolor, line=dict(color='rgba(15, 23, 42, 0.5)', width=1)),
                                     text=[f'{dval} days'], textposition='outside',
                                     textfont=dict(color=COLORS['text_primary'], size=13, weight=700),
                                     hovertemplate=f'<b>{dtype}</b><br>Days: {dval}<extra></extra>', showlegend=False))
            total = sum(delay_values)
            fig.add_hline(y=total, line_dash="dash", line_color=COLORS['rose'], line_width=2,
                         annotation_text=f"Total: {total} days", annotation_position="top right",
                         annotation_font=dict(color=COLORS['rose'], size=12))
            fig.update_layout(**get_premium_template()['layout'], height=400,
                              xaxis=dict(title='Delay Type'), yaxis=dict(title='Days', showgrid=True),
                              margin=dict(l=60, r=40, t=60, b=40))
            st.plotly_chart(fig, use_container_width=True, config={'displayModeBar': False})
            fig2 = go.Figure()
            for idx, row in df_delay.iterrows():
                start = datetime.strptime(row['start_date'], '%Y-%m-%d')
                end = datetime.strptime(row['end_date'], '%Y-%m-%d')
                duration = (end - start).days
                type_colors = {'Excusable': COLORS['sapphire'], 'Non-Excusable': COLORS['rose'],
                               'Compensable': COLORS['amber'], 'Concurrent': COLORS['violet']}
                bar_color = type_colors.get(row['type'], COLORS['text_muted'])
                fig2.add_trace(go.Bar(name=row['description'][:40], y=[row['description'][:50]], x=[duration], base=start, orientation='h',
                                      marker=dict(color=bar_color, line=dict(color='rgba(15, 23, 42, 0.5)', width=1)),
                                      text=[f'{duration}d'], textposition='inside', textfont=dict(color='white', size=11),
                                      hovertemplate=f"<b>{row['description'][:60]}</b><br>Type: {row['type']}<br>Duration: {duration} days<br>Impact: {row['impact_days']} days<br>Status: {row['status']}<extra></extra>", showlegend=False))
            fig2.update_layout(**get_premium_template()['layout'], height=350,
                              xaxis=dict(title='Timeline', showgrid=True), yaxis=dict(title='', showgrid=False, tickfont=dict(size=11)),
                              margin=dict(l=300, r=40, t=40, b=40))
            st.plotly_chart(fig2, use_container_width=True, config={'displayModeBar': False})
        with col2:
            st.markdown(f"""
            <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(148, 163, 184, 0.15);
                        border-radius: 16px; padding: 24px; height: 400px; backdrop-filter: blur(15px); overflow-y: auto;">
                <div style="font-size: 13px; font-weight: 700; color: #fbbf24; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 20px;">⏱️ TIME IMPACT SUMMARY</div>
                <div style="margin-bottom: 20px;">
                    <div style="font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px;">Original Completion</div>
                    <div style="font-size: 20px; font-weight: 700; color: #f8fafc;">{time_impact.get('original_completion', 'N/A')}</div>
                </div>
                <div style="margin-bottom: 20px;">
                    <div style="font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px;">Current Forecast</div>
                    <div style="font-size: 20px; font-weight: 700; color: #f43f5e;">{time_impact.get('current_forecast', 'N/A')}</div>
                    <div style="font-size: 12px; color: #f43f5e; margin-top: 4px;">+{time_impact.get('total_delay_days', 0)} days delay</div>
                </div>
                <div style="background: rgba(30, 41, 59, 0.8); border-radius: 12px; padding: 16px; margin-bottom: 16px;">
                    <div style="font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px;">Delay Breakdown</div>
                    {create_progress_bar_html('Excusable', time_impact.get('excusable_days', 0)/max(time_impact.get('total_delay_days', 1), 1)*100, COLORS['sapphire'], show_percent=False)}
                    <div style="text-align: right; font-size: 12px; color: #94a3b8; margin-bottom: 8px;">{time_impact.get('excusable_days', 0)} days</div>
                    {create_progress_bar_html('Non-Excusable', time_impact.get('non_excusable_days', 0)/max(time_impact.get('total_delay_days', 1), 1)*100, COLORS['rose'], show_percent=False)}
                    <div style="text-align: right; font-size: 12px; color: #94a3b8; margin-bottom: 8px;">{time_impact.get('non_excusable_days', 0)} days</div>
                    {create_progress_bar_html('Compensable', time_impact.get('compensable_days', 0)/max(time_impact.get('total_delay_days', 1), 1)*100, COLORS['amber'], show_percent=False)}
                    <div style="text-align: right; font-size: 12px; color: #94a3b8; margin-bottom: 8px;">{time_impact.get('compensable_days', 0)} days</div>
                    {create_progress_bar_html('Concurrent', time_impact.get('concurrent_days', 0)/max(time_impact.get('total_delay_days', 1), 1)*100, COLORS['violet'], show_percent=False)}
                    <div style="text-align: right; font-size: 12px; color: #94a3b8; margin-bottom: 8px;">{time_impact.get('concurrent_days', 0)} days</div>
                </div>
            </div>
            """, unsafe_allow_html=True)
            st.markdown(f"""
            <div style="background: linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(59, 130, 246, 0.05));
                        border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 16px; padding: 20px; margin-top: 16px;">
                <div style="font-size: 12px; font-weight: 700; color: #10b981; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 12px;">🚀 RECOVERY PLAN</div>
                <div style="font-size: 13px; color: #e2e8f0; line-height: 1.7;">{time_impact.get('recovery_plan', 'No recovery plan specified.')}</div>
            </div>
            """, unsafe_allow_html=True)
        with st.expander("📋 View Delay Details", expanded=False):
            df_display = df_delay[['id', 'description', 'type', 'start_date', 'end_date', 'duration_days', 'impact_days',
                                  'responsible_party', 'status', 'financial_impact', 'mitigation']].copy()
            df_display['financial_impact'] = df_display['financial_impact'].apply(lambda x: format_currency(abs(x)) if x != 0 else 'N/A')
            st.dataframe(df_display, use_container_width=True, hide_index=True)

st.markdown("<div class='gold-divider'></div>", unsafe_allow_html=True)

# ═══════════════════════════════════════════════════════════════════════════════
# PROFESSIONAL FOOTER
# ═══════════════════════════════════════════════════════════════════════════════

st.markdown(f"""
<div style="
    background: linear-gradient(135deg, rgba(10, 14, 39, 0.95), rgba(15, 23, 42, 0.9));
    border-top: 1px solid rgba(245, 158, 11, 0.25);
    border-bottom: 1px solid rgba(245, 158, 11, 0.15);
    padding: 20px 40px;
    margin-top: 40px;
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    position: relative;
    overflow: hidden;
">
    <!-- Subtle gold glow at top -->
    <div style="
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 1px;
        background: linear-gradient(90deg, transparent, rgba(245, 158, 11, 0.6), transparent);
    "></div>

    <div style="
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 16px;
        position: relative;
        z-index: 1;
    ">
        <!-- LEFT: SAMCO | Egypt -->
        <div style="display: flex; align-items: center; gap: 12px;">
            <div style="
                width: 36px;
                height: 36px;
                background: linear-gradient(135deg, #f59e0b, #d97706);
                border-radius: 8px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 16px;
                font-weight: 800;
                color: #0a0e27;
                box-shadow: 0 0 15px rgba(245, 158, 11, 0.3);
            ">S</div>
            <div>
                <div style="
                    font-size: 15px;
                    font-weight: 700;
                    color: #f8fafc;
                    letter-spacing: 1px;
                    text-transform: uppercase;
                ">SAMCO</div>
                <div style="
                    font-size: 11px;
                    color: #94a3b8;
                    letter-spacing: 3px;
                    text-transform: uppercase;
                    margin-top: 2px;
                ">Egypt</div>
            </div>
        </div>

        <!-- CENTER: Dashboard badge -->
        <div style="
            background: rgba(245, 158, 11, 0.08);
            border: 1px solid rgba(245, 158, 11, 0.2);
            border-radius: 20px;
            padding: 6px 20px;
            font-size: 11px;
            color: #fbbf24;
            letter-spacing: 2px;
            text-transform: uppercase;
            font-weight: 600;
        ">
            🏗️ Master Dashboard v2.0
        </div>

        <!-- RIGHT: Designed by Engr. Ahmed Labib -->
        <div style="display: flex; align-items: center; gap: 8px;">
            <div style="
                font-size: 12px;
                color: #64748b;
                letter-spacing: 1px;
                text-transform: uppercase;
            ">Designed by</div>
            <div style="
                font-size: 13px;
                font-weight: 700;
                color: #fbbf24;
                letter-spacing: 0.5px;
                background: linear-gradient(135deg, #fbbf24, #f59e0b);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
                text-shadow: 0 0 20px rgba(245, 158, 11, 0.2);
            ">Engr. Ahmed Labib</div>
            <div style="
                width: 8px;
                height: 8px;
                background: linear-gradient(135deg, #10b981, #34d399);
                border-radius: 50%;
                box-shadow: 0 0 10px rgba(16, 185, 129, 0.5);
                animation: pulse-dot 2s infinite;
            "></div>
        </div>
    </div>

    <!-- Bottom subtle line -->
    <div style="
        margin-top: 16px;
        padding-top: 12px;
        border-top: 1px solid rgba(148, 163, 184, 0.08);
        display: flex;
        justify-content: center;
        gap: 24px;
        flex-wrap: wrap;
    ">
        <span style="font-size: 10px; color: #475569; letter-spacing: 2px; text-transform: uppercase;">Construction Intelligence</span>
        <span style="font-size: 10px; color: #475569;">•</span>
        <span style="font-size: 10px; color: #475569; letter-spacing: 2px; text-transform: uppercase;">Premium Edition</span>
        <span style="font-size: 10px; color: #475569;">•</span>
        <span style="font-size: 10px; color: #475569; letter-spacing: 2px; text-transform: uppercase;">Elite Tier</span>
    </div>
</div>
""", unsafe_allow_html=True)
