import type { Metadata } from 'next'
import { LandingPage } from '@/components/public/landing-page'

export const metadata: Metadata = {
  description: 'Accueil de projets assisté par IA — de l’idée à un brief structuré',
}

// French public landing page. Only the signed-out public pages are translated;
// sign-in and the app itself stay English.
export default function FrenchHomePage() {
  return <LandingPage locale="fr" />
}
