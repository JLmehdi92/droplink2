# Rapport des correctifs de sécurité avant la mise en ligne de la refonte

**Date :** 4 octobre 2026
**Branche :** `refonte` (locale, **non poussée**)
**Commit du correctif :** `fc1f2f6` — *fix(securite): fermer le contournement encodé de la garde admin et deux gardes faibles*
**Base visée par les tests :** la base de TESTS `djvjaocvndqhqqgilrof` (jamais la production)

---

## 0. En une minute

- Avant la mise en ligne, l'agent **ecc:security-reviewer** a relu **tout le diff
  `origin/master...refonte`** (421 fichiers), en insistant sur le middleware, l'administration,
  la page client `/p`, l'authentification et la migration 213.
- Verdict : **aucun constat CRITICAL ni HIGH.** Un **MEDIUM** et deux **LOW**.
- **J'ai vérifié chacun dans le code**, et le MEDIUM **sur un vrai serveur** : il était réel.
- **Les trois sont corrigés**, et chaque correction est prouvée :
  - un test qui échouait avant la correction et passe après ;
  - une mesure à l'exécution, avant et après ;
  - la falsification, c'est-à-dire casser exprès le produit pour vérifier que les tests le
    voient ;
  - deux relectures ECC de la correction elle-même ;
  - toutes les portes vertes.
- Un quatrième point, signalé par une revue précédente, a été **examiné et écarté avec preuve** :
  ce n'était pas un défaut.
- **Bonne nouvelle pour la production :** le MEDIUM existe **aussi dans la version en ligne
  aujourd'hui** (il ne vient pas de la refonte). La mise en ligne de la refonte le corrigera du
  même coup.
- **Rien n'a été poussé. Aucune migration de production.**

---

## 1. Le défaut principal (MEDIUM) : un « a » encodé contournait la première garde de l'administration

### 1.1 Comment l'administration est protégée

L'administration a **deux couches de protection** :

1. **Le middleware** (`src/middleware.ts`) : sur toute adresse qui vise `/admin`, il répond par
   une **404 à corps vide**, avant même que la page existe, si le visiteur n'est pas un
   administrateur. But : qu'un vendeur ou un inconnu ne puisse **même pas savoir** que
   l'administration existe, ni quels écrans elle a.
2. **`exigerAdmin()`**, dans chaque page et chaque action : elle relit le rôle **en base** et
   exige la double authentification. **C'est elle qui protège les données.**

Le middleware reconnaît les adresses d'administration grâce à la fonction `viseAdmin()`
(`src/lib/routes/vise-admin.ts`).

### 1.2 Le défaut

Le middleware reçoit l'adresse **encodée** (telle que tapée), mais `viseAdmin()` ne la décodait
pas. Or le routeur de Next, lui, **décode** l'adresse avant de choisir la page.

Donc `/fr/%61dmin` (`%61` est le code de la lettre `a`) :

- n'était **pas** reconnu par `viseAdmin()`, et passait donc la première couche ;
- était **décodé par Next** en `/fr/admin`, qui servait la page d'administration ;
- tombait alors sur la deuxième couche, qui répondait 404, mais avec **une page complète** et
  non plus une page vide.

### 1.3 La preuve, mesurée sur un vrai serveur (avant la correction)

| Adresse demandée (visiteur anonyme) | Statut | Taille de la page | Titre |
|---|---|---|---|
| `/fr/admin` | 404 | **0 octet** (vide, comme prévu) | — |
| `/fr/%61dmin` | 404 | **9 532 octets** | « DropLink — … » |
| `/fr/%61dmin/comptes` | 404 | **10 027 octets** | « DropLink — … » |
| `/%66r/admin` (le `f` encodé) | 404 | 9 532 octets | « DropLink — … » |
| `/fr/admin-inexistant` (route inventée) | 404 | 11 671 octets | « Cette page n'existe pas » |

### 1.4 Ce que ça permettait (et ce que ça ne permettait pas)

