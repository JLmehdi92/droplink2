import { describe, expect, test } from "vitest";
import { viseAdmin } from "@/lib/routes/vise-admin";
import { LANGUES } from "@/i18n/config";

/**
 * LE FILTRE ADMIN DU MIDDLEWARE RECONNAÎT TOUTES LES LANGUES DU PRODUIT.
 *
 * ⚠️ IL N'ÉTAIT EXERCÉ PAR RIEN. Mesuré le 06/09/2026 : zéro occurrence de
 * `viseAdmin` dans `tests/`. `middleware-matcher.test.ts` éprouve le MATCHER —
 * quelles routes traversent le middleware — jamais ce que le middleware fait
 * une fois qu'elles l'ont traversé.
 *
 * CE QUE ÇA LAISSAIT PASSER : son motif accepte un code de langue de deux
 * lettres, éventuellement suivi d'un sous-tag de DEUX lettres. `zh-Hans` en a
 * quatre. Adopter cette forme — la plus correcte techniquement pour le chinois
 * simplifié — aurait fait disparaître la couche pré-emptive de `/zh-Hans/admin`
 * SANS AUCUN SIGNAL : aucune donnée ne fuit (`requireAdmin()` fait autorité),
 * mais l'existence de la surface cesse d'être cachée à qui n'y a pas droit, et
 * c'est précisément ce que le 404 protège.
 *
 * Le produit a donc retenu `zh-CN`. Ce test est ce qui rend ce choix VÉRIFIÉ
 * plutôt que supposé — et il rougira si une langue future ne rentre pas dans
 * le motif, au lieu de la laisser passer en silence.
 */
