#!/usr/bin/env python3
# =============================================================================
# SAMCO PROJECT INTELLIGENCE HUB — SMART CHARTS GENERATOR
# =============================================================================
# ROYA-BIG PROJECT PHASE01 (B1-4)
# This script generates all professional charts matching the SAMCO dashboard
# dark theme design. Each chart is assigned to a specific tab.
#
# USAGE:
#   python samco_charts.py --tab overview      # Generate Overview charts
#   python samco_charts.py --tab wbs           # Generate WBS charts
#   python samco_charts.py --tab activities    # Generate Activities charts
#   python samco_charts.py --tab milestones    # Generate Milestones charts
#   python samco_charts.py --tab scurve        # Generate S-Curve charts
#   python samco_charts.py --tab evm           # Generate EVM Analysis charts
#   python samco_charts.py --tab contracts     # Generate Contracts charts
#   python samco_charts.py --tab risks         # Generate Risks charts
#   python samco_charts.py --tab delay         # Generate Delay Analysis charts
#   python samco_charts.py --all               # Generate ALL charts
#
# OUTPUT: Charts saved to ./samco_charts_output/ directory
# =============================================================================

import os
import sys
import argparse
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import FancyBboxPatch, Circle, Wedge
import matplotlib.gridspec as gridspec

# =============================================================================
# DESIGN TOKENS — Match SAMCO Dashboard Dark Theme
# =============================================================================
TOKENS = {
    'bg': '#0B1120',
    'bg_card': '#0F172A',
    'border': 'rgba(255,255,255,0.06)',
    'text_primary': '#f1f5f9',
    'text_secondary': '#94a3b8',
    'text_muted': '#64748b',
    'teal': '#06b6d4',
    'green': '#10b981',
    'red': '#f43f5e',
    'amber': '#f59e0b',
    'purple': '#8b5cf6',
    'pink': '#ec4899',
    'blue': '#3b82f6',
    'gray': '#64748b',
}

# Matplotlib setup for dark theme
plt.rcParams['figure.facecolor'] = TOKENS['bg']
plt.rcParams['axes.facecolor'] = TOKENS['bg_card']
plt.rcParams['axes.edgecolor'] = 'rgba(255,255,255,0.06)'
plt.rcParams['axes.labelcolor'] = TOKENS['text_secondary']
plt.rcParams['text.color'] = TOKENS['text_primary']
plt.rcParams['xtick.color'] = TOKENS['text_muted']
plt.rcParams['ytick.color'] = TOKENS['text_muted']
plt.rcParams['grid.color'] = 'rgba(255,255,255,0.03)'
plt.rcParams['grid.linewidth'] = 0.5
plt.rcParams['font.family'] = 'sans-serif'
plt.rcParams['font.sans-serif'] = ['Inter', 'SF Pro Display', 'Segoe UI', 'Arial']
plt.rcParams['figure.dpi'] = 150

OUTPUT_DIR = './samco_charts_output'
os.makedirs(OUTPUT_DIR, exist_ok=True)

def save_fig(name, tab):
    """Save figure with proper naming for tab assignment."""
    path = os.path.join(OUTPUT_DIR, f'{tab}_{name}.png')
    plt.savefig(path, bbox_inches='tight', facecolor=TOKENS['bg'], edgecolor='none')
    plt.close()
    print(f"  Saved: {path}")

# =============================================================================
# HELPER: Card-style figure setup
# =============================================================================
def create_card_figure(figsize=(10, 6), title="", badge="", badge_color=None):
    """Create a figure with card-style styling matching SAMCO dashboard."""
    fig, ax = plt.subplots(figsize=figsize)
    fig.patch.set_facecolor(TOKENS['bg'])
    ax.set_facecolor(TOKENS['bg_card'])

    # Add card border effect
    for spine in ax.spines.values():
        spine.set_color('rgba(255,255,255,0.06)')
        spine.set_linewidth(1)

    # Title with accent bar
    if title:
        ax.set_title(title, color=TOKENS['text_primary'], fontsize=11, 
                     fontweight=600, loc='left', pad=20, 
                     bbox=dict(boxstyle='round,pad=0.3', facecolor='none', edgecolor='none'))

    # Badge
    if badge and badge_color:
        ax.text(0.98, 0.98, badge, transform=ax.transAxes, fontsize=8,
                color=badge_color, fontweight=600, ha='right', va='top',
                bbox=dict(boxstyle='round,pad=0.4', facecolor=f'{badge_color}20', 
                         edgecolor=f'{badge_color}40', linewidth=1))

    return fig, ax

