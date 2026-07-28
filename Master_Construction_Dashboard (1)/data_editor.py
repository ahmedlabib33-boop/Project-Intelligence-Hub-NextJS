"""
╔══════════════════════════════════════════════════════════════════════════════╗
║                    MASTER DASHBOARD - VISUAL DATA EDITOR                      ║
║              Interactive Data Management with Real-Time Preview               ║
╚══════════════════════════════════════════════════════════════════════════════╝

This module provides a comprehensive visual data editor that integrates
seamlessly with the Master Dashboard. Users can:

  1. Add new records to any section
  2. Edit existing records inline
  3. Delete records with confirmation
  4. See real-time preview of changes
  5. Export modified data to JSON
  6. Reset to original data

AI Agent Integration:
  - All edits are stored in session state
  - Changes persist across dashboard sections
  - Export generates AI-readable JSON files
"""

import streamlit as st
import pandas as pd
import json
from datetime import datetime
from typing import Dict, Any, List
from config import COLORS, get_status_color

# ═══════════════════════════════════════════════════════════════════════════════
# SESSION STATE MANAGEMENT
# ═══════════════════════════════════════════════════════════════════════════════

def init_editor_state(data: Dict[str, Any]):
    """Initialize editor session state with loaded data."""
    if 'editor_data' not in st.session_state:
        st.session_state.editor_data = data.copy()
    if 'edit_history' not in st.session_state:
        st.session_state.edit_history = []
    if 'edit_mode' not in st.session_state:
        st.session_state.edit_mode = False
    if 'last_saved' not in st.session_state:
        st.session_state.last_saved = None

def get_editor_data() -> Dict[str, Any]:
    """Get current editor data from session state."""
    return st.session_state.get('editor_data', {})

def update_editor_data(key: str, value: Any):
    """Update a specific section in editor data."""
    st.session_state.editor_data[key] = value
    st.session_state.edit_history.append({
        'timestamp': datetime.now().isoformat(),
        'action': 'update',
        'section': key,
    })

def reset_editor_data(original_data: Dict[str, Any]):
    """Reset editor data to original."""
    st.session_state.editor_data = original_data.copy()
    st.session_state.edit_history.append({
        'timestamp': datetime.now().isoformat(),
        'action': 'reset',
    })

def export_editor_data() -> str:
    """Export current editor data as JSON string."""
    return json.dumps(st.session_state.editor_data, indent=2, default=str)

# ═══════════════════════════════════════════════════════════════════════════════
# EDITOR UI COMPONENTS
# ═══════════════════════════════════════════════════════════════════════════════

def render_editor_toggle():
    """Render the edit mode toggle in the header."""
    col1, col2, col3 = st.columns([1, 1, 1])
    with col1:
        edit_mode = st.toggle("✏️ EDIT MODE", value=st.session_state.get('edit_mode', False),
                              help="Enable visual data editing across all dashboard sections")
        st.session_state.edit_mode = edit_mode
    with col2:
        if st.session_state.get('edit_mode'):
            if st.button("💾 EXPORT JSON", type="primary", use_container_width=True):
                json_str = export_editor_data()
                st.download_button(
                    label="⬇️ Download JSON",
                    data=json_str,
                    file_name=f"dashboard_data_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json",
                    mime="application/json",
                    use_container_width=True,
                )
    with col3:
        if st.session_state.get('edit_mode'):
            if st.button("🔄 RESET ALL", type="secondary", use_container_width=True):
                if 'original_data' in st.session_state:
                    reset_editor_data(st.session_state.original_data)
                    st.rerun()

    if st.session_state.get('edit_mode'):
        st.markdown(f"""
        <div style="background: linear-gradient(135deg, rgba(245, 158, 11, 0.15), rgba(244, 63, 94, 0.1));
                    border: 1px solid rgba(245, 158, 11, 0.4); border-radius: 12px; padding: 12px 20px;
                    margin-bottom: 20px; display: flex; align-items: center; gap: 12px;">
            <span style="font-size: 20px;">⚠️</span>
            <div>
                <div style="font-size: 14px; font-weight: 700; color: #fbbf24;">EDIT MODE ACTIVE</div>
                <div style="font-size: 12px; color: #94a3b8;">Changes are saved to session state. Export JSON when done.</div>
            </div>
        </div>
        """, unsafe_allow_html=True)

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION EDITORS
# ═══════════════════════════════════════════════════════════════════════════════

