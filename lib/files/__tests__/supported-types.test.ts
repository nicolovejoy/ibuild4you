import { describe, it, expect } from 'vitest'
import {
  classifyAttachment,
  isSupportedUpload,
  SUPPORTED_TYPES_LABEL,
} from '../supported-types'

// =============================================================================
// SUPPORTED FILE TYPES — single source of truth for what the agent can read.
//
// Classification keys off content-type AND filename extension, because browsers
// frequently send an empty or `application/octet-stream` content-type for text
// and code files (.md, .ts, .csv) and sometimes for .docx. The extension is the
// fallback signal so those files aren't misclassified as unsupported.
//
// Categories: 'image' | 'pdf' | 'text' | 'docx' | 'unsupported'.
// =============================================================================

describe('classifyAttachment', () => {
  it('classifies images by content type', () => {
    expect(classifyAttachment({ filename: 'a.png', contentType: 'image/png' })).toBe('image')
    expect(classifyAttachment({ filename: 'a.jpg', contentType: 'image/jpeg' })).toBe('image')
    expect(classifyAttachment({ filename: 'a.gif', contentType: 'image/gif' })).toBe('image')
    expect(classifyAttachment({ filename: 'a.webp', contentType: 'image/webp' })).toBe('image')
  })

  it('classifies images by extension when content type is missing', () => {
    expect(classifyAttachment({ filename: 'photo.JPEG', contentType: '' })).toBe('image')
    expect(classifyAttachment({ filename: 'photo.png', contentType: 'application/octet-stream' })).toBe('image')
  })

  it('classifies PDFs', () => {
    expect(classifyAttachment({ filename: 'r.pdf', contentType: 'application/pdf' })).toBe('pdf')
    expect(classifyAttachment({ filename: 'r.pdf', contentType: '' })).toBe('pdf')
  })

  it('classifies Word .docx by content type and by extension', () => {
    const docxType =
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    expect(classifyAttachment({ filename: 'notes.docx', contentType: docxType })).toBe('docx')
    // Some browsers send octet-stream for docx — extension carries it.
    expect(classifyAttachment({ filename: 'notes.docx', contentType: 'application/octet-stream' })).toBe('docx')
  })

  it('classifies text and code files', () => {
    expect(classifyAttachment({ filename: 'a.txt', contentType: 'text/plain' })).toBe('text')
    expect(classifyAttachment({ filename: 'a.md', contentType: '' })).toBe('text')
    expect(classifyAttachment({ filename: 'data.csv', contentType: 'text/csv' })).toBe('text')
    expect(classifyAttachment({ filename: 'data.json', contentType: 'application/json' })).toBe('text')
    expect(classifyAttachment({ filename: 'config.yaml', contentType: '' })).toBe('text')
    expect(classifyAttachment({ filename: 'script.ts', contentType: 'application/octet-stream' })).toBe('text')
  })

  it('strips content-type parameters before matching', () => {
    expect(classifyAttachment({ filename: 'a.txt', contentType: 'text/plain; charset=utf-8' })).toBe('text')
  })

  it('returns unsupported for formats we cannot read', () => {
    expect(classifyAttachment({ filename: 'deck.pptx', contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })).toBe('unsupported')
    expect(classifyAttachment({ filename: 'old.doc', contentType: 'application/msword' })).toBe('unsupported')
    expect(classifyAttachment({ filename: 'sheet.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })).toBe('unsupported')
    expect(classifyAttachment({ filename: 'page.pages', contentType: '' })).toBe('unsupported')
    expect(classifyAttachment({ filename: 'photo.heic', contentType: 'image/heic' })).toBe('unsupported')
    expect(classifyAttachment({ filename: 'mystery', contentType: '' })).toBe('unsupported')
  })
})

describe('isSupportedUpload', () => {
  it('accepts every readable category', () => {
    expect(isSupportedUpload({ filename: 'a.pdf', contentType: 'application/pdf' })).toBe(true)
    expect(isSupportedUpload({ filename: 'a.png', contentType: 'image/png' })).toBe(true)
    expect(isSupportedUpload({ filename: 'a.md', contentType: '' })).toBe(true)
    expect(isSupportedUpload({ filename: 'a.docx', contentType: 'application/octet-stream' })).toBe(true)
  })

  it('rejects unsupported formats', () => {
    expect(isSupportedUpload({ filename: 'deck.pptx', contentType: '' })).toBe(false)
    expect(isSupportedUpload({ filename: 'photo.heic', contentType: 'image/heic' })).toBe(false)
  })
})

describe('SUPPORTED_TYPES_LABEL', () => {
  it('is a human-readable string for error messages', () => {
    expect(typeof SUPPORTED_TYPES_LABEL).toBe('string')
    expect(SUPPORTED_TYPES_LABEL.toLowerCase()).toContain('pdf')
  })
})
