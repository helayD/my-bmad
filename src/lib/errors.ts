const ERROR_MESSAGES: Record<string, string> = {
  DB_ERROR: "Une erreur s'est produite. Veuillez réessayer.",
  GITHUB_ERROR: "Erreur lors de la communication avec GitHub.",
  FS_ERROR: "Erreur lors de la lecture du système de fichiers.",
  LOCAL_DISABLED: "Le mode local n'est pas activé sur ce serveur.",
  PATH_NOT_FOUND:
    "Ce chemin n'existe pas sur le serveur. La fonctionnalité dossiers locaux nécessite un déploiement self-hosted.",
  PATH_STALE: "Ce dossier local n'existe plus ou a été déplacé.",
  REGISTRATION_DISABLED: "L'inscription est désactivée sur ce serveur.",
  WORKSPACE_ERROR: "Une erreur s'est produite lors de l'opération sur l'espace de travail.",
  PROJECT_LIMIT_EXCEEDED: "Le nombre maximum de projets actifs a été atteint. Veuillez archiver des projets existants ou mettre à niveau votre plan.",
};

export function sanitizeError(error: unknown, code: string): string {
  console.error(`[${code}]`, error);
  return ERROR_MESSAGES[code] ?? "Une erreur inattendue s'est produite.";
}
