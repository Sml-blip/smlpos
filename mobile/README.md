# SMLBOSS

Application Android Expo SDK 54 en lecture seule pour superviser SMLPOS.

## Synchronisation

- Sur le réseau du magasin, SMLBOSS interroge directement le serveur SQLite en lecture seule intégré à SMLPOS (`port 8787`) toutes les 8 secondes.
- Au retour au premier plan et à chaque changement d’onglet, les données sont immédiatement actualisées.
- En mode Supabase direct, les écrans écoutent également les événements Realtime.
- La dernière copie valide est conservée localement afin que les écrans restent consultables hors ligne.
- Le PIN est requis par l’API et aucune route d’écriture n’est exposée.

## Fonctions

- Tableau de bord: chiffre d’affaires du jour, répartition des paiements, ventes du jour et résumé des jours précédents.
- Historique complet des ventes et réparations.
- Factures, devis, bons de livraison et avoirs.
- Inventaire avec recherche et scan de codes-barres via `expo-camera`.
- Clients, crédits, achats et personnel.
- Navigation responsive: barre basse sur téléphone, rail gauche sur tablette.
- Déverrouillage local par PIN et aucune opération de création/modification/suppression.

## Lancer dans Expo Go

1. Copier `.env.example` vers `.env`.
2. Renseigner `EXPO_PUBLIC_SUPABASE_URL` et `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
3. Lancer `pnpm start`, puis scanner le QR avec Expo Go.
4. Entrer le PIN responsable configuré dans l’application.

## Sécurité

L’application n’appelle que des requêtes `select`. L’anon key Expo est publique par nature: les permissions réelles doivent être garanties par les politiques RLS Supabase. Ne jamais placer une service-role key dans l’application.

## Expo Go versus build natif

Cette version utilise `expo-camera` et Supabase pour fonctionner dans Expo Go. Si un futur build natif est souhaité, `react-native-vision-camera` et une base SQLite offline peuvent être ajoutés via Expo Development Build sans changer les écrans.

