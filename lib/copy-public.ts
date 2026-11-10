// Public-page copy (home + About) in English and French.
//
// English mirrors what the live pages render (the home text was hardcoded in
// app/page.tsx; About reads copy.about / copy.glossary in lib/copy.ts, which stay
// the source of truth for English). French lives only here. Only the public,
// signed-out pages are translated — the app behind sign-in is English.
//
// `fr` is typed as `PublicCopy`, so a key added to one language and missing in
// the other fails type-check.

import { copy } from './copy'
import type { HeroScript } from './public/hero-script'

import type { Locale } from './locale'
export type { Locale }

// Home-page demo script. One made-up project (a reminder for occasional
// household chores) in its fourth conversation: the brief is mature, with
// provenance, a lock, owned risks and a version bump (v7 -> v8). The brief here
// is shown in the page's language, unlike a real brief, which stays English for
// the builder.
const heroLaterEn: HeroScript = {
  makerName: 'Jo',
  turns: [
    {
      role: 'agent',
      text: 'Welcome back, Jo. Since last time the Sunday text went live. Two things are open: whether the furnace filter should follow the seasons, and the shared list you mentioned. Where do you want to start?',
    },
    {
      role: 'maker',
      text: 'The seasons. I run the furnace much more in winter, so the filter should be every 2 months from October to March, and every 3 the rest of the year.',
      effects: [{ id: 'd-filter', kind: 'update' }],
    },
    {
      role: 'agent',
      text: 'Two months in winter, three otherwise. That changes the fixed three-month interval we settled on in July. Shall I record the change?',
    },
    {
      role: 'maker',
      text: 'Yes. And add my partner now, we moved in together.',
      effects: [
        { id: 'd-who', kind: 'update' },
        { id: 'q-shared', kind: 'update' },
      ],
    },
    {
      role: 'agent',
      text: 'Will do. One shared list and you both get the Sunday text? Or does each of you get your own chores?',
    },
    {
      role: 'maker',
      text: 'One list, both get the text. Whoever does it ticks it off.',
      effects: [
        { id: 'f-shared', kind: 'add' },
        { id: 'r-whodid', kind: 'add' },
      ],
    },
  ],
  brief: {
    title: 'Household chores reminder',
    summary: {
      id: 'summary',
      text: 'A reminder for the chores that come round every few months. One Sunday text lists what is due; Jo ticks things off and adjusts how often each comes round.',
    },
    features: [
      { id: 'f-remind', text: 'Reminders for occasional chores, bundled into one Sunday text' },
      { id: 'f-starter', text: 'Starter list of common chores with intervals Jo can change' },
      { id: 'f-shared', text: 'One shared list; whoever does a chore ticks it off' },
    ],
    decisions: [
      {
        id: 'd-channel',
        topic: 'Reminder channel',
        decision: 'One text message, Sunday morning, never more than one a week',
        locked: true,
        decided_in_session: 'hero-s1',
        decided_at: '2026-07-11T18:20:00.000Z',
      },
      {
        id: 'd-filter',
        topic: 'Furnace filter interval',
        decision: 'Every 2 months October to March, every 3 months otherwise',
        decided_in_session: 'hero-s1',
        decided_at: '2026-07-11T18:40:00.000Z',
        revised_in_session: 'hero-s4',
        revised_at: '2026-10-17T19:05:00.000Z',
      },
      {
        id: 'd-who',
        topic: 'Who it is for',
        decision: 'Jo and their partner, one shared list',
        decided_in_session: 'hero-s2',
        decided_at: '2026-08-03T18:30:00.000Z',
        revised_in_session: 'hero-s4',
        revised_at: '2026-10-17T19:12:00.000Z',
      },
    ],
    risks: [
      {
        id: 'r-whodid',
        owner: 'maker',
        text: 'When a chore is ticked off, does the other person need to see who did it?',
      },
      {
        id: 'r-season',
        owner: 'builder',
        text: 'Are the winter months fixed, or should they follow the local climate?',
      },
    ],
    queued: [{ id: 'q-shared', text: 'Shared list: now in the brief, not yet built' }],
    versionBefore: 7,
    versionAfter: 8,
    conversation: 4,
  },
}

