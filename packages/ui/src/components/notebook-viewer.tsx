import { createMemo, For, Show, Switch, Match } from "solid-js"
import { Markdown } from "./markdown"
import { fileExtension } from "../pierre/media"

// Minimal Jupyter nbformat v4 types. Only fields we render are typed
// strictly; anything we don't render is left as `unknown`.
// See https://nbformat.readthedocs.io/en/latest/format_description.html

type MultilineString = string | string[]

type CellBase = {
  source: MultilineString
  metadata?: Record<string, unknown>
}

type MarkdownCell = CellBase & {
  cell_type: "markdown"
}

type RawCell = CellBase & {
  cell_type: "raw"
}

type CodeCell = CellBase & {
  cell_type: "code"
  execution_count: number | null
  outputs: NotebookOutput[]
}

type NotebookCell = MarkdownCell | RawCell | CodeCell

type StreamOutput = {
  output_type: "stream"
  name: "stdout" | "stderr"
  text: MultilineString
}

type DisplayDataOutput = {
  output_type: "display_data" | "execute_result"
  data: Record<string, unknown>
  metadata?: Record<string, unknown>
  execution_count?: number | null
}

type ErrorOutput = {
  output_type: "error"
  ename: string
  evalue: string
  traceback: string[]
}

type NotebookOutput = StreamOutput | DisplayDataOutput | ErrorOutput | { output_type: string; [k: string]: unknown }

type Notebook = {
  cells: NotebookCell[]
  metadata?: {
    kernelspec?: { name?: string; display_name?: string; language?: string }
    language_info?: { name?: string; file_extension?: string; mimetype?: string }
  }
  nbformat?: number
  nbformat_minor?: number
}

export function isNotebookPath(path: string | undefined) {
  return fileExtension(path) === "ipynb"
}

// Strip ANSI escape sequences. Jupyter tracebacks often contain them.
// eslint-disable-next-line no-control-regex
const ansiRegex = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g
function stripAnsi(text: string) {
  return text.replace(ansiRegex, "")
}

