import { describe, it, expect, vi, beforeEach } from 'vitest';
import { persistOnboarding } from '../lib/persistOnboarding';
import { supabase, ExtensionStorage } from '../../services/storage';

vi.mock('../../services/storage', () => ({
  supabase: {
    from: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockResolvedValue({ error: null })
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

global.chrome = {
  runtime: {
    sendMessage: vi.fn().mockReturnValue(Promise.resolve())
  }
} as any;

describe('persistOnboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('upserts full profile and does not throw', async () => {
    const upsertSpy = vi.mocked(supabase.from('users').upsert);

    await persistOnboarding({
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
      setFinishError: vi.fn()
    });

    expect(upsertSpy).toHaveBeenCalledTimes(1);
    const payload = upsertSpy.mock.calls[0][0];

    expect(payload).toMatchObject({
      condition: 'hypertension',
      metric: 'sodium',
      onboarding_completed: true
    });
    expect(payload).toHaveProperty('consent_timestamp');
  });
});
