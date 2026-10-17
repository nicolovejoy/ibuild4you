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
import { SUPPORTED_TYPES_LABEL } from './files/supported-types'
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
    makerQuestions: (n: number, name: string) => `${n} for ${name}`,
    makerFallbackName: 'the maker',
    activityAgent: copy.dashboard.activityAgent,
    activityMaker: copy.dashboard.activityMaker,
    builderActivity: copy.dashboard.builderActivity,
    nudgedAt: copy.dashboard.nudgedAt,
    prepCopiedAt: copy.dashboard.prepCopiedAt,
    payloadPastedAt: copy.dashboard.payloadPastedAt,
    newerThanPaste: copy.dashboard.newerThanPaste,
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
    makerWaiting: copy.dashboard.turnMakerWaiting,
  },
  chat: {
    agentLabel: copy.chat.agentLabel,
    assistant: 'Assistant',
    you: 'You',
    chattingWith: (agent: string) => `Chatting with ${agent}`,
    editName: 'Edit your name',
    firstShort: 'First',
    lastShort: 'Last',
    save: 'Save',
    cancel: 'Cancel',
    whatIsThis: 'What is iBuild4you?',
    joinedAs: (name: string | null) =>
      `You’ve joined this conversation${name ? ` as ${name}` : ''} — everyone on this brief sees your messages.`,
    backToBuilder: 'Back to builder view',
    attachFiles: 'Attach files',
    placeholder: copy.chat.placeholder,
    send: 'Send (Cmd/Ctrl+Enter)',
    keyboardHint: 'Enter adds a line · Cmd/Ctrl+Enter sends',
    uploading: 'Uploading files...',
    emptyState: copy.chat.makerEmptyState,
    kickoffFailed: copy.chat.makerKickoffFailed,
    nothingQueuedGreeting: copy.chat.nothingQueuedGreeting,
    builderFallbackName: copy.chat.builderFallbackName,
    removeRating: 'Remove rating',
    helpful: 'Helpful',
    notHelpful: 'Not helpful',
    fileTooBig: (name: string) => `File "${name}" exceeds 25MB limit`,
    unsupportedFile: (name: string, supported: string) =>
      `Sorry, I can't open "${name}". I can read ${supported} — could you export it as a PDF and try again?`,
    supportedTypes: SUPPORTED_TYPES_LABEL,
    startFailed: 'Failed to start session',
    uploadFailedOne: (n: number, error: string) => `Failed to upload ${n === 1 ? 'file' : 'files'}: ${error}`,
    uploadFailedSome: (failed: number, total: number) => `${failed} of ${total} files failed to upload — try those again.`,
    uploadFailed: 'Failed to upload files',
    files: (n: number) => `Files (${n})`,
    previousConversations: 'Previous conversations',
    conversationN: (n: number, date: string) => `Conversation ${n} · ${date}`,
    noMessagesInSession: 'No messages in this session.',
    namePromptTitle: 'What should we call you?',
    namePromptBody: 'Just so your builder knows who they’re working with.',
    firstName: 'First name',
    lastNameOptional: 'Last name (optional)',
    continue: 'Continue',
    switchBrief: 'Switch brief',
    yourBriefs: copy.dashboard.title,
  },
  files: {
    empty: 'No files shared yet.',
    pinned: 'Pinned',
    unfiled: 'Unfiled',
    download: 'Download',
  },
  roles: {
    originator: { term: copy.glossary.originator.term, short: copy.glossary.originator.short },
    contributor: { term: copy.glossary.contributor.term, short: copy.glossary.contributor.short },
    reviewer: { term: copy.glossary.reviewer.term, short: copy.glossary.reviewer.short },
  },
  setPassword: {
    title: copy.auth.setPassword,
    help: copy.auth.setPasswordHelp,
    success: copy.auth.setPasswordSuccess,
    newPassword: 'New password',
    confirmPassword: 'Confirm password',
    mismatch: 'Passwords do not match.',
    noEmail: 'Your account has no email address to attach a password to.',
    saving: 'Saving...',
    done: 'Done',
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
    makerQuestions: (n: number, name: string) => `${n} pour ${name}`,
    makerFallbackName: 'le maker',
    activityAgent: (time: string) => `L’assistant a répondu ${time}`,
    activityMaker: (name: string, time: string) => `${name} a écrit ${time}`,
    builderActivity: (time: string) => `Modifié par vous ${time}`,
    nudgedAt: (time: string) => `Relancé ${time}`,
    prepCopiedAt: (time: string) => `Préparation copiée ${time}`,
    payloadPastedAt: (time: string) => `Collé ${time}`,
    newerThanPaste: 'nouveau depuis le collage',
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
    makerWaiting: 'Maker en attente — rien de prévu',
  },
  chat: {
    agentLabel: copy.chat.agentLabel,
    assistant: 'Assistant',
    you: 'Vous',
    chattingWith: (agent: string) => `En conversation avec ${agent}`,
    editName: 'Modifier votre nom',
    firstShort: 'Prénom',
    lastShort: 'Nom',
    save: 'Enregistrer',
    cancel: 'Annuler',
    whatIsThis: 'Qu’est-ce qu’iBuild4you ?',
    joinedAs: (name: string | null) =>
      `Vous avez rejoint cette conversation${name ? ` en tant que ${name}` : ''} : tous les participants du brief voient vos messages.`,
    backToBuilder: 'Retour à la vue développeur',
    attachFiles: 'Joindre des fichiers',
    placeholder: 'Écrivez un message…',
    send: 'Envoyer (Cmd/Ctrl+Entrée)',
    keyboardHint: 'Entrée ajoute une ligne · Cmd/Ctrl+Entrée envoie',
    uploading: 'Envoi des fichiers…',
    emptyState: 'Envoyez un message pour commencer la conversation.',
    kickoffFailed: 'Sam n’a pas pu lancer la conversation — dites bonjour pour commencer.',
    nothingQueuedGreeting: (builder: string) =>
      `Bonjour — ${builder} n’a pas encore préparé notre prochaine conversation, alors je n’ai rien de nouveau à voir avec vous. Si quelque chose vous préoccupe d’ici là, dites-le-moi et je garderai des notes pour ${builder}.`,
    builderFallbackName: 'votre développeur',
    removeRating: 'Retirer l’évaluation',
    helpful: 'Utile',
    notHelpful: 'Pas utile',
    fileTooBig: (name: string) => `Le fichier « ${name} » dépasse la limite de 25 Mo`,
    unsupportedFile: (name: string, supported: string) =>
      `Désolé, je ne peux pas ouvrir « ${name} ». Je sais lire ${supported} : pourriez-vous l’exporter en PDF et réessayer ?`,
    supportedTypes: 'les PDF, les images, les fichiers texte ou de code et les documents Word (.docx)',
    startFailed: 'Impossible de démarrer la conversation',
    uploadFailedOne: (n: number, error: string) =>
      `Échec de l’envoi ${n === 1 ? 'du fichier' : 'des fichiers'} : ${error}`,
    uploadFailedSome: (failed: number, total: number) =>
      `${failed} fichier${failed > 1 ? 's' : ''} sur ${total} n’${failed > 1 ? 'ont' : 'a'} pas pu être envoyé${failed > 1 ? 's' : ''} : réessayez.`,
    uploadFailed: 'Échec de l’envoi des fichiers',
    files: (n: number) => `Fichiers (${n})`,
    previousConversations: 'Conversations précédentes',
    conversationN: (n: number, date: string) => `Conversation ${n} · ${date}`,
    noMessagesInSession: 'Aucun message dans cette conversation.',
    namePromptTitle: 'Comment devons-nous vous appeler ?',
    namePromptBody: 'Pour que la personne qui développe votre projet sache avec qui elle travaille.',
    firstName: 'Prénom',
    lastNameOptional: 'Nom (facultatif)',
    continue: 'Continuer',
    switchBrief: 'Changer de brief',
    yourBriefs: 'Vos briefs',
  },
  files: {
    empty: 'Aucun fichier partagé pour l’instant.',
    pinned: 'Épinglés',
    unfiled: 'Sans dossier',
    download: 'Télécharger',
  },
  roles: {
    originator: { term: 'Initiateur', short: 'La personne qui a apporté l’idée de ce brief. En général la première à écrire.' },
    contributor: { term: 'Contributeur', short: 'Apporte sa voix, ses questions et son contexte au brief, aux côtés de l’initiateur.' },
    reviewer: { term: 'Relecteur', short: 'Annote et valide : signale ce qui manque ou n’est pas clair, et oriente la prochaine conversation.' },
  },
  setPassword: {
    title: 'Définir un mot de passe',
    help: 'Ajoutez une connexion par e-mail et mot de passe pour vous connecter sans choisir de compte Google. Nous recommandons un mot de passe généré par un gestionnaire de mots de passe.',
    success: 'Mot de passe enregistré. Vous pouvez maintenant vous connecter avec votre e-mail et votre mot de passe.',
    newPassword: 'Nouveau mot de passe',
    confirmPassword: 'Confirmer le mot de passe',
    mismatch: 'Les mots de passe ne correspondent pas.',
    noEmail: 'Votre compte n’a pas d’adresse e-mail à laquelle associer un mot de passe.',
    saving: 'Enregistrement…',
    done: 'Terminé',
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

/** Message timestamp: time today, else short date + time. */
export function formatMessageTimestamp(iso: string, locale: Locale, now: Date = new Date()): string {
  const tag = makerCopy[locale].time.dateLocale
  const date = new Date(iso)
  // French clocks read 07:53; English keeps 7:53 AM.
  const time = date.toLocaleTimeString(tag, { hour: locale === 'fr' ? '2-digit' : 'numeric', minute: '2-digit' })
  if (date.toDateString() === now.toDateString()) return time
  return `${date.toLocaleDateString(tag, { month: 'short', day: 'numeric' })} ${time}`
}

/** Short date ("Oct 8" / "8 oct."), optionally with the year. */
export function formatShortDate(iso: string, locale: Locale, withYear = false): string {
  return new Date(iso).toLocaleDateString(makerCopy[locale].time.dateLocale, {
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
  })
}
