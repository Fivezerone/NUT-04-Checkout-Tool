import React from 'react';
import { LegalDoc } from '../legal/decoyLegalDocs';

interface ConsentDocModalProps {
  doc: LegalDoc | null;
  isOpen: boolean;
  onClose: () => void;
  onAccept?: () => void;
}

export const ConsentDocModal: React.FC<ConsentDocModalProps> = ({
  doc,
  isOpen,
  onClose,
  onAccept,
}) => {
  if (!isOpen || !doc) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div 
        className="w-full max-w-xl max-h-[85vh] flex flex-col rounded-2xl bg-white shadow-2xl ring-1 ring-black/10 overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="consent-modal-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 p-5 pb-4 bg-slate-50/50">
          <div>
            <div className="flex items-center gap-2">
              <h2 id="consent-modal-title" className="text-lg font-bold text-slate-800">
                {doc.title}
              </h2>
              {doc.isDraft && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 border border-amber-200">
                  Draft Decoy
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Version: {doc.version} · Updated: {doc.lastUpdated}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 rounded-lg p-1.5 hover:bg-slate-100 transition"
            aria-label="Close"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        {/* Notice Banner */}
        <div className="px-5 py-2.5 bg-amber-50 border-b border-amber-100 text-amber-900 text-xs flex items-start gap-2">
          <svg className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <div>
            <strong>Decoy / Placeholder Document:</strong> This document is formatted for user review and will be updated once compliant legal policies are finalized.
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="p-5 overflow-y-auto space-y-4 text-sm text-slate-600 leading-relaxed max-h-[50vh]">
          {doc.sections.map((section, idx) => (
            <div key={idx} className="space-y-1">
              <h3 className="font-semibold text-slate-800 text-sm">
                {section.heading}
              </h3>
              <p className="text-slate-600 text-xs leading-5">
                {section.content}
              </p>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 p-4 bg-slate-50/50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition"
          >
            Close
          </button>
          {onAccept && (
            <button
              type="button"
              onClick={() => {
                onAccept();
                onClose();
              }}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition"
            >
              Accept & Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
