'use client';

// Adapted from Vercel AI Elements Sources; Copyright 2023 Vercel, Inc.
// SPDX-License-Identifier: Apache-2.0. See THIRD_PARTY_NOTICES.md.
// Native disclosure + platform CSS replace shadcn/Tailwind; no separate chat state.
import type { ComponentProps } from 'react';
import type { AnswerSource } from './answer-model.js';

export function Sources({ children, ...props }: ComponentProps<'details'>) {
  return <details {...props} className="platform-answer-sources">{children}</details>;
}
export function SourcesTrigger({ count }: { count: number }) {
  return <summary><span>{count} {count === 1 ? 'source' : 'sources'}</span><svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5"/></svg></summary>;
}
export function SourcesContent({ sources }: { sources: readonly AnswerSource[] }) {
  return <ol>{sources.map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer"><span>{source.title}</span><small>{new URL(source.url).hostname}</small></a></li>)}</ol>;
}
