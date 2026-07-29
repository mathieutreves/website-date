#!/usr/bin/env node
/**
 * stdio entry point — what an MCP client actually launches.
 *
 *   npx pagedate-mcp
 *
 * Nothing may be written to stdout that is not protocol: on a stdio transport
 * stdout *is* the channel, and one stray `console.log` corrupts the stream. Any
 * diagnostics belong on stderr.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createServer } from './index.js'

const server = createServer()
await server.connect(new StdioServerTransport())
