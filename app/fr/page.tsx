import { HomePage } from '@/components/public/home-page'

// French public home page. Only the signed-out public pages are translated;
// sign-in and the app itself stay English.
export default function FrenchHome() {
  return <HomePage locale="fr" />
}