# =============================================================================
# TAB 1: OVERVIEW CHARTS
# AI Agent Assignment: Render these in the Overview tab
# =============================================================================
def generate_overview_charts():
    print("\n[TAB: Overview] Generating charts...")

    # --- Chart 1: S-Curve ---
    fig, ax = create_card_figure((14, 6), "Schedule Performance (S-Curve)", "CRITICAL DELAY", TOKENS['red'])
    months = ['Sep-25','Oct-25','Nov-25','Dec-25','Jan-26','Feb-26','Mar-26','Apr-26',
              'May-26','Jun-26','Jul-26','Aug-26','Sep-26','Oct-26','Nov-26','Dec-26',
              'Jan-27','Feb-27','Mar-27','Apr-27']
    planned = [2,5,10,16,23,31,40,48,55,62,68,73,78,82,86,89,92,95,97,100]
    actual = [2,4,7,10,12,14,16,18,20,22,24,26,28,30,None,None,None,None,None,None]
    forecast = [None,None,None,None,None,None,None,None,None,None,None,None,None,30,35,42,50,60,72,85]

    ax.plot(months, planned, color=TOKENS['teal'], linewidth=2.5, label='Planned', zorder=3)
    ax.fill_between(months, planned, alpha=0.08, color=TOKENS['teal'])
    ax.plot(months[:14], actual[:14], color=TOKENS['green'], linewidth=2.5, marker='o', 
            markersize=4, label='Actual', zorder=3)
    ax.fill_between(months[:14], actual[:14], alpha=0.08, color=TOKENS['green'])
    ax.plot(months[13:], forecast[13:], color=TOKENS['amber'], linewidth=2.5, 
            linestyle='--', marker='o', markersize=4, label='Forecast', zorder=3)
    ax.fill_between(months[13:], forecast[13:], alpha=0.05, color=TOKENS['amber'])

    ax.set_ylim(0, 105)
    ax.set_ylabel('Progress %', color=TOKENS['text_secondary'], fontsize=10)
    ax.legend(loc='upper left', frameon=False, labelcolor=TOKENS['text_secondary'])
    ax.grid(True, alpha=0.3)
    plt.xticks(rotation=45, ha='right', fontsize=8)
    save_fig("s_curve", "overview")

    # --- Chart 2: Progress Gauge ---
    fig, ax = plt.subplots(figsize=(6, 6))
    fig.patch.set_facecolor(TOKENS['bg'])
    ax.set_facecolor(TOKENS['bg_card'])

    # Background arc
    theta = np.linspace(225, 225+270, 100)
    r = 1.0
    x_bg = r * np.cos(np.radians(theta))
    y_bg = r * np.sin(np.radians(theta))
    ax.plot(x_bg, y_bg, color='rgba(255,255,255,0.04)', linewidth=20, solid_capstyle='round')

    # Planned arc (subtle)
    planned_theta = np.linspace(225, 225 + 270 * 0.653, 100)
    x_plan = 0.92 * np.cos(np.radians(planned_theta))
    y_plan = 0.92 * np.sin(np.radians(planned_theta))
    ax.plot(x_plan, y_plan, color=f'{TOKENS["teal"]}30', linewidth=12, solid_capstyle='round')

    # Actual arc
    actual_theta = np.linspace(225, 225 + 270 * 0.307, 100)
    x_act = 1.0 * np.cos(np.radians(actual_theta))
    y_act = 1.0 * np.sin(np.radians(actual_theta))
    ax.plot(x_act, y_act, color=TOKENS['teal'], linewidth=20, solid_capstyle='round')

    ax.text(0, 0.1, '30.7%', fontsize=36, fontweight=700, ha='center', va='center', 
            color=TOKENS['text_primary'])
    ax.text(0, -0.15, 'Complete', fontsize=10, ha='center', va='center', 
            color=TOKENS['text_muted'], fontweight=500)
    ax.set_xlim(-1.3, 1.3)
    ax.set_ylim(-1.3, 1.3)
    ax.set_aspect('equal')
    ax.axis('off')
    save_fig("progress_gauge", "overview")

    # --- Chart 3: Phase Progress Bars ---
    fig, ax = create_card_figure((8, 5), "Phase Progress", "BY PHASE", TOKENS['teal'])
    phases = ['Engineering', 'Procurement', 'Construction', 'Commissioning', 'Close-out']
    values = [42, 28, 18, 0, 0]
    colors = [TOKENS['teal'], TOKENS['purple'], TOKENS['green'], TOKENS['amber'], TOKENS['red']]

    y_pos = np.arange(len(phases))
    bars = ax.barh(y_pos, values, color=colors, height=0.5, edgecolor='none')
    for bar, val in zip(bars, values):
        ax.text(bar.get_width() + 2, bar.get_y() + bar.get_height()/2, 
                f'{val}%', va='center', ha='left', color=TOKENS['text_secondary'], 
                fontsize=11, fontweight=600)
    ax.set_yticks(y_pos)
    ax.set_yticklabels(phases, color=TOKENS['text_secondary'], fontsize=10)
    ax.set_xlim(0, 100)
    ax.set_xlabel('Progress %', color=TOKENS['text_muted'], fontsize=9)
    ax.invert_yaxis()
    ax.grid(True, alpha=0.2, axis='x')
    save_fig("phase_progress", "overview")

    # --- Chart 4: Activity Status Donut ---
    fig, ax = create_card_figure((6, 5), "Activity Status", "1,363 TOTAL", TOKENS['gray'])
    labels = ['Complete\n412', 'In Progress\n298', 'Not Started\n653']
    sizes = [412, 298, 653]
    colors = [TOKENS['green'], TOKENS['teal'], TOKENS['amber']]

    wedges, texts = ax.pie(sizes, colors=colors, startangle=90, 
                            wedgeprops=dict(width=0.5, edgecolor=TOKENS['bg_card'], linewidth=3))
    for i, (wedge, label) in enumerate(zip(wedges, labels)):
        ang = (wedge.theta2 - wedge.theta1)/2. + wedge.theta1
        y = np.sin(np.deg2rad(ang))
        x = np.cos(np.deg2rad(ang))
        ax.annotate(label, xy=(x*0.75, y*0.75), ha='center', va='center',
                   fontsize=9, fontweight=600, color=TOKENS['text_primary'])
    ax.set_aspect('equal')
    save_fig("activity_status", "overview")

    # --- Chart 5: Discipline Radar ---
    fig, ax = plt.subplots(figsize=(6, 6), subplot_kw=dict(polar=True))
    fig.patch.set_facecolor(TOKENS['bg'])
    ax.set_facecolor(TOKENS['bg_card'])

    categories = ['Civil', 'Structural', 'MEP', 'Architectural', 'Finishes']
    planned = [68, 72, 55, 48, 35]
    actual = [42, 38, 22, 18, 12]

    angles = np.linspace(0, 2*np.pi, len(categories), endpoint=False).tolist()
    planned += planned[:1]
    actual += actual[:1]
    angles += angles[:1]

    ax.plot(angles, planned, 'o-', color=TOKENS['teal'], linewidth=2, label='Planned')
    ax.fill(angles, planned, alpha=0.15, color=TOKENS['teal'])
    ax.plot(angles, actual, 'o-', color=TOKENS['green'], linewidth=2, label='Actual')
    ax.fill(angles, actual, alpha=0.15, color=TOKENS['green'])

    ax.set_xticks(angles[:-1])
    ax.set_xticklabels(categories, color=TOKENS['text_secondary'], fontsize=9)
    ax.set_ylim(0, 100)
    ax.set_yticks([25, 50, 75, 100])
    ax.set_yticklabels(['25%', '50%', '75%', '100%'], color=TOKENS['text_muted'], fontsize=7)
    ax.legend(loc='upper right', bbox_to_anchor=(1.3, 1.1), frameon=False, 
              labelcolor=TOKENS['text_secondary'])
    ax.grid(color='rgba(255,255,255,0.05)')
    save_fig("discipline_radar", "overview")

    # --- Chart 6: EVM Mini ---
    fig, ax = create_card_figure((10, 5), "Earned Value Trend", "EGP MILLIONS", TOKENS['teal'])
    months = ['Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun']
    pv = [18.4,36.7,55.1,73.4,91.8,110.2,128.5,146.9,165.2,183.6]
    ev = [18.4,32.1,42.5,51.2,58.9,65.4,71.8,78.2,85.6,113.1]
    ac = [18.4,32.1,42.5,51.2,58.9,65.4,71.8,78.2,85.6,113.1]

    ax.plot(months, pv, color=TOKENS['teal'], linewidth=2.5, marker='o', markersize=4, label='PV')
    ax.fill_between(months, pv, alpha=0.08, color=TOKENS['teal'])
    ax.plot(months, ev, color=TOKENS['green'], linewidth=2.5, marker='o', markersize=4, label='EV')
    ax.fill_between(months, ev, alpha=0.08, color=TOKENS['green'])
    ax.plot(months, ac, color=TOKENS['purple'], linewidth=2.5, marker='o', markersize=4, label='AC')
    ax.fill_between(months, ac, alpha=0.08, color=TOKENS['purple'])

    ax.legend(loc='upper left', frameon=False, labelcolor=TOKENS['text_secondary'])
    ax.grid(True, alpha=0.3)
    ax.set_ylabel('EGP Millions', color=TOKENS['text_muted'], fontsize=9)
    save_fig("evm_trend", "overview")

    # --- Chart 7: SPI/CPI Mini ---
    fig, ax = create_card_figure((10, 5), "Performance Indices", "SPI ALERT", TOKENS['red'])
    months = ['Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun']
    spi = [1.00,0.95,0.88,0.82,0.75,0.68,0.62,0.58,0.52,0.45]
    cpi = [1.00,1.02,1.01,1.00,1.00,1.01,1.00,1.00,1.00,1.00]

    ax.plot(months, spi, color=TOKENS['red'], linewidth=2.5, marker='o', markersize=5, label='SPI')
    ax.fill_between(months, spi, alpha=0.1, color=TOKENS['red'])
    ax.plot(months, cpi, color=TOKENS['green'], linewidth=2.5, marker='o', markersize=5, label='CPI')
    ax.fill_between(months, cpi, alpha=0.1, color=TOKENS['green'])
    ax.axhline(y=1.0, color='rgba(255,255,255,0.15)', linestyle='--', linewidth=1.5, label='Threshold')

    ax.legend(loc='lower left', frameon=False, labelcolor=TOKENS['text_secondary'])
    ax.grid(True, alpha=0.3)
    ax.set_ylim(0, 1.4)
    save_fig("performance_indices", "overview")

    # --- Chart 8: Data Quality ---
    fig, ax = create_card_figure((8, 5), "Data Quality", "100%", TOKENS['green'])
    metrics = ['Completeness', 'Accuracy', 'Timeliness', 'Consistency', 'Validity']
    values = [100, 98, 87, 95, 100]
    colors = [TOKENS['green'], TOKENS['teal'], TOKENS['amber'], TOKENS['blue'], TOKENS['purple']]

    y_pos = np.arange(len(metrics))
    bars = ax.barh(y_pos, values, color=colors, height=0.4, edgecolor='none')
    for bar, val in zip(bars, values):
        ax.text(bar.get_width() + 1, bar.get_y() + bar.get_height()/2, 
                f'{val}%', va='center', ha='left', color=TOKENS['text_secondary'], 
                fontsize=11, fontweight=600)
    ax.set_yticks(y_pos)
    ax.set_yticklabels(metrics, color=TOKENS['text_secondary'], fontsize=10)
    ax.set_xlim(0, 110)
    ax.invert_yaxis()
    ax.grid(True, alpha=0.2, axis='x')
    save_fig("data_quality", "overview")

    # --- Chart 9: Contract vs Payment ---
    fig, ax = create_card_figure((8, 5), "Contract vs Payment", "EGP MILLIONS", TOKENS['teal'])
    labels = ['Contract Value', 'Paid Amount', 'Spent (AC)', 'Remaining']
    values = [367.3, 110.3, 113.1, 256.9]
    colors = [TOKENS['teal'], TOKENS['green'], TOKENS['purple'], TOKENS['amber']]

    y_pos = np.arange(len(labels))
    bars = ax.barh(y_pos, values, color=colors, height=0.5, edgecolor='none')
    for bar, val in zip(bars, values):
        ax.text(bar.get_width() + 5, bar.get_y() + bar.get_height()/2, 
                f'EGP {val}M', va='center', ha='left', color=TOKENS['text_secondary'], 
                fontsize=10, fontweight=600)
    ax.set_yticks(y_pos)
    ax.set_yticklabels(labels, color=TOKENS['text_secondary'], fontsize=10)
    ax.set_xlim(0, 420)
    ax.invert_yaxis()
    ax.grid(True, alpha=0.2, axis='x')
    save_fig("contract_payment", "overview")

    print("  [Overview] Done — 9 charts generated")

