import { createInterface } from "node:readline"
import type { ReadLine } from "node:readline"

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  white: "\x1b[37m",
  black: "\x1b[30m",
  bgCyan: "\x1b[46m",
  bgGreen: "\x1b[42m",
}

/** Render a horizontal rule line */
export const hr = () => {
  process.stdout.write(`\n  ${c.dim}${"─".repeat(50)}${c.reset}\n\n`)
}

/** Simple text-input prompt using readline */
export const fieldPrompt = (
  rl: ReturnType<typeof createInterface>,
  label: string,
  hint: string,
  prefill?: string,
): Promise<string> => {
  return new Promise((resolve) => {
    process.stdout.write(`  ${c.bold}${c.white}${label}${c.reset}\n`)
    process.stdout.write(`  ${c.dim}${hint}${c.reset}\n\n`)
    rl.question(`  ${c.green}${c.bold}>${c.reset} `, (answer) => {
      resolve(answer.trim())
    })
    if (prefill) {
      rl.write(prefill)
    }
  })
}

/** Interactive arrow-key select prompt using raw TTY mode */
export const selectPrompt = (label: string, options: { value: string; label: string }[]): Promise<string> => {
  return new Promise((resolve) => {
    let selected = 0

    process.stdout.write(`  ${c.bold}${c.white}${label}${c.reset}\n\n`)

    const render = () => {
      for (let i = 0; i < options.length; i++) {
        const opt = options[i]
        if (i === selected) {
          process.stdout.write(`    ${c.bgCyan}${c.black}${c.bold} ${opt.label} ${c.reset}\n`)
        } else {
          process.stdout.write(`    ${c.dim}${opt.label}${c.reset}\n`)
        }
      }
    }

    render()

    const onData = (key: Buffer) => {
      const str = key.toString()
      // up arrow or k
      if (str === "\x1b[A" || str === "k") {
        selected = selected > 0 ? selected - 1 : options.length - 1
        // down arrow or j
      } else if (str === "\x1b[B" || str === "j") {
        selected = selected < options.length - 1 ? selected + 1 : 0
        // enter
      } else if (str === "\r" || str === "\n") {
        cleanup()
        process.stdout.write("\n")
        resolve(options[selected].value)
        return
        // ctrl+c
      } else if (str === "\x03") {
        cleanup()
        process.stdout.write("\n")
        process.exit(0)
      } else {
        return
      }

      // Move cursor up to re-render
      process.stdout.write(`\x1b[${options.length}A`)
      process.stdout.write("\x1b[J")
      render()
    }

    const cleanup = () => {
      process.stdin.removeListener("data", onData)
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false)
      }
      process.stdin.pause()
    }

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true)
    }
    process.stdin.resume()
    process.stdin.on("data", onData)
  })
}
