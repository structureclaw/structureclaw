'use client'

import { useId } from 'react'
import { CapabilitySettingsPanel } from '@/components/chat/capability-settings-panel'
import { DialogShell } from '@/components/ui/dialog-shell'
import { Button } from '@/components/ui/button'
import { LlmSettingsPanel } from '@/components/settings/llm-settings-panel'
import { useI18n } from '@/lib/i18n'
import { useStore } from '@/lib/stores/context'
import { cn } from '@/lib/utils'
import type { WorkspaceSettingsTab } from '@/lib/stores/slices/preferences'

const SETTINGS_TABS: WorkspaceSettingsTab[] = ['capabilities', 'llm']

export function WorkspaceSettingsDialog() {
  const { t } = useI18n()
  const tabBaseId = useId()
  const open = useStore((state) => state.workspaceSettingsOpen)
  const activeTab = useStore((state) => state.workspaceSettingsTab)
  const openWorkspaceSettings = useStore((state) => state.openWorkspaceSettings)
  const closeWorkspaceSettings = useStore((state) => state.closeWorkspaceSettings)

  return (
    <DialogShell
      open={open}
      title={t('workspaceSettingsDialogTitle')}
      description={t('workspaceSettingsDialogDesc')}
      closeLabel={t('closeLabel')}
      onClose={closeWorkspaceSettings}
      className="max-w-7xl"
    >
      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label={t('workspaceSettingsDialogTitle')}>
        {SETTINGS_TABS.map((tab) => (
          <Button
            key={tab}
            type="button"
            variant="outline"
            role="tab"
            aria-selected={activeTab === tab}
            aria-controls={`${tabBaseId}-panel-${tab}`}
            id={`${tabBaseId}-tab-${tab}`}
            className={cn(
              'rounded-full',
              activeTab === tab ? 'border-cyan-300/50 bg-cyan-300/15 text-cyan-800 dark:text-cyan-100' : ''
            )}
            onClick={() => openWorkspaceSettings(tab)}
          >
            {tab === 'capabilities' ? t('capabilitySettingsNav') : t('llmSettingsNav')}
          </Button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${tabBaseId}-panel-${activeTab}`}
        aria-labelledby={`${tabBaseId}-tab-${activeTab}`}
      >
        {activeTab === 'capabilities' ? <CapabilitySettingsPanel /> : <LlmSettingsPanel />}
      </div>
    </DialogShell>
  )
}
