import { describe, it, expect, vi, beforeEach } from 'vitest';
import { persistOnboarding } from '../lib/persistOnboarding';
import { supabase, ExtensionStorage } from '../../services/storage';

// Mock the storage module
vi.mock('../../services/storage', () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: { success: true }, error: null }),
  },
  ExtensionStorage: {
    setOnboardingComplete: vi.fn().mockResolvedValue(undefined)
  },
  savePremiumStatus: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('../lib/db', () => ({
  getSettings: vi.fn().mockResolvedValue({}),
  saveSettings: vi.fn().mockResolvedValue(undefined)
}));

// F-02: Mock MultiLayerStorage so it doesn't break in test context (no Chrome)
vi.mock('../../../../shared/storage', () => ({
  CentralStorage: {},
  MultiLayerStorage: {
    updateDraft: vi.fn().mockResolvedValue(undefined),
    commitDraftToLive: vi.fn().mockResolvedValue(undefined)
  }
}));

global.chrome = {
  runtime: {
    sendMessage: vi.fn().mockReturnValue(Promise.resolve())
  }
} as any;

describe('persistOnboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset supabase.rpc to success by default
    vi.mocked(supabase.rpc).mockResolvedValue({ data: { success: true }, error: null } as any);
  });

  it('calls complete_onboarding RPC and returns true on success', async () => {
    const result = await persistOnboarding({
      paymentRef: 'test_ref',
      method: 'Card',
      userId: 'user-123',
      user: { user_metadata: { full_name: 'Test' } },
      fullName: 'Test User',
      email: 'test@example.com',
      dob: '2000-01-01',
      gender: 'other',
      condition: 'hypertension',
      metric: 'sodium',
      notificationFrequency: 'daily',
      termsAccepted: true,
      privacyAccepted: true,
      initialMode: 'signup',
      tier: 'premium',
      setFinishError: vi.fn()
    });

    expect(supabase.rpc).toHaveBeenCalledWith('complete_onboarding', { p_tier: 'premium' });
    expect(result).toBe(true);
  });

  it('returns false and calls setFinishError when RPC fails', async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ 
      data: null, 
      error: { message: 'DB error', code: '500' } 
    } as any);

    const setFinishError = vi.fn();
    const result = await persistOnboarding({
      paymentRef: 'test_ref',
      method: 'Card',
      userId: 'user-123',
      user: { user_metadata: { full_name: 'Test' } },
      fullName: 'Test User',
      email: 'test@example.com',
      dob: '2000-01-01',
      gender: 'other',
      condition: 'hypertension',
      metric: 'sodium',
      notificationFrequency: 'daily',
      termsAccepted: true,
      privacyAccepted: true,
      initialMode: 'signup',
      tier: 'premium',
      setFinishError
    });

    expect(result).toBe(false);
    expect(setFinishError).toHaveBeenCalledWith(
      expect.stringContaining('Payment received (ref: test_ref)')
    );
  });

  it('does not call complete_onboarding RPC in renew mode (preserves billing)', async () => {
    await persistOnboarding({
      paymentRef: 'test_ref',
      method: 'Card',
      userId: 'user-123',
      user: null,
      fullName: '',
      email: '',
      dob: '',
      gender: '',
      condition: 'general',
      metric: 'General',
      notificationFrequency: 'realtime',
      termsAccepted: true,
      privacyAccepted: true,
      initialMode: 'renew',
      tier: 'premium',
      setFinishError: vi.fn()
    });

    // RPC should NOT be called in renew mode (renewal preserves existing profile)
    expect(supabase.rpc).not.toHaveBeenCalledWith('complete_onboarding', expect.anything());
  });

  it('uses basic tier when specified', async () => {
    await persistOnboarding({
      paymentRef: 'free_tier',
      method: 'none',
      userId: 'user-456',
      user: null,
      fullName: 'Basic User',
      email: 'basic@example.com',
      dob: '',
      gender: '',
      condition: 'general',
      metric: 'General',
      notificationFrequency: 'off',
      termsAccepted: true,
      privacyAccepted: true,
      initialMode: 'signup',
      tier: 'basic',
      setFinishError: vi.fn()
    });

    expect(supabase.rpc).toHaveBeenCalledWith('complete_onboarding', { p_tier: 'basic' });
  });

  it('recovers via resilient direct table update when complete_onboarding RPC fails', async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: null,
      error: { message: 'Could not find function public.complete_onboarding', code: 'PGRST202' }
    } as any);

    const updateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null })
    });
    (supabase as any).from = vi.fn().mockReturnValue({
      update: updateMock
    });

    const setFinishError = vi.fn();
    const result = await persistOnboarding({
      paymentRef: 'fallback_ref',
      method: 'Card',
      userId: 'user-789',
      user: { user_metadata: { full_name: 'Fallback User' } },
      fullName: 'Fallback User',
      email: 'fallback@example.com',
      dob: '1995-05-05',
      gender: 'female',
      condition: 'hypertension',
      metric: 'sodium',
      notificationFrequency: 'daily',
      termsAccepted: true,
      privacyAccepted: true,
      initialMode: 'signup',
      tier: 'premium',
      setFinishError
    });

    expect(result).toBe(true);
    expect(setFinishError).not.toHaveBeenCalled();
    expect((supabase as any).from).toHaveBeenCalledWith('users');
    expect(ExtensionStorage.setOnboardingComplete).toHaveBeenCalledWith(
      'user-789',
      expect.anything()
    );

    delete (supabase as any).from;
  });
});

