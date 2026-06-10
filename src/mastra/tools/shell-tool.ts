import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { exec } from "child_process";

export const shellTool = createTool({
  id: "execute-shell",
  description:
    "Execute a shell command and return stdout, stderr, and the exit code.",
  inputSchema: z.object({
    command: z.string().describe("The shell command to execute"),
    cwd: z
      .string()
      .optional()
      .describe(
        "Working directory to run the command in. Defaults to the project root if not specified.",
      ),
  }),
  outputSchema: z.object({
    stdout: z.string().describe("Standard output from the command"),
    stderr: z.string().describe("Standard error output from the command"),
    exitCode: z.number().describe("The exit code of the command (0 = success)"),
  }),
  requireApproval: true,
  mcp: {
    annotations: {
      title: "Execute Shell Command",
      destructiveHint: true,
      openWorldHint: true,
    },
  },
  execute: async ({ command, cwd }, { abortSignal }) => {
    if (abortSignal?.aborted) {
      throw new Error("Shell command was aborted before execution");
    }
    return new Promise((resolve, reject) => {
      const child = exec(command, { cwd }, (error, stdout, stderr) => {
        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          exitCode: error?.code ?? 0,
        });
      });
      if (abortSignal) {
        abortSignal.addEventListener(
          "abort",
          () => {
            child.kill();
            reject(new Error("Shell command was aborted"));
          },
          { once: true },
        );
      }
    });
  },
});