# =============================================================================
# TAB 2: WBS CHARTS
# AI Agent Assignment: Assign to WBS tab
# =============================================================================
def generate_wbs_charts():
    print("\n[TAB: WBS] Generating charts...")

    # --- Chart 1: WBS Progress Distribution ---
    fig, ax = create_card_figure((10, 5), "WBS Progress Distribution", "BY WBS", TOKENS['teal'])
    labels = ['Prelim', 'Key Dates', 'Milestones', 'Mobilize', 'Engineering', 'Procurement', 'Construction']
    values = [100, 100, 50, 0, 42, 28, 18]
    colors = [TOKENS['green'], TOKENS['green'], TOKENS['amber'], TOKENS['red'], 
              TOKENS['amber'], TOKENS['amber'], TOKENS['red']]

    bars = ax.bar(labels, values, color=colors, width=0.6, edgecolor='none')
    for bar, val in zip(bars, values):
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 2, 
                f'{val}%', ha='center', va='bottom', color=TOKENS['text_secondary'], 
                fontsize=10, fontweight=600)
    ax.set_ylim(0, 115)
    ax.set_ylabel('Progress %', color=TOKENS['text_muted'], fontsize=9)
    ax.grid(True, alpha=0.3, axis='y')
    plt.xticks(rotation=30, ha='right', fontsize=9)
    save_fig("progress_distribution", "wbs")

    # --- Chart 2: WBS Duration Breakdown ---
    fig, ax = create_card_figure((10, 5), "WBS Duration Breakdown", "DAYS", TOKENS['gray'])
    labels = ['Prelim', 'Key Dates', 'Milestones', 'Mobilize', 'Engineering', 'Procurement', 'Construction']
    values = [0, 344, 344, 0, 247, 238, 445]
    colors = [TOKENS['gray'], TOKENS['teal'], TOKENS['teal'], TOKENS['gray'], 
              TOKENS['blue'], TOKENS['purple'], TOKENS['green']]

    y_pos = np.arange(len(labels))
    bars = ax.barh(y_pos, values, color=colors, height=0.5, edgecolor='none')
    for bar, val in zip(bars, values):
        ax.text(bar.get_width() + 5, bar.get_y() + bar.get_height()/2, 
                f'{val} days', va='center', ha='left', color=TOKENS['text_secondary'], 
                fontsize=10, fontweight=600)
    ax.set_yticks(y_pos)
    ax.set_yticklabels(labels, color=TOKENS['text_secondary'], fontsize=10)
    ax.set_xlim(0, 500)
    ax.invert_yaxis()
    ax.grid(True, alpha=0.2, axis='x')
    save_fig("duration_breakdown", "wbs")

    print("  [WBS] Done — 2 charts generated")