- ✅ **Aucune donnée ne sortait** : la deuxième couche (`exigerAdmin`) a toujours tenu.
- ❌ En revanche, **l'administration redevenait énumérable**. Une route admin qui existe
  répondait « DropLink — … », une route inventée « Cette page n'existe pas ». En essayant des
  noms, un curieux pouvait dresser la liste exacte des écrans d'administration, ce que la page
  vide existe justement pour empêcher.
- ❌ Chaque requête de ce genre **coûtait des allers-retours en base** (rôle, quota) au lieu
  d'un refus immédiat.

**Ce défaut n'a pas été introduit par la refonte :** `vise-admin.ts` n'était pas modifié par le
diff. Il existe donc **aussi en production aujourd'hui**.

### 1.5 La correction

`viseAdmin()` teste désormais l'adresse :

1. **brute**, avec les barres doublées ramenées à une seule (`/fr//admin` → `/fr/admin`) ;
2. puis **chacun de ses décodages successifs, trois au plus** (`%2561` → `%61` → `a`). On ne
   parie pas sur le nombre de décodages que fait le routeur.

Et elle **refuse par défaut** :

- une adresse **impossible à décoder** est traitée comme une adresse d'administration ;
- une adresse **encore changeante après trois décodages** aussi.

C'est la même règle que le plafond de débit de l'administration : en cas de doute, on refuse.

**Ce que coûte ce refus par défaut, écrit noir sur blanc :** une adresse qui contient un `%`
littéral encodé (par exemple `/fr/blog/50%25-promo`) reçoit aussi la 404 vide. **Aucune page du
produit n'a une telle adresse** : les jetons et les noms de lien sont en lettres et chiffres,
les adresses du blog sont fixes, et `/p` et `/api` ne passent pas par ce filtre. Un test le
documente.

### 1.6 La preuve, mesurée sur un vrai serveur (après la correction)

| Adresse demandée | Avant | **Après** |
|---|---|---|
| `/fr/admin` | 404, 0 octet | 404, **0 octet** ✅ |
| `/fr/%61dmin` | 404, 9 532 octets | 404, **0 octet** ✅ |
| `/fr/%61dmin/comptes` | 404, 10 027 octets | 404, **0 octet** ✅ |
| `/%66r/admin` | 404, 9 532 octets | 404, **0 octet** ✅ |
| `/FR/%41dmin` | — | 404, **0 octet** ✅ |
| `/fr/adm%69n/journal` | — | 404, **0 octet** ✅ |
| `/fr/%2561dmin` (double encodage) | — | 404, **0 octet** ✅ |
| `/fr/%252561dmin` (triple) | — | 404, **0 octet** ✅ |
| `/fr/%25252561dmin` (quadruple) | — | 404, **0 octet** ✅ |
| `/fr//admin` | — | 308 (Next le redirige vers `/fr/admin`, lui-même refusé) ✅ |

