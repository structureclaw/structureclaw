import { execSync, spawn } from 'node:child_process'
import path from 'node:path'

const TEST_BACKEND_PORT = 30999
export const TEST_BACKEND_URL = `http://127.0.0.1:${TEST_BACKEND_PORT}`
const HEALTH_URL = `${TEST_BACKEND_URL}/health`

let backendProcess: ReturnType<typeof spawn> | null = null

export async function startTestBackend(rootDir: string): Promise<string> {
  // Check if backend is already running
  try {
    const resp = await fetch(HEALTH_URL)
    if (resp.ok) return TEST_BACKEND_URL
  } catch {
    // Not running, start it
  }

  // Build backend first
  const backendDir = path.join(rootDir, 'backend')
  execSync('npm run build', { cwd: backendDir, stdio: 'pipe' })

  backendProcess = spawn('node', ['dist/index.js'], {
    cwd: backendDir,
    env: {
      ...process.env,
      PORT: String(TEST_BACKEND_PORT),
      DATABASE_URL: 'file:../../.runtime/data/test-vitest-integration.db',
      LLM_API_KEY: process.env.LLM_API_KEY || '',
      LLM_MODEL: process.env.LLM_MODEL || 'gpt-4o-mini',
      ...(process.env.LLM_BASE_URL ? { LLM_BASE_URL: process.env.LLM_BASE_URL } : {}),
    },
    stdio: 'pipe',
  })

  // Drain stdout/stderr to prevent pipe buffer from blocking the child process
  backendProcess.stdout?.on('data', () => {})
  backendProcess.stderr?.on('data', () => {})

  // Wait for health check (up to 30 seconds)
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    try {
      const resp = await fetch(HEALTH_URL)
      if (resp.ok) return TEST_BACKEND_URL
    } catch {
      // Not ready yet
    }
  }

  throw new Error('Backend did not start within 30 seconds')
}

export async function stopTestBackend(): Promise<void> {
  if (!backendProcess) return

  const proc = backendProcess
  backendProcess = null

  proc.kill('SIGTERM')

  // Wait for the child to actually exit (up to 5 seconds)
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      proc.kill('SIGKILL')
      resolve()
    }, 5000)

    proc.on('exit', () => {
      clearTimeout(timeout)
      resolve()
    })
  })
}

export const hasLlmKey = !!process.env.LLM_API_KEY
