/**
 * Type declarations for src/shared/storage.js
 * Provides typed exports consumed by the UI TypeScript layer.
 */

export interface LiveSettings {
  uiTheme?: string;
  user_account?: { fullName: string; email: string };
  user_preferences?: {
    healthMode?: boolean;
    notificationFrequency?: string;
    selectedTags?: string[];
    termsAccepted?: boolean;
    privacyAccepted?: boolean;
    consentTimestamp?: string;
  };
  user_payment?: { billingAddress?: Record<string, unknown> };
  [key: string]: unknown;
}

export declare const DEFAULT_SETTINGS: LiveSettings;

export declare const CentralStorage: {
  get<T = unknown>(key: string, defaultValue?: T | null): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  subscribe(key: string, callback: (newValue: unknown, oldValue: unknown) => void): () => void;
};

export declare const MultiLayerStorage: {
  initDraft(): Promise<LiveSettings>;
  updateDraft(payload: Partial<LiveSettings>): Promise<LiveSettings>;
  commitDraftToLive(): Promise<void>;
  getLive(): Promise<LiveSettings>;
  getDraft(): Promise<LiveSettings>;
  subscribeLive(callback: (newLive: LiveSettings) => void): () => void;
  subscribeDraft(callback: (newDraft: LiveSettings) => void): () => void;
};
