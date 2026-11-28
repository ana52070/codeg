import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  resetAppWorkspaceStore,
  useAppWorkspaceStore,
} from "./app-workspace-store"
import { resetTabStore, useTabStore } from "./tab-store"
import type { FolderDetail } from "@/lib/types"

vi.mock("@/lib/api", () => ({
  listOpenedTabs: vi.fn(async () => ({ version: 1, tabs: [] })),
  saveOpenedTabs: vi.fn(async () => 1),
  getFolderConversation: vi.fn(),
  getGitHead: vi.fn(async () => ({
    is_repo: false,
    branch: null,
    detached: false,
    short_sha: null,
  })),
  listAllConversations: vi.fn(async () => []),
  relocateFolderPath: vi.fn(),
  ensureChatFolderDir: vi.fn(),
  checkDirectoriesExist: vi.fn(async () => ({})),
}))

vi.mock("@/lib/platform", () => ({
  subscribe: vi.fn(async () => () => {}),
  onTransportReconnect: vi.fn(() => () => {}),
}))

const { relocateFolderPath, ensureChatFolderDir, checkDirectoriesExist } =
  await import("@/lib/api")
const mockRelocateFolderPath = vi.mocked(relocateFolderPath)
const mockEnsureChatFolderDir = vi.mocked(ensureChatFolderDir)
const mockCheckDirectoriesExist = vi.mocked(checkDirectoriesExist)

