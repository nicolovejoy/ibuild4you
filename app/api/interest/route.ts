import { NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/firebase/admin'
import { Resend } from 'resend'
import { ADMIN_EMAILS } from '@/lib/constants'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { name, email, how_found, want_to_try, what_for } = body

    // Validate required fields
    if (!name?.trim() || !email?.trim()) {
      return NextResponse.json({ error: 'Name and email are required' }, { status: 400 })
    }

    const db = getAdminDb()
    const now = new Date().toISOString()

    const docRef = await db.collection('interest_submissions').add({
      name: name.trim(),
      email: email.trim(),
      how_found: how_found?.trim() || '',
      want_to_try: !!want_to_try,
      what_for: what_for?.trim() || '',
      created_at: now,
      updated_at: now,
    })

    // Send email notification to admin
    try {
      await resend.emails.send({
        from: 'iBuild4you <noreply@ibuild4you.com>',
        to: ADMIN_EMAILS,
        subject: `New interest: ${name.trim()}`,
        text: [
          `New interest submission from ${name.trim()} (${email.trim()})`,
          '',
          `How they found us: ${how_found?.trim() || 'Not specified'}`,
          `Wants to try: ${want_to_try ? 'Yes' : 'No'}`,
          `What for: ${what_for?.trim() || 'Not specified'}`,
          '',
          `Submission ID: ${docRef.id}`,
        ].join('\n'),
      })
    } catch (emailErr) {
      // Don't fail the submission if email fails
      console.error('Failed to send admin notification:', emailErr)
    }

    return NextResponse.json({ id: docRef.id }, { status: 201 })
  } catch (err) {
    console.error('Interest submission error:', err)
    return NextResponse.json({ error: 'Failed to submit' }, { status: 500 })
  }
}
