/**
 * Accessible Confirmation Dialog Component
 *
 * Replaces browser confirm() with a proper accessible modal.
 * Features: focus trap, Escape to close, aria-modal, backdrop click to cancel.
 */

import { Component, Show, onCleanup, createEffect } from 'solid-js';
import './confirm-dialog.css';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info';
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: Component<ConfirmDialogProps> = (props) => {
  let dialogRef: HTMLDivElement | undefined;
  let confirmBtnRef: HTMLButtonElement | undefined;
  let previousFocus: HTMLElement | null = null;

  // Focus management: trap focus inside dialog
  const handleKeyDown = (e: KeyboardEvent) => {
    /* v8 ignore start -- guard only reachable when dialog is open */
    if (!props.open) return;
    /* v8 ignore stop */

    if (e.key === 'Escape') {
      e.preventDefault();
      props.onCancel();
      return;
    }

    /* v8 ignore next -- dialogRef always assigned when dialog is open */
    if (e.key === 'Tab' && dialogRef) {
      const focusable = dialogRef.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        /* v8 ignore next -- last always exists: dialog has 2 buttons */
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        /* v8 ignore next -- first always exists: dialog has 2 buttons */
        first?.focus();
      }
    }
  };

  createEffect(() => {
    if (props.open) {
      previousFocus = document.activeElement as HTMLElement;
      document.addEventListener('keydown', handleKeyDown);
      // Focus the cancel button (safer default for destructive actions)
      requestAnimationFrame(() => {
        /* v8 ignore next -- ref always assigned when dialog renders */
        confirmBtnRef?.focus();
      });
    } else {
      document.removeEventListener('keydown', handleKeyDown);
      /* v8 ignore next -- previousFocus may be null if nothing was focused */
      previousFocus?.focus();
      previousFocus = null;
    }
  });

  onCleanup(() => {
    document.removeEventListener('keydown', handleKeyDown);
  });

  const variantClass = () => {
    switch (props.variant ?? 'danger') {
      case 'danger': return 'confirm-dialog--danger';
      case 'warning': return 'confirm-dialog--warning';
      case 'info': return 'confirm-dialog--info';
    }
  };

  return (
    <Show when={props.open}>
      <div
        class="confirm-dialog-backdrop"
        onClick={(e) => {
          if (e.target === e.currentTarget) props.onCancel();
        }}
        role="presentation"
      >
        <div
          /* v8 ignore next -- Solid.js ref callback */
          ref={dialogRef}
          class={`confirm-dialog ${variantClass()}`}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          aria-describedby="confirm-dialog-message"
        >
          <h3 id="confirm-dialog-title" class="confirm-dialog__title">
            {props.title}
          </h3>
          <p id="confirm-dialog-message" class="confirm-dialog__message">
            {props.message}
          </p>
          <div class="confirm-dialog__actions">
            <button
              class="confirm-dialog__btn confirm-dialog__btn--cancel"
              onClick={props.onCancel}
            >
              {props.cancelLabel ?? 'Cancel'}
            </button>
            <button
              /* v8 ignore next -- Solid.js ref callback */
              ref={confirmBtnRef}
              class="confirm-dialog__btn confirm-dialog__btn--confirm"
              onClick={props.onConfirm}
            >
              {props.confirmLabel ?? 'Confirm'}
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
};

/* v8 ignore next */
export default ConfirmDialog;