def edit_overview(data: Dict[str, Any]) -> Dict[str, Any]:
    """Visual editor for Project Overview section."""
    st.markdown(f"""
    <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(245, 158, 11, 0.3);
                border-radius: 16px; padding: 24px; margin-bottom: 20px; backdrop-filter: blur(15px);">
        <div style="font-size: 16px; font-weight: 700; color: #fbbf24; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 16px;">
            ✏️ EDIT PROJECT OVERVIEW
        </div>
    """, unsafe_allow_html=True)

    col1, col2 = st.columns(2)
    with col1:
        data['project_name'] = st.text_input("Project Name", value=data.get('project_name', ''), key="ov_name")
        data['project_code'] = st.text_input("Project Code", value=data.get('project_code', ''), key="ov_code")
        data['client'] = st.text_input("Client", value=data.get('client', ''), key="ov_client")
        data['contractor'] = st.text_input("Contractor", value=data.get('contractor', ''), key="ov_contractor")
        data['project_manager'] = st.text_input("Project Manager", value=data.get('project_manager', ''), key="ov_pm")
        data['location'] = st.text_input("Location", value=data.get('location', ''), key="ov_loc")
    with col2:
        data['contract_value'] = st.number_input("Contract Value", value=float(data.get('contract_value', 0)), step=1000000.0, format="%.0f", key="ov_value")
        data['overall_progress'] = st.slider("Overall Progress %", 0.0, 100.0, float(data.get('overall_progress', 0)), key="ov_progress")
        data['health_score'] = st.slider("Health Score", 0.0, 100.0, float(data.get('health_score', 0)), key="ov_health")
        data['total_activities'] = st.number_input("Total Activities", value=int(data.get('total_activities', 0)), step=1, key="ov_total")
        data['completed_activities'] = st.number_input("Completed Activities", value=int(data.get('completed_activities', 0)), step=1, key="ov_comp")
        data['total_manpower'] = st.number_input("Total Manpower", value=int(data.get('total_manpower', 0)), step=10, key="ov_man")

    col1, col2, col3, col4 = st.columns(4)
    with col1:
        data['start_date'] = st.date_input("Start Date", value=pd.to_datetime(data.get('start_date', datetime.now())), key="ov_start").strftime('%Y-%m-%d')
    with col2:
        data['finish_date'] = st.date_input("Finish Date", value=pd.to_datetime(data.get('finish_date', datetime.now())), key="ov_finish").strftime('%Y-%m-%d')
    with col3:
        actual_start = data.get('actual_start')
        data['actual_start'] = st.date_input("Actual Start", value=pd.to_datetime(actual_start) if actual_start else datetime.now(), key="ov_astart").strftime('%Y-%m-%d') if actual_start else None
    with col4:
        status_options = ["On Track", "At Risk", "Delayed", "Completed"]
        current_status = data.get('status', 'On Track')
        data['status'] = st.selectbox("Status", status_options, index=status_options.index(current_status) if current_status in status_options else 0, key="ov_status")

    data['description'] = st.text_area("Project Description", value=data.get('description', ''), height=80, key="ov_desc")

    st.markdown("</div>", unsafe_allow_html=True)
    return data


def edit_wbs(data: Dict[str, Any]) -> Dict[str, Any]:
    """Visual editor for WBS section."""
    st.markdown(f"""
    <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(59, 130, 246, 0.3);
                border-radius: 16px; padding: 24px; margin-bottom: 20px; backdrop-filter: blur(15px);">
        <div style="font-size: 16px; font-weight: 700; color: #60a5fa; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 16px;">
            ✏️ EDIT WORK BREAKDOWN STRUCTURE
        </div>
    """, unsafe_allow_html=True)

    items = data.get('wbs_items', [])

    with st.expander("➕ Add New WBS Item", expanded=False):
        col1, col2, col3, col4 = st.columns(4)
        with col1:
            new_id = st.text_input("WBS ID", placeholder="e.g., 1.8", key="wbs_new_id")
        with col2:
            new_name = st.text_input("Name", placeholder="Item name", key="wbs_new_name")
        with col3:
            new_parent = st.text_input("Parent ID", placeholder="e.g., 1.0 or empty", key="wbs_new_parent")
        with col4:
            new_level = st.number_input("Level", min_value=0, max_value=5, value=1, key="wbs_new_level")

        col1, col2, col3, col4 = st.columns(4)
        with col1:
            new_budget = st.number_input("Budget", value=0.0, step=100000.0, format="%.0f", key="wbs_new_budget")
        with col2:
            new_actual = st.number_input("Actual Cost", value=0.0, step=100000.0, format="%.0f", key="wbs_new_actual")
        with col3:
            new_progress = st.slider("Progress %", 0.0, 100.0, 0.0, key="wbs_new_progress")
        with col4:
            new_weight = st.number_input("Weight", value=0.0, step=1.0, format="%.1f", key="wbs_new_weight")

        status_opts = ["On Track", "Completed", "At Risk", "Delayed", "Planned"]
        new_status = st.selectbox("Status", status_opts, key="wbs_new_status")

        if st.button("➕ Add WBS Item", type="primary", key="wbs_add_btn"):
            if new_id and new_name:
                items.append({
                    "id": new_id, "name": new_name, "parent_id": new_parent if new_parent else None,
                    "level": new_level, "budget": new_budget, "actual_cost": new_actual,
                    "progress": new_progress, "status": new_status, "weight": new_weight
                })
                data['wbs_items'] = items
                st.success(f"✅ Added WBS item {new_id}")
                st.rerun()
            else:
                st.error("❌ ID and Name are required")

    st.markdown("<div style='font-size: 13px; font-weight: 700; color: #94a3b8; margin-bottom: 12px;'>EXISTING ITEMS</div>", unsafe_allow_html=True)

    for i, item in enumerate(items):
        with st.container():
            col1, col2, col3, col4, col5 = st.columns([1, 2, 1, 1, 0.5])
            with col1:
                items[i]['id'] = st.text_input("ID", value=item['id'], key=f"wbs_id_{i}", label_visibility="collapsed")
            with col2:
                items[i]['name'] = st.text_input("Name", value=item['name'], key=f"wbs_name_{i}", label_visibility="collapsed")
            with col3:
                items[i]['progress'] = st.number_input("Progress", value=float(item['progress']), min_value=0.0, max_value=100.0, step=1.0, key=f"wbs_prog_{i}", label_visibility="collapsed")
            with col4:
                status_opts = ["On Track", "Completed", "At Risk", "Delayed", "Planned"]
                current = item.get('status', 'On Track')
                items[i]['status'] = st.selectbox("Status", status_opts, index=status_opts.index(current) if current in status_opts else 0, key=f"wbs_stat_{i}", label_visibility="collapsed")
            with col5:
                if st.button("🗑️", key=f"wbs_del_{i}", help="Delete this item"):
                    items.pop(i)
                    data['wbs_items'] = items
                    st.rerun()

    data['wbs_items'] = items
    st.markdown("</div>", unsafe_allow_html=True)
    return data


