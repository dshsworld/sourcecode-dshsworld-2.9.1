import vinext from 'vinext';
import { defineConfig } from 'vite';
import { cloudflare } from '@cloudflare/vite-plugin';

// Standalone deployment: no Sites-owned database IDs or source credentials.
export default defineConfig({
  plugins: [
    vinext(),
    cloudflare({
      configPath: '.cloudflare-wrangler.json',
      viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
      inspectorPort: false,
    }),
  ],
});
