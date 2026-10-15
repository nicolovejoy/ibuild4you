// Maker-facing app copy (sign-in, password setup, not-approved, dashboard, user
// menu) in English and French. Builder-only screens stay English and keep
// reading lib/copy.ts.
//
// English mirrors what the app rendered before translation: strings that
// already lived in lib/copy.ts are read from there (it stays the source of
// truth for English); strings that were hard-coded in components move here.
//
// `fr` is typed as `MakerCopy`, so a key added to one language and missing in
// the other fails type-check. Pick the language with useMakerCopy().

import { copy } from './copy'
import type { Locale } from './locale'

const en = {
  common: {
    loading: copy.loading,
    about: 'About',
    aboutHref: '/about',
    homeHref: '/',
    signOut: copy.auth.signOut,
    admin: 'Admin',
    addLabel: 'Add a label',
    labelPlaceholder: 'e.g. main, test',
    backToHome: 'Back to home',
    // EN/FR toggle: label shows the language you'd switch TO.
    langToggle: { label: 'FR', aria: 'Passer en français' },
    accountName: 'Account name',
    saveAccountName: 'Save account name',
    cancel: 'Cancel',
    setPassword: copy.auth.setPassword,
  },
  login: {
    welcome: copy.auth.welcome,
    signInPrompt: copy.auth.signInPrompt,
    signInGoogle: copy.auth.signInGoogle,
    signInPassword: copy.auth.signInPassword,
    signingIn: 'Signing in...',
    passwordDivider: copy.auth.passwordDivider,
    emailLabel: 'Email',
    emailPlaceholder: 'you@example.com',
    passwordLabel: copy.auth.passwordLabel,
    passwordPlaceholder: 'Your password',
    forgotPassword: copy.auth.forgotPassword,
    forgotNeedsEmail: 'Enter your email above first, then tap “Forgot password?”',
    resetEmailSent: copy.auth.resetEmailSent,
    resetRateLimited: 'Too many reset requests. Try again later.',
    googleUnsupported:
      'Google sign-in is not supported in this browser. Try opening the link in Safari or Chrome, or sign in with your password below.',
    popupBlocked: 'Pop-up was blocked. Try again, or sign in with your password below.',
    signInFailed: 'Sign-in failed',
    inAppTitle: 'Looks like you’re in an in-app browser',
    inAppBody:
      'Google sign-in may not work here. Sign in with your email and password, or open this page in Safari or Chrome.',
    copyLink: 'Copy link to clipboard',
    copied: 'Copied!',
    notSure: 'Not sure what this is?',
    learnMore: 'Learn more',
  },
  action: {
    checking: 'Checking your link…',
    resetTitle: copy.auth.actionResetTitle,
    resetSuccess: copy.auth.actionResetSuccess,
    redirecting: copy.auth.actionRedirecting,
    expiredTitle: copy.auth.actionExpiredTitle,
    expiredBody: copy.auth.actionExpiredBody,
    invalidTitle: copy.auth.actionInvalidTitle,
    invalidBody: copy.auth.actionInvalidBody,
    unsupportedTitle: copy.auth.actionUnsupportedTitle,
    unsupportedBody: copy.auth.actionUnsupportedBody,
    goToSignIn: 'Go to sign in',
    continueNow: 'Continue now',
    emailLabel: 'Email',
    newPassword: 'New password',
    confirmPassword: 'Confirm new password',
    mismatch: 'Passwords do not match.',
    setPasswordHelp: copy.auth.setPasswordHelp,
    submit: 'Set password',
  },
  notApproved: {
    title: copy.auth.notApprovedTitle,
    message: copy.auth.notApprovedMessage,
    wrongAccount: copy.auth.notApprovedWrongAccount,
  },
  dashboard: {
    title: copy.dashboard.title,
    emptyTitle: 'No briefs yet',
    emptyMaker: copy.dashboard.emptyMaker,
    loadFailed: 'Failed to load briefs. Please try again.',
    brief: 'Brief',
    features: (n: number) => `${n} feature${n === 1 ? '' : 's'}`,
    decisions: (n: number) => `${n} decision${n === 1 ? '' : 's'}`,
    activityAgent: copy.dashboard.activityAgent,
    activityMaker: copy.dashboard.activityMaker,
    builderActivity: copy.dashboard.builderActivity,
    nudgedAt: copy.dashboard.nudgedAt,
    sharedAt: copy.dashboard.sharedAt,
    archive: copy.dashboard.archive,
    unarchive: copy.dashboard.unarchive,
    sections: copy.dashboard.sections,
  },
  turn: {
    completed: 'Completed',
    needsSetup: copy.glossary.needsSetup.term,
    waitingForBuilder: 'Waiting for builder',
    yourTurn: copy.dashboard.turnYourTurn,
    waitingOn: copy.dashboard.turnAwaitingMaker,
  },
  time: {
    justNow: 'just now',
    minutesAgo: (n: number) => `${n}m ago`,
    hoursAgo: (n: number) => `${n}h ago`,
    daysAgo: (n: number) => `${n}d ago`,
    dateLocale: 'en-US',
  },
}

