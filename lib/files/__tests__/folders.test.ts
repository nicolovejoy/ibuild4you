import { describe, it, expect } from 'vitest'
import { validateFolderName, isDuplicateFolderName, groupFilesByFolder } from '../folders'
import type { ProjectFile, FileFolder } from '@/lib/types'

// =============================================================================
// FILE FOLDERS PURE HELPERS (#23b)
// =============================================================================

function folder(id: string, name: string): FileFolder {
  return {
    id,
    project_id: 'p1',
    name,
    created_at: '2026-07-12T00:00:00.000Z',
    updated_at: '2026-07-12T00:00:00.000Z',
  }
}

function file(id: string, folderId?: string | null): ProjectFile {
  return {
    id,
    project_id: 'p1',
    filename: `${id}.pdf`,
    content_type: 'application/pdf',
    size_bytes: 100,
    storage_path: `projects/p1/${id}/${id}.pdf`,
    uploaded_by_email: 'user@example.com',
    uploaded_by_uid: 'u1',
    created_at: '2026-07-12T00:00:00.000Z',
    updated_at: '2026-07-12T00:00:00.000Z',
    ...(folderId !== undefined && { folder_id: folderId }),
  }
}

describe('validateFolderName', () => {
  it('accepts a normal name and trims whitespace', () => {
    expect(validateFolderName('  Mockups ')).toEqual({ ok: true, name: 'Mockups' })
  })

  it('rejects empty and whitespace-only names', () => {
    expect(validateFolderName('').ok).toBe(false)
    expect(validateFolderName('   ').ok).toBe(false)
  })

  it('rejects names over 60 characters', () => {
    expect(validateFolderName('x'.repeat(61)).ok).toBe(false)
    expect(validateFolderName('x'.repeat(60)).ok).toBe(true)
  })
})

describe('isDuplicateFolderName', () => {
  const folders = [folder('f1', 'Mockups'), folder('f2', 'Contracts')]

  it('matches case-insensitively', () => {
    expect(isDuplicateFolderName('mockups', folders)).toBe(true)
    expect(isDuplicateFolderName('MOCKUPS', folders)).toBe(true)
  })

  it('returns false for a new name', () => {
    expect(isDuplicateFolderName('Photos', folders)).toBe(false)
  })

  it('excludes the folder being renamed', () => {
    expect(isDuplicateFolderName('Mockups', folders, 'f1')).toBe(false)
    expect(isDuplicateFolderName('Mockups', folders, 'f2')).toBe(true)
  })
})

describe('groupFilesByFolder', () => {
  it('groups files under their folders, sorted by name case-insensitively', () => {
    const folders = [folder('f1', 'zeta'), folder('f2', 'Alpha')]
    const files = [file('a', 'f1'), file('b', 'f2'), file('c', 'f1')]
    const result = groupFilesByFolder(files, folders)
    expect(result.sections.map((s) => s.folder.id)).toEqual(['f2', 'f1'])
    expect(result.sections[0].files.map((f) => f.id)).toEqual(['b'])
    expect(result.sections[1].files.map((f) => f.id)).toEqual(['a', 'c'])
    expect(result.unfiled).toEqual([])
  })

  it('puts files with no folder_id (or null) in unfiled, preserving order', () => {
    const files = [file('a'), file('b', null), file('c', 'f1')]
    const result = groupFilesByFolder(files, [folder('f1', 'Docs')])
    expect(result.unfiled.map((f) => f.id)).toEqual(['a', 'b'])
  })

  it('treats a dangling folder_id as unfiled', () => {
    const files = [file('a', 'gone')]
    const result = groupFilesByFolder(files, [folder('f1', 'Docs')])
    expect(result.unfiled.map((f) => f.id)).toEqual(['a'])
  })

  it('includes empty folders so a freshly created one is visible', () => {
    const result = groupFilesByFolder([], [folder('f1', 'Docs')])
    expect(result.sections).toHaveLength(1)
    expect(result.sections[0].files).toEqual([])
  })
})
