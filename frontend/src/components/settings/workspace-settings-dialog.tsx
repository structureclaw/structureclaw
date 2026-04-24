'use client'

import { type ReactNode, useId } from 'react'
import { CapabilitySettingsPanel } from '@/components/chat/capability-settings-panel'
import { DialogShell } from '@/components/ui/dialog-shell'
import { Button } from '@/components/ui/button'
import { LlmSettingsPanel } from '@/components/settings/llm-settings-panel'
import { DatabaseSettingsPanel } from '@/components/settings/database-settings-panel'
import { useI18n } from '@/lib/i18n'
import { useStore } from '@/lib/stores/context'
import { cn } from '@/lib/utils'
import type { WorkspaceSettingsTab } from '@/lib/stores/slices/preferences'
import type { MessageKey } from '@/lib/i18n'

type TabConfig = {
  labelKey: MessageKey
  panel: ReactNode
}

const TAB_CONFIG: Record<WorkspaceSettingsTab, TabConfig> = {
  capabilities: { labelKey: 'capabilitySettingsNav', panel: <CapabilitySettingsPanel /> },
  llm: { labelKey: 'llmSettingsNav', panel: <LlmSettingsPanel /> },
  database: { labelKey: 'databaseAdminNav', panel: <DatabaseSettingsPanel /> },
}

const SETTINGS_TABS = Object.keys(TAB_CONFIG) as WorkspaceSettingsTab[]

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
            {t(TAB_CONFIG[tab].labelKey)}
          </Button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${tabBaseId}-panel-${activeTab}`}
        aria-labelledby={`${tabBaseId}-tab-${activeTab}`}
      >
        {TAB_CONFIG[activeTab].panel}
      </div>
    </DialogShell>
  )
}
