import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { forwardRef, useImperativeHandle } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import enMessages from "@/i18n/messages/en.json"
import {
  resetAppWorkspaceStore,
  useAppWorkspaceStore,
} from "@/stores/app-workspace-store"
import type { FolderDetail } from "@/lib/types"

const h = vi.hoisted(() => ({
  checkDirectoriesExist: vi.fn(),
  relocateFolderPath: vi.fn(),
  openFileDialog: vi.fn(),
  toastSuccess: vi.fn(),
}))

vi.mock("sonner", () => ({
  toast: {
    success: h.toastSuccess,
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
  },
}))

vi.mock("@/lib/api", () => ({
  checkDirectoriesExist: h.checkDirectoriesExist,
  relocateFolderPath: h.relocateFolderPath,
  getFolder: vi.fn(),
  getGitHead: vi.fn(async () => ({
    is_repo: false,
    branch: null,
    detached: false,
    short_sha: null,
  })),
  listOpenFolderDetails: vi.fn(async () => []),
  listAllFolderDetails: vi.fn(async () => []),
  listFolderGroups: vi.fn(async () => []),
  listAllConversations: vi.fn(async () => []),
  openFolder: vi.fn(),
  openFolderById: vi.fn(),
  openWorktreeFolder: vi.fn(),
  removeFolderFromWorkspace: vi.fn(),
  applySidebarLayout: vi.fn(),
  createFolderGroup: vi.fn(),
  updateFolderGroup: vi.fn(),
  deleteFolderGroup: vi.fn(),
  setFolderGroup: vi.fn(),
}))

vi.mock("@/lib/platform", () => ({
  isDesktop: () => true,
  openFileDialog: h.openFileDialog,
}))

vi.mock("@/lib/transport", () => ({
  getActiveRemoteConnectionId: () => null,
}))

vi.mock("@/components/shared/directory-browser", () => ({
  DirectoryBrowser: forwardRef(function MockDirectoryBrowser(
    props: {
      active: boolean
      initialPath?: string
      value: string
      onValueChange: (next: string) => void
      onQuickSelect?: (path: string) => void
    },
    ref
  ) {
    useImperativeHandle(
      ref,
      () => ({
        confirm: async () => props.value.trim() || null,
      }),
      [props.value]
    )
    return (
      <div
        data-testid="directory-browser"
        data-active={String(props.active)}
        data-initial-path={props.initialPath ?? ""}
      >
        <input
          aria-label="mock-path-input"
          value={props.value}
          onChange={(e) => props.onValueChange(e.target.value)}
        />
      </div>
    )
  }),
}))

import { RelocateFolderDialog } from "./relocate-folder-dialog"

function makeFolder(
  overrides: Partial<FolderDetail> & { id: number }
): FolderDetail {
  return {
    name: "repo",
    path: "/missing/sub/repo",
    git_branch: null,
    default_agent_type: null,
    last_opened_at: "2026-01-01T00:00:00.000Z",
    sort_order: 1,
    color: "#000000",
    parent_id: null,
    kind: "regular",
    alias: null,
    group_id: null,
    ...overrides,
  }
}

describe("RelocateFolderDialog", () => {
  beforeEach(() => {
    resetAppWorkspaceStore()
    h.checkDirectoriesExist.mockReset()
    h.relocateFolderPath.mockReset()
    h.openFileDialog.mockReset()
    h.toastSuccess.mockReset()
  })

  afterEach(() => {
    resetAppWorkspaceStore()
  })

  it("renders old path, resolves nearest existing ancestor, and relocates on confirm", async () => {
    const folder = makeFolder({
      id: 7,
      name: "repo",
      path: "/existing/missing/repo",
    })
    const updated = makeFolder({
      id: 7,
      name: "repo-new",
      path: "/existing/repo-new",
    })
    useAppWorkspaceStore.setState({
      folders: [folder],
      allFolders: [folder],
      missingFolderIds: new Set([7]),
    })
    h.checkDirectoriesExist.mockResolvedValue({
      "/existing/missing": false,
      "/existing": true,
      "/": true,
    })
    h.relocateFolderPath.mockResolvedValue(updated)

    const onOpenChange = vi.fn()
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <RelocateFolderDialog folderId={7} onOpenChange={onOpenChange} />
      </NextIntlClientProvider>
    )

    expect(screen.getByText("/existing/missing/repo")).toBeInTheDocument()
    expect(
      screen.getByText(enMessages.Folder.relocate.historyPreservedNote)
    ).toBeInTheDocument()

    await waitFor(() => {
      const browser = screen.getByTestId("directory-browser")
      expect(browser).toHaveAttribute("data-active", "true")
      expect(browser).toHaveAttribute("data-initial-path", "/existing")
    })

    const input = screen.getByLabelText("mock-path-input")
    await userEvent.clear(input)
    await userEvent.type(input, "/existing/repo-new")

    await userEvent.click(
      screen.getByRole("button", { name: enMessages.Folder.relocate.confirm })
    )

    await waitFor(() => {
      expect(h.relocateFolderPath).toHaveBeenCalledWith(7, "/existing/repo-new")
      expect(h.toastSuccess).toHaveBeenCalled()
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })

  it("displays an alert when relocation fails", async () => {
    const folder = makeFolder({ id: 7, name: "repo", path: "/old/repo" })
    useAppWorkspaceStore.setState({
      folders: [folder],
      allFolders: [folder],
    })
    h.checkDirectoriesExist.mockResolvedValue({})
    h.relocateFolderPath.mockRejectedValue(
      new Error(
        JSON.stringify({
          code: "already_exists",
          message: "Already exists in workspace",
          i18n_key: "Folder.relocate.errors.alreadyExists",
        })
      )
    )

    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <RelocateFolderDialog folderId={7} onOpenChange={vi.fn()} />
      </NextIntlClientProvider>
    )

    const input = screen.getByLabelText("mock-path-input")
    await userEvent.type(input, "/other/existing")

    await userEvent.click(
      screen.getByRole("button", { name: enMessages.Folder.relocate.confirm })
    )

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent(
      enMessages.Folder.relocate.errors.alreadyExists
    )
  })
})
