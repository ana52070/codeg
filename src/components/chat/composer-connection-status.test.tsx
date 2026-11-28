import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import enMessages from "@/i18n/messages/en.json"
import type {
  ConnectErrorInfo,
  ConnectionState,
} from "@/contexts/acp-connections-context"
import {
  resetAppWorkspaceStore,
  useAppWorkspaceStore,
} from "@/stores/app-workspace-store"
import type { FolderDetail } from "@/lib/types"

const fake = vi.hoisted(() => {
  const state = {
    // The store entry for the tab under test. `undefined` is the real shape of
    // a disconnected composer — teardown REMOVES the entry, it doesn't park a
    // "disconnected" one.
    conn: undefined as ConnectionState | undefined,
    /** Why the last connect failed (the store's side table). */
    connectError: undefined as ConnectErrorInfo | undefined,
    reconnectInfo: null as {
      agentType: string
      workingDir: string | null
      sessionId: string | null
    } | null,
    reconnect: vi.fn(async () => true),
    /** contextKeys the component asked to reconnect, in order. */
    reconnectedKeys: [] as string[],
  }
  return {
    state,
    // Stable across renders — the component's useCallback deps include it, and
    // `getConnection` must return a stable reference for useSyncExternalStore.
    store: {
      getConnection: () => state.conn,
      getConnectPending: () => undefined,
      getConnectError: () => state.connectError,
      getActiveKey: () => null,
      subscribeKey: () => () => {},
      subscribeActiveKey: () => () => {},
    },
    actions: {
      reconnect: (key: string) => {
        state.reconnectedKeys.push(key)
        return state.reconnect()
      },
      getReconnectInfo: () => state.reconnectInfo,
    },
  }
})

vi.mock("@/contexts/acp-connections-context", () => ({
  useConnectionStore: () => fake.store,
  useAcpActions: () => fake.actions,
}))

import { ComposerConnectionStatus } from "./composer-connection-status"

const copy = enMessages.Folder.statusBar.connection

/** A live, idle owner connection — only the fields this component reads. */
function connected(over: Partial<ConnectionState> = {}): ConnectionState {
  return {
    agentType: "claude_code",
    workingDir: "/Users/dev/repo",
    sessionId: "sess-abc-123",
    status: "connected",
    error: null,
    isViewer: false,
    backgroundOutstanding: 0,
    backgroundTasks: [],
    asyncTasks: [],
    remoteControl: null,
    delegatedChildren: [],
    ...over,
  } as unknown as ConnectionState
}

function renderStatus(tabId: string | null = "tab-1") {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ComposerConnectionStatus tabId={tabId} />
    </NextIntlClientProvider>
  )
}

async function openPopover() {
  await userEvent.click(
    screen.getByRole("button", {
      name: new RegExp(copy.title, "i"),
    })
  )
}

/**
 * The agent label, NOT the `<title>` lucide/AgentIcon puts inside its SVG —
 * both carry the same text, so an undisambiguated query matches twice.
 */
function findAgentLabel(label: string) {
  return screen.findByText(label, { selector: "span" })
}

