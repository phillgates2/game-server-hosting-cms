"use client";

import { useEffect, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Focus treatment shared by every dialog in the panel (command palette, mobile
 * navigation, shortcut sheet): focus moves inside, Tab cycles within, the page
 * behind cannot scroll, Escape closes, and focus returns to the control that
 * opened it.
 *
 * Without this a keyboard user could tab out of a modal into content hidden
 * behind it, or be dropped at the top of the document when it closed. The
 * returned handler also catches Escape from anywhere inside the dialog,
 * including while typing in a search field — the case the global shortcut
 * handler deliberately ignores.
 */
export function useDialogFocus(
  open: boolean,
  containerRef: RefObject<HTMLElement | null>,
  onClose: () => void
) {
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    openerRef.current =
      typeof document !== "undefined" && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const timer = window.setTimeout(() => {
      const root = containerRef.current;
      if (!root) return;
      const first = root.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? root).focus();
    }, 0);

    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
      openerRef.current?.focus?.();
      openerRef.current = null;
    };
  }, [open, containerRef]);

  return function onDialogKeyDown(event: ReactKeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }

    if (event.key !== "Tab") return;

    const root = containerRef.current;
    if (!root) return;

    const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
}