def edit_activities(data: Dict[str, Any]) -> Dict[str, Any]:
    """Visual editor for Activities section."""
    st.markdown(f"""
    <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(6, 182, 212, 0.3);
                border-radius: 16px; padding: 24px; margin-bottom: 20px; backdrop-filter: blur(15px);">
        <div style="font-size: 16px; font-weight: 700; color: #06b6d4; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 16px;">
            ✏️ EDIT ACTIVITIES
        </div>
    """, unsafe_allow_html=True)

    activities = data.get('activities', [])

    with st.expander("➕ Add New Activity", expanded=False):
        col1, col2, col3 = st.columns(3)
        with col1:
            new_id = st.text_input("Activity ID", placeholder="A001", key="act_new_id")
            new_name = st.text_input("Name", placeholder="Activity name", key="act_new_name")
            new_wbs = st.text_input("WBS ID", placeholder="1.1", key="act_new_wbs")
        with col2:
            new_start = st.date_input("Start Date", key="act_new_start").strftime('%Y-%m-%d')
            new_finish = st.date_input("Finish Date", key="act_new_finish").strftime('%Y-%m-%d')
            new_duration = st.number_input("Duration (days)", min_value=1, value=30, key="act_new_dur")
        with col3:
            new_progress = st.slider("Progress %", 0.0, 100.0, 0.0, key="act_new_prog")
            status_opts = ["Planned", "In Progress", "On Track", "At Risk", "Delayed", "Completed"]
            new_status = st.selectbox("Status", status_opts, key="act_new_status")
            new_critical = st.checkbox("Critical Path", key="act_new_crit")

        if st.button("➕ Add Activity", type="primary", key="act_add_btn"):
            if new_id and new_name:
                activities.append({
                    "id": new_id, "name": new_name, "wbs_id": new_wbs,
                    "start_date": new_start, "finish_date": new_finish,
                    "actual_start": None, "actual_finish": None,
                    "duration": new_duration, "progress": new_progress,
                    "status": new_status, "resources": [], "predecessors": [],
                    "critical_path": new_critical
                })
                data['activities'] = activities
                st.success(f"✅ Added activity {new_id}")
                st.rerun()
            else:
                st.error("❌ ID and Name are required")

    st.markdown("<div style='font-size: 13px; font-weight: 700; color: #94a3b8; margin-bottom: 12px;'>EXISTING ACTIVITIES</div>", unsafe_allow_html=True)

    for i, act in enumerate(activities):
        with st.container():
            col1, col2, col3, col4, col5, col6 = st.columns([1, 2, 1, 1, 1, 0.5])
            with col1:
                activities[i]['id'] = st.text_input("ID", value=act['id'], key=f"act_id_{i}", label_visibility="collapsed")
            with col2:
                activities[i]['name'] = st.text_input("Name", value=act['name'], key=f"act_name_{i}", label_visibility="collapsed")
            with col3:
                activities[i]['progress'] = st.number_input("Progress", value=float(act['progress']), min_value=0.0, max_value=100.0, step=1.0, key=f"act_prog_{i}", label_visibility="collapsed")
            with col4:
                status_opts = ["Planned", "In Progress", "On Track", "At Risk", "Delayed", "Completed"]
                current = act.get('status', 'Planned')
                activities[i]['status'] = st.selectbox("Status", status_opts, index=status_opts.index(current) if current in status_opts else 0, key=f"act_stat_{i}", label_visibility="collapsed")
            with col5:
                activities[i]['critical_path'] = st.checkbox("Critical", value=act.get('critical_path', False), key=f"act_crit_{i}", label_visibility="collapsed")
            with col6:
                if st.button("🗑️", key=f"act_del_{i}"):
                    activities.pop(i)
                    data['activities'] = activities
                    st.rerun()

    data['activities'] = activities
    st.markdown("</div>", unsafe_allow_html=True)
    return data