# =============================================================================
# TAB 3: ACTIVITIES CHARTS
# AI Agent Assignment: Assign to Activities tab
# =============================================================================
def generate_activities_charts():
    print("\n[TAB: Activities] Generating charts...")

    # --- Chart 1: Status Distribution ---
    fig, ax = create_card_figure((6, 5), "Status Distribution", "1,363 TOTAL", TOKENS['gray'])
    labels = ['Complete', 'In Progress', 'Not Started', 'On Hold']
    sizes = [412, 298, 653, 0]
    colors = [TOKENS['green'], TOKENS['teal'], TOKENS['amber'], TOKENS['gray']]

    wedges, texts = ax.pie(sizes, colors=colors, startangle=90)
    for i, (wedge, label, size) in enumerate(zip(wedges, labels, sizes)):
        ang = (wedge.theta2 - wedge.theta1)/2. + wedge.theta1
        y = np.sin(np.deg2rad(ang))
        x = np.cos(np.deg2rad(ang))
        ax.annotate(f'{label}\n{size}', xy=(x*0.6, y*0.6), ha='center', va='center',
                   fontsize=9, fontweight=600, color=TOKENS['text_primary'])
    ax.set_aspect('equal')
    save_fig("status_distribution", "activities")

    # --- Chart 2: Critical Path ---
    fig, ax = create_card_figure((6, 5), "Critical Path Activities", "173 CRITICAL", TOKENS['red'])
    labels = ['Critical Path', 'Near Critical', 'Normal Float']
    sizes = [173, 245, 945]
    colors = [TOKENS['red'], TOKENS['amber'], TOKENS['green']]

    wedges, texts = ax.pie(sizes, colors=colors, startangle=90, 
                            wedgeprops=dict(width=0.5))
    for i, (wedge, label, size) in enumerate(zip(wedges, labels, sizes)):
        ang = (wedge.theta2 - wedge.theta1)/2. + wedge.theta1
        y = np.sin(np.deg2rad(ang))
        x = np.cos(np.deg2rad(ang))
        ax.annotate(f'{label}\n{size}', xy=(x*0.75, y*0.75), ha='center', va='center',
                   fontsize=8, fontweight=600, color=TOKENS['text_primary'])
    ax.set_aspect('equal')
    save_fig("critical_path", "activities")

    # --- Chart 3: Float Distribution ---
    fig, ax = create_card_figure((10, 5), "Float Distribution", "TOTAL FLOAT", TOKENS['teal'])
    labels = ['0 days', '1-7 days', '8-30 days', '31-90 days', '>90 days']
    values = [173, 198, 312, 425, 255]
    colors = [TOKENS['red'], TOKENS['amber'], TOKENS['teal'], TOKENS['blue'], TOKENS['green']]

    bars = ax.bar(labels, values, color=colors, width=0.6, edgecolor='none')
    for bar, val in zip(bars, values):
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 5, 
                str(val), ha='center', va='bottom', color=TOKENS['text_secondary'], 
                fontsize=10, fontweight=600)
    ax.set_ylabel('Activity Count', color=TOKENS['text_muted'], fontsize=9)
    ax.grid(True, alpha=0.3, axis='y')
    save_fig("float_distribution", "activities")

    # --- Chart 4: Monthly Completion ---
    fig, ax = create_card_figure((10, 5), "Monthly Activity Completion", "TREND", TOKENS['green'])
    months = ['Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun']
    completed = [45, 62, 58, 48, 42, 38, 35, 32, 28, 25]
    started = [120, 145, 138, 125, 110, 95, 88, 75, 62, 55]

    x = np.arange(len(months))
    width = 0.35
    ax.bar(x - width/2, completed, width, label='Completed', color=TOKENS['teal'], edgecolor='none')
    ax.bar(x + width/2, started, width, label='Started', color=f'{TOKENS["teal"]}50', edgecolor='none')
    ax.set_xticks(x)
    ax.set_xticklabels(months, color=TOKENS['text_muted'], fontsize=9)
    ax.legend(frameon=False, labelcolor=TOKENS['text_secondary'])
    ax.grid(True, alpha=0.3, axis='y')
    save_fig("monthly_completion", "activities")

    # --- Chart 5: Party Workload ---
    fig, ax = create_card_figure((10, 5), "Responsible Party Workload", "BY PARTY", TOKENS['teal'])
    parties = ['SAMCO', 'ROYA', 'Consultant', 'Subcon A', 'Subcon B', 'Vendor']
    values = [890, 45, 210, 125, 68, 25]
    colors = [TOKENS['teal'], TOKENS['green'], TOKENS['blue'], TOKENS['purple'], TOKENS['pink'], TOKENS['amber']]

    y_pos = np.arange(len(parties))
    bars = ax.barh(y_pos, values, color=colors, height=0.5, edgecolor='none')
    for bar, val in zip(bars, values):
        ax.text(bar.get_width() + 10, bar.get_y() + bar.get_height()/2, 
                str(val), va='center', ha='left', color=TOKENS['text_secondary'], 
                fontsize=10, fontweight=600)
    ax.set_yticks(y_pos)
    ax.set_yticklabels(parties, color=TOKENS['text_secondary'], fontsize=10)
    ax.invert_yaxis()
    ax.grid(True, alpha=0.2, axis='x')
    save_fig("party_workload", "activities")

    print("  [Activities] Done — 5 charts generated")

# =============================================================================
# TAB 4: MILESTONES CHARTS
# AI Agent Assignment: Assign to Milestones tab
# =============================================================================
def generate_milestones_charts():
    print("\n[TAB: Milestones] Generating charts...")

    # --- Chart 1: Schedule Health ---
    fig, ax = create_card_figure((6, 5), "Schedule Health", "SPI 0.45", TOKENS['red'])
    labels = ['On Track', 'Delayed', 'At Risk']
    sizes = [1, 2, 1]
    colors = [TOKENS['green'], TOKENS['red'], TOKENS['amber']]

    wedges, texts = ax.pie(sizes, colors=colors, startangle=90, 
                            wedgeprops=dict(width=0.5))
    for i, (wedge, label, size) in enumerate(zip(wedges, labels, sizes)):
        ang = (wedge.theta2 - wedge.theta1)/2. + wedge.theta1
        y = np.sin(np.deg2rad(ang))
        x = np.cos(np.deg2rad(ang))
        ax.annotate(f'{label}\n{size}', xy=(x*0.75, y*0.75), ha='center', va='center',
                   fontsize=9, fontweight=600, color=TOKENS['text_primary'])
    ax.set_aspect('equal')
    save_fig("schedule_health", "milestones")

    # --- Chart 2: Variance Trend ---
    fig, ax = create_card_figure((10, 5), "Milestone Variance Trend", "1,675 DAYS", TOKENS['amber'])
    months = ['Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun']
    delay = [0, 45, 180, 420, 680, 890, 1120, 1340, 1560, 1675]

    ax.plot(months, delay, color=TOKENS['red'], linewidth=2.5, marker='o', markersize=5)
    ax.fill_between(months, delay, alpha=0.1, color=TOKENS['red'])
    ax.set_ylabel('Cumulative Delay (days)', color=TOKENS['text_muted'], fontsize=9)
    ax.grid(True, alpha=0.3)
    save_fig("variance_trend", "milestones")

    # --- Chart 3: Type Breakdown ---
    fig, ax = create_card_figure((8, 5), "Milestone Type Breakdown", "BY TYPE", TOKENS['teal'])
    labels = ['Start Milestone', 'Finish Milestone', 'Interim']
    values = [2, 1, 1]
    colors = [TOKENS['teal'], TOKENS['green'], TOKENS['amber']]

    bars = ax.bar(labels, values, color=colors, width=0.5, edgecolor='none')
    for bar, val in zip(bars, values):
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.05, 
                str(val), ha='center', va='bottom', color=TOKENS['text_secondary'], 
                fontsize=11, fontweight=600)
    ax.set_ylabel('Count', color=TOKENS['text_muted'], fontsize=9)
    ax.grid(True, alpha=0.3, axis='y')
    save_fig("type_breakdown", "milestones")

    print("  [Milestones] Done — 3 charts generated")

