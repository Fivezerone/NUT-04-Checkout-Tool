import * as esbuild from 'esbuild';
import fs from 'fs';

const code = `
import { createClient } from '@supabase/supabase-js';

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

self.NutriSupabase = {
  create: (url, key) => createClient(url, key, {
    auth: {
      storage: chromeStorageAdapter,
      autoRefreshToken: false,
      persistSession: true,
      detectSessionInUrl: false,
    },
  })
};
`;

fs.writeFileSync('src/extension/supabase-entry.js', code);

await esbuild.build({
  entryPoints: ['src/extension/supabase-entry.js'],
  outfile: 'src/extension/supabase.js',
  bundle: true,
  format: 'iife',
  minify: true,
});

fs.unlinkSync('src/extension/supabase-entry.js');
console.log('[build-sw-client] Built src/extension/supabase.js');
