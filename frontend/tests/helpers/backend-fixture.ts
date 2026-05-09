import { execSync, spawn } from 'node:child_process'
import fs from 'node:fs'
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
  const testDataDir = path.join(rootDir, '.structureclaw', 'vitest-integration')
  const testDatabasePath = path.join(testDataDir, 'data', 'test-vitest-integration.db')
  const backendEnv = {
    ...process.env,
    PORT: String(TEST_BACKEND_PORT),
    SCLAW_DATA_DIR: testDataDir,
    DATABASE_URL: `file:${testDatabasePath.replace(/\\/g, '/')}`,
    LLM_API_KEY: process.env.LLM_API_KEY || '',
    LLM_MODEL: process.env.LLM_MODEL || 'gpt-4o-mini',
    ...(process.env.LLM_BASE_URL ? { LLM_BASE_URL: process.env.LLM_BASE_URL } : {}),
  }

  fs.mkdirSync(path.dirname(testDatabasePath), { recursive: true })
  execSync('npm run db:push', { cwd: backendDir, env: backendEnv, stdio: 'pipe' })
  execSync('npm run build', { cwd: backendDir, env: backendEnv, stdio: 'pipe' })

  backendProcess = spawn('node', ['dist/index.js'], {
    cwd: backendDir,
    env: backendEnv,
    stdio: 'pipe',
  })

  const output: string[] = []
  let exitMessage: string | null = null
  const captureOutput = (data: Buffer) => {
    output.push(data.toString())
    if (output.length > 20) output.shift()
  }

  backendProcess.stdout?.on('data', captureOutput)
  backendProcess.stderr?.on('data', captureOutput)
  backendProcess.on('exit', (code, signal) => {
    exitMessage = `Backend exited with code ${code ?? 'null'} and signal ${signal ?? 'null'}`
  })

  // Wait for health check (up to 60 seconds)
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    if (exitMessage) {
      throw new Error(`${exitMessage}\n${output.join('')}`)
    }
    try {
      const resp = await fetch(HEALTH_URL)
      if (resp.ok) return TEST_BACKEND_URL
    } catch {
      // Not ready yet
    }
  }

  throw new Error(`Backend did not start within 60 seconds\n${output.join('')}`)
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
