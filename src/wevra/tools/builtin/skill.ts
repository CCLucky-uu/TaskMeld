import type { Tool } from "../../types"
import type { SkillRegistry } from "../../skills"

export function createSkillTools(skills: SkillRegistry): Tool[] {
  return [
    {
      name: "skill_load",
      description:
        "Load a skill into the conversation. Call this when a task matches a skill from the Available Skills list.",
      parameters: {
        type: "object",
        properties: {
          skillName: { type: "string", description: 'The skill name to load, e.g. "failure-diagnosis"' },
        },
        required: ["skillName"],
      },
      annotations: { readOnly: true, destructive: false, requiresConfirmation: false, idempotent: true },
      permission: "auto",
      async execute(args) {
        const { skillName } = args as { skillName: string }
        const skill = skills.get(skillName)
        if (!skill) {
          const available = skills
            .list()
            .map((s) => s.name)
            .join(", ")
          return { output: `Skill "${skillName}" not found. Available: ${available}`, isError: true }
        }
        if (skill.invocation === "user") {
          return { output: `Skill "${skillName}" can only be invoked by the user via /${skill.name}.`, isError: true }
        }
        return { output: skill.content, isError: false }
      },
    },
  ]
}