def edit_milestones(data: Dict[str, Any]) -> Dict[str, Any]:
    """Visual editor for Milestones section."""
    st.markdown(f"""
    <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(139, 92, 246, 0.3);
                border-radius: 16px; padding: 24px; margin-bottom: 20px; backdrop-filter: blur(15px);">
        <div style="font-size: 16px; font-weight: 700; color: #a78bfa; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 16px;">
            ✏️ EDIT MILESTONES
        </div>
    """, unsafe_allow_html=True)

    milestones = data.get('milestones', [])

    with st.expander("➕ Add New Milestone", expanded=False):
        col1, col2, col3 = st.columns(3)
        with col1:
            new_id = st.text_input("ID", placeholder="M001", key="ms_new_id")
            new_name = st.text_input("Name", placeholder="Milestone name", key="ms_new_name")
        with col2:
            new_date = st.date_input("Planned Date", key="ms_new_date").strftime('%Y-%m-%d')
            new_weight = st.number_input("Weight", value=10.0, step=1.0, key="ms_new_weight")
        with col3:
            status_opts = ["Planned", "On Track", "At Risk", "Completed"]
            new_status = st.selectbox("Status", status_opts, key="ms_new_status")
            new_desc = st.text_input("Description", placeholder="Brief description", key="ms_new_desc")

        if st.button("➕ Add Milestone", type="primary", key="ms_add_btn"):
            if new_id and new_name:
                milestones.append({
                    "id": new_id, "name": new_name, "planned_date": new_date,
                    "actual_date": None, "forecast_date": None,
                    "status": new_status, "weight": new_weight, "description": new_desc
                })
                data['milestones'] = milestones
                st.success(f"✅ Added milestone {new_id}")
                st.rerun()
            else:
                st.error("❌ ID and Name are required")

    st.markdown("<div style='font-size: 13px; font-weight: 700; color: #94a3b8; margin-bottom: 12px;'>EXISTING MILESTONES</div>", unsafe_allow_html=True)

    for i, ms in enumerate(milestones):
        with st.container():
            col1, col2, col3, col4, col5 = st.columns([1, 2, 1.5, 1, 0.5])
            with col1:
                milestones[i]['id'] = st.text_input("ID", value=ms['id'], key=f"ms_id_{i}", label_visibility="collapsed")
            with col2:
                milestones[i]['name'] = st.text_input("Name", value=ms['name'], key=f"ms_name_{i}", label_visibility="collapsed")
            with col3:
                milestones[i]['planned_date'] = st.date_input("Date", value=pd.to_datetime(ms['planned_date']), key=f"ms_date_{i}", label_visibility="collapsed").strftime('%Y-%m-%d')
            with col4:
                status_opts = ["Planned", "On Track", "At Risk", "Completed"]
                current = ms.get('status', 'Planned')
                milestones[i]['status'] = st.selectbox("Status", status_opts, index=status_opts.index(current) if current in status_opts else 0, key=f"ms_stat_{i}", label_visibility="collapsed")
            with col5:
                if st.button("🗑️", key=f"ms_del_{i}"):
                    milestones.pop(i)
                    data['milestones'] = milestones
                    st.rerun()

    data['milestones'] = milestones
    st.markdown("</div>", unsafe_allow_html=True)
    return data


