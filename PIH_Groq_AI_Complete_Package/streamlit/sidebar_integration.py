"""
Streamlit Sidebar AI Integration
================================
Add this code block to your dashboard.py sidebar section.
"""

import streamlit as st
from src.construction_system.groq_service import (
    ask_ai, summarize_project, analyze_letters,
    analyze_contracts, analyze_delays, draft_claim_rebuttal,
    check_groq_health
)

# ── AI Sidebar Section ────────────────────────────────────
with st.sidebar:
    st.markdown("---")
    st.header("🤖 AI Project Analyst")

    # Health indicator
    health = check_groq_health()
    if health["available"]:
        st.success(f"✅ AI Online ({health['latency_ms']}ms)")
    else:
        st.warning(f"⚠️ AI Offline — {health.get('error', 'Unavailable')}")

    st.markdown("---")

    # Ask AI
    question = st.text_input("Ask about this project:", placeholder="e.g., What is the SPI?")
    if question and st.button("Ask AI", use_container_width=True):
        with st.spinner("Analyzing..."):
            result = ask_ai(question, project_context=current_project_data)
        st.write(result.answer)
        st.caption(f"Provider: {result.provider} · Model: {result.model}")
        if result.status != "success":
            st.info("AI is in fallback mode. Answers may be limited.")

    st.markdown("---")

    # Quick Actions
    st.subheader("Quick Analysis")

    if st.button("📋 Summarize Project", use_container_width=True):
        with st.spinner("Generating summary..."):
            summary = summarize_project(current_project_data)
        with st.expander("Executive Summary", expanded=True):
            st.write(summary.summary)
            if summary.actions:
                st.write("**Actions:**")
                for a in summary.actions:
                    st.write(f"• {a}")
            if summary.risks:
                st.write("**Risks:**")
                for r in summary.risks:
                    st.write(f"⚠️ {r}")
            st.write(f"**Health:** {summary.health}")
            st.caption(f"{summary.provider} · {summary.model}")

    if st.button("📧 Analyze Letters", use_container_width=True):
        with st.spinner("Analyzing correspondence..."):
            letters = analyze_letters(letters_summary=letters_data)
        with st.expander("Letters Intelligence"):
            if letters.themes:
                st.write("**Themes:**")
                for t in letters.themes:
                    st.write(f"• {t}")
            if letters.critical_letters:
                st.write("**Critical Letters:**")
                for c in letters.critical_letters:
                    st.write(f"🚨 {c}")
            if letters.action_items:
                st.write("**Action Items:**")
                for a in letters.action_items:
                    st.write(f"→ {a}")
            if letters.deadlines:
                st.write("**Deadlines:**")
                for d in letters.deadlines:
                    st.write(f"⏰ {d}")
            st.caption(f"{letters.provider} · {letters.model}")

    if st.button("📑 Analyze Contract", use_container_width=True):
        with st.spinner("Analyzing contract..."):
            contract = analyze_contracts(contract_data=contract_data)
        with st.expander("Contract Insight"):
            st.write(contract.summary)
            if contract.key_clauses:
                st.write("**Key Clauses:**")
                for c in contract.key_clauses:
                    st.write(f"• {c}")
            st.write(f"**Claim Exposure:** {contract.claim_exposure}")
            if contract.recommendations:
                st.write("**Recommendations:**")
                for r in contract.recommendations:
                    st.write(f"→ {r}")
            st.caption(f"{contract.provider} · {contract.model}")

    if st.button("⏱️ Analyze Delays", use_container_width=True):
        with st.spinner("Analyzing delays..."):
            delay = analyze_delays(delay_data=delay_data)
        with st.expander("Delay Analysis"):
            st.write(delay.critical_path_impact)
            if delay.delay_events:
                st.write("**Delay Events:**")
                for e in delay.delay_events:
                    st.write(f"• {e}")
            if delay.recovery_options:
                st.write("**Recovery Options:**")
                for o in delay.recovery_options:
                    st.write(f"→ {o}")
            st.write(f"**Risk Exposure:** {delay.risk_exposure}")
            st.caption(f"{delay.provider} · {delay.model}")

    if st.button("✍️ Draft Rebuttal", use_container_width=True):
        with st.spinner("Drafting rebuttal..."):
            rebuttal = draft_claim_rebuttal(claim_data=selected_claim_data)
        with st.expander("Draft Rebuttal"):
            st.write(rebuttal.answer)
            st.caption(f"{rebuttal.provider} · {rebuttal.model}")
            st.warning("⚠️ This is an AI draft. Review and edit before sending.")

    st.markdown("---")
    st.caption("🛡️ AI-generated insights. Verify before acting.")
