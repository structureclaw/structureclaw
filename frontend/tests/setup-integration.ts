import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default async function setup() {
  // Set API URL before any test module loads so api-base.ts picks it up
  process.env.NEXT_PUBLIC_API_URL = 'http://127.0.0.1:30999'

  const { startTestBackend } = await import('./helpers/backend-fixture')
  const rootDir = path.resolve(__dirname, '../..')
  await startTestBackend(rootDir)

  return async () => {
    const { stopTestBackend } = await import('./helpers/backend-fixture')
    await stopTestBackend()
  }
}
