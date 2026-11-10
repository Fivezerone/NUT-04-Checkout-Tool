// src/ui/src/app/components/ui/ConfirmDialog.tsx
// NUT-04 Accessible Typed-Confirmation Dialog (§4.9 / §5.2 / WCAG 2.2 AA)
// Replaces unsafe window.confirm for irreversible actions like crypto-shredding.

import React, { useState, useEffect, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description: string;
  expectedPhrase?: string; // If provided, user must type this exact string to enable confirm
  confirmButtonText?: string;
  cancelButtonText?: string;
  isDestructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  description,
  expectedPhrase,
  confirmButtonText = 'Confirm',
  cancelButtonText = 'Cancel',
  isDestructive = true,
  onConfirm,
  onCancel,
}) => {
  const [typedInput, setTypedInput] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
      onCancel();
    }
  };

  if (!isOpen) return null;

  return (
    <dialog
      ref={dialogRef}
      onKeyDown={handleKeyDown}
      className="backdrop:bg-slate-900/60 p-0 rounded-2xl shadow-2xl border border-border bg-surface text-foreground w-full max-w-lg m-auto"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-desc"
    >
      <div className="p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            {isDestructive && (
              <div className="p-2.5 rounded-full bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-400">
                <AlertTriangle className="w-5 h-5" />
              </div>
            )}
            <h3 id="confirm-dialog-title" className="text-lg font-bold text-foreground">
              {title}
            </h3>
          </div>
          <button
            onClick={onCancel}
            className="p-1 rounded-lg text-muted-foreground hover:bg-muted transition-colors"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p id="confirm-dialog-desc" className="text-sm text-muted-foreground leading-relaxed">
          {description}
        </p>

        {expectedPhrase && (
          <div className="space-y-2 pt-2">
            <label className="text-xs font-semibold text-foreground block">
              Type <span className="font-mono bg-muted px-1.5 py-0.5 rounded text-red-600 dark:text-red-400 font-bold">{expectedPhrase}</span> to confirm:
            </label>
            <input
              ref={inputRef}
              type="text"
              value={typedInput}
              onChange={(e) => setTypedInput(e.target.value)}
              placeholder={expectedPhrase}
              className="w-full px-3.5 py-2 text-sm rounded-lg border border-border-control bg-surface focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent font-mono"
            />
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-border-subtle">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-border-control hover:bg-muted text-foreground transition-colors"
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
            className={`px-4 py-2 text-sm font-semibold rounded-lg text-white transition-all ${
              !isConfirmed
                ? 'opacity-40 cursor-not-allowed bg-slate-400'
                : isDestructive
                ? 'bg-red-600 hover:bg-red-700 active:bg-red-800'
                : 'bg-teal-700 hover:bg-teal-800 active:bg-teal-900'
            }`}
          >
            {confirmButtonText}
          </button>
        </div>
      </div>
    </dialog>
  );
};
