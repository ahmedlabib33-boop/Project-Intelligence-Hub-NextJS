"use client";

import { useCallback, useState } from "react";

const REPORT_PATTERN =
  /\.(html?|pdf|xlsx?|csv|docx?|pptx?|png|jpe?g|svg)(?:\?.*)?$/i;

function visible(element: Element): boolean {
  const item = element as HTMLElement;
  const style = window.getComputedStyle(item);
  const rect = item.getBoundingClientRect();

  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    Number(style.opacity || "1") > 0 &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function normalize(value: string | null): string | null {
  if (!value) return null;

  try {
    return new URL(value, window.location.origin).toString();
  } catch {
    return null;
  }
}

function findReportUrl(): string | null {
  const selectors = [
    "iframe[src]",
    "object[data]",
    "embed[src]",
    "a[href]",
  ];

  const candidates = Array.from(
    document.querySelectorAll(selectors.join(","))
  ).filter(visible);

  for (const candidate of candidates) {
    const raw =
      candidate.getAttribute("src") ??
      candidate.getAttribute("data") ??
      candidate.getAttribute("href");

    const url = normalize(raw);

    if (
      url &&
      (REPORT_PATTERN.test(url) ||
        url.includes("/generated/") ||
        url.includes("/reports/"))
    ) {
      return url;
    }
  }

  return null;
}

function fileName(url: string): string {
  try {
    return (
      new URL(url).pathname.split("/").filter(Boolean).pop() ||
      "output-studio-report.html"
    );
  } catch {
    return "output-studio-report.html";
  }
}

export default function OutputStudioDownloadButton({
  href,
  label = "Download Report"
}: {
  href?: string;
  label?: string;
}) {
  const [status, setStatus] = useState("");

  const download = useCallback(async () => {
    setStatus("");

    const reportUrl = normalize(href || null) || findReportUrl();

    if (!reportUrl) {
      setStatus("Open or select a report first.");
      return;
    }

    try {
      const response = await fetch(reportUrl, {
        credentials: "same-origin",
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const blob = await response.blob();
      const localUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = localUrl;
      link.download = fileName(reportUrl);
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();

      window.setTimeout(() => URL.revokeObjectURL(localUrl), 1000);
      setStatus("Download started.");
    } catch {
      const link = document.createElement("a");

      link.href = reportUrl;
      link.download = fileName(reportUrl);
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      document.body.appendChild(link);
      link.click();
      link.remove();

      setStatus("Report opened for download.");
    }
  }, [href]);

  return (
    <div
      data-output-studio-download
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        flexWrap: "wrap",
        marginBlock: "0.75rem",
      }}
    >
      <button
        type="button"
        onClick={download}
        aria-label="Download the selected Output Studio report"
        style={{
          border: "1px solid rgba(59,130,246,.55)",
          borderRadius: "0.75rem",
          padding: "0.65rem 1rem",
          background:
            "linear-gradient(135deg, rgb(37,99,235), rgb(14,116,144))",
          color: "#fff",
          cursor: "pointer",
          fontWeight: 700,
          boxShadow: "0 8px 20px rgba(37,99,235,.22)",
        }}
      >
        {label}
      </button>

      {status ? (
        <span role="status" aria-live="polite" style={{ fontSize: ".875rem" }}>
          {status}
        </span>
      ) : null}
    </div>
  );
}
