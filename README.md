# EduCore

Multi-tenant school management platform for Kenyan schools — admissions, attendance, exams, fees (M-Pesa), and SMS-first parent communication. Part of the Trimora ecosystem, built as a separate codebase and Supabase project from Trimora POS/Auto.

The full product blueprint (architecture, schema, business rules, phasing, Green Light Policy) is the single source of truth for this project and lives outside this repo.

## Stack

- Next.js (App Router, TypeScript, Tailwind CSS)
- Supabase (Postgres, RLS, Auth, Edge Functions, Storage)
- Deployed on Vercel

## Getting started

```bash
npm install
cp .env.local.example .env.local   # fill in Supabase project values
npm run dev
```

## Development workflow

This project follows a Green Light Policy: every feature/migration/module is implemented, tested, and validated (functional, DB/RLS, security, UI, regression) before the next one starts. See project handover notes for current phase/status.

```bash
npm run build     # production build
npm run lint       # eslint
npx tsc --noEmit  # type-check
```
