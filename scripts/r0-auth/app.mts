import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { cpSync, mkdirSync, symlinkSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { VerificationFailure } from './fixtures.mjs'

export class OwnedApp {
  process: ChildProcess | undefined
  readonly port = 3217
  readonly baseURL = `http://127.0.0.1:${this.port}`
  constructor(readonly directory: string) {}

  async start(env: Readonly<Record<string, string>>) {
    const reservation = createServer()
    await new Promise<void>((done, reject) => {
      reservation.once('error', () => reject(new VerificationFailure('LOCAL_PORT_OCCUPIED')))
      reservation.listen(this.port, '127.0.0.1', () => reservation.close(() => done()))
    })
    const root = process.cwd()
    mkdirSync(this.directory, { recursive: true })
    for (const name of ['src', 'packages', 'public', 'prisma', 'next.config.ts', 'tsconfig.json',
      'package.json', 'postcss.config.mjs', 'next-env.d.ts']) {
      cpSync(resolve(root, name), resolve(this.directory, name), { recursive: true })
    }
    symlinkSync(resolve(root, 'node_modules'), resolve(this.directory, 'node_modules'), 'junction')
    const system = Object.fromEntries(['PATH', 'SystemRoot', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA', 'COMSPEC']
      .map((name) => [name, process.env[name] ?? '']))
    const child = spawn(process.execPath, [resolve(root, 'node_modules/next/dist/bin/next'),
      'dev', '--webpack', '--hostname', '127.0.0.1', '--port', String(this.port)], {
      cwd: this.directory, env: { ...system, ...env, NODE_ENV: 'development', MEMBEGO_QA: '1',
        NEXT_TELEMETRY_DISABLED: '1', SENTRY_UPLOAD: 'off', NEXT_PUBLIC_SENTRY_DSN: '', SENTRY_DSN: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.process = child
    child.stderr?.resume()
    await new Promise<void>((done, reject) => {
      const timer = setTimeout(() => reject(new VerificationFailure('APP_START_TIMEOUT')), 90_000)
      child.once('error', () => { clearTimeout(timer); reject(new VerificationFailure('APP_START_FAILED')) })
      child.once('exit', () => { clearTimeout(timer); reject(new VerificationFailure('APP_EXITED')) })
      child.stdout?.on('data', (data: Buffer) => {
        if (data.toString().includes('Ready in')) { clearTimeout(timer); done() }
      })
    })
  }

  async close() {
    const child = this.process
    if (!child?.pid || child.exitCode !== null) {
      rmSync(this.directory, { recursive: true, force: true })
      return { pid: child?.pid ?? null, stopped: true, snapshotRemoved: true }
    }
    const exited = new Promise<void>((done) => child.once('exit', () => done()))
    if (process.platform === 'win32') {
      spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', timeout: 15_000 })
    } else child.kill('SIGTERM')
    await exited
    rmSync(this.directory, { recursive: true, force: true })
    return { pid: child.pid, stopped: true, snapshotRemoved: true }
  }
}
