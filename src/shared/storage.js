export const CentralStorage = {
  get: async (key, defaultValue = null) => {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage?.local) return defaultValue
      const result = await chrome.storage.local.get(key)
      return result[key] !== undefined ? result[key] : defaultValue
    } catch (e) {
      console.warn('Storage read error', e)
      return defaultValue
    }
  },
  set: async (key, value) => {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage?.local) return
      await chrome.storage.local.set({ [key]: value })
    } catch (e) {
      console.warn('Storage write error', e)
    }
  },
  subscribe: (key, callback) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => {}

    const listener = (changes, areaName) => {
      if (areaName === 'local' && changes[key]) {
        callback(changes[key].newValue, changes[key].oldValue)
      }
    }

    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  },
}

export const DEFAULT_SETTINGS = {
  uiTheme: 'general',
  user_account: { fullName: 'Guest', email: '' },
  user_preferences: {
    healthMode: false,
    notificationFrequency: 'realtime',
    selectedTags: [],
    termsAccepted: false,
    privacyAccepted: false,
    consentTimestamp: '',
  },
  user_payment: { billingAddress: {} },
}

export const MultiLayerStorage = {
  initDraft: async () => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return DEFAULT_SETTINGS
    const { settings_live, settings_draft } = await chrome.storage.local.get([
      'settings_live',
      'settings_draft',
    ])
    const live = settings_live || DEFAULT_SETTINGS

    // If a draft session already exists, merge/resolve it, otherwise deep copy live
    const draft = settings_draft ? { ...live, ...settings_draft } : JSON.parse(JSON.stringify(live))

    await chrome.storage.local.set({ settings_draft: draft })
    return draft
  },

  // Fix #14: microtask-coalesced write — multiple updateDraft() calls within the
  // same microtask are merged into a single chrome.storage.local read+write.
  _pendingDraft: null,
  _draftFlushPromise: null,

  updateDraft: async (updatePayload) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return

    // Merge into the pending payload
    if (!MultiLayerStorage._pendingDraft) {
      MultiLayerStorage._pendingDraft = {}
    }
    Object.assign(MultiLayerStorage._pendingDraft, updatePayload)

    // Schedule a single flush per microtask
    if (!MultiLayerStorage._draftFlushPromise) {
      MultiLayerStorage._draftFlushPromise = Promise.resolve().then(async () => {
        const merged = MultiLayerStorage._pendingDraft
        MultiLayerStorage._pendingDraft = null
        MultiLayerStorage._draftFlushPromise = null

        const { settings_draft } = await chrome.storage.local.get('settings_draft')
        const newDraft = { ...DEFAULT_SETTINGS, ...settings_draft, ...merged }
        await chrome.storage.local.set({ settings_draft: newDraft })
        return newDraft
      })
    }

    return MultiLayerStorage._draftFlushPromise
  },

  commitDraftToLive: async () => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return
    const { settings_draft } = await chrome.storage.local.get('settings_draft')
    if (settings_draft) {
      const liveCopy = JSON.parse(JSON.stringify(settings_draft))
      await chrome.storage.local.set({ settings_live: liveCopy })
      await chrome.storage.local.remove('settings_draft')
    }
  },

  getLive: async () => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return DEFAULT_SETTINGS
    const { settings_live } = await chrome.storage.local.get('settings_live')
    return settings_live || DEFAULT_SETTINGS
  },

  getDraft: async () => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return DEFAULT_SETTINGS
    const { settings_draft } = await chrome.storage.local.get('settings_draft')
    return settings_draft || DEFAULT_SETTINGS
  },

  subscribeLive: (callback) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => {}
    const listener = (changes, areaName) => {
      if (areaName === 'local' && changes.settings_live) {
        callback(changes.settings_live.newValue)
      }
    }
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  },

  subscribeDraft: (callback) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => {}
    const listener = (changes, areaName) => {
      if (areaName === 'local' && changes.settings_draft) {
        callback(changes.settings_draft.newValue)
      }
    }
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  },
}
