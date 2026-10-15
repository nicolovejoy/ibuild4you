import { LandingPage } from '@/components/public/landing-page'

// French public landing page. Only the signed-out public pages are translated;
// sign-in and the app itself stay English.
export default function FrenchHomePage() {
  return <LandingPage locale="fr" />
}
