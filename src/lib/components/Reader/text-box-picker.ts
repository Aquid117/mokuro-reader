import { writable } from 'svelte/store';
import type { Page } from '$lib/types';
import type { VolumeMetadata } from '$lib/anki-connect';

interface TextBoxPickerState {
  open: boolean;
  image?: string;
  page?: Page;
  pageNumber?: number;
  tags?: string;
  metadata?: VolumeMetadata;
  /** manga-immersion fork: 'explain' opens the AI explanation instead of the Anki flow */
  purpose?: 'anki' | 'explain';
}

export const textBoxPickerStore = writable<TextBoxPickerState>({ open: false });

export function showTextBoxPicker(
  image: string,
  page: Page,
  tags?: string,
  metadata?: VolumeMetadata,
  pageNumber?: number,
  purpose: 'anki' | 'explain' = 'anki'
) {
  textBoxPickerStore.set({ open: true, image, page, pageNumber, tags, metadata, purpose });
}