def edit_contracts(data: Dict[str, Any]) -> Dict[str, Any]:
    """Visual editor for Contracts section."""
    st.markdown(f"""
    <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(139, 92, 246, 0.3);
                border-radius: 16px; padding: 24px; margin-bottom: 20px; backdrop-filter: blur(15px);">
        <div style="font-size: 16px; font-weight: 700; color: #a78bfa; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 16px;">
            ✏️ EDIT CONTRACTS
        </div>
    """, unsafe_allow_html=True)

    contracts = data.get('contracts', [])

    with st.expander("➕ Add New Contract", expanded=False):
        col1, col2, col3 = st.columns(3)
        with col1:
            new_id = st.text_input("ID", placeholder="C001", key="ct_new_id")
            new_no = st.text_input("Contract No", placeholder="CT-001", key="ct_new_no")
            new_title = st.text_input("Title", placeholder="Contract title", key="ct_new_title")
        with col2:
            new_contractor = st.text_input("Contractor", placeholder="Company name", key="ct_new_contractor")
            new_value = st.number_input("Contract Value", value=0.0, step=1000000.0, format="%.0f", key="ct_new_value")
            new_var = st.number_input("Variations", value=0.0, step=100000.0, format="%.0f", key="ct_new_var")
        with col3:
            new_comp = st.slider("Completion %", 0.0, 100.0, 0.0, key="ct_new_comp")
            status_opts = ["Active", "Completed", "On Hold", "Terminated"]
            new_status = st.selectbox("Status", status_opts, key="ct_new_status")

        if st.button("➕ Add Contract", type="primary", key="ct_add_btn"):
            if new_id and new_title:
                total_val = new_value + new_var
                contracts.append({
                    "id": new_id, "contract_no": new_no, "title": new_title,
                    "contractor": new_contractor, "contract_value": new_value,
                    "approved_variations": new_var, "total_value": total_val,
                    "invoiced_to_date": 0, "paid_to_date": 0, "balance": total_val,
                    "completion_percent": new_comp, "status": new_status,
                    "start_date": datetime.now().strftime('%Y-%m-%d'),
                    "finish_date": datetime.now().strftime('%Y-%m-%d'),
                    "retention": 0
                })
                data['contracts'] = contracts
                st.success(f"✅ Added contract {new_id}")
                st.rerun()
            else:
                st.error("❌ ID and Title are required")

    st.markdown("<div style='font-size: 13px; font-weight: 700; color: #94a3b8; margin-bottom: 12px;'>EXISTING CONTRACTS</div>", unsafe_allow_html=True)

    for i, ct in enumerate(contracts):
        with st.container():
            col1, col2, col3, col4, col5, col6 = st.columns([1, 2, 1.5, 1, 1, 0.5])
            with col1:
                contracts[i]['id'] = st.text_input("ID", value=ct['id'], key=f"ct_id_{i}", label_visibility="collapsed")
            with col2:
                contracts[i]['title'] = st.text_input("Title", value=ct['title'], key=f"ct_title_{i}", label_visibility="collapsed")
            with col3:
                contracts[i]['contractor'] = st.text_input("Contractor", value=ct['contractor'], key=f"ct_con_{i}", label_visibility="collapsed")
            with col4:
                contracts[i]['contract_value'] = st.number_input("Value", value=float(ct['contract_value']), step=100000.0, format="%.0f", key=f"ct_val_{i}", label_visibility="collapsed")
            with col5:
                contracts[i]['completion_percent'] = st.number_input("Comp%", value=float(ct['completion_percent']), min_value=0.0, max_value=100.0, step=1.0, key=f"ct_comp_{i}", label_visibility="collapsed")
            with col6:
                if st.button("🗑️", key=f"ct_del_{i}"):
                    contracts.pop(i)
                    data['contracts'] = contracts
                    st.rerun()

    data['contracts'] = contracts
    st.markdown("</div>", unsafe_allow_html=True)
    return data


def edit_risks(data: Dict[str, Any]) -> Dict[str, Any]:
    """Visual editor for Risks section."""
    st.markdown(f"""
    <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(244, 63, 94, 0.3);
                border-radius: 16px; padding: 24px; margin-bottom: 20px; backdrop-filter: blur(15px);">
        <div style="font-size: 16px; font-weight: 700; color: #fb7185; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 16px;">
            ✏️ EDIT RISKS
        </div>
    """, unsafe_allow_html=True)

    risks = data.get('risks', [])

    with st.expander("➕ Add New Risk", expanded=False):
        col1, col2, col3 = st.columns(3)
        with col1:
            new_id = st.text_input("ID", placeholder="R001", key="risk_new_id")
            new_desc = st.text_input("Description", placeholder="Risk description", key="risk_new_desc")
            new_cat = st.selectbox("Category", ["Technical", "Commercial", "Schedule", "Safety", "External"], key="risk_new_cat")
        with col2:
            new_prob = st.slider("Probability (1-5)", 1, 5, 3, key="risk_new_prob")
            new_impact = st.slider("Impact (1-5)", 1, 5, 3, key="risk_new_impact")
            new_owner = st.text_input("Owner", placeholder="Risk owner", key="risk_new_owner")
        with col3:
            new_mitigation = st.text_input("Mitigation", placeholder="Mitigation plan", key="risk_new_mit")
            status_opts = ["Active", "Mitigated", "Closed", "Realized"]
            new_status = st.selectbox("Status", status_opts, key="risk_new_status")

        if st.button("➕ Add Risk", type="primary", key="risk_add_btn"):
            if new_id and new_desc:
                score = new_prob * new_impact
                risks.append({
                    "id": new_id, "description": new_desc, "category": new_cat,
                    "probability": new_prob, "impact": new_impact, "score": score,
                    "status": new_status, "mitigation": new_mitigation,
                    "owner": new_owner, "date_identified": datetime.now().strftime('%Y-%m-%d'),
                    "target_date": datetime.now().strftime('%Y-%m-%d')
                })
                data['risks'] = risks
                st.success(f"✅ Added risk {new_id} (Score: {score})")
                st.rerun()
            else:
                st.error("❌ ID and Description are required")

    st.markdown("<div style='font-size: 13px; font-weight: 700; color: #94a3b8; margin-bottom: 12px;'>EXISTING RISKS</div>", unsafe_allow_html=True)

    for i, risk in enumerate(risks):
        with st.container():
            col1, col2, col3, col4, col5, col6, col7 = st.columns([0.8, 2.5, 1, 0.8, 0.8, 1, 0.5])
            with col1:
                risks[i]['id'] = st.text_input("ID", value=risk['id'], key=f"risk_id_{i}", label_visibility="collapsed")
            with col2:
                risks[i]['description'] = st.text_input("Desc", value=risk['description'], key=f"risk_desc_{i}", label_visibility="collapsed")
            with col3:
                risks[i]['category'] = st.selectbox("Cat", ["Technical", "Commercial", "Schedule", "Safety", "External"], 
                                                     index=["Technical", "Commercial", "Schedule", "Safety", "External"].index(risk['category']) if risk['category'] in ["Technical", "Commercial", "Schedule", "Safety", "External"] else 0,
                                                     key=f"risk_cat_{i}", label_visibility="collapsed")
            with col4:
                risks[i]['probability'] = st.number_input("P", value=int(risk['probability']), min_value=1, max_value=5, step=1, key=f"risk_prob_{i}", label_visibility="collapsed")
            with col5:
                risks[i]['impact'] = st.number_input("I", value=int(risk['impact']), min_value=1, max_value=5, step=1, key=f"risk_imp_{i}", label_visibility="collapsed")
            with col6:
                status_opts = ["Active", "Mitigated", "Closed", "Realized"]
                current = risk.get('status', 'Active')
                risks[i]['status'] = st.selectbox("Stat", status_opts, index=status_opts.index(current) if current in status_opts else 0, key=f"risk_stat_{i}", label_visibility="collapsed")
            with col7:
                if st.button("🗑️", key=f"risk_del_{i}"):
                    risks.pop(i)
                    data['risks'] = risks
                    st.rerun()
            risks[i]['score'] = risks[i]['probability'] * risks[i]['impact']

    data['risks'] = risks
    st.markdown("</div>", unsafe_allow_html=True)
    return data


