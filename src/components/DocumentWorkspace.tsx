import { useEffect, useRef, useState } from 'react'

interface SelectedDocument {
  token: string
  name: string
  ext: string
  size: number
}

interface DocumentPlan {
  kind: string
  requiresAi: boolean
  outputFormat: string
  summary: string
}

interface DocumentCapabilities {
  formats: string[]
  modelConfigured: boolean
  modelLocal: boolean
  providerName: string
  model: string
  defaultOutputDir: string
}

interface SpeechRecognitionResultEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }>>
}

interface SpeechRecognitionInstance {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

const EXAMPLES = [
  { label: '整理成 Word', format: 'docx', text: '把所选资料整理成结构清晰的中文 Word 文档，保留事实和关键数据，增加标题和要点。' },
  { label: '清理表格', format: 'xlsx', text: '清理所有文本首尾空格，并按手机号列去重，另存为新的 Excel 文件。' },
  { label: '生成 PPT', format: 'pptx', text: '根据所选资料制作一套 12 页以内的中文演示稿，每页只保留关键结论，并添加演讲备注。' },
  { label: '合并 PDF', format: 'pdf', text: '按照所选顺序合并这些 PDF，另存为一个新文件。' }
]

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function kindLabel(kind: string) {
  const labels: Record<string, string> = {
    'pdf-merge': '本地合并 PDF',
    'pdf-split': '本地拆分 PDF',
    'spreadsheet-edit': '表格清理与公式处理',
    convert: '本地格式转换',
    'ai-generate': 'AI 内容生成与整理'
  }
  return labels[kind] || kind
}

export default function DocumentWorkspace({ onClose, onConfigureModel, initialFiles }: { onClose: () => void; onConfigureModel: () => void; initialFiles?: SelectedDocument[] }) {
  const [files, setFiles] = useState<SelectedDocument[]>(initialFiles ?? [])
  const [instruction, setInstruction] = useState('')
  const [outputFormat, setOutputFormat] = useState('auto')
  const [cloudApproved, setCloudApproved] = useState(false)
  const [capabilities, setCapabilities] = useState<DocumentCapabilities | null>(null)
  const [plan, setPlan] = useState<DocumentPlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [outputs, setOutputs] = useState<string[]>([])
  const [listening, setListening] = useState(false)
  const requestIdRef = useRef('')
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)

  useEffect(() => {
    void window.aiPlayer?.documents?.capabilities().then(setCapabilities)
    const off = window.aiPlayer?.documents?.onStatus((event) => {
      if (event.requestId === requestIdRef.current) setStatus(event.status)
    })
    return off
  }, [])

  useEffect(() => {
    if (initialFiles && initialFiles.length > 0) {
      setFiles(initialFiles)
      setPlan(null)
      setOutputs([])
    }
  }, [initialFiles])

  useEffect(() => () => {
    try { recognitionRef.current?.stop() } catch { /* recognition already stopped */ }
  }, [])

  const chooseFiles = async () => {
    setError('')
    const selected = await window.aiPlayer?.documents?.selectFiles()
    if (selected) {
      setFiles(selected)
      setPlan(null)
      setOutputs([])
    }
  }

  const toggleVoice = () => {
    if (listening) {
      recognitionRef.current?.stop()
      return
    }
    const speechWindow = window as typeof window & {
      SpeechRecognition?: new () => SpeechRecognitionInstance
      webkitSpeechRecognition?: new () => SpeechRecognitionInstance
    }
    const Recognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition
    if (!Recognition) {
      setError('当前系统语音识别不可用，请使用文字输入；后续将接入可选的本地语音识别。')
      return
    }
    const recognition = new Recognition()
    recognition.lang = 'zh-CN'
    recognition.continuous = false
    recognition.interimResults = false
    recognition.onresult = (event) => {
      const text = event.results[0]?.[0]?.transcript?.trim()
      if (text) setInstruction((current) => current ? `${current}\n${text}` : text)
    }
    recognition.onerror = () => {
      setError('没有识别清楚，请重试或直接输入文字。')
      setListening(false)
    }
    recognition.onend = () => setListening(false)
    recognitionRef.current = recognition
    setError('')
    setListening(true)
    try { recognition.start() } catch {
      setListening(false)
      setError('语音识别启动失败，请使用文字输入。')
    }
  }

