import { describe, expect, it } from 'vitest'
import {
  resolveWindowsShiftEnterEncoding,
  resolveWindowsShiftEnterEncodingForPane
} from './terminal-windows-shift-enter'

describe('resolveWindowsShiftEnterEncoding', () => {
  it('uses CSI-u for trusted Droid evidence and for a Droid-launched pane when live trust is missing (#9703 reliability)', () => {
    expect(
      resolveWindowsShiftEnterEncoding({
        foreground: { agent: 'droid', routingTrusted: true, shellForeground: false }
      })
    ).toBe('csi-u')
    // Why: launch ownership keeps the encoding applied across a transient foreground-scan miss.
    expect(resolveWindowsShiftEnterEncoding({ launchAgentType: 'droid' })).toBe('csi-u')
  })

  it('uses LF for trusted Pi evidence and for a Pi-launched pane when live trust is missing (fast newline, no CSI-u decode freeze) (#9703 #10203)', () => {
    expect(
      resolveWindowsShiftEnterEncoding({
        foreground: { agent: 'pi', routingTrusted: true, shellForeground: false }
      })
    ).toBe('lf')
    expect(resolveWindowsShiftEnterEncoding({ launchAgentType: 'pi' })).toBe('lf')
  })

  it('does not let hook or OSC-derived status forge Droid input routing', () => {
    const state = {
      paneForegroundAgentByPaneKey: {},
      agentStatusByPaneKey: {
        'tab:pane': { agentType: 'droid' as const }
      },
      agentLaunchConfigByPaneKey: {}
    }

    expect(resolveWindowsShiftEnterEncodingForPane(state, 'tab:pane')).toBe('alt-enter')
  })

  it('keeps the legacy byte for Codex, Antigravity, unknown, and plain panes', () => {
    for (const agent of ['codex', 'antigravity', 'claude', null] as const) {
      expect(
        resolveWindowsShiftEnterEncoding({
          foreground: { agent, shellForeground: false }
        })
      ).toBe('alt-enter')
    }
    expect(resolveWindowsShiftEnterEncoding({})).toBe('alt-enter')
  })

  it('lets current process identity override stale launch ownership', () => {
    expect(
      resolveWindowsShiftEnterEncoding({
        foreground: { agent: 'antigravity', routingTrusted: true, shellForeground: false },
        launchAgentType: 'droid'
      })
    ).toBe('alt-enter')
  })

  it('keeps the launch-agent encoding while a newer command generation awaits trusted evidence (#9703 reliability)', () => {
    expect(
      resolveWindowsShiftEnterEncoding({
        foreground: { agent: 'droid', shellForeground: false },
        launchAgentType: 'droid'
      })
    ).toBe('csi-u')
    expect(
      resolveWindowsShiftEnterEncoding({
        foreground: { agent: null, shellForeground: false },
        launchAgentType: 'droid'
      })
    ).toBe('csi-u')
  })

  it('keeps launch ownership on its original leaf after a split sibling survives', () => {
    const state = {
      paneForegroundAgentByPaneKey: {},
      agentLaunchConfigByPaneKey: {
        'tab:launched-droid': { identity: { agentType: 'droid' } }
      }
    }

    // Why: launch ownership keeps the encoding applied on the launched leaf across a transient foreground-scan miss.
    expect(resolveWindowsShiftEnterEncodingForPane(state, 'tab:launched-droid')).toBe('csi-u')
    // Why: after split→close leaves only the sibling, pane count is no longer
    // ownership evidence; the surviving leaf with no launch config keeps the legacy fallback.
    expect(resolveWindowsShiftEnterEncodingForPane(state, 'tab:surviving-sibling')).toBe(
      'alt-enter'
    )
  })

  it('clears stale Droid ownership after the foreground returns to the shell', () => {
    expect(
      resolveWindowsShiftEnterEncoding({
        foreground: { agent: null, shellForeground: true },
        launchAgentType: 'droid'
      })
    ).toBe('alt-enter')
  })
})
