import type { ToggleablePageId } from './page-disables';

declare global {
  const __HELIX_DISABLED_PAGES__: ToggleablePageId[];
}

export {};