def edit_delays(data: Dict[str, Any]) -> Dict[str, Any]:
    """Visual editor for Delay & Time Impact section."""
    st.markdown(f"""
    <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(244, 63, 94, 0.3);
                border-radius: 16px; padding: 24px; margin-bottom: 20px; backdrop-filter: blur(15px);">
        <div style="font-size: 16px; font-weight: 700; color: #fb7185; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 16px;">
            ✏️ EDIT DELAYS & TIME IMPACT
        </div>
    """, unsafe_allow_html=True)

    delays = data.get('delays', [])
    time_impact = data.get('time_impact', {})

    st.markdown("<div style='font-size: 13px; font-weight: 700; color: #fbbf24; margin-bottom: 12px;'>TIME IMPACT SUMMARY</div>", unsafe_allow_html=True)
    col1, col2, col3, col4 = st.columns(4)
    with col1:
        time_impact['original_completion'] = st.date_input("Original Completion", value=pd.to_datetime(time_impact.get('original_completion', datetime.now())), key="ti_orig").strftime('%Y-%m-%d')
    with col2:
        time_impact['current_forecast'] = st.date_input("Current Forecast", value=pd.to_datetime(time_impact.get('current_forecast', datetime.now())), key="ti_fore").strftime('%Y-%m-%d')
    with col3:
        time_impact['total_delay_days'] = st.number_input("Total Delay Days", value=int(time_impact.get('total_delay_days', 0)), step=1, key="ti_total")
    with col4:
        time_impact['excusable_days'] = st.number_input("Excusable Days", value=int(time_impact.get('excusable_days', 0)), step=1, key="ti_exc")

    col1, col2, col3 = st.columns(3)
    with col1:
        time_impact['non_excusable_days'] = st.number_input("Non-Excusable Days", value=int(time_impact.get('non_excusable_days', 0)), step=1, key="ti_nonexc")
    with col2:
        time_impact['compensable_days'] = st.number_input("Compensable Days", value=int(time_impact.get('compensable_days', 0)), step=1, key="ti_comp")
    with col3:
        time_impact['concurrent_days'] = st.number_input("Concurrent Days", value=int(time_impact.get('concurrent_days', 0)), step=1, key="ti_conc")

    time_impact['recovery_plan'] = st.text_area("Recovery Plan", value=time_impact.get('recovery_plan', ''), height=80, key="ti_recovery")
    data['time_impact'] = time_impact

    st.markdown("<div style='font-size: 13px; font-weight: 700; color: #fbbf24; margin-top: 20px; margin-bottom: 12px;'>INDIVIDUAL DELAYS</div>", unsafe_allow_html=True)

    with st.expander("➕ Add New Delay", expanded=False):
        col1, col2, col3 = st.columns(3)
        with col1:
            new_id = st.text_input("ID", placeholder="D001", key="del_new_id")
            new_desc = st.text_input("Description", placeholder="Delay description", key="del_new_desc")
        with col2:
            type_opts = ["Excusable", "Non-Excusable", "Compensable", "Concurrent"]
            new_type = st.selectbox("Type", type_opts, key="del_new_type")
            new_start = st.date_input("Start Date", key="del_new_start").strftime('%Y-%m-%d')
            new_end = st.date_input("End Date", key="del_new_end").strftime('%Y-%m-%d')
        with col3:
            new_impact = st.number_input("Impact Days", min_value=0, value=0, key="del_new_impact")
            new_party = st.text_input("Responsible Party", placeholder="Party name", key="del_new_party")
            new_status = st.selectbox("Status", ["Active", "Resolved", "Disputed"], key="del_new_status")

        if st.button("➕ Add Delay", type="primary", key="del_add_btn"):
            if new_id and new_desc:
                start_dt = datetime.strptime(new_start, '%Y-%m-%d')
                end_dt = datetime.strptime(new_end, '%Y-%m-%d')
                duration = (end_dt - start_dt).days
                delays.append({
                    "id": new_id, "description": new_desc, "type": new_type,
                    "start_date": new_start, "end_date": new_end,
                    "duration_days": duration, "impact_days": new_impact,
                    "responsible_party": new_party, "status": new_status,
                    "financial_impact": 0, "mitigation": ""
                })
                data['delays'] = delays
                st.success(f"✅ Added delay {new_id}")
                st.rerun()
            else:
                st.error("❌ ID and Description are required")

    for i, delay in enumerate(delays):
        with st.container():
            col1, col2, col3, col4, col5, col6 = st.columns([0.8, 2.5, 1, 1, 1, 0.5])
            with col1:
                delays[i]['id'] = st.text_input("ID", value=delay['id'], key=f"del_id_{i}", label_visibility="collapsed")
            with col2:
                delays[i]['description'] = st.text_input("Desc", value=delay['description'], key=f"del_desc_{i}", label_visibility="collapsed")
            with col3:
                type_opts = ["Excusable", "Non-Excusable", "Compensable", "Concurrent"]
                current = delay.get('type', 'Excusable')
                delays[i]['type'] = st.selectbox("Type", type_opts, index=type_opts.index(current) if current in type_opts else 0, key=f"del_type_{i}", label_visibility="collapsed")
            with col4:
                delays[i]['impact_days'] = st.number_input("Impact", value=int(delay['impact_days']), min_value=0, step=1, key=f"del_imp_{i}", label_visibility="collapsed")
            with col5:
                status_opts = ["Active", "Resolved", "Disputed"]
                current = delay.get('status', 'Active')
                delays[i]['status'] = st.selectbox("Stat", status_opts, index=status_opts.index(current) if current in status_opts else 0, key=f"del_stat_{i}", label_visibility="collapsed")
            with col6:
                if st.button("🗑️", key=f"del_del_{i}"):
                    delays.pop(i)
                    data['delays'] = delays
                    st.rerun()

    data['delays'] = delays
    st.markdown("</div>", unsafe_allow_html=True)
    return data


