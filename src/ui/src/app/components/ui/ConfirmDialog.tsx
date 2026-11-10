// src/ui/src/app/components/ui/ConfirmDialog.tsx
// NUT-04 Accessible Typed-Confirmation Dialog (§4.9 / §5.2 / WCAG 2.2 AA)
// Replaces unsafe window.confirm for irreversible actions like crypto-shredding.

import React, { useState, useEffect, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description: string;
  expectedPhrase?: string; // If provided, user must type this exact string to enable confirm
  confirmButtonText?: string;
  confirmLabel?: string;
  cancelButtonText?: string;
  variant?: 'danger' | 'warning' | string;
  isDestructive?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
  onClose?: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  description,
  expectedPhrase,
  confirmButtonText,
  confirmLabel,
  cancelButtonText = 'Cancel',
  variant = 'danger',
  isDestructive = true,
  onConfirm,
  onCancel,
  onClose,
}) => {
  const [typedInput, setTypedInput] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClose = () => {
    if (onClose) onClose();
    if (onCancel) onCancel();
  };

  const confirmText = confirmLabel || confirmButtonText || 'Confirm';

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      setTypedInput('');
      if (!dialog.open) {
        dialog.showModal();
      }
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      if (dialog.open) {
        dialog.close();
      }
    }
  }, [isOpen]);

  const isConfirmed = expectedPhrase ? typedInput.trim() === expectedPhrase.trim() : true;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      handleClose();
    }
  };

  if (!isOpen) return null;

  return (
    <dialog
      ref={dialogRef}
      onKeyDown={handleKeyDown}
      className="fixed inset-0 m-auto p-0 bg-transparent backdrop:bg-slate-900/50 backdrop:backdrop-blur-xs z-50 rounded-2xl shadow-2xl max-w-md w-full border border-border-subtle"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-description"
    >
      <div className="bg-surface text-foreground p-6 rounded-2xl space-y-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`p-2 rounded-xl ${
                isDestructive || variant === 'danger'
                  ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400'
                  : 'bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400'
              }`}
            >
              <AlertTriangle className="w-5 h-5" />
            </div>
            <h2 id="confirm-dialog-title" className="text-base font-bold text-foreground">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="text-muted-foreground hover:text-foreground p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p id="confirm-dialog-description" className="text-xs text-muted-foreground leading-relaxed">
          {description}
        </p>

        {expectedPhrase && (
          <div className="space-y-1.5 pt-1">
            <label htmlFor="confirm-phrase-input" className="block text-xs font-semibold text-foreground">
              Type <span className="font-mono font-bold text-rose-600 underline">{expectedPhrase}</span> to confirm:
            </label>
            <input
              ref={inputRef}
              id="confirm-phrase-input"
              type="text"
              value={typedInput}
              onChange={(e) => setTypedInput(e.target.value)}
              placeholder={expectedPhrase}
              className="w-full px-3 py-2 text-xs font-mono border border-border-control rounded-xl bg-surface focus:outline-none focus:ring-2 focus:ring-rose-500"
              autoComplete="off"
            />
          </div>
        )}

        <div className="flex justify-end gap-2.5 pt-3 border-t border-border-subtle">
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 text-xs font-semibold rounded-xl border border-border-control hover:bg-slate-100 dark:hover:bg-slate-800 text-foreground transition-colors"
          >
            {cancelButtonText}
          </button>
          <button
            type="button"
            disabled={!isConfirmed}
            onClick={() => {
              if (isConfirmed) {
                onConfirm();
              }
            }}
            className={`px-4 py-2 text-xs font-bold rounded-xl text-white shadow-xs transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
              isDestructive || variant === 'danger'
                ? 'bg-rose-600 hover:bg-rose-700'
                : 'bg-amber-600 hover:bg-amber-700'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </dialog>
  );
};

export default ConfirmDialog;