const heroLaterFr: HeroScript = {
  makerName: 'Jo',
  turns: [
    {
      role: 'agent',
      text: 'Bon retour, Jo. Depuis la dernière fois, le SMS du dimanche est en service. Deux points restent ouverts : si le filtre de la chaudière doit suivre les saisons, et la liste partagée dont vous aviez parlé. Par où voulez-vous commencer ?',
    },
    {
      role: 'maker',
      text: 'Les saisons. La chaudière tourne bien plus l’hiver, donc le filtre devrait être tous les 2 mois d’octobre à mars, et tous les 3 mois le reste de l’année.',
      effects: [{ id: 'd-filter', kind: 'update' }],
    },
    {
      role: 'agent',
      text: 'Deux mois en hiver, trois sinon. Ça change l’intervalle fixe de trois mois décidé en juillet. Je note le changement ?',
    },
    {
      role: 'maker',
      text: 'Oui. Et ajoutez ma partenaire maintenant, on a emménagé ensemble.',
      effects: [
        { id: 'd-who', kind: 'update' },
        { id: 'q-shared', kind: 'update' },
      ],
    },
    {
      role: 'agent',
      text: 'D’accord. Une seule liste partagée et vous recevez tous les deux le SMS du dimanche ? Ou chacun ses corvées ?',
    },
    {
      role: 'maker',
      text: 'Une liste, les deux reçoivent le SMS. Celui ou celle qui le fait coche.',
      effects: [
        { id: 'f-shared', kind: 'add' },
        { id: 'r-whodid', kind: 'add' },
      ],
    },
  ],
  brief: {
    title: 'Rappel des corvées de la maison',
    summary: {
      id: 'summary',
      text: 'Un rappel pour les corvées qui reviennent tous les quelques mois. Un SMS le dimanche liste ce qui est dû ; Jo coche ce qui est fait et ajuste la fréquence de chaque corvée.',
    },
    features: [
      {
        id: 'f-remind',
        text: 'Rappels pour les corvées occasionnelles, regroupés dans un SMS le dimanche',
      },
      {
        id: 'f-starter',
        text: 'Liste de départ des corvées courantes, avec des fréquences que Jo peut changer',
      },
      { id: 'f-shared', text: 'Une liste partagée ; celui ou celle qui fait la corvée la coche' },
    ],
    decisions: [
      {
        id: 'd-channel',
        topic: 'Canal de rappel',
        decision: 'Un SMS, le dimanche matin, jamais plus d’un par semaine',
        locked: true,
        decided_in_session: 'hero-s1',
        decided_at: '2026-07-11T18:20:00.000Z',
      },
      {
        id: 'd-filter',
        topic: 'Fréquence du filtre de chaudière',
        decision: 'Tous les 2 mois d’octobre à mars, tous les 3 mois sinon',
        decided_in_session: 'hero-s1',
        decided_at: '2026-07-11T18:40:00.000Z',
        revised_in_session: 'hero-s4',
        revised_at: '2026-10-17T19:05:00.000Z',
      },
      {
        id: 'd-who',
        topic: 'Pour qui',
        decision: 'Jo et sa partenaire, une seule liste partagée',
        decided_in_session: 'hero-s2',
        decided_at: '2026-08-03T18:30:00.000Z',
        revised_in_session: 'hero-s4',
        revised_at: '2026-10-17T19:12:00.000Z',
      },
    ],
    risks: [
      {
        id: 'r-whodid',
        owner: 'maker',
        text: 'Quand une corvée est cochée, l’autre personne doit-elle voir qui l’a faite ?',
      },
      {
        id: 'r-season',
        owner: 'builder',
        text: 'Les mois d’hiver sont-ils fixes, ou doivent-ils suivre le climat local ?',
      },
    ],
    queued: [{ id: 'q-shared', text: 'Liste partagée : dans le brief, pas encore construite' }],
    versionBefore: 7,
    versionAfter: 8,
    conversation: 4,
  },
}

