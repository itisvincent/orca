import type { AgentType } from '../../../../shared/agent-status-types'
import { TUI_AGENT_CONFIG } from '../../../../shared/tui-agent-config'
import type { PaneForegroundAgentEntry } from '@/store/slices/pane-foreground-agent'

export type WindowsShiftEnterEncoding = 'alt-enter' | 'csi-u' | 'lf'

type WindowsShiftEnterAgentSignals = {
  foreground?: PaneForegroundAgentEntry
  launchAgentType?: AgentType
}

type WindowsShiftEnterPaneState = {
  paneForegroundAgentByPaneKey: Record<string, PaneForegroundAgentEntry | undefined>
  agentLaunchConfigByPaneKey: Record<string, { identity: { agentType?: AgentType } } | undefined>
}

/** Resolve without key-path PTY I/O; current process/shell evidence overrides
 * launch ownership. Hook status is excluded because PTY output can forge it. */
export function resolveWindowsShiftEnterEncoding(
  signals: WindowsShiftEnterAgentSignals
): WindowsShiftEnterEncoding {
  if (signals.foreground?.shellForeground) {
    return 'alt-enter'
  }
  // Why: trust the live foreground when fresh confirmation is available; otherwise fall back to the pane's launch agent so a single Shift+Enter newline is not lost to a transient foreground-scan miss during agent tool-subprocess churn (#9703, #10203). shellForeground above still fails closed when the agent has exited to a shell.
  const agent =
    signals.foreground?.routingTrusted === true
      ? signals.foreground.agent
      : (signals.launchAgentType ?? null)
  return agent ? (TUI_AGENT_CONFIG[agent].windowsShiftEnterEncoding ?? 'alt-enter') : 'alt-enter'
}

/** Resolves only pane-keyed evidence so a split sibling cannot inherit tab ownership. */
export function resolveWindowsShiftEnterEncodingForPane(
  state: WindowsShiftEnterPaneState,
  paneKey: string
): WindowsShiftEnterEncoding {
  return resolveWindowsShiftEnterEncoding({
    foreground: state.paneForegroundAgentByPaneKey[paneKey],
    launchAgentType: state.agentLaunchConfigByPaneKey[paneKey]?.identity.agentType
  })
}
