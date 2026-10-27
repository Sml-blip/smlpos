/** Friendly first-run messages for known API errors and browser/Electron network failures. */
export function friendlySyncError(raw: string): string {
  const text = raw.trim().toLowerCase()
  if (/device_limit|trois appareils|limite.{0,20}appareil/.test(text)) return 'Les 3 appareils autorisés sont déjà inscrits. Demandez à l’administrateur de libérer un appareil, puis réessayez.'
  if (/device_revoked|appareil non autorisé|appareil.{0,20}révoqué/.test(text)) return 'Cet identifiant d’appareil a été révoqué. L’administrateur doit autoriser un nouvel appareil avant de continuer.'
  if (/client_update_required|426|mettez à jour smlpos|version.{0,20}(ancienne|minimum)/.test(text)) return 'Cette version de SMLPOS est trop ancienne pour rejoindre l’entreprise. Installez la dernière mise à jour puis réessayez.'
  if (/invalid_login|identifiants incorrects|username is required|password is required/.test(text)) return 'Nom d’utilisateur ou mot de passe incorrect. Vérifiez vos identifiants auprès de l’administrateur.'
  if (/seed_required|seed not ready|main-pc seed|données de l’entreprise ne sont pas encore prêtes/.test(text)) return 'Les données de l’entreprise ne sont pas encore prêtes sur le PC principal. Ce poste attendra leur activation.'
  if (/failed to fetch|fetch failed|networkerror|econn|enotfound|etimedout|timed out|network request failed|serveur injoignable|no network/.test(text)) return 'Connexion Internet ou serveur indisponible. Vérifiez le réseau puis réessayez ; aucun téléchargement n’a été validé.'
  if (/business history|historique métier|ventes déjà/.test(text)) return 'Ce PC contient déjà un historique métier. Rien n’a été effacé : utilisez un poste vide pour rejoindre l’entreprise.'
  if (/backup|sauvegarde/.test(text) && /invalid|verification|verification|changed|vérif|modifiée/.test(text)) return 'La sauvegarde de protection n’a pas pu être vérifiée. Libérez de l’espace disque puis réessayez.'
  return raw
}