const en = {
  langSwitch: { label: 'FR', aria: 'Lire en français', href: '/fr' },
  aboutHref: '/about',
  header: { about: 'About' },
  loading: 'Loading...',
  // Signed-out home page: shell chrome, headline, interest section and the demo.
  home: {
    signIn: 'Sign in',
    about: 'About',
    headline: 'Tell us your idea. We turn it into a brief, then an app.',
    subline:
      'You talk it through with Sam, our assistant, in plain words. Every answer lands in a living brief the builder works from. No technical knowledge needed.',
    cta: 'Tell us your idea',
    ctaHint: 'Invite-only for now. Leave your details and we will be in touch.',
    demoCaptionLater:
      'A made-up project, Jo’s chores reminder, in its fourth conversation. The brief carries what was decided, when, and what is still open.',
    composerPlaceholder: 'Your idea goes here…',
    agentLabel: 'Sam',
    conversationLabel: (n: number) => `Conversation ${n}`,
    briefLabel: 'Living brief',
    briefVersion: (before: number, after: number) => `Brief v${before} → v${after}`,
    summary: 'Summary',
    features: 'Features',
    decisions: 'Decisions',
    openQuestions: 'Open questions',
    queued: 'Later',
    locked: 'Locked',
    ownerMaker: (name: string) => `${name} decides`,
    ownerBuilder: 'Builder decides',
    showConversation: 'Show the conversation',
    hideConversation: 'Hide the conversation',
    // Decision provenance under each decision (lib/public/hero-provenance.ts).
    // `date` arrives already formatted for the locale ("Jul 11" / "11 juil.").
    provenance: {
      dateLocale: 'en-US',
      conv: (n: number, date: string) => `conv ${n} · ${date}`,
      added: (date: string) => `added ${date}`,
      revisedConv: (n: number, date: string) => `revised conv ${n} · ${date}`,
      revised: (date: string) => `revised ${date}`,
    },
    script: { later: heroLaterEn },
  },
  // The interest form (components/public/interest-form.tsx).
  landing: {
    interestSuccess: 'Thanks for your interest!',
    interestSuccessDetail: "We'll be in touch when we have a spot for you.",
    form: {
      name: 'Name *',
      namePlaceholder: 'Your name',
      email: 'Email *',
      emailPlaceholder: 'you@example.com',
      howFound: 'How did you find us?',
      howFoundPlaceholder: 'Friend, social media, search...',
      wantToTry: "I have a project idea I'd like to try this with",
      whatFor: "Tell us briefly what you'd want to build",
      whatForPlaceholder: 'An app that..., A website for...',
      submitting: 'Submitting...',
      submit: 'Express interest',
      failed: 'Failed to submit',
      generic: 'Something went wrong',
    },
  },
  about: {
    ...copy.about,
    roles: {
      originator: copy.glossary.originator,
      contributor: copy.glossary.contributor,
      reviewer: copy.glossary.reviewer,
    },
  },
}

export type PublicCopy = typeof en