**Contre-vérifications (rien d'autre ne doit avoir changé) :**

| Adresse | Résultat après correction |
|---|---|
| `/fr` (la landing) | 200, page normale ✅ |
| `/fr/connexion` | 200, page normale ✅ |
| `/fr/admin-inexistant` | 404 « Cette page n'existe pas », comme avant ✅ |
| `/fr/%61dministration` (ressemble à « admin » mais ne l'est pas) | 404 « Cette page n'existe pas », comme avant ✅ |
| `/fr/caf%C3%A9` (accent encodé) | 404 « Cette page n'existe pas », comme avant ✅ |
| **Un vrai administrateur**, double authentification réelle : vue d'ensemble, comptes, journal | **s'ouvrent normalement** (sonde au navigateur, code 0) ✅ |

✅ **Défaut corrigé.**

---

## 2. Premier LOW : `redirigerVers` laissait passer deux formes de redirection vers un autre site

### 2.1 Le défaut

`redirigerVers()` (`src/lib/http/rediriger.ts`) fabrique les redirections des routes serveur
(déconnexion, retour d'authentification, gestes de liste, e-mails de suivi). Sa garde
n'acceptait qu'un chemin qui commence par **un seul** `/`, pour refuser `//autre-site.fr`, que
les navigateurs envoient vers un autre domaine.

Mais les navigateurs lisent aussi **`\` comme `/`**, et **retirent les tabulations et les
retours à la ligne** d'une adresse. `/\autre-site.fr` ou `/<tabulation>/autre-site.fr`
franchissaient donc le contrôle, puis devenaient `//autre-site.fr` dans le navigateur.

**Ce qui était exposé aujourd'hui : rien.** Aucun appelant ne passe une valeur venue de
l'utilisateur : tous construisent `/${langue}/…` avec une langue validée, ou passent par
`new URL()` avec un double contrôle d'origine. Mais une garde qui ne tient que parce que
personne n'a encore fait l'erreur n'en est pas une (leçon L-029 du dépôt).

### 2.2 La correction

La garde refuse désormais aussi la **barre inverse** et **tous les caractères de contrôle**
(U+0000 à U+001F, et U+007F). Tout chemin refusé est remplacé par `/`.

### 2.3 La preuve

Test `tests/unit/redirections-relatives.test.ts` : vu **rouge** avant la correction, **vert**
après.

- Formes hostiles ajoutées : `/\exemple-mal.tld`, `/<tab>/exemple-mal.tld`,
  `/<retour>/exemple-mal.tld`, `/<CR><LF>/…`, `/<NUL>/…`, `/<U+001F>/…`, `/<DEL>/…`.
  Toutes sont ramenées à `/`.
- **Contre-test** : un chemin normal (`/fr/connexion?erreur=lien`) et un chemin avec un accent
  **encodé** (`/fr/commandes?q=caf%C3%A9`) passent intacts.

✅ **Corrigé.**

---

## 3. Deuxième LOW : la case « se souvenir de cet appareil » acceptée sur le retour à l'administration

### 3.1 Le défaut

À la vérification à deux facteurs, la case « se souvenir de cet appareil pendant 30 jours »
(migration 203) n'est montrée qu'à la **connexion ordinaire**. Mais l'action serveur
(`verification/actions.ts`) l'acceptait sur **tout** parcours autre que la réinitialisation du
mot de passe, donc aussi sur le **retour à l'administration**. Une requête forgée à la main
pouvait poser la preuve d'appareil sur ce chemin.

**Aucune élévation de droits possible :** la personne avait déjà prouvé son second facteur, et
l'administration exige de toute façon la double authentification **en base** à chaque requête
(migration 186), quelle que soit la preuve d'appareil.

### 3.2 La correction

La règle vit maintenant dans une petite fonction, `retenirAppareil(souvenir, suite)`
(`src/lib/auth/appareil-fiable.ts`), que l'action appelle. Elle ne rend « oui » que si la case
est cochée **et** qu'il n'y a **aucune suite** (connexion ordinaire). L'action exécute
désormais la règle que l'interface affiche, au lieu de s'en remettre à l'interface (leçon L-014).

### 3.3 La preuve

Test `tests/unit/appareil-fiable.test.ts` : vu **rouge** avant la correction, **vert** après.

- Connexion ordinaire avec la case cochée : l'appareil est retenu (**contre-test**) ✅
- Réinitialisation, retour à l'administration, case absente : l'appareil n'est **pas** retenu ✅

Sur le parcours normal, rien ne change : le formulaire transforme une `suite` vide en « aucune
suite », donc la case continue de fonctionner à la connexion ordinaire.

✅ **Corrigé.**

---

## 4. Le point examiné et écarté : le HTML du film des pages d'accès

Une revue précédente avait signalé (LOW) que le film animé des pages de connexion et
d'inscription construit son HTML à partir des textes traduits, sans échappement.

**Vérifié dans le code : c'est faux.**

- Le `t` local du film **échappe déjà** chaque texte (`const t = (cle) => esc(T[cle] ?? "")`,
  ligne 187 de `src/components/acces/film-acces.tsx`).
- Les adresses d'images passent aussi par `esc()`.
- Les seules autres valeurs insérées sont des **constantes écrites dans le code** (les chiffres
  des rouleaux de l'horloge).

Rien à corriger ; je n'ai rien modifié.

---

## 5. Comment chaque correction a été prouvée

### 5.1 Les tests d'abord, vus rouges

Avant toute modification du produit, j'ai écrit les tests. Résultat **avant** correction :
**5 tests en échec**, chacun pour la bonne raison :

| Test | Message d'échec |
|---|---|
| chemins encodés | « /fr/%61dmin échappe au filtre » |
| encodage invalide | attendu `true`, obtenu `false` |
| redirections | « /\exemple-mal.tld n'a pas été neutralisé » |
| appareil fiable (×2) | `retenirAppareil` n'existait pas encore |

Les **contre-tests passaient déjà**, ce qui prouve qu'ils ne refusent pas tout.

Puis, après la première relecture ECC, deux nouveaux cas ont été ajoutés et vus rouges à leur
tour : les **barres doublées** (`/fr//admin`) et la **borne des décodages**.

### 5.2 La falsification : casser exprès le produit

La règle du dépôt dit : *un test qui n'échoue pas quand on casse le produit ne prouvait rien.*
Le falsificateur (`scripts/falsifier.mjs`) a reçu une cible de plus, et sa cible existante a été
mise à jour sur le nouveau code :

| Ce que la falsification casse | Tests qui rougissent | Conclusion |
|---|---|---|
| `middleware-aveugle-a-admin` : le filtre ne reconnaît plus rien | **8 tests** rouges | le filtre est bien éprouvé |
| `admin-chemin-encode-non-decode` : le filtre reconnaît `/fr/admin` mais **ne décode plus** (le défaut exact du 04/10) | **4 tests** rouges (chemins encodés, borne, `%` littéral, encodage invalide), et ceux de `/fr/admin` **restent verts** | les tests distinguent précisément ce défaut |

Après chaque falsification, le fichier a été **restauré depuis git**, et les tests sont repassés
à **13 sur 13**.

### 5.3 Les relectures par les agents ECC

| Agent | Sur quoi | Résultat |
|---|---|---|
| **security-reviewer** | tout le diff `origin/master...refonte` | 0 CRITICAL, 0 HIGH, 1 MEDIUM, 2 LOW → **les trois corrigés** |
| **security-reviewer** | la correction elle-même | 0 CRITICAL, 0 HIGH. Deux remarques MEDIUM **prises en compte** : barres doublées (`/fr//admin`) et décodage répété au lieu d'un seul (ne pas parier sur le routeur). Deux LOW sur la couverture des tests, **ajoutés** |
| **code-reviewer** | la correction finale | **Approuvée.** Une remarque MEDIUM **prise en compte** (tester la borne des décodages dans les deux sens), et quatre LOW **corrigés** : commentaire exact sur le nombre de décodages, documentation rattachée à la fonction, coût du refus par défaut écrit et testé, commentaire orphelin du middleware remplacé |

### 5.4 Les portes, sur un build neuf, base de TESTS

| Porte | Résultat |
|---|---|
| typecheck | ✅ 0 erreur |
| lint | ✅ 0 erreur |
| build | ✅ |
| test (unit) | ✅ **1 324 / 1 325** : le seul échec est l'**alarme Railway** déjà connue et admise (`railway.json` à moins de 60 jours de son échéance du 01/12/2026), qui s'éteint à la mise en ligne |
| test:rls | ✅ **1 098 / 1 098** |
| couverture | ✅ **125 / 129** fichiers de `src/lib/` traversés + 2 sans code + 2 exceptions déclarées |
| fumée | ✅ **54 / 54 routes**, 416 contrôles |

Une garde du dépôt a d'ailleurs fait son travail pendant ce passage : `test:rls` a d'abord
rougi parce que la cible du falsificateur citait encore l'ancienne ligne de `viseAdmin`. Elle a
été mise à jour, et la suite est repassée à 1 098 sur 1 098.

---

## 6. Les fichiers modifiés

| Fichier | Changement |
|---|---|
| `src/lib/routes/vise-admin.ts` | décodage et barres doublées, refus par défaut, documentation |
| `src/middleware.ts` | commentaire orphelin remplacé par un renvoi (aucun code changé) |
| `src/lib/http/rediriger.ts` | refus de `\` et des caractères de contrôle |
| `src/lib/auth/appareil-fiable.ts` | nouvelle fonction `retenirAppareil` |
| `src/app/[locale]/verification/actions.ts` | appelle `retenirAppareil` |
| `scripts/falsifier.mjs` | cible mise à jour + nouvelle cible |
| `tests/unit/filtre-admin-du-middleware.test.ts` | chemins encodés, barres doublées, borne, encodage invalide, `%` littéral, contre-tests |
| `tests/unit/redirections-relatives.test.ts` | formes hostiles + contre-test d'accent encodé |
| `tests/unit/appareil-fiable.test.ts` | règle de l'appareil fiable + contre-test |

Tout est dans **un seul commit, `fc1f2f6`**, fait par `git commit -F -` avec un heredoc à
délimiteur quoté.

---

## 7. Ce qui reste vrai, et ce qui reste à faire

- **Les deux couches de l'administration tiennent** : la première est de nouveau étanche aux
  adresses encodées, la deuxième (`exigerAdmin`, rôle et double authentification en base) n'a
  jamais cédé.
- **Ce que la revue a vérifié sans défaut** (rappel) : la réécriture de `/signalement`, le lien
  au nom du vendeur, l'absence de redirection ouverte dans le middleware, les 10 pages et 6
  actions admin gardées, aucune lecture admin par la clé de service, aucun jeton public ni nom
  de client exposé à l'admin, la page client (aucun autre jeton, cadrage limité à l'aperçu,
  liens du vendeur filtrés), le 2FA (code validé côté serveur, redirection construite côté
  serveur), la déconnexion (POST avec contrôle d'origine), la migration 213 (fermée et gardée),
  aucun secret dans le code.
- **Toujours en point ouvert, inchangé :** la CSP de production autorise encore les scripts en
  ligne (`'unsafe-inline'`), et la refonte en ajoute trois, tous des constantes. C'est
  l'arbitrage CSP qui reste à trancher un jour, pas un défaut de cette branche.
- **La mise en ligne**, inchangée, dans cet ordre et sur ton ordre seulement :
  1. réglages de `railway.json` recopiés dans Railway, puis fichier supprimé ;
  2. **toi** : `pnpm db:migrate` (la migration 213) ;
  3. vérifier que le rôle `authenticator` porte `pgrst.db_pre_request` ;
  4. `pnpm verif:prod` ;
  5. fusion de `refonte` dans `master`, puis push.

  Cette mise en ligne **corrigera aussi en production** le défaut de la section 1, qui y existe
  aujourd'hui.

---

## 8. Conclusion

**Les trois failles et problèmes trouvés par la revue de sécurité sont corrigés :**

1. ✅ **MEDIUM** — le `a` encodé qui contournait la première garde de l'administration et
   rendait ses écrans énumérables : **corrigé**. Prouvé par des tests vus rouges puis verts, par
   la mesure sur un vrai serveur avant et après, par deux falsifications, et par le contre-cas
   d'un vrai administrateur qui accède toujours à l'administration.
2. ✅ **LOW** — les redirections `/\…` et avec caractères de contrôle : **corrigé** et testé.
3. ✅ **LOW** — la case « se souvenir de cet appareil » sur le retour à l'administration :
   **corrigé** et testé.

Le quatrième point signalé (HTML du film) a été **examiné et écarté avec preuve** : il était
déjà protégé.

**Rien n'est poussé. Aucune migration de production n'a été lancée.** J'attends ta réponse.
