import type { PipelineRegistry } from "../app/pipeline-registry"
import { ensureGatewayConnected } from "./gateway-read-helpers"

// ── skills.install ── three mutually exclusive modes (anyOf)

export type SkillInstallClawhubParams = {
  source: "clawhub"
  slug: string
  version?: string
  force?: boolean
}

export type SkillInstallUploadParams = {
  source: "upload"
  slug: string
  uploadId: string
  version?: string
  force?: boolean
}

export type SkillInstallInstallerParams = {
  source?: undefined
  name: string
  installId: string
  dangerouslyForceUnsafeInstall?: boolean
}

export type SkillInstallParams = SkillInstallClawhubParams | SkillInstallUploadParams | SkillInstallInstallerParams

// ── skills.update ── two mutually exclusive modes

export type SkillUpdateBySkillKeyParams = {
  skillKey: string
}

export type SkillUpdateBySlugParams = {
  slug: string
  version?: string
}

export type SkillUpdateParams = SkillUpdateBySkillKeyParams | SkillUpdateBySlugParams

// ── skills.search ──

export type SkillSearchParams = {
  query?: string
}

// ── skills.status ──

export type SkillStatusParams = Record<string, never>

// ── Service ──

export type GatewaySkillService = {
  installSkill: (params: SkillInstallParams) => Promise<unknown>
  updateSkill: (params: SkillUpdateParams) => Promise<unknown>
  searchSkills: (params?: SkillSearchParams) => Promise<unknown>
  getSkillStatus: () => Promise<unknown>
}

export const createGatewaySkillService = (app: PipelineRegistry): GatewaySkillService => {
  const installSkill = async (params: SkillInstallParams): Promise<unknown> => {
    await ensureGatewayConnected(app)

    if (params.source === "clawhub") {
      return app.gateway.client.sendReq("skills.install", {
        source: "clawhub",
        slug: params.slug.trim(),
        ...(params.version ? { version: params.version } : {}),
        ...(params.force !== undefined ? { force: params.force } : {}),
      })
    }

    if (params.source === "upload") {
      return app.gateway.client.sendReq("skills.install", {
        source: "upload",
        slug: params.slug.trim(),
        uploadId: params.uploadId.trim(),
        ...(params.version ? { version: params.version } : {}),
        ...(params.force !== undefined ? { force: params.force } : {}),
      })
    }

    return app.gateway.client.sendReq("skills.install", {
      name: params.name!.trim(),
      installId: params.installId!.trim(),
      ...(params.dangerouslyForceUnsafeInstall !== undefined
        ? { dangerouslyForceUnsafeInstall: params.dangerouslyForceUnsafeInstall }
        : {}),
    })
  }

  const updateSkill = async (params: SkillUpdateParams): Promise<unknown> => {
    await ensureGatewayConnected(app)

    if ("skillKey" in params) {
      return app.gateway.client.sendReq("skills.update", { skillKey: params.skillKey })
    }

    return app.gateway.client.sendReq("skills.update", {
      slug: params.slug.trim(),
      ...(params.version ? { version: params.version } : {}),
    })
  }

  const searchSkills = async (params?: SkillSearchParams): Promise<unknown> => {
    await ensureGatewayConnected(app)
    return app.gateway.client.sendReq("skills.search", params?.query ? { query: params.query } : {})
  }

  const getSkillStatus = async (): Promise<unknown> => {
    await ensureGatewayConnected(app)
    return app.gateway.client.sendReq("skills.status", {})
  }

  return { installSkill, updateSkill, searchSkills, getSkillStatus }
}