const fr: PublicCopy = {
  langSwitch: { label: 'EN', aria: 'Read in English', href: '/' },
  aboutHref: '/fr/about',
  header: { about: 'À propos' },
  loading: 'Chargement…',
  home: {
    signIn: 'Se connecter',
    about: 'À propos',
    headline: 'Racontez-nous votre idée. Nous en faisons un brief, puis une application.',
    subline:
      'Vous en discutez avec Sam, notre assistant, avec vos mots. Chaque réponse prend place dans un brief vivant, sur lequel le développeur s’appuie. Aucune connaissance technique requise.',
    cta: 'Racontez-nous votre idée',
    ctaHint:
      'Sur invitation pour l’instant. Laissez vos coordonnées et nous reviendrons vers vous.',
    demoCaptionLater:
      'Un projet fictif, le rappel des corvées de Jo, à sa quatrième conversation. Le brief garde ce qui a été décidé, quand, et ce qui reste ouvert.',
    composerPlaceholder: 'Votre idée ici…',
    agentLabel: 'Sam',
    conversationLabel: (n: number) => `Conversation ${n}`,
    briefLabel: 'Brief vivant',
    briefVersion: (before: number, after: number) => `Brief v${before} → v${after}`,
    summary: 'Résumé',
    features: 'Fonctionnalités',
    decisions: 'Décisions',
    openQuestions: 'Questions ouvertes',
    queued: 'Plus tard',
    locked: 'Verrouillé',
    ownerMaker: (name: string) => `${name} décide`,
    ownerBuilder: 'Le développeur décide',
    showConversation: 'Voir la conversation',
    hideConversation: 'Masquer la conversation',
    // A décision is feminine, so "révisée". Glossary: conversation stays
    // conversation; "conv." is the same abbreviation the English "conv" is.
    provenance: {
      dateLocale: 'fr-FR',
      conv: (n: number, date: string) => `conv. ${n} · ${date}`,
      added: (date: string) => `ajoutée le ${date}`,
      revisedConv: (n: number, date: string) => `révisée conv. ${n} · ${date}`,
      revised: (date: string) => `révisée le ${date}`,
    },
    script: { later: heroLaterFr },
  },
  // The interest form (components/public/interest-form.tsx).
  landing: {
    interestSuccess: 'Merci de votre intérêt !',
    interestSuccessDetail: 'Nous vous recontacterons dès qu’une place se libérera.',
    form: {
      name: 'Nom *',
      namePlaceholder: 'Votre nom',
      email: 'E-mail *',
      emailPlaceholder: 'vous@exemple.com',
      howFound: 'Comment nous avez-vous connus ?',
      howFoundPlaceholder: 'Un ami, les réseaux sociaux, une recherche…',
      wantToTry: 'J’ai une idée de projet que j’aimerais tester ici',
      whatFor: 'Dites-nous en quelques mots ce que vous aimeriez construire',
      whatForPlaceholder: 'Une application qui…, un site web pour…',
      submitting: 'Envoi…',
      submit: 'Je suis intéressé·e',
      failed: 'L’envoi a échoué',
      generic: 'Une erreur est survenue',
    },
  },
  about: {
    title: 'Qu’est-ce qu’iBuild4you ?',
    intro:
      'une expérience de RAAC — Rapid Asynchronous Assisted Communication (communication asynchrone, rapide et assistée)',
    whatItIs:
      'Au départ, je l’ai conçu pour recueillir les besoins d’amis qui voulaient mon aide pour coder divers projets ; je le vois aujourd’hui comme une plateforme de conversation plus générale, qui permet à des personnes d’échanger entre elles avec l’aide d’un agent pour faciliter le processus. « Je », c’est Nico, l’humain derrière iBuild4you. Je vous présente maintenant notre assistant, Sam :',
    whoIsRoanHeading: 'Voici Sam Scribe',
    whoIsRoan:
      'Sam est l’assistant au milieu de la conversation — là pour aider chacun à penser plus clairement et à mieux se comprendre. Nico, et vous aussi, contribuez à affiner Sam à mesure que le projet évolue.',
    briefHeading: 'Le brief (projet ?)',
    briefIntro:
      'Ce qu’on appelait d’abord un projet (le nom n’est pas idéal) s’appelle désormais un brief. Il porte sur un sujet donné et évolue au fil d’une série de conversations assistées, avec parfois quelques documents (l’un de nous dépose des fichiers, par exemple). Sam travaille au sein du brief pour faire avancer les conversations et les aider à couvrir le périmètre prévu.',
    rolesIntroHeading: 'Les rôles dans un brief',
    rolesIntro:
      'Je cherche encore la bonne façon de décrire les différents participants d’une conversation. Pour l’instant, nous parlons d’initiateur, de contributeur et de relecteur. Au départ, on parlait d’un « Maker » et d’un « Builder ». Vos retours sont toujours les bienvenus.',
    privacyIntroHeading: 'Confidentialité — en chantier',
    privacy:
      'Votre brief ne devrait être visible que par les personnes invitées, mais comme il s’agit d’un projet à ses débuts, avec un seul développeur qui mène une douzaine de projets ou plus, merci de ne rien partager de trop personnel ici !',
    cta: 'Prêt·e à commencer ?',
    voiceNote:
      'Cette page a été écrite par Nico avec l’aide de Sam, puis retouchée à la main. Traduction française : Claude.',
    roles: {
      originator: {
        term: 'Initiateur',
        short: 'La personne qui a apporté l’idée de ce brief. Généralement la première à écrire.',
      },
      contributor: {
        term: 'Contributeur',
        short:
          'Apporte sa voix, ses questions et son contexte au brief, aux côtés de l’initiateur.',
      },
      reviewer: {
        term: 'Relecteur',
        short:
          'Annote et valide — signale ce qui manque ou reste flou, et oriente la session suivante.',
      },
    },
  },
}

export const publicCopy: Record<Locale, PublicCopy> = { en, fr }
