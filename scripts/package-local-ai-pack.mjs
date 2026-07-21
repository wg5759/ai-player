// 构建“本地 AI 组件包”：把 llama.cpp 运行时（llama-server.exe + 依赖 DLL）和
// 运行/模型许可证打成 zip，连同 Qwen2.5-0.5B 模型一起输出到 release/local-ai-pack/，
// 并生成应用内置的下载清单 electron/local-ai-pack-manifest.js（含真实 SHA-256）。
// 组件包随 GitHub Release 的 local-ai-pack-v1 标签托管，应用内下载服务按清单校验。
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const resources = path.join(root, 'resources')
const outDir = path.join(root, 'release', 'local-ai-pack')
const TAG = 'local-ai-pack-v1'
const BASE_URL = `https://github.com/wg5759/AgentPlay/releases/download/${TAG}`
const LOCKED_MODEL_SHA256 = '7671c0c304e6ce5a7fc577bcb12aba01e2c155cc2efd29b2213c95b18edaf6ed'
const MODEL_RELATIVE = 'models/Qwen2.5-0.5B-Instruct-Q4_0.gguf'
const ZIP_NAME = 'agentplay-local-ai-runtime-win-x64.zip'

function sha256File(filePath) {
  const hash = crypto.createHash('sha256')
  const descriptor = fs.openSync(filePath, 'r')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    let bytesRead
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null)
      if (bytesRead) hash.update(buffer.subarray(0, bytesRead))
    } while (bytesRead)
  } finally {
    fs.closeSync(descriptor)
  }
  return hash.digest('hex')
}

// 与安装包 extraResources 的过滤器保持一致：只带 llama-server 和它依赖的 DLL。
const runtimeDir = path.join(resources, 'ai-runtime', 'win-x64')
const runtimeFiles = fs.readdirSync(runtimeDir)
  .filter((name) => name === 'llama-server.exe' || name.toLowerCase().endsWith('.dll'))
  .sort()

const zipEntries = [
  ...runtimeFiles.map((name) => ({
    source: path.join(runtimeDir, name),
    path: `ai-runtime/win-x64/${name}`
  })),
  { source: path.join(resources, 'licenses', 'llama.cpp', 'LICENSE.txt'), path: 'licenses/llama.cpp/LICENSE.txt' },
  { source: path.join(resources, 'licenses', 'qwen2.5-0.5b', 'LICENSE'), path: 'licenses/qwen2.5-0.5b/LICENSE' },
  { source: path.join(resources, 'licenses', 'qwen2.5-0.5b', 'README.md'), path: 'licenses/qwen2.5-0.5b/README.md' }
]

for (const entry of zipEntries) {
  if (!fs.existsSync(entry.source)) throw new Error(`缺少组件包源文件: ${entry.source}`)
}

fs.mkdirSync(outDir, { recursive: true })

const zip = new JSZip()
for (const entry of zipEntries) zip.file(entry.path, fs.readFileSync(entry.source))
const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } })
const zipPath = path.join(outDir, ZIP_NAME)
fs.writeFileSync(zipPath, zipBuffer)

const modelSource = path.join(resources, ...MODEL_RELATIVE.split('/'))
const modelOut = path.join(outDir, path.basename(MODEL_RELATIVE))
fs.copyFileSync(modelSource, modelOut)

const modelSha = sha256File(modelOut)
if (modelSha !== LOCKED_MODEL_SHA256) throw new Error('模型 SHA-256 与产品锁定值不一致，拒绝生成清单')

const manifest = {
  schemaVersion: 1,
  tag: TAG,
  product: 'AgentPlay 本地 AI 组件',
  assets: [
    {
      id: 'model-qwen2.5-0.5b',
      kind: 'file',
      label: 'Qwen2.5-0.5B 模型',
      path: MODEL_RELATIVE,
      role: 'model',
      url: `${BASE_URL}/${path.basename(MODEL_RELATIVE)}`,
      size: fs.statSync(modelOut).size,
      sha256: modelSha
    },
    {
      id: 'runtime-win-x64',
      kind: 'zip',
      label: 'llama.cpp 运行时',
      url: `${BASE_URL}/${ZIP_NAME}`,
      size: zipBuffer.length,
      sha256: crypto.createHash('sha256').update(zipBuffer).digest('hex'),
      files: zipEntries.map((entry) => ({
        path: entry.path,
        size: fs.statSync(entry.source).size,
        sha256: sha256File(entry.source)
      }))
    }
  ]
}

const moduleSource = `// 本文件由 scripts/package-local-ai-pack.mjs 生成，请勿手改。
// 组件包托管在 GitHub Release 的 ${TAG} 标签；SHA-256 与发布资产一一对应。
module.exports = ${JSON.stringify(manifest, null, 2)}
`
fs.writeFileSync(path.join(root, 'electron', 'local-ai-pack-manifest.js'), moduleSource)
fs.writeFileSync(path.join(outDir, 'LOCAL-AI-PACK-MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`)

const totalMb = (manifest.assets.reduce((sum, asset) => sum + asset.size, 0) / 1024 / 1024).toFixed(1)
console.log(`组件包已生成: ${outDir}`)
console.log(`  ${ZIP_NAME} (${(zipBuffer.length / 1024 / 1024).toFixed(1)} MB, ${zipEntries.length} 个文件)`)
console.log(`  ${path.basename(MODEL_RELATIVE)} (${(fs.statSync(modelOut).size / 1024 / 1024).toFixed(1)} MB)`)
console.log(`  下载总量约 ${totalMb} MB；清单已写入 electron/local-ai-pack-manifest.js`)
