import {createClient} from '@sanity/client'

export const sanity = createClient({
  projectId: '0huhxxkr',
  dataset: 'production',
  apiVersion: '2026-11-13',

  // Fresh content during development
  useCdn: !import.meta.env.DEV,
})