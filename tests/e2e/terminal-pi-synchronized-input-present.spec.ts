import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  execInTerminal,
  getTerminalContent,
  waitForActivePanePtyId,
  waitForActivePaneHookDescriptor,
  waitForActiveTerminalManager,
  waitForTerminalOutput
} from './helpers/terminal'
import { waitForTerminalPtyDataInjector } from './helpers/terminal-pty-injection'

type PiInputPresentWindow = Window & {
  __terminalPtyDataInjection?: {
    inject: (paneKey: string, data: string) => boolean
  }
}

async function injectPaneData(page: Page, paneKey: string, data: string): Promise<void> {
  const injected = await page.evaluate(
    ({ paneKey, data }) =>
      (window as PiInputPresentWindow).__terminalPtyDataInjection?.inject(paneKey, data) ?? false,
    { paneKey, data }
  )
  if (!injected) {
    throw new Error(`No terminal PTY data injector registered for ${paneKey}`)
  }
}

async function useDomRenderer(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window.__store?.getState()
    if (!state?.settings) {
      throw new Error('Store unavailable')
    }
    window.__store?.setState({
      settings: { ...state.settings, terminalGpuAcceleration: 'off' }
    })
    const worktreeId = state.activeWorktreeId
    const tabId =
      state.activeTabType === 'terminal'
        ? state.activeTabId
        : worktreeId
          ? (state.activeTabIdByWorktree?.[worktreeId] ?? null)
          : null
    window.__paneManagers?.get(tabId ?? '')?.setTerminalGpuAcceleration('off')
  })
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const state = window.__store?.getState()
          const worktreeId = state?.activeWorktreeId
          const tabId =
            state?.activeTabType === 'terminal'
              ? state.activeTabId
              : worktreeId
                ? (state?.activeTabIdByWorktree?.[worktreeId] ?? null)
                : null
          const manager = tabId ? window.__paneManagers?.get(tabId) : null
          const pane = manager?.getActivePane?.() ?? manager?.getPanes?.()[0] ?? null
          return pane?.container.querySelector('.xterm-rows') !== null
        }),
      { timeout: 10_000, message: 'Active terminal did not switch to the DOM renderer' }
    )
    .toBe(true)
}

async function readVisibleRows(page: Page): Promise<string> {
  return page.evaluate(() => {
    const state = window.__store?.getState()
    const worktreeId = state?.activeWorktreeId
    const tabId =
      state?.activeTabType === 'terminal'
        ? state.activeTabId
        : worktreeId
          ? (state?.activeTabIdByWorktree?.[worktreeId] ?? null)
          : null
    const manager = tabId ? window.__paneManagers?.get(tabId) : null
    const pane = manager?.getActivePane?.() ?? manager?.getPanes?.()[0] ?? null
    return pane?.container.querySelector<HTMLElement>('.xterm-rows')?.textContent ?? ''
  })
}

async function signalActiveTerminalInput(page: Page): Promise<void> {
  const observedInput = await page.evaluate(() => {
    const state = window.__store?.getState()
    const worktreeId = state?.activeWorktreeId
    const tabId =
      state?.activeTabType === 'terminal'
        ? state.activeTabId
        : worktreeId
          ? (state?.activeTabIdByWorktree?.[worktreeId] ?? null)
          : null
    const manager = tabId ? window.__paneManagers?.get(tabId) : null
    const pane = manager?.getActivePane?.() ?? manager?.getPanes?.()[0] ?? null
    if (!pane) {
      throw new Error('Active terminal pane is unavailable')
    }
    const terminal = pane.terminal as unknown as {
      _core?: { coreService?: { triggerDataEvent?: (data: string, wasUserInput: boolean) => void } }
    }
    if (typeof terminal?._core?.coreService?.triggerDataEvent !== 'function') {
      throw new Error('Active terminal user-input signal is unavailable')
    }
    let observed = false
    const disposable = pane.terminal.onData(() => {
      observed = true
    })
    terminal._core.coreService.triggerDataEvent('x', true)
    disposable.dispose()
    return observed
  })
  expect(observedInput).toBe(true)
}

test.describe('Pi synchronized tool-frame input presentation', () => {
  test('paints input typed after a tool frame is already open', async ({ orcaPage }) => {
    test.skip(process.platform !== 'win32', 'Synchronized foreground protection is Windows-only')
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
    await ensureTerminalVisible(orcaPage)
    await waitForActiveTerminalManager(orcaPage)

    const ptyId = await waitForActivePanePtyId(orcaPage)
    await execInTerminal(
      orcaPage,
      ptyId,
      `node -e "process.stdin.setRawMode?.(true); process.stdin.resume(); console.log('PI_INPUT_SINK_READY')"`
    )
    await waitForTerminalOutput(orcaPage, 'PI_INPUT_SINK_READY')
    const { paneKey } = await waitForActivePaneHookDescriptor(orcaPage)
    await waitForTerminalPtyDataInjector(orcaPage, paneKey)
    await useDomRenderer(orcaPage)

    await injectPaneData(orcaPage, paneKey, '\x1b[?2026h\x1b[2J\x1b[HPI_TOOL_ACTIVE\x1b[3;1H')
    try {
      await expect.poll(() => getTerminalContent(orcaPage)).toContain('PI_TOOL_ACTIVE')
      await signalActiveTerminalInput(orcaPage)
      await injectPaneData(orcaPage, paneKey, '\x1b[3;1Hpiinputmarker')

      await expect
        .poll(() => readVisibleRows(orcaPage), {
          timeout: 220,
          intervals: [10],
          message: 'Parsed Pi composer input was not presented while the tool frame stayed open'
        })
        .toContain('piinputmarker')
      await expect.poll(() => getTerminalContent(orcaPage)).toContain('piinputmarker')
    } finally {
      await injectPaneData(orcaPage, paneKey, '\x1b[?2026l')
    }
  })
})
