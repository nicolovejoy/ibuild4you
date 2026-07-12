# Files: delete + S3 cleanup + folders (#23)

Plan for #23 (Files tab: delete + folders), folded with the S3-orphan cleanup
that #16 left on the backlog. File lifecycle is one domain — do it in phases.

## Current shape (as of 2026-06-25)

- **Data:** `files` collection (`ProjectFile`: project_id, filename, content_type,
  size_bytes, `storage_path` = S3 key, uploaded_by_*, `status: pending|ready`).
  Bytes live in S3 bucket `ibuild4you-files` at `storage_path`.
- **Routes:** `app/api/files/route.ts` (GET list by project_id), `…/init` (mint
  pending doc + presigned PUT), `…/[fileId]/confirm` (flip to ready),
  `…/[fileId]/route.ts` (GET = download). **No DELETE yet.**
- **UI:** builder Attachments (Brief tab) → `BuilderFilesTab` → `FilesGrid` →
  `FilePreviewModal` (Download button). Maker side renders `FilesGrid` directly.
- **S3 delete pattern** (reuse): `scripts/cleanup-test-data.mjs` —
  `s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: storage_path }))`.
- Hooks: `useProjectFiles`, `useUploadFiles`, `useFileUrl` in `lib/query/hooks.ts`;
  query key `queryKeys.files(projectId)`.

## Phase 0 — delete a file (#23a, quick win) ← THIS SESSION

- `DELETE /api/files/[fileId]`: auth → load file doc → `requireRole(builder)` on
  `file.project_id` → delete S3 object (skip if no storage_path / pending;
  tolerate already-gone) → delete Firestore doc → 200. TDD.
- `useDeleteFile()` hook → invalidate `queryKeys.files(projectId)`.
- Delete button in `FilePreviewModal` behind a `canDelete` prop + type-free
  confirm ("Delete X? Removes the file and any agent references."). `FilesGrid`
  forwards `canDelete`; `BuilderFilesTab` passes `true` (builder console); maker
  `FilesGrid` leaves it false. Server is authoritative regardless.
- **Not in Phase 0:** scrubbing dangling `file_ids` off old messages — a missing
  id degrades gracefully (download 404s, UI shows nothing). Note it, skip it.

## Phase 1 — S3-orphan cleanup on brief delete (from #16) ✅ SHIPPED

- `DELETE /api/projects` now sweeps the project's `files`: drops each S3 object
  via the shared `deleteS3Object` (idempotent + tolerant — a failed/missing
  object can't strand the doc), then batch-deletes the `files` Firestore docs
  alongside sessions/messages/briefs/members. Pending files (no `storage_path`)
  skip the S3 call. Closes the #16 S3-orphan leftover. TDD (3 added tests).

## Phase 2 — folders (#23b) ✅ SHIPPED

- Schema: `folder_id?: string | null` on `ProjectFile`; new `file_folders`
  collection (project_id, name, created_by_email). **Deviation from the
  original sketch: flat folders, no `parent_id`/nesting** — organizational
  need is grouping, not a tree; nesting adds move-cycle/breadcrumb complexity
  nobody asked for. Trivially migratable into the #83 artifacts model.
- Routes: `GET/POST /api/folders`, `PATCH/DELETE /api/folders/[folderId]`,
  `PATCH /api/files/[fileId]` (move; `folder_id: null` = unfile). Folder CRUD
  + move are builder+ (same gate as delete); folder *list* is any member so
  makers see the grouping read-only.
- Deleting a folder never touches files — they move back to Unfiled in the
  same batch as the folder-doc delete.
- Pure helpers in `lib/files/folders.ts` (validate/dedupe/group), TDD.
- UI: grouped sections in `FilesGrid` (folder headers w/ inline rename +
  delete-confirm), "New folder" on the builder Attachments area, move via a
  Folder select in the preview modal. No drag-into v1.
- Keep separate from brief folders — briefs cluster across projects, files
  within one project.

## Decisions

- Delete gated to **builder+** (owner/builder). Makers can't delete via UI; the
  route 403s them. Revisit if makers need to remove their own mis-uploads.
- One S3-delete helper shared by Phase 0 (single file) and Phase 1 (project sweep).
