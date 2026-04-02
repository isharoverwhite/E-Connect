import {
  getBoardProfile,
  resolveBoardProfileId,
  type BoardProfile,
} from "./board-profiles";

type ProjectBoardSource = {
  board_profile?: string | null;
  config?: Record<string, unknown> | null;
};

function readConfiguredBoardProfile(
  config: Record<string, unknown> | null | undefined,
): string | null {
  if (!config) {
    return null;
  }

  if (typeof config.board_profile === "string" && config.board_profile.trim()) {
    return config.board_profile.trim();
  }

  if (typeof config.board_id === "string" && config.board_id.trim()) {
    return config.board_id.trim();
  }

  return null;
}

function fallbackBoardLabel(value: string | null | undefined) {
  if (!value) {
    return "Unknown board";
  }

  return value.trim() || "Unknown board";
}

export function resolveProjectBoardProfileId(project: ProjectBoardSource): string | null {
  const configuredBoard =
    readConfiguredBoardProfile(project.config) ??
    (typeof project.board_profile === "string" ? project.board_profile : null);

  if (!configuredBoard) {
    return null;
  }

  return resolveBoardProfileId(configuredBoard) ?? configuredBoard;
}

export function getProjectBoardProfile(project: ProjectBoardSource): BoardProfile | null {
  const boardId = resolveProjectBoardProfileId(project);
  if (!boardId) {
    return null;
  }

  return getBoardProfile(boardId) ?? null;
}

export function getProjectBoardProfileLabel(project: ProjectBoardSource): string {
  return getProjectBoardProfile(project)?.name ?? fallbackBoardLabel(resolveProjectBoardProfileId(project));
}

export function getProjectBoardTypeLabel(project: ProjectBoardSource): string {
  return getProjectBoardProfile(project)?.family ?? fallbackBoardLabel(project.board_profile);
}
