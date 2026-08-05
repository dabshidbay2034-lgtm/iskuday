# MogadishuRents

Project context lives in one shared file so it can't drift between agents:

@./AGENTS.md

Read it before making changes. In short: Vite + React 18 + TypeScript + shadcn/ui +
Supabase. Use `npm` (`.npmrc` sets `legacy-peer-deps=true`), import via the `@` alias, and
treat `src/integrations/supabase/*` and `src/components/ui/*` as generated code.