function makeFolder(
  overrides: Partial<FolderDetail> & { id: number }
): FolderDetail {
  return {
    name: "repo",
    path: "/old/repo",
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

describe("tab-store syncs workingDir when a folder path is relocated", () => {
  beforeEach(() => {
    resetTabStore()
    resetAppWorkspaceStore()
    mockRelocateFolderPath.mockReset()
    mockEnsureChatFolderDir.mockReset()
    mockCheckDirectoriesExist.mockReset().mockResolvedValue({})
  })

  afterEach(() => {
    resetTabStore()
    resetAppWorkspaceStore()
  })

  it("updates open conversation tabs, draft tabs, and pending draft retargets on relocate", async () => {
    const oldFolder = makeFolder({ id: 1, name: "repo", path: "/old/repo" })
    const otherFolder = makeFolder({ id: 2, name: "other", path: "/other" })
    const relocatedFolder = makeFolder({
      id: 1,
      name: "repo-new",
      path: "/new/repo",
    })
    mockRelocateFolderPath.mockResolvedValue(relocatedFolder)
    mockCheckDirectoriesExist.mockResolvedValue({
      "/new/repo": true,
      "/other": true,
    })

    useAppWorkspaceStore.setState({
      folders: [oldFolder, otherFolder],
      allFolders: [oldFolder, otherFolder],
      foldersHydrated: true,
      missingFolderIds: new Set([1]),
    })

    useTabStore.setState({
      rawTabs: [
        {
          id: "conv-1-claude_code-10",
          kind: "conversation",
          folderId: 1,
          conversationId: 10,
          agentType: "claude_code",
          title: "Existing chat",
          isPinned: false,
          workingDir: "/old/repo",
        },
        {
          id: "draft-1",
          kind: "conversation",
          folderId: 1,
          conversationId: null,
          agentType: "claude_code",
          title: "New conversation",
          isPinned: false,
          workingDir: "/old/repo",
        },
        {
          id: "conv-2-codex-20",
          kind: "conversation",
          folderId: 2,
          conversationId: 20,
          agentType: "codex",
          title: "Untouched",
          isPinned: false,
          workingDir: "/other",
        },
      ],
      draftRetargetRequests: [
        {
          tabId: "draft-1",
          expectedAgent: "claude_code",
          folderId: 1,
          workingDir: "/old/repo",
          agentType: "claude_code",
          provisional: false,
        },
        {
          tabId: "draft-2",
          expectedAgent: "codex",
          folderId: 2,
          workingDir: "/other",
          agentType: "codex",
          provisional: false,
        },
      ],
      activeTabId: "conv-1-claude_code-10",
    })

    await useAppWorkspaceStore.getState().relocateFolder(1, "/new/repo")

    const tabState = useTabStore.getState()
    expect(tabState.rawTabs).toEqual([
      expect.objectContaining({
        id: "conv-1-claude_code-10",
        folderId: 1,
        workingDir: "/new/repo",
      }),
      expect.objectContaining({
        id: "draft-1",
        folderId: 1,
        workingDir: "/new/repo",
      }),
      expect.objectContaining({
        id: "conv-2-codex-20",
        folderId: 2,
        workingDir: "/other",
      }),
    ])
    expect(tabState.draftRetargetRequests).toEqual([
      expect.objectContaining({
        tabId: "draft-1",
        folderId: 1,
        workingDir: "/new/repo",
      }),
      expect.objectContaining({
        tabId: "draft-2",
        folderId: 2,
        workingDir: "/other",
      }),
    ])
  })

  it("backfills draft workingDir when folders hydrate after a restored draft", () => {
    const folder = makeFolder({ id: 5, name: "proj", path: "/relocated/proj" })
    const chatFolder = makeFolder({
      id: 99,
      name: "Chat",
      path: "/chat/scratch",
      kind: "chat",
    })

    useTabStore.setState({
      rawTabs: [
        {
          id: "draft-5",
          kind: "conversation",
          folderId: 5,
          conversationId: null,
          agentType: "claude_code",
          title: "Restored draft",
          isPinned: false,
          workingDir: "/stale/proj",
        },
        {
          id: "draft-chat",
          kind: "conversation",
          folderId: 99,
          conversationId: null,
          agentType: "claude_code",
          title: "Chat draft",
          isPinned: false,
          isChat: true,
        },
      ],
      activeTabId: "draft-5",
    })

    useAppWorkspaceStore.setState({
      folders: [folder],
      allFolders: [folder, chatFolder],
      foldersHydrated: true,
    })

    const rawTabs = useTabStore.getState().rawTabs
    expect(rawTabs[0]?.workingDir).toBe("/relocated/proj")
    expect(rawTabs[1]?.workingDir).toBeUndefined()
  })

  it("syncs open chat conversation tabs when ensureChatFolderDir heals a missing chat dir, while ignoring personal folders", async () => {
    const chat = makeFolder({
      id: 99,
      name: "Chat",
      path: "/data/chat-sessions/old",
      kind: "chat",
    })
    const personal = makeFolder({
      id: 100,
      name: "Personal",
      path: "/data/personal/old",
      kind: "personal",
    })
    const healedChat = makeFolder({
      id: 99,
      name: "Chat",
      path: "/data/chat-sessions/new",
      kind: "chat",
    })
    mockEnsureChatFolderDir.mockResolvedValueOnce(healedChat)

    useAppWorkspaceStore.setState({
      folders: [],
      allFolders: [chat, personal],
      foldersHydrated: true,
    })
    useTabStore.setState({
      rawTabs: [
        {
          id: "conv-99-claude_code-301",
          kind: "conversation",
          folderId: 99,
          conversationId: 301,
          agentType: "claude_code",
          title: "Temp chat",
          isPinned: true,
          isChat: true,
          workingDir: "/data/chat-sessions/old",
        },
        {
          id: "conv-100-claude_code-302",
          kind: "conversation",
          folderId: 100,
          conversationId: 302,
          agentType: "claude_code",
          title: "Personal",
          isPinned: true,
          workingDir: "/data/personal/old",
        },
      ],
      activeTabId: "conv-99-claude_code-301",
    })

    await useAppWorkspaceStore.getState().ensureChatFolderDir(99)
    useAppWorkspaceStore.setState({
      allFolders: [healedChat, { ...personal, path: "/data/personal/new" }],
    })

    const rawTabs = useTabStore.getState().rawTabs
    expect(rawTabs[0]?.workingDir).toBe("/data/chat-sessions/new")
    expect(rawTabs[1]?.workingDir).toBe("/data/personal/old")
  })
})
