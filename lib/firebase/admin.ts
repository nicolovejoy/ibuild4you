import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'

function initAdmin() {
  if (getApps().length === 0) {
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
    if (!serviceAccount) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT environment variable not set')
    }
    initializeApp({
      credential: cert(JSON.parse(serviceAccount)),
    })
  }
}

export function getAdminDb() {
  initAdmin()
  return getFirestore()
}

export function getAdminAuth() {
  initAdmin()
  return getAuth()
}
