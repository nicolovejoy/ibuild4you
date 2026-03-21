import { describe, it, expect } from 'vitest'
import type {
  AppUser,
  Project,
  Session,
  Message,
  Brief,
  Review,
  ReviewAnnotation,
  MemberRole,
  ProjectMember,
} from '../index'

// Type-level tests — these verify the data model compiles and
// the shapes match what Firestore collections will store.

describe('data model types', () => {
  it('AppUser has required fields', () => {
    const user: AppUser = {
      id: 'u1',
      email: 'jamie@bakery.com',
      created_at: '2026-03-18T00:00:00Z',
      updated_at: '2026-03-18T00:00:00Z',
    }
    expect(user.email).toBeDefined()
  })

  it('MemberRole has four levels', () => {
    const roles: MemberRole[] = ['owner', 'builder', 'apprentice', 'maker']
    expect(roles).toHaveLength(4)
  })

  it('ProjectMember links user to project with a role', () => {
    const member: ProjectMember = {
      id: 'pm1',
      project_id: 'p1',
      user_id: 'u1',
      email: 'jamie@bakery.com',
      role: 'maker',
      added_by: 'nlovejoy@me.com',
      created_at: '2026-03-18T00:00:00Z',
      updated_at: '2026-03-18T00:00:00Z',
    }
    expect(member.role).toBe('maker')
    expect(member.project_id).toBe('p1')
  })

  it('Project belongs to a requester', () => {
    const project: Project = {
      id: 'p1',
      requester_id: 'u1',
      title: "Jamie's Bakery App",
      status: 'active',
      created_at: '2026-03-18T00:00:00Z',
      updated_at: '2026-03-18T00:00:00Z',
    }
    expect(project.status).toBe('active')
  })

  it('Session belongs to a project', () => {
    const session: Session = {
      id: 's1',
      project_id: 'p1',
      status: 'active',
      created_at: '2026-03-18T00:00:00Z',
      updated_at: '2026-03-18T00:00:00Z',
    }
    expect(session.project_id).toBe('p1')
  })

  it('Message has role of user or agent', () => {
    const userMsg: Message = {
      id: 'm1',
      session_id: 's1',
      role: 'user',
      content: 'I want an app for my bakery',
      created_at: '2026-03-18T00:00:00Z',
      updated_at: '2026-03-18T00:00:00Z',
    }
    const agentMsg: Message = {
      id: 'm2',
      session_id: 's1',
      role: 'agent',
      content: 'Tell me more about what your customers need',
      created_at: '2026-03-18T00:00:01Z',
      updated_at: '2026-03-18T00:00:01Z',
    }
    expect(userMsg.role).toBe('user')
    expect(agentMsg.role).toBe('agent')
  })

  it('Brief is versioned and belongs to a project', () => {
    const brief: Brief = {
      id: 'b1',
      project_id: 'p1',
      version: 1,
      content: {
        problem: 'No online ordering',
        target_users: 'Bakery customers and staff',
        features: ['Online ordering', 'Menu display'],
        constraints: '',
        additional_context: '',
      },
      created_at: '2026-03-18T00:00:00Z',
      updated_at: '2026-03-18T00:00:00Z',
    }
    expect(brief.version).toBe(1)
  })

  it('Review has annotations from a builder', () => {
    const annotation: ReviewAnnotation = {
      section: 'problem',
      comment: 'Ask more about peak hours',
      created_at: '2026-03-18T00:00:00Z',
    }
    const review: Review = {
      id: 'r1',
      brief_id: 'b1',
      project_id: 'p1',
      reviewer_id: 'u2',
      annotations: [annotation],
      created_at: '2026-03-18T00:00:00Z',
      updated_at: '2026-03-18T00:00:00Z',
    }
    expect(review.annotations).toHaveLength(1)
    expect(review.annotations[0].section).toBe('problem')
  })
})
