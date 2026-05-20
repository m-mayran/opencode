import { describe, expect, test } from "bun:test"
import { isNotebookPath } from "./notebook-viewer"

describe("isNotebookPath", () => {
  test("returns true for .ipynb files", () => {
    expect(isNotebookPath("foo.ipynb")).toBe(true)
    expect(isNotebookPath("/a/b/c/notebook.ipynb")).toBe(true)
    expect(isNotebookPath("Foo.IPYNB")).toBe(true)
  })

  test("returns false for other extensions", () => {
    expect(isNotebookPath("foo.py")).toBe(false)
    expect(isNotebookPath("foo.json")).toBe(false)
    expect(isNotebookPath("ipynb")).toBe(false)
    expect(isNotebookPath("foo.ipynb.bak")).toBe(false)
  })

  test("returns false for undefined or empty paths", () => {
    expect(isNotebookPath(undefined)).toBe(false)
    expect(isNotebookPath("")).toBe(false)
  })
})

// Sanity-check the module surface used by callers (FileTabContent in
// packages/app imports `NotebookViewer` and `isNotebookPath`).
describe("notebook-viewer exports", () => {
  test("exports NotebookViewer", async () => {
    const mod = await import("./notebook-viewer")
    expect(typeof mod.NotebookViewer).toBe("function")
  })
})
