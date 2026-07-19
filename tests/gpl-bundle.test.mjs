import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const workflow = fs.readFileSync('.github/workflows/mpv-gpl-bundle.yml', 'utf8')
const packager = fs.readFileSync('scripts/package-mpv-corresponding-source.ps1', 'utf8')
const policy = JSON.parse(fs.readFileSync('release-public-policy.json', 'utf8'))
const evidence = JSON.parse(fs.readFileSync('binary-source-evidence.json', 'utf8'))
const verifier = fs.readFileSync('scripts/verify-public-release-readiness.mjs', 'utf8')

test('GPL rebuild pins mpv and emits matched binary and corresponding-source archives', () => {
  assert.match(workflow, /MPV_COMMIT: 41f6a645068483470267271e1d09966ca3b9f413/)
  assert.match(workflow, /runs-on: windows-2022/)
  assert.match(workflow, /timeout-minutes: 180/)
  assert.match(workflow, /uses: actions\/cache@v4/)
  assert.match(workflow, /vswhere\.exe/)
  assert.doesNotMatch(workflow, /Visual Studio\\2022\\Enterprise/)
  assert.match(workflow, /SHADERC_COMMIT: [0-9a-f]{40}/)
  assert.match(workflow, /FFMPEG_MESON_COMMIT: [0-9a-f]{40}/)
  assert.match(workflow, /WRAPDB_COMMIT: [0-9a-f]{40}/)
  assert.match(workflow, /Pin every moving source dependency/)
  assert.doesNotMatch(workflow, /meson wrap update-db/)
  assert.match(workflow, /package-mpv-corresponding-source\.ps1/)
  assert.match(workflow, /mpv-v0\.41\.0-windows-x64-gpl-complete/)
  assert.match(packager, /build-fetched-git/)
  assert.match(packager, /build-fetched-cmake/)
  assert.match(packager, /robocopy\.exe/)
  assert.match(packager, /if \(\$code -gt 7\)/)
  assert.match(packager, /\$_\.PSIsContainer/)
  assert.match(packager, /\$_\.Directory\.FullName/)
  assert.match(packager, /SOURCE-MANIFEST\.json/)
  assert.match(packager, /GPL-BUNDLE-MANIFEST\.json/)
  assert.match(packager, /subprojects\/ffmpeg/)
  assert.match(packager, /redistributor-build\/\.github\/workflows\/mpv-gpl-bundle\.yml/)
})

test('public binary release is enabled only with stable remote GPL source evidence', () => {
  assert.equal(policy.sourceRelease.allowed, true)
  assert.equal(policy.binaryRelease.allowed, true)
  assert.deepEqual(policy.binaryRelease.requiredEvidence, [
    'manifestUrl',
    'manifestBytes',
    'manifestSha256',
    'binaryArchiveUrl',
    'binaryArchiveBytes',
    'binaryArchiveSha256',
    'correspondingSourceUrl',
    'correspondingSourceBytes',
    'correspondingSourceSha256',
  ])
  assert.equal(evidence.releaseTag, 'mpv-gpl-v0.41.0-20260719')
  assert.equal(evidence.correspondingSourceBytes, 437132637)
  assert.equal(evidence.correspondingSourceSha256, '162FF8ECA2B321739DCD4D846D3B7F3BEE737D6F71F98FE409419867A2536C1E')
  assert.match(evidence.correspondingSourceUrl, /^https:\/\/github\.com\/wg5759\/AgentPlay\/releases\/download\//)
  assert.doesNotMatch(JSON.stringify(evidence), /actions\/runs|untagged-/)
  assert.match(verifier, /api\.github\.com\/repos/)
  assert.match(verifier, /asset\.digest/)
})