def edit_letters(data: Dict[str, Any]) -> Dict[str, Any]:
    """Visual editor for Letters Intelligence section."""
    st.markdown(f"""
    <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(59, 130, 246, 0.3);
                border-radius: 16px; padding: 24px; margin-bottom: 20px; backdrop-filter: blur(15px);">
        <div style="font-size: 16px; font-weight: 700; color: #60a5fa; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 16px;">
            ✏️ EDIT LETTERS INTELLIGENCE
        </div>
    """, unsafe_allow_html=True)

    threads = data.get('threads', [])

    with st.expander("➕ Add New Thread", expanded=False):
        col1, col2, col3 = st.columns(3)
        with col1:
            new_id = st.text_input("Thread ID", placeholder="LT-001", key="lt_new_id")
            new_subject = st.text_input("Subject", placeholder="Thread subject", key="lt_new_subj")
        with col2:
            new_parties = st.text_input("Parties (comma-separated)", placeholder="Party A, Party B", key="lt_new_parties")
            new_priority = st.selectbox("Priority", ["High", "Medium", "Low"], key="lt_new_pri")
        with col3:
            new_category = st.selectbox("Category", ["Claim", "Technical", "Commercial", "Variation"], key="lt_new_cat")
            new_summary = st.text_input("Summary", placeholder="Brief summary", key="lt_new_sum")

        if st.button("➕ Add Thread", type="primary", key="lt_add_btn"):
            if new_id and new_subject:
                parties_list = [p.strip() for p in new_parties.split(",")] if new_parties else []
                threads.append({
                    "thread_id": new_id, "subject": new_subject, "parties": parties_list,
                    "letter_count": 0, "last_date": datetime.now().strftime('%Y-%m-%d'),
                    "status": "Open", "priority": new_priority, "category": new_category,
                    "summary": new_summary, "letters": []
                })
                data['threads'] = threads
                st.success(f"✅ Added thread {new_id}")
                st.rerun()
            else:
                st.error("❌ ID and Subject are required")

    st.markdown("<div style='font-size: 13px; font-weight: 700; color: #94a3b8; margin-bottom: 12px;'>EXISTING THREADS</div>", unsafe_allow_html=True)

    for i, thread in enumerate(threads):
        with st.container():
            col1, col2, col3, col4, col5 = st.columns([1, 2.5, 1, 1, 0.5])
            with col1:
                threads[i]['thread_id'] = st.text_input("ID", value=thread['thread_id'], key=f"lt_id_{i}", label_visibility="collapsed")
            with col2:
                threads[i]['subject'] = st.text_input("Subject", value=thread['subject'], key=f"lt_subj_{i}", label_visibility="collapsed")
            with col3:
                threads[i]['priority'] = st.selectbox("Priority", ["High", "Medium", "Low"], index=["High", "Medium", "Low"].index(thread['priority']) if thread['priority'] in ["High", "Medium", "Low"] else 1, key=f"lt_pri_{i}", label_visibility="collapsed")
            with col4:
                threads[i]['status'] = st.selectbox("Status", ["Open", "Closed", "Pending Response"], index=["Open", "Closed", "Pending Response"].index(thread['status']) if thread['status'] in ["Open", "Closed", "Pending Response"] else 0, key=f"lt_stat_{i}", label_visibility="collapsed")
            with col5:
                if st.button("🗑️", key=f"lt_del_{i}"):
                    threads.pop(i)
                    data['threads'] = threads
                    st.rerun()

    data['threads'] = threads
    st.markdown("</div>", unsafe_allow_html=True)
    return data


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN EDITOR INTERFACE
# ═══════════════════════════════════════════════════════════════════════════════

