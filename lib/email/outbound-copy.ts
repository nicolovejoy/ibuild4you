// Outbound email copy in the maker's language (en | fr).
//
// Every email a maker receives — invite, new-conversation nudge, reminder,
// the cron's reminder digest, password reset — reads from here, keyed by the
// brief's `language` (or, for the password reset, the sign-in page's locale).
// English is read from lib/copy.ts, which stays the source of truth for it
// (the cron digest strings, which had no copy key, live inline here);
// `fr` is typed as `OutboundCopy`, so a key added to one language and missing
// in the other fails type-check. Builder-facing email (the nothing-queued
// note, feedback notifications) stays English and does not live here.
//
// Pick the language with outboundCopyFor(project.language).

import { copy } from '@/lib/copy'
import { type Locale, toLocale } from '@/lib/locale'

const en = {
  invite: {
    body: copy.invite.body,
  },
  nudge: {
    bodyText: copy.nudge.bodyText,
    body: copy.nudge.body,
    reminder: copy.nudge.reminder,
  },
  subject: {
    invite: copy.email.subject.invite,
    nudge: copy.email.subject.nudge,
    reminder: copy.email.subject.reminder,
    passwordReset: copy.email.subject.passwordReset,
  },
  passwordResetEmail: copy.passwordResetEmail,
  // The cron's multi-brief digest (#141): one email for a maker on N briefs.
  digest: {
    subject: (briefCount: number) => `Your conversations are waiting (${briefCount} briefs)`,
    lead: (firstName: string | null) =>
      `${firstName ? `${firstName}, your` : 'Your'} conversations are waiting:`,
    line: ({
      projectTitle,
      sessionNumber,
      shareLink,
    }: {
      projectTitle: string
      sessionNumber: number | null
      shareLink: string
    }) => {
      const num = sessionNumber ? ` — conversation #${sessionNumber}` : ''
      return `- "${projectTitle}"${num}: ${shareLink}`
    },
  },
  signOff: ['—', 'iBuild4you'],
}

export type OutboundCopy = typeof en

const fr: OutboundCopy = {
  invite: {
    body: ({ projectTitle, shareLink, resetLink }) =>
      [
        `Je prépare un brief pour ${projectTitle} et j’aimerais avoir votre avis pour l’affiner.`,
        '',
        `Le lien ci-dessous ouvre une conversation où vous pouvez partager vos idées. Ce même lien servira pour les conversations suivantes. L’idée : avec Sam, l’assistant IA d’iBuild4you, nous pouvons avoir des conversations asynchrones et productives. Vos retours sont les bienvenus.`,
        '',
        shareLink,
        '',
        `Connectez-vous avec Google, ou définissez un mot de passe :`,
        resetLink || `Utilisez « Mot de passe oublié ? » sur la page de connexion pour en définir un.`,
        '',
        `(Lien expiré ? « Mot de passe oublié ? » sur la page de connexion fonctionne toujours. L’e-mail de réinitialisation arrive souvent dans les courriers indésirables : pensez à y regarder et à le déplacer dans votre boîte de réception.)`,
      ].join('\n'),
  },
  nudge: {
    bodyText: ({ projectTitle, note, sessionMode }) => {
      const modeHint =
        sessionMode === 'converge'
          ? 'Il est temps d’affiner et d’arrêter quelques décisions.'
          : 'J’aimerais revenir sur quelques points abordés la dernière fois.'
      return `Nouvelle conversation prête pour ${projectTitle}. ${note || modeHint}`
    },
    body: ({ projectTitle, shareLink, note, sessionMode }) =>
      [fr.nudge.bodyText({ projectTitle, note, sessionMode }), '', shareLink].join('\n'),
    reminder: ({ firstName, sessionNumber, shareLink }) => {
      const lead = firstName ? `${firstName}, votre` : 'Votre'
      const num = sessionNumber ? ` (nº ${sessionNumber})` : ''
      return [`${lead} prochaine conversation${num} vous attend :`, '', shareLink].join('\n')
    },
  },
  subject: {
    invite: (projectTitle) => `Votre brief pour « ${projectTitle} »`,
    nudge: (projectTitle) => `Nouvelle conversation prête pour « ${projectTitle} »`,
    reminder: (projectTitle) => `Votre conversation pour « ${projectTitle} » est prête`,
    passwordReset: 'Définir un nouveau mot de passe pour iBuild4you',
  },
  passwordResetEmail: ({ resetLink }) =>
    [
      'Quelqu’un (probablement vous) a demandé à réinitialiser le mot de passe de votre compte iBuild4you.',
      '',
      'Définissez un nouveau mot de passe ici :',
      resetLink,
      '',
      'Si le lien a expiré d’ici là, touchez de nouveau « Mot de passe oublié ? » sur la page de connexion — cela fonctionne toujours.',
      '',
      'Si vous n’êtes pas à l’origine de cette demande, vous pouvez ignorer cet e-mail. Rien ne change tant que vous ne définissez pas de nouveau mot de passe.',
      '',
      'P.-S. — si cet e-mail est arrivé dans vos courriers indésirables, déplacez-le dans votre boîte de réception pour que nos prochains e-mails vous parviennent.',
    ].join('\n'),
  digest: {
    subject: (briefCount) => `Vos conversations vous attendent (${briefCount} briefs)`,
    lead: (firstName) => `${firstName ? `${firstName}, vos` : 'Vos'} conversations vous attendent :`,
    line: ({ projectTitle, sessionNumber, shareLink }) => {
      const num = sessionNumber ? ` — conversation nº ${sessionNumber}` : ''
      return `- « ${projectTitle} »${num} : ${shareLink}`
    },
  },
  signOff: ['—', 'iBuild4you'],
}

export const outboundCopy: Record<Locale, OutboundCopy> = { en, fr }

/** The outbound copy for a brief's stored language (anything unknown → English). */
export function outboundCopyFor(language: unknown): OutboundCopy {
  return outboundCopy[toLocale(language)]
}