function joinSource(source: unknown): string {
  if (source === undefined || source === null) return ""
  if (typeof source === "string") return source
  if (Array.isArray(source)) return source.map((part) => (typeof part === "string" ? part : "")).join("")
  return ""
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function parseNotebook(text: string): Notebook | undefined {
  if (!text) return undefined
  // JSON.parse can throw on malformed input; the caller treats undefined as
  // "fall back to plain JSON view".
  try {
    const value: unknown = JSON.parse(text)
    if (!isRecord(value)) return undefined
    if (!Array.isArray(value.cells)) return undefined
    // Cells/outputs are validated lazily in the per-cell render path; we trust
    // structural shape just enough to reach the renderers.
    return value as unknown as Notebook
  } catch {
    return undefined
  }
}

function notebookLanguage(nb: Notebook) {
  const lang = nb.metadata?.language_info?.name ?? nb.metadata?.kernelspec?.language ?? nb.metadata?.kernelspec?.name
  if (!lang) return "python"
  return lang.toLowerCase()
}

// Pick the richest renderable mime type from a Jupyter output bundle.
// Priority roughly matches Jupyter's default; richer types win over text.
function MimeBundle(props: { data: Record<string, unknown>; cacheKey?: string }) {
  const data = props.data
  const png = data["image/png"]
  if (typeof png === "string") {
    return <img class="notebook-output-image" src={`data:image/png;base64,${png}`} alt="" />
  }
  const jpeg = data["image/jpeg"]
  if (typeof jpeg === "string") {
    return <img class="notebook-output-image" src={`data:image/jpeg;base64,${jpeg}`} alt="" />
  }
  const svg = data["image/svg+xml"]
  if (svg !== undefined) {
    // Run SVG through the Markdown sanitizer by embedding it as raw HTML.
    return <Markdown text={joinSource(svg)} cacheKey={props.cacheKey} />
  }
  const md = data["text/markdown"]
  if (md !== undefined) {
    return <Markdown text={joinSource(md)} cacheKey={props.cacheKey} />
  }
  const html = data["text/html"]
  if (html !== undefined) {
    // Render HTML through Markdown so DOMPurify sanitizes it.
    return <Markdown text={joinSource(html)} cacheKey={props.cacheKey} />
  }
  const text = data["text/plain"]
  if (text !== undefined) {
    return <pre class="notebook-output-text">{joinSource(text)}</pre>
  }
  return null
}

// Narrowing helpers (used as `when={}` predicates so SolidJS hands the
// narrowed value into the child callback).
function asStream(o: NotebookOutput): StreamOutput | undefined {
  if (o.output_type !== "stream") return undefined
  const text = (o as Record<string, unknown>).text
  const name = (o as Record<string, unknown>).name === "stderr" ? "stderr" : "stdout"
  return { output_type: "stream", name, text: typeof text === "string" || Array.isArray(text) ? text : "" }
}
function asError(o: NotebookOutput): ErrorOutput | undefined {
  if (o.output_type !== "error") return undefined
  const r = o as Record<string, unknown>
  const traceback = Array.isArray(r.traceback) ? r.traceback.filter((t): t is string => typeof t === "string") : []
  return {
    output_type: "error",
    ename: typeof r.ename === "string" ? r.ename : "",
    evalue: typeof r.evalue === "string" ? r.evalue : "",
    traceback,
  }
}
function asDisplay(o: NotebookOutput): DisplayDataOutput | undefined {
  if (o.output_type !== "display_data" && o.output_type !== "execute_result") return undefined
  const data = (o as Record<string, unknown>).data
  return {
    output_type: o.output_type,
    data: isRecord(data) ? data : {},
  }
}

function OutputBlock(props: { output: NotebookOutput; cacheKey?: string }) {
  return (
    <Switch>
      <Match when={asStream(props.output)}>
        {(out) => (
          <pre
            class="notebook-output-text"
            classList={{ "notebook-output-stderr": out().name === "stderr" }}
            data-stream={out().name}
          >
            {joinSource(out().text)}
          </pre>
        )}
      </Match>
      <Match when={asError(props.output)}>
        {(out) => (
          <pre class="notebook-output-text notebook-output-error" data-stream="error">
            {stripAnsi(Array.isArray(out().traceback) ? out().traceback.join("\n") : `${out().ename}: ${out().evalue}`)}
          </pre>
        )}
      </Match>
      <Match when={asDisplay(props.output)}>
        {(out) => <MimeBundle data={out().data ?? {}} cacheKey={props.cacheKey} />}
      </Match>
    </Switch>
  )
}

const asMarkdownCell = (c: NotebookCell) => (c.cell_type === "markdown" ? c : undefined)
const asRawCell = (c: NotebookCell) => (c.cell_type === "raw" ? c : undefined)
const asCodeCell = (c: NotebookCell) => (c.cell_type === "code" ? c : undefined)

function CellBlock(props: { cell: NotebookCell; index: number; language: string; cacheKey?: string }) {
  const cellKey = () => (props.cacheKey ? `${props.cacheKey}:cell:${props.index}` : undefined)

  return (
    <div class="notebook-cell" data-cell-type={props.cell.cell_type} data-cell-index={props.index}>
      <Switch>
        <Match when={asMarkdownCell(props.cell)}>
          {(cell) => (
            <div class="notebook-cell-markdown">
              <Markdown text={joinSource(cell().source)} cacheKey={cellKey()} />
            </div>
          )}
        </Match>
        <Match when={asRawCell(props.cell)}>
          {(cell) => <pre class="notebook-cell-raw">{joinSource(cell().source)}</pre>}
        </Match>
        <Match when={asCodeCell(props.cell)}>
          {(cell) => {
            const source = createMemo(() => joinSource(cell().source))
            // Wrap source in a fenced code block so the existing Markdown
            // pipeline (marked-shiki) syntax-highlights it.
            const fenced = createMemo(() => `\`\`\`${props.language}\n${source()}\n\`\`\``)
            const count = () => cell().execution_count
            const outputs = () => cell().outputs ?? []
            return (
              <div class="notebook-cell-code">
                <div class="notebook-cell-input">
                  <div class="notebook-cell-gutter" aria-hidden="true">
                    {count() === null || count() === undefined ? "[\u00A0]:" : `[${count()}]:`}
                  </div>
                  <div class="notebook-cell-source">
                    <Markdown text={fenced()} cacheKey={cellKey()} />
                  </div>
                </div>
                <Show when={outputs().length > 0}>
                  <div class="notebook-cell-outputs">
                    <For each={outputs()}>
                      {(output, i) => (
                        <OutputBlock
                          output={output}
                          cacheKey={cellKey() ? `${cellKey()}:out:${i()}` : undefined}
                        />
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            )
          }}
        </Match>
      </Switch>
    </div>
  )
}

export function NotebookViewer(props: { source: string; cacheKey?: string; class?: string }) {
  const notebook = createMemo(() => parseNotebook(props.source))
  const language = createMemo(() => {
    const nb = notebook()
    if (!nb) return "python"
    return notebookLanguage(nb)
  })

  return (
    <Show
      when={notebook()}
      fallback={
        // Malformed .ipynb: surface as plain JSON so the user can still see content.
        <pre class="notebook-fallback">{props.source}</pre>
      }
    >
      {(nb) => (
        <div data-component="notebook-viewer" class={`notebook-viewer ${props.class ?? ""}`.trim()}>
          <For each={nb().cells}>
            {(cell, i) => (
              <CellBlock cell={cell} index={i()} language={language()} cacheKey={props.cacheKey} />
            )}
          </For>
        </div>
      )}
    </Show>
  )
}

// Also export the type so the unused-type warning doesn't fire for `MultilineString`.
export type { MultilineString as NotebookMultilineString }
