import type { BossyApi } from '../shared/contracts'

declare global {
  interface Window {
    bossy: BossyApi
  }
}

