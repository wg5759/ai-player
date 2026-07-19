import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const binaryMode = process.argv.includes('--binary')
const policy = JSON.parse(fs.readFileSync(path.join(root, 'release-public-policy.json'), 'utf8'))

function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${result.stderr || result.stdout}`)
  return result.stdout.split(/\r?\n/).filter(Boolean)
}

const requiredDocs = ['LICENSE', 'README.md', 'SECURITY.md', 'PRIVACY.md', 'TRADEMARKS.md', 'THIRD_PARTY_NOTICES.md', 'CONTRIBUTING.md']
for (const name of requiredDocs) {
  if (!fs.existsSync(path.join(root, name))) throw new Error(`源码发布缺少 ${name}`)
}

const forbiddenTracked = git(['ls-files']).filter((filePath) =>
  /^(?:release|resources\/(?:bin|models|ai-runtime))\//.test(filePath) ||
  /\.(?:exe|dll|pdb|gguf|p12|pfx|pem|key|keystore)$/i.test(filePath)
)
if (forbiddenTracked.length) throw new Error(`源码发布误跟踪二进制、模型或凭据文件：${forbiddenTracked.join(', ')}`)

function parseStableGitHubReleaseUrl(value, field) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${field} 不是有效 URL`)
  }
  const match = /^\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/([^/]+)$/.exec(url.pathname)
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !match || match[3].startsWith('untagged-')) {
    throw new Error(`${field} 必须是稳定的公开 GitHub Release 下载地址`)
  }
  return { owner: match[1], repo: match[2], tag: match[3], assetName: match[4], url: url.href }
}

function requirePositiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${field} 必须是正整数`)
}

function requireSha256(value, field) {
  if (!/^[0-9a-f]{64}$/i.test(String(value || ''))) throw new Error(`${field} 必须是 64 位 SHA-256`)
}

async function fetchPublicRelease(owner, repo, tag) {
  const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/tags/${encodeURIComponent(tag)}`, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'AgentPlay-public-release-verifier',
      'x-github-api-version': '2022-11-28',
    },
    redirect: 'error',
  })
  if (!response.ok) throw new Error(`公开 Release 查询失败：HTTP ${response.status}`)
  const release = await response.json()
  if (release.draft || release.prerelease) throw new Error('对应源码 Release 不能是草稿或预发布')
  return release
}

function verifyRemoteAsset(release, descriptor, bytes, sha256, label) {
  requirePositiveInteger(bytes, `${label}Bytes`)
  requireSha256(sha256, `${label}Sha256`)
  const asset = release.assets?.find((candidate) => candidate.name === descriptor.assetName)
  if (!asset || asset.state !== 'uploaded') throw new Error(`${label} 远端资产不存在或未上传完成`)
  if (asset.browser_download_url !== descriptor.url) throw new Error(`${label} 远端下载地址不一致`)
  if (asset.size !== bytes) throw new Error(`${label} 远端字节数不一致：${asset.size} != ${bytes}`)
  if (String(asset.digest || '').toLowerCase() !== `sha256:${sha256.toLowerCase()}`) {
    throw new Error(`${label} 远端 SHA-256 不一致`)
  }
}

if (binaryMode) {
  if (!policy.binaryRelease?.allowed) throw new Error(`公开二进制发行被策略阻止：${policy.binaryRelease?.reason || '缺少证据'}`)
  const evidencePath = path.join(root, 'binary-source-evidence.json')
  if (!fs.existsSync(evidencePath)) throw new Error('公开二进制发行缺少 binary-source-evidence.json')
  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'))
  for (const key of policy.binaryRelease.requiredEvidence || []) {
    if (evidence[key] === undefined || evidence[key] === '') throw new Error(`公开二进制发行缺少证据字段：${key}`)
  }
  const descriptors = [
    parseStableGitHubReleaseUrl(evidence.manifestUrl, 'manifestUrl'),
    parseStableGitHubReleaseUrl(evidence.binaryArchiveUrl, 'binaryArchiveUrl'),
    parseStableGitHubReleaseUrl(evidence.correspondingSourceUrl, 'correspondingSourceUrl'),
  ]
  const [first, ...rest] = descriptors
  if (rest.some((item) => item.owner !== first.owner || item.repo !== first.repo || item.tag !== first.tag)) {
    throw new Error('清单、GPL 二进制和完整对应源码必须来自同一个公开 Release')
  }
  if (evidence.releaseTag !== first.tag) throw new Error('releaseTag 与公开下载地址不一致')
  const release = await fetchPublicRelease(first.owner, first.repo, first.tag)
  verifyRemoteAsset(release, descriptors[0], evidence.manifestBytes, evidence.manifestSha256, 'manifest')
  verifyRemoteAsset(release, descriptors[1], evidence.binaryArchiveBytes, evidence.binaryArchiveSha256, 'binaryArchive')
  verifyRemoteAsset(release, descriptors[2], evidence.correspondingSourceBytes, evidence.correspondingSourceSha256, 'correspondingSource')
}

process.stdout.write(`${JSON.stringify({ success: true, mode: binaryMode ? 'binary' : 'source', policy })}\n`)
