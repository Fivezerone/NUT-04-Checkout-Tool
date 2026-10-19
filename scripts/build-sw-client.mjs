import * as esbuild from 'esbuild'
import fs from 'fs'
import { SESSION_STORAGE_KEY } from '../src/shared/session-key.mjs'

const code = `
import { AuthClient } from '@supabase/auth-js';
import { PostgrestClient } from '@supabase/postgrest-js';

const chromeStorageAdapter = {
  getItem: async (key) => {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage?.local) return null;
      const data = await chrome.storage.local.get(key);
      const value = data[key];
      return (value !== undefined && value !== null) ? String(value) : null;
    } catch {
      return null;
    }
  },
  setItem: async (key, value) => {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
      await chrome.storage.local.set({ [key]: value });
    } catch { /* storage quota or permission error — silently ignore */ }
  },
  removeItem: async (key) => {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
      await chrome.storage.local.remove(key);
    } catch { /* silently ignore */ }
  },
};

function createSlimClient(supabaseUrl, supabaseKey, options = {}) {
  const url = new URL(supabaseUrl);
  const authUrl = new URL('auth/v1', url).href;
  const restUrl = new URL('rest/v1', url).href;

  const auth = new AuthClient({
    url: authUrl,
    headers: {
      apikey: supabaseKey,
      Authorization: 'Bearer ' + supabaseKey,
    },
    storage: options.auth?.storage || chromeStorageAdapter,
    storageKey: options.auth?.storageKey || '${SESSION_STORAGE_KEY}',
    autoRefreshToken: false,
    persistSession: true,
    detectSessionInUrl: false,
  });

  const customFetch = async (input, init = {}) => {
    let token = null;
    try {
      const { data } = await auth.getSession();
      token = data?.session?.access_token || null;
    } catch {}
    const headers = new Headers(init.headers || {});
    if (!headers.has('apikey')) headers.set('apikey', supabaseKey);
    if (!headers.has('Authorization')) {
      headers.set('Authorization', 'Bearer ' + (token || supabaseKey));
    }
    return fetch(input, { ...init, headers });
  };

  const rest = new PostgrestClient(restUrl, {
    headers: {
      apikey: supabaseKey,
    },
    fetch: customFetch,
  });

  return {
    auth,
    from: (table) => rest.from(table),
    rest,
  };
}

self.NutriSupabase = {
  create: (url, key, options) => createSlimClient(url, key, options)
};
`

fs.writeFileSync('src/extension/supabase-entry.js', code)

await esbuild.build({
  entryPoints: ['src/extension/supabase-entry.js'],
  outfile: 'src/extension/supabase.js',
  bundle: true,
  format: 'iife',
  minify: true,
  // F-12: tree-shake realtime/storage/functions sub-modules that the SW never uses.
  // @supabase/auth-js + @supabase/postgrest-js = ~122 KB vs 223 KB (-45%).
  treeShaking: true,
})

fs.unlinkSync('src/extension/supabase-entry.js')
console.log('[build-sw-client] Built src/extension/supabase.js')
