// Shares parsed System Terms, the page map, and the jump handler with TermLink.
import { createContext, useContext } from 'react';
import type { ArchivePage, TermMap } from '../lib/archive';

export type ArchiveContextValue = {
  terms: TermMap;
  pages: ArchivePage[];
  goTo: (target: string) => void;
};

export const ArchiveContext = createContext<ArchiveContextValue>({ terms: {}, pages: [], goTo: () => undefined });

export const useArchive = () => useContext(ArchiveContext);
