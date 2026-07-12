import type { ProjectFile, FileFolder } from '@/lib/types'

// Pure helpers for file folders (#23b). Folders are flat (no nesting) and
// purely organizational — deleting one never touches the files in it.

export const FOLDER_NAME_MAX = 60

export type FolderNameResult = { ok: true; name: string } | { ok: false; error: string }

export function validateFolderName(raw: string): FolderNameResult {
  const name = raw.trim()
  if (!name) return { ok: false, error: 'Folder name is required' }
  if (name.length > FOLDER_NAME_MAX) {
    return { ok: false, error: `Folder name must be ${FOLDER_NAME_MAX} characters or fewer` }
  }
  return { ok: true, name }
}

// Case-insensitive duplicate check. `excludeId` skips the folder being renamed.
export function isDuplicateFolderName(
  name: string,
  folders: Pick<FileFolder, 'id' | 'name'>[],
  excludeId?: string,
): boolean {
  const lower = name.trim().toLowerCase()
  return folders.some((f) => f.id !== excludeId && f.name.toLowerCase() === lower)
}

export interface FolderSection {
  folder: FileFolder
  files: ProjectFile[]
}

export interface GroupedFiles {
  sections: FolderSection[]
  unfiled: ProjectFile[]
}

// Group files under their folders (sorted by name, case-insensitive) plus an
// unfiled bucket. A dangling folder_id degrades to unfiled; empty folders are
// kept so a freshly created folder is visible.
export function groupFilesByFolder(files: ProjectFile[], folders: FileFolder[]): GroupedFiles {
  const sorted = [...folders].sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  )
  const byFolder = new Map<string, ProjectFile[]>(sorted.map((f) => [f.id, []]))
  const unfiled: ProjectFile[] = []
  for (const file of files) {
    const bucket = file.folder_id ? byFolder.get(file.folder_id) : undefined
    if (bucket) bucket.push(file)
    else unfiled.push(file)
  }
  return {
    sections: sorted.map((folder) => ({ folder, files: byFolder.get(folder.id)! })),
    unfiled,
  }
}
