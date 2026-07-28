"use client";

import { useEffect, useId, useState } from "react";

type MermaidDiagramProps = {
  chart: string;
  title: string;
};

export default function MermaidDiagram({ chart, title }: MermaidDiagramProps) {
  const id = useId().replace(/:/g, "");
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function render() {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          themeVariables: {
            background: "transparent",
            primaryColor: "#0f2a42",
            primaryTextColor: "#f4fbff",
            primaryBorderColor: "#39d7d2",
            lineColor: "#63a8ff",
            secondaryColor: "#152f49",
            tertiaryColor: "#071321",
            fontFamily: "Arial, Helvetica, sans-serif",
            clusterBkg: "rgba(15,42,66,0.72)",
            clusterBorder: "#d6a23a",
            edgeLabelBackground: "#071321"
          }
        });
        const result = await mermaid.render(`mermaid-${id}`, chart);
        if (!cancelled) {
          setSvg(result.svg);
          setError("");
        }
      } catch {
        if (!cancelled) {
          setSvg("");
          setError("Mermaid chart could not be rendered.");
        }
      }
    }
    void render();
    return () => {
      cancelled = true;
    };
  }, [chart, id]);

  return (
    <section className="mermaid-card" aria-label={title}>
      <div className="section-header">
        <div>
          <p className="eyebrow">Smart Decision Flow</p>
          <h2>{title}</h2>
        </div>
        <span>Mermaid live chart</span>
      </div>
      {svg ? <div className="mermaid-render" dangerouslySetInnerHTML={{ __html: svg }} /> : null}
      {error ? (
        <pre className="mermaid-fallback">{chart}</pre>
      ) : null}
    </section>
  );
}
