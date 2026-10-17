# Users & Roles — Implementation Plan

## Context

Emails are visible throughout the app where names should be. Identity is fragmented across `users`, `project_members`, and `projects`. Admin status is a hardcoded email list. This plan consolidates identity onto `users` as the source of truth, adds extensible system roles, and eliminates email exposure in the UI.

## Phase 1: Display Names Everywhere (no schema changes)

Cache display names at write time, prefer them in UI. Low risk, immediate visual improvement.

- **Messages:** Look up `users` doc at message creation, write `sender_display_name` alongside `sender_email`
- **Files:** Look up `users` doc at upload, write `uploaded_by_name` alongside `uploaded_by_email`
- **Chat UI:** Show `sender_display_name`, fall back to email prefix (never full email)
- **Files UI:** Show `uploaded_by_name`, fall back to email prefix
- **Builder project header:** Show `requester_first_name` or email prefix, not full email
- **Backfill:** Nico manually sets `first_name` on all existing `users` docs via Firebase Console

## Phase 2: System Roles (replace ADMIN_EMAILS)

- Add `system_role: 'admin' | 'support' | null` to `users` type and docs
- Backfill script: set `system_role: 'admin'` on the two existing admin users
- New helper: `getSystemRole(db, uid)` — reads `users` doc, returns `system_role`
- Enrich `getAuthenticatedUser` to return `systemRole` (one extra Firestore read, cached per request)
- Replace all `isAdminEmail(email)` checks with `systemRole === 'admin'`
- Remove `ADMIN_EMAILS` constant and `isAdminEmail()` function
- **Safety:** Keep `ADMIN_EMAILS` as a dead-man fallback until we're confident the new check works. Remove it in a follow-up.

## Phase 3: Names on `users` Only

- Remove `first_name`/`last_name` from `ProjectMember` interface
- Stop writing names to `project_members` at share time
- `requester_first_name`/`last_name` on projects becomes a cache, populated from `users` lookup at share time
- Share flow: when builder shares with an email, if that email already has a `users` doc with names, auto-populate. Otherwise leave blank until they sign in.
- Maker name edit: add name editing in maker view header (writes to `users` doc via new PATCH `/api/users/me` route)

## Phase 4: First-Visit Name Prompt

- When a maker signs in via passcode and has no `first_name` on their `users` doc, show a one-time name prompt before they enter the chat
- Simple modal: "What should we call you?" with first name (required) and last name (optional)
- Saves to `users` doc, then proceeds to project view

## Order of Operations

Phase 1 first — immediate improvement, no migrations, no risk.
Phase 2 next — replaces hardcoded admin list with extensible system.
Phase 3 after — cleans up data model, adds maker name editing.
Phase 4 last — handles the edge case of nameless users.
