import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { crc32, uniqueNames, zip } from '../src/zip'

describe('zip', () => {
  it('computes standard CRC32', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926)
  })
  it('dedupes names', () => {
    expect(uniqueNames(['a.png', 'A.png', 'b', 'b', 'x/y.mp4'])).toEqual(['a.png', 'A (2).png', 'b', 'b (2)', 'x_y.mp4'])
  })
  // Windows ships bsdtar (reads zip) in System32; elsewhere use unzip
  const extractor = process.platform === 'win32'
    ? { cmd: path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), args: (f: string, d: string) => ['-xf', f, '-C', d] }
    : { cmd: 'unzip', args: (f: string, d: string) => ['-o', '-q', f, '-d', d] }
  const hasExtractor = (() => { try { execFileSync(extractor.cmd, ['--version'], { stdio: 'ignore' }); return true } catch { return process.platform !== 'win32' && fs.existsSync('/usr/bin/unzip') } })()

  it.skipIf(!hasExtractor)('produces an archive that a real unzip tool can read back', () => {
    const buf = zip([{ name: 'hello.txt', data: Buffer.from('hi there') }, { name: 'dir-less.bin', data: Buffer.from([0, 1, 2, 255]) }])
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zipt-'))
    const file = path.join(dir, 'a.zip')
    fs.writeFileSync(file, buf)
    execFileSync(extractor.cmd, extractor.args(file, dir))
    expect(fs.readFileSync(path.join(dir, 'hello.txt'), 'utf8')).toBe('hi there')
    expect([...fs.readFileSync(path.join(dir, 'dir-less.bin'))]).toEqual([0, 1, 2, 255])
  })
})