describe("ComposerConnectionStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAppWorkspaceStore()
    fake.state.conn = connected()
    fake.state.connectError = undefined
    fake.state.reconnectInfo = {
      agentType: "claude_code",
      workingDir: "/Users/dev/repo",
      sessionId: "sess-abc-123",
    }
    fake.state.reconnect = vi.fn(async () => true)
    fake.state.reconnectedKeys = []
  })

  afterEach(() => {
    resetAppWorkspaceStore()
  })

  it("keeps the status readable on the trigger before anything is clicked", () => {
    renderStatus()

    expect(
      screen.getByRole("button", {
        name: `${copy.title}: ${copy.connected}`,
      })
    ).toBeInTheDocument()
    // The panel is a popover — nothing is rendered until the trigger is used.
    expect(screen.queryByText(copy.workingDir)).not.toBeInTheDocument()
  })

  it("names the agent and its live details once opened", async () => {
    renderStatus()
    await openPopover()

    expect(await findAgentLabel("Claude Code")).toBeInTheDocument()
    expect(screen.getByText("/Users/dev/repo")).toBeInTheDocument()
    expect(screen.getByText("sess-abc-123")).toBeInTheDocument()
    expect(screen.getByText(copy.connected)).toBeInTheDocument()
  })

  it("tells a responding session apart from a resting one inside the popover", async () => {
    fake.state.conn = connected({ status: "prompting" })
    renderStatus()

    // The trigger still collapses `prompting` into `connected` — the icon is a
    // connection signal, not a turn signal.
    expect(
      screen.getByRole("button", {
        name: `${copy.title}: ${copy.connected}`,
      })
    ).toBeInTheDocument()

    await openPopover()
    expect(await screen.findByText(copy.prompting)).toBeInTheDocument()
  })

  it("reconnects the live connection when the button is clicked", async () => {
    renderStatus()
    await openPopover()

    await userEvent.click(
      await screen.findByRole("button", { name: copy.reconnect })
    )

    expect(fake.state.reconnectedKeys).toEqual(["tab-1"])
  })

  it("still offers reconnect when no connection entry exists at all", async () => {
    fake.state.conn = undefined
    renderStatus()

    expect(
      screen.getByRole("button", {
        name: `${copy.title}: ${copy.disconnected}`,
      })
    ).toBeInTheDocument()

    await openPopover()
    // The remembered connect params still name the agent and its cwd, so a
    // disconnected composer isn't a blank panel.
    expect(await findAgentLabel("Claude Code")).toBeInTheDocument()
    expect(screen.getByText("/Users/dev/repo")).toBeInTheDocument()

    const button = await screen.findByRole("button", { name: copy.reconnect })
    expect(button).toBeEnabled()
    await userEvent.click(button)
    expect(fake.state.reconnectedKeys).toEqual(["tab-1"])
  })

  it("reconnects from a failed connection, surfacing the error", async () => {
    fake.state.conn = connected({
      status: "error",
      error: "spawn claude ENOENT",
    })
    renderStatus()
    await openPopover()

    expect(await screen.findByText("spawn claude ENOENT")).toBeInTheDocument()
    await userEvent.click(
      await screen.findByRole("button", { name: copy.reconnect })
    )
    expect(fake.state.reconnectedKeys).toEqual(["tab-1"])
  })

  it("reads a failed connect as an error, not as 'disconnected'", async () => {
    // A connect that failed leaves no store entry — the same shape as never
    // having connected. The side table is what tells the two apart.
    fake.state.conn = undefined
    fake.state.connectError = {
      agentType: "codex",
      title: "Codex connection failed",
      detail: "spawn codex-acp ENOENT",
      opensAgentSettings: false,
    }
    renderStatus()

    const trigger = screen.getByRole("button", {
      name: `${copy.title}: ${copy.error}`,
    })
    expect(trigger).toHaveAttribute(
      "title",
      "Codex - Codex connection failed · spawn codex-acp ENOENT"
    )

    await openPopover()
    expect(
      await screen.findByText(
        "Codex connection failed · spawn codex-acp ENOENT"
      )
    ).toBeInTheDocument()
    // Reconnect stays the way out of it.
    await userEvent.click(
      await screen.findByRole("button", { name: copy.reconnect })
    )
    expect(fake.state.reconnectedKeys).toEqual(["tab-1"])
  })

  it("offers to relocate the folder when a connect failed on a missing directory", async () => {
    fake.state.conn = undefined
    useAppWorkspaceStore.setState({
      allFolders: [
        {
          id: 41,
          name: "Repo",
          path: "/missing/repo",
          git_branch: null,
          default_agent_type: null,
          last_opened_at: "2026-01-01T00:00:00.000Z",
          sort_order: 1,
          color: "#000000",
          parent_id: null,
          kind: "regular",
          alias: null,
          group_id: null,
        } as FolderDetail,
      ],
    })
    fake.state.connectError = {
      agentType: "codex",
      title: "Folder does not exist",
      detail: "The folder path was deleted or moved: /missing/repo",
      opensAgentSettings: false,
      missingWorkingDir: "/missing/repo",
    }
    const openByPath = vi.spyOn(
      useAppWorkspaceStore.getState(),
      "openRelocateFolderDialogByPath"
    )

    renderStatus()
    await openPopover()

    const relocateBtn = await screen.findByRole("button", {
      name: copy.relocateFolder,
    })
    await userEvent.click(relocateBtn)
    expect(openByPath).toHaveBeenCalledWith("/missing/repo")
  })

  it("opens relocate dialog by folder id when a matching missing folder is known", async () => {
    fake.state.conn = undefined
    fake.state.reconnectInfo = {
      agentType: "claude_code",
      workingDir: "D:\\Missing\\Repo",
      sessionId: "sess-abc-123",
    }
    useAppWorkspaceStore.setState({
      allFolders: [
        {
          id: 42,
          name: "Repo",
          path: "d:\\missing\\repo\\",
          git_branch: null,
          default_agent_type: null,
          last_opened_at: "2026-01-01T00:00:00.000Z",
          sort_order: 1,
          color: "#000000",
          parent_id: null,
          kind: "regular",
          alias: null,
          group_id: null,
        } as FolderDetail,
      ],
      missingFolderIds: new Set([42]),
    })

    renderStatus()
    await openPopover()

    const relocateBtn = await screen.findByRole("button", {
      name: copy.relocateFolder,
    })
    await userEvent.click(relocateBtn)
    expect(useAppWorkspaceStore.getState().relocateDialogFolderId).toBe(42)
  })

  it.each(["chat", "personal"] as const)(
    "hides relocate folder button for non-regular (%s) folders",
    async (kind) => {
      fake.state.conn = undefined
      fake.state.reconnectInfo = {
        agentType: "claude_code",
        workingDir: "/missing/non-regular",
        sessionId: "sess-abc-123",
      }
      fake.state.connectError = {
        agentType: "codex",
        title: "Folder does not exist",
        detail: "The folder path was deleted or moved: /missing/non-regular",
        opensAgentSettings: false,
        missingWorkingDir: "/missing/non-regular",
      }
      useAppWorkspaceStore.setState({
        allFolders: [
          {
            id: 43,
            name: kind === "chat" ? "Chat" : "Personal",
            path: "/missing/non-regular",
            git_branch: null,
            default_agent_type: null,
            last_opened_at: "2026-01-01T00:00:00.000Z",
            sort_order: 1,
            color: "#000000",
            parent_id: null,
            kind,
            alias: null,
            group_id: null,
          } as FolderDetail,
        ],
        missingFolderIds: new Set([43]),
      })

      renderStatus()
      await openPopover()

      expect(
        screen.queryByRole("button", { name: copy.relocateFolder })
      ).not.toBeInTheDocument()
    }
  )

  it("lets a live entry's own state win over a stale connect failure", () => {
    fake.state.connectError = {
      agentType: "codex",
      title: "Codex connection failed",
      detail: null,
      opensAgentSettings: false,
    }
    renderStatus()
    expect(
      screen.getByRole("button", {
        name: `${copy.title}: ${copy.connected}`,
      })
    ).toBeInTheDocument()
  })

  it("disables the button when there is no reconnect target", async () => {
    fake.state.conn = undefined
    fake.state.reconnectInfo = null
    renderStatus()
    await openPopover()

    expect(
      await screen.findByText(copy.reconnectUnavailable)
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: copy.reconnect })).toBeDisabled()
    expect(fake.state.reconnectedKeys).toEqual([])
  })

  it("warns that reconnecting an owner mid-turn destroys the running work", async () => {
    fake.state.conn = connected({ status: "prompting" })
    renderStatus()
    await openPopover()

    expect(
      await screen.findByText(copy.reconnectInterrupts)
    ).toBeInTheDocument()
    // Still offered — the warning informs, it doesn't gate.
    expect(screen.getByRole("button", { name: copy.reconnect })).toBeEnabled()
  })

  it("warns while background work is outstanding, even between turns", async () => {
    fake.state.conn = connected({ backgroundOutstanding: 2 })
    renderStatus()
    await openPopover()

    expect(
      await screen.findByText(copy.reconnectInterrupts)
    ).toBeInTheDocument()
  })

  it("warns while an async task is running, even with nothing outstanding", async () => {
    fake.state.conn = connected({
      asyncTasks: [
        {
          task_id: "call_bg_1",
          name: "npm run dev",
          task_type: "shell",
          description: "",
          show_in_transcript: false,
          can_stop: true,
          state: "running",
        },
      ],
    })
    renderStatus()
    await openPopover()

    expect(
      await screen.findByText(copy.reconnectInterrupts)
    ).toBeInTheDocument()
  })

  it("skips the warning for a viewer, whose reconnect only re-attaches", async () => {
    fake.state.conn = connected({ status: "prompting", isViewer: true })
    renderStatus()
    await openPopover()

    expect(await screen.findByText(copy.viewerNote)).toBeInTheDocument()
    expect(screen.queryByText(copy.reconnectInterrupts)).not.toBeInTheDocument()
  })

  it("shows progress and blocks a double-click while reconnecting", async () => {
    let release: (() => void) | undefined
    fake.state.reconnect = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          release = () => resolve(true)
        })
    )
    renderStatus()
    await openPopover()

    await userEvent.click(
      await screen.findByRole("button", { name: copy.reconnect })
    )

    const busy = await screen.findByRole("button", { name: copy.reconnecting })
    expect(busy).toBeDisabled()
    await userEvent.click(busy)
    expect(fake.state.reconnect).toHaveBeenCalledTimes(1)

    release?.()
    await waitFor(() =>
      expect(screen.getByRole("button", { name: copy.reconnect })).toBeEnabled()
    )
  })
})
