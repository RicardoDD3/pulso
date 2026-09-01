"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, Check } from "lucide-react";

interface CopyButtonProps {
  /** Texto que se manda al portapapeles. Si viene vacío, el botón se deshabilita. */
  text: string;
  /** Etiqueta accesible (y tooltip) del botón. */
  label?: string;
  /** Texto visible junto al icono (para el botón de "copiar todo el chat"). */
  title?: string;
  className?: string;
}

export default function CopyButton({
  text,
  label = "Copiar", // TODO(i18n): mover a next-intl
  title,
  className = "",
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const empty = text.trim() === "";

  const copy = async () => {
    if (empty) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return; // portapapeles no disponible: no mentimos con el check
    }
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      onClick={copy}
      disabled={empty}
      aria-label={copied ? "Copiado" : label} // TODO(i18n): "Copiado" hardcodeado, mover a next-intl
      title={copied ? "Copiado" : label}
      className={`press shrink-0 inline-flex items-center gap-1.5 rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-white/10 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed ${className}`}
    >
      {copied ? (
        <Check className="w-3.5 h-3.5 text-green-400" />
      ) : (
        <Copy className="w-3.5 h-3.5" />
      )}
      {title && <span className="text-xs">{copied ? "Copiado" : title}</span>}
    </button>
  );
}