# =============================================================================
# TAB 5: S-CURVE CHARTS
# AI Agent Assignment: Assign to S-Curve tab
# =============================================================================
def generate_scurve_charts():
    print("\n[TAB: S-Curve] Generating charts...")

    # --- Chart 1: Master S-Curve ---
    fig, ax = create_card_figure((14, 7), "Master S-Curve — Cumulative Progress", "CRITICAL DELAY", TOKENS['red'])
    months = ['Sep-25','Oct-25','Nov-25','Dec-25','Jan-26','Feb-26','Mar-26','Apr-26',
              'May-26','Jun-26','Jul-26','Aug-26','Sep-26','Oct-26','Nov-26','Dec-26',
              'Jan-27','Feb-27','Mar-27','Apr-27']
    planned = [2,5,10,16,23,31,40,48,55,62,68,73,78,82,86,89,92,95,97,100]
    actual = [2,4,7,10,12,14,16,18,20,22,24,26,28,30,None,None,None,None,None,None]
    forecast = [None,None,None,None,None,None,None,None,None,None,None,None,None,30,35,42,50,60,72,85]

    ax.plot(months, planned, color=TOKENS['teal'], linewidth=2.5, label='Planned', zorder=3)
    ax.fill_between(months, planned, alpha=0.08, color=TOKENS['teal'])
    ax.plot(months[:14], actual[:14], color=TOKENS['green'], linewidth=2.5, marker='o', 
            markersize=4, label='Actual', zorder=3)
    ax.fill_between(months[:14], actual[:14], alpha=0.08, color=TOKENS['green'])
    ax.plot(months[13:], forecast[13:], color=TOKENS['amber'], linewidth=2.5, 
            linestyle='--', marker='o', markersize=4, label='Forecast', zorder=3)
    ax.fill_between(months[13:], forecast[13:], alpha=0.05, color=TOKENS['amber'])

    # Variance band
    v_upper = [min(v+5, 100) for v in planned]
    v_lower = [max(v-5, 0) for v in planned]
    ax.fill_between(months, v_lower, v_upper, alpha=0.06, color=TOKENS['red'], label='Variance band')

    ax.set_ylim(0, 105)
    ax.set_ylabel('Progress %', color=TOKENS['text_secondary'], fontsize=10)
    ax.legend(loc='upper left', frameon=False, labelcolor=TOKENS['text_secondary'])
    ax.grid(True, alpha=0.3)
    plt.xticks(rotation=45, ha='right', fontsize=8)
    save_fig("master_scurve", "scurve")

    # --- Chart 2: By Discipline ---
    fig, ax = create_card_figure((10, 5), "S-Curve by Discipline", "MULTI-LAYER", TOKENS['teal'])
    months = ['Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun']
    civil = [5,12,22,35,42,45,48,50,52,55]
    struct = [3,8,15,25,32,35,36,37,38,38]
    mep = [2,5,10,15,18,20,21,21,22,22]
    arch = [1,4,8,12,15,16,17,17,18,18]
    finishes = [0,2,4,7,10,11,11,12,12,12]

    ax.plot(months, civil, color=TOKENS['teal'], linewidth=2, marker='o', markersize=3, label='Civil')
    ax.plot(months, struct, color=TOKENS['blue'], linewidth=2, marker='o', markersize=3, label='Structural')
    ax.plot(months, mep, color=TOKENS['purple'], linewidth=2, marker='o', markersize=3, label='MEP')
    ax.plot(months, arch, color=TOKENS['pink'], linewidth=2, marker='o', markersize=3, label='Architectural')
    ax.plot(months, finishes, color=TOKENS['amber'], linewidth=2, marker='o', markersize=3, label='Finishes')

    ax.set_ylim(0, 100)
    ax.legend(loc='upper left', frameon=False, labelcolor=TOKENS['text_secondary'], fontsize=9)
    ax.grid(True, alpha=0.3)
    save_fig("discipline_scurve", "scurve")

    # --- Chart 3: Variance Over Time ---
    fig, ax = create_card_figure((10, 5), "Progress Variance Over Time", "NEGATIVE", TOKENS['red'])
    months = ['Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun']
    variance = [0, -1, -3, -6, -8, -12, -18, -22, -28, -34.6]
    colors = [TOKENS['red'] if v < -20 else TOKENS['amber'] if v < -10 else TOKENS['teal'] for v in variance]

    bars = ax.bar(months, variance, color=colors, width=0.6, edgecolor='none')
    for bar, val in zip(bars, variance):
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() - 1, 
                f'{val}%', ha='center', va='top', color='white', 
                fontsize=9, fontweight=600)
    ax.axhline(y=0, color='rgba(255,255,255,0.2)', linewidth=1)
    ax.set_ylabel('Variance %', color=TOKENS['text_muted'], fontsize=9)
    ax.grid(True, alpha=0.3, axis='y')
    save_fig("variance_over_time", "scurve")

    print("  [S-Curve] Done — 3 charts generated")

