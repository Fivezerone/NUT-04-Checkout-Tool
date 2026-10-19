import { execSync } from 'child_process';

try {
  const output = execSync('git ls-files', { encoding: 'utf-8' });
  const lines = output.split('\n').map(line => line.trim()).filter(Boolean);
  
  const hasSecrets = lines.some(line => {
    return /(^|\/)\.env($|\.)(?!example)/.test(line) || /^supabase\/\.temp\//.test(line);
  });

  if (hasSecrets) {
    console.error('Found tracked secrets!');
    process.exit(1);
  }
  console.log('No secrets tracked.');
} catch (err) {
  console.error(err);
  process.exit(1);
}
