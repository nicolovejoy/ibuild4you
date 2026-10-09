// Public-page copy (landing + About) in English and French.
//
// English mirrors what the live pages render (the landing text was hardcoded in
// app/page.tsx; About reads copy.about / copy.glossary in lib/copy.ts, which stay
// the source of truth for English). French lives only here. Only the public,
// signed-out pages are translated — the app behind sign-in is English.
//
// `fr` is typed as `PublicCopy`, so a key added to one language and missing in
// the other fails type-check.

import { copy } from './copy'

export type Locale = 'en' | 'fr'

const en = {
  langSwitch: { label: 'FR', aria: 'Lire en français', href: '/fr' },
  aboutHref: '/about',
  header: { about: 'About' },
  loading: 'Loading...',
  landing: {
    tagline:
      'Have an idea for an app or website but not sure where to start? Our AI guides you through the details and turns your idea into a clear brief — no technical knowledge needed.',
    signIn: 'Sign in',
    learnMore: 'Learn more about how it works',
    howItWorks: 'How it works',
    steps: [
      {
        title: 'Tell us your idea',
        desc: 'Chat with our AI assistant about what you want to build. No jargon, just a conversation.',
      },
      {
        title: 'We build a brief',
        desc: "As you talk, we create a structured brief that captures everything you've described.",
      },
      {
        title: 'Refine over time',
        desc: 'Come back anytime to add more details. Your brief evolves as your thinking does.',
      },
    ],
    interestTitle: 'Interested?',
    interestSubtitle:
      "We're invite-only right now. Let us know you're interested and we'll be in touch.",
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
    payloadHeading: 'For builders: payload reference',
    payloadIntro:
      'Briefs can be set up and updated with JSON. These pages have the copy-pastable payloads, annotated field by field.',
    payloadStart: {
      title: 'Starting a brief',
      desc: 'The payload that creates a new project and its first session.',
    },
    payloadNext: {
      title: 'Starting the next conversation',
      desc: "The payload that updates a brief and steers the maker's next session.",
    },
    payloadNote: '',
  },
}

export type PublicCopy = typeof en

const fr: PublicCopy = {
  langSwitch: { label: 'EN', aria: 'Read in English', href: '/' },
  aboutHref: '/fr/about',
  header: { about: 'À propos' },
  loading: 'Chargement…',
  landing: {
    tagline:
      'Vous avez une idée d’application ou de site web, sans savoir par où commencer ? Notre IA vous guide à travers les détails et transforme votre idée en un brief clair — aucune connaissance technique requise.',
    signIn: 'Se connecter',
    learnMore: 'En savoir plus sur le fonctionnement',
    howItWorks: 'Comment ça marche',
    steps: [
      {
        title: 'Racontez-nous votre idée',
        desc: 'Discutez avec notre assistant IA de ce que vous voulez construire. Pas de jargon, juste une conversation.',
      },
      {
        title: 'Nous rédigeons un brief',
        desc: 'Au fil de la discussion, nous construisons un brief structuré qui reprend tout ce que vous avez décrit.',
      },
      {
        title: 'Affinez avec le temps',
        desc: 'Revenez quand vous voulez pour ajouter des détails. Votre brief évolue avec votre réflexion.',
      },
    ],
    interestTitle: 'Intéressé·e ?',
    interestSubtitle:
      'Pour l’instant, l’accès se fait sur invitation. Dites-nous que cela vous intéresse et nous reviendrons vers vous.',
    interestSuccess: 'Merci de votre intérêt !',
    interestSuccessDetail: 'Nous vous recontacterons dès qu’une place se libère.',
    form: {
      name: 'Nom *',
      namePlaceholder: 'Votre nom',
      email: 'E-mail *',
      emailPlaceholder: 'vous@exemple.com',
      howFound: 'Comment nous avez-vous connus ?',
      howFoundPlaceholder: 'Un ami, les réseaux sociaux, une recherche…',
      wantToTry: 'J’ai une idée de projet avec laquelle j’aimerais essayer',
      whatFor: 'Dites-nous en quelques mots ce que vous aimeriez construire',
      whatForPlaceholder: 'Une application qui…, Un site web pour…',
      submitting: 'Envoi…',
      submit: 'Je suis intéressé·e',
      failed: 'L’envoi a échoué',
      generic: 'Une erreur est survenue',
    },
  },
  about: {
    title: 'Qu’est-ce qu’iBuild4you ?',
    intro:
      'une expérience de RAAC — Rapid Asynchronous Assisted Communication (communication asynchrone, rapide et assistée)',
    whatItIs:
      'Conçu au départ comme une étape d’accueil pour des amis qui voulaient mon aide pour coder divers projets, je le vois aujourd’hui comme une plateforme de conversation plus générale, qui permet à des personnes d’échanger entre elles avec l’aide d’un agent pour faciliter le processus. « Je », c’est Nico, l’humain derrière iBuild4you. Je vous présente maintenant notre assistant, Sam :',
    whoIsRoanHeading: 'Voici Sam Scribe',
    whoIsRoan:
      'Sam est l’assistant au milieu de la conversation — là pour aider chacun à penser plus clairement et à mieux se comprendre. Nico (et vous !) aidez à régler Sam au fil de son évolution.',
    briefHeading: 'Le brief (projet ?)',
    briefIntro:
      'Ce qu’on appelait d’abord un projet (le mot pourrait être meilleur) s’appelle désormais un brief. Il porte sur un sujet donné et évolue au fil d’une série de conversations assistées, avec parfois quelques documents (l’un de nous dépose des fichiers, par exemple). Sam travaille au sein du brief pour faire avancer les conversations et les aider à couvrir le périmètre prévu.',
    rolesIntroHeading: 'Les rôles dans un brief',
    rolesIntro:
      'Je cherche encore la bonne façon de décrire les différents participants d’une conversation. Pour l’instant, nous parlons d’initiateur, de contributeur et de relecteur. Au départ, on parlait d’un « Maker » et d’un « Builder ». Vos retours sont toujours les bienvenus.',
    privacyIntroHeading: 'Confidentialité — en chantier',
    privacy:
      'Votre brief ne devrait être visible que par les personnes invitées, mais comme il s’agit d’un projet à ses débuts, avec un seul développeur qui mène une douzaine de projets ou plus, merci de ne rien partager de trop personnel ici !',
    cta: 'Prêt·e à commencer ?',
    voiceNote:
      'Cette page a été écrite par Nico avec l’aide de Sam, puis retouchée à la main. Traduction française : Claude.',
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
    payloadHeading: 'Pour les développeurs : référence des payloads',
    payloadIntro:
      'Les briefs peuvent être créés et mis à jour en JSON. Ces pages présentent les payloads à copier-coller, annotés champ par champ.',
    payloadStart: {
      title: 'Démarrer un brief',
      desc: 'Le payload qui crée un nouveau projet et sa première session.',
    },
    payloadNext: {
      title: 'Lancer la conversation suivante',
      desc: 'Le payload qui met à jour un brief et oriente la prochaine session du maker.',
    },
    payloadNote: '(en anglais)',
  },
}

export const publicCopy: Record<Locale, PublicCopy> = { en, fr }