# =============================================================================
# TAB 6: EVM ANALYSIS CHARTS
# AI Agent Assignment: Assign to EVM Analysis tab
# =============================================================================
def generate_evm_charts():
    print("\n[TAB: EVM Analysis] Generating charts...")

    # --- Chart 1: Burn-Up ---
    fig, ax = create_card_figure((14, 7), "EVM Burn-Up Chart", "EGP MILLIONS", TOKENS['teal'])
    months = ['Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun']
    pv = [18.4,36.7,55.1,73.4,91.8,110.2,128.5,146.9,165.2,183.6]
    ev = [18.4,32.1,42.5,51.2,58.9,65.4,71.8,78.2,85.6,113.1]
    ac = [18.4,32.1,42.5,51.2,58.9,65.4,71.8,78.2,85.6,113.1]
    eac = [367.3]*10

    ax.plot(months, pv, color=TOKENS['teal'], linewidth=2.5, marker='o', markersize=4, label='PV')
    ax.fill_between(months, pv, alpha=0.08, color=TOKENS['teal'])
    ax.plot(months, ev, color=TOKENS['green'], linewidth=2.5, marker='o', markersize=4, label='EV')
    ax.fill_between(months, ev, alpha=0.08, color=TOKENS['green'])
    ax.plot(months, ac, color=TOKENS['purple'], linewidth=2.5, marker='o', markersize=4, label='AC')
    ax.fill_between(months, ac, alpha=0.08, color=TOKENS['purple'])
    ax.plot(months, eac, color=TOKENS['amber'], linewidth=2, linestyle='--', label='EAC (BAC)')

    ax.legend(loc='upper left', frameon=False, labelcolor=TOKENS['text_secondary'])
    ax.grid(True, alpha=0.3)
    ax.set_ylabel('EGP Millions', color=TOKENS['text_muted'], fontsize=9)
    save_fig("burnup", "evm")

    # --- Chart 2: Variance Waterfall ---
    fig, ax = create_card_figure((8, 5), "EVM Variance Waterfall", "NEGATIVE SV", TOKENS['red'])
    labels = ['BAC','PV','EV','AC','SV','CV','EAC','VAC']
    values = [367.3, 252.8, 113.1, 113.1, -139.7, 0, 367.3, 0]
    colors = [TOKENS['teal'], TOKENS['blue'], TOKENS['green'], TOKENS['purple'], 
              TOKENS['red'], TOKENS['green'], TOKENS['amber'], TOKENS['gray']]

    bars = ax.bar(labels, values, color=colors, width=0.6, edgecolor='none')
    for bar, val in zip(bars, values):
        y_pos = bar.get_height() + 5 if val >= 0 else bar.get_height() - 15
        ax.text(bar.get_x() + bar.get_width()/2, y_pos, 
                f'{val:+.1f}', ha='center', va='bottom' if val >= 0 else 'top', 
                color=TOKENS['text_secondary'], fontsize=9, fontweight=600)
    ax.axhline(y=0, color='rgba(255,255,255,0.2)', linewidth=1)
    ax.set_ylabel('EGP Millions', color=TOKENS['text_muted'], fontsize=9)
    ax.grid(True, alpha=0.3, axis='y')
    plt.xticks(rotation=30, ha='right', fontsize=9)
    save_fig("variance_waterfall", "evm")

    # --- Chart 3: SPI Trend ---
    fig, ax = create_card_figure((10, 5), "SPI Trend", "DECLINING", TOKENS['red'])
    months = ['Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun']
    spi = [1.00,0.95,0.88,0.82,0.75,0.68,0.62,0.58,0.52,0.45]

    ax.plot(months, spi, color=TOKENS['red'], linewidth=2.5, marker='o', markersize=5)
    ax.fill_between(months, spi, alpha=0.1, color=TOKENS['red'])
    ax.axhline(y=1.0, color='rgba(255,255,255,0.15)', linestyle='--', linewidth=1.5, label='Threshold')
    ax.set_ylim(0, 1.4)
    ax.legend(frameon=False, labelcolor=TOKENS['text_secondary'])
    ax.grid(True, alpha=0.3)
    save_fig("spi_trend", "evm")

    # --- Chart 4: CPI Trend ---
    fig, ax = create_card_figure((10, 5), "CPI Trend", "STABLE", TOKENS['green'])
    months = ['Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun']
    cpi = [1.00,1.02,1.01,1.00,1.00,1.01,1.00,1.00,1.00,1.00]

    ax.plot(months, cpi, color=TOKENS['green'], linewidth=2.5, marker='o', markersize=5)
    ax.fill_between(months, cpi, alpha=0.1, color=TOKENS['green'])
    ax.axhline(y=1.0, color='rgba(255,255,255,0.15)', linestyle='--', linewidth=1.5, label='Threshold')
    ax.set_ylim(0.8, 1.2)
    ax.legend(frameon=False, labelcolor=TOKENS['text_secondary'])
    ax.grid(True, alpha=0.3)
    save_fig("cpi_trend", "evm")

    print("  [EVM Analysis] Done — 4 charts generated")

# =============================================================================
# TAB 7: CONTRACTS CHARTS
# AI Agent Assignment: Assign to Contracts tab
# =============================================================================
def generate_contracts_charts():
    print("\n[TAB: Contracts] Generating charts...")

    # --- Chart 1: Payment History ---
    fig, ax = create_card_figure((10, 5), "Payment History", "BY PERIOD", TOKENS['teal'])
    labels = ['P1','P2','P3','P4','P5','P6','P7','P8']
    values = [15.2, 22.8, 18.5, 12.4, 8.6, 14.2, 10.8, 7.8]

    bars = ax.bar(labels, values, color=TOKENS['teal'], width=0.6, edgecolor='none')
    for bar, val in zip(bars, values):
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.3, 
                f'EGP {val}M', ha='center', va='bottom', color=TOKENS['text_secondary'], 
                fontsize=9, fontweight=600)
    ax.set_ylabel('Certified Amount (EGP M)', color=TOKENS['text_muted'], fontsize=9)
    ax.grid(True, alpha=0.3, axis='y')
    save_fig("payment_history", "contracts")

    # --- Chart 2: Cash Flow ---
    fig, ax = create_card_figure((10, 5), "Contract Cash Flow", "FORECAST", TOKENS['green'])
    months = ['Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug']
    planned = [18, 36, 55, 73, 92, 110, 129, 147, 165, 184, 220, 260]
    actual = [18, 32, 43, 51, 59, 65, 72, 78, 86, 113, 140, 170]

    ax.plot(months, planned, color=TOKENS['teal'], linewidth=2.5, marker='o', markersize=4, label='Planned Cash Out')
    ax.fill_between(months, planned, alpha=0.08, color=TOKENS['teal'])
    ax.plot(months, actual, color=TOKENS['green'], linewidth=2.5, marker='o', markersize=4, label='Actual Cash Out')
    ax.fill_between(months, actual, alpha=0.08, color=TOKENS['green'])
    ax.legend(frameon=False, labelcolor=TOKENS['text_secondary'])
    ax.grid(True, alpha=0.3)
    ax.set_ylabel('EGP Millions', color=TOKENS['text_muted'], fontsize=9)
    save_fig("cash_flow", "contracts")

    # --- Chart 3: Payment Status ---
    fig, ax = create_card_figure((6, 5), "Payment Status Breakdown", "8 PAYMENTS", TOKENS['gray'])
    labels = ['Paid', 'Under Payment', 'Pending', 'Disputed']
    sizes = [5, 2, 1, 0]
    colors = [TOKENS['green'], TOKENS['teal'], TOKENS['amber'], TOKENS['red']]

    wedges, texts = ax.pie(sizes, colors=colors, startangle=90, 
                            wedgeprops=dict(width=0.5))
    for i, (wedge, label, size) in enumerate(zip(wedges, labels, sizes)):
        ang = (wedge.theta2 - wedge.theta1)/2. + wedge.theta1
        y = np.sin(np.deg2rad(ang))
        x = np.cos(np.deg2rad(ang))
        ax.annotate(f'{label}\n{size}', xy=(x*0.75, y*0.75), ha='center', va='center',
                   fontsize=9, fontweight=600, color=TOKENS['text_primary'])
    ax.set_aspect('equal')
    save_fig("payment_status", "contracts")

    # --- Chart 4: Variations ---
    fig, ax = create_card_figure((8, 5), "Contract vs Variations", "VALUE", TOKENS['teal'])
    labels = ['Original', 'Approved Var.', 'Pending Var.', 'Total']
    values = [367.3, 0, 0, 367.3]
    colors = [TOKENS['teal'], TOKENS['green'], TOKENS['amber'], TOKENS['blue']]

    bars = ax.bar(labels, values, color=colors, width=0.5, edgecolor='none')
    for bar, val in zip(bars, values):
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 5, 
                f'EGP {val}M', ha='center', va='bottom', color=TOKENS['text_secondary'], 
                fontsize=9, fontweight=600)
    ax.set_ylabel('EGP Millions', color=TOKENS['text_muted'], fontsize=9)
    ax.grid(True, alpha=0.3, axis='y')
    plt.xticks(rotation=15, ha='right', fontsize=9)
    save_fig("variations", "contracts")

    print("  [Contracts] Done — 4 charts generated")

