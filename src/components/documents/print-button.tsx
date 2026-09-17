"use client";

export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="no-print"
      style={{
        position: "fixed",
        top: 16,
        right: 16,
        padding: "8px 16px",
        borderRadius: 6,
        border: "1px solid #d4d4d8",
        background: "#18181b",
        color: "#fff",
        fontSize: 13,
        fontWeight: 500,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}
