#!/usr/bin/env node

import "dotenv/config"
import { APP_VERSION } from "../version"
import { toCliError, withHelpHint } from "./errors"
import { createMainCliBootstrap } from "./bootstrap"
import { writeError, writeHelp, writeResult } from "./output"
import { resolveHelpHint, resolveHelpHintByRouteKey } from "./help"
import { CLI_ROUTES, getRouteDefinition, resolveRoute } from "./router"
import type { CliBootstrap, CliGlobalOptions, CliRunOptions } from "./types"

type CliMainOptions = {
  bootstrap: CliBootstrap
}

export const runCli = async (options: CliMainOptions, runOptions: CliRunOptions): Promise<number> => {
  const stdout = runOptions.stdout ?? process.stdout
  const stderr = runOptions.stderr ?? process.stderr
  let routeKey: string | undefined
  let routeGlobal: CliGlobalOptions = { format: "json", envelope: false }
  let bootstrapped: Awaited<ReturnType<CliBootstrap>> | null = null

  try {
    const routeMatch = resolveRoute(runOptions)
    routeKey = routeMatch.key
    routeGlobal = routeMatch.global
    const route = getRouteDefinition(routeMatch.key)
    bootstrapped = await options.bootstrap({ routeKey: routeMatch.key, route })
    const result = await route.handler(routeMatch.input, {
      app: bootstrapped.app,
      global: routeMatch.global,
    })
    writeResult(stdout, route.key, result, routeMatch.global)
    return 0
  } catch (error) {
    let cliError = toCliError(error)
    if (cliError.code === "HELP_REQUESTED") {
      writeHelp(stdout, cliError.message)
      return 0
    }
    if (cliError.code === "VERSION_REQUESTED") {
      stdout.write(`${APP_VERSION}\n`)
      return 0
    }
    if (cliError.code === "INVALID_ARGUMENT" || cliError.code === "UNKNOWN_COMMAND") {
      const hint = routeKey
        ? resolveHelpHintByRouteKey(CLI_ROUTES, routeKey)
        : resolveHelpHint(CLI_ROUTES, runOptions.argv)
      cliError = withHelpHint(cliError, hint)
    }
    writeError(stderr, cliError, routeKey, routeGlobal)
    return cliError.exitCode
  } finally {
    await bootstrapped?.dispose?.()
  }
}

export const main = async (argv: string[]): Promise<number> => {
  return runCli(
    {
      bootstrap: createMainCliBootstrap(),
    },
    { argv, stdin: process.stdin },
  )
}

if (require.main === module) {
  void main(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode
  })
}
