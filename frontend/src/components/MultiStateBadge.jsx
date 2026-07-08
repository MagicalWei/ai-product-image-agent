import { useState, forwardRef } from "react";
import { motion, AnimatePresence } from "motion/react";

const DEFAULT_LABELS = {
  idle: "AI 团队协作",
  sending: "发送中...",
  success: "已发送",
};

const COMPACT_LABELS = {
  idle: "",
  sending: "",
  success: "",
};

const ICONS = {
  idle: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" />
      <path d="m21.854 2.147-10.94 10.939" />
    </svg>
  ),
  sending: null,
  success: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  ),
};

const MultiStateBadge = forwardRef(function MultiStateBadge(
  { onClick, disabled, compact = false, labels },
  ref
) {
  const [state, setState] = useState("idle");

  const handleClick = async () => {
    if (state !== "idle" || disabled) return;

    setState("sending");
    try {
      await onClick();
      setState("success");
      setTimeout(() => setState("idle"), 1500);
    } catch {
      setState("idle");
    }
  };

  const labelMap = labels || (compact ? COMPACT_LABELS : DEFAULT_LABELS);
  const label = labelMap[state];
  const icon = ICONS[state];

  return (
    <motion.button
      ref={ref}
      type="button"
      onClick={handleClick}
      disabled={state !== "idle" || disabled}
      layout
      style={{
        background: state === "success" ? "#16a34a" : "var(--foreground)",
        color: "var(--background)",
        border: "none",
        padding: compact ? "6px" : "8px 18px",
        borderRadius: compact ? "8px" : "999px",
        fontFamily: "var(--font-heading)",
        fontWeight: 600,
        fontSize: "0.85rem",
        cursor: state !== "idle" || disabled ? "default" : "pointer",
        display: "flex",
        alignItems: "center",
        gap: 6,
        overflow: "hidden",
        minWidth: compact ? 28 : 120,
        width: compact ? 28 : undefined,
        height: compact ? 28 : undefined,
        justifyContent: "center",
        opacity: disabled ? 0.3 : 1,
      }}
      whileHover={
        state === "idle" && !disabled
          ? {
              background: "var(--brand-primary)",
              color: "#ffffff",
              scale: compact ? 1.15 : 1.03,
              boxShadow: "0 4px 16px rgba(255, 107, 53, 0.35)",
            }
          : {}
      }
      whileTap={state === "idle" && !disabled ? { scale: 0.9 } : {}}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
    >
      {!compact && (
        <AnimatePresence mode="wait">
          <motion.span
            key={state + "-label"}
            initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -10, filter: "blur(4px)" }}
            transition={{ duration: 0.2 }}
            style={{
              fontSize: "0.8rem",
              opacity: 0.8,
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </motion.span>
        </AnimatePresence>
      )}
      <AnimatePresence mode="wait">
        <motion.span
          key={state + "-icon"}
          initial={{ opacity: 0, rotate: compact ? -45 : 0, scale: 0.5 }}
          animate={{ opacity: 1, rotate: 0, scale: 1 }}
          exit={{ opacity: 0, rotate: compact ? 45 : 0, scale: 0.5 }}
          transition={{ duration: 0.2 }}
          style={{ display: "flex", alignItems: "center" }}
        >
          {icon}
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );
});

export default MultiStateBadge;