def render_full_editor(data: Dict[str, Any]) -> Dict[str, Any]:
    """Render the complete visual data editor."""
    st.markdown(f"""
    <div style="background: linear-gradient(135deg, rgba(245, 158, 11, 0.1), rgba(139, 92, 246, 0.05));
                border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 20px; padding: 30px; margin-bottom: 30px;">
        <h2 style="font-size: 28px; font-weight: 800; background: linear-gradient(135deg, #fbbf24, #f59e0b, #d97706);
                   -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin: 0;">
            ✏️ VISUAL DATA EDITOR
        </h2>
        <p style="color: #94a3b8; margin-top: 8px; font-size: 14px;">
            Edit any section below. Changes update charts in real-time. Export JSON when done.
        </p>
    </div>
    """, unsafe_allow_html=True)

    tabs = st.tabs([
        "🏗️ Overview", "📊 WBS", "⚡ Activities", "🎯 Milestones",
        "📜 Contracts", "✉️ Letters", "⚠️ Risks", "⏱️ Delays"
    ])

    with tabs[0]:
        if 'overview' in data:
            data['overview'] = edit_overview(data['overview'])
        else:
            st.info("No overview data found. Sample data will be used.")

    with tabs[1]:
        if 'wbs' in data:
            data['wbs'] = edit_wbs(data['wbs'])
        else:
            st.info("No WBS data found.")

    with tabs[2]:
        if 'activities' in data:
            data['activities'] = edit_activities(data['activities'])
        else:
            st.info("No activities data found.")

    with tabs[3]:
        if 'milestones' in data:
            data['milestones'] = edit_milestones(data['milestones'])
        else:
            st.info("No milestones data found.")

    with tabs[4]:
        if 'contracts' in data:
            data['contracts'] = edit_contracts(data['contracts'])
        else:
            st.info("No contracts data found.")

    with tabs[5]:
        if 'letters' in data:
            data['letters'] = edit_letters(data['letters'])
        else:
            st.info("No letters data found.")

    with tabs[6]:
        if 'risks' in data:
            data['risks'] = edit_risks(data['risks'])
        else:
            st.info("No risks data found.")

    with tabs[7]:
        if 'delay' in data:
            data['delay'] = edit_delays(data['delay'])
        else:
            st.info("No delay data found.")

    st.session_state.editor_data = data

    st.markdown("<div class='gold-divider'></div>", unsafe_allow_html=True)

    col1, col2 = st.columns(2)
    with col1:
        st.markdown(f"""
        <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 16px; padding: 24px;">
            <div style="font-size: 16px; font-weight: 700; color: #10b981; margin-bottom: 12px;">💾 EXPORT DATA</div>
            <div style="font-size: 13px; color: #e2e8f0; margin-bottom: 16px;">Download your edited data as a JSON file to use in other applications or share with your team.</div>
        </div>
        """, unsafe_allow_html=True)
        json_str = json.dumps(data, indent=2, default=str)
        st.download_button(
            label="⬇️ Download Full JSON",
            data=json_str,
            file_name=f"master_dashboard_data_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json",
            mime="application/json",
            use_container_width=True,
        )
    with col2:
        st.markdown(f"""
        <div style="background: rgba(244, 63, 94, 0.1); border: 1px solid rgba(244, 63, 94, 0.3); border-radius: 16px; padding: 24px;">
            <div style="font-size: 16px; font-weight: 700; color: #f43f5e; margin-bottom: 12px;">🔄 RESET DATA</div>
            <div style="font-size: 13px; color: #e2e8f0; margin-bottom: 16px;">Revert all changes back to the originally loaded data. This action cannot be undone.</div>
        </div>
        """, unsafe_allow_html=True)
        if st.button("🔄 Reset to Original Data", type="secondary", use_container_width=True):
            if 'original_data' in st.session_state:
                reset_editor_data(st.session_state.original_data)
                st.success("✅ Data reset to original!")
                st.rerun()
            else:
                st.error("❌ Original data not available")

    return data