export type MakerCopy = typeof en

const fr: MakerCopy = {
  common: {
    loading: 'Chargement…',
    about: 'À propos',
    aboutHref: '/fr/about',
    homeHref: '/fr',
    signOut: 'Se déconnecter',
    admin: 'Admin',
    addLabel: 'Ajouter un libellé',
    labelPlaceholder: 'ex. principal, test',
    backToHome: 'Retour à l’accueil',
    langToggle: { label: 'EN', aria: 'Switch to English' },
    accountName: 'Nom du compte',
    saveAccountName: 'Enregistrer le nom du compte',
    cancel: 'Annuler',
    setPassword: 'Définir un mot de passe',
  },
  login: {
    welcome: 'Bienvenue',
    signInPrompt: 'Connectez-vous pour continuer',
    signInGoogle: 'Se connecter avec Google',
    signInPassword: 'Se connecter avec un mot de passe',
    signingIn: 'Connexion…',
    passwordDivider: 'ou connectez-vous avec un mot de passe',
    emailLabel: 'E-mail',
    emailPlaceholder: 'vous@exemple.com',
    passwordLabel: 'Mot de passe',
    passwordPlaceholder: 'Votre mot de passe',
    forgotPassword: 'Mot de passe oublié ?',
    forgotNeedsEmail: 'Saisissez d’abord votre e-mail ci-dessus, puis touchez « Mot de passe oublié ? »',
    resetEmailSent: (email: string) =>
      `Si un compte existe pour ${email}, un lien de réinitialisation est en route. Vérifiez aussi vos courriers indésirables : s’il s’y trouve, déplacez-le dans votre boîte de réception pour que nos e-mails ne soient plus filtrés.`,
    resetRateLimited: 'Trop de demandes de réinitialisation. Réessayez plus tard.',
    googleUnsupported:
      'La connexion avec Google n’est pas prise en charge dans ce navigateur. Ouvrez le lien dans Safari ou Chrome, ou connectez-vous avec votre mot de passe ci-dessous.',
    popupBlocked: 'La fenêtre a été bloquée. Réessayez, ou connectez-vous avec votre mot de passe ci-dessous.',
    signInFailed: 'Échec de la connexion',
    inAppTitle: 'Vous semblez utiliser le navigateur d’une application',
    inAppBody:
      'La connexion avec Google risque de ne pas fonctionner ici. Connectez-vous avec votre e-mail et votre mot de passe, ou ouvrez cette page dans Safari ou Chrome.',
    copyLink: 'Copier le lien',
    copied: 'Copié !',
    notSure: 'Vous ne savez pas ce que c’est ?',
    learnMore: 'En savoir plus',
  },
  action: {
    checking: 'Vérification du lien…',
    resetTitle: 'Choisir un nouveau mot de passe',
    resetSuccess: 'Mot de passe enregistré. Vous pouvez maintenant vous connecter avec.',
    redirecting: (seconds: number) =>
      `Redirection vers la connexion dans ${seconds} seconde${seconds > 1 ? 's' : ''}…`,
    expiredTitle: 'Ce lien a expiré',
    expiredBody:
      'Les liens de mot de passe ne servent qu’une fois et pour une durée limitée. Touchez « Mot de passe oublié ? » sur la page de connexion pour en recevoir un nouveau.',
    invalidTitle: 'Ce lien est incomplet',
    invalidBody:
      'Certaines messageries raccourcissent les liens longs. Rouvrez-le depuis l’e-mail d’origine, ou demandez-en un nouveau depuis la page de connexion.',
    unsupportedTitle: 'Rien à faire ici',
    unsupportedBody: 'Ce lien correspond à une action que cette application n’utilise pas.',
    goToSignIn: 'Aller à la connexion',
    continueNow: 'Continuer maintenant',
    emailLabel: 'E-mail',
    newPassword: 'Nouveau mot de passe',
    confirmPassword: 'Confirmer le nouveau mot de passe',
    mismatch: 'Les mots de passe ne correspondent pas.',
    setPasswordHelp:
      'Ajoutez une connexion par e-mail et mot de passe pour vous connecter sans choisir de compte Google. Nous recommandons un mot de passe généré par un gestionnaire de mots de passe.',
    submit: 'Enregistrer le mot de passe',
  },
  notApproved: {
    title: 'Encore un instant !',
    message: (email: string) =>
      `Merci de votre inscription. Votre compte (${email}) n’est pas encore approuvé. Nous vous préviendrons dès que vous aurez accès.`,
    wrongAccount: 'Connecté avec le mauvais compte ? Déconnectez-vous et réessayez.',
  },
  dashboard: {
    title: 'Vos briefs',
    emptyTitle: 'Aucun brief pour l’instant',
    emptyMaker: 'Vous n’avez encore aucun brief. Revenez bientôt !',
    loadFailed: 'Impossible de charger les briefs. Veuillez réessayer.',
    brief: 'Brief',
    features: (n: number) => `${n} fonctionnalité${n > 1 ? 's' : ''}`,
    decisions: (n: number) => `${n} décision${n > 1 ? 's' : ''}`,
    activityAgent: (time: string) => `L’assistant a répondu ${time}`,
    activityMaker: (name: string, time: string) => `${name} a écrit ${time}`,
    builderActivity: (time: string) => `Modifié par vous ${time}`,
    nudgedAt: (time: string) => `Relancé ${time}`,
    sharedAt: (time: string) => `Partagé ${time}`,
    archive: 'Archiver',
    unarchive: 'Désarchiver',
    sections: {
      awaiting: { title: 'À vous de jouer' },
      yours: { title: 'Les vôtres', emptyHint: 'Aucun brief lancé par vous.' },
      reviewing: { title: 'En relecture', emptyHint: 'Rien à relire pour le moment.' },
      contributing: { title: 'Vos contributions', emptyHint: 'Aucun brief auquel vous contribuez.' },
      done: { title: 'Terminés' },
      archived: { title: 'Archivés' },
    },
  },
  turn: {
    completed: 'Terminé',
    needsSetup: 'À configurer',
    waitingForBuilder: 'En attente du développeur',
    yourTurn: 'À vous',
    waitingOn: (name: string) => `En attente de ${name}`,
  },
  time: {
    justNow: 'à l’instant',
    minutesAgo: (n: number) => `il y a ${n} min`,
    hoursAgo: (n: number) => `il y a ${n} h`,
    daysAgo: (n: number) => `il y a ${n} j`,
    dateLocale: 'fr-FR',
  },
}

export const makerCopy: Record<Locale, MakerCopy> = { en, fr }

/** "5m ago" / "il y a 5 min"; a short date after a week. */
export function formatRelativeTime(iso: string, locale: Locale, now: Date = new Date()): string {
  const t = makerCopy[locale].time
  const date = new Date(iso)
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return t.justNow
  if (diffMins < 60) return t.minutesAgo(diffMins)
  if (diffHours < 24) return t.hoursAgo(diffHours)
  if (diffDays < 7) return t.daysAgo(diffDays)
  return date.toLocaleDateString(t.dateLocale, { month: 'short', day: 'numeric' })
}