describe("Le filtre admin du middleware", () => {
  test("la sonde inspecte au moins deux langues", () => {
    // Un ensemble vide passe tout : si `LANGUES` devenait illisible, la boucle
    // ci-dessous ne tournerait pas et le test serait vert sans rien prouver.
    expect(LANGUES.length, "l'inventaire des langues est vide ou singulier").toBeGreaterThan(1);
  });

  test.each(LANGUES)("il reconnaît /%s/admin, dans les deux casses", (langue) => {
    expect(viseAdmin(`/${langue}/admin`), `/${langue}/admin échappe au filtre`).toBe(true);
    expect(
      viseAdmin(`/${langue.toUpperCase()}/admin`),
      `/${langue.toUpperCase()}/admin échappe au filtre : la casse ne doit pas ouvrir de porte`,
    ).toBe(true);
    expect(viseAdmin(`/${langue}/admin/comptes`), "une sous-route échappe au filtre").toBe(true);
  });

  test("il reconnaît /admin sans préfixe de langue", () => {
    // Ne reconnaître que les formes préfixées laisserait `/admin` franchir le
    // filtre. Il ne mène nulle part aujourd'hui — mais une protection qui tient
    // à ce qu'une redirection ait lieu D'ABORD n'est pas une protection.
    expect(viseAdmin("/admin")).toBe(true);
    expect(viseAdmin("/admin/comptes")).toBe(true);
  });

  test("CONTRE-TEST : il ne vise PAS ce qui n'est pas l'admin", () => {
    /*
     * Sans lui, « toutes les langues sont reconnues » serait vrai d'un filtre
     * qui rend `true` pour tout — c'est-à-dire d'un produit où plus aucune page
     * ne s'affiche. Une suite où tout est accepté passe à 100 % sans rien
     * prouver.
     */
    for (const chemin of ["/", "/fr", "/fr/commandes", "/p/abc", "/api/suivi", "/fr/administration"]) {
      expect(viseAdmin(chemin), `${chemin} est pris pour une route admin`).toBe(false);
    }
  });

  test("il reconnaît un sous-tag de DEUX lettres, avant même qu'une telle langue existe", () => {
    /*
     * ⚠️ CE CONTRÔLE A ÉTÉ AJOUTÉ PARCE QUE LE PRÉCÉDENT S'EST FAIT FALSIFIER.
     *
     * `test.each(LANGUES)` ne parcourt que `fr` et `en` : aucune n'a de
     * sous-tag. En restreignant le motif à `[a-z]{2}` — donc en lui retirant
     * la capacité d'accepter `zh-CN` —, la suite est restée VERTE, 6/6. La
     * garde n'aurait mordu qu'APRÈS l'ajout du chinois, c'est-à-dire au moment
     * où le défaut serait déjà en production.
     *
     * C'est L-025 dans sa forme la plus pure : une garde qui hérite du champ
     * de vision de l'état PRÉSENT, pas de la propriété qu'elle prétend tenir.
     *
     * Elle éprouve donc la CAPACITÉ du motif, indépendamment de ce que
     * `LANGUES` contient aujourd'hui — parce que c'est cette capacité, et non
     * l'inventaire du moment, qui décide si `/zh-CN/admin` sera caché.
     */
    for (const forme of ["zh-CN", "pt-BR", "es-MX"]) {
      expect(
        viseAdmin(`/${forme}/admin`),
        `/${forme}/admin échappe au filtre : le motif a perdu les sous-tags, et ` +
          "la couche pré-emptive disparaîtrait le jour où une telle langue entre " +
          "dans le produit — sans un seul signal.",
      ).toBe(true);
    }
  });

  test("il reconnaît un chemin ENCODÉ, que le routeur de Next décode avant de servir l'admin", () => {
    /*
     * ⚠️ DÉFAUT MESURÉ LE 04/10/2026 (revue de sécurité ECC, puis serveur réel) : le
     * middleware lit le chemin ENCODÉ. `/fr/%61dmin` échappait au filtre, Next le décodait
     * et servait la route admin : aucune donnée (exigerAdmin fait autorité), mais une 404
     * de 9 532 octets titrée « DropLink — … » là où une route inexistante rend
     * « Cette page n'existe pas » — la surface redevenait énumérable.
     */
    for (const chemin of [
      "/fr/%61dmin",
      "/fr/%61dmin/comptes",
      "/%66r/admin",
      "/FR/%41dmin",
      "/fr/adm%69n/journal",
      "/%61dmin",
      "/fr%2Fadmin",
      // Revue ECC du correctif : barres doublées et double encodage — on ne parie ni sur la
      // normalisation des barres par Next, ni sur le nombre de décodages qu'il fait (L-029).
      "/fr//admin",
      "//admin",
      "/%2Fadmin",
      "/fr/%2561dmin",
    ]) {
      expect(viseAdmin(chemin), `${chemin} échappe au filtre`).toBe(true);
    }
  });

  test("la BORNE des trois décodages est figée, dans les deux sens", () => {
    // Stable au TROISIÈME décodage : il est testé, donc reconnu.
    expect(viseAdmin("/fr/%252561dmin")).toBe(true);
    // Encore changeant après trois décodages : refus par défaut.
    expect(viseAdmin("/fr/%25252561dmin")).toBe(true);
    expect(viseAdmin("/fr/%2525252561dmin")).toBe(true);
    // CONTRE-TEST : stable au troisième décodage et NON admin — reste hors du filtre. Une
    // borne ramenée à deux décodages le ferait passer pour l'admin, et ce test rougirait.
    expect(viseAdmin("/fr/%252561dministration")).toBe(false);
  });

  test("un % littéral encodé est refusé par défaut — le coût est écrit, pas découvert", () => {
    // `50%25-promo` → `50%-promo`, indécodable : traité comme l'admin. Aucun chemin servi
    // par ce matcher n'en porte (voir le commentaire de `viseAdmin`).
    expect(viseAdmin("/fr/blog/50%25-promo")).toBe(true);
  });

  test("un encodage INVALIDE est traité comme l'admin : refus par défaut", () => {
    // Un chemin qu'on ne sait pas décoder ne peut pas être déclaré sûr.
    expect(viseAdmin("/fr/%E0%A4%A")).toBe(true);
  });

  test("CONTRE-TEST : un chemin encodé qui ne vise PAS l'admin reste hors du filtre", () => {
    for (const chemin of ["/fr/%61dministration", "/fr/commandes%2F1", "/fr/caf%C3%A9", "/p/%61dmin"]) {
      expect(viseAdmin(chemin), `${chemin} est pris pour une route admin`).toBe(false);
    }
  });

  test("⚠️ un sous-tag de quatre lettres N'EST PAS reconnu — le fait est mesuré, pas supposé", () => {
    /*
     * Ce contrôle NE DEMANDE PAS de corriger le motif : il fige la limite pour
     * qu'elle cesse d'être une surprise. Si une langue à sous-tag long devait
     * un jour entrer dans `LANGUES`, le test au-dessus rougirait — et celui-ci
     * dirait pourquoi.
     */
    expect(viseAdmin("/zh-Hans/admin")).toBe(false);
    expect(viseAdmin("/zh-Hant-TW/admin")).toBe(false);
  });
});
