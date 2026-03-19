/**
 * API Client Functions
 * Centralized API calls to the backend
 */
import { API_BASE } from '@/lib/api-base'

/**
 * Latest model response from backend
 */
export interface LatestModelResponse {
  id: string
  name: string
  description?: string
  createdAt: string
  updatedAt: string
  model: Record<string, unknown>
}

/**
 * Fetch the most recently updated structural model from the database
 * @returns Latest model data or null if no models exist
 */
export async function fetchLatestModel(): Promise<LatestModelResponse | null> {
  try {
    const response = await fetch(`${API_BASE}/api/v1/models/latest`, {
      headers: {
        'Content-Type': 'application/json',
      },
    })
    if (!response.ok) {
      console.warn('[fetchLatestModel] Failed to fetch latest model:', response.status, response.statusText)
      return null
    }
    const data = await response.json() as LatestModelResponse | { error: string }
    if ('error' in data) {
      console.error('[fetchLatestModel] Backend returned error:', data.error)
      return null
    }

    // Validate that the model has required fields
    if (!data.model || !('nodes' in data.model) || !('elements' in data.model)) {
      console.error('[fetchLatestModel] Invalid model structure:', data.model)
      return null
    }

    console.log('[fetchLatestModel] Successfully fetched model:', data.name, 'with', data.model)
    return data
  } catch (error) {
    console.error('[fetchLatestModel] Exception:', error)
    return null
  }
}
