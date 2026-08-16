import { build } from 'esbuild';
import { execSync } from 'child_process';

// Compile TypeScript first
execSync('npx tsc --noEmit', { stdio: 'inherit' });

await build({
  entryPoints: ['src/handler.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist/handler.js',
  external: ['better-sqlite3'],
  banner: {
    js: '// AWS Cost Optimizer — Background Collector Lambda',
  },
});

console.log('Bundle complete: dist/handler.js');
