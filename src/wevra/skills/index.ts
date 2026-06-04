import type { SkillDef, SkillInvocation } from '../types'

export class SkillRegistry {
  private skills = new Map<string, SkillDef>()

  register(skill: SkillDef): void {
    this.skills.set(skill.name, skill)
  }

  get(name: string): SkillDef | undefined {
    return this.skills.get(name)
  }

  list(): Array<Pick<SkillDef, 'name' | 'description' | 'invocation'>> {
    return Array.from(this.skills.values()).map(s => ({
      name: s.name,
      description: s.description,
      invocation: s.invocation,
    }))
  }

  getByInvocation(invocation: SkillInvocation): SkillDef[] {
    return Array.from(this.skills.values()).filter(s => s.invocation === invocation)
  }

  getAlwaysActive(): SkillDef[] {
    return this.getByInvocation('always')
  }

  get size(): number {
    return this.skills.size
  }
}

// ── 内置 Skills ──

export const BUILTIN_SKILLS: SkillDef[] = [
  {
    name: 'core-behavior',
    description: '核心行为规范',
    invocation: 'always',
    content: `## 行为规范
- 不确定时问用户，不要猜测
- 破坏性操作（删除等）前先确认
- 工具调用失败时先分析原因再重试，不要直接放弃
- 回答简洁，避免冗余
- 使用中文回复`,
  },
  {
    name: 'pipeline-management',
    description: '创建和管理 pipeline 的推荐流程',
    invocation: 'auto',
    content: `## Pipeline 管理流程
当用户要创建或修改 pipeline 时：
1. 先用 pipeline.list 查看现有 pipeline，避免重复
2. 如果是修改，先用 pipeline.get 查看当前定义
3. 创建/修改后确认结果
4. 如需运行，用 pipeline.run 启动

注意事项：
- Pipeline 名称应简洁明了
- 创建前确认用户的需求，不要假设节点结构`,
  },
  {
    name: 'failure-diagnosis',
    description: '分析 pipeline 运行失败的原因并给出修复建议',
    invocation: 'auto',
    content: `## 失败诊断流程
当 pipeline 运行失败时：
1. 用 pipeline.status 查看整体运行状态
2. 用 pipeline.diagnose 获取初步分析
3. 如果需要深入：
   - 用 session.history 查看该节点 agent 的对话历史
   - 用 artifact.get 读取该节点的输出产物
4. 综合信息后给出：
   - 失败根因
   - 影响范围
   - 修复建议

不要猜测失败原因，必须基于实际数据。`,
  },
]

export function createSkillRegistry(): SkillRegistry {
  const registry = new SkillRegistry()
  for (const skill of BUILTIN_SKILLS) {
    registry.register(skill)
  }
  return registry
}
