import { forwardRef } from "react";
import { motion } from "motion/react";
import { X } from "lucide-react";

const CloseButton = forwardRef(function CloseButton({ onClick, style }, ref) {
  return (
    <motion.button
      ref={ref}
      type="button"
      aria-label="关闭"
      onClick={onClick}
      style={{
        position: 'absolute',
        top: 20,
        right: 20,
        background: 'transparent',
        border: 'none',
        color: 'var(--on-surface-variant)',
        cursor: 'pointer',
        padding: 4,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 32,
        height: 32,
        ...style,
      }}
      whileHover={{
        background: 'rgba(0,0,0,0.06)',
        color: style?.color || 'var(--on-surface)',
        scale: 1.1,
      }}
      whileTap={{ scale: 0.9 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
    >
      <X size={18} />
    </motion.button>
  );
});

export default CloseButton;
