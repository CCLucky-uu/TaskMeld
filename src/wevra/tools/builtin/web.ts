import type { Tool } from '../../types'

export const webTools: Tool[] = [
  {
    name: 'web_search',
    description: 'Search the internet using DuckDuckGo. Returns search results with titles, URLs, and snippets.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query string' },
        maxResults: { type: 'number', description: 'Max results, default 5', default: 5 },
      },
      required: ['query'],
    },
    annotations: { readOnly: true, destructive: false, requiresConfirmation: false, idempotent: true },
    permission: 'auto',
    async execute() {
      return { output: 'Web search is not yet implemented. This is a placeholder.', isError: false }
    },
  },
  {
    name: 'web_fetch',
    description: 'Fetch and read the content of a web page. Returns the main text content.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to fetch' },
        maxLength: { type: 'number', description: 'Max characters, default 10000', default: 10000 },
      },
      required: ['url'],
    },
    annotations: { readOnly: true, destructive: false, requiresConfirmation: false, idempotent: true },
    permission: 'auto',
    async execute() {
      return { output: 'Web fetch is not yet implemented. This is a placeholder.', isError: false }
    },
  },
]