# =============================================================================
# TAB 8: RISKS CHARTS
# AI Agent Assignment: Assign to Risks tab
# =============================================================================
def generate_risks_charts():
    print("\n[TAB: Risks] Generating charts...")

    # --- Chart 1: Risk Category ---
    fig, ax = create_card_figure((8, 5), "Risk Category Breakdown", "BY CATEGORY", TOKENS['teal'])
    labels = ['Schedule', 'Cost', 'Quality', 'Safety', 'External']
    values = [2, 0, 0, 0, 0]
    colors = [TOKENS['red'], TOKENS['amber'], TOKENS['teal'], TOKENS['purple'], TOKENS['blue']]

    bars = ax.bar(labels, values, color=colors, width=0.5, edgecolor='none')
    for bar, val in zip(bars, values):
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.05, 
                str(val), ha='center', va='bottom', color=TOKENS['text_secondary'], 
                fontsize=11, fontweight=600)
    ax.set_ylabel('Risk Count', color=TOKENS['text_muted'], fontsize=9)
    ax.grid(True, alpha=0.3, axis='y')
    save_fig("category_breakdown", "risks")

    # --- Chart 2: Risk Status ---
    fig, ax = create_card_figure((6, 5), "Risk Status", "OPEN/CLOSED", TOKENS['gray'])
    labels = ['Open', 'Closed', 'Mitigated']
    sizes = [1, 1, 0]
    colors = [TOKENS['red'], TOKENS['green'], TOKENS['teal']]

    wedges, texts = ax.pie(sizes, colors=colors, startangle=90, 
                            wedgeprops=dict(width=0.5))
    for i, (wedge, label, size) in enumerate(zip(wedges, labels, sizes)):
        ang = (wedge.theta2 - wedge.theta1)/2. + wedge.theta1
        y = np.sin(np.deg2rad(ang))
        x = np.cos(np.deg2rad(ang))
        ax.annotate(f'{label}\n{size}', xy=(x*0.75, y*0.75), ha='center', va='center',
                   fontsize=9, fontweight=600, color=TOKENS['text_primary'])
    ax.set_aspect('equal')
    save_fig("status", "risks")

    # --- Chart 3: Risk Trend ---
    fig, ax = create_card_figure((10, 5), "Risk Trend Over Time", "INCREASING", TOKENS['amber'])
    months = ['Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun']
    scores = [25, 28, 32, 38, 42, 48, 52, 54, 55, 56.3]

    ax.plot(months, scores, color=TOKENS['red'], linewidth=2.5, marker='o', markersize=5)
    ax.fill_between(months, scores, alpha=0.1, color=TOKENS['red'])
    ax.axhline(y=50, color='rgba(255,255,255,0.15)', linestyle='--', linewidth=1.5, label='Threshold')
    ax.set_ylim(0, 100)
    ax.legend(frameon=False, labelcolor=TOKENS['text_secondary'])
    ax.grid(True, alpha=0.3)
    ax.set_ylabel('Aggregate Risk Score', color=TOKENS['text_muted'], fontsize=9)
    save_fig("trend", "risks")

    # --- Chart 4: Mitigation Effectiveness ---
    fig, ax = create_card_figure((10, 5), "Mitigation Effectiveness", "TRACKING", TOKENS['green'])
    labels = ['Risk 1: Steel Delivery', 'Risk 2: MEP Subcontractor']
    before = [80, 75]
    after = [60, 50]

    x = np.arange(len(labels))
    width = 0.35
    ax.bar(x - width/2, before, width, label='Before Mitigation', color=TOKENS['red'], edgecolor='none')
    ax.bar(x + width/2, after, width, label='After Mitigation', color=TOKENS['green'], edgecolor='none')
    ax.set_xticks(x)
    ax.set_xticklabels(labels, color=TOKENS['text_muted'], fontsize=9)
    ax.legend(frameon=False, labelcolor=TOKENS['text_secondary'])
    ax.set_ylim(0, 100)
    ax.grid(True, alpha=0.3, axis='y')
    save_fig("mitigation", "risks")

    print("  [Risks] Done — 4 charts generated")