  const run = async () => {
    if (!instruction.trim()) {
      setError('请先输入或说出要完成的任务。')
      return
    }
    const api = window.aiPlayer?.documents
    if (!api) {
      setError('文档工作台仅在桌面版可用。')
      return
    }
    setBusy(true)
    setError('')
    setOutputs([])
    setStatus('正在分析任务')
    try {
      const preview = await api.plan({ tokens: files.map((file) => file.token), instruction, outputFormat })
      setPlan(preview)
      if (preview.requiresAi && capabilities && !capabilities.modelConfigured) {
        throw new Error('这个任务需要理解或生成内容，请先配置模型。')
      }
      if (preview.requiresAi && files.length > 0 && capabilities && !capabilities.modelLocal && !cloudApproved) {
        throw new Error('当前是云端模型。请确认允许发送所选文件内容后再执行，或到模型中心改用本地模型。')
      }
      const requestId = `document-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      requestIdRef.current = requestId
      const result = await api.run({
        tokens: files.map((file) => file.token), instruction, outputFormat,
        cloudApproved, requestId
      })
      if (!result.success) throw new Error(result.error || '文档处理失败')
      setOutputs(result.outputs || [])
      setStatus(result.summary || '处理完成')
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError))
      setStatus('')
    } finally {
      setBusy(false)
    }
  }

  const cancel = async () => {
    if (requestIdRef.current) await window.aiPlayer?.documents?.cancel(requestIdRef.current)
    setStatus('正在取消')
  }

  return (
    <div className="fixed inset-0 z-[80] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-5xl max-h-[92vh] overflow-hidden rounded-2xl border border-white/10 bg-[#09111f] shadow-2xl flex flex-col" onClick={(event) => event.stopPropagation()}>
        <header className="flex items-start justify-between gap-6 border-b border-white/10 px-6 py-5">
          <div>
            <div className="flex items-center gap-3">
              <span className="rounded-lg bg-blue-600/20 px-2.5 py-1 text-xs font-medium text-blue-300">AgentPlay</span>
              <h1 className="text-xl font-semibold text-white">AI 文档工作台</h1>
            </div>
            <p className="mt-2 text-sm text-slate-400">输入文字或点击麦克风说需求，直接输出 Word、Excel、PPT、PDF 或文本文件。</p>
          </div>
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-slate-400 hover:bg-white/10 hover:text-white" aria-label="关闭">✕</button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-y-auto p-6 lg:grid-cols-[0.9fr_1.35fr]">
          <section className="space-y-4">
            <div className="rounded-xl border border-white/10 bg-white/[0.035] p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-medium text-white">1. 选择资料</h2>
                  <p className="mt-1 text-xs text-slate-500">不选文件也可以直接创建新文档。</p>
                </div>
                <button onClick={chooseFiles} disabled={busy} className="rounded-lg bg-white/10 px-3 py-2 text-sm text-white hover:bg-white/15 disabled:opacity-50">选择文件</button>
              </div>
              <div className="max-h-48 space-y-2 overflow-y-auto">
                {files.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-white/10 px-3 py-6 text-center text-xs text-slate-500">支持 TXT、Markdown、CSV、DOC/DOCX、XLSX、PPTX、PDF、ODT/ODS/ODP、RTF、HTML</div>
                ) : files.map((file, index) => (
                  <div key={file.token} className="flex items-center gap-3 rounded-lg bg-black/20 px-3 py-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded bg-blue-500/15 text-[10px] font-semibold uppercase text-blue-300">{file.ext.slice(1)}</span>
                    <div className="min-w-0 flex-1"><p className="truncate text-sm text-slate-200">{index + 1}. {file.name}</p><p className="text-xs text-slate-500">{formatBytes(file.size)}</p></div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.035] p-4">
              <h2 className="mb-3 text-sm font-medium text-white">常用任务</h2>
              <div className="grid grid-cols-2 gap-2">
                {EXAMPLES.map((example) => (
                  <button key={example.label} onClick={() => { setInstruction(example.text); setOutputFormat(example.format); setPlan(null) }} className="rounded-lg border border-white/10 px-3 py-2 text-left text-xs text-slate-300 hover:border-blue-400/50 hover:bg-blue-500/10">{example.label}</button>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.035] p-4 text-xs text-slate-400">
              <p className="font-medium text-slate-200">安全规则</p>
              <p className="mt-2 leading-5">原文件不会被覆盖，结果默认另存为“AgentPlay处理版”。本地合并、拆分和明确公式不调用模型。</p>
              {capabilities && <div className="mt-2 flex items-center justify-between gap-3 text-slate-500"><p className="truncate">当前模型：{capabilities.providerName} / {capabilities.model || '未配置'} · {capabilities.modelLocal ? '本地连接' : '云端连接'}</p>{!capabilities.modelConfigured && <button onClick={onConfigureModel} className="shrink-0 text-blue-300 hover:text-blue-200">配置模型</button>}</div>}
            </div>
          </section>

          <section className="space-y-4">
            <div className="rounded-xl border border-white/10 bg-white/[0.035] p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div><h2 className="text-sm font-medium text-white">2. 用大白话说明要求</h2><p className="mt-1 text-xs text-slate-500">文字和语音进入同一条安全执行流程。</p></div>
                <button onClick={toggleVoice} disabled={busy} className={`rounded-full px-4 py-2 text-sm text-white transition ${listening ? 'bg-red-500 animate-pulse' : 'bg-blue-600 hover:bg-blue-500'} disabled:opacity-50`}>
                  {listening ? '正在听，点此结束' : '🎙 语音输入'}
                </button>
              </div>
              <textarea
                value={instruction}
                onChange={(event) => { setInstruction(event.target.value); setPlan(null) }}
                disabled={busy}
                className="h-48 w-full resize-none rounded-xl border border-white/10 bg-black/25 p-4 text-sm leading-6 text-white outline-none placeholder:text-slate-600 focus:border-blue-500 disabled:opacity-60"
                placeholder="例如：把这份销售表清理空格，按手机号列去重，并在 G 列填入公式 =IFERROR((D2-E2)/D2,0)，另存为新文件。"
              />
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <label className="text-xs text-slate-400">输出格式</label>
                <select value={outputFormat} onChange={(event) => { setOutputFormat(event.target.value); setPlan(null) }} disabled={busy} className="rounded-lg border border-white/10 bg-[#111c2d] px-3 py-2 text-sm text-white outline-none">
                  <option value="auto">自动判断</option><option value="docx">Word (.docx)</option><option value="xlsx">Excel (.xlsx)</option><option value="pptx">PPT (.pptx)</option><option value="pdf">PDF</option><option value="md">Markdown</option><option value="txt">纯文本</option>
                </select>
              </div>
              {capabilities && !capabilities.modelLocal && files.length > 0 && (
                <label className="mt-4 flex cursor-pointer items-start gap-2 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] p-3 text-xs leading-5 text-amber-100">
                  <input type="checkbox" checked={cloudApproved} onChange={(event) => setCloudApproved(event.target.checked)} className="mt-1" />
                  <span>需要模型理解内容时，允许把本次所选文件的必要文本发送给当前云端模型。PDF本地合并、拆分和普通格式转换不会发送。</span>
                </label>
              )}
            </div>

            {plan && (
              <div className="rounded-xl border border-blue-400/20 bg-blue-500/[0.07] p-4">
                <p className="text-xs uppercase tracking-wider text-blue-300">执行方案</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-white"><span>{kindLabel(plan.kind)}</span><span className="text-slate-600">→</span><span>{plan.outputFormat.toUpperCase()}</span>{plan.requiresAi && <span className="rounded bg-violet-500/20 px-2 py-0.5 text-xs text-violet-200">需要模型</span>}</div>
                <p className="mt-2 text-xs text-slate-400">{plan.summary}</p>
              </div>
            )}

            {(status || error || outputs.length > 0) && (
              <div className={`rounded-xl border p-4 ${error ? 'border-red-400/20 bg-red-500/[0.07]' : 'border-emerald-400/20 bg-emerald-500/[0.07]'}`}>
                {status && <p className="text-sm text-slate-200">{busy && <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-blue-400" />}{status}</p>}
                {error && <p className="text-sm text-red-200">{error}</p>}
                {outputs.length > 0 && <div className="mt-3 space-y-2">{outputs.map((output) => (
                  <button key={output} onClick={() => void window.aiPlayer?.system?.openPath(output)} className="block w-full truncate rounded-lg bg-black/20 px-3 py-2 text-left text-xs text-emerald-200 hover:bg-black/30" title={output}>打开结果：{output}</button>
                ))}</div>}
              </div>
            )}

            <div className="flex items-center justify-end gap-3">
              {busy && <button onClick={cancel} className="rounded-lg border border-white/10 px-4 py-2.5 text-sm text-slate-300 hover:bg-white/10">取消</button>}
              <button onClick={run} disabled={busy || !instruction.trim()} className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white shadow-lg shadow-blue-950/40 hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40">{busy ? '正在处理…' : '开始处理并生成文件'}</button>
            </div>
            <p className="text-right text-[11px] text-slate-600">复杂原格式无损编辑、扫描 PDF OCR 和 PPT 动画将在下一阶段继续完善。</p>
          </section>
        </div>
      </div>
    </div>
  )
}
