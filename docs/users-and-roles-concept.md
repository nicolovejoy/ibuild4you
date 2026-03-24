# Users and Roles — Concept

## Current State

Identity is fragmented across three places:

- **`users`** collection — created on first sign-in, has `first_name`, `last_name`, `display_name`, `email`
- **`project_members`** — per-project role + optional `first_name`/`last_name` (set by admin at share time)
- **`projects`** — `requester_first_name`/`requester_last_name`/`requester_email` denormalized on the project doc

Names are optional everywhere. Emails are the only guaranteed identifier, so they leak into the UI: chat bubbles, file uploads, project headers, share modals.

Admin status is a hardcoded email list (`ADMIN_EMAILS` in `lib/constants.ts`).

## Desired State

### Principles

1. **Email is internal.** Users should never see another user's email unless they need to contact them.
2. **Names are required at the point they become visible.** A maker gets a name when the builder shares the project. A builder gets a name from Google sign-in or manual entry.
3. **One source of truth for identity.** The `users` collection owns name + email. Other collections reference `user_id` and may cache `display_name` for read performance.
4. **Roles are per-project.** No global "builder" or "maker" role. A person could be a maker on one project and a builder on another.
5. **Admin is a system-level flag**, not a project role. Keep it separate.

### Roles

| Role           | Scope       | What they can do                                                       |
| -------------- | ----------- | ---------------------------------------------------------------------- |
| **maker**      | per-project | Chat with agent, view their brief, upload files                        |
| **apprentice** | per-project | Everything maker can + review briefs                                   |
| **builder**    | per-project | Everything apprentice can + configure agent, manage sessions           |
| **owner**      | per-project | Everything builder can + share project, delete project, manage members |
| **admin**      | system-wide | Implicit owner on all projects, create projects, approve emails        |

This is the existing model and it works. No changes needed.

### Identity Model (Future)

```
users
  id: Firebase Auth UID
  email: string (unique, lowercase)
  first_name: string (required for display)
  last_name: string (optional)
  created_at, updated_at

project_members
  project_id, user_id, email, role
  added_by
  passcode (for maker invite flow)
  // NO first_name/last_name — look up from users collection
  // Cache display_name for read perf if needed

projects
  // NO requester_first_name/last_name/email
  // Just requester_id → look up from users
  // Cache requester_display_name for dashboard cards

messages
  sender_uid: string
  sender_display_name: string  // cached at write time, never changes
  // NO sender_email

files
  uploaded_by_uid: string
  uploaded_by_name: string  // cached at write time
  // Keep uploaded_by_email for admin debugging
```

### Display Name Format

`"Jamie B"` — first name + last initial. Already implemented in `lib/copy.ts` as `formatDisplayName()`.

Falls back to: first name only > email prefix > email (never if we enforce names).

### Open Questions

- **Should makers be able to edit their own name?** Currently only builders set maker names at share time. Makers can't change it. Probably fine for MVP. --- nope, let's fix this. makers can edit.
- **What about multi-project users?** A person with two projects should have one name everywhere. This argues for names on `users`, not `project_members`. -- agreed. make it thus
- **Admin list:** Move from hardcoded emails to a `role: 'admin'` flag on the `users` doc? Not urgent while it's two people. -- let's fix this too. plan the correct approach
- **Support role:** Not needed yet. When it is, it could be a system-level role like admin but read-only (can view all projects, can't configure). -- point is we need an extensible implementation

## MVP: Stop Showing Emails

let's discuss