# =============================================================================
# TAB 9: DELAY ANALYSIS CHARTS
# AI Agent Assignment: Assign to Delay Analysis tab
# =============================================================================
def generate_delay_charts():
    print("\n[TAB: Delay Analysis] Generating charts...")

    # --- Chart 1: Delay Timeline ---
    fig, ax = create_card_figure((14, 7), "Delay Events Timeline", "GANTT VIEW", TOKENS['red'])
    labels = ['Design Review', 'Permit Approval', 'Material Delivery', 'Weather', 
              'Subcontractor', 'RFI Response', 'Other']
    values = [245, 180, 420, 95, 310, 280, 145]
    colors = [TOKENS['teal'], TOKENS['blue'], TOKENS['red'], TOKENS['amber'], 
              TOKENS['pink'], TOKENS['green'], TOKENS['gray']]

    bars = ax.bar(labels, values, color=colors, width=0.6, edgecolor='none')
    for bar, val in zip(bars, values):
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 5, 
                f'{val} days', ha='center', va='bottom', color=TOKENS['text_secondary'], 
                fontsize=9, fontweight=600)
    ax.set_ylabel('Delay Days', color=TOKENS['text_muted'], fontsize=9)
    ax.grid(True, alpha=0.3, axis='y')
    plt.xticks(rotation=30, ha='right', fontsize=9)
    save_fig("events_timeline", "delay")

    # --- Chart 2: Root Cause Pareto ---
    fig, ax = create_card_figure((10, 5), "Delay by Root Cause", "PARETO", TOKENS['amber'])
    labels = ['Material Delivery', 'Subcontractor', 'RFI Response', 'Design Review', 'Permit', 'Other']
    values = [420, 310, 280, 245, 180, 240]
    colors = [TOKENS['red'], TOKENS['pink'], TOKENS['green'], TOKENS['teal'], TOKENS['blue'], TOKENS['gray']]

    y_pos = np.arange(len(labels))
    bars = ax.barh(y_pos, values, color=colors, height=0.5, edgecolor='none')
    for bar, val in zip(bars, values):
        ax.text(bar.get_width() + 5, bar.get_y() + bar.get_height()/2, 
                f'{val} days', va='center', ha='left', color=TOKENS['text_secondary'], 
                fontsize=10, fontweight=600)
    ax.set_yticks(y_pos)
    ax.set_yticklabels(labels, color=TOKENS['text_secondary'], fontsize=10)
    ax.invert_yaxis()
    ax.grid(True, alpha=0.2, axis='x')
    save_fig("root_cause", "delay")

    # --- Chart 3: Delay Type ---
    fig, ax = create_card_figure((6, 5), "Delay Type Distribution", "EXCUSEABLE VS NON", TOKENS['teal'])
    labels = ['Excusable', 'Non-Excusable', 'Compensable', 'Concurrent']
    sizes = [890, 785, 420, 180]
    colors = [TOKENS['green'], TOKENS['red'], TOKENS['amber'], TOKENS['teal']]

    wedges, texts = ax.pie(sizes, colors=colors, startangle=90, 
                            wedgeprops=dict(width=0.5))
    for i, (wedge, label, size) in enumerate(zip(wedges, labels, sizes)):
        ang = (wedge.theta2 - wedge.theta1)/2. + wedge.theta1
        y = np.sin(np.deg2rad(ang))
        x = np.cos(np.deg2rad(ang))
        ax.annotate(f'{label}\n{size}d', xy=(x*0.75, y*0.75), ha='center', va='center',
                   fontsize=8, fontweight=600, color=TOKENS['text_primary'])
    ax.set_aspect('equal')
    save_fig("type_distribution", "delay")

    # --- Chart 4: Monthly Accumulation ---
    fig, ax = create_card_figure((10, 5), "Monthly Delay Accumulation", "CUMULATIVE", TOKENS['red'])
    months = ['Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun']
    delay = [0, 45, 180, 420, 680, 890, 1120, 1340, 1560, 1675]

    ax.plot(months, delay, color=TOKENS['red'], linewidth=2.5, marker='o', markersize=5)
    ax.fill_between(months, delay, alpha=0.1, color=TOKENS['red'])
    ax.set_ylabel('Cumulative Delay (days)', color=TOKENS['text_muted'], fontsize=9)
    ax.grid(True, alpha=0.3)
    save_fig("monthly_accumulation", "delay")

    # --- Chart 5: TIA Comparison ---
    fig, ax = create_card_figure((14, 7), "Time Impact Analysis — Before vs After", "TIA COMPARISON", TOKENS['teal'])
    months = ['Sep-25','Oct-25','Nov-25','Dec-25','Jan-26','Feb-26','Mar-26','Apr-26','May-26','Jun-26']
    baseline = [10,15,25,40,55,70,85,100,115,130]
    impacted = [10,20,45,90,140,195,255,320,390,465]
    recovery = [10,18,38,72,110,155,205,260,320,380]

    ax.plot(months, baseline, color=TOKENS['teal'], linewidth=2.5, marker='o', markersize=4, label='Baseline Finish')
    ax.plot(months, impacted, color=TOKENS['red'], linewidth=2.5, marker='o', markersize=4, label='Impacted Finish')
    ax.plot(months, recovery, color=TOKENS['green'], linewidth=2, linestyle='--', marker='o', markersize=4, label='Recovery Plan')

    ax.fill_between(months, baseline, impacted, alpha=0.08, color=TOKENS['red'])
    ax.legend(loc='upper left', frameon=False, labelcolor=TOKENS['text_secondary'])
    ax.grid(True, alpha=0.3)
    ax.set_ylabel('Project Duration (days)', color=TOKENS['text_muted'], fontsize=9)
    plt.xticks(rotation=30, ha='right', fontsize=8)
    save_fig("tia_comparison", "delay")

    print("  [Delay Analysis] Done — 5 charts generated")

# =============================================================================
# MAIN ENTRY POINT
# =============================================================================
def main():
    parser = argparse.ArgumentParser(description='SAMCO Project Intelligence Hub — Smart Charts Generator')
    parser.add_argument('--tab', choices=['overview','wbs','activities','milestones','scurve',
                                          'evm','contracts','risks','delay'],
                       help='Generate charts for a specific tab')
    parser.add_argument('--all', action='store_true', help='Generate ALL charts')
    args = parser.parse_args()

    print("="*70)
    print("SAMCO PROJECT INTELLIGENCE HUB — SMART CHARTS GENERATOR")
    print("="*70)
    print(f"Output directory: {os.path.abspath(OUTPUT_DIR)}")
    print("="*70)

    tab_generators = {
        'overview': generate_overview_charts,
        'wbs': generate_wbs_charts,
        'activities': generate_activities_charts,
        'milestones': generate_milestones_charts,
        'scurve': generate_scurve_charts,
        'evm': generate_evm_charts,
        'contracts': generate_contracts_charts,
        'risks': generate_risks_charts,
        'delay': generate_delay_charts,
    }

    if args.all:
        for name, func in tab_generators.items():
            func()
        print("\n" + "="*70)
        print("ALL CHARTS GENERATED SUCCESSFULLY")
        print(f"Location: {os.path.abspath(OUTPUT_DIR)}")
        print("="*70)
    elif args.tab:
        if args.tab in tab_generators:
            tab_generators[args.tab]()
            print(f"\nDone! Charts saved to {os.path.abspath(OUTPUT_DIR)}")
        else:
            print(f"Error: Unknown tab '{args.tab}'")
            sys.exit(1)
    else:
        parser.print_help()
        print("\nExample usage:")
        print("  python samco_charts.py --tab overview")
        print("  python samco_charts.py --all")

if __name__ == '__main__':
    main()
