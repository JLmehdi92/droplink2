const MOTIF_ADMIN = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?admin(?:\/|$)/i;

/**
 * « CE CHEMIN VISE-T-IL LA SURFACE ADMIN ? »
 *
 * ⚠️ EXTRAITE DU MIDDLEWARE LE 06/09/2026 POUR POUVOIR ÊTRE ÉPROUVÉE. Elle y
 * vivait, et RIEN ne l'exerçait — mesuré : zéro occurrence de `viseAdmin` dans
 * `tests/`. L'importer depuis le middleware pour la tester entraînait tout
 * `next-intl/middleware`, qui ne se résout pas hors d'un contexte Next.
 *
 * Une fonction de correspondance de chemin n'a besoin d'aucun de ces modules :
 * elle vit donc ici, pure, et le middleware l'appelle.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CE QU'ELLE DÉCIDE, ET CE QU'ELLE NE DÉCIDE PAS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Elle commande la couche PRÉ-EMPTIVE : rendre 404 sur `/…/admin` avant toute
 * génération de réponse, pour que la surface n'existe pas aux yeux de qui n'y a
 * pas droit — jamais 403, qui confirmerait son existence.
 *
 * ELLE NE FAIT PAS AUTORITÉ. `requireAdmin()` et la vérification du rôle EN
 * BASE à chaque requête la font. Le middleware ne protège aucune donnée à lui
 * seul — c'est écrit dans le brief, et ça reste vrai.
 *
 * ⚠️ SON MOTIF DÉPEND DU CODE DE LANGUE RETENU, ET C'EST UN PIÈGE SILENCIEUX.
 * `[a-z]{2}(-[a-z]{2})?` couvre `fr`, `en`, `zh`, `zh-CN` — mais PAS `zh-Hans`,
 * dont le sous-tag fait quatre lettres. Adopter cette forme ferait disparaître
 * la couche sans un seul signal. C'est une des raisons pour lesquelles le
 * produit retient `zh-CN` plutôt que `zh-Hans`, et
 * `tests/unit/filtre-admin-du-middleware.test.ts` le vérifie sur l'inventaire
 * réel des langues au lieu de le supposer.
 *
 * La langue est acceptée sous n'importe quelle casse et le préfixe peut
 * manquer : ne reconnaître que `/fr/admin` laisserait `/FR/admin` et `/admin`
 * franchir le filtre. Ils ne mènent nulle part aujourd'hui — mais une
 * protection qui tient à ce qu'une redirection ait lieu D'ABORD n'est pas une
 * protection.
 *
 * ⚠️ LE CHEMIN EST TESTÉ BRUT ET DÉCODÉ (revue de sécurité ECC du 04/10/2026, mesuré sur
 * un serveur réel). Le middleware reçoit le chemin ENCODÉ : `/fr/%61dmin` échappait au
 * filtre, puis le routeur de Next le DÉCODAIT et servait la route admin. Aucune donnée ne
 * sortait (`exigerAdmin()` fait autorité), mais la 404 n'était plus vide : 9 532 octets
 * titrés « DropLink — … » contre « Cette page n'existe pas » pour une route inventée — la
 * surface redevenait énumérable, et chaque requête coûtait la garde complète en base.
 *
 * UN CHEMIN INDÉCODABLE EST TRAITÉ COMME L'ADMIN : on ne déclare pas sûr ce qu'on ne sait
 * pas lire (refus par défaut, comme le plafond de débit de cette surface).
 *
 * ET L'ON NE PARIE PAS SUR LE ROUTEUR (relecture ECC du correctif, même jour) : les barres
 * doublées sont ramenées à une seule (`/fr//admin`), et le chemin est décodé jusqu'à
 * stabilité (`%2561` → `%61` → `a`) : le brut et chacun de ses TROIS décodages au plus
 * sont testés. Un chemin encore changeant après trois décodages est traité comme l'admin.
 * Ce refus par défaut touche aussi un `%` littéral encodé (`50%25-promo`) : aucun chemin
 * servi par ce matcher n'en porte (jetons et noms en base 62, slugs fixes ; `/p` et `/api`
 * sont hors matcher).
 */
export function viseAdmin(chemin: string): boolean {
  let courant = chemin.replace(/\/{2,}/g, "/");
  for (let decodages = 0; ; decodages += 1) {
    if (MOTIF_ADMIN.test(courant)) return true;
    let suivant: string;
    try {
      suivant = decodeURIComponent(courant).replace(/\/{2,}/g, "/");
    } catch {
      return true;
    }
    if (suivant === courant) return false;
    if (decodages === 3) return true;
    courant = suivant;
  }
}
