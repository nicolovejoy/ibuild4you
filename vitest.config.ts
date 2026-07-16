import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  // The React plugin enables the automatic JSX runtime so component files
  // don't need `import React` (matches Next.js's source convention).
  plugins: [react()],
  test: {
    environment: 'node',
    // Agent worktrees live at .claude/worktrees/<id>/ — full repo checkouts.
    // Without this, every worktree's copy of the suite is globbed in and the
    // count silently multiplies (seen 2026-07-15: 1149 real tests reported as
    // 4587 across 3 worktrees). Vitest's default exclude covers node_modules
    // and dist but knows nothing about .claude.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
